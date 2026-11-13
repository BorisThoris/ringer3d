-- The lobby's world past the plaza, a toy-box park: rolling hills on the horizon, a rainbow over
-- them, puffy clouds, paths out across the lawn with lamp posts, bunting strung over the plaza,
-- flower beds, two fountains, giant bouncy mushrooms, balloons by the spawn, and butterflies.
-- The client makes it move (ClientModules/LobbyFun: clouds drift, balloons bob, mushrooms
-- bounce you, coins to pick up). Nothing here takes part in a match.

local Workspace = game:GetService("Workspace")

local LobbyWorld = {}

local rgb = Color3.fromRGB
local TOY = { rgb(255, 90, 90), rgb(255, 205, 50), rgb(70, 200, 120), rgb(70, 160, 255), rgb(170, 100, 255), rgb(255, 140, 200), rgb(255, 150, 60) }

local function part(parent: Instance, props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	p.CanCollide = false
	p.CanTouch = false
	p.CanQuery = false
	for k, v in pairs(props) do
		(p :: any)[k] = v
	end
	p.Parent = parent
	return p
end

local function ball(parent: Instance, at: Vector3, size: Vector3, color: Color3, name: string?, material: Enum.Material?)
	local p = part(parent, { Name = name or "Ball", Size = size, CFrame = CFrame.new(at), Color = color, Material = material or Enum.Material.SmoothPlastic })
	local m = Instance.new("SpecialMesh")
	m.MeshType = Enum.MeshType.Sphere
	m.Parent = p
	return p
end

local function upright(parent: Instance, at: Vector3, radius: number, height: number, color: Color3, name: string?, material: Enum.Material?)
	return part(parent, {
		Name = name or "Post",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(height, radius * 2, radius * 2),
		CFrame = CFrame.new(at + Vector3.new(0, height / 2, 0)) * CFrame.Angles(0, 0, math.pi / 2),
		Color = color,
		Material = material or Enum.Material.SmoothPlastic,
	})
end

--- A beam of `thick` from a to b.
local function rod(parent: Instance, a: Vector3, b: Vector3, thick: number, color: Color3, name: string?)
	return part(parent, { Name = name or "Rod", Size = Vector3.new(thick, thick, (b - a).Magnitude), CFrame = CFrame.lookAt((a + b) / 2, b), Color = color })
end

local function flower(parent: Instance, at: Vector3, color: Color3, h: number)
	part(parent, { Name = "Stem", Size = Vector3.new(0.25, h, 0.25), CFrame = CFrame.new(at + Vector3.new(0, h / 2, 0)), Color = rgb(70, 170, 70), CastShadow = false })
	ball(parent, at + Vector3.new(0, h + 0.2, 0), Vector3.new(1.5, 0.7, 1.5), color, "Petals")
	ball(parent, at + Vector3.new(0, h + 0.45, 0), Vector3.new(0.6, 0.4, 0.6), rgb(255, 230, 90), "Middle")
end

-- ---- The horizon ------------------------------------------------------------------------------

local function hills(rng: Random)
	local T = Workspace.Terrain
	for i = 0, 23 do
		local a = i / 24 * math.pi * 2 + rng:NextNumber(-0.1, 0.1)
		local d = rng:NextNumber(185, 230)
		local r = rng:NextNumber(34, 58)
		T:FillBall(Vector3.new(math.cos(a) * d, -r * 0.45, math.sin(a) * d), r, Enum.Material.Grass)
	end
	-- A second, taller row behind, so the skyline rolls.
	for i = 0, 15 do
		local a = (i + 0.5) / 16 * math.pi * 2
		local d = rng:NextNumber(255, 290)
		local r = rng:NextNumber(55, 80)
		T:FillBall(Vector3.new(math.cos(a) * d, -r * 0.35, math.sin(a) * d), r, if i % 3 == 0 then Enum.Material.LeafyGrass else Enum.Material.Grass)
	end
end

local function rainbow(parent: Instance)
	local folder = Instance.new("Model")
	folder.Name = "Rainbow"
	local bands = { rgb(255, 80, 80), rgb(255, 160, 60), rgb(255, 230, 70), rgb(90, 210, 100), rgb(70, 160, 255), rgb(150, 100, 255) }
	local centre = Vector3.new(0, -12, -235)
	local segs = 28
	for b, color in ipairs(bands) do
		local r = 120 - (b - 1) * 7
		for i = 0, segs - 1 do
			local a1, a2 = i / segs * math.pi, (i + 1) / segs * math.pi
			local p1 = centre + Vector3.new(math.cos(a1) * r, math.sin(a1) * r, 0)
			local p2 = centre + Vector3.new(math.cos(a2) * r, math.sin(a2) * r, 0)
			local seg = rod(folder, p1, p2, 7, color, "Band")
			seg.Size = Vector3.new(7.2, 2, (p2 - p1).Magnitude * 1.06)
			seg.CFrame = CFrame.lookAt((p1 + p2) / 2, p2, Vector3.new(0, 0, 1))
			seg.Transparency = 0.18
			seg.CastShadow = false
		end
	end
	folder.Parent = parent
end

local function clouds(parent: Instance, rng: Random)
	local model = Instance.new("Model")
	model.Name = "Clouds"
	for i = 0, 13 do
		local a = i / 14 * math.pi * 2 + rng:NextNumber(-0.2, 0.2)
		local d = rng:NextNumber(110, 210)
		local at = Vector3.new(math.cos(a) * d, rng:NextNumber(75, 115), math.sin(a) * d)
		local n = rng:NextInteger(4, 6)
		for k = 1, n do
			local s = rng:NextNumber(12, 22)
			local off = Vector3.new((k - n / 2) * s * 0.55, rng:NextNumber(-2, 4), rng:NextNumber(-5, 5))
			local c = ball(model, at + off, Vector3.new(s * 1.2, s * 0.8, s), rgb(255, 255, 255), "Puff")
			c.CastShadow = false
		end
	end
	model.WorldPivot = CFrame.new()
	model.Parent = parent
end

-- ---- The park ---------------------------------------------------------------------------------

local PATH_ANGLES = { 0, math.pi / 2, math.pi, math.pi * 1.5 }

local function paths(parent: Instance)
	for k, a in ipairs(PATH_ANGLES) do
		local dir = Vector3.new(math.cos(a), 0, math.sin(a))
		local side = Vector3.new(-dir.Z, 0, dir.X)
		-- Big round stepping stones in toy colours, then lamp posts down both sides.
		local i = 0
		for d = 49, 106, 5.2 do
			i += 1
			local at = dir * d + side * (if i % 2 == 0 then 0.8 else -0.8)
			part(parent, { Name = "Step", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.3, 4.4, 4.4), CFrame = CFrame.new(at + Vector3.new(0, 0.05, 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = TOY[(i + k) % #TOY + 1], CanCollide = true })
		end
		for d = 56, 104, 16 do
			for _, s in ipairs({ -1, 1 }) do
				local at = dir * d + side * s * 6
				upright(parent, at, 0.35, 9, rgb(60, 60, 80), "LampPost", Enum.Material.Metal)
				local bulb = ball(parent, at + Vector3.new(0, 9.6, 0), Vector3.new(2, 2, 2), rgb(255, 245, 210), "Lamp", Enum.Material.Neon)
				local light = Instance.new("PointLight")
				light.Range = 12
				light.Brightness = 0.6
				light.Color = rgb(255, 235, 190)
				light.Parent = bulb
				ball(parent, at + Vector3.new(0, 10.6, 0), Vector3.new(2.6, 0.8, 2.6), rgb(60, 60, 80), "Cap")
			end
		end
	end
end

local function bunting(parent: Instance)
	local poles = {}
	for i = 0, 7 do
		local a = math.pi / 8 + i / 8 * math.pi * 2
		local at = Vector3.new(math.cos(a) * 49, 0, math.sin(a) * 49)
		upright(parent, at, 0.45, 15, rgb(255, 255, 255), "Pole")
		ball(parent, at + Vector3.new(0, 15.6, 0), Vector3.new(1.6, 1.6, 1.6), TOY[i % #TOY + 1], "Knob")
		table.insert(poles, at + Vector3.new(0, 14.5, 0))
	end
	for i = 1, #poles do
		local a, b = poles[i], poles[i % #poles + 1]
		local n = 12
		local prev = a
		for k = 1, n do
			local t = k / n
			local sag = math.sin(t * math.pi) * 4
			local p = a:Lerp(b, t) - Vector3.new(0, sag, 0)
			rod(parent, prev, p, 0.12, rgb(255, 255, 255), "String").CastShadow = false
			if k < n then
				local flag = Instance.new("WedgePart")
				flag.Name = "Flag"
				flag.Anchored, flag.CanCollide, flag.CanTouch, flag.CanQuery = true, false, false, false
				flag.Size = Vector3.new(0.25, 2.2, 1.8)
				flag.Color = TOY[(i + k) % #TOY + 1]
				-- The wedge's point hangs down, its broad edge on the string.
				local along = (b - a).Unit
				-- Turned over about the string: the wedge's flat bottom on top, its point hanging.
				local c = p - Vector3.new(0, 1.1, 0)
				flag.CFrame = CFrame.lookAt(c, c + along) * CFrame.Angles(0, 0, math.pi)
				flag.Material = Enum.Material.SmoothPlastic
				flag.CastShadow = false
				flag.Parent = parent
			end
			prev = p
		end
	end
end

local function flowerBeds(parent: Instance, rng: Random)
	for i = 0, 47 do
		local a = (i + 0.5) / 48 * math.pi * 2
		local nearPath = false
		for _, pa in ipairs(PATH_ANGLES) do
			if math.abs(math.atan2(math.sin(a - pa), math.cos(a - pa))) < 0.12 then
				nearPath = true
			end
		end
		if nearPath then
			continue
		end
		local d = rng:NextNumber(47.5, 51)
		local c = Vector3.new(math.cos(a) * d, 0, math.sin(a) * d)
		local color = TOY[rng:NextInteger(1, #TOY)]
		for _ = 1, 3 do
			flower(parent, c + Vector3.new(rng:NextNumber(-1.4, 1.4), 0, rng:NextNumber(-1.4, 1.4)), color, rng:NextNumber(1.2, 2.2))
		end
	end
	-- Wild flowers dotted over the lawn.
	for _ = 1, 60 do
		local a = rng:NextNumber() * math.pi * 2
		local d = rng:NextNumber(58, 108)
		flower(parent, Vector3.new(math.cos(a) * d, 0, math.sin(a) * d), TOY[rng:NextInteger(1, #TOY)], rng:NextNumber(0.8, 1.6))
	end
end

local function fountain(parent: Instance, at: Vector3)
	local m = Instance.new("Model")
	m.Name = "Fountain"
	part(m, { Name = "Basin", Shape = Enum.PartType.Cylinder, Size = Vector3.new(2, 11, 11), CFrame = CFrame.new(at + Vector3.new(0, 1, 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = rgb(255, 255, 255), CanCollide = true })
	part(m, { Name = "Water", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.2, 9.6, 9.6), CFrame = CFrame.new(at + Vector3.new(0, 2.02, 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = rgb(90, 190, 255), Material = Enum.Material.Glass, Transparency = 0.25, Reflectance = 0.15 })
	upright(m, at, 0.9, 5.5, rgb(255, 255, 255), "Column")
	part(m, { Name = "Bowl", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.8, 4.6, 4.6), CFrame = CFrame.new(at + Vector3.new(0, 5.6, 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = rgb(255, 255, 255) })
	local top = ball(m, at + Vector3.new(0, 7.2, 0), Vector3.new(2.6, 2.6, 2.6), rgb(90, 190, 255), "Marble", Enum.Material.Glass)
	top.Transparency = 0.15
	local spout = part(m, { Name = "Spout", Size = Vector3.new(0.5, 0.5, 0.5), CFrame = CFrame.new(at + Vector3.new(0, 8.4, 0)), Transparency = 1 })
	local e = Instance.new("ParticleEmitter")
	e.Texture = "rbxasset://textures/particles/sparkles_main.dds"
	e.Color = ColorSequence.new(rgb(220, 245, 255), rgb(120, 200, 255))
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.45), NumberSequenceKeypoint.new(1, 0.25) })
	e.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.1), NumberSequenceKeypoint.new(0.85, 0.2), NumberSequenceKeypoint.new(1, 1) })
	e.Lifetime = NumberRange.new(1, 1.3)
	e.Rate = 70
	e.Speed = NumberRange.new(13, 16)
	e.SpreadAngle = Vector2.new(14, 14)
	e.Acceleration = Vector3.new(0, -32, 0)
	e.EmissionDirection = Enum.NormalId.Top
	e.LightEmission = 0.4
	e.Parent = spout
	-- Bubbles rising off the pool.
	local pool = part(m, { Name = "Pool", Size = Vector3.new(8, 0.2, 8), CFrame = CFrame.new(at + Vector3.new(0, 2.1, 0)), Transparency = 1 })
	local b = Instance.new("ParticleEmitter")
	b.Texture = "rbxasset://textures/particles/sparkles_main.dds"
	b.Color = ColorSequence.new(rgb(255, 255, 255), rgb(255, 180, 230))
	b.Size = NumberSequence.new(0.3, 0.6)
	b.Transparency = NumberSequence.new(0.2, 1)
	b.Lifetime = NumberRange.new(1.5, 2.5)
	b.Rate = 6
	b.Speed = NumberRange.new(1.5, 3)
	b.EmissionDirection = Enum.NormalId.Top
	b.Parent = pool
	m.Parent = parent
end

--- A giant mushroom you bounce on: its cap carries a "Bounce" attribute the client acts on.
local function mushroom(parent: Instance, at: Vector3, color: Color3, rng: Random)
	local m = Instance.new("Model")
	m.Name = "Mushroom"
	upright(m, at, 2, 6, rgb(255, 245, 225), "Stalk")
	local cap = ball(m, at + Vector3.new(0, 6.6, 0), Vector3.new(13, 5.5, 13), color, "Cap")
	cap.CanCollide = true
	cap.CanTouch = true
	cap:SetAttribute("Bounce", 95)
	for i = 0, 6 do
		local a = i / 7 * math.pi * 2 + rng:NextNumber(-0.2, 0.2)
		local r = if i == 0 then 0 else rng:NextNumber(3, 4.6)
		local x, z = math.cos(a) * r, math.sin(a) * r
		-- On the dome's surface: y from the ellipsoid.
		local y = 2.75 * math.sqrt(math.max(0, 1 - (r / 6.5) ^ 2))
		ball(m, at + Vector3.new(x, 6.6 + y, z), Vector3.new(2, 0.7, 2), rgb(255, 255, 255), "Dot")
	end
	m.Parent = parent
end

local function balloons(parent: Instance, at: Vector3, rng: Random)
	for i = 1, 5 do
		local top = at + Vector3.new(rng:NextNumber(-2.2, 2.2), rng:NextNumber(9, 13), rng:NextNumber(-2.2, 2.2))
		local m = Instance.new("Model")
		m.Name = "Balloon"
		local b = ball(m, top, Vector3.new(2.6, 3.2, 2.6), TOY[(i * 2) % #TOY + 1], "Skin")
		b.Material = Enum.Material.Glass
		b.Transparency = 0.05
		b.Reflectance = 0.1
		rod(m, at + Vector3.new(0, 1, 0), top - Vector3.new(0, 1.5, 0), 0.08, rgb(255, 255, 255), "String").CastShadow = false
		m:SetAttribute("Bob", i)
		m.WorldPivot = CFrame.new(at)
		m.Parent = parent
	end
	upright(parent, at, 0.5, 1, rgb(255, 255, 255), "Weight")
end

local function butterflies(parent: Instance)
	local p = part(parent, { Name = "Butterflies", Size = Vector3.new(200, 8, 200), CFrame = CFrame.new(0, 6, 0), Transparency = 1 })
	local e = Instance.new("ParticleEmitter")
	e.Shape = Enum.ParticleEmitterShape.Box
	e.Texture = "rbxasset://textures/particles/sparkles_main.dds"
	e.Color = ColorSequence.new({ ColorSequenceKeypoint.new(0, rgb(255, 120, 200)), ColorSequenceKeypoint.new(0.5, rgb(255, 230, 90)), ColorSequenceKeypoint.new(1, rgb(120, 200, 255)) })
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(0.2, 0.55), NumberSequenceKeypoint.new(0.8, 0.55), NumberSequenceKeypoint.new(1, 0) })
	e.Lifetime = NumberRange.new(6, 9)
	e.Rate = 14
	e.Speed = NumberRange.new(1, 2.5)
	e.SpreadAngle = Vector2.new(180, 180)
	e.RotSpeed = NumberRange.new(-120, 120)
	e.LightEmission = 0.6
	e.Parent = p
end

function LobbyWorld.build(lobby: Instance)
	local rng = Random.new(31)
	local world = Instance.new("Folder")
	world.Name = "World"
	hills(rng)
	rainbow(world)
	clouds(world, rng)
	paths(world)
	bunting(world)
	flowerBeds(world, rng)
	for _, a in ipairs({ math.rad(18), math.rad(198) }) do
		fountain(world, Vector3.new(math.cos(a) * 34, 0, math.sin(a) * 34))
	end
	for i = 0, 3 do
		local a = math.rad(30) + i * math.pi / 2
		mushroom(world, Vector3.new(math.cos(a) * 63, 0, math.sin(a) * 63), TOY[({ 1, 5, 6, 4 })[i + 1]], rng)
	end
	for _, x in ipairs({ -8, 8 }) do
		balloons(world, Vector3.new(x, 0, 45), rng)
	end
	butterflies(world)
	world.Parent = lobby
	return world
end

return LobbyWorld
