-- Playing a table: the camera, the aim, the guide and the shot, with the web game's controls
-- (src/render/controls.ts, src/ui/Hud.tsx, the aim view in GameView.ts):
--  * drag anywhere: turn the aim (slow drags are finer); drag up and down: tilt the camera;
--  * on a turn's first shot, drag your taw: slide it round the ring line;
--  * the power bar: press, pull down, let go to shoot; or hold Space to charge and let go;
--  * the spin pad (top: topspin, follow; bottom: backspin, stick); Q/E in quarters;
--  * arrows turn the aim (Shift: fine), A/D slide along the line, Up/Down tilt, wheel zooms,
--    T top view, F fast-forward, Esc cancels a charge.
-- The guide is the web game's: the line to the first marble in reach, that marble's way out and
-- where your taw glances off, as long as the floor allows (full, short or off).

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage.Ringer.Config)
local Rules = require(ReplicatedStorage.Ringer.Rules)
local Sim = require(ReplicatedStorage.Ringer.Sim)
local MarbleLook = require(ReplicatedStorage.Ringer.MarbleLook)

local Aim = {}
Aim.state = nil :: any
Aim.mySeat = nil :: number?
Aim.topView = false
Aim.guideSetting = "full" -- the player's own choice; a floor may cap it lower
Aim.sensitivity = 1
Aim.onPower = function(_power: number) end -- the HUD's power bar
Aim.onShot = function() end
Aim.onSpin = function(_spin: number) end
Aim.onFast = function(_on: boolean) end
Aim.fast = false
-- How a shot leaves (a test replaces it).
Aim.sendShot = function(id: number, placeAngle: number, aimAngle: number, power: number, spin: number)
	ReplicatedStorage.Ringer.Remotes.Shoot:FireServer(id, placeAngle, aimAngle, power, spin)
end

local W = Sim.WORLD
local S = Config.MAP_SCALE
local TAU = math.pi * 2
local FREE_RETICLE = 1.2 -- web units: where the reticle floats with the guide off

-- The shot being set up, as the web game's AimView: web-game angles (0 = +x, toward +z).
local aim = { placeAngle = 0, aimAngle = math.pi, power = 0, spin = 0 }
Aim.aim = aim
local sent = false
local charging, chargeT = false, 0
local pitch, zoom = 0.62, 1
local prepared: { shot: any, from: any, t: number, duration: number }? = nil
local keysDown: { [Enum.KeyCode]: boolean } = {} -- keys held, kept by the input handlers

local camera = Workspace.CurrentCamera or Instance.new("Camera")
local viz: Folder? = nil
local ghost: BasePart? = nil
local lines: { Part } = {}
local reticle: Part? = nil
local chargeRing: Part? = nil

local function wrap(a: number): number
	return (a + math.pi) % TAU - math.pi
end

local function lerpAngle(a: number, b: number, t: number): number
	return a + wrap(b - a) * t
end

local function myTurn(): boolean
	local s = Aim.state
	return s ~= nil and s.phase == "aim" and Aim.mySeat ~= nil and s.current == Aim.mySeat and not sent and prepared == nil
end
Aim.myTurn = myTurn

local function canPlace(): boolean
	return myTurn() and Aim.state.firstShot
end

local function guideCap(): string
	local rank = { off = 0, short = 1, full = 2 }
	local cap = Aim.state and Aim.state.guide or "full"
	return if rank[cap] < rank[Aim.guideSetting] then cap else Aim.guideSetting
end

-- ---- Coordinates (web units on the ring <-> studs) ----------------------------------------
local function world(x: number, y: number, z: number): Vector3
	return Aim.state.origin + Vector3.new(x * S, y * S, z * S)
end

--- Where the shot leaves from, in web units: the knuckle-down spot or where the taw stopped.
local function originXZ(): (number, number)
	local s = Aim.state
	if s.firstShot or not (s.layout and s.layout.shooter) then
		return Sim.placementPoint(aim.placeAngle)
	end
	return s.layout.shooter.x, s.layout.shooter.z
end

-- Where a screen point meets the table's ground, in web units.
local function groundPoint(screen: Vector2): (number?, number?)
	local ray = camera:ScreenPointToRay(screen.X, screen.Y)
	if math.abs(ray.Direction.Y) < 1e-4 then
		return nil, nil
	end
	local t = (Aim.state.origin.Y - ray.Origin.Y) / ray.Direction.Y
	if t < 0 then
		return nil, nil
	end
	local hit = ray.Origin + ray.Direction * t - Aim.state.origin
	return hit.X / S, hit.Z / S
end

-- ---- The shot -------------------------------------------------------------------------------
function Aim.rotateAim(delta: number)
	if myTurn() then
		aim.aimAngle = wrap(aim.aimAngle + delta)
	end
end

function Aim.setPlaceAngle(a: number)
	if not canPlace() then
		return
	end
	-- Keep the aim's offset from "straight in" as the taw slides round the ring.
	local offset = wrap(aim.aimAngle - (aim.placeAngle + math.pi))
	aim.placeAngle = wrap(a)
	aim.aimAngle = wrap(aim.placeAngle + math.pi + offset)
end

function Aim.setPower(p: number)
	if not myTurn() then
		return
	end
	aim.power = math.clamp(p, 0, 1)
	Aim.onPower(aim.power)
end

function Aim.setSpin(v: number)
	aim.spin = math.clamp(v, -1, 1)
	Aim.onSpin(aim.spin)
end

--- Let go of the flick.
function Aim.release()
	if not myTurn() then
		return
	end
	charging = false
	local power = aim.power
	if power < Config.MIN_POWER then
		Aim.setPower(0)
		return
	end
	sent = true
	Aim.sendShot(Aim.state.id, aim.placeAngle, aim.aimAngle, power, aim.spin)
	aim.power = 0
	Aim.onPower(0)
	Aim.onShot()
end

function Aim.startCharge()
	if myTurn() and not charging then
		charging = true
		chargeT = 0
	end
end

function Aim.cancel()
	charging = false
	Aim.setPower(0)
end

function Aim.toggleFast()
	Aim.fast = not Aim.fast
	Aim.onFast(Aim.fast)
	if RunService:IsClient() then
		ReplicatedStorage.Ringer.Remotes.Fast:FireServer(Aim.fast)
	end
end

--- A bot's (or another player's) shot is coming: swing the aim round to it, then charge, as
--- the web game shows it.
function Aim.prepare(shot, duration: number)
	prepared = { shot = shot, from = { placeAngle = aim.placeAngle, aimAngle = aim.aimAngle }, t = 0, duration = duration }
end

-- ---- Drawing --------------------------------------------------------------------------------
local function ensureViz()
	if viz then
		return
	end
	viz = Instance.new("Folder")
	viz.Name = "AimView"
	viz.Parent = Workspace
	local function flat(color: Color3, transparency: number): Part
		local p = Instance.new("Part")
		p.Anchored = true
		p.CanCollide = false
		p.CanQuery = false
		p.CanTouch = false
		p.CastShadow = false
		p.Material = Enum.Material.Neon
		p.Color = color
		p.Transparency = transparency
		p.Size = Vector3.new(0.1, 0.06, 0.1)
		p.Parent = viz
		return p
	end
	lines = { flat(Color3.new(1, 1, 1), 0.1), flat(Color3.fromRGB(255, 220, 90), 0.15), flat(Color3.fromRGB(160, 210, 255), 0.3) }
	reticle = flat(Color3.new(1, 1, 1), 0.2)
	reticle.Shape = Enum.PartType.Cylinder
	chargeRing = flat(Color3.fromRGB(80, 230, 120), 1)
	chargeRing.Shape = Enum.PartType.Cylinder
end

local function clearViz()
	if viz then
		viz:Destroy()
		viz = nil
	end
	if ghost then
		ghost:Destroy()
		ghost = nil
	end
	lines = {}
	reticle, chargeRing = nil, nil
end

-- A flat line on the ground from (x, z) along `ang` for `len` web units.
local function setLine(p: Part, x: number, z: number, ang: number, len: number, width: number)
	if len <= 0.01 then
		p.Transparency = 1
		return
	end
	p.Transparency = 0.1
	local a = world(x, 0.012, z)
	local b = world(x + math.cos(ang) * len, 0.012, z + math.sin(ang) * len)
	p.Size = Vector3.new(width * S, 0.05, len * S)
	p.CFrame = CFrame.lookAt((a + b) / 2, b)
end

local function drawAim(showGuide: boolean)
	ensureViz()
	local s = Aim.state
	local ox, oz = originXZ()
	-- The taw, sitting on the line, before a first shot.
	if s.firstShot then
		if not ghost then
			local seat = s.seats[s.current]
			ghost = MarbleLook.make(MarbleLook.lookFor(seat and seat.marble), Config.SHOOTER_R)
			ghost.Anchored = true
			ghost.CanCollide = false
			ghost.CanQuery = false
			ghost.Parent = viz
		end
		ghost.CFrame = CFrame.new(world(ox, W.shooterRadius, oz))
	elseif ghost then
		ghost:Destroy()
		ghost = nil
	end

	-- The first marble the taw would meet along the aim.
	local dx, dz = math.cos(aim.aimAngle), math.sin(aim.aimAngle)
	local rr = W.targetRadius + W.shooterRadius
	local best, hx, hz = math.huge, nil, nil
	for _, t in ipairs(s.layout and s.layout.targets or {}) do
		local fx, fz = t.x - ox, t.z - oz
		local proj = fx * dx + fz * dz
		if proj > 0 then
			local perp2 = fx * fx + fz * fz - proj * proj
			if perp2 <= rr * rr then
				local d = proj - math.sqrt(rr * rr - perp2)
				if d < best then
					best, hx, hz = d, t.x, t.z
				end
			end
		end
	end
	local maxLen = if showGuide then Config.GUIDE[guideCap()] else 0
	local show = maxLen > 0
	local len1 = math.min(best, if hx then best else maxLen)
	setLine(lines[1], ox, oz, aim.aimAngle, if show then math.min(len1, maxLen) else 0, 0.035)
	local rt = reticle :: Part
	if hx and best <= maxLen and show then
		local gx, gz = ox + dx * best, oz + dz * best
		rt.Size = Vector3.new(0.04, rr * 2 * S, rr * 2 * S)
		rt.CFrame = CFrame.new(world(gx, 0.02, gz)) * CFrame.Angles(0, 0, math.pi / 2)
		-- Where the marble goes: from the ghost ball through its centre.
		local nAng = math.atan2(hz - gz, hx - gx)
		setLine(lines[2], hx, hz, nAng, math.min(1.6, maxLen * 0.4), 0.03)
		-- Where the taw glances off: the tangent.
		local nx, nz = math.cos(nAng), math.sin(nAng)
		local dot = dx * nx + dz * nz
		local tx, tz = dx - dot * nx, dz - dot * nz
		local tl = math.sqrt(tx * tx + tz * tz)
		setLine(lines[3], gx, gz, math.atan2(tz, tx), if tl > 0.05 then math.min(1.1, maxLen * 0.3) * tl else 0, 0.025)
	else
		lines[2].Transparency = 1
		lines[3].Transparency = 1
		local reach = if show then math.min(len1, maxLen) else FREE_RETICLE
		rt.Size = Vector3.new(0.04, 0.18 * S, 0.18 * S)
		rt.CFrame = CFrame.new(world(ox + dx * reach, 0.02, oz + dz * reach)) * CFrame.Angles(0, 0, math.pi / 2)
	end
	-- The charge ring round the taw: grows and reddens with power.
	local cr = chargeRing :: Part
	if aim.power > 0 then
		local d = (1 + aim.power * 0.9) * W.shooterRadius * 2.4 * S
		cr.Transparency = 1 - (0.35 + aim.power * 0.5)
		cr.Size = Vector3.new(0.03, d, d)
		cr.Color = Color3.fromHSV(0.33 - aim.power * 0.33, 0.9, 0.95)
		cr.CFrame = CFrame.new(world(ox, 0.01, oz)) * CFrame.Angles(0, 0, math.pi / 2)
	else
		cr.Transparency = 1
	end
end

-- ---- Camera -------------------------------------------------------------------------------
local function updateCamera()
	local s = Aim.state
	camera.CameraType = Enum.CameraType.Scriptable
	local want: CFrame
	if Aim.topView then
		want = CFrame.lookAt(s.origin + Vector3.new(0, 78 * zoom, 0.01), s.origin)
	elseif s.phase == "aim" and (myTurn() or prepared) then
		-- Behind the taw, looking along the aim.
		local ox, oz = originXZ()
		local o = world(ox, 0, oz)
		local dir = Vector3.new(math.cos(aim.aimAngle), 0, math.sin(aim.aimAngle))
		local dist = 26 * zoom
		local eye = o - dir * math.cos(pitch) * dist + Vector3.new(0, math.sin(pitch) * dist + 2, 0)
		want = CFrame.lookAt(eye, o + dir * 8)
	else
		-- Overview from your side of the ring.
		local a = Rules.seatAngle(Aim.mySeat or s.current, #s.seats)
		local back = Vector3.new(math.cos(a), 0, math.sin(a))
		want = CFrame.lookAt(s.origin + back * (Config.RING_R + 22) * zoom + Vector3.new(0, 36 * zoom, 0), s.origin - back * 4)
	end
	camera.CFrame = camera.CFrame:Lerp(want, 0.12)
end

local function update(dt: number)
	local s = Aim.state
	if not s then
		return
	end
	if s.phase ~= "over" then
		updateCamera()
	end

	-- A prepared shot (bot or other player): swing the aim to it, then charge.
	if prepared and s.phase == "aim" then
		local p = prepared
		p.t += dt * (if Aim.fast then 3 else 1)
		local k = math.min(1, p.t / p.duration)
		local e = if k < 0.7 then (function(x)
			return x < 0.5 and 2 * x * x or 1 - (-2 * x + 2) ^ 2 / 2
		end)(k / 0.7) else 1
		aim.placeAngle = lerpAngle(p.from.placeAngle, p.shot.placeAngle, e)
		aim.aimAngle = lerpAngle(p.from.aimAngle, p.shot.aimAngle, e)
		aim.power = if k > 0.7 then p.shot.power * ((k - 0.7) / 0.3) else 0
		aim.spin = p.shot.spin
		drawAim(false)
		if k >= 1 then
			prepared = nil
			aim.power = 0
		end
		return
	end

	if not myTurn() then
		if viz then
			clearViz()
		end
		return
	end
	-- Keyboard: aim, slide, tilt, charge.
	local fine = if keysDown[Enum.KeyCode.LeftShift] or keysDown[Enum.KeyCode.RightShift] then 0.15 else 1
	local rate = 0.9 * fine * dt
	if keysDown[Enum.KeyCode.Left] then
		Aim.rotateAim(-rate)
	end
	if keysDown[Enum.KeyCode.Right] then
		Aim.rotateAim(rate)
	end
	if keysDown[Enum.KeyCode.A] then
		Aim.setPlaceAngle(aim.placeAngle - rate * 0.6)
	end
	if keysDown[Enum.KeyCode.D] then
		Aim.setPlaceAngle(aim.placeAngle + rate * 0.6)
	end
	if keysDown[Enum.KeyCode.Up] then
		pitch = math.min(1.15, pitch + dt * 0.8)
	end
	if keysDown[Enum.KeyCode.Down] then
		pitch = math.max(0.3, pitch - dt * 0.8)
	end
	if charging then
		chargeT += dt
		local ph = (chargeT / 1.6) % 2
		Aim.setPower(if ph < 1 then ph else 2 - ph)
	end
	drawAim(true)
end

-- ---- Pointer and keys -----------------------------------------------------------------------
local mode = "none" -- aim | place | pinch
local pointers: { [any]: Vector2 } = {}
local pinchDist = 0

local function hitsShooter(screen: Vector2): boolean
	if not ghost then
		return false
	end
	local p, onScreen = camera:WorldToScreenPoint(ghost.Position)
	if not onScreen then
		return false
	end
	-- Generous: a fingertip on a small marble.
	return (Vector2.new(p.X, p.Y) - screen).Magnitude < 48
end

--- One frame (a test drives this directly).
Aim.step = function(dt: number)
	update(dt)
end
--- The guide's drawn lines (for tests): the aim line, the marble's way out, the taw's glance.
function Aim.guideParts(): { Part }
	return lines
end

function Aim.start()
	RunService.RenderStepped:Connect(update)
	UserInputService.InputBegan:Connect(Aim.input.began)
	UserInputService.InputChanged:Connect(Aim.input.changed)
	UserInputService.InputEnded:Connect(Aim.input.ended)
end

-- The input handlers (the web game's Controls). The engine's UserInputService events call them;
-- a test can call them with its own input events.
Aim.input = {}
function Aim.input.began(input, processed)
		if input.UserInputType == Enum.UserInputType.Keyboard and not processed then
			keysDown[input.KeyCode] = true
		end
		if not Aim.state or Aim.state.phase == "over" then
			return
		end
		if input.UserInputType == Enum.UserInputType.Keyboard then
			if processed then
				return
			end
			local k = input.KeyCode
			if k == Enum.KeyCode.Space then
				Aim.startCharge()
			elseif k == Enum.KeyCode.T then
				Aim.topView = not Aim.topView
			elseif k == Enum.KeyCode.F then
				Aim.toggleFast()
			elseif k == Enum.KeyCode.Escape then
				Aim.cancel()
			elseif k == Enum.KeyCode.Q and myTurn() then
				Aim.setSpin(math.floor((aim.spin - 0.25) * 4 + 0.5) / 4)
			elseif k == Enum.KeyCode.E and myTurn() then
				Aim.setSpin(math.floor((aim.spin + 0.25) * 4 + 0.5) / 4)
			end
			return
		end
		if processed then
			return
		end
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			local at = Vector2.new(input.Position.X, input.Position.Y)
			pointers[input] = at
			local n = 0
			for _ in pairs(pointers) do
				n += 1
			end
			if n == 2 then
				local a, b
				for _, v in pairs(pointers) do
					if a then
						b = v
					else
						a = v
					end
				end
				pinchDist = (a - b).Magnitude
				mode = "pinch"
			elseif canPlace() and hitsShooter(at) then
				mode = "place"
			else
				mode = "aim"
			end
		end
end
function Aim.input.changed(input)
		if input.UserInputType == Enum.UserInputType.MouseWheel then
			zoom = math.clamp(zoom * math.exp(-input.Position.Z * 0.12), 0.5, 2.2)
			return
		end
		local key = input
		if input.UserInputType == Enum.UserInputType.MouseMovement then
			-- The mouse's moves come as their own input; find the held button's entry.
			for k in pairs(pointers) do
				if k.UserInputType == Enum.UserInputType.MouseButton1 then
					key = k
				end
			end
		end
		local prev = pointers[key]
		if not prev then
			return
		end
		local now = Vector2.new(input.Position.X, input.Position.Y)
		local d = now - prev
		pointers[key] = now
		if not Aim.state then
			return
		end
		if mode == "pinch" then
			local a, b
			for _, v in pairs(pointers) do
				if a then
					b = v
				else
					a = v
				end
			end
			if a and b then
				local dist = (a - b).Magnitude
				if pinchDist > 0 and dist > 0 then
					zoom = math.clamp(zoom * pinchDist / dist, 0.5, 2.2)
				end
				pinchDist = dist
			end
		elseif mode == "place" then
			local x, z = groundPoint(now)
			if x then
				Aim.setPlaceAngle(math.atan2(z, x))
			end
		elseif mode == "aim" then
			local speed = d.Magnitude
			local fine = if speed < 2.5 then 0.22 elseif speed < 6 then 0.55 else 1
			local w = camera.ViewportSize.X
			-- A full-width drag is about 120 degrees of aim.
			Aim.rotateAim(d.X / math.max(1, w) * 2.1 * fine * Aim.sensitivity)
			pitch = math.clamp(pitch + d.Y * 0.0035, 0.3, 1.15)
		end
end
function Aim.input.ended(input)
		if input.UserInputType == Enum.UserInputType.Keyboard then
			keysDown[input.KeyCode] = nil
		end
		if input.KeyCode == Enum.KeyCode.Space then
			Aim.release()
			return
		end
		if input.UserInputType == Enum.UserInputType.MouseButton1 then
			for k in pairs(pointers) do
				if k.UserInputType == Enum.UserInputType.MouseButton1 then
					pointers[k] = nil
				end
			end
			local n = 0
			for _ in pairs(pointers) do
				n += 1
			end
			mode = if n == 0 then "none" else "aim"
		elseif pointers[input] then
			pointers[input] = nil
			local n = 0
			for _ in pairs(pointers) do
				n += 1
			end
			mode = if n == 0 then "none" else "aim"
		end
end

--- A new state from the server.
function Aim.set(state)
	local was = Aim.state
	Aim.state = state
	Aim.mySeat = nil
	local me = Players.LocalPlayer
	for i, seat in ipairs(state.seats) do
		if me and seat.userId == me.UserId then
			Aim.mySeat = i
		end
	end
	if not was or was.id ~= state.id then
		-- A new table: start the camera from above it.
		camera.CameraType = Enum.CameraType.Scriptable
		camera.CFrame = CFrame.lookAt(state.origin + Vector3.new(0, 90, 40), state.origin)
		clearViz()
	end
	if state.phase == "aim" then
		sent = false
		charging = false
		aim.power = 0
		-- Every turn and every shoot-again starts with a plain shot (the web game's).
		if not was or was.shots ~= state.shots or was.current ~= state.current then
			Aim.setSpin(0)
		end
		if state.firstShot then
			-- Knuckle down at your seat, aimed straight in.
			aim.placeAngle = Rules.seatAngle(state.current, #state.seats)
			aim.aimAngle = wrap(aim.placeAngle + math.pi)
			if ghost then
				ghost:Destroy()
				ghost = nil
			end
		end
	else
		prepared = nil
		clearViz()
	end
end

function Aim.stop()
	clearViz()
	prepared = nil
	Aim.state = nil
	Aim.mySeat = nil
	camera.CameraType = Enum.CameraType.Custom
	local me = Players.LocalPlayer
	local hum = me and me.Character and me.Character:FindFirstChildOfClass("Humanoid")
	if hum then
		camera.CameraSubject = hum
	end
end

--- The shot is in the air: hide the aim until the next turn.
function Aim.shotStarted()
	prepared = nil
	clearViz()
	if Aim.state then
		Aim.state.phase = "rolling"
	end
end

return Aim
