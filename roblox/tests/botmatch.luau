-- Cloud smoke test: bots play whole games on a real Roblox server.
-- node roblox/scripts/run-luau.mjs roblox/tests/botmatch.luau <version>
local Table = require(game.ServerScriptService.Server.Table)
local Config = require(game.ReplicatedStorage.Ringer.Config)

local out = {}
local ARENA = "desk"
for g, arena in ipairs({ ARENA }) do
	local worst, longest = 0, 0
	local t = Table.new({
		seats = {
			{ kind = "bot", bot = "skilled", name = "A", marble = "ember" },
			{ kind = "bot", bot = "casual", name = "B", marble = "tide" },
		},
		arena = arena,
		origin = Vector3.new(g * Config.TABLE_SPACING, 0, 0),
		mode = "test",
		seed = 7 + g,
	})
	-- Watch every body all game: how far out does anything get, and how long does a shot run?
	local shotStart = nil
	t.send = function(tbl, kind)
		if kind == "capture" or kind == "shooterOut" then
			print(kind, tbl.shots)
		end
		if kind == "shot" then
			shotStart = os.clock()
		elseif kind == "state" and shotStart then
			longest = math.max(longest, os.clock() - shotStart)
			shotStart = nil
		end
	end
	local watch = game:GetService("RunService").Heartbeat:Connect(function()
		for _, b in ipairs(t:bodies()) do
			if b.Parent then
				worst = math.max(worst, t:flat(b.Position).Magnitude)
			end
		end
	end)
	local started = os.clock()
	local r = t:run()
	watch:Disconnect()
	table.insert(out, string.format("%s: scores %d-%d, winners %s, shots %d, %.0fs, furthest %.1f (kerb %d), longest shot %.1fs",
		arena, r.scores[1], r.scores[2], table.concat(r.winners, ","), r.shots, os.clock() - started, worst, Config.BOUND_R, longest))
	t:destroy()
end
for _, l in ipairs(out) do
	print(l)
end
return out
