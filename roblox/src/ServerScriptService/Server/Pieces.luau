-- A generated map (Ringer.Maps) built on a table: walls, posts, bumpers, sunk-sphere bumps and
-- lying ridges are anchored parts the marbles really hit; ground patches (paper, puddles, mud,
-- black ice, speed pads) and mini-golf cups are painted on and act in Table:roll, the way the web
-- game's physics does it (patches scale the rolling resistance, pads push, cups swallow slow
-- marbles). Map units are the web game's; a table is Config.MAP_SCALE times bigger.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Ringer.Config)

local Pieces = {}

local rgb = Color3.fromRGB
local S = Config.MAP_SCALE

-- What each skin looks like: colour, material, and for patches a little see-through.
local SKIN = {
	book = { rgb(255, 75, 75), rgb(255, 205, 40), rgb(60, 150, 255), rgb(150, 90, 240) },
	eraser = { rgb(255, 140, 170) },
	ruler = { rgb(240, 200, 120) },
	mug = { rgb(250, 250, 250), rgb(90, 200, 255) },
	pot = { rgb(60, 150, 255) },
	coin = { rgb(255, 200, 60) },
	["coin-silver"] = { rgb(210, 215, 225) },
	paperclip = { rgb(200, 205, 215) },
	pencil = { rgb(255, 205, 40) },
	paper = { rgb(252, 250, 242) },
	coffee = { rgb(120, 70, 35) },
	brick = { rgb(220, 90, 60) },
	kerbstone = { rgb(200, 200, 210) },
	cone = { rgb(255, 120, 30) },
	crack = { rgb(40, 40, 60) },
	puddle = { rgb(60, 130, 220) },
	stone = { rgb(150, 150, 160) },
	cap = { rgb(255, 75, 75) },
	molehill = { rgb(120, 80, 50) },
	mud = { rgb(100, 70, 40) },
	twig = { rgb(130, 90, 55) },
	rock = { rgb(140, 135, 130) },
	log = { rgb(150, 100, 60) },
	flowerpot = { rgb(220, 110, 70) },
	wetsand = { rgb(190, 160, 110) },
	shell = { rgb(255, 205, 190) },
	pebble = { rgb(160, 155, 150) },
	driftwood = { rgb(215, 190, 150) },
	sandcastle = { rgb(235, 205, 140) },
	icecrack = { rgb(255, 255, 255) },
	blackice = { rgb(25, 40, 70) },
	snow = { rgb(250, 252, 255) },
	iceblock = { rgb(200, 240, 255) },
	slab = { rgb(180, 180, 190) },
	rail = { rgb(255, 255, 255) },
	railpost = { rgb(255, 255, 255) },
	bumper = { rgb(255, 210, 60) },
	cup = { rgb(15, 12, 20) },
	pad = { rgb(255, 220, 50) },
}

local function colorOf(skin: string?, i: number): Color3
	local list = SKIN[skin or ""] or { rgb(230, 230, 230) }
	return list[(i - 1) % #list + 1]
end

local function part(props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	for k, v in pairs(props) do
		(p :: any)[k] = v
	end
	return p
end

local SOLID = PhysicalProperties.new(3, 0.4, 0.55, 1, 1)
local BOUNCY = PhysicalProperties.new(3, 0.2, 1, 1, 100)

export type Built = {
	zones: { { pos: Vector2, r: number, effect: string, k: number, dir: Vector2 } },
	holes: { { pos: Vector2, r: number } },
	bumpers: { { pos: Vector2, r: number } },
}

--- Build `map` on the table at `origin`. Positions in the returned lists are ring-relative studs.
function Pieces.build(map, origin: Vector3, parent: Instance): Built
	local folder = Instance.new("Folder")
	folder.Name = "Map"
	local out: Built = { zones = {}, holes = {}, bumpers = {} }
	local y0 = origin.Y
	for i, p in ipairs(map.pieces) do
		local skin = p.skin
		if p.kind == "wall" then
			part({
				Name = skin or "Wall",
				Size = Vector3.new(p.len * S, p.h * S, p.thick * S),
				-- Length along the map's angle a: rotating +X by -a about Y points it at (cos a, sin a).
				CFrame = CFrame.new(origin + Vector3.new(p.x * S, p.h * S / 2, p.z * S)) * CFrame.Angles(0, -p.a, 0),
				Color = colorOf(skin, i),
				Material = if skin == "iceblock" then Enum.Material.Glass else Enum.Material.SmoothPlastic,
				Transparency = if skin == "iceblock" then 0.25 else 0,
				CustomPhysicalProperties = SOLID,
				Parent = folder,
			})
		elseif p.kind == "post" or p.kind == "bumper" then
			local h = (p.h or 0.4) * S
			part({
				Name = skin or p.kind,
				Shape = Enum.PartType.Cylinder,
				Size = Vector3.new(h, p.r * 2 * S, p.r * 2 * S),
				CFrame = CFrame.new(origin + Vector3.new(p.x * S, h / 2, p.z * S)) * CFrame.Angles(0, 0, math.pi / 2),
				Color = colorOf(skin, i),
				Material = if p.kind == "bumper" then Enum.Material.Neon else Enum.Material.SmoothPlastic,
				CustomPhysicalProperties = if p.kind == "bumper" then BOUNCY else SOLID,
				Parent = folder,
			})
			if p.kind == "bumper" then
				table.insert(out.bumpers, { pos = Vector2.new(p.x * S, p.z * S), r = p.r * S })
			end
		elseif p.kind == "bump" then
			-- A sunk sphere: `sink` of it is under the ground, the cap stands proud.
			local r = p.r * S
			part({
				Name = skin or "Bump",
				Shape = Enum.PartType.Ball,
				Size = Vector3.new(r * 2, r * 2, r * 2),
				CFrame = CFrame.new(origin + Vector3.new(p.x * S, r * (1 - 2 * p.sink), p.z * S)),
				Color = colorOf(skin, i),
				Material = if skin == "coin" or skin == "coin-silver" then Enum.Material.Metal else Enum.Material.SmoothPlastic,
				CustomPhysicalProperties = SOLID,
				Parent = folder,
			})
		elseif p.kind == "ridge" then
			local a = Vector3.new(p.x1 * S, 0, p.z1 * S)
			local b = Vector3.new(p.x2 * S, 0, p.z2 * S)
			local len = (b - a).Magnitude
			if len > 0.01 then
				local r = p.r * S
				local mid = origin + (a + b) / 2 + Vector3.new(0, r * 0.6, 0)
				part({
					Name = skin or "Ridge",
					Shape = Enum.PartType.Cylinder,
					Size = Vector3.new(len, r * 2, r * 2),
					CFrame = CFrame.lookAt(mid, mid + (b - a)) * CFrame.Angles(0, math.pi / 2, 0),
					Color = colorOf(skin, i),
					CustomPhysicalProperties = SOLID,
					Parent = folder,
				})
			end
		elseif p.kind == "zone" then
			local r = p.r * S
			part({
				Name = skin or "Patch",
				Shape = Enum.PartType.Cylinder,
				Size = Vector3.new(0.05, r * 2, r * 2),
				CFrame = CFrame.new(origin + Vector3.new(p.x * S, 0.04 + i * 0.0005, p.z * S)) * CFrame.Angles(0, 0, math.pi / 2),
				Color = colorOf(skin, i),
				Material = if p.effect == "boost" then Enum.Material.Neon else Enum.Material.SmoothPlastic,
				Transparency = if p.effect == "boost" then 0.1 else 0.15,
				CanCollide = false,
				CanQuery = false,
				CanTouch = false,
				CastShadow = false,
				Parent = folder,
			})
			if p.effect == "boost" then
				-- An arrow along the pad's push.
				local d = Vector3.new(math.cos(p.a), 0, math.sin(p.a))
				local at = origin + Vector3.new(p.x * S, 0.09, p.z * S)
				part({ Name = "Arrow", Size = Vector3.new(0.35, 0.04, r * 1.2), CFrame = CFrame.lookAt(at, at + d), Color = rgb(255, 80, 80), CanCollide = false, CanQuery = false, CanTouch = false, CastShadow = false, Parent = folder })
			end
			table.insert(out.zones, { pos = Vector2.new(p.x * S, p.z * S), r = r, effect = p.effect, k = p.k or (p.effect == "sticky" and 2.2 or p.effect == "slick" and 0.2 or 1), dir = Vector2.new(math.cos(p.a), math.sin(p.a)) })
		elseif p.kind == "hole" then
			local r = p.r * S
			local at = origin + Vector3.new(p.x * S, 0.05, p.z * S)
			part({ Name = "Cup", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.06, r * 2, r * 2), CFrame = CFrame.new(at) * CFrame.Angles(0, 0, math.pi / 2), Color = colorOf("cup", 1), CanCollide = false, CanQuery = false, CanTouch = false, CastShadow = false, Parent = folder })
			part({ Name = "Flag", Size = Vector3.new(0.12, 3.2, 0.12), CFrame = CFrame.new(at + Vector3.new(r * 0.7, 1.6, 0)), Color = rgb(255, 255, 255), CanCollide = false, CanQuery = false, CanTouch = false, Parent = folder })
			part({ Name = "Pennant", Size = Vector3.new(0.05, 0.7, 1.1), CFrame = CFrame.new(at + Vector3.new(r * 0.7, 2.8, 0.55)), Color = rgb(255, 60, 60), CanCollide = false, CanQuery = false, CanTouch = false, Parent = folder })
			table.insert(out.holes, { pos = Vector2.new(p.x * S, p.z * S), r = r })
		end
	end
	folder.Parent = parent
	return out
end

-- Web physics constants, in Roblox studs (web units x MAP_SCALE).
Pieces.BOOST = 22 * S -- a speed pad's push, per second
Pieces.HOLE_SPEED = 7 * S -- a cup takes marbles slower than this
Pieces.BUMPER_KICK = 1.3 -- a bumper sends a marble back faster than it came

return Pieces
