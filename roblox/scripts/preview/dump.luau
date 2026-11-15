-- Scene dump for the preview renderer (scripts/preview/preview.mjs fills in SCENE and PART).
-- Builds a field (its table, map, scenery, and the client's sky, critters and surroundings) or the
-- lobby on a cloud server, exactly as the game builds them, then returns every visible part, a
-- terrain height map and the light as compact JSON. PART picks which slice to return, so no single
-- task result grows too large.
local SCENE = "%SCENE%"
local PART = "%PART%"

local HttpService = game:GetService("HttpService")
local RS = game:GetService("ReplicatedStorage")
local SSS = game:GetService("ServerScriptService")
local Config = require(RS.Ringer.Config)
local client = game.StarterPlayer.StarterPlayerScripts.ClientModules

local origin = Vector3.new(0, 0, 0)
local radius = 1100
local light = {}

if SCENE == "lobby" then
	require(game.ServerStorage.SyntaxCheck["ServerScriptService.Main.server"])()
	task.wait(2)
	radius = 420
	light = { clock = 13.2, sky = { 120, 190, 255 }, horizon = { 225, 240, 255 }, fog = { 255, 222, 240 }, density = 0.26, sun = { 255, 248, 235 } }
elseif SCENE:sub(1, 5) == "race:" then
	local Race = require(SSS.Server.Race)
	local RaceTrack = require(RS.Ringer.RaceTrack)
	local built = Race.build(workspace)
	-- The stars the client draws in a run (a neon ball each; the renderer has no billboards).
	for _, star in ipairs(RaceTrack.get().stars) do
		local p = Instance.new("Part")
		p.Shape = Enum.PartType.Ball
		p.Size = Vector3.new(3, 3, 3)
		p.Material = Enum.Material.Neon
		p.Color = Color3.fromRGB(255, 214, 60)
		p.Anchored = true
		p.Position = RaceTrack.ORIGIN + Vector3.new(star.x, star.y, star.z)
		p.Parent = workspace
	end
	origin = built.centre
	radius = 3200
	light = Race.LIGHT
	-- Racer's-eye cameras down the course, and two overviews.
	local course = RaceTrack.get()
	local cams = {}
	local function camAt(name: string, pathId: string, s: number)
		local p = course.paths[pathId]
		local f = RaceTrack.frame(p, s)
		local ahead = RaceTrack.frame(p, math.min(p.length, s + 50))
		local at = RaceTrack.world(f, 0, 2) - Vector3.new(f.tx, f.ty, f.tz) * 24 + Vector3.new(0, 9, 0) - origin
		local look = RaceTrack.world(ahead, 0, 2) - origin
		table.insert(cams, { name, { at.X, at.Y, at.Z }, { look.X, look.Y, look.Z }, 72 })
	end
	if SCENE == "race:chase" then
		-- The player's view: drive the expert bot and run the client's chase camera (RaceClient)
		-- frame by frame, with a marble where the racer is at each sampled moment.
		local RaceSim = require(RS.Ringer.RaceSim)
		local st = RaceSim.new()
		local heading = Vector3.new(1, 0, 0)
		local prev = RaceSim.position(st)
		local n = 0
		while not st.finished and st.tick < 60 * 120 do
			RaceSim.step(st, RaceSim.bot(st, 0, false, true)) -- the star hunter: the whole main route
			local pos = RaceSim.position(st)
			local vel = (pos - prev) * 60
			prev = pos
			local horiz = Vector3.new(vel.X, 0, vel.Z)
			if horiz.Magnitude > 2 then
				heading = heading:Lerp(horiz.Unit, 4 / 60).Unit
			end
			if st.tick % 150 == 0 then
				n += 1
				local spd = RaceSim.speed(st)
				local camPos = RaceSim.chaseCamera(st, pos, heading) - origin
				local look = pos + heading * 14 + Vector3.new(0, 2, 0) - origin
				local ball = Instance.new("Part")
				ball.Shape = Enum.PartType.Ball
				ball.Size = Vector3.new(4, 4, 4)
				ball.Color = Color3.fromRGB(255, 90, 140)
				ball.Material = Enum.Material.SmoothPlastic
				ball.Anchored = true
				ball.Position = pos
				ball.Parent = workspace
				local f = RaceTrack.frame(course.paths[st.path], st.s)
				table.insert(cams, { string.format("chase%02d-%s", n, f.section:gsub("%W", "")), { camPos.X, camPos.Y, camPos.Z }, { look.X, look.Y, look.Z }, 70 + math.min(25, spd * 0.15) })
			end
		end
		_G.raceCams = cams
	end
	camAt("start", "main", 20)
	camAt("esses", "main", 650)
	camAt("fork", "main", 960)
	camAt("bridge", "bridge", 120)
	camAt("spiral", "main", 1350)
	camAt("canyon", "main", 2250)
	camAt("leap", "main", 2330)
	camAt("corkscrew", "main", 2700)
	camAt("chute", "falls", 220)
	camAt("tunnel", "main", 3300)
	camAt("valley", "main", 3900)
	camAt("finish", "main", course.finish - 60)
	-- The River Leap, found from the course: the run-up, and from the bank beside the river.
	do
		local m = course.paths.main
		local gapS = nil
		for i, f in ipairs(m.frames) do
			if not f.floor and i > 1 and m.frames[i - 1].floor then
				gapS = (i - 1) * RaceTrack.STEP
			end
		end
		if gapS then
			camAt("river", "main", gapS - 70)
			local g = RaceTrack.frame(m, gapS + 16)
			local at = RaceTrack.world(g, 90, 6) - origin
			local look = RaceTrack.world(g, 0, -10) - origin
			table.insert(cams, { "river-side", { at.X, at.Y, at.Z }, { look.X, look.Y, look.Z }, 65 })
		end
	end
	table.insert(cams, { "overview", { -900, 900, -900 }, { 0, -100, 0 }, 60 })
	table.insert(cams, { "overview2", { 1600, 700, 1900 }, { 0, -100, 0 }, 60 })
	if SCENE ~= "race:chase" then
		_G.raceCams = cams
	end
else
	local Table = require(SSS.Server.Table)
	origin = Vector3.new(4800, 0, 4800)
	local tbl = Table.new({
		seats = { { kind = "bot", bot = "casual", name = "A", marble = "dragon" }, { kind = "bot", bot = "rookie", name = "B", marble = "tide" } },
		arena = SCENE, origin = origin, mode = "test", seed = 3, difficulty = "medium", mapSeed = 2,
	})
	tbl:shooterPart()
	local Skies = require(client.Skies)
	Skies.enter(SCENE, origin)
	task.wait(0.2)
	local arena = Config.ARENAS[SCENE]
	local cfg = Skies.SKY[SCENE]
	local function c3(c: Color3)
		return { math.floor(c.R * 255), math.floor(c.G * 255), math.floor(c.B * 255) }
	end
	light = { clock = cfg.clock, exposure = cfg.exposure, sky = c3(arena.sky.top), horizon = c3(arena.sky.bottom), fog = c3(arena.fog), density = if SCENE == "desk" then 0.36 else 0.24, sun = c3(arena.sun.color), stars = cfg.stars }
end

local function r2(n: number)
	return math.floor(n * 100 + 0.5) / 100
end

local out = { scene = SCENE, origin = { origin.X, origin.Y, origin.Z }, light = light, cameras = _G.raceCams }

if PART == "parts" then
	local parts = {}
	for _, d in ipairs(workspace:GetDescendants()) do
		if d:IsA("BasePart") and d.Transparency < 0.98 and not d:IsA("Terrain") then
			local p = d.Position
			if (p - origin).Magnitude < radius + d.Size.Magnitude / 2 then
				local shape = "Block"
				if d:IsA("WedgePart") then
					shape = "Wedge"
				elseif d:IsA("CornerWedgePart") then
					shape = "Corner"
				elseif d:IsA("Part") then
					shape = d.Shape.Name
					local m = d:FindFirstChildOfClass("SpecialMesh")
					if m and m.MeshType == Enum.MeshType.Sphere then
						shape = "Sphere"
					end
				end
				local cf = d.CFrame
				local x, y, z, a, b, c, e, f, g, h, i, j = cf:GetComponents()
				local col = d.Color
				table.insert(parts, {
					shape,
					{ r2(x - origin.X), r2(y - origin.Y), r2(z - origin.Z) },
					{ r2(a), r2(b), r2(c), r2(e), r2(f), r2(g), r2(h), r2(i), r2(j) },
					{ r2(d.Size.X), r2(d.Size.Y), r2(d.Size.Z) },
					{ math.floor(col.R * 255), math.floor(col.G * 255), math.floor(col.B * 255) },
					r2(d.Transparency),
					d.Material.Name,
				})
			end
		end
	end
	out.parts = parts
else
	local T = workspace.Terrain
	-- The server sets the game's terrain palette at start; a cloud task runs no scripts, so set it here.
	require(game.ReplicatedStorage.Ringer.TerrainColors).apply(T)
	if SCENE:sub(1, 5) == "race:" then
		-- A mountain is too big to read whole: read one thin column of voxels every 24 studs (cloud
		-- tasks don't run physics, so raycasts don't hit terrain there).
		local cell = 48
		local R = 3600
		local cols, colors = {}, {}
		local n = math.floor(R * 2 / cell)
		for xi = 1, n do
			for zi = 1, n do
				local x = math.floor((origin.X - R + (xi - 0.5) * cell) / 4) * 4
				local z = math.floor((origin.Z - R + (zi - 0.5) * cell) / 4) * 4
				local mats, occ = T:ReadVoxels(Region3.new(Vector3.new(x, -8, z), Vector3.new(x + 4, 1000, z + 4)), 4)
				for yi = mats.Size.Y, 1, -1 do
					local m = mats[1][yi][1]
					if occ[1][yi][1] > 0.5 and m ~= Enum.Material.Air then
						-- Water shows as its surface (terrain water has no material colour of its own).
						colors[m.Name] = colors[m.Name] or if m == Enum.Material.Water then { 70, 150, 215 } else (function()
							local c = T:GetMaterialColor(m)
							return { math.floor(c.R * 255), math.floor(c.G * 255), math.floor(c.B * 255) }
						end)()
						local topY = -8 + yi * 4
						table.insert(cols, { xi, zi, math.floor((topY - (origin.Y - 60)) / 4 + 0.5), m.Name })
						break
					end
				end
			end
		end
		out.terrain = { min = { -R, -60, -R }, cell = cell, cellY = 4, cols = cols, colors = colors }
		return HttpService:JSONEncode(out)
	end
	-- Terrain: the top solid voxel of each 4-stud column within the scene, and its material.
	local R = if SCENE == "lobby" then 300 else 340
	local y0, y1 = -12, 88
	local region = Region3.new(origin + Vector3.new(-R, y0, -R), origin + Vector3.new(R, y1, R)):ExpandToGrid(4)
	local mats, occ = T:ReadVoxels(region, 4)
	local size = mats.Size
	local cols = {}
	local colors = {}
	for xi = 1, size.X do
		for zi = 1, size.Z do
			for yi = size.Y, 1, -1 do
				if occ[xi][yi][zi] > 0.5 and mats[xi][yi][zi] ~= Enum.Material.Air and mats[xi][yi][zi] ~= Enum.Material.Water then
					local m = mats[xi][yi][zi]
					colors[m.Name] = colors[m.Name] or (function()
						local c = T:GetMaterialColor(m)
						return { math.floor(c.R * 255), math.floor(c.G * 255), math.floor(c.B * 255) }
					end)()
					table.insert(cols, { xi, zi, yi, m.Name })
					break
				end
			end
		end
	end
	local min = region.CFrame.Position - region.Size / 2
	out.terrain = { min = { r2(min.X - origin.X), r2(min.Y - origin.Y), r2(min.Z - origin.Z) }, cell = 4, cols = cols, colors = colors }
end

return HttpService:JSONEncode(out)
