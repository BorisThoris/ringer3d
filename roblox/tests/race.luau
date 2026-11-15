-- Cloud test of the downhill race (Marble Mountain): the course, the deterministic marble physics,
-- bots down every route, exact input replays, log checks, the server's verification, and the
-- world build. node roblox/scripts/run-luau.mjs roblox/tests/race.luau <version>
local out = {}
local function check(name, ok, detail)
	table.insert(out, (ok and "PASS " or "FAIL ") .. name .. (detail ~= nil and (": " .. tostring(detail)) or ""))
end

local RS = game.ReplicatedStorage.Ringer
local RaceTrack = require(RS.RaceTrack)
local RaceSim = require(RS.RaceSim)

-- The course.
local c = RaceTrack.get()
check("the main path runs summit to finish", c.paths.main.length > 4000 and c.finish < c.paths.main.length, string.format("%.0f studs, finish %.0f", c.paths.main.length, c.finish))
check("two shortcuts leave and rejoin the main path", c.paths.bridge.fork and c.paths.bridge.merge and c.paths.falls.fork and c.paths.falls.merge and c.paths.bridge.merge.s > c.paths.bridge.fork.s and c.paths.falls.merge.s > c.paths.falls.fork.s)
check("checkpoints all the way down", #c.checkpoints >= 8, #c.checkpoints)
local sections = {}
for _, f in ipairs(c.paths.main.frames) do
	sections[f.section] = true
end
local nsec = 0
for _ in pairs(sections) do
	nsec += 1
end
check("the main path has its named sections", nsec >= 9, nsec)
local frame = c.paths.main.frames[200]
local unitOk = math.abs(frame.tx ^ 2 + frame.ty ^ 2 + frame.tz ^ 2 - 1) < 1e-6 and math.abs(frame.ux ^ 2 + frame.uy ^ 2 + frame.uz ^ 2 - 1) < 1e-6 and frame.uy > 0
check("frames are unit vectors with up pointing up", unitOk)

-- Bots down every route, and exact replays.
local times = {}
for _, cfg in ipairs({ { 0, false, "centre" }, { -0.3, false, "left line" }, { 0.4, true, "shortcuts" } }) do
	local st, log = RaceSim.runBot(cfg[1], cfg[2])
	times[cfg[3]] = st.finishTick / 60
	check(cfg[3] .. " bot finishes cleanly", st.finished and st.respawns == 0, string.format("%.2fs, %d respawns", st.finishTick / 60, st.respawns))
	local r = RaceSim.replay(log)
	check(cfg[3] .. " replay matches tick for tick", r.finished and r.finishTick == st.finishTick and math.abs(r.s - st.s) < 1e-9, string.format("%d vs %d", r.finishTick, st.finishTick))
end
check("the shortcuts are worth learning", times.shortcuts and times.centre and times.centre - times.shortcuts > 5, string.format("%.2fs vs %.2fs", times.shortcuts or -1, times.centre or -1))

-- A sloppy driver (wobbling steer, letting go, braking now and then) still gets down the mountain.
local rng = Random.new(7)
local st = RaceSim.new()
local log = RaceSim.newLog()
while not st.finished and st.tick < 60 * 240 do
	local b = RaceSim.bot(st, 0, false)
	local input = { steer = math.clamp(b.steer + rng:NextNumber(-0.6, 0.6), -1, 1), throttle = if rng:NextNumber() < 0.15 then -1 elseif rng:NextNumber() < 0.5 then 0 else 1, jump = b.jump or rng:NextNumber() < 0.01, respawn = false }
	RaceSim.step(st, RaceSim.record(log, st.tick, input))
end
check("a sloppy driver still reaches the finish", st.finished, string.format("%.1fs, %d respawns", st.finishTick / 60, st.respawns))
local r2 = RaceSim.replay(log)
check("and its replay matches too", r2.finished and r2.finishTick == st.finishTick)

-- Respawning puts the marble back at its last checkpoint.
local rs = RaceSim.new()
for _ = 1, 60 * 12 do
	RaceSim.step(rs, { steer = 0, throttle = 1, jump = false, respawn = false })
end
local cp = rs.checkpoint
RaceSim.step(rs, { steer = 0, throttle = 0, jump = false, respawn = true })
check("respawn returns to the last checkpoint", rs.s == c.checkpoints[cp] and not rs.air and rs.respawns == 1, string.format("cp %d s %.0f", cp, rs.s))

-- Logs: malformed ones are refused, a cut-short one doesn't finish.
check("a malformed log is refused", not RaceSim.validLog({ { "x", 0, 0, false, false } }) and not RaceSim.validLog({ { 5, 2, 0, false, false } }) and not RaceSim.validLog({ { 9, 0, 0, false, false }, { 3, 0, 0, false, false } }))
-- The server: build the world, and verify a run (real time can't be beaten).
local Race = require(game.ServerScriptService.Server.Race)
local okB, built = pcall(Race.build, workspace)
local parts, gates = 0, 0
if okB then
	for _, d in ipairs(built.folder:GetDescendants()) do
		if d:IsA("BasePart") then
			parts += 1
		end
		if d.Name == "Banner" then
			gates += 1
		end
	end
end
check("the mountain is built: track, gates, scenery", okB and parts > 5000 and gates >= #c.checkpoints + 1, if okB then string.format("%d parts, %d gates", parts, gates) else built)
-- Stars: on the learnable lines of the main route, every one reachable in one clean run (passing
-- up the shortcuts), and the server's replay counts the same.
do
	local overGap = 0
	for _, star in ipairs(c.stars) do
		local p = c.paths[star.path]
		local f = RaceTrack.frame(p, star.s)
		if not f.floor then
			overGap += 1
		end
	end
	check("stars line the course, none over a gap", #c.stars >= 18 and overGap == 0, string.format("%d stars, %d over gaps", #c.stars, overGap))
	local hs, hlog = RaceSim.runBot(0, false, nil, true)
	check("a star hunter collects every star cleanly", hs.finished and hs.starCount == #c.stars and hs.respawns == 0, string.format("%d/%d stars, %.2fs, %d respawns", hs.starCount, #c.stars, hs.finishTick / 60, hs.respawns))
	local hr = RaceSim.replay(hlog)
	check("and the replay counts the same stars", hr.starCount == hs.starCount and hr.finishTick == hs.finishTick, string.format("%d vs %d", hr.starCount, hs.starCount))
	local plain = RaceSim.runBot(0, false)
	check("the centre line misses stars (they reward a line)", plain.starCount < #c.stars, string.format("%d/%d", plain.starCount, #c.stars))
end
-- The mountain is terrain round the track: it must never cover it (the spiral and corkscrew pass
-- over themselves).
do
	local T = workspace.Terrain
	local over = 0
	for _, path in pairs(c.paths) do
		for i = 1, #path.frames, 6 do
			local f = path.frames[i]
			if f.floor then
				for _, u in ipairs({ -f.w / 2 + 1, 0, f.w / 2 - 1 }) do
					local p = RaceTrack.world(f, u, 3)
					local _, o = T:ReadVoxels(Region3.new(p - Vector3.new(2, 2, 2), p + Vector3.new(2, 2, 2)):ExpandToGrid(4), 4)
					if o[1][1][1] > 0.3 then
						over += 1
					end
				end
			end
		end
	end
	check("terrain never covers the track", over == 0, over)
end
local fake = { UserId = 1, DisplayName = "Tester", Character = nil, Parent = game, SetAttribute = function() end, GetAttribute = function() return nil end }
local okS = pcall(Race.start, fake :: any)
local _, logC = RaceSim.runBot(0, false)
local okF, why = Race.finish(fake :: any, logC)
check("a run claimed faster than real time is refused", okS and not okF and tostring(why):find("real time") ~= nil, why)
local okBoard, boardPart = pcall(Race.board, CFrame.new(0, 500, 0), workspace)
check("the lobby race board builds with both tables", okBoard and boardPart:FindFirstChildOfClass("SurfaceGui") ~= nil, if okBoard then nil else boardPart)
check("weeks roll over on a fixed day", Race.week() == math.floor((os.time() - 4 * 86400) / (7 * 86400)))
local fans = 0
for _, d in ipairs(built.folder:GetDescendants()) do
	if d.Name == "Bleacher" then
		fans += 1
	end
end
check("crowds line the start, the jump, the Corkscrew and the finish", fans >= 27, fans)
check("medals are ordered", Race.MEDALS[1][2] < Race.MEDALS[2][2] and Race.MEDALS[2][2] < Race.MEDALS[3][2] and times.shortcuts < Race.MEDALS[1][2] and times.centre < Race.MEDALS[3][2])
check("the race client loads", type(require(game.StarterPlayer.StarterPlayerScripts.ClientModules.RaceClient).begin) == "function")

local fails = 0
for _, l in ipairs(out) do
	print(l)
	if string.sub(l, 1, 4) == "FAIL" then
		fails += 1
	end
end
print(string.format("race: %d checks, %d failed", #out, fails))
return fails == 0 and "PASS" or ("FAIL " .. fails)
