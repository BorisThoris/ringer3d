-- The downhill race: Marble Mountain. Builds the track and its world once (track from RaceTrack's
-- frames, the mountain in terrain, forests, cliffs, the waterfall, clouds, the lake at the finish),
-- runs each player's race (they race on their own client on RaceSim; the server replays the input
-- log on the same deterministic sim to verify the time), and keeps records: personal bests, a
-- global leaderboard, medals and coins.

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local RaceTrack = require(ReplicatedStorage.Ringer.RaceTrack)
local RaceSim = require(ReplicatedStorage.Ringer.RaceSim)
local Data = require(script.Parent.Data)
local Economy = require(script.Parent.Economy)

local Race = {}

-- Medal times (seconds), set from the bots: the expert takes both shortcuts in 37.0 s; the clean
-- main route is 49.5 s.
Race.MEDALS = { { "Gold", 39.5, 120 }, { "Silver", 45, 70 }, { "Bronze", 54, 40 } }
Race.FINISH_COINS = 20
-- The light the client sets while racing (also the preview's).
Race.LIGHT = { clock = 15.8, sky = { 110, 175, 255 }, horizon = { 255, 220, 200 }, fog = { 225, 225, 245 }, density = 0.12, sun = { 255, 236, 205 } }

local rgb = Color3.fromRGB

local function part(parent: Instance, props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanTouch = false
	p.CanQuery = false
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	for k, v in pairs(props) do
		(p :: any)[k] = v
	end
	p.Parent = parent
	return p
end

local function ball(parent: Instance, at: Vector3, size: Vector3, color: Color3, material: Enum.Material?): Part
	local p = part(parent, { Size = size, CFrame = CFrame.new(at), Color = color, Material = material or Enum.Material.SmoothPlastic })
	local m = Instance.new("SpecialMesh")
	m.MeshType = Enum.MeshType.Sphere
	m.Parent = p
	return p
end

-- Each section's colours: track floor (two tones, alternating for a sense of speed), walls, trim.
local THEME = {
	["Summit Drop"] = { rgb(235, 245, 255), rgb(210, 230, 250), rgb(90, 170, 255), rgb(255, 255, 255) },
	["Snowcap Esses"] = { rgb(235, 245, 255), rgb(210, 230, 250), rgb(120, 140, 255), rgb(255, 255, 255) },
	["The Fork"] = { rgb(255, 235, 150), rgb(255, 215, 110), rgb(255, 120, 80), rgb(255, 255, 255) },
	["Ice Bridge"] = { rgb(170, 225, 255), rgb(140, 205, 250), rgb(255, 255, 255), rgb(255, 255, 255) },
	["Pillar Spiral"] = { rgb(255, 190, 220), rgb(255, 165, 205), rgb(170, 100, 255), rgb(255, 255, 255) },
	["Pine Canyon"] = { rgb(200, 235, 160), rgb(175, 220, 135), rgb(255, 150, 60), rgb(255, 255, 255) },
	["Canyon Leap"] = { rgb(255, 225, 120), rgb(255, 200, 80), rgb(255, 80, 80), rgb(255, 255, 255) },
	["Corkscrew"] = { rgb(255, 180, 150), rgb(255, 155, 125), rgb(70, 160, 255), rgb(255, 255, 255) },
	["Waterfall Chute"] = { rgb(150, 220, 255), rgb(120, 200, 245), rgb(40, 120, 230), rgb(255, 255, 255) },
	["Glow Tunnel"] = { rgb(120, 90, 200), rgb(100, 70, 180), rgb(255, 90, 220), rgb(120, 255, 240) },
	["Valley Sprint"] = { rgb(190, 240, 150), rgb(165, 228, 125), rgb(255, 200, 50), rgb(255, 255, 255) },
	["Finish"] = { rgb(255, 255, 255), rgb(40, 40, 50), rgb(255, 80, 120), rgb(255, 255, 255) },
}
local function theme(section: string)
	return THEME[section] or THEME["Valley Sprint"]
end

local function frameCF(f: RaceTrack.Frame, u: number, h: number): CFrame
	local p = RaceTrack.world(f, u, h)
	-- Columns: right, up, back (-tangent).
	return CFrame.fromMatrix(p, Vector3.new(f.rx, f.ry, f.rz), Vector3.new(f.ux, f.uy, f.uz), Vector3.new(-f.tx, -f.ty, -f.tz))
end

--- The track itself: floor slabs, walls with a rail on top, tunnel rings, boost chevrons, and signs.
local function buildPath(folder: Folder, path: RaceTrack.Path, main: RaceTrack.Path?)
	local seg = 1 -- frames per piece (4 studs): short enough that banked curves stay smooth
	local fs = path.frames
	local lastSection = ""
	for i = 1, #fs - seg, seg do
		local a, b = fs[i], fs[i + seg]
		-- A branch shares the main path's floor where it leaves and rejoins: draw only its own part.
		if main and path ~= main then
			local _, u, h, along = RaceTrack.nearest(main, a.x, a.y, a.z, 0, main.length)
			if along < RaceTrack.STEP and math.abs(h) < 6 then
				local mf = RaceTrack.frame(main, (RaceTrack.nearest(main, a.x, a.y, a.z, 0, main.length)))
				if math.abs(u) < mf.w / 2 + 1 then
					continue
				end
			end
		end
		local mid = RaceTrack.frame(path, (i - 1 + seg / 2) * RaceTrack.STEP)
		local len = math.sqrt((b.x - a.x) ^ 2 + (b.y - a.y) ^ 2 + (b.z - a.z) ^ 2) + 0.6
		local th = theme(a.section)
		local stripe = (i // 2) % 2 == 0
		if a.floor and b.floor then
			local floor = part(folder, { Name = "Track", Size = Vector3.new(mid.w, 1.6, len), CFrame = frameCF(mid, 0, -0.8), Color = if stripe then th[1] else th[2], Material = Enum.Material.SmoothPlastic })
			floor.CanCollide = true
			-- Edge trim lines along both sides.
			for _, sd in ipairs({ -1, 1 }) do
				part(folder, { Name = "Trim", Size = Vector3.new(0.8, 0.1, len), CFrame = frameCF(mid, sd * (mid.w / 2 - 1.2), 0.03), Color = th[4] })
			end
			-- Underside beam, so the track reads as a built thing and not a ribbon.
			part(folder, { Name = "Beam", Size = Vector3.new(mid.w * 0.5, 3, len), CFrame = frameCF(mid, 0, -3.1), Color = th[3]:Lerp(Color3.new(0, 0, 0), 0.3) })
		end
		if a.walls and a.floor and i % 2 == 1 and fs[i + 2] then
			local mid2 = RaceTrack.frame(path, i * RaceTrack.STEP)
			len = math.sqrt((fs[i + 2].x - a.x) ^ 2 + (fs[i + 2].y - a.y) ^ 2 + (fs[i + 2].z - a.z) ^ 2) + 0.6
			mid = mid2
			for _, sd in ipairs({ -1, 1 }) do
				part(folder, { Name = "Wall", Size = Vector3.new(1.2, RaceTrack.WALL_H, len), CFrame = frameCF(mid, sd * (mid.w / 2 + 0.6), RaceTrack.WALL_H / 2 - 0.5), Color = th[3] })
				part(folder, { Name = "Rail", Size = Vector3.new(1.6, 0.6, len), CFrame = frameCF(mid, sd * (mid.w / 2 + 0.6), RaceTrack.WALL_H - 0.2), Color = th[4] })
			end
		end
		if a.roof and i % 4 == 1 then
			-- Rings of light: an arch of glowing segments over the tunnel.
			local r = mid.w / 2 + 3
			for k = 0, 8 do
				local ang = k / 8 * math.pi
				local u, h = math.cos(ang) * r, math.sin(ang) * r * 0.8
				part(folder, { Name = "Ring", Size = Vector3.new(4, 1.2, 1.2), CFrame = frameCF(mid, u, h) * CFrame.Angles(0, 0, ang + math.pi / 2), Color = if (i // 4) % 2 == 0 then th[3] else th[4], Material = Enum.Material.Neon })
			end
			part(folder, { Name = "TunnelShell", Size = Vector3.new(mid.w + 14, 1, len * 2), CFrame = frameCF(mid, 0, r * 0.8 + 2), Color = rgb(90, 80, 110), Material = Enum.Material.Rock })
		end
		if a.boost > 0 and a.floor then
			-- Chevrons pointing down the track.
			for _, sd in ipairs({ -1, 1 }) do
				part(folder, { Name = "Boost", Size = Vector3.new(1.2, 0.12, 6), CFrame = frameCF(mid, sd * 3, 0.06) * CFrame.Angles(0, sd * 0.6, 0), Color = rgb(255, 230, 60), Material = Enum.Material.Neon })
			end
		end
		if a.section ~= lastSection then
			lastSection = a.section
			local sign = part(folder, { Name = "SectionSign", Size = Vector3.one, CFrame = frameCF(mid, 0, 14), Transparency = 1 })
			local gui = Instance.new("BillboardGui")
			gui.Size = UDim2.fromScale(26, 4.2)
			gui.LightInfluence = 0
			gui.MaxDistance = 260
			gui.Parent = sign
			local l = Instance.new("TextLabel")
			l.BackgroundTransparency = 1
			l.Size = UDim2.fromScale(1, 1)
			l.Font = Enum.Font.FredokaOne
			l.TextScaled = true
			l.Text = string.upper(a.section)
			l.TextColor3 = Color3.new(1, 1, 1)
			l.Parent = gui
			local st = Instance.new("UIStroke")
			st.Thickness = 3
			st.Color = rgb(30, 22, 40)
			st.Parent = l
		end
	end
end

-- Gates: start, checkpoints, finish. Two posts and a banner across the track, standing upright
-- whatever the track's bank.
local function upright(f: RaceTrack.Frame): RaceTrack.Frame
	local rx, rz = -f.tz, f.tx
	local m = math.max(1e-6, math.sqrt(rx * rx + rz * rz))
	local g = table.clone(f)
	g.rx, g.ry, g.rz = rx / m, 0, rz / m
	g.ux, g.uy, g.uz = 0, 1, 0
	return g
end
local function gate(folder: Folder, f0: RaceTrack.Frame, text: string, color: Color3, big: boolean?)
	local f = upright(f0)
	local h = if big then 20 else 13
	for _, sd in ipairs({ -1, 1 }) do
		part(folder, { Name = "GatePost", Shape = Enum.PartType.Cylinder, Size = Vector3.new(h, 2.4, 2.4), CFrame = frameCF(f, sd * (f.w / 2 + 2), h / 2) * CFrame.Angles(0, 0, math.pi / 2), Color = rgb(255, 255, 255) })
		ball(folder, RaceTrack.world(f, sd * (f.w / 2 + 2), h + 1), Vector3.new(3.4, 3.4, 3.4), color, Enum.Material.Neon)
	end
	local banner = part(folder, { Name = "Banner", Size = Vector3.new(f.w + 4, if big then 6 else 4, 0.6), CFrame = frameCF(f, 0, h - 2), Color = color })
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Back
	gui.LightInfluence = 0
	gui.PixelsPerStud = 24
	gui.Parent = banner
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Size = UDim2.fromScale(1, 1)
	l.Font = Enum.Font.FredokaOne
	l.TextScaled = true
	l.Text = text
	l.TextColor3 = Color3.new(1, 1, 1)
	l.Parent = gui
	local copy = gui:Clone()
	copy.Face = Enum.NormalId.Front
	copy.Parent = banner
	if big then
		-- A checkered band on the floor.
		for k = 0, 9 do
			part(folder, { Name = "Checker", Size = Vector3.new(f.w / 10, 0.1, 3), CFrame = frameCF(f, -f.w / 2 + (k + 0.5) * f.w / 10, 0.06), Color = if k % 2 == 0 then rgb(255, 255, 255) else rgb(30, 30, 40) })
		end
	end
end

-- ---- Crowds: spectator marbles on bleachers, flags flying -----------------------------------------

local FANS = { rgb(255, 90, 110), rgb(255, 200, 50), rgb(80, 200, 255), rgb(120, 230, 110), rgb(190, 110, 255), rgb(255, 150, 60), rgb(255, 255, 255) }
local function crowd(folder: Folder, f0: RaceTrack.Frame, side: number, rng: Random)
	local f = upright(f0)
	local base = side * (f.w / 2 + 10)
	for row = 0, 2 do
		local u = base + side * row * 5
		local h = row * 3
		part(folder, { Name = "Bleacher", Size = Vector3.new(4.6, 1.2 + h, 34), CFrame = frameCF(f, u, (1.2 + h) / 2 - 0.4), Color = rgb(240, 240, 250) })
		for k = 0, 5 do
			local along = -14 + k * 5.6 + rng:NextNumber(-0.8, 0.8)
			local col = FANS[rng:NextInteger(1, #FANS)]
			local at = RaceTrack.world(f, u, h + 3.2) + Vector3.new(f.tx, 0, f.tz).Unit * along
			ball(folder, at, Vector3.new(3.6, 3.6, 3.6), col)
			-- Eyes on the side facing the track.
			local toTrack = (RaceTrack.world(f, 0, h + 3.2) + Vector3.new(f.tx, 0, f.tz).Unit * along - at).Unit
			local left = Vector3.new(0, 1, 0):Cross(toTrack).Unit
			for _, e in ipairs({ -1, 1 }) do
				ball(folder, at + toTrack * 1.55 + left * e * 0.6 + Vector3.new(0, 0.5, 0), Vector3.new(0.9, 1.1, 0.5), rgb(255, 255, 255))
				ball(folder, at + toTrack * 1.85 + left * e * 0.6 + Vector3.new(0, 0.45, 0), Vector3.new(0.45, 0.55, 0.3), rgb(25, 20, 35))
			end
			if rng:NextNumber() < 0.35 then
				-- A little flag on a stick.
				local stick = at + Vector3.new(0, 2.4, 0)
				part(folder, { Name = "FlagStick", Size = Vector3.new(0.15, 3.4, 0.15), CFrame = CFrame.new(stick + Vector3.new(0, 1.2, 0)), Color = rgb(120, 90, 60) })
				part(folder, { Name = "FanFlag", Size = Vector3.new(0.1, 1.2, 1.8), CFrame = CFrame.new(stick + Vector3.new(0, 2.3, 0.9)), Color = FANS[rng:NextInteger(1, #FANS)] })
			end
		end
	end
	-- Tall flags behind the stands.
	for k = -1, 1, 2 do
		local at = RaceTrack.world(f, base + side * 18, 0) + Vector3.new(f.tx, 0, f.tz).Unit * k * 12
		part(folder, { Name = "FlagPole", Size = Vector3.new(0.5, 18, 0.5), CFrame = CFrame.new(at + Vector3.new(0, 9, 0)), Color = rgb(255, 255, 255) })
		part(folder, { Name = "Flag", Size = Vector3.new(0.2, 5, 8), CFrame = CFrame.new(at + Vector3.new(0, 15.5, 4)), Color = FANS[rng:NextInteger(1, #FANS)] })
	end
end

-- ---- The world round the track ------------------------------------------------------------------

local function pine(folder: Instance, at: Vector3, h: number, snow: boolean)
	part(folder, { Name = "Trunk", Shape = Enum.PartType.Cylinder, Size = Vector3.new(h * 0.3, h * 0.1, h * 0.1), CFrame = CFrame.new(at + Vector3.new(0, h * 0.15, 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = rgb(107, 74, 48), Material = Enum.Material.Wood })
	for i = 0, 3 do
		local fr = i / 4
		local r = h * 0.32 * (1 - fr) + h * 0.05
		part(folder, { Name = "Needles", Shape = Enum.PartType.Cylinder, Size = Vector3.new(h * 0.16, r * 2, r * 2), CFrame = CFrame.new(at + Vector3.new(0, h * (0.3 + fr * 0.6), 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = if i % 2 == 0 then rgb(42, 120, 70) else rgb(52, 140, 80), Material = Enum.Material.LeafyGrass })
		if snow then
			part(folder, { Name = "Snow", Shape = Enum.PartType.Cylinder, Size = Vector3.new(h * 0.04, r * 1.5, r * 1.5), CFrame = CFrame.new(at + Vector3.new(0, h * (0.3 + fr * 0.6) + h * 0.09, 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = rgb(245, 250, 255), Material = Enum.Material.Snow })
		end
	end
end

local function materialFor(y: number): Enum.Material
	if y > 640 then
		return Enum.Material.Snow
	elseif y > 470 then
		return Enum.Material.Rock
	elseif y > 200 then
		return Enum.Material.LeafyGrass
	end
	return Enum.Material.Grass
end

--- The mountain: terrain ridges under every stretch of track (none under the gaps or the bridge,
--- which cross chasms), the massif round the summit, forests, cliffs, the waterfall, clouds, the
--- valley and the lake.
local function buildWorld(folder: Folder, course: any, rng: Random)
	local T = Workspace.Terrain
	local O = RaceTrack.ORIGIN
	local main = course.paths.main
	-- Ridges: balls whose tops sit 7 studs under the track.
	for id, path in pairs(course.paths) do
		if id == "bridge" then
			continue
		end
		for i = 1, #path.frames, 10 do
			local f = path.frames[i]
			local near = false
			for k = math.max(1, i - 12), math.min(#path.frames, i + 12) do
				if not path.frames[k].floor then
					near = true
				end
			end
			if not near and not f.roof then
				local r = 46
				local c = O + Vector3.new(f.x, f.y - r - 7, f.z)
				T:FillBall(c, r, materialFor(f.y))
			end
		end
	end
	-- The massif round the summit and the valley floor.
	T:FillBall(O + Vector3.new(-120, 640, -60), 260, Enum.Material.Rock)
	T:FillBall(O + Vector3.new(-200, 820, -180), 120, Enum.Material.Snow)
	T:FillBall(O + Vector3.new(80, 700, -200), 150, Enum.Material.Snow)
	T:FillBlock(CFrame.new(O + Vector3.new(1300, 5, 1600)), Vector3.new(2600, 10, 1400), Enum.Material.Grass)
	-- The lake past the finish.
	T:FillBlock(CFrame.new(O + Vector3.new(2150, 6, 1720)), Vector3.new(420, 12, 520), Enum.Material.Water)
	-- Forests beside the lower track, snowy pines up high; never on the track.
	for i = 1, #main.frames, 6 do
		local f = main.frames[i]
		if f.roof or not f.floor then
			continue
		end
		for _, sd in ipairs({ -1, 1 }) do
			if rng:NextNumber() < 0.55 then
				local off = sd * (f.w / 2 + rng:NextNumber(14, 50))
				local at = O + Vector3.new(f.x + f.rx * off, f.y - 10 - math.abs(off) * 0.25, f.z + f.rz * off)
				pine(folder, at, rng:NextNumber(22, 38), f.y > 600)
			end
		end
	end
	-- The waterfall beside the chute: a sheet of glassy water and spray at its foot.
	local falls = course.paths.falls
	local top = falls.frames[math.floor(#falls.frames * 0.35)]
	local foot = falls.frames[math.floor(#falls.frames * 0.75)]
	local wx = O + Vector3.new(top.x - top.rx * 40, top.y + 30, top.z - top.rz * 40)
	local wy = O + Vector3.new(foot.x - foot.rx * 40, foot.y - 30, foot.z - foot.rz * 40)
	-- Built from explicit axes: the fall is near vertical, where a look-at rotation is undefined.
	local down = (wy - wx).Unit
	local across = Vector3.new(top.rx, 0, top.rz).Unit
	local facing = across:Cross(down).Unit
	local sheet = part(folder, { Name = "Waterfall", Size = Vector3.new(26, (wx - wy).Magnitude, 3), CFrame = CFrame.fromMatrix((wx + wy) / 2, across, -down, facing), Color = rgb(170, 225, 255), Material = Enum.Material.Glass, Transparency = 0.25 })
	local mist = Instance.new("ParticleEmitter")
	mist.Texture = "rbxasset://textures/particles/smoke_main.dds"
	mist.Color = ColorSequence.new(Color3.new(1, 1, 1))
	mist.Size = NumberSequence.new(8, 22)
	mist.Transparency = NumberSequence.new(0.5, 1)
	mist.Lifetime = NumberRange.new(2, 3)
	mist.Rate = 6
	mist.Speed = NumberRange.new(4, 8)
	mist.Parent = sheet
	-- Clouds drifting below the summit.
	for i = 1, 22 do
		local a = rng:NextNumber() * math.pi * 2
		local d = rng:NextNumber(300, 1400)
		local c = O + Vector3.new(800 + math.cos(a) * d, rng:NextNumber(560, 760), 800 + math.sin(a) * d)
		for k = 1, 4 do
			ball(folder, c + Vector3.new((k - 2.5) * 22, rng:NextNumber(-4, 6), rng:NextNumber(-8, 8)), Vector3.new(40, 22, 30), rgb(255, 255, 255))
		end
	end
	-- Far peaks all round, so the horizon is mountains, not void.
	for i = 0, 23 do
		local a = i / 24 * math.pi * 2
		local d = rng:NextNumber(2400, 3000)
		local at = O + Vector3.new(900 + math.cos(a) * d, 0, 850 + math.sin(a) * d)
		local h = rng:NextNumber(500, 950)
		for k = 0, 4 do
			local fr = k / 5
			local r = h * 0.7 * (1 - fr) + 20
			part(folder, { Name = "Peak", Shape = Enum.PartType.Cylinder, Size = Vector3.new(h / 5 + 2, r * 2, r * 2), CFrame = CFrame.new(at + Vector3.new(0, h * (fr + 0.1), 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = if k >= 3 then rgb(248, 251, 255) else rgb(120, 140, 170), Material = if k >= 3 then Enum.Material.Snow else Enum.Material.Rock })
		end
	end
	-- The valley floor out to the far peaks.
	part(folder, { Name = "Valley", Shape = Enum.PartType.Cylinder, Size = Vector3.new(4, 2048, 2048), CFrame = CFrame.new(O + Vector3.new(1000, -2, 900)) * CFrame.Angles(0, 0, math.pi / 2), Color = rgb(120, 200, 100), Material = Enum.Material.Grass })
	-- The finish village: little pastel chalets by the lake.
	local fin = main.frames[#main.frames]
	for k = 1, 6 do
		local at = O + Vector3.new(fin.x + rng:NextNumber(-160, 60), 10, fin.z + (if k % 2 == 0 then 1 else -1) * rng:NextNumber(70, 140))
		part(folder, { Name = "Chalet", Size = Vector3.new(30, 22, 26), CFrame = CFrame.new(at + Vector3.new(0, 11, 0)), Color = ({ rgb(255, 190, 210), rgb(255, 230, 150), rgb(170, 220, 255) })[k % 3 + 1] })
		part(folder, { Name = "ChaletRoof", Size = Vector3.new(34, 4, 30), CFrame = CFrame.new(at + Vector3.new(0, 24, 0)), Color = rgb(210, 70, 60) })
	end
end

--- Build the whole race once. Returns its folder and the course's centre (for previews).
local built: any = nil
function Race.build(parent: Instance?): any
	if built then
		return built
	end
	local course = RaceTrack.get()
	local folder = Instance.new("Folder")
	folder.Name = "MarbleMountain"
	for _, id in ipairs(course.order) do
		buildPath(folder, course.paths[id], course.paths.main)
	end
	local main = course.paths.main
	gate(folder, RaceTrack.frame(main, course.checkpoints[1] + 6), "START", rgb(70, 200, 120), true)
	for k = 2, #course.checkpoints do
		gate(folder, RaceTrack.frame(main, course.checkpoints[k]), "CHECKPOINT " .. (k - 1), rgb(70, 160, 255))
	end
	gate(folder, RaceTrack.frame(main, course.finish), "FINISH", rgb(255, 80, 120), true)
	-- The start platform at the summit.
	local s0 = RaceTrack.frame(main, 0)
	part(folder, { Name = "StartDeck", Size = Vector3.new(60, 4, 60), CFrame = frameCF(s0, 0, -2) * CFrame.new(0, 0, 20), Color = rgb(255, 255, 255), CanCollide = true })
	buildWorld(folder, course, Random.new(42))
	-- Crowds at the start, the big jump, the Corkscrew and the finish.
	local crng = Random.new(9)
	crowd(folder, RaceTrack.frame(main, 40), -1, crng)
	crowd(folder, RaceTrack.frame(main, 40), 1, crng)
	crowd(folder, RaceTrack.frame(main, 2260), -1, crng)
	crowd(folder, RaceTrack.frame(main, 2440), 1, crng)
	crowd(folder, RaceTrack.frame(main, 2860), -1, crng)
	crowd(folder, RaceTrack.frame(main, course.finish - 40), -1, crng)
	crowd(folder, RaceTrack.frame(main, course.finish - 40), 1, crng)
	crowd(folder, RaceTrack.frame(main, course.finish + 40), -1, crng)
	crowd(folder, RaceTrack.frame(main, course.finish + 40), 1, crng)
	folder.Parent = parent or Workspace
	local f = RaceTrack.frame(main, main.length / 2)
	built = { folder = folder, centre = RaceTrack.ORIGIN + Vector3.new(900, 450, 850), course = course, start = RaceSim.position(RaceSim.new()) }
	return built
end

-- ---- Sessions, verification, records ------------------------------------------------------------

local sessions: { [Player]: { started: number } } = {}
local board = nil
pcall(function()
	board = DataStoreService:GetOrderedDataStore("RaceBest_v1")
end)
-- This week's board: a fresh one every Monday, so there is always a race anyone can win.
local function week(): number
	return math.floor((os.time() - 4 * 86400) / (7 * 86400)) -- the Unix epoch was a Thursday
end
Race.week = week
local function weekBoard()
	local ok, b = pcall(function()
		return DataStoreService:GetOrderedDataStore("RaceWeek_" .. week())
	end)
	return if ok then b else nil
end
Race.announce = function(_text: string, _color: Color3?) end
Race.quest = function(_player: Player, _stat: string, _n: number) end

function Race.racing(player: Player): boolean
	return sessions[player] ~= nil
end

--- Start a race for `player`: their avatar waits on the start deck; the client takes over.
function Race.start(player: Player): (boolean, any)
	local b = Race.build()
	sessions[player] = { started = os.clock() }
	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if root then
		char:PivotTo(CFrame.new(b.start + Vector3.new(0, 8, 30)))
		root.Anchored = true
	end
	player:SetAttribute("Racing", true)
	return true, { countdown = 3, medals = Race.MEDALS, best = (Data.get(player) or {}).raceBest }
end

function Race.leave(player: Player)
	sessions[player] = nil
	player:SetAttribute("Racing", nil)
	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if root then
		root.Anchored = false
		char:PivotTo(CFrame.new(0, 5, 38))
	end
end

--- The racer says they finished: replay their inputs and pay for the verified time.
function Race.finish(player: Player, log: any): (boolean, any)
	local session = sessions[player]
	if not session then
		return false, "You're not racing."
	end
	local ok, why = RaceSim.validLog(log)
	if not ok then
		return false, why
	end
	local st = RaceSim.replay(log)
	if not st.finished then
		return false, "That run didn't reach the finish."
	end
	local time = st.finishTick / 60
	-- It can't have taken less real time than it says (plus the countdown, minus a little slack).
	local real = os.clock() - session.started
	if real + 1.5 < time then
		return false, "That run was faster than real time."
	end
	session.started = os.clock() + 3 -- a new run starts after the next countdown
	local medal, coins = nil, Race.FINISH_COINS
	for _, m in ipairs(Race.MEDALS) do
		if time <= m[2] then
			medal = m[1]
			coins += m[3]
			break
		end
	end
	local p = Data.get(player)
	local pb = p and p.raceBest
	local newBest = pb == nil or time < pb
	if p then
		Data.update(player, function(pp)
			pp.raceRuns = (pp.raceRuns or 0) + 1
			if newBest then
				pp.raceBest = time
			end
		end)
	end
	local got = Economy.give(player, coins, "race")
	Race.quest(player, "races", 1)
	if medal == "Gold" then
		Race.quest(player, "gold", 1)
	end
	if newBest and board then
		task.spawn(function()
			pcall(function()
				board:SetAsync(tostring(player.UserId), math.floor(time * 1000))
			end)
		end)
	end
	-- This week's best, kept in the profile so only a better time is written.
	local wk = week()
	local weekBest = p and p.raceWeek and p.raceWeek.week == wk and p.raceWeek.best
	if p and (not weekBest or time < weekBest) then
		Data.update(player, function(pp)
			pp.raceWeek = { week = wk, best = time }
		end)
		local wb = weekBoard()
		if wb then
			task.spawn(function()
				pcall(function()
					wb:SetAsync(tostring(player.UserId), math.floor(time * 1000))
				end)
			end)
		end
	end
	if medal == "Gold" and newBest then
		Race.announce(string.format("🥇 %s won GOLD on Marble Mountain in %.2fs!", player.DisplayName, time), Color3.fromRGB(255, 215, 80))
	end
	return true, { time = time, medal = medal, coins = got, best = if newBest then time else pb, newBest = newBest, respawns = st.respawns }
end

--- The top times: { name, time }, all time and this week (cached a minute).
local names: { [number]: string } = {}
local function read(store: any): { any }?
	if not store then
		return nil
	end
	local out = nil
	pcall(function()
		local page = store:GetSortedAsync(true, 10):GetCurrentPage()
		out = {}
		for _, e in ipairs(page) do
			local id = tonumber(e.key) :: number
			if not names[id] then
				pcall(function()
					names[id] = Players:GetNameFromUserIdAsync(id)
				end)
			end
			table.insert(out, { name = names[id] or "?", time = e.value / 1000 })
		end
	end)
	return out
end
local topCache, weekCache, topAt = {}, {}, -math.huge
local function refresh()
	if os.clock() - topAt < 60 then
		return
	end
	topAt = os.clock()
	topCache = read(board) or topCache
	weekCache = read(weekBoard()) or weekCache
end
function Race.top(): { any }
	refresh()
	return topCache
end
function Race.topWeek(): { any }
	refresh()
	return weekCache
end

--- A board in the lobby by the race gate: the fastest times, all time and this week.
function Race.board(cf: CFrame, parent: Instance)
	local part = Instance.new("Part")
	part.Name = "RaceBoard"
	part.Anchored = true
	part.Size = Vector3.new(26, 18, 1)
	part.CFrame = cf
	part.Color = Color3.fromRGB(30, 40, 70)
	part.Parent = parent
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.PixelsPerStud = 36
	gui.LightInfluence = 0
	gui.Parent = part
	local head = Instance.new("TextLabel")
	head.BackgroundTransparency = 1
	head.Size = UDim2.new(1, 0, 0.16, 0)
	head.Font = Enum.Font.FredokaOne
	head.TextScaled = true
	head.Text = "🏔️ MARBLE MOUNTAIN · FASTEST"
	head.TextColor3 = Color3.fromRGB(255, 230, 120)
	head.Parent = gui
	local cols = {}
	for k, title in ipairs({ "THIS WEEK", "ALL TIME" }) do
		local l = Instance.new("TextLabel")
		l.BackgroundTransparency = 1
		l.Position = UDim2.new((k - 1) * 0.5, 16, 0.18, 0)
		l.Size = UDim2.new(0.5, -24, 0.8, 0)
		l.Font = Enum.Font.FredokaOne
		l.TextSize = 30
		l.TextXAlignment = Enum.TextXAlignment.Left
		l.TextYAlignment = Enum.TextYAlignment.Top
		l.TextColor3 = Color3.fromRGB(235, 240, 255)
		l.Text = title .. "\n\n(loading)"
		l.Parent = gui
		cols[k] = { label = l, title = title }
	end
	local function fmt(t: number): string
		return string.format("%d:%05.2f", math.floor(t / 60), t % 60)
	end
	task.spawn(function()
		while part.Parent do
			for k, list in ipairs({ Race.topWeek(), Race.top() }) do
				local lines = { cols[k].title, "" }
				for i, e in ipairs(list) do
					table.insert(lines, string.format("%d. %s  %s", i, e.name, fmt(e.time)))
				end
				if #list == 0 then
					table.insert(lines, "Be the first!")
				end
				cols[k].label.Text = table.concat(lines, "\n")
			end
			task.wait(60)
		end
	end)
	return part
end

-- Ghosts: each racer's marble, relayed to the other racers ten times a second.
function Race.ghost(player: Player, pos: any, remote: RemoteEvent)
	if not sessions[player] or typeof(pos) ~= "Vector3" then
		return
	end
	for other in pairs(sessions) do
		if other ~= player and other.Parent then
			remote:FireClient(other, player.UserId, pos, player:GetAttribute("Marble"))
		end
	end
end

Players.PlayerRemoving:Connect(function(p)
	sessions[p] = nil
end)

return Race
