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

--- A book: two boards and a spine in the cover colour, the pages set clearly inside them (no two
--- faces in the same place, so no flicker and no shadow acne).
local function book(parent: Instance, cf: CFrame, L: number, h: number, T: number, cover: Color3, pages: Color3, name: string)
	local b = math.clamp(h * 0.12, 0.12, 0.35)
	part({ Name = name, Size = Vector3.new(L, b, T), CFrame = cf * CFrame.new(0, -h / 2 + b / 2, 0), Color = cover, Material = Enum.Material.Fabric, Parent = parent })
	part({ Name = "Cover", Size = Vector3.new(L, b, T), CFrame = cf * CFrame.new(0, h / 2 - b / 2, 0), Color = cover, Material = Enum.Material.Fabric, Parent = parent })
	part({ Name = "Spine", Size = Vector3.new(b, h - 2 * b, T), CFrame = cf * CFrame.new(-L / 2 + b / 2, 0, 0), Color = cover:Lerp(Color3.new(0, 0, 0), 0.12), Material = Enum.Material.Fabric, Parent = parent })
	local inset = math.max(0.08, T * 0.012)
	part({ Name = "Pages", Size = Vector3.new(L - b - inset, h - 2 * b - 0.02, T - 2 * inset), CFrame = cf * CFrame.new(b / 2 - inset / 2, 0, 0), Color = pages, Material = Enum.Material.SmoothPlastic, Parent = parent })
end

-- ---- The ground's own marks (groundArt.ts) ----------------------------------------------------

local GROUND_ART = {
	-- Mowing stripes, the broad light and dark bands of a cut lawn.
	grass = function(folder: Folder, origin: Vector3, half: number, _rng: Random)
		local w = 9
		local n = math.floor(half * 2 / w)
		for i = 0, n - 1, 2 do
			local x = -half + (i + 0.5) * w
			-- Cut to the field's disc: past it is real grass.
			local chord = 2 * math.sqrt(math.max(0, (half - 8) ^ 2 - x * x))
			if chord < 2 then
				continue
			end
			part({ Name = "Stripe", Size = Vector3.new(w, 0.04, chord), CFrame = CFrame.new(origin + Vector3.new(x, 0.05, 0)), Color = Color3.fromRGB(104, 178, 58), Material = Enum.Material.Grass, CastShadow = false, Parent = folder })
		end
	end,
	-- Black ice: white crack lines running across it, and drifts of snow blown onto it.
	ice = function(folder: Folder, origin: Vector3, half: number, rng: Random)
		for _ = 1, 9 do
			local at = Vector3.new(rng:NextNumber(-half, half) * 0.8, 0.06, rng:NextNumber(-half, half) * 0.8)
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
			local d = rng:NextNumber(Config.RING_R * 0.8, half - 14)
			local a = rng:NextNumber() * math.pi * 2
			local s = rng:NextNumber(4, 9)
			blob(folder, CFrame.new(origin + Vector3.new(math.cos(a) * d, -0.15, math.sin(a) * d)) * CFrame.Angles(0, rng:NextNumber() * 6, 0), Vector3.new(s * 1.6, 0.5, s), hex("#f2f7fb"), Enum.Material.Snow, "Drift")
		end
	end,
	-- Sand: wind ripples, low ridges a little darker than the sand.
	sand = function(folder: Folder, origin: Vector3, half: number, rng: Random)
		for i = -12, 12 do
			local z = i * 6.5 + rng:NextNumber(-1, 1)
			local chord = 2 * math.sqrt(math.max(0, (half - 8) ^ 2 - z * z))
			if chord < 2 then
				continue
			end
			part({ Name = "Ripple", Size = Vector3.new(chord, 0.03, 0.5), CFrame = CFrame.new(origin + Vector3.new(0, 0.06, z)) * CFrame.Angles(0, rng:NextNumber(-0.05, 0.05), 0), Color = hex("#c7ad83"), Material = Enum.Material.Sand, Transparency = 0.6, CastShadow = false, Parent = folder })
		end
	end,
	-- The desk: a varnished board, so a soft sheen of the lamp on it.
	desk = function(folder: Folder, origin: Vector3, half: number, _rng: Random)
		part({ Name = "Varnish", Size = Vector3.new(half * 2, 0.02, half * 2), CFrame = CFrame.new(origin + Vector3.new(0, 0.03, 0)), Color = Color3.fromRGB(160, 98, 55), Material = Enum.Material.Glass, Transparency = 0.85, Reflectance = 0.08, CastShadow = false, Parent = folder })
	end,
}

-- ---- The bank: the web game's lathe profile, in studs ----------------------------------------

local function bank(folder: Folder, origin: Vector3, arena: Config.Arena)
	local B = Config.BOUND_R
	local prof = arena.bank.profile
	local segs = 64
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
	local n = 120
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
			part({ Name = "Groove", Size = Vector3.new(len, 0.03, 1.2), CFrame = face + Vector3.new(0, 0.07, 0), Color = arena.ring.color, Material = Enum.Material.Sand, Transparency = 0.35, CastShadow = false, Parent = folder })
		elseif style == "etched" then
			-- A skate's scratch in the ice.
			part({ Name = "Scratch", Size = Vector3.new(len, 0.03, 0.32), CFrame = face + Vector3.new(0, 0.07, 0), Color = arena.ring.color, Material = Enum.Material.SmoothPlastic, Transparency = 0.15, CastShadow = false, Parent = folder })
		else
			-- Chalk (spray paint on the gravel).
			part({ Name = "Chalk", Size = Vector3.new(len, 0.03, 0.44), CFrame = face + Vector3.new(0, 0.07, 0), Color = arena.ring.color, Material = Enum.Material.Sand, Transparency = 0.05, CastShadow = false, Parent = folder })
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
				light.Shadows = false
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
					book(f, cf, L, h, T, cover, hex("#efe6cf"), "Book")
					y += h + 0.03
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

-- ---- Extras: the toys and odds that make each field a place (between the scenery spots) -------

local function flowers(parent: Instance, at: Vector3, rng: Random, n: number)
	local colors = { hex("#ff6b8a"), hex("#ffd23f"), hex("#ffffff"), hex("#b38cff"), hex("#ff9f43") }
	for _ = 1, n do
		local p = at + Vector3.new(rng:NextNumber(-3, 3), 0, rng:NextNumber(-3, 3))
		local h = rng:NextNumber(0.8, 1.8)
		part({ Name = "Stem", Size = Vector3.new(0.2, h, 0.2), CFrame = CFrame.new(p + Vector3.new(0, h / 2, 0)), Color = hex("#3f9a3a"), CastShadow = false, Parent = parent })
		blob(parent, CFrame.new(p + Vector3.new(0, h + 0.15, 0)), Vector3.new(1.2, 0.55, 1.2), colors[rng:NextInteger(1, #colors)], Enum.Material.SmoothPlastic, "Petals")
		blob(parent, CFrame.new(p + Vector3.new(0, h + 0.35, 0)), Vector3.new(0.45, 0.3, 0.45), hex("#ffcf33"), Enum.Material.SmoothPlastic, "Middle")
	end
end

local function cone(parent: Instance, at: Vector3, h: number, r: number, color: Color3, stripe: Color3?, name: string)
	-- A stack of shrinking discs: a toy cone.
	local n = 6
	for i = 0, n - 1 do
		local f = i / n
		local c = if stripe and i == 3 then stripe else color
		cylinder(parent, at + Vector3.new(0, h * (f + 0.5 / n), 0), r * (1 - f * 0.85), h / n, c, Enum.Material.SmoothPlastic, name)
	end
end

local function snowman(parent: Instance, at: Vector3, facing: Vector3)
	local white = hex("#f7fbff")
	blob(parent, CFrame.new(at + Vector3.new(0, 3, 0)), Vector3.new(7, 6.4, 7), white, Enum.Material.Snow, "Snowball")
	blob(parent, CFrame.new(at + Vector3.new(0, 7.6, 0)), Vector3.new(5, 4.8, 5), white, Enum.Material.Snow, "Snowball")
	local head = at + Vector3.new(0, 11.1, 0)
	blob(parent, CFrame.new(head), Vector3.new(3.6, 3.6, 3.6), white, Enum.Material.Snow, "Head")
	local f = facing.Unit
	local side = Vector3.new(-f.Z, 0, f.X)
	for _, s in ipairs({ -1, 1 }) do
		blob(parent, CFrame.new(head + f * 1.6 + side * s * 0.6 + Vector3.new(0, 0.4, 0)), Vector3.new(0.45, 0.45, 0.45), hex("#1d1d24"), Enum.Material.SmoothPlastic, "Eye")
	end
	local nose = head + f * 1.7
	part({ Name = "Carrot", Size = Vector3.new(0.4, 0.4, 1.6), CFrame = CFrame.lookAt(nose + f * 0.6, nose + f * 2), Color = hex("#ff8a2a"), Parent = parent })
	cylinder(parent, head + Vector3.new(0, 1.5, 0), 2.2, 0.3, hex("#2b2b36"), Enum.Material.SmoothPlastic, "Brim")
	cylinder(parent, head + Vector3.new(0, 2.6, 0), 1.4, 2, hex("#2b2b36"), Enum.Material.SmoothPlastic, "Hat")
	cylinder(parent, head + Vector3.new(0, 1.9, 0), 1.45, 0.45, hex("#e5323f"), Enum.Material.SmoothPlastic, "Band")
	-- A scarf, and stick arms.
	cylinder(parent, head + Vector3.new(0, -1.6, 0), 1.9, 0.7, hex("#e5323f"), Enum.Material.Fabric, "Scarf")
	for _, s in ipairs({ -1, 1 }) do
		local a = at + Vector3.new(0, 8, 0) + side * s * 2.2
		local b = a + side * s * 3 + Vector3.new(0, 1.6, 0)
		part({ Name = "Arm", Size = Vector3.new(0.3, 0.3, (b - a).Magnitude), CFrame = CFrame.lookAt((a + b) / 2, b), Color = hex("#6b4a30"), Material = Enum.Material.Wood, Parent = parent })
	end
end

local function umbrella(parent: Instance, at: Vector3, rng: Random)
	cylinder(parent, at + Vector3.new(0, 5, 0), 0.25, 10, hex("#f2f2f2"), Enum.Material.SmoothPlastic, "Pole")
	-- A striped canopy: eight wedges round the pole.
	local colors = { hex("#e5323f"), hex("#ffffff") }
	if rng:NextNumber() < 0.5 then
		colors = { hex("#2f8fff"), hex("#ffe14d") }
	end
	for i = 0, 7 do
		local a = i / 8 * math.pi * 2
		local w = Instance.new("WedgePart")
		w.Anchored, w.CanCollide, w.CanTouch, w.CanQuery = true, false, false, false
		w.Size = Vector3.new(3.4, 1.6, 5.2)
		-- Tall at the pole, sloping down to a point outward.
		w.CFrame = CFrame.new(at + Vector3.new(0, 9.6, 0)) * CFrame.Angles(0, -a, 0) * CFrame.new(0, 0, -2.6)
		w.Color = colors[i % 2 + 1]
		w.Material = Enum.Material.Fabric
		w.Name = "Canopy"
		w.Parent = parent
	end
	blob(parent, CFrame.new(at + Vector3.new(0, 10.5, 0)), Vector3.new(0.8, 0.8, 0.8), colors[1], Enum.Material.SmoothPlastic, "Tip")
	-- A towel under it.
	part({ Name = "Towel", Size = Vector3.new(4, 0.1, 7), CFrame = CFrame.new(at + Vector3.new(3, 0.05, 0)) * CFrame.Angles(0, rng:NextNumber() * 6, 0), Color = colors[1], Material = Enum.Material.Fabric, CastShadow = false, Parent = parent })
end

local function bucket(parent: Instance, at: Vector3)
	cone(parent, at, 2.4, 1.4, hex("#ff4f9a"), nil, "Bucket")
	part({ Name = "Spade", Size = Vector3.new(0.3, 3.6, 0.3), CFrame = CFrame.new(at + Vector3.new(1.8, 1.6, 0)) * CFrame.Angles(0, 0, 0.35), Color = hex("#ffd23f"), Parent = parent })
	part({ Name = "Blade", Size = Vector3.new(1.2, 1.4, 0.2), CFrame = CFrame.new(at + Vector3.new(2.3, 0.3, 0)) * CFrame.Angles(0, 0, 0.35), Color = hex("#2f8fff"), Parent = parent })
end

local function starfish(parent: Instance, at: Vector3, rng: Random)
	local base = rng:NextNumber() * 6
	for i = 0, 4 do
		local a = base + i / 5 * math.pi * 2
		local d = Vector3.new(math.cos(a), 0, math.sin(a))
		blob(parent, CFrame.lookAt(at + d * 0.8 + Vector3.new(0, 0.15, 0), at + d * 2), Vector3.new(0.7, 0.35, 1.8), hex("#ff7b54"), Enum.Material.SmoothPlastic, "Arm")
	end
end

local function trafficCone(parent: Instance, at: Vector3)
	part({ Name = "ConeBase", Size = Vector3.new(2.6, 0.3, 2.6), CFrame = CFrame.new(at + Vector3.new(0, 0.15, 0)), Color = hex("#ff6a13"), Parent = parent })
	cone(parent, at + Vector3.new(0, 0.3, 0), 3.6, 1.1, hex("#ff6a13"), hex("#ffffff"), "Cone")
end

local function tyre(parent: Instance, at: Vector3, rng: Random)
	local cf = CFrame.new(at + Vector3.new(0, 1.6, 0)) * CFrame.Angles(0, rng:NextNumber() * 6, 0)
	part({ Name = "Tyre", Shape = Enum.PartType.Cylinder, Size = Vector3.new(1.4, 3.4, 3.4), CFrame = cf, Color = hex("#26262b"), Material = Enum.Material.Rubber, Parent = parent })
	part({ Name = "Hub", Shape = Enum.PartType.Cylinder, Size = Vector3.new(1.5, 1.6, 1.6), CFrame = cf, Color = hex("#c9c9d1"), Material = Enum.Material.Metal, Parent = parent })
end

local function streetLamp(parent: Instance, at: Vector3, toward: Vector3)
	cylinder(parent, at + Vector3.new(0, 6, 0), 0.3, 12, hex("#3a3d4a"), Enum.Material.Metal, "LampPost")
	local arm = at + Vector3.new(0, 12, 0) + (toward - at).Unit * 1.6
	part({ Name = "LampArm", Size = Vector3.new(0.3, 0.3, 3.2), CFrame = CFrame.lookAt((at + Vector3.new(0, 12, 0) + arm) / 2, arm), Color = hex("#3a3d4a"), Material = Enum.Material.Metal, Parent = parent })
	local bulb = blob(parent, CFrame.new(arm - Vector3.new(0, 0.5, 0)), Vector3.new(1.6, 1, 1.6), hex("#fff3c4"), Enum.Material.Neon, "Lamp")
	local l = Instance.new("PointLight")
	l.Range = 14
	l.Brightness = 0.7
	l.Color = hex("#ffe6b0")
	l.Parent = bulb
end

local function mailbox(parent: Instance, at: Vector3)
	cylinder(parent, at + Vector3.new(0, 1.8, 0), 0.25, 3.6, hex("#6b4a30"), Enum.Material.Wood, "Post")
	part({ Name = "Box", Size = Vector3.new(1.6, 1.4, 2.6), CFrame = CFrame.new(at + Vector3.new(0, 4.2, 0)), Color = hex("#2f6fd6"), Parent = parent })
	part({ Name = "Flag", Size = Vector3.new(0.15, 1.2, 0.5), CFrame = CFrame.new(at + Vector3.new(0.9, 4.6, 0.6)), Color = hex("#e5323f"), Parent = parent })
end

local function hydrant(parent: Instance, at: Vector3)
	cylinder(parent, at + Vector3.new(0, 1.2, 0), 0.75, 2.4, hex("#e5323f"), Enum.Material.SmoothPlastic, "Hydrant")
	blob(parent, CFrame.new(at + Vector3.new(0, 2.5, 0)), Vector3.new(1.5, 1, 1.5), hex("#e5323f"), Enum.Material.SmoothPlastic, "Top")
	part({ Name = "Nozzle", Shape = Enum.PartType.Cylinder, Size = Vector3.new(2.4, 0.6, 0.6), CFrame = CFrame.new(at + Vector3.new(0, 1.5, 0)), Color = hex("#ffd23f"), Parent = parent })
end

local function golfFlag(parent: Instance, at: Vector3)
	cylinder(parent, at + Vector3.new(0, -0.02, 0), 1, 0.06, hex("#1d1d24"), Enum.Material.SmoothPlastic, "Hole")
	cylinder(parent, at + Vector3.new(0, 4, 0), 0.12, 8, hex("#f2f2f2"), Enum.Material.SmoothPlastic, "FlagPole")
	local w = Instance.new("WedgePart")
	w.Anchored, w.CanCollide, w.CanTouch, w.CanQuery = true, false, false, false
	w.Size = Vector3.new(0.1, 1.8, 2.8)
	w.CFrame = CFrame.new(at + Vector3.new(0, 7, 1.4)) * CFrame.Angles(0, 0, math.pi)
	w.Color = hex("#e5323f")
	w.Material = Enum.Material.Fabric
	w.Name = "Flag"
	w.Parent = parent
	blob(parent, CFrame.new(at + Vector3.new(2.2, 0.45, 1)), Vector3.new(0.9, 0.9, 0.9), hex("#ffffff"), Enum.Material.SmoothPlastic, "GolfBall")
end

local function pencil(parent: Instance, at: Vector3, rng: Random)
	local yaw = rng:NextNumber() * 6
	local cf = CFrame.new(at + Vector3.new(0, 0.7, 0)) * CFrame.Angles(0, yaw, 0)
	local len = rng:NextNumber(14, 18)
	local color = ({ hex("#ffd23f"), hex("#2f8fff"), hex("#e5323f"), hex("#3faa4a") })[rng:NextInteger(1, 4)]
	part({ Name = "Pencil", Shape = Enum.PartType.Cylinder, Size = Vector3.new(len, 1.4, 1.4), CFrame = cf, Color = color, Parent = parent })
	part({ Name = "Ferrule", Shape = Enum.PartType.Cylinder, Size = Vector3.new(1, 1.45, 1.45), CFrame = cf * CFrame.new(len / 2 + 0.5, 0, 0), Color = hex("#c9c9d1"), Material = Enum.Material.Metal, Parent = parent })
	part({ Name = "Eraser", Shape = Enum.PartType.Cylinder, Size = Vector3.new(1.2, 1.4, 1.4), CFrame = cf * CFrame.new(len / 2 + 1.6, 0, 0), Color = hex("#ff8fb1"), Parent = parent })
	-- The sharpened end: wood narrowing to the lead.
	for i = 0, 3 do
		local r = 1.4 * (1 - i / 4)
		part({ Name = "Tip", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.55, r, r), CFrame = cf * CFrame.new(-len / 2 - 0.27 - i * 0.55, 0, 0), Color = if i < 3 then hex("#f0c58e") else hex("#33333a"), Material = Enum.Material.Wood, Parent = parent })
	end
end

local function mug(parent: Instance, at: Vector3)
	cylinder(parent, at + Vector3.new(0, 3, 0), 2.6, 6, hex("#ff6b8a"), Enum.Material.SmoothPlastic, "Mug")
	cylinder(parent, at + Vector3.new(0, 5.7, 0), 2.2, 0.7, hex("#5a3420"), Enum.Material.SmoothPlastic, "Cocoa")
	for i = 0, 3 do
		blob(parent, CFrame.new(at + Vector3.new(math.cos(i * 1.7) * 1, 6.2, math.sin(i * 1.7) * 1)), Vector3.new(0.9, 0.7, 0.9), hex("#ffffff"), Enum.Material.SmoothPlastic, "Marshmallow")
	end
	part({ Name = "Handle", Size = Vector3.new(0.6, 3.4, 0.9), CFrame = CFrame.new(at + Vector3.new(3.3, 3, 0)), Color = hex("#ff6b8a"), Parent = parent })
end

-- Toys are built at toy size, then scaled up so they read from the shooter's seat.
local TOY_SCALE = 1.6
local function big(f: Instance, build: (...any) -> ...any, at: Vector3, ...)
	local m = Instance.new("Model")
	m.Name = "Toy"
	build(m, at, ...)
	m.WorldPivot = CFrame.new(at)
	m:ScaleTo(TOY_SCALE)
	m.Parent = f
end

local EXTRAS = {
	desk = function(f: Folder, origin: Vector3, mids: { number }, rng: Random)
		for k, a in ipairs(mids) do
			local d = Config.BOUND_R + rng:NextNumber(4.5, 6) * S
			local at = origin + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d)
			if k % 3 == 1 then
				big(f, mug, at)
			else
				big(f, pencil, at, rng)
			end
		end
	end,
	culdesac = function(f: Folder, origin: Vector3, mids: { number }, rng: Random)
		for k, a in ipairs(mids) do
			local d = Config.BOUND_R + rng:NextNumber(3, 4) * S
			local at = origin + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d)
			if k % 3 == 1 then
				big(f, streetLamp, at, origin)
			elseif k % 3 == 2 then
				big(f, mailbox, at)
			else
				big(f, hydrant, at)
			end
		end
	end,
	grass = function(f: Folder, origin: Vector3, mids: { number }, rng: Random)
		for _, a in ipairs(mids) do
			local d = Config.BOUND_R + rng:NextNumber(3.5, 5) * S
			big(f, flowers, origin + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d), rng, 7)
		end
	end,
	sand = function(f: Folder, origin: Vector3, mids: { number }, rng: Random)
		for k, a in ipairs(mids) do
			local d = Config.BOUND_R + rng:NextNumber(4, 5.5) * S
			local at = origin + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d)
			if k == 1 then
				big(f, umbrella, at, rng)
			elseif k % 2 == 0 then
				big(f, bucket, at)
			else
				big(f, starfish, at, rng)
			end
		end
	end,
	ice = function(f: Folder, origin: Vector3, mids: { number }, rng: Random)
		for k, a in ipairs(mids) do
			local d = Config.BOUND_R + rng:NextNumber(4, 5) * S
			local at = origin + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d)
			if k == 1 then
				big(f, snowman, at, origin - at)
			else
				local s = rng:NextNumber(3, 6)
				blob(f, CFrame.new(at + Vector3.new(0, s * 0.2, 0)), Vector3.new(s * 2, s * 0.8, s * 1.6), hex("#f4f8fc"), Enum.Material.Snow, "Drift")
			end
		end
	end,
	gravel = function(f: Folder, origin: Vector3, mids: { number }, rng: Random)
		for k, a in ipairs(mids) do
			local d = Config.BOUND_R + rng:NextNumber(3, 4.5) * S
			local at = origin + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d)
			if k % 2 == 1 then
				big(f, trafficCone, at)
			else
				big(f, tyre, at, rng)
			end
		end
	end,
	minigolf = function(f: Folder, origin: Vector3, mids: { number }, rng: Random)
		for k, a in ipairs(mids) do
			local d = Config.BOUND_R + rng:NextNumber(3.5, 4.5) * S
			local at = origin + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d)
			if k == 1 then
				big(f, golfFlag, at)
			else
				big(f, flowers, at, rng, 5)
			end
		end
	end,
}

-- ---- The backdrop: a tall ring out at the plot's edge, so each field is a place of its own and
-- no other table floats in the sky behind it. None behind a seat, where the camera sits.

local PASTEL = { hex("#ffb3c7"), hex("#ffe08a"), hex("#a8e6a1"), hex("#9fd4ff"), hex("#d3b8ff"), hex("#ffc999") }

local function toyTree(parent: Instance, at: Vector3, rng: Random)
	local h = rng:NextNumber(10, 16)
	cylinder(parent, at + Vector3.new(0, h / 2, 0), 1.3, h, hex("#9a6235"), Enum.Material.Wood, "Trunk")
	local c = rng:NextNumber(14, 20)
	local colors = { hex("#5ccf4a"), hex("#3fbf6a"), hex("#8bdc3f"), hex("#ff9fcf"), hex("#ffd34d") }
	local col = colors[rng:NextInteger(1, #colors)]
	blob(parent, CFrame.new(at + Vector3.new(0, h + c * 0.3, 0)), Vector3.new(c, c * 0.9, c), col, Enum.Material.SmoothPlastic, "Crown")
	blob(parent, CFrame.new(at + Vector3.new(c * 0.25, h + c * 0.62, -c * 0.1)), Vector3.new(c * 0.6, c * 0.55, c * 0.6), col:Lerp(Color3.new(1, 1, 1), 0.15), Enum.Material.SmoothPlastic, "Crown")
end

local function palm(parent: Instance, at: Vector3, rng: Random)
	local lean = Vector3.new(rng:NextNumber(-1, 1), 0, rng:NextNumber(-1, 1)).Unit * 0.35
	local p = at
	for i = 1, 8 do
		local q = p + Vector3.new(0, 2.8, 0) + lean * (i / 4)
		part({ Name = "PalmTrunk", Size = Vector3.new(1.5 - i * 0.05, 1.5 - i * 0.05, (q - p).Magnitude + 0.3), CFrame = CFrame.lookAt((p + q) / 2, q), Color = if i % 2 == 0 then hex("#b0814f") else hex("#9c6f40"), Material = Enum.Material.Wood, Parent = parent })
		p = q
	end
	for k = 0, 6 do
		local a = k / 7 * math.pi * 2 + rng:NextNumber(-0.2, 0.2)
		local dir = Vector3.new(math.cos(a), 0, math.sin(a))
		local mid = p + dir * 4 + Vector3.new(0, -0.8, 0)
		part({ Name = "Frond", Size = Vector3.new(2.6, 0.25, 9), CFrame = CFrame.lookAt(mid, mid + dir) * CFrame.Angles(math.rad(-18), 0, 0), Color = if k % 2 == 0 then hex("#3faf4a") else hex("#2f9a3f"), Material = Enum.Material.LeafyGrass, Parent = parent })
	end
	for k = 0, 2 do
		blob(parent, CFrame.new(p + Vector3.new(math.cos(k * 2.1) * 0.9, -1, math.sin(k * 2.1) * 0.9)), Vector3.new(1.2, 1.2, 1.2), hex("#6b4a2a"), Enum.Material.SmoothPlastic, "Coconut")
	end
end

local function house(parent: Instance, at: Vector3, toward: Vector3, rng: Random)
	local w, d, h = rng:NextNumber(16, 22), 14, rng:NextNumber(10, 13)
	local face = CFrame.lookAt(at, Vector3.new(toward.X, at.Y, toward.Z))
	local color = PASTEL[rng:NextInteger(1, #PASTEL)]
	part({ Name = "House", Size = Vector3.new(w, h, d), CFrame = face * CFrame.new(0, h / 2, 0), Color = color, Parent = parent })
	-- A gable roof: two wedges back to back.
	local roof = ({ hex("#d1453b"), hex("#3a5fd1"), hex("#6b4a30") })[rng:NextInteger(1, 3)]
	for _, s in ipairs({ -1, 1 }) do
		local wd = Instance.new("WedgePart")
		wd.Anchored, wd.CanCollide, wd.CanTouch, wd.CanQuery = true, false, false, false
		wd.Size = Vector3.new(w + 1.4, 6, d / 2 + 0.7)
		wd.CFrame = face * CFrame.new(0, h + 3, s * (d / 4 + 0.35)) * CFrame.Angles(0, if s < 0 then 0 else math.pi, 0)
		wd.Color = roof
		wd.Name = "Roof"
		wd.Parent = parent
	end
	-- The door and two lit windows, on the face toward the field (-Z of `face`).
	part({ Name = "Door", Size = Vector3.new(3, 6, 0.3), CFrame = face * CFrame.new(0, 3, -d / 2 - 0.1), Color = hex("#7a4a2a"), Parent = parent })
	for _, x in ipairs({ -w / 3.2, w / 3.2 }) do
		part({ Name = "Window", Size = Vector3.new(3.2, 3.2, 0.3), CFrame = face * CFrame.new(x, h * 0.6, -d / 2 - 0.1), Color = hex("#fff1b8"), Material = Enum.Material.Neon, Parent = parent })
	end
	cylinder(parent, (face * CFrame.new(w / 3, h + 4, d / 5)).Position, 1, 4, hex("#b0543a"), Enum.Material.Brick, "Chimney")
end

local function bookTower(parent: Instance, at: Vector3, rng: Random)
	local y = 0
	for _ = 1, rng:NextInteger(5, 9) do
		local hgt = rng:NextNumber(2.2, 3.4)
		local L, T = rng:NextNumber(13, 17), rng:NextNumber(9, 11)
		local cf = CFrame.new(at + Vector3.new(0, y + hgt / 2, 0)) * CFrame.Angles(0, rng:NextNumber(-0.25, 0.25), 0)
		local cover = ({ hex("#e5323f"), hex("#2f6fd6"), hex("#3faa4a"), hex("#ffb627"), hex("#9b59d0"), hex("#ff6b8a") })[rng:NextInteger(1, 6)]
		book(parent, cf, L, hgt, T, cover, hex("#f3ead4"), "BigBook")
		y += hgt + 0.04
	end
end

local BACKDROP = {
	desk = function(f, at, _o, rng) bookTower(f, at, rng) end,
	culdesac = function(f, at, o, rng) house(f, at, o, rng) end,
	grass = function(f, at, _o, rng) toyTree(f, at, rng) end,
	minigolf = function(f, at, _o, rng) toyTree(f, at, rng) end,
	sand = function(f, at, _o, rng) palm(f, at, rng) end,
	ice = function(f, at, _o, rng) pine(f, at, rng:NextNumber(24, 34), true) end,
	gravel = function(f, at, _o, rng)
		local s = rng:NextNumber(10, 16)
		blob(f, CFrame.new(at + Vector3.new(0, s * 0.35, 0)) * CFrame.Angles(rng:NextNumber(), rng:NextNumber() * 6, 0), Vector3.new(s * 1.6, s * 1.2, s * 1.4), ({ hex("#8f877d"), hex("#7d766d"), hex("#9c9286") })[rng:NextInteger(1, 3)], Enum.Material.Rock, "BigBoulder")
	end,
}

local function backdrop(parent: Instance, origin: Vector3, arenaId: string, seatAngles: { number }, rng: Random)
	local build = BACKDROP[arenaId]
	if not build then
		return
	end
	local folder = Instance.new("Folder")
	folder.Name = "Backdrop"
	-- Just inside the plot: past it there is no ground under them.
	local r = Config.TABLE_SPACING / 2 - 3
	local n = 30
	for k = 0, n - 1 do
		local a = k / n * math.pi * 2 + rng:NextNumber(-0.06, 0.06)
		local clear = true
		for _, sa in ipairs(seatAngles) do
			if math.abs(math.atan2(math.sin(a - sa), math.cos(a - sa))) < 0.42 then
				clear = false
			end
		end
		if clear then
			local d = r + rng:NextNumber(-1.5, 1.5)
			build(folder, origin + Vector3.new(math.cos(a) * d, 0, math.sin(a) * d), origin, rng)
		end
	end
	folder.Parent = parent
end

-- Outdoor fields stand in real terrain: grass grows animated blades, sand and snow lie in drifts.
local TERRAIN = { grass = Enum.Material.Grass, minigolf = Enum.Material.Grass, sand = Enum.Material.Sand, ice = Enum.Material.Snow, gravel = Enum.Material.Ground }
Arena.TERRAIN = TERRAIN

local function plot(origin: Vector3): (CFrame, Vector3)
	local half = Config.TABLE_SPACING / 2
	return CFrame.new(origin - Vector3.new(0, 2, 0)), Vector3.new(half * 2, 4, half * 2)
end

--- Take a table's terrain away again.
function Arena.clear(origin: Vector3)
	local cf, size = plot(origin)
	workspace.Terrain:FillBlock(cf, size + Vector3.new(0, 2, 0), Enum.Material.Air)
end

export type Built = { folder: Folder, origin: Vector3, stands: { CFrame } }

function Arena.build(origin: Vector3, arena: Config.Arena, seats: number, rng: Random, parent: Instance, _hasMap: boolean?): Built
	local folder = Instance.new("Folder")
	folder.Name = "Field"
	folder:SetAttribute("Arena", arena.id)
	local B = Config.BOUND_R
	-- Decor has its own Random, so the scenery never shifts the table's dice.
	local decor = Random.new(math.floor(origin.X * 7 + origin.Z))
	local _ = rng

	-- Ground: the field's own surface; outdoors a disc of it set into real terrain, indoors (the
	-- desk, the street) one slab filling the table's plot.
	local half = Config.TABLE_SPACING / 2
	local terrain = TERRAIN[arena.id]
	local discR = B + 22
	if terrain then
		local cf, size = plot(origin)
		workspace.Terrain:FillBlock(cf, size, terrain)
		-- Smooth terrain rounds its surface up past the voxel: carve it out under the field's disc,
		-- or it grows over the ring, the marbles and the pieces.
		workspace.Terrain:FillCylinder(CFrame.new(origin), 12, discR - 1, Enum.Material.Air)
	end
	part({
		Name = "Ground",
		Shape = if terrain then Enum.PartType.Cylinder else Enum.PartType.Block,
		Size = if terrain then Vector3.new(4, discR * 2, discR * 2) else Vector3.new(half * 2, 4, half * 2),
		CFrame = CFrame.new(origin - Vector3.new(0, 2, 0)) * (if terrain then CFrame.Angles(0, 0, math.pi / 2) else CFrame.identity),
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
	-- Between neighbouring spots (both clear of the seats), the field's own toys.
	local mids = {}
	for k = 1, #spots - 1 do
		local gap = math.atan2(math.sin(spots[k + 1] - spots[k]), math.cos(spots[k + 1] - spots[k]))
		if gap > 0 and gap < 0.9 then
			table.insert(mids, spots[k] + gap / 2)
		end
	end
	local extras = EXTRAS[arena.id]
	if extras then
		extras(scenery, origin, mids, decor)
	end
	backdrop(scenery, origin, arena.id, seatAngles, decor)
	scenery.Parent = folder

	folder.Parent = parent
	return { folder = folder, origin = origin, stands = stands }
end

return Arena
