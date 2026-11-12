-- The inside of a marble, built the way the web game builds it (packages/marble-forge/src/three/
-- marble.ts, buildMarble): real pieces inside a glass shell. Cat's-eye blades, spiral swirl
-- ribbons, onionskin streaks, a galaxy's flecks round a dark core, neon ribbons, onyx cracks, an
-- opal heart, a clearie's single wisp, glitter, air bubbles, and the furnace's seed bubbles and
-- stone. The same seeds drive the same random draws as the web game, so a marble's blades, ribbons
-- and bubbles sit where they sit there.
--
-- What Roblox cannot draw: real refraction, dispersion and iridescence in the glass, the milk and
-- clouds of the glass body, the surface normal maps, and the phenomena's shader volumes (those
-- keep MarbleLook.decorate's Roblox effects). Blades are flat ellipsoids, not twisted flames, and
-- ribbons are 14 straight pieces instead of an 80-segment strip.

local Forge = require(script.Parent.Forge)

local MarbleArt = {}

local U32 = 4294967296
local INK = Color3.fromHex("#1b1530")

-- marble.ts rng(): xorshift32, seeded by floor(seed * 2654435761) >>> 0 (or 1).
local function xrng(seed: number): () -> number
	local s = math.floor(seed * 2654435761) % U32
	if s == 0 then
		s = 1
	end
	return function()
		s = bit32.bxor(s, bit32.lshift(s, 13))
		s = bit32.bxor(s, bit32.rshift(s, 17))
		s = bit32.bxor(s, bit32.lshift(s, 5))
		return s / U32
	end
end
MarbleArt.xrng = xrng

-- flaws.ts surfaceFlaws: only the parts that live inside the glass (seeds, stone).
function MarbleArt.flaws(id: string): { seeds: number, stone: boolean }
	local rng = Forge.Rng.new(Forge.hashString("flaws:" .. id))
	local flawless = rng:int(25) == 0
	rng:range(0.15, 0.75) -- ripple
	if rng:next() < 0.7 then
		rng:range(0.35, 1) -- seam
	end
	rng:int(8) -- pits
	if rng:next() < 0.6 then
		rng:range(0.15, 0.7) -- smudge
	end
	local seeds = if rng:next() < 0.45 then 5 + rng:int(10) else 0
	local stone = rng:int(12) == 0
	if flawless then
		return { seeds = 0, stone = false }
	end
	return { seeds = seeds, stone = stone }
end

-- ---- Pieces ---------------------------------------------------------------------------------
local function lum(c: Color3): number
	return c.R * 0.2126 + c.G * 0.7152 + c.B * 0.0722
end

-- An interior piece: emissive in the web game (intensity glow), so bright interiors are Neon.
local function piece(holder: Instance, size: Vector3, cf: CFrame, color: Color3, glow: number, kind: string?): BasePart
	local p = Instance.new("Part")
	p.Name = "Inner"
	p.Anchored = false
	p.CanCollide = false
	p.CanQuery = false
	p.CanTouch = false
	p.Massless = true
	p.CastShadow = false
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = if glow >= 0.7 then Enum.Material.Neon else Enum.Material.SmoothPlastic
	p.Color = color
	if kind == "ball" then
		p.Shape = Enum.PartType.Ball
		p.Size = Vector3.one * math.max(0.002, size.X)
	elseif kind == "ellipsoid" then
		p.Size = Vector3.new(math.max(0.002, size.X), math.max(0.002, size.Y), math.max(0.002, size.Z))
		local m = Instance.new("SpecialMesh")
		m.MeshType = Enum.MeshType.Sphere
		m.Parent = p
	else
		p.Size = Vector3.new(math.max(0.002, size.X), math.max(0.002, size.Y), math.max(0.002, size.Z))
	end
	p:SetAttribute("Local", cf)
	p.Parent = holder
	return p
end

-- marble.ts SpiralCurve.getPoint.
local function spiral(r: number, turns: number, phase: number, tilt: number): (number) -> Vector3
	local rot = CFrame.fromAxisAngle(Vector3.xAxis, tilt)
	return function(t: number): Vector3
		local y = (t * 2 - 1) * r * 0.85
		local rad = math.sqrt(math.max(0, r * r * 0.72 - y * y)) * 0.85
		local a = phase + t * turns * math.pi * 2
		return rot * Vector3.new(math.cos(a) * rad, y, math.sin(a) * rad)
	end
end

-- three's Curve.computeFrenetFrames (closed): parallel-transported normals.
local function frames(pts: { Vector3 }): ({ Vector3 }, { Vector3 })
	local n = #pts
	local T = {}
	for i = 1, n do
		local a = pts[math.max(1, i - 1)]
		local b = pts[math.min(n, i + 1)]
		T[i] = (b - a).Unit
	end
	local t0 = T[1]
	local ax, ay, az = math.abs(t0.X), math.abs(t0.Y), math.abs(t0.Z)
	local axis = Vector3.xAxis
	local min = ax
	if ay <= min then
		min, axis = ay, Vector3.yAxis
	end
	if az <= min then
		axis = Vector3.zAxis
	end
	local v = t0:Cross(axis).Unit
	local N = { t0:Cross(v) }
	for i = 2, n do
		local prev = N[i - 1]
		local c = T[i - 1]:Cross(T[i])
		if c.Magnitude > 1e-6 then
			local th = math.acos(math.clamp(T[i - 1]:Dot(T[i]), -1, 1))
			prev = CFrame.fromAxisAngle(c.Unit, th) * prev
		end
		N[i] = prev
	end
	-- closed: spread the leftover twist evenly
	local th = math.acos(math.clamp(N[1]:Dot(N[n]), -1, 1)) / (n - 1)
	if T[1]:Dot(N[1]:Cross(N[n])) > 0 then
		th = -th
	end
	for i = 2, n do
		N[i] = CFrame.fromAxisAngle(T[i], th * (i - 1)) * N[i]
	end
	return T, N
end

-- marble.ts ribbonGeometry: a flat strip along the curve, widest in the middle.
local SEGMENTS = 14
-- The web's glass is transmissive with a thickness of ~0.6r: it magnifies what is inside, so its
-- ribbons read as broad bands. Roblox glass does not magnify; the ribbons are drawn wider instead.
local MAGNIFY = 1.8
local function ribbon(holder: Instance, base: CFrame, curve: (number) -> Vector3, width: number, thick: number, color: Color3, glow: number)
	local pts = {}
	for i = 0, SEGMENTS do
		pts[i + 1] = curve(i / SEGMENTS)
	end
	local T, N = frames(pts)
	for i = 1, SEGMENTS do
		local a, b = pts[i], pts[i + 1]
		local d = b - a
		local len = d.Magnitude
		if len > 1e-5 then
			local z = d.Unit
			local x = (N[i] + N[i + 1])
			x = (x - z * x:Dot(z))
			x = if x.Magnitude > 1e-6 then x.Unit else z:Cross(Vector3.yAxis).Unit
			local y = z:Cross(x)
			local w = width * MAGNIFY * math.sin(math.pi * (i - 0.5) / SEGMENTS) ^ 0.6
			piece(holder, Vector3.new(w * 2, thick, len * 1.08), base * CFrame.fromMatrix((a + b) / 2, x, y, z), color, glow)
		end
	end
end

local function randomInBall(rand: () -> number): Vector3
	while true do
		local p = Vector3.new(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1)
		if p:Dot(p) <= 1 then
			return p
		end
	end
end

local function flecks(holder: Instance, base: CFrame, rand: () -> number, count: number, reach: number, r: number, color: Color3)
	for _ = 1, count do
		local p = randomInBall(rand) * reach
		local rx, ry, rz = rand() * 6, rand() * 6, rand() * 6
		local s = r * 0.018 * 2 * (0.5 + rand())
		piece(holder, Vector3.new(s, s, s), base * CFrame.new(p) * CFrame.Angles(rx, ry, rz), color, 1)
	end
end

--- The shell's glass: colour, transparency and reflectance, from buildMarble's glass material.
function MarbleArt.glass(look: any): (Color3, number, number)
	local tint = look.base
	local dark = lum(tint) < 0.05
	local hasFx = look.effect ~= nil and look.effect ~= "none"
	local clarity = if hasFx then math.max(look.clarity, 0.72) elseif dark then math.max(look.clarity, 0.5) else look.clarity
	local absorb = if dark then tint:Lerp(look.accent, 0.45) else tint
	local color = if dark then absorb:Lerp(Color3.new(1, 1, 1), 0.22) elseif clarity < 0.5 then tint else Color3.new(1, 1, 1):Lerp(tint, 1 - clarity)
	-- The web's transmission lets the interior show even through tinted glass; Roblox only has
	-- see-through, so the shell is at least half clear.
	local transparency = if look.pattern == "clearie" then 0.75 else 0.3 + clarity * 0.55
	local reflect = if look.finish == "metallic" then 0.3 elseif look.finish == "frosted" then 0.04 else 0.14
	return color, transparency, reflect
end

--- Build the interior of `ball` (radius r studs) for a look with web-game fields:
--- pattern, base, accent, accent2 (Color3), clarity, glow, shape?, sparkle?, effect?, id.
--- `seed` is the slot seed the web game passes buildMarble (named marbles vary with it).
function MarbleArt.build(ball: BasePart, look: any, r: number, seed: number?)
	local holder = Instance.new("Folder")
	holder.Name = "Interior"
	holder.Parent = ball
	local shape = look.shape
	local rand = xrng(if shape then (Forge.hashString(look.id) % 100000) + 1 else (seed or 3.7) + #look.id * 0.37)
	local glowK = math.max(0.25, look.glow or 0)
	local hollow = look.effect ~= nil and look.effect ~= "none"
	local accent, accent2, base = look.accent, look.accent2, look.base
	local colors = { accent, accent2, base }
	local lean = if shape and shape.tilt ~= 0 then CFrame.Angles(shape.tilt, 0, shape.tilt * 0.6) else CFrame.identity
	local pattern = look.pattern

	if pattern == "catseye" then
		local n = if shape then shape.blades else 3 + math.floor(rand() * 2)
		-- A flame-shaped blade 1.48r long, about 0.55r wide, fanned round the vertical axis.
		for i = 0, n - 1 do
			local ang = (i / n) * math.pi + rand() * 0.15
			piece(holder, Vector3.new(r * 0.56, r * 1.48, r * 0.035), lean * CFrame.Angles(0, ang, 0), colors[i % 2 + 1], glowK, "ellipsoid")
		end
	elseif pattern == "swirl" or pattern == "onionskin" then
		local onion = pattern == "onionskin"
		local n = if onion then 7 else 4
		for i = 0, n - 1 do
			local curve = spiral(r * (if onion then 0.95 else 0.85), (if shape then shape.turns else 1) * (0.6 + rand() * 0.8), (i / n) * math.pi * 2, (rand() - 0.5) * 0.6)
			local w = r * (if shape then shape.width else 1) * (if onion then 0.15 else 0.07 + rand() * 0.05)
			ribbon(holder, lean, curve, w, r * 0.03, colors[i % 2 + 1], glowK)
		end
		if onion and not hollow then
			piece(holder, Vector3.one * r * 1.1, lean, Color3.fromHex("#f6f1e6"), 0.05, "ball")
		end
	elseif pattern == "galaxy" then
		-- The web's deep core glows with a nebula in the accent colours (effects.ts buildCoreVolume).
		if not hollow then
			piece(holder, Vector3.one * r * 1.1, lean, base:Lerp(accent, 0.4), 0.05, "ball")
		end
		flecks(holder, lean, rand, 200, r * 0.7, r, accent2)
		ribbon(holder, lean, spiral(r * 0.8, 1.2, rand() * 6, 0.4), r * 0.09, r * 0.03, accent, 0.45)
	elseif pattern == "neon" then
		for i = 0, 2 do
			ribbon(holder, lean, spiral(r * 0.92, 0.9 + i * 0.3, (i / 3) * math.pi * 2, 0.3 * (i - 1)), r * 0.1, r * 0.03, colors[i % 2 + 1], 1.6)
		end
		if not hollow then
			piece(holder, Vector3.one * r * 1.0, lean, base, 0.02, "ball")
		end
	elseif pattern == "onyx" then
		-- textures.ts 'cracks': glowing accent cracks over black, on a sphere just inside the glass.
		if not hollow then
			piece(holder, Vector3.one * r * 1.86, lean, Color3.new(0, 0, 0), 0, "ball")
		end
		local cr = Forge.Rng.new(math.floor((seed or 3.7) * 10) + 11)
		for _ = 1, 12 do
			local p = Vector3.new(cr:range(-1, 1), cr:range(-1, 1), cr:range(-1, 1)).Unit
			for _ = 1, 5 do
				local q = (p + Vector3.new(cr:range(-0.35, 0.35), cr:range(-0.35, 0.35), cr:range(-0.35, 0.35))).Unit
				local a, b = p * r * 0.94, q * r * 0.94
				local d = b - a
				if d.Magnitude > 1e-4 then
					piece(holder, Vector3.new(r * cr:range(0.025, 0.06), r * 0.02, d.Magnitude), lean * CFrame.lookAt((a + b) / 2, b), if cr:next() < 0.75 then accent else accent2, 1)
				end
				p = q
			end
		end
	elseif pattern == "opal" then
		local o = piece(holder, Vector3.one * r * (if hollow then 0.76 else 1.4), lean, accent, look.glow or 0, "ball")
		o.Material = Enum.Material.Glass
		o.Reflectance = 0.35
	elseif pattern == "clearie" then
		ribbon(holder, lean, spiral(r * 0.7, 0.35, rand() * 6, 0.9), r * 0.035, r * 0.02, accent, 0.5)
	end

	-- Glitter: generated collectibles carry flecks through the glass (galaxies have their own).
	local sparkle = look.sparkle or 0
	if sparkle > 0.02 and pattern ~= "galaxy" then
		flecks(holder, CFrame.identity, rand, math.floor(40 * sparkle + 0.5), r * 0.85, r, accent2)
	end

	-- Bubbles: every glass marble has a few, clearies more.
	local bubbles = (if shape then shape.bubbles else 3) + (if pattern == "clearie" then 6 else 0)
	local white = Color3.new(1, 1, 1)
	for _ = 1, bubbles do
		local dir = Vector3.new(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1)
		dir = if dir.Magnitude > 1e-6 then dir.Unit else Vector3.yAxis
		local p = dir * r * (0.3 + rand() * 0.55)
		local b = piece(holder, Vector3.one * r * (0.02 + rand() * 0.035) * 2, CFrame.new(p), white, 0, "ball")
		b.Reflectance = 0.3
	end

	-- Flaws inside the glass: a trail of seed bubbles, now and then a stone.
	if look.flaws ~= false then
		local f = MarbleArt.flaws(look.id)
		if f.seeds > 0 or f.stone then
			local fr = Forge.Rng.new(Forge.hashString("seeds:" .. look.id))
			local function at()
				local v = Vector3.new(fr:range(-1, 1), fr:range(-1, 1), fr:range(-1, 1))
				return if v.Magnitude > 1e-6 then v.Unit else Vector3.yAxis
			end
			if f.seeds > 0 then
				local p = at() * r * fr:range(0.3, 0.7)
				local dir = at()
				local bend = at() * 0.25
				for _ = 1, f.seeds do
					piece(holder, Vector3.one * r * fr:range(0.006, 0.014) * 2, CFrame.new(p), white, 0, "ball")
					dir = (dir + bend).Unit
					p += dir * r * fr:range(0.025, 0.05)
					if p.Magnitude > r * 0.88 then
						break
					end
				end
			end
			if f.stone then
				local col = if fr:next() < 0.5 then Color3.fromHex("#efe6d2") else Color3.fromHex("#8a7458")
				local p = at() * r * fr:range(0.35, 0.75)
				local size = Vector3.new(r * fr:range(0.02, 0.035), r * fr:range(0.015, 0.03), r * fr:range(0.02, 0.035)) * 2
				local s = piece(holder, size, CFrame.new(p) * CFrame.Angles(fr:next() * 6, fr:next() * 6, 0), col, 0)
				s.Material = Enum.Material.Slate
			end
		end
	end

	-- Weld every piece to the ball at its own offset (a Weld's C0 holds it there however the
	-- ball is moved or when it enters the world).
	local cf = ball.CFrame
	for _, p in ipairs(holder:GetChildren()) do
		local pp = p :: BasePart
		local offset = pp:GetAttribute("Local") :: CFrame
		pp:SetAttribute("Local", nil)
		pp.CFrame = cf * offset
		local w = Instance.new("Weld")
		w.Part0 = ball
		w.Part1 = pp
		w.C0 = offset
		w.C1 = CFrame.identity
		w.Parent = pp
	end
	return holder
end

MarbleArt.INK = INK
return MarbleArt
