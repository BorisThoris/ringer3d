-- Temporary art rig (Studio local plugin); only runs in a place with ReplicatedStorage.PlayRig.
-- Real in-game frames for the store page: the lobby's Void mascot and pedestals, phenomenon
-- marbles up close, and a mini-golf game being played.
local RS = game:GetService("ReplicatedStorage")
if not RS:FindFirstChild("PlayRig") then
	return
end
local RunService = game:GetService("RunService")
if not RunService:IsEdit() then
	return
end
local CaptureService = game:GetService("CaptureService")
local SSS = game:GetService("ServerScriptService")
local function log(...)
	print("[playrig]", ...)
end
local cam = workspace.CurrentCamera
local function snap(label, from, at, fov)
	cam.CameraType = Enum.CameraType.Scriptable
	cam.FieldOfView = fov or 50
	local t1 = os.clock()
	while os.clock() - t1 < 2.5 do
		cam.CFrame = CFrame.lookAt(from, at)
		cam.Focus = CFrame.new(at)
		task.wait()
	end
	local done = false
	CaptureService:CaptureScreenshot(function(id)
		log("capture", label, id)
		done = true
	end)
	local t = os.clock()
	while not done and os.clock() - t < 5 do
		task.wait(0.1)
	end
end
local t0 = os.clock()
while cam.ViewportSize.X < 1500 and os.clock() - t0 < 90 do
	task.wait(1)
end
RunService:Run()
task.wait(12)

local ok, err = pcall(function()
	local Forge = require(RS.Ringer.Forge)
	local MarbleLook = require(RS.Ringer.MarbleLook)
	local Table = require(SSS.Server.Table)

	-- The lobby.
	snap("mascot", Vector3.new(0, 19, 24), Vector3.new(0, 17, 0), 42)
	snap("pedestals", Vector3.new(0, 8, 24), Vector3.new(0, 4, 4), 50)
	snap("plaza", Vector3.new(30, 10, 80), Vector3.new(0, 6, 0), 55)

	-- Phenomenon marbles up close, on a dark plinth away from everything.
	local stage = Instance.new("Part")
	stage.Anchored = true
	stage.Size = Vector3.new(30, 1, 30)
	stage.CFrame = CFrame.new(5000, -0.5, 5000)
	stage.Color = Color3.fromRGB(40, 20, 70)
	stage.Parent = workspace
	for _, e in ipairs(Forge.EFFECT_IDS) do
		for i = 1, 4000 do
			local id = Forge.collectibleId("Mythic", "Rart" .. i)
			local c = Forge.fromId(id)
			if c and c.effect == e then
				local ball = MarbleLook.make(MarbleLook.lookFor(id), 3)
				ball.Anchored = true
				ball.CFrame = CFrame.new(5000, 3, 5000)
				ball.Parent = workspace
				snap("fx-" .. e, Vector3.new(5000, 5, 5011), Vector3.new(5000, 3, 5000), 40)
				ball:Destroy()
				break
			end
		end
	end
	stage:Destroy()

	-- A mini-golf game in play.
	local t = Table.new({ seats = { { kind = "bot", bot = "skilled", name = "A", marble = "volt" }, { kind = "bot", bot = "casual", name = "B", marble = "ember" } }, arena = "minigolf", origin = Vector3.new(3000, 0, 3000), mode = "test", seed = 4, difficulty = "hard", mapSeed = 99 })
	task.spawn(function()
		pcall(t.run, t)
	end)
	task.wait(14)
	snap("golf-low", t.origin + Vector3.new(0, 24, 48), t.origin + Vector3.new(0, 0, 4), 50)
	task.wait(10)
	snap("golf-high", t.origin + Vector3.new(30, 50, 30), t.origin, 45)
	t.closed = true
end)
log("run end", ok, err)
RunService:Stop()
log("done")
