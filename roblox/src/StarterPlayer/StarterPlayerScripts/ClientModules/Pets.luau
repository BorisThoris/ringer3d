-- Every player's equipped marble floats beside them, bobbing and turning, wearing all its
-- effects (MarbleFX): the way players show off what they own. Drawn by each client for every
-- player from the server's "Marble" attribute; a new marble pops in with a little burst.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local MarbleLook = require(ReplicatedStorage.Ringer.MarbleLook)

local Pets = {}
Pets.RADIUS = 0.9
Pets.balls = {} :: { [Player]: BasePart }

local folder = Instance.new("Folder")
folder.Name = "Pets"
folder.Parent = Workspace

local shown: { [Player]: string } = {}

local function burst(at: Vector3, color: Color3)
	local p = Instance.new("Part")
	p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
	p.Transparency = 1
	p.Size = Vector3.one
	p.CFrame = CFrame.new(at)
	local e = Instance.new("ParticleEmitter")
	e.Texture = "rbxasset://textures/particles/sparkles_main.dds"
	e.Color = ColorSequence.new(color, Color3.new(1, 1, 1))
	e.Size = NumberSequence.new(0.4, 0)
	e.Lifetime = NumberRange.new(0.4, 0.7)
	e.Speed = NumberRange.new(6, 10)
	e.SpreadAngle = Vector2.new(180, 180)
	e.LightEmission = 1
	e.Rate = 0
	e.Parent = p
	p.Parent = folder
	e:Emit(30)
	task.delay(1, function()
		p:Destroy()
	end)
end

local function refresh(player: Player)
	local id = player:GetAttribute("Marble")
	if typeof(id) ~= "string" or shown[player] == id then
		return
	end
	shown[player] = id
	local old = Pets.balls[player]
	if old then
		old:Destroy()
	end
	local look = MarbleLook.lookFor(id)
	local ball = MarbleLook.make(look, Pets.RADIUS)
	ball.Name = player.Name .. "Marble"
	ball.Anchored = true
	ball.CanCollide, ball.CanQuery, ball.CanTouch = false, false, false
	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	ball.CFrame = if root then root.CFrame * CFrame.new(2.6, 1.2, 1.4) else CFrame.new(0, -500, 0)
	ball.Parent = folder
	Pets.balls[player] = ball
	if root then
		burst(ball.Position, MarbleLook.uiColor(look))
		local s = ball.Size
		ball.Size = s * 0.2
		TweenService:Create(ball, TweenInfo.new(0.4, Enum.EasingStyle.Back), { Size = s }):Play()
	end
end

local function watch(player: Player)
	refresh(player)
	player:GetAttributeChangedSignal("Marble"):Connect(function()
		refresh(player)
	end)
end

--- Start drawing every player's marble.
function Pets.start()
	for _, p in ipairs(Players:GetPlayers()) do
		watch(p)
	end
	Players.PlayerAdded:Connect(watch)
	Players.PlayerRemoving:Connect(function(p)
		if Pets.balls[p] then
			Pets.balls[p]:Destroy()
		end
		Pets.balls[p] = nil
		shown[p] = nil
	end)
	local spin = 0
	RunService.RenderStepped:Connect(function(dt)
		spin += dt
		for player, ball in pairs(Pets.balls) do
			local char = player.Character
			local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
			if not root or not ball.Parent then
				continue
			end
			-- Beside the shoulder, a little behind, bobbing; it lags the player a touch as it follows.
			local bob = math.sin(spin * 2.4 + #player.Name) * 0.35
			local target = (root.CFrame * CFrame.new(2.6, 1.2 + bob, 1.4)).Position
			local pos = ball.Position:Lerp(target, math.min(1, dt * 8))
			ball.CFrame = CFrame.new(pos) * CFrame.Angles(0.35, spin * 1.3, 0)
		end
	end)
end

return Pets
