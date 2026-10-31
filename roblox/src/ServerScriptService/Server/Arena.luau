-- Build one table's field: the ground with a lighter disc inside the ring, the chalk ring, a
-- candy-striped bumper carried up as a wall you can't see (so no marble ever leaves the field:
-- the web game's 2026-10-28 lesson), toy-block backstops just outside the ring that can bounce
-- marbles back in, a podium for each player, and round toy trees beyond the bumper.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Ringer.Config)

local Arena = {}

local function part(props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for k, v in pairs(props) do
		(p :: any)[k] = v
	end
	return p
end

export type Built = { folder: Folder, origin: Vector3, stands: { CFrame } }

function Arena.build(origin: Vector3, arena: Config.Arena, seats: number, rng: Random, parent: Instance, hasMap: boolean?): Built
	local folder = Instance.new("Folder")
	folder.Name = "Field"
	local R, B = Config.RING_R, Config.BOUND_R

	-- Ground: one slab well past the kerb.
	local size = B * 2 + 40
	part({
		Name = "Ground",
		Size = Vector3.new(size, 4, size),
		CFrame = CFrame.new(origin - Vector3.new(0, 2, 0)),
		Material = arena.material,
		Color = arena.color,
		CustomPhysicalProperties = PhysicalProperties.new(2, arena.friction, 0.3, 1, 1),
		Parent = folder,
	})
	-- The lighter disc inside the ring: paint only, nothing touches it.
	part({
		Name = "Inner",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(0.04, R * 2, R * 2),
		CFrame = CFrame.new(origin + Vector3.new(0, 0.02, 0)) * CFrame.Angles(0, 0, math.pi / 2),
		Material = Enum.Material.SmoothPlastic,
		Color = arena.inner,
		CanCollide = false,
		CanQuery = false,
		CanTouch = false,
		CastShadow = false,
		Parent = folder,
	})

	-- The kerb ring, and the invisible wall standing on it.
	local segs = 64
	local segLen = 2 * math.pi * (B + 1) / segs * 1.08
	for i = 0, segs - 1 do
		local a = i / segs * math.pi * 2
		local at = origin + Vector3.new(math.cos(a) * (B + 1), 0, math.sin(a) * (B + 1))
		local facing = CFrame.lookAt(at, Vector3.new(origin.X, at.Y, origin.Z))
		part({
			Name = "Kerb",
			Size = Vector3.new(segLen, 2.4, 2),
			CFrame = facing * CFrame.new(0, 1.2, 0),
			Material = Enum.Material.SmoothPlastic,
			Color = arena.kerb[i % #arena.kerb + 1],
			CustomPhysicalProperties = PhysicalProperties.new(2, 0.4, 0.35, 1, 1),
			Parent = folder,
		})
		part({
			Name = "Wall",
			Size = Vector3.new(segLen, Config.EDGE_H, 2),
			CFrame = facing * CFrame.new(0, 2.4 + Config.EDGE_H / 2, 0),
			Transparency = 1,
			CastShadow = false,
			CustomPhysicalProperties = PhysicalProperties.new(2, 0.4, 0.35, 1, 1),
			Parent = folder,
		})
	end

	-- The chalk ring: flat segments that nothing touches.
	local lineSegs = 120
	local lineLen = 2 * math.pi * R / lineSegs * 1.05
	for i = 0, lineSegs - 1 do
		local a = i / lineSegs * math.pi * 2
		local at = origin + Vector3.new(math.cos(a) * R, 0.03, math.sin(a) * R)
		part({
			Name = "Line",
			Size = Vector3.new(lineLen, 0.06, 0.7),
			CFrame = CFrame.lookAt(at, Vector3.new(origin.X, at.Y, origin.Z)),
			Material = Enum.Material.SmoothPlastic,
			Color = arena.line,
			CanCollide = false,
			CanQuery = false,
			CanTouch = false,
			CastShadow = false,
			Parent = folder,
		})
	end

	-- Backstops just outside the ring, lying across the way out, the same at every seat. A
	-- generated map brings its own.
	local count = if hasMap then 0 else rng:NextInteger(1, 2) * 2
	local base = rng:NextNumber() * math.pi * 2
	local r = R + 6 + rng:NextNumber() * 7
	for k = 0, count - 1 do
		local a = base + k / count * math.pi * 2
		local at = origin + Vector3.new(math.cos(a) * r, arena.backstop.size.Y / 2, math.sin(a) * r)
		part({
			Name = arena.backstop.name,
			Size = arena.backstop.size,
			CFrame = CFrame.lookAt(at, Vector3.new(origin.X, at.Y, origin.Z)),
			Material = arena.backstop.material,
			Color = arena.backstop.colors[k % #arena.backstop.colors + 1],
			CustomPhysicalProperties = PhysicalProperties.new(3, 0.4, 0.55, 1, 1),
			Parent = folder,
		})
	end

	-- A stand for each seat, outside the kerb, facing the ring.
	local stands = {}
	for s = 1, seats do
		local a = math.pi / 2 + (s - 1) / seats * math.pi * 2
		local at = origin + Vector3.new(math.cos(a) * (B + 9), 0, math.sin(a) * (B + 9))
		part({
			Name = "Stand",
			Shape = Enum.PartType.Cylinder,
			Size = Vector3.new(1, 9, 9),
			CFrame = CFrame.new(at + Vector3.new(0, 0.5, 0)) * CFrame.Angles(0, 0, math.pi / 2),
			Material = Enum.Material.SmoothPlastic,
			Color = s == 1 and Color3.fromRGB(60, 150, 255) or Color3.fromRGB(255, 75, 75),
			Parent = folder,
		})
		table.insert(stands, CFrame.lookAt(at + Vector3.new(0, 4, 0), Vector3.new(origin.X, origin.Y + 4, origin.Z)))
	end

	-- Round toy trees beyond the bumper: a trunk and a ball, nothing a marble can reach.
	-- Their own Random, so the decor never shifts the table's dice; none behind a podium, where
	-- the player's camera sits.
	local decor = Random.new(math.floor(origin.X * 7 + origin.Z))
	for k = 0, 13 do
		local a = (k + 0.5) / 14 * math.pi * 2
		local clear = true
		for s = 1, seats do
			local sa = math.pi / 2 + (s - 1) / seats * math.pi * 2
			if math.abs(math.atan2(math.sin(a - sa), math.cos(a - sa))) < 0.6 then
				clear = false
			end
		end
		if not clear then
			continue
		end
		local d = B + 16 + decor:NextNumber() * 6
		local at = origin + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d)
		local h = 5 + decor:NextNumber() * 3
		part({ Name = "Trunk", Size = Vector3.new(1.4, h, 1.4), CFrame = CFrame.new(at + Vector3.new(0, h / 2, 0)), Material = Enum.Material.SmoothPlastic, Color = Color3.fromRGB(150, 95, 55), CanCollide = false, Parent = folder })
		local c = 7 + decor:NextNumber() * 3
		part({ Name = "Crown", Shape = Enum.PartType.Ball, Size = Vector3.new(c, c, c), CFrame = CFrame.new(at + Vector3.new(0, h + c * 0.35, 0)), Material = Enum.Material.SmoothPlastic, Color = arena.trees, CanCollide = false, Parent = folder })
	end

	folder.Parent = parent
	return { folder = folder, origin = origin, stands = stands }
end

return Arena
