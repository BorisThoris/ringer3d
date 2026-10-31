-- Temporary playtest rig (Studio local plugin); only runs in a place with ReplicatedStorage.PlayRig.
-- The bot ladder on real Roblox physics: Legend vs Rookie and Skilled vs Casual on every field
-- (medium maps), all at once. The stronger bot sits in seat 1. Results go to the log as "[playrig]" lines.
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
	local cf = CFrame.lookAt(from, at)
	local t1 = os.clock()
	while os.clock() - t1 < 2.5 do
		cam.CFrame = cf
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
task.wait(8)

local ok, err = pcall(function()
	local Table = require(SSS.Server.Table)
	local Config = require(RS.Ringer.Config)
	local Rules = require(RS.Ringer.Rules)
	local function bots(a, b)
		return { { kind = "bot", bot = a, name = "A", marble = "ember" }, { kind = "bot", bot = b, name = "B", marble = "tide" } }
	end

	-- 2. A game on every field, hard maps, skilled vs casual, all at once.
	local results, tables = {}, {}
	local games = {}
	for _, pair in ipairs({ { "legend", "rookie" }, { "skilled", "casual" } }) do
		for _, arena in ipairs(Config.ARENA_ORDER) do
			table.insert(games, { arena = arena, a = pair[1], b = pair[2] })
		end
	end
	for i, g in ipairs(games) do
		local arena = g.a .. "-" .. g.b .. "-" .. g.arena
		local t = Table.new({ seats = bots(g.a, g.b), arena = g.arena, origin = Vector3.new(i * 400, 0, 2000), mode = "test", seed = 31 + i, difficulty = "medium", mapSeed = 7 + i })
		tables[i] = t
		local furthest, cups = 0, 0
		t.send = function(_, kind)
			if kind == "cup" then
				cups += 1
			end
		end
		local watch = RunService.Heartbeat:Connect(function()
			for _, b in ipairs(t:bodies()) do
				if b.Parent then
					furthest = math.max(furthest, t:flat(b.Position).Magnitude)
				end
			end
		end)
		task.spawn(function()
			local started = os.clock()
			local okr, r = pcall(t.run, t)
			watch:Disconnect()
			results[arena] = if okr
				then string.format("%s (%s, %d pieces): %d-%d, winners %s, %d shots, %.0fs, furthest %.1f, cups %d", arena, t.map.name, #t.map.pieces, r.scores[1], r.scores[2], table.concat(r.winners, ","), r.shots, os.clock() - started, furthest, cups)
				else arena .. " ERROR " .. tostring(r)
		end)
	end
	local deadline = os.clock() + 900
	while os.clock() < deadline do
		local n = 0
		for _ in pairs(results) do
			n += 1
		end
		if n == #games then
			break
		end
		task.wait(2)
	end
	local wins = {}
	for _, g in ipairs(games) do
		local key = g.a .. "-" .. g.b .. "-" .. g.arena
		log("game", results[key] or (key .. " UNFINISHED"))
	end
end)
log("run end", ok, err)
RunService:Stop()
log("done")
