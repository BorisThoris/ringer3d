-- Temporary end-to-end rig (Studio local plugin); only runs in a place with ReplicatedStorage.PlayRig.
-- Starts a real play session (server + a client player) and has a scripted client play the game
-- through the same remotes the UI uses: profile, buy, equip, daily, bag rules, a whole match vs a
-- bot with real shots, and the coin payout. Every step logs "[e2e] PASS/FAIL ...".
local RS = game:GetService("ReplicatedStorage")
if not RS:FindFirstChild("PlayRig") then
	return
end
local RunService = game:GetService("RunService")
if not RunService:IsEdit() then
	return
end
local function log(...)
	print("[e2e]", ...)
end
task.wait(15)

local server = Instance.new("Script")
server.Name = "E2EServer"
server.Source = [==[
local RS = game:GetService("ReplicatedStorage")
local STS = game:GetService("StudioTestService")
local ev = Instance.new("RemoteEvent")
ev.Name = "E2EDone"
ev.Parent = RS
ev.OnServerEvent:Connect(function(_, summary)
	print("[e2e] client done:", summary)
	STS:EndTest(summary)
end)
task.delay(660, function()
	STS:EndTest("timeout")
end)
]==]
server.Parent = game:GetService("ServerScriptService")

local client = Instance.new("LocalScript")
client.Name = "E2EClient"
client.Source = [==[
local RS = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")
local me = Players.LocalPlayer
local Ringer = RS:WaitForChild("Ringer")
local Rules = require(Ringer:WaitForChild("Rules"))
local Remotes = Ringer:WaitForChild("Remotes", 60)
local Request = Remotes:WaitForChild("Request")
local Shoot = Remotes:WaitForChild("Shoot")
local Done = RS:WaitForChild("E2EDone", 60)
local results, fails = {}, 0
local function check(name, ok, detail)
	local line = (ok and "PASS " or "FAIL ") .. name .. (detail ~= nil and (": " .. tostring(detail)) or "")
	if not ok then
		fails += 1
	end
	table.insert(results, line)
	print("[e2e]", line)
end
local profile = nil
Remotes:WaitForChild("ProfileSync").OnClientEvent:Connect(function(p)
	profile = p
end)
local info = Request:InvokeServer("profile")
check("profile request answers with the profile and shop info", typeof(info) == "table" and info.profile ~= nil, typeof(info))
local t = os.clock()
while not profile and os.clock() - t < 30 do
	task.wait(0.2)
end
check("profile arrives", profile ~= nil, profile and profile.coins)
check("starts with Ember equipped", profile and profile.equipped == "ember", profile and profile.equipped)
local coins0 = profile and profile.coins or 0

local okb, why = Request:InvokeServer("buy", "tide")
check("buy Tide for 150 coins", okb == true, why)
task.wait(1)
check("coins went down by 150", profile and profile.coins == coins0 - 150, profile and profile.coins)
check("equip Tide", Request:InvokeServer("equip", "tide") == true)
task.wait(1)
check("Tide is equipped", profile and profile.equipped == "tide", profile and profile.equipped)
check("can't equip a marble you don't own", Request:InvokeServer("equip", "cM-Rnotmine") ~= true)
check("can't buy what isn't for sale", Request:InvokeServer("buy", "obsidian") ~= true)
local okd, d = Request:InvokeServer("daily")
check("daily reward", okd == true, typeof(d) == "table" and d.coins or d)
check("daily only once a day", Request:InvokeServer("daily") ~= true)
task.wait(1)
local okbag, bag = Request:InvokeServer("bag")
local coinsNow = profile and profile.coins or 0
if coinsNow >= 300 then
	check("open a Marble Bag", okbag == true and typeof(bag) == "table" and string.sub(bag.id, 1, 1) == "c", typeof(bag) == "table" and bag.id or bag)
else
	check("Marble Bag refused without 300 coins, coins kept", okbag ~= true and (profile and profile.coins == coinsNow), bag)
end

-- A whole match against a Rookie, played with real shots.
local state, result, captures = nil, nil, 0
Remotes:WaitForChild("TableEvent").OnClientEvent:Connect(function(kind, data)
	if kind == "state" then
		state = data
	elseif kind == "result" then
		result = data
	elseif kind == "capture" then
		captures += 1
	end
end)
local okp, pw = Request:InvokeServer("play", { mode = "bot", bot = "rookie", arena = "culdesac", difficulty = "easy" })
check("start a match vs Rookie on the Cul-de-sac", okp == true, pw)
local coinsBefore = profile and profile.coins or 0
local shots, lastAim = 0, nil
local deadline = os.clock() + 540
while not result and os.clock() < deadline do
	local s = state
	if s and s.phase == "aim" then
		local mySeat = nil
		for i, seat in ipairs(s.seats) do
			if seat.userId == me.UserId then
				mySeat = i
			end
		end
		local key = tostring(s.id) .. ":" .. tostring(s.turnEnds)
		if mySeat and s.current == mySeat and key ~= lastAim then
			lastAim = key
			-- From the knuckle-down spot (or where the shooter stopped) at the nearest marble.
			local placeAngle = Rules.seatAngle(mySeat, #s.seats)
			local from = Rules.placement(placeAngle)
			if not s.firstShot and s.shooter then
				local d = s.shooter - s.origin
				from = Vector2.new(d.X, d.Z)
				placeAngle = math.atan2(from.Y, from.X)
			end
			local target, best = Vector2.zero, math.huge
			local model = workspace:FindFirstChild("Table" .. s.id)
			for _, b in ipairs(model and model:FindFirstChild("Marbles") and model.Marbles:GetChildren() or {}) do
				if string.sub(b.Name, 1, 3) == "Mib" then
					local p = b.Position - s.origin
					local v = Vector2.new(p.X, p.Z)
					if (v - from).Magnitude < best then
						target, best = v, (v - from).Magnitude
					end
				end
			end
			local dir = target - from
			Shoot:FireServer(s.id, placeAngle, math.atan2(dir.Y, dir.X), 0.9, 0)
			shots += 1
		end
	end
	task.wait(0.25)
end
check("the match finishes", result ~= nil, result and string.format("scores %s, %d shots by me, %d captures", table.concat(result.scores or {}, "-"), shots, captures))
check("I took shots", shots > 0, shots)
task.wait(2)
check("the match paid coins", profile and profile.coins > coinsBefore, profile and string.format("%d -> %d", coinsBefore, profile.coins))
check("the match counted in stats", profile and profile.played >= 1, profile and profile.played)

-- The UI is up.
local gui = me:WaitForChild("PlayerGui"):FindFirstChildWhichIsA("ScreenGui")
check("the HUD exists", gui ~= nil, gui and gui.Name)
Done:FireServer(string.format("%d checks, %d failed", #results, fails))
]==]
client.Parent = game:GetService("StarterPlayer").StarterPlayerScripts

log("starting play mode")
local ok, res = pcall(function()
	return game:GetService("StudioTestService"):ExecutePlayModeAsync({})
end)
log("play mode ended", ok, res)
server:Destroy()
client:Destroy()
log("done")
