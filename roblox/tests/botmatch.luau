-- Cloud test: bots play whole games on every field, on Ringer.Sim, with the web game's bots.
-- Prints each game's score, shot count and how long the bots thought.
-- node roblox/scripts/run-luau.mjs roblox/tests/botmatch.luau <version>
local Table = require(game.ServerScriptService.Server.Table)
local Config = require(game.ReplicatedStorage.Ringer.Config)

local out = {}
for g, arena in ipairs(Config.ARENA_ORDER) do
	local t = Table.new({
		seats = {
			{ kind = "bot", bot = "skilled", name = "A", marble = "ember" },
			{ kind = "bot", bot = "casual", name = "B", marble = "tide" },
		},
		arena = arena,
		origin = Vector3.new(g * Config.TABLE_SPACING, 0, 0),
		mode = "test",
		seed = 7 + g,
		difficulty = "medium",
		mapSeed = 100 + g,
		instant = true,
	})
	local started = os.clock()
	local r = t:run()
	table.insert(out, string.format("%s: scores %d-%d, winners %s, shots %d, %.1fs", arena, r.scores[1], r.scores[2], table.concat(r.winners, ","), r.shots, os.clock() - started))
	t:destroy()
end
for _, l in ipairs(out) do
	print(l)
end
return out
