-- Cloud test of the client's game modules (CHECK build), run on a server since cloud tests have
-- no player: Replay must replay every shot of a real table to exactly where the server's sim left
-- it, in about the time the server waits; Aim must draw the web game's guide and send the shot
-- it shows.
-- node roblox/scripts/run-luau.mjs roblox/tests/client.luau <version>
local out = {}
local function check(name, ok, detail)
	table.insert(out, (ok and "PASS " or "FAIL ") .. name .. (detail ~= nil and (": " .. tostring(detail)) or ""))
end

local Ringer = game.ReplicatedStorage.Ringer
local Sim = require(Ringer.Sim)
local Config = require(Ringer.Config)
local Rules = require(Ringer.Rules)
local Playback = require(Ringer.Playback)
local client = game.StarterPlayer.StarterPlayerScripts.ClientModules
local Replay = require(client.Replay)
local Aim = require(client.Aim)
local Table = require(game.ServerScriptService.Server.Table)

-- 1. Replay: a bot game on a field with props, every shot replayed as a client would.
local state = nil
local replayed, exact, mismatches, timing = 0, 0, {}, {}
local pending = nil
local t
t = Table.new({
	seats = { { kind = "bot", bot = "casual", name = "A", marble = "ember" }, { kind = "bot", bot = "rookie", name = "B", marble = "tide" } },
	arena = "desk", origin = Vector3.new(5000, 0, 0), mode = "test", seed = 21, difficulty = "hard", mapSeed = 7,
	watched = function(n)
		return replayed >= n
	end,
	send = function(tbl, kind, data)
		if kind == "state" then
			state = data
			if pending and pending.layout then
				-- The server's result (before it took the captured ones off) is in tbl.layout now,
				-- minus captures: compare every marble still on the table.
				local mine = {}
				for _, m in ipairs(pending.layout.targets) do
					mine[m.id] = m
				end
				local same = true
				for _, m in ipairs(tbl.layout.targets) do
					local r = mine[m.id]
					if not r or r.x ~= m.x or r.z ~= m.z then
						same = false
					end
				end
				if same then
					exact += 1
				else
					table.insert(mismatches, pending.n)
				end
				pending = nil
			end
		elseif kind == "shot" then
			local started = os.clock()
			local entry = { n = data.n }
			pending = entry
			Replay.play(state, data, function()
				replayed += 1
				entry.layout = Replay.lastLayout
				table.insert(timing, (os.clock() - started) - Playback.duration(data.steps, data.crossStep, false))
			end)
		end
	end,
})
local res = t:run()
check("bot game finished", #res.winners >= 1, table.concat(res.scores, "-") .. " in " .. res.shots .. " shots")
check("every shot replayed", replayed == res.shots, string.format("%d/%d", replayed, res.shots))
check("replays end exactly where the server's sim did", #mismatches == 0 and exact > 0, string.format("%d exact, mismatched shots: %s", exact, table.concat(mismatches, ",")))
local worst = 0
for _, d in ipairs(timing) do
	worst = math.max(worst, math.abs(d))
end
check("a replay takes the time the server allows", worst < 0.5, string.format("worst %.2fs off", worst))
t:destroy()

-- 2. Aim: the guide and the shot, on a fresh table.
local sent = nil
Aim.sendShot = function(id, placeAngle, aimAngle, power, spin)
	sent = { id = id, placeAngle = placeAngle, aimAngle = aimAngle, power = power, spin = spin }
end
local t2 = Table.new({
	seats = { { kind = "bot", bot = "casual", name = "A", marble = "ember" }, { kind = "bot", bot = "rookie", name = "B", marble = "tide" } },
	arena = "culdesac", origin = Vector3.new(5400, 0, 0), mode = "test", seed = 3, difficulty = "easy", mapSeed = 1,
})
local st = t2:state()
st.phase = "aim"
st.current = 1
st.firstShot = true
Aim.set(st)
Aim.mySeat = 1 -- no LocalPlayer on a server: sit the test in seat 1
check("my turn", Aim.myTurn())
check("knuckled down at my seat", math.abs(Aim.aim.placeAngle - Rules.seatAngle(1, 2)) < 1e-9, Aim.aim.placeAngle)
Aim.step(1 / 60)
local lines = Aim.guideParts()
-- Straight in from the line at the seat, the first marble met is the cross's outer one on that arm.
local W = Sim.WORLD
local px, pz = Sim.placementPoint(Aim.aim.placeAngle)
local wantLen = math.sqrt(px * px + pz * pz) - 3 * W.targetSpacing - (W.targetRadius + W.shooterRadius)
check("guide runs to the first marble", lines[1] and math.abs(lines[1].Size.Z - wantLen * Config.MAP_SCALE) < 0.05, lines[1] and string.format("%.2f vs %.2f", lines[1].Size.Z, wantLen * Config.MAP_SCALE))
check("guide shows the marble's way out", lines[2] and lines[2].Transparency < 1)
Aim.rotateAim(0.1)
Aim.setSpin(-0.5)
Aim.setPower(0.02)
Aim.release()
check("a release under 3% is not a shot", sent == nil)
Aim.setPower(0.62)
Aim.release()
check("release sends the shot shown", sent ~= nil and math.abs(sent.power - 0.62) < 1e-9 and sent.spin == -0.5 and math.abs(sent.aimAngle - (Aim.aim.aimAngle)) < 1e-9, sent and string.format("power %.2f spin %.2f", sent.power, sent.spin))
check("no second shot this turn", not Aim.myTurn())
-- A floor that allows no guide draws no lines.
st.guide = "off"
Aim.set(st)
Aim.mySeat = 1
Aim.step(1 / 60)
check("guide off on high floors", Aim.guideParts()[1].Transparency == 1)
Aim.stop()
t2:destroy()

local fails = 0
for _, l in ipairs(out) do
	print(l)
	if l:sub(1, 4) == "FAIL" then
		fails += 1
	end
end
print(string.format("%d checks, %d failed", #out, fails))
return fails
