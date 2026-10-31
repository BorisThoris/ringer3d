-- Temporary duel rig (Studio local plugin); only runs in a place with ReplicatedStorage.PlayRig.
-- A 1v1 table with two human seats on real Roblox physics. Two stand-in players submit shots
-- through Table:submit (the path the Shoot remote takes). Checks: turns alternate, a shot from the
-- player who is not up is refused, an idle player's turn times out into a shot, both players get
-- every event, the match ends with a result.
local RS = game:GetService("ReplicatedStorage")
if not RS:FindFirstChild("PlayRig") then
	return
end
local RunService = game:GetService("RunService")
if not RunService:IsEdit() then
	return
end
local SSS = game:GetService("ServerScriptService")
local function log(...)
	print("[duelrig]", ...)
end
local cam = workspace.CurrentCamera
local t0 = os.clock()
while cam.ViewportSize.X < 1500 and os.clock() - t0 < 90 do
	task.wait(1)
end
RunService:Run()
task.wait(8)

local ok, err = pcall(function()
	local Table = require(SSS.Server.Table)
	local Rules = require(RS.Ringer.Rules)
	local Bot = require(RS.Ringer.Bot)
	local Config = require(RS.Ringer.Config)
	local rng = Random.new(5)
	local A = { Name = "Alice", UserId = 101, Parent = workspace }
	local B = { Name = "Bob", UserId = 202, Parent = workspace }
	local t = Table.new({
		seats = { { kind = "human", player = A, name = "Alice", marble = "ember" }, { kind = "human", player = B, name = "Bob", marble = "tide" } },
		arena = "culdesac",
		origin = Vector3.new(9000, 0, 0),
		mode = "duel",
		seed = 21,
		difficulty = "easy",
		mapSeed = 5,
	})
	local events, states, result = {}, nil, nil
	t.send = function(_, kind, data)
		events[kind] = (events[kind] or 0) + 1
		if kind == "state" then
			states = data
		end
	end
	t.finished = function(_, r)
		result = r
	end
	task.spawn(function()
		t:run()
	end)

	local refused, accepted, turns, idleDone = 0, 0, {}, false
	local lastKey = nil
	local deadline = os.clock() + 840
	while not result and os.clock() < deadline do
		local s = states
		if s and s.phase == "aim" then
			local key = tostring(s.turnEnds)
			if key ~= lastKey then
				lastKey = key
				local up = if s.current == 1 then A else B
				local other = if s.current == 1 then B else A
				table.insert(turns, s.current)
				-- The player who is not up tries to shoot: refused.
				if t:submit(other, 0, 0, 0.5, 0) then
					log("FAIL a shot from the player who is not up was accepted")
				else
					refused += 1
				end
				-- Bob idles through his first turn: the turn timer shoots for him.
				if up == B and not idleDone then
					idleDone = true
					log("Bob idles through a turn (timer", math.floor(s.turnEnds - workspace:GetServerTimeNow()), "s)")
				else
					local seat = s.current
					local placeAngle = Rules.seatAngle(seat, #s.seats)
					local from = Rules.placement(placeAngle)
					if not s.firstShot and s.shooter then
						local d = s.shooter - s.origin
						from = Vector2.new(d.X, d.Z)
						placeAngle = math.atan2(from.Y, from.X)
					end
					-- Aim like a sensible player: the shot planner, round the map's pieces.
					local mibs = {}
					for _, b in ipairs(t.mibs) do
						table.insert(mibs, t:flat(b.Position))
					end
					local plan = Bot.plan(if s.firstShot then nil else from, mibs, t.arena.rollDecel, Config.BOTS.expert, rng, t.obstacles)
					placeAngle = plan.placeAngle
					from = if s.firstShot then Rules.placement(placeAngle) else from
					local target = from + Vector2.new(math.cos(plan.aimAngle), math.sin(plan.aimAngle)) * 10
					local dir = target - from
					task.wait(0.4)
					if t:submit(up, placeAngle, plan.aimAngle, plan.power, if seat == 1 then -0.3 else 0.3) then
						accepted += 1
						if accepted <= 4 then
							local shotNo = accepted
							log(string.format("shot %d seat %d first=%s from (%.1f,%.1f) r=%.1f target (%.1f,%.1f) aim %.2f", shotNo, seat, tostring(s.firstShot), from.X, from.Y, from.Magnitude, target.X, target.Y, math.atan2(dir.Y, dir.X)))
							for _, dt in ipairs({ 0.05, 0.15, 0.3, 0.6 }) do
								task.delay(dt, function()
									if t.shooter then
										local v = t.shooter.AssemblyLinearVelocity
										local e = t:flat(t.shooter.Position)
										log(string.format("  +%.2fs shooter at (%.1f,%.1f) v (%.1f,%.1f,%.1f) anchored %s", dt, e.X, e.Y, v.X, v.Y, v.Z, tostring(t.shooter.Anchored)))
									end
								end)
							end
							task.delay(1.5, function()
								if t.shooter then
									local e = t:flat(t.shooter.Position)
									log(string.format("  shot %d shooter now at (%.1f,%.1f) r=%.1f, mibs left %d", shotNo, e.X, e.Y, e.Magnitude, #t.mibs))
								else
									log("  shot", shotNo, "no shooter")
								end
							end)
						end
					end
				end
			end
		end
		task.wait(0.2)
	end
	local alternated = 0
	for i = 2, #turns do
		if turns[i] ~= turns[i - 1] then
			alternated += 1
		end
	end
	log(string.format("result: %s", result and ("scores " .. table.concat(result.scores, "-") .. ", winners " .. table.concat(result.winners, ",") .. ", shots " .. result.shots) or "NONE"))
	log(string.format("turns %d (seat changes %d), shots accepted %d, wrong-player shots refused %d of %d, idle turn timed out %s", #turns, alternated, accepted, refused, #turns, tostring(idleDone and result ~= nil and result.shots > accepted)))
	log("events sent:", (function()
		local parts = {}
		for k, v in pairs(events) do
			table.insert(parts, k .. "=" .. v)
		end
		table.sort(parts)
		return table.concat(parts, " ")
	end)())
	t:destroy()
end)
log("run end", ok, err)
RunService:Stop()
log("done")
