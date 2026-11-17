-- Play-mode check (Studio local plugin): only in a place with ReplicatedStorage.PlayMode.
-- Edit: starts a real play session (server + client + a character). Server: gives the player
-- aura in steps (a popup, a rank up, Main Character). Client: screenshots what the player sees.
-- Everything prints "[playmode]" lines; the server ends the test.
local RS = game:GetService("ReplicatedStorage")
if not RS:FindFirstChild("PlayMode") then return end
local RunService = game:GetService("RunService")
local Players = game:GetService("Players")
local function log(...) print("[playmode]", ...) end

if RunService:IsEdit() then
	local cam = workspace.CurrentCamera
	local t0 = os.clock()
	while cam.ViewportSize.X < 1500 and os.clock() - t0 < 90 do task.wait(1) end
	log("edit viewport", cam.ViewportSize)
	task.wait(3)
	local ok, res = pcall(function()
		return game:GetService("StudioTestService"):ExecutePlayModeAsync({})
	end)
	log("play mode returned", ok, tostring(res))
	return
end

if RunService:IsServer() then
	-- The injected hook script does the server's work; end the test when it says so.
	local t = os.clock()
	while not workspace:GetAttribute("PlayModeDone") and os.clock() - t < 120 do task.wait(0.5) end
	log("server saw done", workspace:GetAttribute("PlayModeDone"))
	task.wait(2)
	pcall(function() game:GetService("StudioTestService"):EndTest("done") end)
	return
end

if RunService:IsClient() then
	local CaptureService = game:GetService("CaptureService")
	local function snap(label)
		local done = false
		CaptureService:CaptureScreenshot(function(id) log("capture", label, id) done = true end)
		local t = os.clock()
		while not done and os.clock() - t < 5 do task.wait(0.1) end
	end
	local me = Players.LocalPlayer
	local char = me.Character or me.CharacterAdded:Wait()
	log("client character", char.Name)
	local cam = workspace.CurrentCamera
	-- A front view of the character, close enough to read the nameplate.
	local hold = true
	-- After the game's camera each frame, so this view wins.
	RunService:BindToRenderStep("PlayModeCam", Enum.RenderPriority.Last.Value + 1, function()
		if not hold then return end
		local root = char:FindFirstChild("HumanoidRootPart")
		if root then
			local at = root.Position + Vector3.new(0, 3.2, 0)
			cam.CFrame = CFrame.lookAt(at + root.CFrame.LookVector * 13 + Vector3.new(0, 1.5, 0), at)
		end
	end)
	task.wait(8)
	snap("lobby-nameplate")
	-- Capture when things actually appear: each popup, the rank stamp, the Main Character title.
	local n = 0
	local busy = false
	local function later(label, delay)
		task.delay(delay, function()
			while busy do task.wait(0.05) end
			busy = true
			snap(label)
			busy = false
		end)
	end
	me.PlayerGui.DescendantAdded:Connect(function(d)
		if d.Name == "AuraPop" then
			n += 1
			later(("popup-%d"):format(n), 0.45)
		elseif d.Name == "Stamp" then
			later("rank-stamp", 0.4)
		end
	end)
	me:GetAttributeChangedSignal("MainCharacter"):Connect(function()
		later("main-character", 2)
	end)
	local t = os.clock()
	while not workspace:GetAttribute("PlayModeDone") and os.clock() - t < 90 do task.wait(0.2) end
	log("client saw done", n, "popups")
	task.wait(1)
	hold = false
	RunService:UnbindFromRenderStep("PlayModeCam")
	task.wait(1)
	snap("default-camera")
	log("client done")
end
