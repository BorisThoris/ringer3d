-- Build a marble: a ball for the physics, with a smaller glowing core inside the glassy ones
-- (a cat's eye), plus an optional trail. Used for the ring's marbles and for shop previews.

local Config = require(script.Parent.Config)
local Forge = require(script.Parent.Forge)

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

local function forgedLook(c: Forge.Collectible)
	local m = c.marble
	local opaque = m.pattern == "solid" or m.pattern == "steelie"
	local material = if m.pattern == "steelie" then Enum.Material.Metal elseif m.pattern == "solid" then (if m.finish == "metallic" then Enum.Material.Metal else Enum.Material.SmoothPlastic) else FINISH_MATERIAL[m.finish]
	return {
		id = c.id,
		name = m.name,
		rarity = c.tier,
		shell = Color3.fromHex(m.base),
		core = Color3.fromHex(m.accent),
		accent2 = Color3.fromHex(m.accent2),
		material = material,
		-- Roblox glass reads clearer than the web's, so clarity maps to a little less see-through.
		transparency = if opaque then 0 else math.clamp(m.clarity * 0.6, 0.05, 0.6),
		reflect = FINISH_REFLECT[m.finish],
		glow = m.glow,
		sparkle = m.sparkle,
		effect = m.effect,
		effectColor = Color3.fromHex(m.effectColor),
		shiny = c.shiny,
		collectible = c,
	}
end

--- The look for any marble id: a named marble from the catalogue, or a generated collectible.
function MarbleLook.lookFor(id: string?): any
	if id and Config.MARBLE[id] then
		return Config.MARBLE[id]
	end
	local c = id and Forge.fromId(id)
	if c then
		return forgedLook(c)
	end
	return Config.MARBLE.ember
end

function MarbleLook.make(look: any, radius: number, physics: { density: number, friction: number, elasticity: number }?): BasePart
	local ball = Instance.new("Part")
	ball.Shape = Enum.PartType.Ball
	ball.Size = Vector3.new(radius * 2, radius * 2, radius * 2)
	ball.Color = look.shell
	ball.Material = look.material
	ball.Transparency = look.transparency
	ball.Reflectance = look.reflect or (look.material == Enum.Material.Glass and 0.15 or 0)
	ball.TopSurface = Enum.SurfaceType.Smooth
	ball.BottomSurface = Enum.SurfaceType.Smooth
	ball.CastShadow = true
	if physics then
		ball.CustomPhysicalProperties = PhysicalProperties.new(physics.density, physics.friction, physics.elasticity, 1, 1)
	end
	ball:SetAttribute("MarbleId", look.id)

	if look.transparency > 0 then
		local core = Instance.new("Part")
		core.Name = "Core"
		core.Shape = Enum.PartType.Ball
		local r = radius * 1.1
		core.Size = Vector3.new(r, r, r)
		core.Color = look.core
		core.Material = look.glow > 0.5 and Enum.Material.Neon or Enum.Material.SmoothPlastic
		core.CanCollide = false
		core.CanQuery = false
		core.CanTouch = false
		core.Massless = true
		core.CastShadow = false
		core.CFrame = ball.CFrame
		core.Parent = ball
		local weld = Instance.new("WeldConstraint")
		weld.Part0 = ball
		weld.Part1 = core
		weld.Parent = core
		if look.glow > 0.3 then
			local light = Instance.new("PointLight")
			light.Color = look.core
			light.Range = radius * 6
			light.Brightness = look.glow * 1.5
			light.Shadows = false
			light.Parent = core
		end
	end
	MarbleLook.decorate(ball, look, radius)
	return ball
end

--- Phenomena, glitter and Shiny on a generated marble, from Roblox's built-in effects.
function MarbleLook.decorate(ball: BasePart, look: any, radius: number)
	local fx = look.effect
	local c = look.effectColor
	if fx and fx ~= "none" then
		local holder = ball:FindFirstChild("Core") or ball
		local light = Instance.new("PointLight")
		light.Color = c
		light.Range = radius * 7
		light.Brightness = 2
		light.Shadows = false
		light.Parent = holder
		if fx == "inferno" then
			local f = Instance.new("Fire")
			f.Color = c
			f.SecondaryColor = look.core
			f.Size = radius * 1.4
			f.Heat = 0
			f.Parent = holder
		elseif fx == "storm" then
			local sm = Instance.new("Smoke")
			sm.Color = c
			sm.Opacity = 0.25
			sm.Size = radius * 0.8
			sm.RiseVelocity = 0
			sm.Parent = holder
			local sp = Instance.new("Sparkles")
			sp.SparkleColor = Color3.new(1, 1, 1)
			sp.Parent = holder
		elseif fx == "starfall" or fx == "aurora" then
			local sp = Instance.new("Sparkles")
			sp.SparkleColor = c
			sp.Parent = holder
		elseif fx == "void" then
			if holder ~= ball then
				(holder :: BasePart).Color = Color3.new(0, 0, 0)
				;(holder :: BasePart).Material = Enum.Material.SmoothPlastic
			end
			light.Brightness = 3
		elseif fx == "geode" and holder ~= ball then
			(holder :: BasePart).Material = Enum.Material.Neon
			;(holder :: BasePart).Color = c
		end
	end
	if look.shiny or (look.sparkle or 0) >= 0.7 then
		local sp = Instance.new("Sparkles")
		sp.SparkleColor = if look.shiny then Color3.fromRGB(255, 240, 200) else look.core
		sp.Parent = ball
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
