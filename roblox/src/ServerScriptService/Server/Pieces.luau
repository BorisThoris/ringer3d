-- A generated map (Ringer.Maps) drawn on a table, each piece in the web game's own look
-- (src/render/mapPieces.ts): books with their page blocks, a pencil with its sharpened tip and
-- eraser, paper clips, mugs of coffee, pen pots, bricks, traffic cones, logs, rocks, sandcastles,
-- shells, ice blocks, the mini-golf rails, bumpers, speed pads and cups with their flags.
-- Ringer.Sim plays every shot on the map's own numbers, so these parts are only what players
-- see. Loose and breakable props are parts named "Prop<i>" (i: the piece's index) that the server
-- and the clients move with each shot; their details are welded to them and move along. Map units
-- are the web game's; a table is Config.MAP_SCALE times bigger.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Ringer.Config)
local Sim = require(ReplicatedStorage.Ringer.Sim)
local Playback = require(ReplicatedStorage.Ringer.Playback)

local Pieces = {}

local hex = Color3.fromHex
local S = Config.MAP_SCALE
local M = Enum.Material

local function part(props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = M.SmoothPlastic
	p.CanCollide = false
	p.CanTouch = false
	p.CanQuery = false
	for k, v in pairs(props) do
		(p :: any)[k] = v
	end
	return p
end

--- A detail on a piece: placed at `world` (a CFrame), welded to `main` so it moves with it.
local function deco(main: BasePart, world: CFrame, size: Vector3, color: Color3, material: Enum.Material?, shape: string?, extra: { [string]: any }?): BasePart
	local p = part({ Name = "Detail", Size = size, CFrame = world, Color = color, Material = material or M.SmoothPlastic, Anchored = false, Massless = true, CastShadow = size.Magnitude > 0.4 })
	if shape == "cyl" then
		p.Shape = Enum.PartType.Cylinder
	elseif shape == "ball" then
		p.Shape = Enum.PartType.Ball
	elseif shape == "ellipsoid" then
		local m = Instance.new("SpecialMesh")
		m.MeshType = Enum.MeshType.Sphere
		m.Parent = p
	end
	for k, v in pairs(extra or {}) do
		(p :: any)[k] = v
	end
	local w = Instance.new("Weld")
	w.Part0 = main
	w.Part1 = p
	w.C0 = main.CFrame:ToObjectSpace(world)
	w.Parent = p
	p.Parent = main
	return p
end

--- An upright cylinder (axis up) at `at`, as a CFrame for a Cylinder part.
local function up(at: Vector3): CFrame
	return CFrame.new(at) * CFrame.Angles(0, 0, math.pi / 2)
end

--- A cone built of stacked discs (Roblox has no cone part): base radius r0 to tip radius r1.
local function cone(main: BasePart, base: Vector3, r0: number, r1: number, h: number, color: Color3, material: Enum.Material?, steps: number?)
	local n = steps or 6
	for i = 0, n - 1 do
		local f = (i + 0.5) / n
		local r = r0 + (r1 - r0) * f
		deco(main, up(base + Vector3.new(0, h * f, 0)), Vector3.new(h / n * 1.02, r * 2, r * 2), color, material, "cyl")
	end
end

local function pick(rng: Random, list: { Color3 }): Color3
	return list[rng:NextInteger(1, #list)]
end

local BOOKS = { hex("#a8322d"), hex("#244c7a"), hex("#2f6b3a"), hex("#c99a2e"), hex("#5b2a6e"), hex("#1d1d1f") }
local SOLID_LOOK = {
	brick = { M.Brick, { hex("#a5462f"), hex("#93402c"), hex("#b5543a") } },
	kerbstone = { M.Concrete, { hex("#c9c3b8") } },
	slab = { M.Slate, { hex("#9a948b") } },
}

export type Built = {
	zones: { { pos: Vector2, r: number, effect: string, k: number, dir: Vector2 } },
	holes: { { pos: Vector2, r: number } },
	bumpers: { { pos: Vector2, r: number } },
}

Pieces.propCFrame = Playback.propCFrame

--- Build `map` on the table at `origin`. Positions in the returned lists are ring-relative studs.
function Pieces.build(map, origin: Vector3, parent: Instance): Built
	local folder = Instance.new("Folder")
	folder.Name = "Map"
	local out: Built = { zones = {}, holes = {}, bumpers = {} }
	local rng = Random.new((map.seed or 1) * 7 + #map.pieces)
	local arena = map.arena or ""
	local rockTone = if arena == "sand" then { hex("#b4a184"), hex("#a89070"), hex("#c2b192") } elseif arena == "ice" then { hex("#5f6a74"), hex("#6f7a84"), hex("#55606a") } else { hex("#7c776f"), hex("#6d6862"), hex("#8a8278"), hex("#5f5a54") }
	local pebbleTone = if arena == "ice" then { hex("#3d4650"), hex("#4a535d"), hex("#56606a") } elseif arena == "sand" then { hex("#8d7a62"), hex("#a08d74"), hex("#6f604f") } else { hex("#5d564d"), hex("#6b6157"), hex("#4a443e"), hex("#7a6f62"), hex("#836f5c") }

	for i, p in ipairs(map.pieces) do
		local skin = p.skin or p.kind
		local isProp = Sim.propTraits(p) ~= nil
		if p.kind == "wall" then
			local L, H, T = p.len * S, p.h * S, p.thick * S
			local cf = Pieces.propCFrame(p, { x = p.x, z = p.z, a = p.a }, origin)
			local main = part({ Name = if isProp then "Prop" .. i else skin, Size = Vector3.new(L, H, T), CFrame = cf, Parent = folder })
			if skin == "book" then
				main.Color, main.Material = pick(rng, BOOKS), M.Fabric
				deco(main, cf * CFrame.new(L * 0.02, 0, 0), Vector3.new(L * 0.96, H * 0.84, T * 1.01), hex("#efe6cf"), M.SmoothPlastic)
			elseif skin == "eraser" then
				main.Color = hex("#f2a7b8")
				deco(main, cf * CFrame.new(L * 0.2, 0, 0), Vector3.new(L * 0.5, H * 1.04, T * 1.04), hex("#2a6fd6"))
			elseif skin == "ruler" then
				main.Color, main.Material = hex("#f4efe2"), M.Wood
				for k = 0, 14 do
					local tick = if k % 5 == 0 then T * 0.45 else T * 0.25
					deco(main, cf * CFrame.new(-L / 2 + L * (k + 0.5) / 15, H / 2 + 0.005, -T / 2 + tick / 2), Vector3.new(0.06, 0.02, tick), hex("#2b2b2b"))
				end
			elseif SOLID_LOOK[skin] then
				main.Material, main.Color = SOLID_LOOK[skin][1], pick(rng, SOLID_LOOK[skin][2])
			elseif skin == "log" or skin == "driftwood" then
				-- A round log lying along the wall line, about as tall as the wall.
				local rad = math.max(H, T) / 2
				main.Transparency = 1
				local bark = if skin == "log" then hex("#5e4129") else hex("#bfb3a0")
				local body = cf * CFrame.new(0, rad - H / 2, 0)
				deco(main, body, Vector3.new(L, rad * 2, rad * 1.9), bark, M.Wood, "cyl")
				for _, e in ipairs({ -1, 1 }) do
					deco(main, body * CFrame.new(e * L / 2, 0, 0), Vector3.new(0.05, rad * 1.7, rad * 1.6), if skin == "log" then hex("#c9a272") else hex("#d8cfc0"), M.WoodPlanks, "cyl")
				end
			elseif skin == "iceblock" then
				main.Color, main.Material, main.Transparency, main.Reflectance = hex("#cfe8fb"), M.Glass, 0.3, 0.15
			elseif skin == "rail" then
				main.Color = hex("#f4efe4")
				deco(main, cf * CFrame.new(0, H / 2 - 0.2, 0), Vector3.new(L * 1.001, 0.24, T * 1.02), hex("#e5323f"))
			else
				main.Color, main.Material = hex("#9a948b"), M.Concrete
			end
		elseif p.kind == "post" then
			local r, h = p.r * S, p.h * S
			local cf = Pieces.propCFrame(p, { x = p.x, z = p.z, a = 0 }, origin)
			local main = part({ Name = if isProp then "Prop" .. i else skin, Shape = Enum.PartType.Cylinder, Size = Vector3.new(h, r * 2, r * 2), CFrame = cf, Parent = folder })
			local foot = origin + Vector3.new(p.x * S, 0, p.z * S)
			if skin == "rock" then
				main.Transparency = 1
				deco(main, CFrame.new(foot + Vector3.new(0, h * 0.32, 0)) * CFrame.Angles(0, rng:NextNumber() * 6, 0), Vector3.new(r * 2.16, h * 1.24, r * 2.16), pick(rng, rockTone), M.Slate, "ellipsoid")
			elseif skin == "mug" then
				local colour = pick(rng, { hex("#f4f1ea"), hex("#2a6fd6"), hex("#e5323f"), hex("#ffd23f") })
				main.Color, main.Reflectance = colour, 0.08
				deco(main, up(foot + Vector3.new(0, h + 0.01, 0)), Vector3.new(0.04, r * 1.76, r * 1.76), hex("#3b2414"), M.SmoothPlastic, "cyl", { Reflectance = 0.15 })
				local hx = foot + Vector3.new(r + 0.35, h * 0.55, 0)
				deco(main, CFrame.new(hx), Vector3.new(0.3, h * 0.5, 0.3), colour)
				for _, dy in ipairs({ -1, 1 }) do
					deco(main, CFrame.new(foot + Vector3.new(r + 0.1, h * 0.55 + dy * h * 0.22, 0)), Vector3.new(0.55, 0.3, 0.3), colour)
				end
			elseif skin == "pot" then
				main.Color = hex("#1f6fd1")
				for k = 0, 3 do
					local a = k / 4 * math.pi * 2
					local at = foot + Vector3.new(math.cos(a) * r * 0.45, h * 0.95, math.sin(a) * r * 0.45)
					deco(main, up(at) * CFrame.Angles(math.sin(a) * 0.18, 0, math.cos(a) * 0.18), Vector3.new(h * 0.9, 0.28, 0.28), pick(rng, { hex("#ffcc33"), hex("#ff5a2a"), hex("#1a7cff"), hex("#14c06c") }), M.SmoothPlastic, "cyl")
				end
			elseif skin == "cone" then
				main.Transparency = 1
				deco(main, CFrame.new(foot + Vector3.new(0, 0.12, 0)), Vector3.new(r * 2.4, 0.24, r * 2.4), hex("#ff6a1a"))
				cone(main, foot + Vector3.new(0, 0.24, 0), r, 0.14, h - 0.24, hex("#ff6a1a"), M.SmoothPlastic, 8)
				deco(main, up(foot + Vector3.new(0, h * 0.55, 0)), Vector3.new(h * 0.18, r * 1.24, r * 1.24), hex("#f6f6f2"), M.SmoothPlastic, "cyl", { Reflectance = 0.2 })
			elseif skin == "flowerpot" then
				main.Transparency = 1
				deco(main, up(foot + Vector3.new(0, h * 0.25, 0)), Vector3.new(h * 0.5, r * 1.6, r * 1.6), hex("#b8592f"), M.Slate, "cyl")
				deco(main, up(foot + Vector3.new(0, h * 0.75, 0)), Vector3.new(h * 0.5, r * 2, r * 2), hex("#b8592f"), M.Slate, "cyl")
				deco(main, up(foot + Vector3.new(0, h - 0.1, 0)), Vector3.new(0.05, r * 1.84, r * 1.84), hex("#3a2718"), M.Ground, "cyl")
				for _ = 1, 5 do
					deco(main, CFrame.new(foot + Vector3.new(rng:NextNumber(-r, r) * 0.45, h + r * 0.35 + rng:NextNumber() * r * 0.3, rng:NextNumber(-r, r) * 0.45)), Vector3.one * r * 0.76, pick(rng, { hex("#3f8a2e"), hex("#4f9e35"), hex("#2f7426") }), M.LeafyGrass, "ball")
				end
			elseif skin == "sandcastle" then
				main.Transparency = 1
				local y = 0
				for _, tier in ipairs({ { r, h * 0.5 }, { r * 0.68, h * 0.32 }, { r * 0.42, h * 0.22 } }) do
					deco(main, up(foot + Vector3.new(0, y + tier[2] / 2, 0)), Vector3.new(tier[2], tier[1] * 2, tier[1] * 2), hex("#d8c39b"), M.Sand, "cyl")
					y += tier[2]
				end
				for k = 0, 5 do
					local a = k / 6 * math.pi * 2
					deco(main, CFrame.new(foot + Vector3.new(math.cos(a) * r * 0.36, y + 0.14, math.sin(a) * r * 0.36)), Vector3.one * 0.28, hex("#d8c39b"), M.Sand)
				end
			elseif skin == "railpost" then
				main.Color = hex("#f4efe4")
				deco(main, CFrame.new(foot + Vector3.new(0, h, 0)), Vector3.one * r * 2.2, hex("#e5323f"), M.SmoothPlastic, "ball")
			else
				main.Color, main.Material = hex("#9a948b"), M.Concrete
			end
		elseif p.kind == "bumper" then
			local r, h = p.r * S, Sim.BUMPER_H * S
			local cf = Pieces.propCFrame(p, { x = p.x, z = p.z, a = 0 }, origin)
			local main = part({ Name = if isProp then "Prop" .. i else "bumper", Shape = Enum.PartType.Cylinder, Size = Vector3.new(h, r * 1.76, r * 1.76), CFrame = cf, Color = hex("#f4f1ea"), Reflectance = 0.1, Parent = folder })
			local foot = origin + Vector3.new(p.x * S, 0, p.z * S)
			-- The red rubber ring, and the yellow cap that lights up.
			deco(main, up(foot + Vector3.new(0, h * 0.45, 0)), Vector3.new(0.64, r * 2.1, r * 2.1), hex("#ff3d55"), M.Rubber, "cyl")
			deco(main, up(foot + Vector3.new(0, h + 0.08, 0)), Vector3.new(0.16, r, r), hex("#ffd23f"), M.Neon, "cyl", { Name = "Cap" })
			table.insert(out.bumpers, { pos = Vector2.new(p.x * S, p.z * S), r = r })
		elseif p.kind == "bump" then
			-- The cap of a buried sphere: `sink` of it is under the ground.
			local r = p.r * S
			local top = 2 * r * (1 - p.sink)
			local capR = math.sqrt(math.max(0, r * r - (r - top) * (r - top)))
			local at = origin + Vector3.new(p.x * S, r * (1 - 2 * p.sink), p.z * S)
			local foot = origin + Vector3.new(p.x * S, 0, p.z * S)
			local main = part({ Name = skin, Shape = Enum.PartType.Ball, Size = Vector3.one * r * 2, CFrame = CFrame.new(at), Parent = folder })
			if skin == "coin" or skin == "coin-silver" then
				local gold = skin == "coin"
				main.Transparency = 1
				deco(main, up(foot + Vector3.new(0, top / 2, 0)), Vector3.new(top, capR * 2, capR * 2), if gold then hex("#d9ae3f") else hex("#c9ccd2"), M.Metal, "cyl", { Reflectance = 0.35 })
				deco(main, up(foot + Vector3.new(0, top + 0.01, 0)), Vector3.new(0.02, capR * 1.6, capR * 1.6), if gold then hex("#b8902c") else hex("#a9acb2"), M.Metal, "cyl")
			elseif skin == "cap" then
				main.Transparency = 1
				deco(main, up(foot + Vector3.new(0, top / 2, 0)), Vector3.new(top, capR * 2, capR * 2), pick(rng, { hex("#d1262f"), hex("#1f5fbf"), hex("#2a8f3a"), hex("#e3b21f") }), M.Metal, "cyl", { Reflectance = 0.25 })
			elseif skin == "molehill" then
				main.Color, main.Material = hex("#5a3e28"), M.Ground
			elseif skin == "shell" then
				main.Transparency = 1
				deco(main, CFrame.new(foot) * CFrame.Angles(0, rng:NextNumber() * 6, 0), Vector3.new(capR * 2.6, (top * 1.1 + 0.08) * 2, capR * 2), pick(rng, { hex("#f3e3cf"), hex("#f0cdbb"), hex("#e8d8c0") }), M.SmoothPlastic, "ellipsoid", { Reflectance = 0.1 })
			else
				-- Pebbles and stones: each squashed and turned its own way.
				main.Transparency = 1
				deco(main, CFrame.new(at) * CFrame.Angles(rng:NextNumber() * 3, rng:NextNumber() * 3, rng:NextNumber() * 3), Vector3.new(r * 2.5, r * 2.2, r * 2.4), pick(rng, if skin == "stone" then { hex("#4f4a44"), hex("#5d5750"), hex("#3f3a35"), hex("#6a635a") } else pebbleTone), M.Slate, "ellipsoid")
			end
		elseif p.kind == "ridge" then
			local a = Vector3.new(p.x1 * S, 0, p.z1 * S)
			local b = Vector3.new(p.x2 * S, 0, p.z2 * S)
			local len = (b - a).Magnitude
			if len > 0.01 then
				local r = p.r * S
				local mid = origin + (a + b) / 2
				-- Along local +X, lying on the ground at height y.
				local function lay(y: number): CFrame
					return CFrame.lookAt(mid + Vector3.new(0, y, 0), mid + Vector3.new(0, y, 0) + (b - a)) * CFrame.Angles(0, math.pi / 2, 0)
				end
				local main = part({ Name = skin, Size = Vector3.new(len, 0.05, math.max(0.1, r)), CFrame = lay(0.02), Transparency = 1, Parent = folder })
				if skin == "pencil" then
					local body = lay(r * 0.65)
					local colour = pick(rng, { hex("#ffcc33"), hex("#ffcc33"), hex("#2a6fd6"), hex("#e5323f") })
					deco(main, body * CFrame.new(-len * 0.03, 0, 0), Vector3.new(len * 0.8, r * 2, r * 2), colour, M.SmoothPlastic, "cyl")
					-- The sharpened wood and its lead.
					for k = 0, 3 do
						local f = (k + 0.5) / 4
						deco(main, body * CFrame.new(len * (0.37 + f * 0.1), 0, 0), Vector3.new(len * 0.026, r * 2 * (1 - f * 0.8), r * 2 * (1 - f * 0.8)), if f > 0.75 then hex("#2b2b2b") else hex("#e7c9a0"), M.Wood, "cyl")
					end
					deco(main, body * CFrame.new(-len * 0.44, 0, 0), Vector3.new(len * 0.05, r * 2.04, r * 2.04), hex("#b8bcc4"), M.Metal, "cyl")
					deco(main, body * CFrame.new(-len * 0.485, 0, 0), Vector3.new(len * 0.04, r * 1.9, r * 1.9), hex("#ff8fa3"), M.SmoothPlastic, "cyl")
				elseif skin == "paperclip" then
					local w = len * 0.28
					local wire = math.max(0.12, r * 1.1)
					local base = lay(r * 0.55)
					local function line(x1, z1, x2, z2)
						local p1, p2 = Vector3.new(x1, 0, z1), Vector3.new(x2, 0, z2)
						local m = (p1 + p2) / 2
						local l = (p2 - p1).Magnitude
						deco(main, base * CFrame.lookAt(m, m + (p2 - p1)) * CFrame.Angles(0, math.pi / 2, 0), Vector3.new(l + wire, wire, wire), hex("#c8ccd2"), M.Metal, "cyl", { Reflectance = 0.3 })
					end
					line(-len / 2, 0, -len / 2 + w * 0.3, w / 2)
					line(-len / 2 + w * 0.3, w / 2, len / 2 - w * 0.3, w / 2)
					line(len / 2 - w * 0.3, w / 2, len / 2, 0)
					line(len / 2, 0, len / 2 - w * 0.3, -w / 2)
					line(len / 2 - w * 0.3, -w / 2, -len / 2 + w * 0.6, -w / 2)
					line(-len / 2 + w * 0.6, -w / 2, -len / 2 + w * 0.4, 0)
					line(-len / 2 + w * 0.4, 0, len / 2 - w * 0.6, w * 0.18)
				elseif skin == "twig" then
					local body = lay(r * 0.7)
					deco(main, body, Vector3.new(len, r * 1.8, r * 1.8), hex("#5a3f28"), M.Wood, "cyl")
					deco(main, body * CFrame.new(len * 0.15, 0, len * 0.06) * CFrame.Angles(0, -0.6, 0), Vector3.new(len * 0.35, r, r), hex("#5a3f28"), M.Wood, "cyl")
				else
					-- A crack: a dark line in the slab, or a white one in the ice.
					local ice = skin == "icecrack"
					deco(main, lay(0.02), Vector3.new(len + r, 0.03, math.max(0.18, r * 1.3)), if ice then hex("#f2fbff") else hex("#2a2826"), M.SmoothPlastic, nil, { Transparency = 0.1, CastShadow = false })
				end
			end
		elseif p.kind == "zone" then
			local r = p.r * S
			local at = origin + Vector3.new(p.x * S, 0.04 + i * 0.0005, p.z * S)
			local main = part({ Name = skin or "Patch", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.05, r * 2.24, r * 2.24), CFrame = up(at), CastShadow = false, Parent = folder })
			if p.effect == "boost" then
				-- A glowing pad with chevrons pointing along its push.
				main.Size = Vector3.new(0.05, r * 2, r * 2)
				main.Color, main.Material = hex("#ffd23f"), M.Neon
				local d = Vector3.new(math.cos(p.a), 0, math.sin(p.a))
				for k = -1, 1 do
					local c = at + Vector3.new(0, 0.04, 0) + d * (k * r * 0.45)
					local face = CFrame.lookAt(c, c + d)
					for _, side in ipairs({ -1, 1 }) do
						deco(main, face * CFrame.new(side * r * 0.2, 0, r * 0.1) * CFrame.Angles(0, side * 0.8, 0), Vector3.new(0.3, 0.03, r * 0.6), hex("#ff3d2a"), M.Neon, nil, { CastShadow = false })
					end
				end
			elseif skin == "paper" then
				-- A sheet of ruled paper, lying askew.
				main.Transparency = 1
				local s = r * 1.5
				local sheet = CFrame.new(at) * CFrame.Angles(0, rng:NextNumber() * math.pi, 0)
				deco(main, sheet, Vector3.new(s * 0.78, 0.03, s), hex("#fbfaf4"), M.SmoothPlastic, nil, { CastShadow = false })
				for k = 1, 9 do
					deco(main, sheet * CFrame.new(0, 0.02, -s / 2 + s * k / 10), Vector3.new(s * 0.74, 0.01, 0.04), hex("#9cc3e6"), M.SmoothPlastic, nil, { CastShadow = false })
				end
				deco(main, sheet * CFrame.new(-s * 0.26, 0.02, 0), Vector3.new(0.04, 0.01, s * 0.98), hex("#e58b8b"), M.SmoothPlastic, nil, { CastShadow = false })
			elseif skin == "coffee" then
				main.Color, main.Transparency, main.Reflectance = hex("#6b4425"), 0.45, 0.1
				deco(main, up(at + Vector3.new(0, 0.01, 0)), Vector3.new(0.05, r * 1.7, r * 1.7), hex("#8a5a33"), M.SmoothPlastic, "cyl", { Transparency = 0.6, CastShadow = false })
			else
				local LOOK = {
					puddle = { hex("#28323c"), M.Glass, 0.2, 0.35 },
					mud = { hex("#6e5236"), M.Mud, 0.1, 0 },
					wetsand = { hex("#8a7553"), M.Sand, 0.15, 0.05 },
					blackice = { hex("#24384a"), M.Ice, 0.2, 0.3 },
					snow = { hex("#f6f9fc"), M.Snow, 0, 0 },
				}
				local look = LOOK[skin] or (if p.effect == "sticky" then LOOK.mud else LOOK.puddle)
				main.Color, main.Material, main.Transparency, main.Reflectance = look[1], look[2], look[3], look[4]
			end
			table.insert(out.zones, { pos = Vector2.new(p.x * S, p.z * S), r = r, effect = p.effect, k = p.k or (p.effect == "sticky" and 2.2 or p.effect == "slick" and 0.2 or 1), dir = Vector2.new(math.cos(p.a), math.sin(p.a)) })
		elseif p.kind == "hole" then
			local r = p.r * S
			local at = origin + Vector3.new(p.x * S, 0.05, p.z * S)
			local main = part({ Name = "Cup", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.06, r * 2, r * 2), CFrame = up(at), Color = hex("#07060a"), CastShadow = false, Parent = folder })
			-- The white lip.
			for k = 0, 15 do
				local a = k / 16 * math.pi * 2
				local c = at + Vector3.new(math.cos(a) * r, 0.03, math.sin(a) * r)
				deco(main, CFrame.lookAt(c, Vector3.new(at.X, c.Y, at.Z)) * CFrame.Angles(0, math.pi / 2, 0), Vector3.new(2 * math.pi * r / 16 * 1.1, 0.12, 0.16), hex("#f2f2f2"), M.Metal)
			end
			if skin == "cup" then
				-- The flag stands at the back of the cup, out of the way of a marble dropping in.
				local back = math.atan2(p.z, p.x)
				local fp = at + Vector3.new(math.cos(back) * r * 0.75, 0, math.sin(back) * r * 0.75)
				deco(main, up(fp + Vector3.new(0, 2.2, 0)), Vector3.new(4.4, 0.14, 0.14), hex("#f4f1ea"), M.SmoothPlastic, "cyl")
				deco(main, CFrame.new(fp + Vector3.new(0.84, 3.8, 0)), Vector3.new(1.68, 1.04, 0.05), pick(rng, { hex("#e5323f"), hex("#ffd23f"), hex("#1a7cff") }), M.Fabric, nil, { Name = "Flag" })
			end
			table.insert(out.holes, { pos = Vector2.new(p.x * S, p.z * S), r = r })
		end
	end
	folder.Parent = parent
	return out
end


--- The solid pieces as the bot sees them: posts and bumpers as circles, walls as segments
--- (ring-relative studs). Low lumps and lying ridges can be rolled over.
function Pieces.obstacles(map)
	local out = {}
	for _, p in ipairs(map.pieces) do
		if p.kind == "post" or p.kind == "bumper" then
			table.insert(out, { kind = "circle", pos = Vector2.new(p.x * S, p.z * S), r = p.r * S })
		elseif p.kind == "bump" and p.r * 2 * (1 - p.sink) * S > Config.SHOOTER_R * 0.3 then
			-- A lump whose cap stands over a third of a shooter's radius throws a fast shot back.
			table.insert(out, { kind = "circle", pos = Vector2.new(p.x * S, p.z * S), r = p.r * 0.8 * S })
		elseif p.kind == "wall" then
			local half = Vector2.new(math.cos(p.a), math.sin(p.a)) * (p.len * S / 2)
			local c = Vector2.new(p.x * S, p.z * S)
			table.insert(out, { kind = "seg", a = c - half, b = c + half, r = p.thick * S / 2 })
		end
	end
	return out
end

-- Web physics constants, in Roblox studs (web units x MAP_SCALE).
Pieces.BOOST = 22 * S -- a speed pad's push, per second
Pieces.HOLE_SPEED = 7 * S -- a cup takes marbles slower than this
Pieces.BUMPER_KICK = 1.3 -- a bumper sends a marble back faster than it came

return Pieces
