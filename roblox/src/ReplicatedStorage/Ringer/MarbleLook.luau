-- Build a marble: a ball for the physics, a glass shell with the web game's interior inside it
-- (MarbleArt: blades, ribbons, flecks, bubbles), plus an optional trail. Used for the ring's
-- marbles and for shop previews.

local Config = require(script.Parent.Config)
local Forge = require(script.Parent.Forge)
local MarbleArt = require(script.Parent.MarbleArt)
local MarbleFX = require(script.Parent.MarbleFX)

local MarbleLook = {}

-- A generated marble's look: its colours, a material for its finish, the clarity of its glass,
-- and its phenomenon (drawn with Roblox's own Fire, Smoke, Sparkles and lights).
local FINISH_MATERIAL = {
	glass = Enum.Material.Glass,
	frosted = Enum.Material.Glass,
	pearl = Enum.Material.SmoothPlastic,
	metallic = Enum.Material.Metal,
	glitter = Enum.Material.Glass,
	holo = Enum.Material.Glass,
	prism = Enum.Material.Glass,
}
local FINISH_REFLECT = { glass = 0.15, frosted = 0.03, pearl = 0.25, metallic = 0.35, glitter = 0.2, holo = 0.4, prism = 0.3 }

local function lift(body: Color3, accent: Color3): Color3
	local h, sat, v = body:ToHSV()
	local mixed = body:Lerp(accent, if v < 0.35 then 0.55 else 0.2)
	local mh, ms, mv = mixed:ToHSV()
	return Color3.fromHSV(mh, math.max(ms, sat * 0.8), math.max(mv, 0.55))
end

local function forgedLook(c: Forge.Collectible)
	local m = c.marble
	local opaque = m.pattern == "solid" or m.pattern == "steelie"
	local material = if m.pattern == "steelie" then Enum.Material.Metal elseif m.pattern == "solid" then (if m.finish == "metallic" then Enum.Material.Metal else Enum.Material.SmoothPlastic) else FINISH_MATERIAL[m.finish]
	-- A phenomenon needs to be seen inside: Roblox draws no fire, smoke or inner parts through
	-- Glass, so these rare marbles get a smooth translucent shell (and a glow, in decorate).
	local phenomenon = m.effect ~= "none"
	if phenomenon then
		material = Enum.Material.SmoothPlastic
	end
	return {
		id = c.id,
		name = m.name,
		rarity = c.tier,
		-- Roblox glass multiplies what is behind it by its colour, so the web's near-black bodies
		-- (galaxy, neon, onyx) would read as black: lift the body toward its accent.
		shell = lift(Color3.fromHex(m.base), Color3.fromHex(m.accent)),
		core = Color3.fromHex(m.accent),
		accent2 = Color3.fromHex(m.accent2),
		material = material,
		-- Low, like the named glass marbles: clearer Roblox glass shows the sky, not the marble.
		-- Low, like the named glass marbles: clearer Roblox glass shows the sky, not the marble.
		transparency = if opaque then 0 elseif phenomenon then 0.45 else math.clamp(0.2 + m.clarity * 0.2, 0.2, 0.38),
		reflect = if phenomenon then 0.1 else FINISH_REFLECT[m.finish],
		glow = m.glow,
		sparkle = m.sparkle,
		effect = m.effect,
		effectColor = Color3.fromHex(m.effectColor),
		shiny = c.shiny,
		collectible = c,
		-- MarbleArt's fields (the web game's MarbleLook)
		pattern = m.pattern,
		base = Color3.fromHex(m.base),
		accent = Color3.fromHex(m.accent),
		clarity = m.clarity,
		finish = m.finish,
		shape = m.shape,
		ui = Color3.fromHex(m.ui),
	}
end

-- A named marble with its web-game drawing (Config.ART) folded in.
local named = {}
local function namedLook(m)
	local l = named[m.id]
	if not l then
		l = table.clone(m)
		local a = Config.ART[m.id]
		if a then
			for k, v in pairs(a) do
				l[k] = v
			end
		end
		named[m.id] = l
	end
	return l
end

--- A target marble ("mib") for ring slot `id`: the web's MIB_LOOKS[(id * 5) % 8].
function MarbleLook.mib(id: number): any
	local a = Config.MIB_LOOKS[(id * 5) % #Config.MIB_LOOKS + 1]
	return {
		id = a.id,
		name = "Mib",
		rarity = "Common",
		shell = a.base,
		core = a.accent,
		material = Enum.Material.Glass,
		transparency = 0.3,
		glow = a.glow,
		pattern = a.pattern,
		base = a.base,
		accent = a.accent,
		accent2 = a.accent2,
		clarity = a.clarity,
		ui = a.ui,
	}
end

--- The colour that stands for a marble in the aim guide and the interface (the web's uiColor).
function MarbleLook.uiColor(look: any): Color3
	return look and (look.ui or look.accent) or Color3.fromHex("#2f6bff")
end

--- The look for any marble id: a named marble from the catalogue, or a generated collectible.
function MarbleLook.lookFor(id: string?): any
	if id and Config.MARBLE[id] then
		return namedLook(Config.MARBLE[id])
	end
	local c = id and Forge.fromId(id)
	if c then
		return forgedLook(c)
	end
	return namedLook(Config.MARBLE.ember)
end

--- `seed` is the slot seed the web game builds the marble with (named marbles vary with it).
function MarbleLook.make(look: any, radius: number, physics: { density: number, friction: number, elasticity: number }?, seed: number?): BasePart
	local ball = Instance.new("Part")
	ball.Shape = Enum.PartType.Ball
	ball.Size = Vector3.new(radius * 2, radius * 2, radius * 2)
	ball.TopSurface = Enum.SurfaceType.Smooth
	ball.BottomSurface = Enum.SurfaceType.Smooth
	ball.CastShadow = true
	if physics then
		ball.CustomPhysicalProperties = PhysicalProperties.new(physics.density, physics.friction, physics.elasticity, 1, 1)
	end
	ball:SetAttribute("MarbleId", look.id)

	local pattern = look.pattern
	if pattern == "steelie" then
		-- Polished metal: nothing but reflection.
		ball.Color = look.base
		ball.Material = Enum.Material.Metal
		ball.Reflectance = 0.55
		ball.Transparency = 0
	elseif pattern == "solid" or (pattern and look.clarity < 0.05) then
		-- Clay: matte, speckled.
		ball.Color = look.base
		ball.Material = Enum.Material.Concrete
		ball.Reflectance = 0
		ball.Transparency = 0
	elseif pattern then
		-- Glass round the web game's interior. Roblox draws nothing inside Glass, so the shell is
		-- smooth, see-through and reflective.
		local color, transparency, reflect = MarbleArt.glass(look)
		ball.Color = color
		ball.Material = Enum.Material.SmoothPlastic
		ball.Transparency = transparency
		ball.Reflectance = reflect
		MarbleArt.build(ball, look, radius, seed)
		if (look.glow or 0) > 0.3 then
			local light = Instance.new("PointLight")
			light.Color = look.accent
			light.Range = radius * 6
			light.Brightness = look.glow * 1.2
			light.Shadows = false
			light.Parent = ball
		end
	else
		ball.Color = look.shell
		ball.Material = look.material
		ball.Transparency = look.transparency
		ball.Reflectance = look.reflect or 0
	end
	MarbleLook.decorate(ball, look, radius)
	return ball
end

--- The marble's effects (MarbleFX): what lives inside its glass, its aura and its moons. The
--- ring's target marbles stay clean.
function MarbleLook.decorate(ball: BasePart, look: any, radius: number)
	if look and look.name ~= "Mib" then
		MarbleFX.apply(ball, look, radius)
	end
end

--- A glowing trail behind a moving marble (the Trails pass).
function MarbleLook.addTrail(ball: BasePart, color: Color3)
	local r = ball.Size.X / 2
	local a0 = Instance.new("Attachment")
	a0.Position = Vector3.new(0, r * 0.6, 0)
	a0.Parent = ball
	local a1 = Instance.new("Attachment")
	a1.Position = Vector3.new(0, -r * 0.6, 0)
	a1.Parent = ball
	local trail = Instance.new("Trail")
	trail.Attachment0 = a0
	trail.Attachment1 = a1
	trail.Lifetime = 0.45
	trail.Color = ColorSequence.new(color, Color3.new(1, 1, 1))
	trail.Transparency = NumberSequence.new(0.2, 1)
	trail.LightEmission = 1
	trail.FaceCamera = true
	trail.Parent = ball
end

return MarbleLook
