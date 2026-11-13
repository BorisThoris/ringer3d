-- The effects that make a marble worth wanting: something alive inside the glass (flames, a
-- lightning storm, a swirling galaxy, a snow globe, rising lava, hearts, rainbow glitter, ghost
-- wisps), and for the rarest ones a glow round them and little moons orbiting. Built from Roblox's
-- own particles, beams, lights and highlights, so nothing needs uploading. Particles are locked to
-- the marble, so they roll with it and stay inside the glass.
--
-- Which marble gets what: a named marble by its id (SIGNATURE), a generated one by its tier, its
-- phenomenon and Shiny (forFlags). The ring's target marbles get nothing: they stay clean.
--
-- Some effects move (lightning re-strikes, moons orbit, auras pulse, rainbows shift): parts are
-- tagged "MarbleFX" and the client's MarbleFX.animate() drives them. Effects that need the 3D
-- world (particles, beams, lights) do not draw inside a ViewportFrame; Kit.showcase draws its own
-- in the interface around the preview.

local CollectionService = game:GetService("CollectionService")
local RunService = game:GetService("RunService")

local MarbleFX = {}

local TEX = {
	sparkle = "rbxasset://textures/particles/sparkles_main.dds",
	fire = "rbxasset://textures/particles/fire_main.dds",
	sparks = "rbxasset://textures/particles/fire_sparks_main.dds",
	smoke = "rbxasset://textures/particles/smoke_main.dds",
	glow = "rbxasset://textures/particles/forcefield_glow_main.dds",
	vortex = "rbxasset://textures/particles/forcefield_vortex_main.dds",
	square = "rbxasset://textures/particles/SquareParticle.png",
}
MarbleFX.TEX = TEX
MarbleFX.RATE = 0.7 -- every emitter's share of its full rate

-- What each effect is called on a card ("✦ Lightning inside").
MarbleFX.LABEL = {
	flames = "Flames inside",
	embers = "Glowing embers",
	lava = "Molten core",
	lightning = "Lightning inside",
	galaxy = "A galaxy inside",
	vortex = "Black hole core",
	snow = "Snow globe",
	bubbles = "Bubbles rising",
	hearts = "Floating hearts",
	rainbow = "Rainbow glitter",
	stardust = "Stardust",
	aurora = "Aurora lights",
	wisps = "Ghost wisps",
	glint = "Glints",
	coins = "Gold glitter",
	aura = "Aura",
	orbit = "Orbiting moons",
	spores = "Glowing spores",
	sunrays = "Sun glow",
	crystals = "Crystal shards",
}

-- The named marbles' signature effects.
local SIGNATURE = {
	ember = { "embers" },
	tide = { "bubbles" },
	jade = { "spores" },
	rime = { "snow", "glint" },
	ironside = { "glint" },
	volt = { "lightning", "aura" },
	nova = { "galaxy", "aura" },
	obsidian = { "lava", "embers", "aura" },
	gold = { "coins", "glint", "aura" },
	prism = { "rainbow", "glint", "aura" },
	aurora = { "aurora", "stardust", "orbit", "aura" },
	comet = { "stardust", "glint", "orbit" },
	ruby = { "hearts", "aura" },
	moss = { "spores" },
	sunset = { "sunrays", "embers" },
	-- The Premium Collection.
	dragon = { "flames", "embers", "aura" },
	thunder = { "lightning", "sparkcore", "aura" },
	globe = { "snow", "glint" },
	candy = { "rainbow" },
	lavalamp = { "lava", "bubbles" },
	unicorn = { "rainbow", "stardust", "orbit", "aura" },
	phantom = { "wisps", "aura" },
	blackhole = { "vortex", "galaxy", "orbit", "aura" },
}
MarbleFX.SIGNATURE = SIGNATURE

-- A generated marble: by tier, then its phenomenon, then Shiny.
local TIER_FX = { Common = {}, Rare = { "glint" }, Epic = { "glint", "stardust" }, Legendary = { "stardust", "aura" }, Mythic = { "stardust", "aura", "orbit" } }
local PHENOMENON_FX = { inferno = { "flames", "embers" }, storm = { "lightning" }, starfall = { "galaxy" }, aurora = { "aurora" }, void = { "vortex" }, geode = { "crystals" } }

--- The effects a look gets.
function MarbleFX.forLook(look: any): { string }
	if not look then
		return {}
	end
	local sig = SIGNATURE[look.id]
	if sig then
		return sig
	end
	local c = look.collectible
	if not c then
		return {}
	end
	local out = {}
	local seen = {}
	local function add(list)
		for _, f in ipairs(list or {}) do
			if not seen[f] then
				seen[f] = true
				table.insert(out, f)
			end
		end
	end
	add(PHENOMENON_FX[look.effect or "none"])
	add(TIER_FX[c.tier])
	if c.shiny then
		add({ "rainbow" })
	end
	return out
end

--- The words for a card: "Lightning inside · Aura".
function MarbleFX.describe(look: any): string
	local parts = {}
	for _, f in ipairs(MarbleFX.forLook(look)) do
		if MarbleFX.LABEL[f] then
			table.insert(parts, MarbleFX.LABEL[f])
		end
	end
	return table.concat(parts, " · ")
end

local function seq(...): ColorSequence
	local cs = { ... }
	if #cs == 1 then
		return ColorSequence.new(cs[1])
	end
	local kp = {}
	for i, c in ipairs(cs) do
		table.insert(kp, ColorSequenceKeypoint.new((i - 1) / (#cs - 1), c))
	end
	return ColorSequence.new(kp)
end

local function fade(peak: number?, a: number?, b: number?): NumberSequence
	local p = peak or 0
	return NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(a or 0.2, p), NumberSequenceKeypoint.new(b or 0.75, p), NumberSequenceKeypoint.new(1, 1) })
end

--- An invisible ball inside the marble that emitters fill (its volume) and stay locked to.
local function inner(ball: BasePart, r: number, scale: number): BasePart
	local name = "FxVolume" .. math.floor(scale * 100)
	local v = ball:FindFirstChild(name) :: BasePart?
	if v then
		return v
	end
	local p = Instance.new("Part")
	p.Name = name
	p.Shape = Enum.PartType.Ball
	p.Size = Vector3.one * r * 2 * scale
	p.Transparency = 1
	p.CanCollide, p.CanQuery, p.CanTouch, p.Massless, p.CastShadow = false, false, false, true, false
	p.Anchored = false
	p.CFrame = ball.CFrame
	local w = Instance.new("Weld")
	w.Part0 = ball
	w.Part1 = p
	w.Parent = p
	p.Parent = ball
	return p
end

local function emitter(parent: Instance, props: { [string]: any }): ParticleEmitter
	local e = Instance.new("ParticleEmitter")
	e.LockedToPart = true
	e.Shape = Enum.ParticleEmitterShape.Sphere
	e.ShapeStyle = Enum.ParticleEmitterShapeStyle.Volume
	e.Speed = NumberRange.new(0)
	e.LightInfluence = 0
	e.Brightness = 1.5
	for k, v in pairs(props) do
		(e :: any)[k] = v
	end
	-- Kept light: phones draw these too.
	e.Rate = e.Rate * MarbleFX.RATE
	e.Parent = parent
	return e
end

local function light(parent: Instance, color: Color3, range: number, brightness: number)
	local l = Instance.new("PointLight")
	l.Color = color
	l.Range = range
	l.Brightness = brightness
	l.Shadows = false
	l.Parent = parent
	return l
end

local function neonCore(ball: BasePart, r: number, color: Color3, scale: number, name: string?): BasePart
	local c = Instance.new("Part")
	c.Name = name or "FxCore"
	c.Shape = Enum.PartType.Ball
	c.Size = Vector3.one * r * 2 * scale
	c.Color = color
	c.Material = Enum.Material.Neon
	c.CanCollide, c.CanQuery, c.CanTouch, c.Massless, c.CastShadow = false, false, false, true, false
	c.CFrame = ball.CFrame
	local w = Instance.new("Weld")
	w.Part0 = ball
	w.Part1 = c
	w.Parent = c
	c.Parent = ball
	return c
end

local white = Color3.new(1, 1, 1)

-- Each effect: (ball, r, look) -> adds its pieces to the ball.
local BUILD = {}

BUILD.flames = function(ball, r, look)
	local v = inner(ball, r, 0.55)
	emitter(v, { Name = "Flames", Texture = TEX.fire, Color = seq(Color3.fromRGB(255, 240, 160), look.accent, Color3.fromRGB(180, 20, 0)), Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, r * 0.42), NumberSequenceKeypoint.new(1, r * 0.08) }), Transparency = fade(0.15, 0.15, 0.6), Lifetime = NumberRange.new(0.5, 0.8), Rate = 30, Speed = NumberRange.new(r * 0.15, r * 0.3), EmissionDirection = Enum.NormalId.Top, Acceleration = Vector3.new(0, r * 0.5, 0), RotSpeed = NumberRange.new(-90, 90), Rotation = NumberRange.new(0, 360), LightEmission = 0.9, Brightness = 3 })
	neonCore(ball, r, look.accent, 0.28)
	-- A neon flame tongue standing on the core, so the fire reads even where particles thin out.
	for k = 0, 2 do
		local f = Instance.new("Part")
		f.Name = "Flame"
		f.Size = Vector3.new(r * (0.3 - k * 0.08), r * (0.45 - k * 0.1), r * (0.3 - k * 0.08))
		f.Color = look.accent:Lerp(Color3.fromRGB(255, 230, 120), k * 0.4)
		f.Material = Enum.Material.Neon
		f.Transparency = 0.15
		f.CanCollide, f.CanQuery, f.CanTouch, f.Massless, f.CastShadow = false, false, false, true, false
		local m = Instance.new("SpecialMesh")
		m.MeshType = Enum.MeshType.Sphere
		m.Parent = f
		local off = CFrame.new(0, r * (0.18 + k * 0.16), 0)
		f.CFrame = ball.CFrame * off
		local w = Instance.new("Weld")
		w.Part0, w.Part1, w.C0 = ball, f, off
		w.Parent = f
		f.Parent = ball
	end
	ball:SetAttribute("FxPulse", 1)
	light(ball, look.accent, r * 9, 2.2)
end

BUILD.embers = function(ball, r, look)
	local v = inner(ball, r, 0.8)
	emitter(v, { Name = "Embers", Texture = TEX.sparks, Color = seq(Color3.fromRGB(255, 220, 120), look.accent or Color3.fromRGB(255, 90, 20)), Size = NumberSequence.new(r * 0.12), Transparency = fade(0, 0.2, 0.7), Lifetime = NumberRange.new(0.8, 1.6), Rate = 16, Speed = NumberRange.new(r * 0.1, r * 0.3), SpreadAngle = Vector2.new(180, 180), LightEmission = 1, Brightness = 4 })
end

BUILD.lava = function(ball, r, look)
	neonCore(ball, r, look.accent, 0.42, "Lava")
	local v = inner(ball, r, 0.5)
	emitter(v, { Name = "LavaBlobs", Texture = TEX.glow, Color = seq(Color3.fromRGB(255, 200, 60), look.accent, Color3.fromRGB(120, 10, 0)), Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, r * 0.2), NumberSequenceKeypoint.new(0.5, r * 0.45), NumberSequenceKeypoint.new(1, r * 0.15) }), Transparency = fade(0, 0.25, 0.7), Lifetime = NumberRange.new(1.2, 2), Rate = 10, Speed = NumberRange.new(r * 0.25, r * 0.4), EmissionDirection = Enum.NormalId.Top, LightEmission = 0.8, Brightness = 3 })
	light(ball, look.accent, r * 8, 2)
	ball:SetAttribute("FxPulse", 1)
end

-- A bolt: a zig-zag of thin neon segments from near the centre to the glass. `seed` picks its path.
local BOLT_SEGS = 4
local function boltPath(r: number, rng: Random): { Vector3 }
	local dir = rng:NextUnitVector()
	local side = dir:Cross(Vector3.yAxis)
	if side.Magnitude < 0.1 then
		side = dir:Cross(Vector3.xAxis)
	end
	side = side.Unit
	local up = dir:Cross(side)
	local pts = { dir * r * 0.08 }
	for k = 1, BOLT_SEGS do
		local f = k / BOLT_SEGS
		local jitter = if k == BOLT_SEGS then Vector3.zero else (side * rng:NextNumber(-1, 1) + up * rng:NextNumber(-1, 1)) * r * 0.16
		table.insert(pts, dir * r * (0.08 + f * 0.74) + jitter)
	end
	return pts
end
MarbleFX.boltPath = boltPath

local function placeBolt(ball: BasePart, i: number, pts: { Vector3 })
	for k = 1, BOLT_SEGS do
		local seg = ball:FindFirstChild("Bolt" .. i .. "_" .. k) :: BasePart?
		if seg then
			local p0, p1 = pts[k], pts[k + 1]
			local len = (p1 - p0).Magnitude
			seg.Size = Vector3.new(seg.Size.X, seg.Size.Y, len + seg.Size.X)
			local w = seg:FindFirstChildOfClass("Weld")
			if w then
				w.C0 = CFrame.lookAt((p0 + p1) / 2, p1)
			end
		end
	end
end
MarbleFX.placeBolt = placeBolt

BUILD.lightning = function(ball, r, look)
	-- Bolts: zig-zags of neon inside the glass, re-struck by the animator.
	local col = look.accent
	local rng = Random.new(#tostring(look.id) * 17 + 3)
	for i = 1, 3 do
		for k = 1, BOLT_SEGS do
			local seg = Instance.new("Part")
			seg.Name = "Bolt" .. i .. "_" .. k
			seg.Size = Vector3.new(r * 0.08, r * 0.08, r * 0.2)
			seg.Color = if k == 1 then Color3.new(1, 1, 1) else col:Lerp(Color3.new(1, 1, 1), 0.35)
			seg.Material = Enum.Material.Neon
			seg.CanCollide, seg.CanQuery, seg.CanTouch, seg.Massless, seg.CastShadow = false, false, false, true, false
			seg.CFrame = ball.CFrame
			local w = Instance.new("Weld")
			w.Part0, w.Part1 = ball, seg
			w.Parent = seg
			seg.Parent = ball
		end
		placeBolt(ball, i, boltPath(r, rng))
	end
	ball:SetAttribute("FxBolts", 3)
	ball:SetAttribute("FxRadius", r)
	neonCore(ball, r, Color3.new(1, 1, 1), 0.16)
	light(ball, col, r * 9, 2.4)
end

BUILD.sparkcore = function(ball, r, look)
	local v = inner(ball, r, 0.3)
	emitter(v, { Name = "Sparks", Texture = TEX.sparkle, Color = seq(white, look.accent), Size = NumberSequence.new(r * 0.18), Transparency = fade(0, 0.1, 0.5), Lifetime = NumberRange.new(0.15, 0.3), Rate = 30, Speed = NumberRange.new(r * 2, r * 3), SpreadAngle = Vector2.new(180, 180), Drag = 8, LightEmission = 1, Brightness = 5 })
end

BUILD.galaxy = function(ball, r, look)
	local v = inner(ball, r, 0.78)
	emitter(v, { Name = "Stars", Texture = TEX.sparkle, Color = seq(white, look.accent2 or Color3.fromRGB(255, 220, 140), look.accent), Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, r * 0.05), NumberSequenceKeypoint.new(0.5, r * 0.14), NumberSequenceKeypoint.new(1, r * 0.05) }), Transparency = fade(0, 0.3, 0.7), Lifetime = NumberRange.new(1.5, 3), Rate = 26, RotSpeed = NumberRange.new(-40, 40), LightEmission = 1, Brightness = 4 })
	local n = inner(ball, r, 0.35)
	emitter(n, { Name = "Nebula", Texture = TEX.vortex, Color = seq(look.accent, look.accent2 or look.accent), Size = NumberSequence.new(r * 1.1), Transparency = fade(0.45, 0.3, 0.7), Lifetime = NumberRange.new(2.5, 3.5), Rate = 2.5, RotSpeed = NumberRange.new(60, 120), Rotation = NumberRange.new(0, 360), LightEmission = 1, Brightness = 2 })
	light(ball, look.accent, r * 7, 1.6)
end

BUILD.vortex = function(ball, r, look)
	neonCore(ball, r, Color3.new(0, 0, 0), 0.3, "Hole").Material = Enum.Material.SmoothPlastic
	local v = inner(ball, r, 0.2)
	emitter(v, { Name = "Accretion", Texture = TEX.vortex, Color = seq(Color3.fromRGB(255, 220, 160), look.accent, Color3.fromRGB(80, 0, 160)), Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, r * 1.4), NumberSequenceKeypoint.new(1, r * 0.5) }), Transparency = fade(0.2, 0.2, 0.7), Lifetime = NumberRange.new(1.4, 1.8), Rate = 4, RotSpeed = NumberRange.new(-260, -200), Rotation = NumberRange.new(0, 360), LightEmission = 1, Brightness = 3 })
	light(ball, look.accent, r * 8, 2)
end

BUILD.snow = function(ball, r, _look)
	local v = inner(ball, r, 0.8)
	emitter(v, { Name = "Snow", Texture = TEX.sparkle, Color = seq(white), Size = NumberSequence.new(r * 0.1), Transparency = fade(0, 0.15, 0.8), Lifetime = NumberRange.new(1.6, 2.6), Rate = 22, Speed = NumberRange.new(r * 0.15, r * 0.3), EmissionDirection = Enum.NormalId.Bottom, SpreadAngle = Vector2.new(40, 40), RotSpeed = NumberRange.new(-90, 90), LightEmission = 0.4, Brightness = 2 })
end

BUILD.bubbles = function(ball, r, look)
	local v = inner(ball, r, 0.75)
	emitter(v, { Name = "Bubbles", Texture = TEX.glow, Color = seq(white, look.accent or white), Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, r * 0.05), NumberSequenceKeypoint.new(1, r * 0.16) }), Transparency = fade(0.3, 0.2, 0.8), Lifetime = NumberRange.new(1, 1.6), Rate = 12, Speed = NumberRange.new(r * 0.3, r * 0.5), EmissionDirection = Enum.NormalId.Top, SpreadAngle = Vector2.new(15, 15), LightEmission = 0.5, Brightness = 2 })
end

BUILD.hearts = function(ball, r, look)
	-- Little pulsing pink lights drifting up: hearts beating in the glass.
	local v = inner(ball, r, 0.7)
	emitter(v, { Name = "Hearts", Texture = TEX.glow, Color = seq(Color3.fromRGB(255, 180, 200), look.accent), Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(0.3, r * 0.3), NumberSequenceKeypoint.new(0.5, r * 0.2), NumberSequenceKeypoint.new(0.7, r * 0.3), NumberSequenceKeypoint.new(1, 0) }), Transparency = NumberSequence.new(0.1), Lifetime = NumberRange.new(1.4, 2), Rate = 8, Speed = NumberRange.new(r * 0.2), EmissionDirection = Enum.NormalId.Top, LightEmission = 1, Brightness = 3 })
	neonCore(ball, r, look.accent, 0.22)
	light(ball, look.accent, r * 7, 1.8)
	ball:SetAttribute("FxPulse", 1)
end

BUILD.rainbow = function(ball, r, _look)
	local v = inner(ball, r, 0.85)
	local rainbow = seq(Color3.fromRGB(255, 70, 70), Color3.fromRGB(255, 200, 40), Color3.fromRGB(60, 230, 90), Color3.fromRGB(40, 170, 255), Color3.fromRGB(190, 80, 255))
	emitter(v, { Name = "Glitter", Texture = TEX.sparkle, Color = rainbow, Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(0.5, r * 0.16), NumberSequenceKeypoint.new(1, 0) }), Transparency = NumberSequence.new(0), Lifetime = NumberRange.new(0.6, 1.2), Rate = 30, RotSpeed = NumberRange.new(-200, 200), LightEmission = 1, Brightness = 4 })
	ball:SetAttribute("FxRainbow", 1)
end

BUILD.stardust = function(ball, r, look)
	-- Twinkles on and just over the glass.
	local v = inner(ball, r, 1.05)
	emitter(v, { Name = "Stardust", Texture = TEX.sparkle, Color = seq(white, look.accent or white), Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(0.5, r * 0.22), NumberSequenceKeypoint.new(1, 0) }), Transparency = NumberSequence.new(0), Lifetime = NumberRange.new(0.5, 0.9), Rate = 9, RotSpeed = NumberRange.new(-120, 120), LightEmission = 1, Brightness = 4, ShapeStyle = Enum.ParticleEmitterShapeStyle.Surface })
end

BUILD.aurora = function(ball, r, look)
	local v = inner(ball, r, 0.7)
	emitter(v, { Name = "AuroraVeils", Texture = TEX.smoke, Color = seq(look.accent, look.accent2 or Color3.fromRGB(120, 100, 255), look.accent), Size = NumberSequence.new(r * 0.7), Transparency = fade(0.55, 0.3, 0.7), Lifetime = NumberRange.new(2, 3), Rate = 5, RotSpeed = NumberRange.new(-30, 30), Rotation = NumberRange.new(0, 360), LightEmission = 1, Brightness = 2 })
	light(ball, look.accent, r * 7, 1.6)
	ball:SetAttribute("FxRainbow", 0.3)
end

BUILD.wisps = function(ball, r, look)
	local v = inner(ball, r, 0.7)
	emitter(v, { Name = "Wisps", Texture = TEX.smoke, Color = seq(white, look.accent or Color3.fromRGB(180, 220, 255)), Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, r * 0.2), NumberSequenceKeypoint.new(1, r * 0.7) }), Transparency = fade(0.35, 0.3, 0.6), Lifetime = NumberRange.new(1.5, 2.5), Rate = 7, Speed = NumberRange.new(r * 0.15), SpreadAngle = Vector2.new(180, 180), RotSpeed = NumberRange.new(-60, 60), LightEmission = 0.6, Brightness = 2 })
	ball:SetAttribute("FxFade", 1)
end

BUILD.glint = function(ball, r, _look)
	local v = inner(ball, r, 1.02)
	emitter(v, { Name = "Glints", Texture = TEX.sparkle, Color = seq(white), Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(0.5, r * 0.35), NumberSequenceKeypoint.new(1, 0) }), Transparency = NumberSequence.new(0), Lifetime = NumberRange.new(0.25, 0.4), Rate = 2.5, LightEmission = 1, Brightness = 6, ShapeStyle = Enum.ParticleEmitterShapeStyle.Surface })
end

BUILD.coins = function(ball, r, look)
	local v = inner(ball, r, 0.9)
	emitter(v, { Name = "GoldGlitter", Texture = TEX.sparkle, Color = seq(Color3.fromRGB(255, 240, 160), look.base or Color3.fromRGB(255, 200, 60)), Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(0.5, r * 0.18), NumberSequenceKeypoint.new(1, 0) }), Transparency = NumberSequence.new(0), Lifetime = NumberRange.new(0.6, 1), Rate = 14, LightEmission = 1, Brightness = 4, ShapeStyle = Enum.ParticleEmitterShapeStyle.Surface })
end

BUILD.spores = function(ball, r, look)
	local v = inner(ball, r, 0.75)
	emitter(v, { Name = "Spores", Texture = TEX.glow, Color = seq(look.accent2 or white, look.accent), Size = NumberSequence.new(r * 0.08), Transparency = fade(0.1, 0.3, 0.7), Lifetime = NumberRange.new(2, 3), Rate = 8, Speed = NumberRange.new(r * 0.05, r * 0.12), SpreadAngle = Vector2.new(180, 180), LightEmission = 1, Brightness = 3 })
end

BUILD.sunrays = function(ball, r, look)
	neonCore(ball, r, look.accent2 or Color3.fromRGB(255, 220, 140), 0.3)
	light(ball, look.accent, r * 8, 2)
	ball:SetAttribute("FxPulse", 0.5)
end

BUILD.crystals = function(ball, r, look)
	-- Shards of neon crystal pointing in from the glass, like a cut geode.
	local rng = Random.new(#tostring(look.id) * 31 + 7)
	for _ = 1, 7 do
		local dir = rng:NextUnitVector()
		local len = r * rng:NextNumber(0.35, 0.6)
		local p = Instance.new("Part")
		p.Name = "Crystal"
		p.Size = Vector3.new(r * 0.12, r * 0.12, len)
		p.Color = look.effectColor or look.accent
		p.Material = Enum.Material.Neon
		p.CanCollide, p.CanQuery, p.CanTouch, p.Massless, p.CastShadow = false, false, false, true, false
		local at = ball.Position + dir * (r * 0.85 - len / 2)
		p.CFrame = CFrame.lookAt(at, ball.Position)
		local w = Instance.new("Weld")
		w.Part0, w.Part1 = ball, p
		w.C0 = ball.CFrame:ToObjectSpace(p.CFrame)
		w.Parent = p
		p.Parent = ball
	end
	light(ball, look.effectColor or look.accent, r * 6, 1.5)
end

BUILD.aura = function(ball, r, look)
	local col = look.ui or look.accent or white
	local hl = Instance.new("Highlight")
	hl.Name = "Aura"
	hl.FillColor = col
	hl.FillTransparency = 0.82
	hl.OutlineColor = col
	hl.OutlineTransparency = 0.1
	hl.DepthMode = Enum.HighlightDepthMode.Occluded
	hl.Parent = ball
	-- A soft halo of light round it.
	local v = inner(ball, r, 1.15)
	emitter(v, { Name = "Halo", Texture = TEX.glow, Color = seq(col), Size = NumberSequence.new(r * 2.6), Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.5, 0.82), NumberSequenceKeypoint.new(1, 1) }), Lifetime = NumberRange.new(1.2), Rate = 2, LockedToPart = true, ShapeStyle = Enum.ParticleEmitterShapeStyle.Volume, LightEmission = 1, Brightness = 1, ZOffset = -1 })
	ball:SetAttribute("FxAura", 1)
end

BUILD.orbit = function(ball, r, look)
	-- Three little moons circling the marble, moved by the animator.
	local col = look.ui or look.accent or white
	for i = 1, 3 do
		local m = Instance.new("Part")
		m.Name = "Moon" .. i
		m.Shape = Enum.PartType.Ball
		m.Size = Vector3.one * r * 0.26
		m.Color = if i == 2 then white else col
		m.Material = Enum.Material.Neon
		m.Anchored = true
		m.CanCollide, m.CanQuery, m.CanTouch, m.CastShadow = false, false, false, false
		m.CFrame = ball.CFrame * CFrame.new(r * 1.6, 0, 0)
		m.Parent = ball
		local a0 = Instance.new("Attachment")
		a0.Position = Vector3.new(0, m.Size.Y * 0.3, 0)
		a0.Parent = m
		local a1 = Instance.new("Attachment")
		a1.Position = Vector3.new(0, -m.Size.Y * 0.3, 0)
		a1.Parent = m
		local t = Instance.new("Trail")
		t.Attachment0, t.Attachment1 = a0, a1
		t.Color = seq(m.Color)
		t.Lifetime = 0.35
		t.LightEmission = 1
		t.Transparency = NumberSequence.new(0.2, 1)
		t.FaceCamera = true
		t.Parent = m
	end
	ball:SetAttribute("FxOrbit", r)
end

--- Dress `ball` (radius r) with the look's effects. Returns the list applied.
function MarbleFX.apply(ball: BasePart, look: any, r: number): { string }
	local list = MarbleFX.forLook(look)
	if #list == 0 then
		return list
	end
	local l = table.clone(look)
	l.accent = l.accent or l.core or white
	l.accent2 = l.accent2 or l.accent
	for _, f in ipairs(list) do
		local b = BUILD[f]
		if b then
			b(ball, r, l)
		end
	end
	-- Roblox sorts a see-through shell over whatever is inside it, so particles and bolts inside
	-- the glass would vanish: draw them a marble's radius nearer the camera, which puts them in
	-- front of the shell without moving them out of it on screen.
	for _, d in ipairs(ball:GetDescendants()) do
		if d:IsA("Beam") then
			d.ZOffset = r * 1.1
		elseif d:IsA("ParticleEmitter") and d.Parent and d.Parent.Name:match("^FxVolume") then
			local scale = tonumber(d.Parent.Name:match("%d+")) or 100
			if scale < 100 and d.ZOffset == 0 then
				d.ZOffset = r * 1.1
			end
		end
	end
	ball:SetAttribute("Fx", table.concat(list, ","))
	CollectionService:AddTag(ball, "MarbleFX")
	return list
end

-- ---- The animator (client) --------------------------------------------------------------------

local started = false
--- Drive the moving effects of every tagged marble: bolts re-strike, moons orbit, auras pulse,
--- rainbows shift. Call once on the client.
function MarbleFX.animate()
	if started or not RunService:IsClient() then
		return
	end
	started = true
	local rng = Random.new()
	local nextStrike = 0
	RunService.RenderStepped:Connect(function()
		local t = os.clock()
		local strike = t >= nextStrike
		if strike then
			nextStrike = t + 0.07
		end
		for _, ball in ipairs(CollectionService:GetTagged("MarbleFX")) do
			if not ball:IsA("BasePart") or not ball:IsDescendantOf(game) then
				continue
			end
			local r = ball.Size.X / 2
			local bolts = ball:GetAttribute("FxBolts")
			if bolts and strike then
				for i = 1, bolts do
					local show = rng:NextNumber() < 0.75
					for k = 1, BOLT_SEGS do
						local seg = ball:FindFirstChild("Bolt" .. i .. "_" .. k) :: BasePart?
						if seg then
							seg.LocalTransparencyModifier = if show then 0 else 1
						end
					end
					if show then
						placeBolt(ball, i, boltPath(r, rng))
					end
				end
			end
			local orbit = ball:GetAttribute("FxOrbit")
			if orbit then
				for i = 1, 3 do
					local m = ball:FindFirstChild("Moon" .. i) :: BasePart?
					if m then
						local a = t * (1.6 + i * 0.25) + i * 2.09
						local tilt = CFrame.Angles(0.5 * i, 0, 0.35 * (i - 2))
						m.CFrame = CFrame.new(ball.Position) * tilt * CFrame.new(math.cos(a) * orbit * 1.65, 0, math.sin(a) * orbit * 1.65)
					end
				end
			end
			local pulse = ball:GetAttribute("FxPulse")
			if pulse then
				local l = ball:FindFirstChildOfClass("PointLight")
				if l then
					if not l:GetAttribute("Base") then
						l:SetAttribute("Base", l.Brightness)
					end
					l.Brightness = l:GetAttribute("Base") * (1 + pulse * 0.45 * math.sin(t * 4))
				end
			end
			if ball:GetAttribute("FxAura") then
				local hl = ball:FindFirstChild("Aura") :: Highlight?
				if hl then
					hl.OutlineTransparency = 0.15 + 0.25 * (0.5 + 0.5 * math.sin(t * 3))
				end
			end
			local rainbow = ball:GetAttribute("FxRainbow")
			if rainbow then
				local hl = ball:FindFirstChild("Aura") :: Highlight?
				local c = Color3.fromHSV((t * 0.15) % 1, 0.7, 1)
				if hl then
					hl.OutlineColor = c
				end
				if rainbow >= 1 then
					local l = ball:FindFirstChildOfClass("PointLight")
					if l then
						l.Color = c
					end
				end
			end
			if ball:GetAttribute("FxFade") then
				ball.LocalTransparencyModifier = 0.25 + 0.25 * math.sin(t * 1.7)
			end
		end
	end)
end

return MarbleFX
