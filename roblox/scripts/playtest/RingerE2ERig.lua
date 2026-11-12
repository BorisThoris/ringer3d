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

-- A whole match against a Rookie, played with real shots through the game's own aim (the
-- client's Aim module: the same path the power bar and Space take). Every shot is replayed on
-- the client's Ringer.Sim; the server waits for that replay, not a fixed time.
local Aim = require(me:WaitForChild("PlayerScripts"):WaitForChild("ClientModules"):WaitForChild("Aim"))
local Replay = require(me.PlayerScripts.ClientModules:WaitForChild("Replay"))
local Playback = require(Ringer:WaitForChild("Playback"))
local state, result, captures = nil, nil, 0
local shotAt, waits, prepares = nil, {}, 0
local frames = 0
game:GetService("RunService").RenderStepped:Connect(function()
	frames += 1
end)
local replays = 0
Remotes:WaitForChild("TableEvent").OnClientEvent:Connect(function(kind, data)
	if kind == "state" then
		state = data
		if shotAt then
			-- Time from the shot to the next turn, against how long the replay takes.
			local w = os.clock() - shotAt.t - Playback.duration(shotAt.steps, shotAt.crossStep, false)
			table.insert(waits, w)
			print("[e2e] shot", shotAt.n, "steps", shotAt.steps, "over by", string.format("%.2f", w), "replayDone", shotAt.doneAt and string.format("%.2f", shotAt.doneAt - shotAt.t) or "no", "fps", string.format("%.0f", frames / math.max(0.01, os.clock() - shotAt.t)), "kb", math.floor(gcinfo()), "workspace", #workspace:GetDescendants(), "gui", #me.PlayerGui:GetDescendants(), "aimview", workspace:FindFirstChild("AimView") and #workspace.AimView:GetChildren() or 0)
			shotAt = nil
		end
	elseif kind == "result" then
		result = data
	elseif kind == "capture" then
		captures += 1
	elseif kind == "shot" then
		shotAt = { t = os.clock(), steps = data.steps, crossStep = data.crossStep, n = data.n }
		frames = 0
		local mine = shotAt
		task.spawn(function()
			while mine == shotAt and not mine.doneAt do
				if not Replay.playing and os.clock() - mine.t > 0.2 then
					mine.doneAt = os.clock()
				end
				task.wait()
			end
		end)
		task.defer(function()
			if Replay.playing then
				replays += 1
			end
		end)
	elseif kind == "prepare" then
		prepares += 1
	end
end)
-- Input the way a player gives it, for the first three of my turns: mouse, keyboard, touch. The
-- events go into the game's own input handlers (Aim.input, Aim.powerBar), the functions the
-- engine's UserInputService events call; a test client can't make the engine send real ones
-- (VirtualInputManager needs core-script rights).
local MB1, MOVE, TOUCH, KEY = Enum.UserInputType.MouseButton1, Enum.UserInputType.MouseMovement, Enum.UserInputType.Touch, Enum.UserInputType.Keyboard
local function ev(kind, x, y, code)
	return { UserInputType = kind, KeyCode = code or Enum.KeyCode.Unknown, Position = Vector3.new(x or 0, y or 0, 0) }
end
local function drag(handlers, kind, x0, y0, x1, y1, steps)
	local down = ev(kind, x0, y0)
	handlers.began(down, false)
	for i = 1, steps do
		task.wait(0.03)
		local x, y = x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps
		if kind == TOUCH then
			down.Position = Vector3.new(x, y, 0)
			handlers.changed(down)
		else
			handlers.changed(ev(MOVE, x, y))
		end
	end
	task.wait(0.1)
	return down
end
local function key(code, hold)
	local e = ev(KEY, 0, 0, code)
	Aim.input.began(e, false)
	task.wait(hold)
	Aim.input.ended(e)
end
local inputTurns = 0
local function inputTurn(s)
	inputTurns += 1
	local cam = workspace.CurrentCamera
	local w, h = cam.ViewportSize.X, cam.ViewportSize.Y
	local a0 = Aim.aim.aimAngle
	if inputTurns == 1 then
		-- Mouse: a drag across the table turns the aim; then the power bar, pulled down, let go.
		local down = drag(Aim.input, MB1, w * 0.4, h * 0.6, w * 0.4 + 260, h * 0.6, 20)
		Aim.input.ended(down)
		task.wait(0.1)
		check("a mouse drag turns the aim", math.abs(Aim.aim.aimAngle - a0) > 0.05, string.format("%.3f rad", Aim.aim.aimAngle - a0))
		Aim.aim.aimAngle = a0
		local pb = Aim.powerBar
		check("the power bar is up on my turn", pb ~= nil and pb.bar.Visible)
		if pb then
			local bar = pb.bar
			local x = bar.AbsolutePosition.X + bar.AbsoluteSize.X / 2
			local top, H = bar.AbsolutePosition.Y, bar.AbsoluteSize.Y
			local pdown = drag(pb, MB1, x, top + 20, x, top + 30 + (H - 60) * 0.8, 15)
			local pw = Aim.aim.power
			check("pulling the power bar down charges the shot", pw > 0.6, string.format("%.2f", pw))
			pb.ended(pdown)
			local t0 = os.clock()
			while not shotAt and os.clock() - t0 < 5 do
				task.wait(0.05)
			end
			check("letting go of the power bar shoots", shotAt ~= nil)
		end
	elseif inputTurns == 2 then
		-- Keyboard: arrows turn the aim, Q sets backspin, Space charges and shoots on release.
		key(Enum.KeyCode.Right, 0.5)
		check("the right arrow turns the aim", Aim.aim.aimAngle - a0 > 0.2, string.format("%.3f rad", Aim.aim.aimAngle - a0))
		Aim.aim.aimAngle = a0
		key(Enum.KeyCode.Q, 0.05)
		check("Q sets a quarter of backspin", math.abs(Aim.aim.spin + 0.25) < 1e-9, Aim.aim.spin)
		Aim.setSpin(0)
		local space = ev(KEY, 0, 0, Enum.KeyCode.Space)
		Aim.input.began(space, false)
		task.wait(1.0)
		local pw = Aim.aim.power
		check("holding Space charges", pw > 0.3, string.format("%.2f", pw))
		Aim.input.ended(space)
		local t0 = os.clock()
		while not shotAt and os.clock() - t0 < 5 do
			task.wait(0.05)
		end
		check("letting go of Space shoots", shotAt ~= nil)
	else
		-- Touch: a finger dragged across the table turns the aim.
		local down = drag(Aim.input, TOUCH, w * 0.4, h * 0.6, w * 0.4 + 260, h * 0.6, 20)
		Aim.input.ended(down)
		task.wait(0.1)
		check("a touch drag turns the aim", math.abs(Aim.aim.aimAngle - a0) > 0.05, string.format("%.3f rad", Aim.aim.aimAngle - a0))
		Aim.aim.aimAngle = a0
		return false -- shoot this turn through Aim as usual
	end
	return true
end

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
		local key = tostring(s.id) .. ":" .. tostring(s.shots) .. ":" .. tostring(s.current)
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
			task.wait(1.3) -- the server's beat before a turn, and the client's own state handler
			if s.firstShot then
				Aim.setPlaceAngle(placeAngle)
			end
			Aim.aim.aimAngle = math.atan2(dir.Y, dir.X)
			if inputTurns < 3 and inputTurn(s) then
				shots += 1
				continue
			end
			Aim.setSpin(0)
			Aim.setPower(0.9)
			Aim.release()
			shots += 1
		end
	end
	task.wait(0.25)
end
check("the match finishes", result ~= nil, result and string.format("scores %s, %d shots by me, %d captures", table.concat(result.scores or {}, "-"), shots, captures))
check("I took shots", shots > 0, shots)
check("the bot showed its aim before each shot", prepares > 0, prepares)
check("the client replayed the shots", replays > 0, replays)
local worst = 0
for _, w in ipairs(waits) do
	worst = math.max(worst, w)
end
check("the server waited for the replays, not a timeout", #waits > 0 and worst < 1.2, string.format("%d shots, worst %.2fs over the replay", #waits, worst))
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
