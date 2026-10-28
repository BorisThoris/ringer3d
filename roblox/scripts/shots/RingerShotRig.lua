-- Temporary screenshot rig. Does nothing unless the open place has ReplicatedStorage.ShotRig.
-- Runs the place (server scripts build the lobby), stages bot-vs-bot tables on each field and
-- takes CaptureService screenshots from set camera angles; the files land in tmp-capture-storage.
local RS = game:GetService("ReplicatedStorage")
if not RS:FindFirstChild("ShotRig") then return end
local RunService = game:GetService("RunService")
if not RunService:IsEdit() then return end
local CaptureService = game:GetService("CaptureService")
local SSS = game:GetService("ServerScriptService")
local function log(...) print("[shotrig]", ...) end

local cam = workspace.CurrentCamera
local function snap(label, from, at, fov)
	cam.CameraType = Enum.CameraType.Scriptable
	cam.FieldOfView = fov or 50
	local cf = CFrame.lookAt(from, at)
	local t1 = os.clock()
	while os.clock() - t1 < 2.5 do cam.CFrame = cf cam.Focus = CFrame.new(at) task.wait() end
	local done = false
	CaptureService:CaptureScreenshot(function(id)
		log("capture", label, id, os.clock())
		done = true
	end)
	local t = os.clock()
	while not done and os.clock() - t < 5 do task.wait(0.1) end
	task.wait(0.4)
end

-- Wait for the probe to enlarge the window.
local t0 = os.clock()
while cam.ViewportSize.X < 1500 and os.clock() - t0 < 90 do task.wait(1) end
log("viewport", cam.ViewportSize)
RunService:Run()
task.wait(12)

-- Lobby.
snap("lobby-wide", Vector3.new(0, 26, 70), Vector3.new(0, 3, 0), 55)
snap("lobby-low", Vector3.new(14, 6, 26), Vector3.new(0, 2, -4), 50)
snap("lobby-board", Vector3.new(6, 9, -22), Vector3.new(0, 9, -45), 55)
snap("lobby-showcase", Vector3.new(0, 5, 12), Vector3.new(0, 1.5, 0), 40)

-- Tables on every field, bots only.
local Table = require(SSS.Server.Table)
local fields = { "grass", "ice", "sand", "desk", "gravel", "culdesac" }
local looks = { { "ember", "tide" }, { "aurora", "rime" }, { "comet", "jade" }, { "pumpkin", "volt" }, { "ironside", "pip" }, { "aurora", "comet" } }
local tables = {}
for i, f in ipairs(fields) do
	local origin = Vector3.new(1500 + i * 400, 0, 1500)
	local ok, tbl = pcall(Table.new, {
		seats = {
			{ kind = "bot", bot = "expert", name = "A", marble = looks[i][1] },
			{ kind = "bot", bot = "skilled", name = "B", marble = looks[i][2] },
		},
		arena = f, origin = origin, mode = "bot", seed = 100 + i,
	})
	log("table", f, ok, ok and "" or tbl)
	if ok then tables[i] = { tbl = tbl, origin = origin, field = f } end
end
task.wait(3)
-- The opening: the cross of thirteen marbles before the first shot.
for i, t in pairs(tables) do
	local o = t.origin
	snap("open-" .. t.field, o + Vector3.new(0, 30, 46), o, 50)
end
for i, t in pairs(tables) do
	task.spawn(function() local ok, err = pcall(t.tbl.run, t.tbl) log("run end", t.field, ok, err) end)
end
-- Bursts while they play: high three-quarter view and low marble's-eye view.
for round = 1, 8 do
	for i, t in pairs(tables) do
		local o = t.origin
		if round % 2 == 1 then
			snap(("mid-%s-%02d-high"):format(t.field, round), o + Vector3.new(-22, 24, 34), o, 50)
		else
			snap(("mid-%s-%02d-low"):format(t.field, round), o + Vector3.new(10, 4, 24), o + Vector3.new(0, 0.5, 0), 45)
		end
	end
end
log("done")
