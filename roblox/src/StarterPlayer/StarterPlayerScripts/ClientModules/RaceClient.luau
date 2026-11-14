-- The downhill race on this client: input (keyboard, gamepad, touch stick through Roblox's own
-- control module; jump), the fixed-step sim (RaceSim) with every input logged, the chase camera,
-- the marble, the other racers' ghosts, the HUD (countdown, timer, medal targets, progress, section
-- names, shortcuts) and the results. At the finish the input log goes to the server, which replays
-- it and pays for the verified time.

local Lighting = game:GetService("Lighting")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local RaceTrack = require(ReplicatedStorage.Ringer.RaceTrack)
local RaceSim = require(ReplicatedStorage.Ringer.RaceSim)
local MarbleLook = require(ReplicatedStorage.Ringer.MarbleLook)

local RaceClient = {}
RaceClient.racing = false
-- Set by the client: ask(action, args), the lobby HUD to hide, Sfx, Juice, Rewards, Kit, toast.
RaceClient.deps = nil :: any

local player = Players.LocalPlayer
local gui: ScreenGui? = nil
local conn: RBXScriptConnection? = nil
local marble: BasePart? = nil
local ghosts: { [number]: { part: BasePart, target: Vector3 } } = {}
local savedLight: any = nil
local jumpQueued = false
local respawnQueued = false

local function fmt(t: number): string
	return string.format("%d:%05.2f", math.floor(t / 60), t % 60)
end

local function label(parent: Instance, text: string, size: number, props: { [string]: any }?): TextLabel
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Font = Enum.Font.FredokaOne
	l.Text = text
	l.TextSize = size
	l.TextColor3 = Color3.new(1, 1, 1)
	l.TextStrokeTransparency = 0
	l.TextStrokeColor3 = Color3.fromRGB(30, 22, 40)
	for k, v in pairs(props or {}) do
		(l :: any)[k] = v
	end
	l.Parent = parent
	return l
end

local function button(parent: Instance, text: string, color: Color3, props: { [string]: any }, onClick: () -> ()): TextButton
	local b = Instance.new("TextButton")
	b.Font = Enum.Font.FredokaOne
	b.TextSize = 24
	b.Text = text
	b.TextColor3 = Color3.new(1, 1, 1)
	b.BackgroundColor3 = color
	b.AutoButtonColor = true
	for k, v in pairs(props) do
		(b :: any)[k] = v
	end
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, 14)
	c.Parent = b
	local s = Instance.new("UIStroke")
	s.Thickness = 3
	s.Color = Color3.fromRGB(30, 22, 40)
	s.ApplyStrokeMode = Enum.ApplyStrokeMode.Border
	s.Parent = b
	b.Parent = parent
	b.Activated:Connect(onClick)
	return b
end

local function setLight(on: boolean)
	local atm = Lighting:FindFirstChildOfClass("Atmosphere")
	if on then
		savedLight = { clock = Lighting.ClockTime, atm = atm and { Density = atm.Density, Color = atm.Color, Decay = atm.Decay, Haze = atm.Haze } }
		TweenService:Create(Lighting, TweenInfo.new(1.2), { ClockTime = 15.8 }):Play()
		if atm then
			TweenService:Create(atm, TweenInfo.new(1.2), { Density = 0.18, Color = Color3.fromRGB(235, 230, 250), Decay = Color3.fromRGB(150, 190, 255), Haze = 0.8 }):Play()
		end
	elseif savedLight then
		TweenService:Create(Lighting, TweenInfo.new(1.2), { ClockTime = savedLight.clock }):Play()
		if atm and savedLight.atm then
			TweenService:Create(atm, TweenInfo.new(1.2), savedLight.atm):Play()
		end
		savedLight = nil
	end
end

local function controls()
	local ok, mod = pcall(function()
		return require(player:WaitForChild("PlayerScripts"):WaitForChild("PlayerModule")):GetControls()
	end)
	return if ok then mod else nil
end

local function ghostFor(userId: number, marbleId: any): BasePart
	local g = ghosts[userId]
	if g then
		return g.part
	end
	local p = MarbleLook.make(MarbleLook.lookFor(if typeof(marbleId) == "string" then marbleId else "ember"), RaceSim.R)
	p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
	p.Name = "Ghost" .. userId
	p.Parent = Workspace
	ghosts[userId] = { part = p, target = p.Position }
	return p
end

local function clearGhosts()
	for _, g in pairs(ghosts) do
		g.part:Destroy()
	end
	table.clear(ghosts)
end

--- Leave the race and give the lobby back.
function RaceClient.stop()
	RaceClient.racing = false
	if conn then
		conn:Disconnect()
		conn = nil
	end
	if marble then
		marble:Destroy()
		marble = nil
	end
	if gui then
		gui:Destroy()
		gui = nil
	end
	clearGhosts()
	setLight(false)
	local cam = Workspace.CurrentCamera
	cam.CameraType = Enum.CameraType.Custom
	cam.FieldOfView = 70
	local d = RaceClient.deps
	if d then
		d.hud.Visible = true
		d.Sfx.setRolling(0)
		d.Sfx.music("lobby")
		d.ask("raceLeave")
	end
end

local run: () -> () = nil :: any

local function results(r: any)
	local d = RaceClient.deps
	if not gui or not d then
		return
	end
	local panel = Instance.new("Frame")
	panel.Name = "Results"
	panel.AnchorPoint = Vector2.new(0.5, 0.5)
	panel.Position = UDim2.fromScale(0.5, 0.5)
	panel.Size = UDim2.fromOffset(520, 420)
	panel.BackgroundColor3 = Color3.fromRGB(60, 120, 230)
	panel.Parent = gui
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, 22)
	c.Parent = panel
	local s = Instance.new("UIStroke")
	s.Thickness = 4
	s.Color = Color3.fromRGB(30, 22, 40)
	s.Parent = panel
	local medal = if r.medal == "Gold" then "🥇 GOLD" elseif r.medal == "Silver" then "🥈 SILVER" elseif r.medal == "Bronze" then "🥉 BRONZE" else "FINISHED!"
	label(panel, medal, 48, { Size = UDim2.new(1, 0, 0, 60), Position = UDim2.fromOffset(0, 16) })
	label(panel, fmt(r.time), 56, { Size = UDim2.new(1, 0, 0, 64), Position = UDim2.fromOffset(0, 80), TextColor3 = Color3.fromRGB(255, 230, 120) })
	label(panel, if r.newBest then "NEW PERSONAL BEST!" else ("Best " .. fmt(r.best or r.time)), 24, { Size = UDim2.new(1, 0, 0, 30), Position = UDim2.fromOffset(0, 148) })
	label(panel, string.format("+%d coins", r.coins), 28, { Size = UDim2.new(1, 0, 0, 34), Position = UDim2.fromOffset(0, 182), TextColor3 = Color3.fromRGB(255, 215, 80) })
	local board = label(panel, "Leaderboard loading...", 18, { Size = UDim2.new(1, -40, 0, 120), Position = UDim2.fromOffset(20, 222), TextYAlignment = Enum.TextYAlignment.Top })
	task.spawn(function()
		local ok, top = d.ask("raceTop")
		if ok and typeof(top) == "table" and gui then
			local lines = {}
			for i, e in ipairs(top) do
				if i > 5 then
					break
				end
				table.insert(lines, string.format("%d. %s  %s", i, e.name, fmt(e.time)))
			end
			board.Text = if #lines > 0 then table.concat(lines, "\n") else "Be the first on the board!"
		end
	end)
	button(panel, "Race again", Color3.fromRGB(70, 200, 110), { Size = UDim2.fromOffset(220, 56), Position = UDim2.new(0, 24, 1, -72) }, function()
		panel:Destroy()
		run()
	end)
	button(panel, "Lobby", Color3.fromRGB(255, 120, 50), { Size = UDim2.fromOffset(220, 56), Position = UDim2.new(1, -244, 1, -72) }, function()
		RaceClient.stop()
	end)
	if r.medal then
		d.Rewards.confetti(90)
		d.Sfx.ui("fanfare", 0.8)
	end
end

local function buildHud(medals: any)
	local g = Instance.new("ScreenGui")
	g.Name = "RaceHud"
	g.ResetOnSpawn = false
	g.IgnoreGuiInset = true
	g.Parent = player:WaitForChild("PlayerGui")
	gui = g
	local timer = label(g, "0:00.00", 54, { Name = "Timer", AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 48), Size = UDim2.fromOffset(300, 60) })
	local speed = label(g, "", 30, { Name = "Speed", AnchorPoint = Vector2.new(1, 1), Position = UDim2.new(1, -24, 1, -24), Size = UDim2.fromOffset(240, 40), TextXAlignment = Enum.TextXAlignment.Right })
	local section = label(g, "", 30, { Name = "Section", AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 108), Size = UDim2.fromOffset(600, 40), TextColor3 = Color3.fromRGB(200, 240, 255) })
	local lines = {}
	for _, m in ipairs(medals) do
		table.insert(lines, string.format("%s %s", if m[1] == "Gold" then "🥇" elseif m[1] == "Silver" then "🥈" else "🥉", fmt(m[2])))
	end
	label(g, table.concat(lines, "\n"), 22, { Name = "Medals", AnchorPoint = Vector2.new(1, 0), Position = UDim2.new(1, -24, 0, 60), Size = UDim2.fromOffset(180, 90), TextXAlignment = Enum.TextXAlignment.Right, TextYAlignment = Enum.TextYAlignment.Top })
	-- Progress down the mountain.
	local bar = Instance.new("Frame")
	bar.Name = "Progress"
	bar.AnchorPoint = Vector2.new(0, 0.5)
	bar.Position = UDim2.new(0, 24, 0.5, 0)
	bar.Size = UDim2.fromOffset(14, 320)
	bar.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
	bar.BackgroundTransparency = 0.4
	bar.Parent = g
	local dot = Instance.new("Frame")
	dot.Name = "Me"
	dot.AnchorPoint = Vector2.new(0.5, 0.5)
	dot.Size = UDim2.fromOffset(22, 22)
	dot.BackgroundColor3 = Color3.fromRGB(255, 215, 60)
	dot.Parent = bar
	local dc = Instance.new("UICorner")
	dc.CornerRadius = UDim.new(1, 0)
	dc.Parent = dot
	local d = RaceClient.deps
	button(g, "↺ Respawn (R)", Color3.fromRGB(60, 150, 255), { Size = UDim2.fromOffset(190, 50), AnchorPoint = Vector2.new(0, 1), Position = UDim2.new(0, 24, 1, -24) }, function()
		respawnQueued = true
	end)
	button(g, "Leave", Color3.fromRGB(255, 80, 80), { Size = UDim2.fromOffset(110, 50), AnchorPoint = Vector2.new(0, 1), Position = UDim2.new(0, 224, 1, -24) }, function()
		RaceClient.stop()
	end)
	local _ = d
	return timer, speed, section, dot
end

local function banner(text: string, color: Color3)
	if not gui then
		return
	end
	local l = label(gui, text, 54, { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.36), Size = UDim2.fromOffset(700, 80), TextColor3 = color })
	local sc = Instance.new("UIScale")
	sc.Scale = 2.4
	sc.Parent = l
	TweenService:Create(sc, TweenInfo.new(0.3, Enum.EasingStyle.Back), { Scale = 1 }):Play()
	task.delay(0.9, function()
		TweenService:Create(l, TweenInfo.new(0.35), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
		task.wait(0.4)
		l:Destroy()
	end)
end

--- Start (or restart) a run.
run = function()
	local d = RaceClient.deps
	local ok, info = d.ask("raceStart")
	if not ok then
		d.toast(typeof(info) == "string" and info or "Couldn't start the race.", "bad")
		return
	end
	RaceClient.racing = true
	d.hud.Visible = false
	if gui then
		gui:Destroy()
	end
	if conn then
		conn:Disconnect()
	end
	if marble then
		marble:Destroy()
	end
	setLight(true)
	d.Sfx.music("match")
	local timer, speedLabel, section, dot = buildHud(info.medals)
	local course = RaceTrack.get()
	local st = RaceSim.new()
	local log = RaceSim.newLog()
	local look = MarbleLook.lookFor(player:GetAttribute("Marble") or "ember")
	local m = MarbleLook.make(look, RaceSim.R)
	m.Anchored, m.CanCollide, m.CanQuery, m.CanTouch = true, false, false, false
	m.Name = "RaceMarble"
	m.Parent = Workspace
	marble = m
	local cam = Workspace.CurrentCamera
	cam.CameraType = Enum.CameraType.Scriptable
	local prevPos = RaceSim.position(st)
	local curPos = prevPos
	local heading = Vector3.new(1, 0, 0)
	local rot = CFrame.identity
	local acc = 0
	local countdown = info.countdown or 3
	local started = os.clock() + countdown
	local lastCount = -1
	local lastSection = ""
	local ghostAt = 0
	local done = false
	local ctl = controls()
	conn = RunService.RenderStepped:Connect(function(dt)
		local now = os.clock()
		-- Countdown: 3, 2, 1, GO.
		if now < started then
			local n = math.ceil(started - now)
			if n ~= lastCount then
				lastCount = n
				banner(tostring(n), Color3.fromRGB(255, 230, 120))
				d.Sfx.ui("tick", 0.9)
			end
		elseif lastCount ~= 0 then
			lastCount = 0
			banner("GO!", Color3.fromRGB(120, 255, 140))
			d.Sfx.ui("whoosh", 1)
		end
		if now >= started and not done then
			acc += math.min(dt, 0.1)
			local steps = 0
			while acc >= RaceSim.DT and steps < 6 do
				acc -= RaceSim.DT
				steps += 1
				local move = if ctl then ctl:GetMoveVector() else Vector3.zero
				local raw = { steer = move.X, throttle = -move.Z, jump = jumpQueued, respawn = respawnQueued }
				jumpQueued = false
				respawnQueued = false
				local input = RaceSim.record(log, st.tick, raw)
				prevPos = curPos
				RaceSim.step(st, input)
				curPos = RaceSim.position(st)
				for _, e in ipairs(st.events) do
					if e == "bump" then
						d.Sfx.clack(500, "kerb")
						d.Juice.sparks(curPos, 400)
					elseif e == "jump" then
						d.Sfx.ui("boing", 0.6)
					elseif e == "land" then
						d.Juice.kick(0.25)
						d.Juice.sparks(curPos - Vector3.new(0, 1.5, 0), 500, Color3.fromRGB(255, 255, 255))
					elseif e == "boost" then
						if d.Juice.fovKick < 4 then
							d.Sfx.ui("whoosh", 0.7)
						end
						d.Juice.fovKick = math.max(d.Juice.fovKick, 8)
					elseif e == "checkpoint" then
						d.Sfx.chime("turn")
						banner("CHECKPOINT  " .. fmt(st.tick / 60), Color3.fromRGB(150, 220, 255))
					elseif e == "respawn" then
						d.Juice.screenFlash(0.6)
						d.Sfx.chime("lose")
					elseif e:sub(1, 5) == "path:" and e ~= "path:main" then
						banner("SHORTCUT! ⚡", Color3.fromRGB(255, 220, 60))
						d.Sfx.ui("levelup", 0.7)
					elseif e == "finish" then
						done = true
						banner("FINISH!", Color3.fromRGB(255, 120, 180))
						d.Sfx.chime("win")
						task.spawn(function()
							local okF, r = d.ask("raceFinish", log)
							if okF then
								results(r)
							else
								d.toast(typeof(r) == "string" and r or "Couldn't check that run.", "bad")
								task.wait(1)
								results({ time = st.finishTick / 60, coins = 0, best = info.best })
							end
						end)
					end
				end
			end
		end
		-- The marble: interpolated between sim steps, rolling as it goes.
		local alpha = math.clamp(acc / RaceSim.DT, 0, 1)
		local pos = prevPos:Lerp(curPos, alpha)
		local vel = (curPos - prevPos) / RaceSim.DT
		local horiz = Vector3.new(vel.X, 0, vel.Z)
		if horiz.Magnitude > 2 then
			heading = heading:Lerp(horiz.Unit, math.min(1, dt * 4)).Unit
			local axis = Vector3.new(0, 1, 0):Cross(horiz.Unit)
			rot = CFrame.fromAxisAngle(axis, vel.Magnitude * dt / RaceSim.R) * rot
		end
		m.CFrame = CFrame.new(pos) * rot
		-- The chase camera: behind and above, wider and further back with speed.
		local spd = RaceSim.speed(st)
		local back = 18 + spd * 0.06
		local camPos = pos - heading * back + Vector3.new(0, 7 + spd * 0.02, 0)
		cam.CFrame = cam.CFrame:Lerp(CFrame.lookAt(camPos, pos + heading * 14 + Vector3.new(0, 2, 0)), math.min(1, dt * 8))
		d.Juice.apply(cam, pos, 70 + math.min(25, spd * 0.15), dt)
		if spd > 105 and math.random() < dt * 3 then
			d.Juice.speedLines(0.7)
		end
		d.Sfx.setRolling(if st.air then 0 else spd / 4)
		-- HUD.
		local t = if now >= started then (if done then st.finishTick else st.tick) / 60 else 0
		timer.Text = fmt(t)
		speedLabel.Text = string.format("%d studs/s", math.floor(spd))
		local f = RaceTrack.frame(course.paths[st.path], st.s)
		if f.section ~= lastSection then
			lastSection = f.section
			section.Text = string.upper(f.section)
		end
		dot.Position = UDim2.fromScale(0.5, RaceSim.progress(st))
		-- Ghosts: send mine ten times a second, ease the others toward theirs.
		if now - ghostAt > 0.1 then
			ghostAt = now
			d.Remotes.RaceGhost:FireServer(pos)
		end
		for _, g in pairs(ghosts) do
			g.part.CFrame = CFrame.new(g.part.Position:Lerp(g.target, math.min(1, dt * 10)))
		end
	end)
end

--- Wire up once: the ghost relay, jump and respawn keys.
function RaceClient.init(deps: any)
	RaceClient.deps = deps
	deps.Remotes:WaitForChild("RaceGhost").OnClientEvent:Connect(function(userId, pos, marbleId)
		if RaceClient.racing and typeof(pos) == "Vector3" and typeof(userId) == "number" then
			ghostFor(userId, marbleId)
			ghosts[userId].target = pos
		end
	end)
	UserInputService.JumpRequest:Connect(function()
		if RaceClient.racing then
			jumpQueued = true
		end
	end)
	UserInputService.InputBegan:Connect(function(input, processed)
		if RaceClient.racing and not processed and input.KeyCode == Enum.KeyCode.R then
			respawnQueued = true
		end
	end)
end

--- From the lobby: go race.
function RaceClient.begin()
	if RaceClient.racing or not RaceClient.deps then
		return
	end
	run()
end

return RaceClient
