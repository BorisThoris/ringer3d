-- Playthrough simulation for Marble Mountain: many seeded drivers of different skill race the
-- course on the real sim, and this reports, per profile, finish rate, times and medals, and per
-- section, where time goes and where drivers bump walls, fall and fly. Run in the cloud by
-- scripts/race-report.mjs; the numbers drive the track's tuning.
local HttpService = game:GetService("HttpService")
local RS = game.ReplicatedStorage.Ringer
local RaceTrack = require(RS.RaceTrack)
local RaceSim = require(RS.RaceSim)
local Race = require(game.ServerScriptService.Server.Race)

local course = RaceTrack.get()
-- noise: steering wobble; push: chance to hold forward; brake: chance to brake; line/shortcuts.
local PROFILES = {
	{ name = "expert", noise = 0, push = 1, brake = 0, line = 0.4, shortcuts = true },
	{ name = "good", noise = 0.15, push = 0.95, brake = 0, line = 0, shortcuts = false },
	{ name = "average", noise = 0.35, push = 0.8, brake = 0.04, line = 0, shortcuts = false },
	{ name = "kid", noise = 0.6, push = 0.5, brake = 0.15, line = 0, shortcuts = false },
	{ name = "risk-taker", noise = 0.3, push = 0.9, brake = 0.02, line = 0.4, shortcuts = true },
	{ name = "star-hunter", noise = 0.05, push = 1, brake = 0, line = 0, shortcuts = false, stars = true },
}
local RUNS = 8
local LIMIT = 60 * 240

local profiles = {}
local sections = {}
local function sec(name: string)
	sections[name] = sections[name] or { name = name, ticks = 0, bumps = 0, falls = 0, air = 0, topSpeed = 0, visits = 0 }
	return sections[name]
end

for _, prof in ipairs(PROFILES) do
	local times, medals, finished, respawns, starsGot = {}, { Gold = 0, Silver = 0, Bronze = 0, none = 0 }, 0, 0, 0
	for seed = 1, RUNS do
		local rng = Random.new(seed * 101 + #prof.name)
		local st = RaceSim.new()
		local lastSection = ""
		while not st.finished and st.tick < LIMIT do
			local b = RaceSim.bot(st, prof.line, prof.shortcuts, prof.stars)
			local input = {
				steer = math.clamp(b.steer + rng:NextNumber(-prof.noise, prof.noise), -1, 1),
				throttle = if rng:NextNumber() < prof.brake then -1 elseif rng:NextNumber() < prof.push then 1 else 0,
				jump = b.jump,
				respawn = false,
			}
			local here = RaceTrack.frame(course.paths[st.path], st.s).section
			RaceSim.step(st, RaceSim.quantize(input))
			local sv = sec(here)
			sv.ticks += 1
			if st.air then
				sv.air += 1
			end
			sv.topSpeed = math.max(sv.topSpeed, RaceSim.speed(st))
			if here ~= lastSection then
				sv.visits += 1
				lastSection = here
			end
			for _, e in ipairs(st.events) do
				if e == "bump" then
					sv.bumps += 1
				elseif e == "respawn" then
					sv.falls += 1
				end
			end
		end
		respawns += st.respawns
		starsGot += st.starCount
		if st.finished then
			finished += 1
			local t = st.finishTick / 60
			table.insert(times, t)
			local m = "none"
			for _, md in ipairs(Race.MEDALS) do
				if t <= md[2] then
					m = md[1]
					break
				end
			end
			medals[m] += 1
		end
	end
	table.sort(times)
	table.insert(profiles, {
		name = prof.name,
		finishRate = finished / RUNS,
		median = times[math.max(1, math.ceil(#times / 2))],
		best = times[1],
		worst = times[#times],
		medals = medals,
		respawnsPerRun = respawns / RUNS,
		starsPerRun = starsGot / RUNS,
	})
end

local list = {}
for _, s in pairs(sections) do
	table.insert(list, s)
end
table.sort(list, function(a, b)
	return a.ticks > b.ticks
end)
return HttpService:JSONEncode({ runs = RUNS * #PROFILES, stars = #course.stars, profiles = profiles, sections = list })
