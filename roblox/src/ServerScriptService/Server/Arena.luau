-- Build one table's field the way the web game builds it (src/render/arenaBuilder.ts, groundArt.ts):
-- the ground in its own material (varnished oak, concrete, mown lawn, sand, black ice, gravel,
-- turf), the bank along the edge of play from the web game's lathe profiles, the ring line in the
-- field's own style (cotton string, chalk, a groove drawn with a finger, a skate scratch), and the
-- scenery out past the bank: stacks of books, hedges, shrubs and tufts, marram grass and rocks,
-- snowy pines, boulders, a windmill. Above the bank stands a wall you can't see, so no marble ever
-- leaves the field. The light, fog and air of each field are the client's (ClientModules/Ambience).
-- Nothing here takes part in a shot: shots are played on Ringer.Sim.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Ringer.Config)

local Arena = {}

local S = Config.MAP_SCALE
local hex = Color3.fromHex

local function part(props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.CanCollide = false
	p.CanTouch = false
	p.CanQuery = false
	for k, v in pairs(props) do
		(p :: any)[k] = v
	end
	return p
end

--- A squashed ball (bush blob, rock, boulder): a sphere mesh scaled per axis.
local function blob(parent: Instance, at: CFrame, size: Vector3, color: Color3, material: Enum.Material, name: string?)
	local p = part({ Name = name or "Blob", Size = size, CFrame = at, Color = color, Material = material, Parent = parent })
	local m = Instance.new("SpecialMesh")
	m.MeshType = Enum.MeshType.Sphere
	m.Parent = p
	return p
end

local function cylinder(parent: Instance, at: Vector3, radius: number, height: number, color: Color3, material: Enum.Material, name: string?)
	return part({
		Name = name or "Cylinder",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(height, radius * 2, radius * 2),
		CFrame = CFrame.new(at) * CFrame.Angles(0, 0, math.pi / 2),
		Color = color,
		Material = material,
		Parent = parent,
	})
end

-- ---- The ground's own marks (groundArt.ts) ----------------------------------------------------

local GROUND_ART = {
	-- Mowing stripes, the broad light and dark bands of a cut lawn.
	grass = function(folder: Folder, origin: Vector3, half: number, _rng: Random)
		local w = 9
		local n = math.floor(half * 2 / w)
		for i = 0, n - 1, 2 do
			local x = -half + (i + 0.5) * w
			part({ Name = "Stripe", Size = Vector3.new(w, 0.04, half * 2), CFrame = CFrame.new(origin + Vector3.new(x, 0.01, 0)), Color = Color3.fromRGB(104, 178, 58), Material = Enum.Material.Grass, CastShadow = false, Parent = folder })
		end
	end,
	-- Black ice: white crack lines running across it, and drifts of snow blown onto it.
	ice = function(folder: Folder, origin: Vector3, half: number, rng: Random)
		for _ = 1, 9 do
			local at = Vector3.new(rng:NextNumber(-half, half) * 0.8, 0.015, rng:NextNumber(-half, half) * 0.8)
			local a = rng:NextNumber() * math.pi * 2
			for _ = 1, rng:NextInteger(4, 7) do
				a += rng:NextNumber(-0.7, 0.7)
				local len = rng:NextNumber(6, 16)
				local b = at + Vector3.new(math.cos(a) * len, 0, math.sin(a) * len)
				local mid = origin + (at + b) / 2
				part({ Name = "Crack", Size = Vector3.new(0.18, 0.02, len), CFrame = CFrame.lookAt(mid, mid + (b - at)), Color = hex("#cfe6f7"), Material = Enum.Material.SmoothPlastic, Transparency = 0.25, CastShadow = false, Parent = folder })
				at = b
			end
		end
		for _ = 1, 7 do
			local d = rng:NextNumber(Config.RING_R * 0.8, half * 0.95)
			local a = rng:NextNumber() * math.pi * 2
			local s = rng:NextNumber(4, 9)
			blob(folder, CFrame.new(origin + Vector3.new(math.cos(a) * d, -0.15, math.sin(a) * d)) * CFrame.Angles(0, rng:NextNumber() * 6, 0), Vector3.new(s * 1.6, 0.5, s), hex("#f2f7fb"), Enum.Material.Snow, "Drift")
		end
	end,
	-- Sand: wind ripples, low ridges a little darker than the sand.
	sand = function(folder: Folder, origin: Vector3, half: number, rng: Random)
		for i = -12, 12 do
			local z = i * 6.5 + rng:NextNumber(-1, 1)
			part({ Name = "Ripple", Size = Vector3.new(half * 2, 0.03, 0.5), CFrame = CFrame.new(origin + Vector3.new(0, 0.01, z)) * CFrame.Angles(0, rng:NextNumber(-0.05, 0.05), 0), Color = hex("#c7ad83"), Material = Enum.Material.Sand, Transparency = 0.6, CastShadow = false, Parent = folder })
		end
	end,
	-- The desk: a varnished board, so a soft sheen of the lamp on it.
	desk = function(folder: Folder, origin: Vector3, half: number, _rng: Random)
		part({ Name = "Varnish", Size = Vector3.new(half * 2, 0.02, half * 2), CFrame = CFrame.new(origin + Vector3.new(0, 0.005, 0)), Color = Color3.fromRGB(160, 98, 55), Material = Enum.Material.Glass, Transparency = 0.85, Reflectance = 0.08, CastShadow = false, Parent = folder })
	end,
}

-- ---- The bank: the web game's lathe profile, in studs ----------------------------------------

local function bank(folder: Folder, origin: Vector3, arena: Config.Arena)
	local B = Config.BOUND_R
	local prof = arena.bank.profile
	local segs = 96
	for i = 0, segs - 1 do
		local a = (i + 0.5) / segs * math.pi * 2
		local dir = Vector3.new(math.cos(a), 0, math.sin(a))
		local side = Vector3.new(-dir.Z, 0, dir.X)
		for k = 1, #prof - 1 do
			local r1, h1 = B + prof[k][1] * S, prof[k][2] * S
			local r2, h2 = B + prof[k + 1][1] * S, prof[k + 1][2] * S
			local p1 = origin + dir * r1 + Vector3.new(0, h1, 0)
			local p2 = origin + dir * r2 + Vector3.new(0, h2, 0)
			local len = (p2 - p1).Magnitude
			if len < 0.05 then
				continue
			end
			local width = 2 * math.pi * math.max(r1, r2) / segs * 1.12
			local t = 0.6
			-- A plank from p1 to p2, its face turned out of the bank, thickness pushed inward.
			local along = (p2 - p1).Unit
			local normal = along:Cross(side).Unit
			if normal.Y < 0 then
				normal = -normal
			end
			local mid = (p1 + p2) / 2 - normal * (t / 2)
			part({
				Name = "Bank",
				Size = Vector3.new(width, t, len),
				CFrame = CFrame.fromMatrix(mid, side, normal, -along),
				Color = arena.bank.color,
				Material = arena.bank.material,
				Parent = folder,
			})
		end
	end
	-- The mini-golf rail wears a red stripe along its top.
	if arena.id == "minigolf" then
		local top = prof[3][2] * S
		for i = 0, segs - 1 do
			local a = (i + 0.5) / segs * math.pi * 2
			local at = origin + Vector3.new(math.cos(a), 0, math.sin(a)) * (B + 0.24 * S) + Vector3.new(0, top - 0.3, 0)
			part({ Name = "RailStripe", Size = Vector3.new(2 * math.pi * (B + 2) / segs * 1.1, 0.3, 0.5 * S), CFrame = CFrame.lookAt(at, Vector3.new(origin.X, at.Y, origin.Z)), Color = hex("#e5323f"), Material = Enum.Material.SmoothPlastic, Parent = folder })
		end
	end
end

-- ---- The ring line ----------------------------------------------------------------------------

local function ringLine(folder: Folder, origin: Vector3, arena: Config.Arena)
	local R = Config.RING_R
	local style = arena.ring.style
	local n = 160
	local len = 2 * math.pi * R / n * 1.04
	for i = 0, n - 1 do
		local a = i / n * math.pi * 2
		local at = origin + Vector3.new(math.cos(a) * R, 0, math.sin(a) * R)
		-- lookAt points -Z at the centre, so X runs along the ring.
		local face = CFrame.lookAt(at, Vector3.new(origin.X, at.Y, origin.Z))
		if style == "string" then
			-- A loop of cotton string lying on the surface.
			part({ Name = "String", Shape = Enum.PartType.Cylinder, Size = Vector3.new(len, 0.36, 0.36), CFrame = face + Vector3.new(0, 0.16, 0), Color = arena.ring.color, Material = Enum.Material.Fabric, Parent = folder })
		elseif style == "drawn" then
			-- A groove drawn with a finger: wide, shadowed sand.
			part({ Name = "Groove", Size = Vector3.new(len, 0.03, 1.2), CFrame = face + Vector3.new(0, 0.012, 0), Color = arena.ring.color, Material = Enum.Material.Sand, Transparency = 0.35, CastShadow = false, Parent = folder })
		elseif style == "etched" then
			-- A skate's scratch in the ice.
			part({ Name = "Scratch", Size = Vector3.new(len, 0.03, 0.32), CFrame = face + Vector3.new(0, 0.012, 0), Color = arena.ring.color, Material = Enum.Material.SmoothPlastic, Transparency = 0.15, CastShadow = false, Parent = folder })
		else
			-- Chalk (spray paint on the gravel).
			part({ Name = "Chalk", Size = Vector3.new(len, 0.03, 0.44), CFrame = face + Vector3.new(0, 0.012, 0), Color = arena.ring.color, Material = Enum.Material.Sand, Transparency = 0.05, CastShadow = false, Parent = folder })
		end
	end
end

-- ---- Scenery: rounded props out past the bank (arenaBuilder.ts SCENERY) -----------------------

local function bush(parent: Instance, at: Vector3, size: number, colors: { Color3 }, rng: Random)
	local n = 3 + rng:NextInteger(0, 1)
	for i = 1, n do
		local s = size * rng:NextNumber(0.55, 0.85) * 2
		local off = Vector3.new(rng:NextNumber(-0.5, 0.5) * size, s * 0.35, rng:NextNumber(-0.5, 0.5) * size)
		blob(parent, CFrame.new(at + off), Vector3.new(s, s * 0.85, s), colors[(i - 1) % #colors + 1], Enum.Material.LeafyGrass, "Bush")
	end
end

local function pine(parent: Instance, at: Vector3, h: number, snow: boolean)
	cylinder(parent, at + Vector3.new(0, h * 0.15, 0), h * 0.06, h * 0.3, hex("#6b4a30"), Enum.Material.Wood, "Trunk")
	-- Stacked tiers that narrow to a point: a toy pine.
	local tiers = 7
	for i = 0, tiers - 1 do
		local f = i / tiers
		local r = h * 0.34 * (1 - f) + h * 0.03
		local y = h * (0.26 + f * 0.7)
		cylinder(parent, at + Vector3.new(0, y, 0), r, h * 0.11, if i % 2 == 0 then hex("#2a5f3e") else hex("#2f6b45"), Enum.Material.LeafyGrass, "Needles")
		if snow then
			cylinder(parent, at + Vector3.new(0, y + h * 0.06, 0), r * 0.7, h * 0.03, hex("#f4f8fc"), Enum.Material.Snow, "Snow")
		end
	end
end

local function tufts(parent: Instance, origin: Vector3, n: number, rMin: number, rMax: number, color: Color3, height: number, rng: Random)
	for _ = 1, n do
		local a = rng:NextNumber() * math.pi * 2
		local r = rng:NextNumber(rMin, rMax)
		local c = origin + Vector3.new(math.cos(a) * r, 0, math.sin(a) * r)
		for _ = 1, 3 do
			local h = height * rng:NextNumber(0.6, 1.1)
			local w = Instance.new("WedgePart")
			w.Anchored, w.CanCollide, w.CanTouch, w.CanQuery = true, false, false, false
			w.Size = Vector3.new(0.12, h, 0.5)
			w.CFrame = CFrame.new(c + Vector3.new(rng:NextNumber(-0.4, 0.4), h / 2, rng:NextNumber(-0.4, 0.4))) * CFrame.Angles(rng:NextNumber(-0.4, 0.4), rng:NextNumber() * 6.28, rng:NextNumber(-0.4, 0.4))
			w.Color = color
			w.Material = Enum.Material.Grass
			w.CastShadow = false
			w.Name = "Tuft"
			w.Parent = parent
		end
	end
end

local function windmill(parent: Instance, at: Vector3, facing: Vector3)
	local mill = Instance.new("Model")
	mill.Name = "Windmill"
	local cream, red = hex("#f2e6d0"), hex("#d1453b")
	for i = 0, 5 do
		cylinder(mill, at + Vector3.new(0, 1.1 + i * 2.1, 0), (1.3 - i * 0.07) * S * 0.8, 2.15, cream, Enum.Material.SmoothPlastic, "Tower")
	end
	for i = 0, 5 do
		cylinder(mill, at + Vector3.new(0, 13.4 + i * 0.9, 0), (1.3 - i * 0.21) * S * 0.85, 0.95, red, Enum.Material.SmoothPlastic, "Roof")
	end
	-- The sails turn on the client (Ambience spins every "Sails" model).
	local sails = Instance.new("Model")
	sails.Name = "Sails"
	local hub = at + Vector3.new(0, 12.8, 0) + facing * 4.6
	local hubPart = cylinder(sails, hub, 0.7, 0.8, red, Enum.Material.SmoothPlastic, "Hub")
	hubPart.CFrame = CFrame.lookAt(hub, hub + facing) * CFrame.Angles(0, math.pi / 2, 0)
	local _ = hubPart
	local base = CFrame.lookAt(hub, hub + facing)
	-- The pivot's -Z looks along the axle, so spinning about its Z turns the sails.
	sails.WorldPivot = base
	for i = 0, 3 do
		local arm = base * CFrame.Angles(0, 0, i * math.pi / 2) * CFrame.new(0, 4.4, 0)
		part({ Name = "Sail", Size = Vector3.new(1.7, 8.4, 0.25), CFrame = arm, Color = if i % 2 == 0 then hex("#f6f2e8") else hex("#e5323f"), Material = Enum.Material.SmoothPlastic, Parent = sails })
	end
	sails.Parent = mill
	mill.Parent = parent
end

local SCENERY = {
	-- On the desk: stacks of books out at the edge of the lamplight, and the lamp itself.
	desk = function(f: Folder, origin: Vector3, spots: { number }, rng: Random)
		for k, a in ipairs(spots) do
			local d = Config.BOUND_R + rng:NextNumber(4, 7) * S
			local at = origin + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d)
			if k == 1 then
				-- An anglepoise lamp: a round base, two arms and a shade with a warm bulb.
				cylinder(f, at + Vector3.new(0, 0.6, 0), 4.4, 1.2, hex("#2b2b2e"), Enum.Material.Metal, "LampBase")
				local elbow = at + Vector3.new(0, 14, 0) - (at - origin).Unit * 3
				local head = elbow + Vector3.new(0, 4, 0) + (origin - at).Unit * 9
				for _, seg in ipairs({ { at + Vector3.new(0, 1.2, 0), elbow }, { elbow, head } }) do
					local m = (seg[1] + seg[2]) / 2
					part({ Name = "LampArm", Size = Vector3.new(0.7, 0.7, (seg[2] - seg[1]).Magnitude), CFrame = CFrame.lookAt(m, seg[2]), Color = hex("#2b2b2e"), Material = Enum.Material.Metal, Parent = f })
				end
				local shade = part({ Name = "LampShade", Shape = Enum.PartType.Cylinder, Size = Vector3.new(4.5, 6.5, 6.5), CFrame = CFrame.lookAt(head, origin) * CFrame.Angles(math.rad(-35), 0, 0) * CFrame.Angles(0, math.pi / 2, 0), Color = hex("#c9462f"), Material = Enum.Material.Metal, Parent = f })
				local bulb = blob(f, shade.CFrame * CFrame.new(-2, 0, 0), Vector3.new(3, 3, 3), hex("#fff3d6"), Enum.Material.Neon, "Bulb")
				local light = Instance.new("SpotLight")
				light.Face = Enum.NormalId.Left
				light.Angle = 80
				light.Range = 60
				light.Brightness = 2.5
				light.Color = hex("#ffe6c4")
				light.Shadows = true
				light.Parent = shade
				local glow = Instance.new("PointLight")
				glow.Range = 14
				glow.Brightness = 1.2
				glow.Color = hex("#ffd9a0")
				glow.Parent = bulb
			else
				local y = 0
				for _ = 1, 3 do
					local h = rng:NextNumber(0.45, 0.7) * S
					local turn = rng:NextNumber(-0.3, 0.3)
					local cf = CFrame.new(at + Vector3.new(0, y + h / 2, 0)) * CFrame.Angles(0, a + turn, 0)
					local cover = ({ hex("#a8322d"), hex("#244c7a"), hex("#2f6b3a"), hex("#c99a2e") })[rng:NextInteger(1, 4)]
					local L, T = rng:NextNumber(2.6, 3.4) * S, rng:NextNumber(1.8, 2.2) * S
					part({ Name = "Book", Size = Vector3.new(L, h, T), CFrame = cf, Color = cover, Material = Enum.Material.Fabric, Parent = f })
					part({ Name = "Pages", Size = Vector3.new(L * 0.96, h * 0.82, T * 1.01), CFrame = cf * CFrame.new(L * 0.02, 0, 0), Color = hex("#efe6cf"), Material = Enum.Material.SmoothPlastic, Parent = f })
					y += h
				end
			end
		end
	end,
	-- A street's edge: round hedges along the far side of the kerb.
	culdesac = function(f: Folder, origin: Vector3, spots: { number }, rng: Random)
		for _, a in ipairs(spots) do
			local d = Config.BOUND_R + rng:NextNumber(4, 6.5) * S
			bush(f, origin + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d), rng:NextNumber(1.4, 2.2) * S, { hex("#3f7f3a"), hex("#4b8f40"), hex("#376f33") }, rng)
		end
	end,
	-- The lawn: tufts on the berm, round shrubs beyond.
	grass = function(f: Folder, origin: Vector3, spots: { number }, rng: Random)
		tufts(f, origin, 70, Config.BOUND_R - 0.2 * S, Config.BOUND_R + 3.4 * S, hex("#3f8a2e"), 0.7 * S, rng)
		for _, a in ipairs(spots) do
			local d = Config.BOUND_R + rng:NextNumber(5, 6.5) * S
			bush(f, origin + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d), rng:NextNumber(1.6, 2.4) * S, { hex("#3b7d33"), hex("#4a9140"), hex("#2f6d2b") }, rng)
		end
	end,
	-- The beach: marram grass on the dune, a few smooth rocks.
	sand = function(f: Folder, origin: Vector3, spots: { number }, rng: Random)
		tufts(f, origin, 40, Config.BOUND_R + 0.5 * S, Config.BOUND_R + 3.6 * S, hex("#a8a85a"), 0.9 * S, rng)
		for k, a in ipairs(spots) do
			if k > 5 then
				break
			end
			local d = Config.BOUND_R + rng:NextNumber(4.5, 6.5) * S
			local s = rng:NextNumber(0.8, 1.6) * S
			blob(f, CFrame.new(origin + Vector3.new(math.cos(a) * d, s * 0.3, math.sin(a) * d)) * CFrame.Angles(0, rng:NextNumber() * 6, 0), Vector3.new(s * 2.6, s * 1.6, s * 2), ({ hex("#a89a86"), hex("#97887a") })[rng:NextInteger(1, 2)], Enum.Material.Slate, "Rock")
		end
	end,
	-- The lake: snowy pines along the shore.
	ice = function(f: Folder, origin: Vector3, spots: { number }, rng: Random)
		for _, a in ipairs(spots) do
			local d = Config.BOUND_R + rng:NextNumber(5, 6.5) * S
			pine(f, origin + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d), rng:NextNumber(4, 6.5) * S, true)
		end
	end,
	-- The pit: rounded boulders.
	gravel = function(f: Folder, origin: Vector3, spots: { number }, rng: Random)
		for k, a in ipairs(spots) do
			if k > 7 then
				break
			end
			local d = Config.BOUND_R + rng:NextNumber(4.5, 6.5) * S
			local s = rng:NextNumber(1, 2) * S
			blob(f, CFrame.new(origin + Vector3.new(math.cos(a) * d, s * 0.35, math.sin(a) * d)) * CFrame.Angles(rng:NextNumber(), rng:NextNumber() * 6, 0), Vector3.new(s * 2.4, s * 1.7, s * 2.2), ({ hex("#8f877d"), hex("#7d766d"), hex("#9c9286") })[rng:NextInteger(1, 3)], Enum.Material.Rock, "Boulder")
		end
	end,
	-- The course: a little windmill turning out past the rail, and round hedges.
	minigolf = function(f: Folder, origin: Vector3, spots: { number }, rng: Random)
		for k, a in ipairs(spots) do
			local d = Config.BOUND_R + rng:NextNumber(4, 5.5) * S
			local at = origin + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d)
			if k == 1 then
				windmill(f, origin + Vector3.new(math.cos(a), 0, math.sin(a)) * (Config.BOUND_R + 6 * S), -Vector3.new(math.cos(a), 0, math.sin(a)))
			elseif k <= 7 then
				bush(f, at, rng:NextNumber(1.2, 1.8) * S, { hex("#2f8f3c"), hex("#3aa047") }, rng)
			end
		end
	end,
}

export type Built = { folder: Folder, origin: Vector3, stands: { CFrame } }

function Arena.build(origin: Vector3, arena: Config.Arena, seats: number, rng: Random, parent: Instance, _hasMap: boolean?): Built
	local folder = Instance.new("Folder")
	folder.Name = "Field"
	folder:SetAttribute("Arena", arena.id)
	local B = Config.BOUND_R
	-- Decor has its own Random, so the scenery never shifts the table's dice.
	local decor = Random.new(math.floor(origin.X * 7 + origin.Z))
	local _ = rng

	-- Ground: one slab filling the table's plot.
	local half = Config.TABLE_SPACING / 2
	part({
		Name = "Ground",
		Size = Vector3.new(half * 2, 4, half * 2),
		CFrame = CFrame.new(origin - Vector3.new(0, 2, 0)),
		Material = arena.material,
		Color = arena.color,
		Reflectance = if arena.id == "ice" then 0.18 else 0,
		CanCollide = true,
		CanQuery = true,
		Parent = folder,
	})
	local art = GROUND_ART[arena.id]
	if art then
		art(folder, origin, half, decor)
	end

	bank(folder, origin, arena)
	-- The wall you can't see, standing on the bank.
	local segs = 48
	local segLen = 2 * math.pi * (B + 1) / segs * 1.08
	for i = 0, segs - 1 do
		local a = i / segs * math.pi * 2
		local at = origin + Vector3.new(math.cos(a) * (B + 1), 0, math.sin(a) * (B + 1))
		part({
			Name = "Wall",
			Size = Vector3.new(segLen, Config.EDGE_H, 2),
			CFrame = CFrame.lookAt(at, Vector3.new(origin.X, at.Y, origin.Z)) * CFrame.new(0, Config.EDGE_H / 2, 0),
			Transparency = 1,
			CastShadow = false,
			CanCollide = true,
			Parent = folder,
		})
	end
	ringLine(folder, origin, arena)

	-- A spot for each seat, out past the bank, facing the ring: a low disc in the bank's look.
	local stands = {}
	local seatAngles = {}
	for s = 1, seats do
		local a = math.pi / 2 + (s - 1) / seats * math.pi * 2
		table.insert(seatAngles, a)
		local at = origin + Vector3.new(math.cos(a) * (B + 9), 0, math.sin(a) * (B + 9))
		part({
			Name = "Stand",
			Shape = Enum.PartType.Cylinder,
			Size = Vector3.new(0.6, 8, 8),
			CFrame = CFrame.new(at + Vector3.new(0, 0.3, 0)) * CFrame.Angles(0, 0, math.pi / 2),
			Material = arena.bank.material,
			Color = arena.bank.color,
			CanCollide = true,
			Parent = folder,
		})
		table.insert(stands, CFrame.lookAt(at + Vector3.new(0, 4, 0), Vector3.new(origin.X, origin.Y + 4, origin.Z)))
	end

	-- Scenery ringing the field, none behind a seat, where the player's camera sits.
	local spots = {}
	local n = 12
	local offset = decor:NextNumber() * math.pi * 2
	for k = 0, n - 1 do
		local a = offset + k / n * math.pi * 2 + decor:NextNumber(-0.2, 0.2)
		local clear = true
		for _, sa in ipairs(seatAngles) do
			if math.abs(math.atan2(math.sin(a - sa), math.cos(a - sa))) < 0.55 then
				clear = false
			end
		end
		if clear then
			table.insert(spots, a)
		end
	end
	local scenery = Instance.new("Folder")
	scenery.Name = "Scenery"
	SCENERY[arena.id](scenery, origin, spots, decor)
	scenery.Parent = folder

	folder.Parent = parent
	return { folder = folder, origin = origin, stands = stands }
end

return Arena
