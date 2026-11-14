-- Each field's own sky and the things in it, so every ring is a special place of its own. Drawn
-- on this client only, while it watches a table: the time of day, clouds, stars and exposure, and
-- set pieces that move: fairy lights and paper planes over the desk, kites over the street,
-- hot-air balloons over the lawn, a sunset with seagulls on the beach, an aurora over the frozen
-- lake, a tower crane and dust devils at the gravel pit, a Ferris wheel and fireworks at the
-- mini-golf. Everything high or inside the table's own plot, so it never cuts through another table.

local Lighting = game:GetService("Lighting")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Skies = {}
Skies.current = nil :: string?
Skies.pieces = 0 -- parts in the current sky (tests read it)

local rgb = Color3.fromRGB
local TOY = { rgb(255, 90, 110), rgb(255, 200, 50), rgb(80, 200, 255), rgb(120, 230, 110), rgb(190, 110, 255), rgb(255, 150, 60) }

-- Per field: the clock, the exposure lift that keeps dusk bright, the stars, and the clouds.
local SKY = {
	desk = { clock = 15.6, exposure = 0, stars = 0 },
	culdesac = { clock = 17.1, exposure = 0.25, stars = 0, clouds = { cover = 0.45, density = 0.35, color = rgb(255, 220, 200) } },
	grass = { clock = 12.8, exposure = 0, stars = 0, clouds = { cover = 0.6, density = 0.45, color = rgb(255, 255, 255) } },
	sand = { clock = 16.9, exposure = 0.3, stars = 0, clouds = { cover = 0.42, density = 0.3, color = rgb(255, 196, 196) } },
	ice = { clock = 18.4, exposure = 0.55, stars = 3500, clouds = nil },
	gravel = { clock = 15.2, exposure = 0.1, stars = 0, clouds = { cover = 0.3, density = 0.25, color = rgb(255, 236, 214) } },
	minigolf = { clock = 18.1, exposure = 0.5, stars = 2000, clouds = { cover = 0.25, density = 0.2, color = rgb(255, 190, 220) } },
}
Skies.SKY = SKY

local folder: Folder? = nil
local conn: RBXScriptConnection? = nil
local saved: { [string]: any }? = nil
local sky: Sky? = nil
local clouds: Clouds? = nil

local function piece(parent: Instance, props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
	p.Material = Enum.Material.SmoothPlastic
	for k, v in pairs(props) do
		(p :: any)[k] = v
	end
	p.Parent = parent
	Skies.pieces += 1
	return p
end

local function ball(parent: Instance, at: Vector3, size: Vector3, color: Color3, material: Enum.Material?): Part
	local p = piece(parent, { Size = size, CFrame = CFrame.new(at), Color = color, Material = material or Enum.Material.SmoothPlastic })
	local m = Instance.new("SpecialMesh")
	m.MeshType = Enum.MeshType.Sphere
	m.Parent = p
	return p
end

local function rod(parent: Instance, a: Vector3, b: Vector3, thick: number, color: Color3): Part
	return piece(parent, { Size = Vector3.new(thick, thick, (b - a).Magnitude), CFrame = CFrame.lookAt((a + b) / 2, b), Color = color })
end

-- A model's parts and their offsets from a pivot, so it can be moved as one each frame.
local function rig(parts: { BasePart }, pivot: CFrame)
	local list = {}
	for _, p in ipairs(parts) do
		table.insert(list, { part = p, off = pivot:ToObjectSpace(p.CFrame) })
	end
	return function(cf: CFrame)
		for _, e in ipairs(list) do
			e.part.CFrame = cf * e.off
		end
	end
end

-- ---- The set pieces: each builds into `f` around `o` and returns its per-frame update ----------

local BUILD = {}

-- The desk at night-light time: strings of fairy lights over the field, paper planes gliding.
BUILD.desk = function(f: Folder, o: Vector3, rng: Random)
	local bulbs = {}
	local warm = { rgb(255, 214, 120), rgb(255, 150, 190), rgb(150, 220, 255), rgb(180, 255, 160), rgb(255, 245, 220) }
	for strand = 0, 2 do
		local a = strand / 3 * math.pi + 0.3
		local p1 = o + Vector3.new(math.cos(a) * 72, 34, math.sin(a) * 72)
		local p2 = o - Vector3.new(math.cos(a) * 72, -34, math.sin(a) * 72)
		local n = 40
		local prev = p1
		for i = 1, n do
			local t = i / n
			local p = p1:Lerp(p2, t) - Vector3.new(0, math.sin(t * math.pi) * 10, 0)
			rod(f, prev, p, 0.12, rgb(60, 70, 60))
			local b = ball(f, p - Vector3.new(0, 0.6, 0), Vector3.new(0.9, 1.2, 0.9), warm[(i + strand) % #warm + 1], Enum.Material.Neon)
			table.insert(bulbs, { part = b, base = b.Color, k = rng:NextNumber() * 6.28 })
			prev = p
		end
	end
	local planes = {}
	for i = 1, 3 do
		local parts = {
			piece(f, { Size = Vector3.new(0.2, 0.2, 5), CFrame = CFrame.new(o), Color = rgb(250, 250, 255) }),
		}
		for _, sd in ipairs({ -1, 1 }) do
			local w = Instance.new("WedgePart")
			w.Anchored, w.CanCollide, w.CanQuery, w.CanTouch, w.CastShadow = true, false, false, false, false
			w.Size = Vector3.new(0.1, 2.4, 5)
			w.Color = rgb(250, 250, 255)
			w.CFrame = CFrame.new(o) * CFrame.new(sd * 1.2, 0, 0) * CFrame.Angles(0, 0, sd * math.pi / 2)
			w.Parent = f
			Skies.pieces += 1
			table.insert(parts, w)
		end
		table.insert(planes, { move = rig(parts, CFrame.new(o)), r = 30 + i * 9, h = 26 + i * 4, speed = 0.18 + i * 0.03, phase = i * 2.1 })
	end
	return function(t: number)
		for _, b in ipairs(bulbs) do
			local s = 0.5 + 0.5 * math.sin(t * 2.2 + b.k)
			b.part.Color = b.base:Lerp(rgb(255, 255, 255), s * 0.35)
			b.part.Transparency = 0.1 + (1 - s) * 0.35
		end
		for _, p in ipairs(planes) do
			local a = t * p.speed + p.phase
			local pos = o + Vector3.new(math.cos(a) * p.r, p.h + math.sin(t * 0.9 + p.phase) * 2, math.sin(a) * p.r)
			local ahead = Vector3.new(-math.sin(a), 0, math.cos(a))
			p.move(CFrame.lookAt(pos, pos + ahead) * CFrame.Angles(0, 0, 0.35))
		end
	end
end

-- The street at golden hour: kites on long strings, tails flicking.
BUILD.culdesac = function(f: Folder, o: Vector3, rng: Random)
	local kites = {}
	for i = 1, 3 do
		local a = i / 3 * math.pi * 2 + 0.6
		local anchorAt = o + Vector3.new(math.cos(a) * 74, 0.5, math.sin(a) * 74)
		local home = o + Vector3.new(math.cos(a + 0.7) * 38, 52 + i * 6, math.sin(a + 0.7) * 38)
		local color = TOY[(i * 2) % #TOY + 1]
		local body = piece(f, { Size = Vector3.new(7, 7, 0.2), CFrame = CFrame.new(home) * CFrame.Angles(0, 0, math.pi / 4), Color = color, Material = Enum.Material.Fabric })
		local cross1 = piece(f, { Size = Vector3.new(0.25, 9.6, 0.25), CFrame = CFrame.new(home + Vector3.new(0, 0, 0.15)), Color = rgb(120, 80, 50) })
		local cross2 = piece(f, { Size = Vector3.new(9.6, 0.25, 0.25), CFrame = CFrame.new(home + Vector3.new(0, 1, 0.15)), Color = rgb(120, 80, 50) })
		local tail = {}
		for k = 1, 6 do
			table.insert(tail, piece(f, { Size = Vector3.new(1.2, 0.8, 0.15), CFrame = CFrame.new(home - Vector3.new(0, 5 + k * 1.8, 0)), Color = TOY[(i + k) % #TOY + 1] }))
		end
		local line = piece(f, { Size = Vector3.new(0.1, 0.1, 1), CFrame = CFrame.new(home), Color = rgb(255, 255, 255) })
		table.insert(kites, { move = rig({ body, cross1, cross2 }, CFrame.new(home)), tail = tail, line = line, home = home, anchor = anchorAt, phase = rng:NextNumber() * 6 })
	end
	return function(t: number)
		for _, k in ipairs(kites) do
			local sway = Vector3.new(math.sin(t * 0.7 + k.phase) * 4, math.sin(t * 1.1 + k.phase) * 2, math.cos(t * 0.6 + k.phase) * 3)
			local at = k.home + sway
			k.move(CFrame.new(at) * CFrame.Angles(0, 0, math.sin(t * 1.3 + k.phase) * 0.25))
			for n, seg in ipairs(k.tail) do
				local wig = math.sin(t * 4 - n * 0.8 + k.phase) * (0.5 + n * 0.3)
				seg.CFrame = CFrame.new(at - Vector3.new(-wig, 5 + n * 1.8, 0)) * CFrame.Angles(0, 0, wig * 0.3)
			end
			local a, b = k.anchor, at - Vector3.new(0, 4.5, 0)
			k.line.Size = Vector3.new(0.1, 0.1, (b - a).Magnitude)
			k.line.CFrame = CFrame.lookAt((a + b) / 2, b)
		end
	end
end

-- The lawn on a blue-sky day: hot-air balloons drifting round.
BUILD.grass = function(f: Folder, o: Vector3, rng: Random)
	local balloons = {}
	for i = 1, 3 do
		local c1, c2 = TOY[i % #TOY + 1], TOY[(i + 3) % #TOY + 1]
		local base = CFrame.new(o)
		local parts = {
			ball(f, o + Vector3.new(0, 10, 0), Vector3.new(16, 19, 16), c1),
			piece(f, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(3, 16.4, 16.4), CFrame = CFrame.new(o + Vector3.new(0, 10, 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = c2 }),
			ball(f, o + Vector3.new(0, 17.5, 0), Vector3.new(7, 4, 7), c2),
			piece(f, { Size = Vector3.new(3.6, 2.6, 3.6), CFrame = CFrame.new(o + Vector3.new(0, -2.5, 0)), Color = rgb(170, 110, 60), Material = Enum.Material.Wood }),
		}
		for _, sd in ipairs({ { -1, -1 }, { -1, 1 }, { 1, -1 }, { 1, 1 } }) do
			table.insert(parts, rod(f, o + Vector3.new(sd[1] * 1.6, -1.2, sd[2] * 1.6), o + Vector3.new(sd[1] * 3.6, 2.5, sd[2] * 3.6), 0.12, rgb(90, 70, 50)))
		end
		table.insert(balloons, { move = rig(parts, base), r = 40 + i * 10, h = 48 + i * 9, speed = 0.03 + i * 0.008, phase = rng:NextNumber() * 6 })
	end
	return function(t: number)
		for _, b in ipairs(balloons) do
			local a = t * b.speed + b.phase
			b.move(CFrame.new(o + Vector3.new(math.cos(a) * b.r, b.h + math.sin(t * 0.4 + b.phase) * 2.5, math.sin(a) * b.r)) * CFrame.Angles(0, t * 0.05, math.sin(t * 0.6 + b.phase) * 0.04))
		end
	end
end

-- Flapping gulls (or birds) circling: shared by the beach.
local function gulls(f: Folder, o: Vector3, n: number, tone: Color3, tip: Color3)
	local list = {}
	for i = 1, n do
		local body = ball(f, o, Vector3.new(1.1, 1, 2.6), tone)
		local wl = piece(f, { Size = Vector3.new(3.4, 0.15, 1.3), CFrame = CFrame.new(o), Color = tip })
		local wr = piece(f, { Size = Vector3.new(3.4, 0.15, 1.3), CFrame = CFrame.new(o), Color = tip })
		table.insert(list, { body = body, wl = wl, wr = wr, r = 30 + i * 8, h = 34 + (i % 3) * 6, speed = 0.15 + (i % 2) * 0.05, phase = i * 1.3 })
	end
	return function(t: number)
		for _, g in ipairs(list) do
			local a = t * g.speed + g.phase
			local pos = o + Vector3.new(math.cos(a) * g.r, g.h + math.sin(t * 0.8 + g.phase) * 2, math.sin(a) * g.r)
			local cf = CFrame.lookAt(pos, pos + Vector3.new(-math.sin(a), 0, math.cos(a))) * CFrame.Angles(0, 0, -0.3)
			local flap = math.sin(t * 7 + g.phase) * 0.55
			g.body.CFrame = cf
			g.wl.CFrame = cf * CFrame.new(-0.5, 0.2, 0) * CFrame.Angles(0, 0, flap) * CFrame.new(-1.7, 0, 0)
			g.wr.CFrame = cf * CFrame.new(0.5, 0.2, 0) * CFrame.Angles(0, 0, -flap) * CFrame.new(1.7, 0, 0)
		end
	end
end

-- The beach late in the day: a huge glowing sun low over the sea side, gulls wheeling.
BUILD.sand = function(f: Folder, o: Vector3, _rng: Random)
	local dir = Vector3.new(-0.8, 0, -0.6).Unit
	local sun = ball(f, o + dir * 600 + Vector3.new(0, 70, 0), Vector3.new(110, 110, 110), rgb(255, 170, 90), Enum.Material.Neon)
	sun.Transparency = 0.05
	local halo = ball(f, sun.Position, Vector3.new(170, 170, 40), rgb(255, 120, 140), Enum.Material.Neon)
	halo.CFrame = CFrame.lookAt(sun.Position, o)
	halo.Transparency = 0.75
	local birds = gulls(f, o, 6, rgb(255, 255, 255), rgb(225, 230, 240))
	return function(t: number)
		halo.Transparency = 0.72 + 0.06 * math.sin(t * 0.8)
		birds(t)
	end
end

-- The frozen lake at twilight: curtains of aurora rippling over the stars.
BUILD.ice = function(f: Folder, o: Vector3, rng: Random)
	local panels = {}
	local hues = { rgb(80, 255, 170), rgb(60, 220, 255), rgb(170, 110, 255), rgb(255, 120, 220) }
	for band = 0, 2 do
		local d = 150 + band * 40
		local h = 75 + band * 12
		local n = 26
		for i = 0, n - 1 do
			local a = -0.9 + i / (n - 1) * 1.8 + band * 0.7 + rng:NextNumber(-0.02, 0.02)
			local at = o + Vector3.new(math.sin(a) * d, h, -math.cos(a) * d)
			local p = piece(f, { Size = Vector3.new(2 * math.pi * d / 60 * 1.05, 34, 0.3), CFrame = CFrame.lookAt(at, Vector3.new(o.X, h, o.Z)), Color = hues[(i // 7 + band) % #hues + 1], Material = Enum.Material.Neon, Transparency = 0.6 })
			table.insert(panels, { part = p, base = p.CFrame, k = i * 0.45 + band * 1.7, color = p.Color, next = hues[(i // 7 + band + 1) % #hues + 1] })
		end
	end
	return function(t: number)
		for _, p in ipairs(panels) do
			local w = math.sin(t * 0.6 + p.k)
			p.part.CFrame = p.base * CFrame.new(0, w * 5, math.cos(t * 0.4 + p.k) * 4)
			p.part.Transparency = 0.55 + 0.3 * (0.5 + 0.5 * math.sin(t * 0.9 + p.k * 1.3))
			p.part.Color = p.color:Lerp(p.next, 0.5 + 0.5 * math.sin(t * 0.3 + p.k))
		end
	end
end

-- The gravel pit: a yellow tower crane slowly swinging its hook, and dust devils wandering.
BUILD.gravel = function(f: Folder, o: Vector3, rng: Random)
	local base = o + Vector3.new(58, 0, -58)
	local yellow = rgb(255, 200, 40)
	piece(f, { Size = Vector3.new(6, 1.5, 6), CFrame = CFrame.new(base + Vector3.new(0, 0.75, 0)), Color = rgb(120, 120, 130), Material = Enum.Material.Concrete })
	-- The mast: a lattice of corner posts and cross braces.
	for _, c in ipairs({ { -1, -1 }, { -1, 1 }, { 1, -1 }, { 1, 1 } }) do
		piece(f, { Size = Vector3.new(0.5, 46, 0.5), CFrame = CFrame.new(base + Vector3.new(c[1] * 1.4, 24, c[2] * 1.4)), Color = yellow })
	end
	for y = 3, 45, 4 do
		piece(f, { Size = Vector3.new(3.3, 0.3, 0.3), CFrame = CFrame.new(base + Vector3.new(0, y, 1.4)) * CFrame.Angles(0, 0, if y % 8 == 3 then 0.75 else -0.75), Color = yellow })
		piece(f, { Size = Vector3.new(3.3, 0.3, 0.3), CFrame = CFrame.new(base + Vector3.new(0, y, -1.4)) * CFrame.Angles(0, 0, if y % 8 == 3 then -0.75 else 0.75), Color = yellow })
	end
	-- The turning top: jib, counter-jib, weights, cab and the hook on its cable.
	local top = base + Vector3.new(0, 47, 0)
	local swing = {
		piece(f, { Size = Vector3.new(2.2, 2.2, 44), CFrame = CFrame.new(top + Vector3.new(0, 0, -16)), Color = yellow }),
		piece(f, { Size = Vector3.new(2, 2, 14), CFrame = CFrame.new(top + Vector3.new(0, 0, 11)), Color = yellow }),
		piece(f, { Size = Vector3.new(3.6, 3.4, 4), CFrame = CFrame.new(top + Vector3.new(0, -1.8, 16)), Color = rgb(110, 110, 120), Material = Enum.Material.Concrete }),
		piece(f, { Size = Vector3.new(3, 3, 3.4), CFrame = CFrame.new(top + Vector3.new(0, -2.6, 0)), Color = rgb(255, 255, 255) }),
		piece(f, { Size = Vector3.new(0.6, 6, 0.6), CFrame = CFrame.new(top + Vector3.new(0, 3.5, 0)), Color = yellow }),
		piece(f, { Size = Vector3.new(0.12, 22, 0.12), CFrame = CFrame.new(top + Vector3.new(0, -11, -32)), Color = rgb(40, 40, 50) }),
		piece(f, { Size = Vector3.new(1.6, 1.4, 1.6), CFrame = CFrame.new(top + Vector3.new(0, -22.5, -32)), Color = rgb(255, 80, 60) }),
	}
	local beacon = ball(f, top + Vector3.new(0, 6.8, 0), Vector3.new(1, 1, 1), rgb(255, 60, 60), Enum.Material.Neon)
	table.insert(swing, beacon)
	local move = rig(swing, CFrame.new(top))
	-- Dust devils: a column of swirling dust that wanders the pit's edge.
	local devils = {}
	for i = 1, 2 do
		local p = piece(f, { Size = Vector3.new(3, 14, 3), CFrame = CFrame.new(o), Transparency = 1 })
		local e = Instance.new("ParticleEmitter")
		e.Shape = Enum.ParticleEmitterShape.Cylinder
		e.Texture = "rbxasset://textures/particles/smoke_main.dds"
		e.Color = ColorSequence.new(rgb(220, 200, 170), rgb(190, 170, 140))
		e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1.5), NumberSequenceKeypoint.new(1, 5) })
		e.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.3, 0.6), NumberSequenceKeypoint.new(1, 1) })
		e.Lifetime = NumberRange.new(1.5, 2.2)
		e.Rate = 26
		e.Speed = NumberRange.new(5, 8)
		e.EmissionDirection = Enum.NormalId.Top
		e.RotSpeed = NumberRange.new(200, 360)
		e.Acceleration = Vector3.new(0, 2, 0)
		e.Parent = p
		table.insert(devils, { part = p, phase = i * 3.1 + rng:NextNumber() })
	end
	return function(t: number)
		move(CFrame.new(top) * CFrame.Angles(0, math.sin(t * 0.12) * 1.4, 0))
		beacon.Transparency = if math.floor(t * 1.5) % 2 == 0 then 0 else 0.7
		for _, d in ipairs(devils) do
			local a = t * 0.08 + d.phase
			d.part.CFrame = CFrame.new(o + Vector3.new(math.cos(a) * 66, 7, math.sin(a * 1.3) * 66 * 0.9))
		end
	end
end

-- The seaside arcade at dusk: a lit Ferris wheel turning, and fireworks.
BUILD.minigolf = function(f: Folder, o: Vector3, rng: Random)
	local centre = o + Vector3.new(-56, 30, 56)
	local face = CFrame.lookAt(centre, Vector3.new(o.X, centre.Y, o.Z))
	local R = 21
	-- The A-frame legs, fixed.
	for _, sd in ipairs({ -1, 1 }) do
		for _, z in ipairs({ -1.5, 1.5 }) do
			local foot = (face * CFrame.new(sd * 13, -30, z)).Position
			rod(f, foot, (face * CFrame.new(0, 0, z)).Position, 0.9, rgb(255, 255, 255))
		end
	end
	local wheelParts = {}
	local bulbs = {}
	local n = 24
	for i = 0, n - 1 do
		local a1, a2 = i / n * math.pi * 2, (i + 1) / n * math.pi * 2
		local p1 = (face * CFrame.new(math.cos(a1) * R, math.sin(a1) * R, 0)).Position
		local p2 = (face * CFrame.new(math.cos(a2) * R, math.sin(a2) * R, 0)).Position
		table.insert(wheelParts, rod(f, p1, p2, 0.7, rgb(255, 120, 180)))
		local b = ball(f, p1, Vector3.new(1.3, 1.3, 1.3), TOY[i % #TOY + 1], Enum.Material.Neon)
		table.insert(wheelParts, b)
		table.insert(bulbs, { part = b, i = i })
		if i % 2 == 0 then
			table.insert(wheelParts, rod(f, centre, p1, 0.35, rgb(255, 255, 255)))
		end
	end
	table.insert(wheelParts, ball(f, centre, Vector3.new(3, 3, 3), rgb(255, 220, 60), Enum.Material.Neon))
	local spin = rig(wheelParts, face)
	-- Gondolas hang level from the rim as it turns.
	local gondolas = {}
	for i = 0, 11 do
		local g = piece(f, { Size = Vector3.new(3.2, 2.6, 2.6), CFrame = face, Color = TOY[i % #TOY + 1] })
		table.insert(gondolas, { part = g, a = i / 12 * math.pi * 2 })
	end
	-- Fireworks: a rising spark, then a burst in one colour, every couple of seconds.
	local fw = piece(f, { Size = Vector3.one, CFrame = CFrame.new(o), Transparency = 1 })
	local burst = Instance.new("ParticleEmitter")
	burst.Texture = "rbxasset://textures/particles/sparkles_main.dds"
	burst.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 2.2), NumberSequenceKeypoint.new(1, 0.4) })
	burst.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(0.7, 0.1), NumberSequenceKeypoint.new(1, 1) })
	burst.Lifetime = NumberRange.new(1.2, 1.8)
	burst.Speed = NumberRange.new(22, 30)
	burst.SpreadAngle = Vector2.new(180, 180)
	burst.Acceleration = Vector3.new(0, -14, 0)
	burst.Drag = 1.4
	burst.LightEmission = 1
	burst.Rate = 0
	burst.Parent = fw
	local nextFirework = 0
	return function(t: number)
		local turn = t * 0.12
		spin(face * CFrame.Angles(0, 0, turn))
		for _, b in ipairs(bulbs) do
			local on = (math.floor(t * 4) + b.i) % 3 ~= 0
			b.part.Transparency = if on then 0 else 0.6
		end
		for _, g in ipairs(gondolas) do
			local a = g.a + turn
			local at = (face * CFrame.new(math.cos(a) * R, math.sin(a) * R - 2.2, 0)).Position
			g.part.CFrame = CFrame.lookAt(at, at + face.LookVector)
		end
		if t > nextFirework then
			nextFirework = t + rng:NextNumber(1.2, 2.6)
			local a = rng:NextNumber() * math.pi * 2
			fw.Position = o + Vector3.new(math.cos(a) * rng:NextNumber(20, 60), rng:NextNumber(60, 85), math.sin(a) * rng:NextNumber(20, 60))
			local c = TOY[rng:NextInteger(1, #TOY)]
			burst.Color = ColorSequence.new(rgb(255, 255, 255), c)
			burst:Emit(70)
		end
	end
end

-- ---- Critters: something alive going round each field at ground level -----------------------

local CRITTERS = {}
local PATH_R = 71 -- just past the field's disc, among the toys

-- Build parts at `o` + offsets, and return a mover for the whole group.
local function group(o: Vector3, parts: { BasePart })
	return rig(parts, CFrame.new(o))
end

local function wheelSet(f: Folder, o: Vector3, w: number, l: number, r: number): { BasePart }
	local list = {}
	for _, x in ipairs({ -w, w }) do
		for _, z in ipairs({ -l, l }) do
			table.insert(list, piece(f, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.7, r * 2, r * 2), CFrame = CFrame.new(o + Vector3.new(x, r, z)), Color = rgb(35, 35, 45) }))
		end
	end
	return list
end

-- Drive `move` round the path: `speed` radians a second, facing along the way, with `extra` on top.
local function roundPath(o: Vector3, speed: number, phase: number, r: number?)
	return function(t: number): (CFrame, number)
		local a = t * speed + phase
		local rr = r or PATH_R
		local pos = o + Vector3.new(math.cos(a) * rr, 0, math.sin(a) * rr)
		local ahead = Vector3.new(-math.sin(a), 0, math.cos(a)) * (if speed < 0 then -1 else 1)
		return CFrame.lookAt(pos, pos + ahead), a
	end
end

-- A wind-up toy car on the desk, its key turning.
CRITTERS.desk = function(f: Folder, o: Vector3, _rng: Random)
	local parts = {
		piece(f, { Size = Vector3.new(3.8, 1.6, 6.4), CFrame = CFrame.new(o + Vector3.new(0, 1.6, 0)), Color = rgb(235, 60, 70) }),
		piece(f, { Size = Vector3.new(3.2, 1.4, 2.8), CFrame = CFrame.new(o + Vector3.new(0, 3, 0.6)), Color = rgb(150, 220, 255), Transparency = 0.2 }),
	}
	for _, w in ipairs(wheelSet(f, o, 2, 2.1, 0.9)) do
		table.insert(parts, w)
	end
	local key = piece(f, { Size = Vector3.new(2.4, 1.4, 0.3), CFrame = CFrame.new(o + Vector3.new(0, 4.6, -1.5)), Color = rgb(255, 210, 60), Material = Enum.Material.Metal })
	local move = group(o, parts)
	local path = roundPath(o, 0.22, 0, 66)
	return function(t: number)
		local cf = path(t)
		move(cf * CFrame.new(0, math.abs(math.sin(t * 10)) * 0.15, 0))
		key.CFrame = cf * CFrame.new(0, 4.6, 1.5) * CFrame.Angles(0, 0, t * 6)
	end
end

-- A puppy trotting round the cul-de-sac, tail wagging.
CRITTERS.culdesac = function(f: Folder, o: Vector3, _rng: Random)
	local brown, dark = rgb(200, 140, 80), rgb(110, 70, 40)
	local parts = {
		ball(f, o + Vector3.new(0, 2.4, 0), Vector3.new(2.6, 2.4, 4), brown),
		ball(f, o + Vector3.new(0, 3.8, -2.2), Vector3.new(2.3, 2.3, 2.3), brown),
		ball(f, o + Vector3.new(0, 3.5, -3.3), Vector3.new(1.1, 0.9, 1.1), rgb(240, 200, 160)),
		ball(f, o + Vector3.new(0, 3.7, -3.9), Vector3.new(0.5, 0.45, 0.45), rgb(30, 25, 30)),
		ball(f, o + Vector3.new(-1.1, 4.3, -2.1), Vector3.new(0.6, 1.4, 0.9), dark),
		ball(f, o + Vector3.new(1.1, 4.3, -2.1), Vector3.new(0.6, 1.4, 0.9), dark),
		ball(f, o + Vector3.new(-0.5, 4.2, -3.1), Vector3.new(0.35, 0.35, 0.35), rgb(20, 20, 25)),
		ball(f, o + Vector3.new(0.5, 4.2, -3.1), Vector3.new(0.35, 0.35, 0.35), rgb(20, 20, 25)),
	}
	local legs = {}
	for _, x in ipairs({ -0.8, 0.8 }) do
		for _, z in ipairs({ -1.2, 1.2 }) do
			table.insert(legs, piece(f, { Size = Vector3.new(0.5, 1.6, 0.5), CFrame = CFrame.new(o), Color = brown }))
			legs[#legs]:SetAttribute("x", x)
			legs[#legs]:SetAttribute("z", z)
		end
	end
	local tail = piece(f, { Size = Vector3.new(0.35, 0.35, 1.6), CFrame = CFrame.new(o), Color = brown })
	local move = group(o, parts)
	local path = roundPath(o, 0.3, 1.2)
	return function(t: number)
		local cf = path(t) * CFrame.new(0, math.abs(math.sin(t * 9)) * 0.35, 0)
		move(cf)
		for i, leg in ipairs(legs) do
			local swing = math.sin(t * 9 + (if i % 2 == 0 then math.pi else 0)) * 0.5
			leg.CFrame = cf * CFrame.new(leg:GetAttribute("x") :: number, 1.2, leg:GetAttribute("z") :: number) * CFrame.Angles(swing, 0, 0)
		end
		tail.CFrame = cf * CFrame.new(0, 3.2, 2.4) * CFrame.Angles(0.6, math.sin(t * 16) * 0.7, 0) * CFrame.new(0, 0, 0.6)
	end
end

-- Bees buzzing in loops over the lawn's flowers.
CRITTERS.grass = function(f: Folder, o: Vector3, rng: Random)
	local bees = {}
	for i = 1, 4 do
		local body = ball(f, o, Vector3.new(1.1, 1.1, 1.6), rgb(255, 200, 30))
		local stripe = piece(f, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.35, 1.15, 1.15), CFrame = CFrame.new(o), Color = rgb(30, 25, 30) })
		local wl = ball(f, o, Vector3.new(1.2, 0.1, 0.8), rgb(230, 245, 255))
		local wr = ball(f, o, Vector3.new(1.2, 0.1, 0.8), rgb(230, 245, 255))
		wl.Transparency, wr.Transparency = 0.35, 0.35
		table.insert(bees, { body = body, stripe = stripe, wl = wl, wr = wr, a0 = rng:NextNumber() * 6.28, r = 64 + i * 2, speed = 0.25 + i * 0.05 })
	end
	return function(t: number)
		for _, b in ipairs(bees) do
			local a = b.a0 + t * b.speed + math.sin(t * 2 + b.a0) * 0.15
			local pos = o + Vector3.new(math.cos(a) * b.r + math.sin(t * 3 + b.a0) * 2, 3.5 + math.sin(t * 4 + b.a0) * 1.2, math.sin(a) * b.r)
			local cf = CFrame.lookAt(pos, pos + Vector3.new(-math.sin(a), 0, math.cos(a)))
			b.body.CFrame = cf
			b.stripe.CFrame = cf * CFrame.Angles(0, math.pi / 2, 0)
			local flap = math.sin(t * 40) * 0.5
			b.wl.CFrame = cf * CFrame.new(-0.6, 0.6, 0) * CFrame.Angles(0, 0, 0.4 + flap)
			b.wr.CFrame = cf * CFrame.new(0.6, 0.6, 0) * CFrame.Angles(0, 0, -0.4 - flap)
		end
	end
end

-- Crabs scuttling sideways along the beach, claws snapping.
CRITTERS.sand = function(f: Folder, o: Vector3, rng: Random)
	local crabs = {}
	for i = 1, 3 do
		local red = rgb(240, 90, 60)
		local parts = { ball(f, o + Vector3.new(0, 0.9, 0), Vector3.new(3, 1.4, 2.2), red) }
		for _, sd in ipairs({ -1, 1 }) do
			table.insert(parts, ball(f, o + Vector3.new(sd * 0.6, 1.9, -0.8), Vector3.new(0.45, 0.45, 0.45), rgb(255, 255, 255)))
			table.insert(parts, ball(f, o + Vector3.new(sd * 0.6, 2, -1), Vector3.new(0.22, 0.22, 0.22), rgb(20, 20, 25)))
			for k = 1, 3 do
				table.insert(parts, piece(f, { Size = Vector3.new(1.4, 0.25, 0.25), CFrame = CFrame.new(o + Vector3.new(sd * 1.8, 0.5, -0.6 + k * 0.5)) * CFrame.Angles(0, 0, sd * 0.5), Color = red }))
			end
		end
		local claws = { ball(f, o, Vector3.new(1, 0.7, 0.9), red), ball(f, o, Vector3.new(1, 0.7, 0.9), red) }
		table.insert(crabs, { move = group(o, parts), claws = claws, a0 = i / 3 * math.pi * 2 + rng:NextNumber() * 0.5 })
	end
	return function(t: number)
		for _, c in ipairs(crabs) do
			-- Back and forth along a stretch of the shore, side-on.
			local a = c.a0 + math.sin(t * 0.35 + c.a0) * 0.35
			local pos = o + Vector3.new(math.cos(a) * 68, 0, math.sin(a) * 68)
			local cf = CFrame.lookAt(pos, o * Vector3.new(1, 0, 1) + Vector3.new(0, pos.Y, 0)) * CFrame.new(0, math.abs(math.sin(t * 14)) * 0.12, 0)
			c.move(cf)
			for k, claw in ipairs(c.claws) do
				local sd = if k == 1 then -1 else 1
				claw.CFrame = cf * CFrame.new(sd * 1.5, 1.2, -1.4) * CFrame.Angles(math.sin(t * 6 + k) * 0.4, 0, 0)
			end
		end
	end
end

-- Penguins waddling in a line round the frozen lake, now and then sliding on their bellies.
CRITTERS.ice = function(f: Folder, o: Vector3, _rng: Random)
	local pens = {}
	for i = 1, 3 do
		local parts = {
			ball(f, o + Vector3.new(0, 2.2, 0), Vector3.new(2.6, 3.8, 2.4), rgb(30, 32, 45)),
			ball(f, o + Vector3.new(0, 2, -0.6), Vector3.new(1.9, 2.9, 1.4), rgb(250, 250, 255)),
			ball(f, o + Vector3.new(0, 4.3, -0.2), Vector3.new(1.9, 1.8, 1.9), rgb(30, 32, 45)),
			ball(f, o + Vector3.new(0, 4.2, -1.2), Vector3.new(0.6, 0.4, 0.8), rgb(255, 160, 40)),
			ball(f, o + Vector3.new(-0.45, 4.6, -0.95), Vector3.new(0.35, 0.35, 0.35), rgb(255, 255, 255)),
			ball(f, o + Vector3.new(0.45, 4.6, -0.95), Vector3.new(0.35, 0.35, 0.35), rgb(255, 255, 255)),
			ball(f, o + Vector3.new(-0.6, 0.25, -0.6), Vector3.new(0.9, 0.3, 1.2), rgb(255, 160, 40)),
			ball(f, o + Vector3.new(0.6, 0.25, -0.6), Vector3.new(0.9, 0.3, 1.2), rgb(255, 160, 40)),
		}
		table.insert(pens, { move = group(o, parts), lag = i * 0.075 })
	end
	return function(t: number)
		for _, p in ipairs(pens) do
			local tt = t - p.lag * 8
			local cf = roundPath(o, -0.12, 2.5)(tt)
			-- Every so often they flop down and slide.
			local slide = math.sin(tt * 0.5) > 0.85
			if slide then
				p.move(cf * CFrame.new(0, -1.2, 0) * CFrame.Angles(-1.35, 0, 0) * CFrame.new(0, 0, 0))
			else
				p.move(cf * CFrame.Angles(0, 0, math.sin(tt * 8) * 0.18))
			end
		end
	end
end

-- A toy dump truck rumbling round the pit, bed tipping now and then.
CRITTERS.gravel = function(f: Folder, o: Vector3, _rng: Random)
	local yellow = rgb(255, 195, 30)
	local parts = {
		piece(f, { Size = Vector3.new(4, 1, 8), CFrame = CFrame.new(o + Vector3.new(0, 1.6, 0)), Color = rgb(60, 60, 70) }),
		piece(f, { Size = Vector3.new(3.8, 2.6, 2.6), CFrame = CFrame.new(o + Vector3.new(0, 3.3, -2.6)), Color = yellow }),
		piece(f, { Size = Vector3.new(3.2, 1.2, 0.2), CFrame = CFrame.new(o + Vector3.new(0, 3.8, -3.95)), Color = rgb(150, 220, 255) }),
	}
	for _, w in ipairs(wheelSet(f, o, 2.1, 2.6, 1.1)) do
		table.insert(parts, w)
	end
	local bed = piece(f, { Size = Vector3.new(3.8, 2, 4.6), CFrame = CFrame.new(o), Color = yellow })
	local load = ball(f, o, Vector3.new(3.2, 1.6, 3.8), rgb(150, 140, 125))
	local move = group(o, parts)
	local path = roundPath(o, 0.16, 4)
	return function(t: number)
		local cf = path(t) * CFrame.new(0, math.sin(t * 13) * 0.06, 0)
		move(cf)
		local tip = math.max(0, math.sin(t * 0.4)) ^ 6 * 0.6
		local hinge = cf * CFrame.new(0, 2.1, 3.9) * CFrame.Angles(tip, 0, 0)
		bed.CFrame = hinge * CFrame.new(0, 1, -2.3)
		load.CFrame = hinge * CFrame.new(0, 2.1, -2.3)
	end
end

-- A golf cart puttering round the course.
CRITTERS.minigolf = function(f: Folder, o: Vector3, _rng: Random)
	local parts = {
		piece(f, { Size = Vector3.new(4, 1.4, 6.4), CFrame = CFrame.new(o + Vector3.new(0, 1.5, 0)), Color = rgb(255, 255, 255) }),
		piece(f, { Size = Vector3.new(3.6, 1, 2.2), CFrame = CFrame.new(o + Vector3.new(0, 2.6, 0.8)), Color = rgb(235, 60, 70) }),
		piece(f, { Size = Vector3.new(4.2, 0.3, 4.6), CFrame = CFrame.new(o + Vector3.new(0, 6, 0)), Color = rgb(60, 180, 90) }),
	}
	for _, x in ipairs({ -1.8, 1.8 }) do
		for _, z in ipairs({ -1.8, 1.8 }) do
			table.insert(parts, piece(f, { Size = Vector3.new(0.25, 3.6, 0.25), CFrame = CFrame.new(o + Vector3.new(x, 4.1, z)), Color = rgb(220, 220, 230) }))
		end
	end
	for _, w in ipairs(wheelSet(f, o, 2, 2.2, 0.8)) do
		table.insert(parts, w)
	end
	table.insert(parts, piece(f, { Shape = Enum.PartType.Cylinder, Size = Vector3.new(2.6, 1, 1), CFrame = CFrame.new(o + Vector3.new(0, 3, 3)) * CFrame.Angles(0, 0, math.pi / 2), Color = rgb(80, 120, 220) }))
	local move = group(o, parts)
	local path = roundPath(o, -0.18, 0.5)
	return function(t: number)
		move(path(t) * CFrame.new(0, math.abs(math.sin(t * 7)) * 0.1, 0))
	end
end
Skies.CRITTERS = CRITTERS

--- Dress this client's sky for the field `arenaId` around `origin`.
function Skies.enter(arenaId: string, origin: Vector3)
	if Skies.current == arenaId .. tostring(origin) then
		return
	end
	Skies.leave()
	local cfg = SKY[arenaId]
	if not cfg then
		return
	end
	Skies.current = arenaId .. tostring(origin)
	saved = { ExposureCompensation = Lighting.ExposureCompensation }
	TweenService:Create(Lighting, TweenInfo.new(1.6, Enum.EasingStyle.Sine), { ClockTime = cfg.clock, ExposureCompensation = cfg.exposure }):Play()
	local s = Instance.new("Sky")
	s.Name = "FieldSky"
	s.StarCount = cfg.stars
	s.CelestialBodiesShown = true
	s.SunAngularSize = 14
	s.MoonAngularSize = 16
	s.Parent = Lighting
	sky = s
	if cfg.clouds then
		local c = Instance.new("Clouds")
		c.Cover = cfg.clouds.cover
		c.Density = cfg.clouds.density
		c.Color = cfg.clouds.color
		c.Parent = Workspace.Terrain
		clouds = c
	end
	local f = Instance.new("Folder")
	f.Name = "FieldSkyPieces"
	f.Parent = Workspace
	folder = f
	Skies.pieces = 0
	local rng = Random.new(math.floor(origin.X + origin.Z))
	local skyUpdate = BUILD[arenaId] and BUILD[arenaId](f, origin, rng)
	local critUpdate = CRITTERS[arenaId] and CRITTERS[arenaId](f, origin, rng)
	local update = if skyUpdate or critUpdate
		then function(t: number)
			if skyUpdate then
				skyUpdate(t)
			end
			if critUpdate then
				critUpdate(t)
			end
		end
		else nil
	if update then
		local t = 0
		local tick = if RunService:IsClient() then RunService.RenderStepped else RunService.Heartbeat
		conn = tick:Connect(function(dt)
			t += dt
			update(t)
		end)
		update(0)
	end
end

--- Back to the lobby's sky.
function Skies.leave()
	Skies.current = nil
	if conn then
		conn:Disconnect()
		conn = nil
	end
	if folder then
		folder:Destroy()
		folder = nil
	end
	if sky then
		sky:Destroy()
		sky = nil
	end
	if clouds then
		clouds:Destroy()
		clouds = nil
	end
	if saved then
		TweenService:Create(Lighting, TweenInfo.new(1.2), { ExposureCompensation = saved.ExposureCompensation }):Play()
		saved = nil
	end
end

return Skies
