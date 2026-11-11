-- Bot ladder parity: the same matchups the web game's headless runner plays
-- (`ringer-headless play --arena A --difficulty medium --seed 3 --games 6 bot:skilled bot:casual`):
-- same maps (map seed = game seed), seats swapped every game. Prints, per field, each game as
-- "skilled-casual/shots" and the totals, to set beside the web game's numbers.
-- node roblox/scripts/run-luau.mjs roblox/tests/botstats.luau <version>
local Table = require(game.ServerScriptService.Server.Table)
local Config = require(game.ReplicatedStorage.Ringer.Config)

local A, B = "skilled", "casual"
local GAMES = 6
local out = {}
local totals = { wins = 0, games = 0, shots = 0 }
local ONLY = nil -- one field per run (cloud tasks stop at 300 s)
for fi, arena in ipairs(if ONLY then { ONLY } else Config.ARENA_ORDER) do
	local games = {}
	for g = 0, GAMES - 1 do
		local seed = 3 + g
		local first = if g % 2 == 0 then A else B
		local second = if first == A then B else A
		local t = Table.new({
			seats = { { kind = "bot", bot = first, name = first, marble = "ember" }, { kind = "bot", bot = second, name = second, marble = "tide" } },
			arena = arena,
			origin = Vector3.new(fi * Config.TABLE_SPACING, 0, g * Config.TABLE_SPACING),
			mode = "test",
			seed = seed,
			difficulty = "medium",
			mapSeed = seed,
			instant = true,
		})
		local r = t:run()
		local sA = if first == A then r.scores[1] else r.scores[2]
		local sB = if first == A then r.scores[2] else r.scores[1]
		table.insert(games, string.format("%d-%d/%d", sA, sB, r.shots))
		totals.games += 1
		totals.shots += r.shots
		if sA > sB then
			totals.wins += 1
		end
		t:destroy()
		task.wait()
	end
	table.insert(out, arena .. " " .. table.concat(games, " "))
end
table.insert(out, string.format("skilled won %d of %d, %.1f shots a game", totals.wins, totals.games, totals.shots / totals.games))
for _, l in ipairs(out) do
	print(l)
end
return out
