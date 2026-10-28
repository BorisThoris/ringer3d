-- Build a marble: a ball for the physics, with a smaller glowing core inside the glassy ones
-- (a cat's eye), plus an optional trail. Used for the ring's marbles and for shop previews.

local Config = require(script.Parent.Config)

local MarbleLook = {}

function MarbleLook.make(look: Config.Marble, radius: number, physics: { density: number, friction: number, elasticity: number }?): BasePart
	local ball = Instance.new("Part")
	ball.Shape = Enum.PartType.Ball
	ball.Size = Vector3.new(radius * 2, radius * 2, radius * 2)
	ball.Color = look.shell
	ball.Material = look.material
	ball.Transparency = look.transparency
	ball.Reflectance = look.material == Enum.Material.Glass and 0.15 or 0
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
	return ball
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
