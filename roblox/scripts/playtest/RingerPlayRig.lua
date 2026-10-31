-- Temporary playtest rig (Studio local plugin); only runs in a place with ReplicatedStorage.PlayRig.
-- On real Roblox physics: spin A/B on a bare field, then a bot-vs-bot game on every field with a
-- hard generated map, all at once, plus screenshots. Results go to the log as "[playrig]" lines.
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

	-- 1. Spin: the same 0.7-power shot down an arm, with backspin, neutral and topspin.
	for i, spin in ipairs({ -1, 0, 1 }) do
		local t = Table.new({ seats = bots("casual", "casual"), arena = "culdesac", origin = Vector3.new(6000 + i * 400, 0, 0), mode = "test", seed = 5, difficulty = "easy", mapSeed = 1 })
		local map = t.model:FindFirstChild("Map")
		if map then
			map:Destroy()
		end
		t.pieces = { zones = {}, holes = {}, bumpers = {} }
		task.wait(1)
		local a = Rules.seatAngle(1, 2)
		local start = Rules.placement(a)
		t.current = 1
		t.firstShot = true
		t:launch({ placeAngle = a, aimAngle = a + math.pi, power = 0.7, spin = spin })
		t:roll()
		local out = 0
		for _, b in ipairs(t.mibs) do
			if Rules.isOutside(t:flat(b.Position)) then
				out += 1
			end
		end
		local endp = t:flat(t.shooter.Position)
		log(string.format("spin %+d: shooter travelled %.1f, stopped %.1f from centre, %d knocked out", spin, (endp - start).Magnitude, endp.Magnitude, out))
		t:destroy()
	end

	-- 2. A game on every field, hard maps, skilled vs casual, all at once.
	local results, tables = {}, {}
	for i, arena in ipairs(Config.ARENA_ORDER) do
		local t = Table.new({ seats = bots("skilled", "casual"), arena = arena, origin = Vector3.new(i * 400, 0, 2000), mode = "test", seed = 11 + i, difficulty = "hard", mapSeed = 99 })
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
	task.wait(40)
	for _, i in ipairs({ 7, 1, 5, 6 }) do
		local t = tables[i]
		if t and not t.closed then
			snap("map-" .. Config.ARENA_ORDER[i], t.origin + Vector3.new(0, 62, 56), t.origin, 50)
		end
	end
	local deadline = os.clock() + 720
	while os.clock() < deadline do
		local n = 0
		for _ in pairs(results) do
			n += 1
		end
		if n == #Config.ARENA_ORDER then
			break
		end
		task.wait(2)
	end
	for _, arena in ipairs(Config.ARENA_ORDER) do
		log("game", results[arena] or (arena .. " UNFINISHED after 12 minutes"))
	end
end)
log("run end", ok, err)
RunService:Stop()
log("done")
