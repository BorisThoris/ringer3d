-- Playing a table: the camera over your side of the ring, and the shot.
-- Shooting is a slingshot that works the same with a mouse or a finger: press anywhere, pull
-- back, let go. The marble flies the opposite way to your pull, harder the further you pull.
-- On a first shot your marble first follows your pointer around the ring line (knuckling down
-- anywhere on it); pressing fixes the spot.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage.Ringer.Config)
local Rules = require(ReplicatedStorage.Ringer.Rules)
local MarbleLook = require(ReplicatedStorage.Ringer.MarbleLook)

local Aim = {}
Aim.state = nil :: any
Aim.mySeat = nil :: number?
Aim.topView = false
Aim.onPower = function(_power: number?) end -- the HUD's power meter
Aim.onShot = function() end

local PULL_FULL = 16 -- studs of pull for full power

local camera = Workspace.CurrentCamera
local ghost: BasePart? = nil
local line: Part? = nil
local placeAngle = 0
local dragging = false
local dragFrom: Vector2? = nil
local sent = false

local function flat(state, v: Vector3): Vector2
	local d = v - state.origin
	return Vector2.new(d.X, d.Z)
end

-- Where the pointer meets the table's ground plane, ring-relative.
-- `gui`: the point is in GUI coordinates (input events), else viewport (the mouse location).
local function pointer(state, screen: Vector2, gui: boolean?): Vector2?
	local ray = gui and camera:ScreenPointToRay(screen.X, screen.Y) or camera:ViewportPointToRay(screen.X, screen.Y)
	if math.abs(ray.Direction.Y) < 1e-4 then
		return nil
	end
	local t = (state.origin.Y - ray.Origin.Y) / ray.Direction.Y
	if t < 0 then
		return nil
	end
	local hit = ray.Origin + ray.Direction * t
	return flat(state, hit)
end

local function myTurn(): boolean
	local s = Aim.state
	return s ~= nil and s.phase == "aim" and Aim.mySeat ~= nil and s.current == Aim.mySeat and not sent
end

local function clearAim()
	if ghost then
		ghost:Destroy()
		ghost = nil
	end
	if line then
		line:Destroy()
		line = nil
	end
	dragging = false
	dragFrom = nil
	Aim.onPower(nil)
end

-- Where the shot starts from: the knuckle-down spot, or where the shooter stopped.
local function anchor(): Vector2
	local s = Aim.state
	if s.firstShot or not s.shooter then
		return Rules.placement(placeAngle)
	end
	return flat(s, s.shooter)
end

local function world(p: Vector2, y: number): Vector3
	return Aim.state.origin + Vector3.new(p.X, y, p.Y)
end

local function drawLine(from: Vector2, dir: Vector2, power: number)
	if not line then
		line = Instance.new("Part")
		line.Anchored = true
		line.CanCollide = false
		line.CanQuery = false
		line.CanTouch = false
		line.Material = Enum.Material.Neon
		line.CastShadow = false
		line.Parent = Workspace
	end
	local len = 3 + power * 26
	local a = world(from, 0.25)
	local b = world(from + dir * len, 0.25)
	line.Size = Vector3.new(0.35, 0.12, len)
	line.CFrame = CFrame.lookAt((a + b) / 2, b)
	line.Color = Color3.fromRGB(80, 230, 120):Lerp(Color3.fromRGB(255, 70, 60), power)
end

local function update()
	local s = Aim.state
	if not s then
		return
	end
	-- Camera: behind your seat, high enough to see the whole ring; or straight down.
	if s.phase ~= "over" then
		camera.CameraType = Enum.CameraType.Scriptable
		local a = Rules.seatAngle(Aim.mySeat or s.current, #s.seats)
		local want
		if Aim.topView then
			want = CFrame.lookAt(s.origin + Vector3.new(0, 78, 0.01), s.origin)
		else
			local back = Vector3.new(math.cos(a), 0, math.sin(a))
			want = CFrame.lookAt(s.origin + back * (Config.RING_R + 22) + Vector3.new(0, 36, 0), s.origin - back * 4)
		end
		camera.CFrame = camera.CFrame:Lerp(want, 0.12)
	end

	if not myTurn() then
		if ghost or line then
			clearAim()
		end
		return
	end
	local mouse = UserInputService:GetMouseLocation()
	local here = pointer(s, mouse)
	-- Before pressing on a first shot, the marble rides the ring line under the pointer.
	if s.firstShot and not dragging and here and here.Magnitude > 1 then
		placeAngle = math.atan2(here.Y, here.X)
	end
	if s.firstShot then
		if not ghost then
			local seat = s.seats[Aim.mySeat]
			ghost = MarbleLook.make(MarbleLook.lookFor(seat.marble), Config.SHOOTER_R)
			ghost.Anchored = true
			ghost.CanCollide = false
			ghost.CanQuery = false
			ghost.Parent = Workspace
		end
		ghost.CFrame = CFrame.new(world(Rules.placement(placeAngle), Config.SHOOTER_R))
	end
	if dragging and dragFrom and here then
		local pull = dragFrom - here
		local power = math.clamp(pull.Magnitude / PULL_FULL, 0, 1)
		if pull.Magnitude > 0.2 then
			drawLine(anchor(), pull.Unit, power)
		end
		Aim.onPower(power)
	end
end

local function release(screen: Vector2)
	local s = Aim.state
	if not (dragging and dragFrom and s) then
		return
	end
	local here = pointer(s, screen, true)
	local pull = here and (dragFrom - here) or Vector2.zero
	local power = math.clamp(pull.Magnitude / PULL_FULL, 0, 1)
	dragging = false
	dragFrom = nil
	if power < 0.04 then
		-- Too small to be a shot: let them try again.
		if line then
			line:Destroy()
			line = nil
		end
		Aim.onPower(nil)
		return
	end
	sent = true
	local dir = pull.Unit
	ReplicatedStorage.Ringer.Remotes.Shoot:FireServer(s.id, placeAngle, math.atan2(dir.Y, dir.X), power)
	clearAim()
	Aim.onShot()
end

function Aim.start()
	RunService.RenderStepped:Connect(update)
	UserInputService.InputBegan:Connect(function(input, processed)
		if processed or not myTurn() then
			return
		end
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			local s = Aim.state
			local here = pointer(s, Vector2.new(input.Position.X, input.Position.Y), true)
			if here then
				dragging = true
				dragFrom = here
			end
		end
	end)
	UserInputService.InputEnded:Connect(function(input)
		if input.UserInputType == Enum.UserInputType.MouseButton1 or input.UserInputType == Enum.UserInputType.Touch then
			release(Vector2.new(input.Position.X, input.Position.Y))
		end
	end)
	UserInputService.InputChanged:Connect(function(input)
		-- Touch: the pointer is the finger, not the mouse.
		if dragging and input.UserInputType == Enum.UserInputType.Touch then
			local s = Aim.state
			local here = s and pointer(s, Vector2.new(input.Position.X, input.Position.Y), true)
			if here and dragFrom then
				local pull = dragFrom - here
				local power = math.clamp(pull.Magnitude / PULL_FULL, 0, 1)
				if pull.Magnitude > 0.2 then
					drawLine(anchor(), pull.Unit, power)
				end
				Aim.onPower(power)
			end
		end
	end)
end

--- A new state from the server.
function Aim.set(state)
	local was = Aim.state
	Aim.state = state
	Aim.mySeat = nil
	for i, seat in ipairs(state.seats) do
		if seat.userId == Players.LocalPlayer.UserId then
			Aim.mySeat = i
		end
	end
	if not was or was.id ~= state.id then
		-- A new table: start the camera from above it.
		camera.CameraType = Enum.CameraType.Scriptable
		camera.CFrame = CFrame.lookAt(state.origin + Vector3.new(0, 90, 40), state.origin)
		placeAngle = Rules.seatAngle(Aim.mySeat or 1, #state.seats)
	end
	if state.phase == "aim" then
		sent = false
		if state.firstShot then
			placeAngle = Rules.seatAngle(Aim.mySeat or 1, #state.seats)
		end
	end
	if state.phase ~= "aim" then
		clearAim()
	end
end

function Aim.stop()
	clearAim()
	Aim.state = nil
	Aim.mySeat = nil
	camera.CameraType = Enum.CameraType.Custom
	local hum = Players.LocalPlayer.Character and Players.LocalPlayer.Character:FindFirstChildOfClass("Humanoid")
	if hum then
		camera.CameraSubject = hum
	end
end

return Aim
