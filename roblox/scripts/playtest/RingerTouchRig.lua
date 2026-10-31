-- Temporary touch rig (Studio local plugin); only runs in a place with ReplicatedStorage.PlayRig.
-- Edit side: injects a server script (ends the test) and a client LocalScript (starts a match vs a
-- Rookie and logs every shot the server broadcasts), then starts a play session. Client side: the
-- same plugin, loaded in the play client, plays with emulated TOUCH only (StudioDeviceEmulatorService):
-- a tap on the spin pad's top half for topspin, then press on the field, drag back, release.
-- Pass = the server broadcasts shots from this player with spin > 0.
local RS = game:GetService("ReplicatedStorage")
if not RS:FindFirstChild("PlayRig") then
	return
end
local RunService = game:GetService("RunService")
local function log(...)
	print("[touch]", ...)
end

if RunService:IsEdit() then
	task.wait(15)
	local server = Instance.new("Script")
	server.Name = "TouchServer"
	server.Source = [==[
local RS = game:GetService("ReplicatedStorage")
local STS = game:GetService("StudioTestService")
local ev = Instance.new("RemoteEvent")
ev.Name = "TouchDone"
ev.Parent = RS
ev.OnServerEvent:Connect(function(_, summary)
	print("[touch] client done:", summary)
	STS:EndTest(summary)
end)
task.delay(600, function()
	STS:EndTest("timeout")
end)
]==]
	server.Parent = game:GetService("ServerScriptService")
	local client = Instance.new("LocalScript")
	client.Name = "TouchClient"
	client.Source = [==[
local RS = game:GetService("ReplicatedStorage")
local me = game:GetService("Players").LocalPlayer
local Remotes = RS:WaitForChild("Ringer"):WaitForChild("Remotes", 60)
local Request = Remotes:WaitForChild("Request")
local Done = RS:WaitForChild("TouchDone", 60)
local mySeat, touchShots, spun, result = nil, 0, 0, nil
Remotes:WaitForChild("TableEvent").OnClientEvent:Connect(function(kind, data)
	if kind == "state" and not mySeat then
		for i, s in ipairs(data.seats) do
			if s.userId == me.UserId then
				mySeat = i
			end
		end
	elseif kind == "shot" and data.seat == mySeat then
		touchShots += 1
		if (data.spin or 0) > 0 then
			spun += 1
		end
		print(string.format("[touch] server got my shot: power %.2f, spin %+.2f", data.power, data.spin or 0))
	elseif kind == "result" then
		result = data
	end
end)
Request:InvokeServer("profile")
task.wait(2)
print("[touch] start match:", Request:InvokeServer("play", { mode = "bot", bot = "rookie", arena = "culdesac", difficulty = "easy" }))
local t = os.clock()
while touchShots < 3 and not result and os.clock() - t < 420 do
	task.wait(1)
end
local summary = string.format("touch shots reached the server: %d, with topspin: %d", touchShots, spun)
print("[touch]", (touchShots > 0 and spun > 0) and "PASS" or "FAIL", summary)
Done:FireServer(summary)
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
	return
end

if not RunService:IsClient() then
	return
end
-- ---- In the play client: drive the game with emulated touch -----------------------------------
local Players = game:GetService("Players")
local me = Players.LocalPlayer
while not me do
	task.wait(0.5)
	me = Players.LocalPlayer
end
-- Touches go in through VirtualInputManager (the device emulator is not reachable in the play client).
local vim = game:GetService("VirtualInputManager")
local inset = game:GetService("GuiService"):GetGuiInset()
log("VirtualInputManager", vim ~= nil, "touch enabled", game:GetService("UserInputService").TouchEnabled)
local id = 0
local function touch(path: { Vector2 })
	id += 1
	local okt, e = pcall(function()
		-- Screen points are GUI points plus the top bar inset.
		local function at(i)
			return path[i].X + inset.X, path[i].Y + inset.Y
		end
		local x, y = at(1)
		vim:SendTouchEvent(id, 0, x, y)
		task.wait(0.08)
		for i = 2, #path do
			x, y = at(i)
			vim:SendTouchEvent(id, 1, x, y)
			task.wait(0.05)
		end
		task.wait(0.08)
		vim:SendTouchEvent(id, 2, x, y)
	end)
	if not okt then
		log("touch emit failed", tostring(e))
	end
end
local gui = me:WaitForChild("PlayerGui"):WaitForChild("Ringer", 60)
local match = gui and gui:WaitForChild("Match", 30)
local cam = workspace.CurrentCamera
local played = 0
local t = os.clock()
while played < 3 and os.clock() - t < 420 do
	-- My turn: the spin pad shows only then.
	local pad = match and match:FindFirstChildWhichIsA("TextButton")
	local padVisible = false
	if match and match.Visible then
		for _, b in ipairs(match:GetChildren()) do
			if b:IsA("TextButton") and b.Visible and b.Text == "" then
				pad, padVisible = b, true
			end
		end
	end
	if padVisible and pad then
		task.wait(1.5)
		-- Topspin: touch the top part of the pad.
		local p = pad.AbsolutePosition + Vector2.new(pad.AbsoluteSize.X / 2, pad.AbsoluteSize.Y * 0.15)
		touch({ p, p + Vector2.new(0, 2) })
		task.wait(0.5)
		-- The shot: press near the screen centre (the field), pull back toward the bottom, let go.
		local c = cam.ViewportSize / 2
		local path = {}
		for k = 0, 8 do
			table.insert(path, c + Vector2.new(0, k * 30))
		end
		touch(path)
		played += 1
		log("touch shot", played, "sent")
		task.wait(8)
	end
	task.wait(0.5)
end
