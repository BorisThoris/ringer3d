-- The lobby's toys, on this client: spinning gold coins on the lawn to run through (the server
-- checks and pays each one; Config.LOBBY_COIN), the giant mushrooms that bounce you sky-high,
-- the clouds drifting round, and the balloons by the spawn bobbing on their strings.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage.Ringer.Config)

local LobbyFun = {}
LobbyFun.coins = {} :: { { part: BasePart, spot: Vector3, readyAt: number } }
LobbyFun.collected = 0

local GOLD = Color3.fromRGB(255, 200, 40)

local function popText(at: Vector3, text: string, color: Color3)
	local a = Instance.new("Part")
	a.Anchored, a.CanCollide, a.CanQuery, a.CanTouch = true, false, false, false
	a.Transparency = 1
	a.Size = Vector3.one * 0.2
	a.CFrame = CFrame.new(at)
	a.Parent = Workspace
	local bb = Instance.new("BillboardGui")
	bb.Size = UDim2.fromOffset(140, 56)
	bb.AlwaysOnTop = true
	bb.LightInfluence = 0
	bb.StudsOffsetWorldSpace = Vector3.new(0, 1, 0)
	bb.Parent = a
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Size = UDim2.fromScale(1, 1)
	l.Font = Enum.Font.FredokaOne
	l.TextScaled = true
	l.Text = text
	l.TextColor3 = color
	l.TextStrokeTransparency = 0
	l.TextStrokeColor3 = Color3.fromRGB(30, 22, 40)
	l.Parent = bb
	local s = Instance.new("UIScale")
	s.Scale = 0.3
	s.Parent = l
	TweenService:Create(s, TweenInfo.new(0.3, Enum.EasingStyle.Back), { Scale = 1 }):Play()
	TweenService:Create(bb, TweenInfo.new(1, Enum.EasingStyle.Quad), { StudsOffsetWorldSpace = Vector3.new(0, 5, 0) }):Play()
	task.delay(0.6, function()
		TweenService:Create(l, TweenInfo.new(0.4), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
	end)
	task.delay(1.1, function()
		a:Destroy()
	end)
end

local function sparkle(at: Vector3, color: Color3, n: number)
	local a = Instance.new("Part")
	a.Anchored, a.CanCollide, a.CanQuery, a.CanTouch = true, false, false, false
	a.Transparency = 1
	a.Size = Vector3.one * 0.2
	a.CFrame = CFrame.new(at)
	a.Parent = Workspace
	local e = Instance.new("ParticleEmitter")
	e.Texture = "rbxasset://textures/particles/sparkles_main.dds"
	e.Color = ColorSequence.new(color, Color3.new(1, 1, 1))
	e.Size = NumberSequence.new(0.7, 0)
	e.Lifetime = NumberRange.new(0.5, 0.8)
	e.Speed = NumberRange.new(8, 14)
	e.SpreadAngle = Vector2.new(180, 180)
	e.Acceleration = Vector3.new(0, -14, 0)
	e.LightEmission = 1
	e.Rate = 0
	e.Parent = a
	e:Emit(n)
	task.delay(1, function()
		a:Destroy()
	end)
end

local function makeCoin(folder: Instance, spot: Vector3): BasePart
	local c = Instance.new("Part")
	c.Name = "Coin"
	c.Shape = Enum.PartType.Cylinder
	c.Size = Vector3.new(0.45, 2.6, 2.6)
	c.Anchored, c.CanCollide, c.CanQuery, c.CanTouch = true, false, false, false
	c.Material = Enum.Material.Metal
	c.Color = GOLD
	c.Reflectance = 0.25
	c.CFrame = CFrame.new(spot)
	local face = Instance.new("Part")
	face.Name = "Face"
	face.Shape = Enum.PartType.Cylinder
	face.Size = Vector3.new(0.5, 1.7, 1.7)
	face.Anchored, face.CanCollide, face.CanQuery, face.CanTouch = true, false, false, false
	face.Material = Enum.Material.Neon
	face.Color = Color3.fromRGB(255, 235, 120)
	face.CFrame = c.CFrame
	face.Parent = c
	local glow = Instance.new("PointLight")
	glow.Color = GOLD
	glow.Range = 6
	glow.Brightness = 0.8
	glow.Parent = c
	c.Parent = folder
	return c
end

--- `ask(action, args)` calls the server; `sfx` is the Sfx module.
function LobbyFun.start(ask: (string, any) -> (boolean, any), sfx: any, character: () -> Model?)
	local folder = Instance.new("Folder")
	folder.Name = "LobbyCoins"
	folder.Parent = Workspace
	for i, spot in ipairs(Config.LOBBY_COIN_SPOTS) do
		LobbyFun.coins[i] = { part = makeCoin(folder, spot), spot = spot, readyAt = 0 }
	end
	local chain, lastPick = 0, 0

	local function collect(i: number)
		local c = LobbyFun.coins[i]
		c.readyAt = os.clock() + Config.LOBBY_COIN.respawn
		c.part.Parent = nil
		-- Coins in quick succession climb in pitch: a run of them sings.
		chain = if os.clock() - lastPick < 1.6 then chain + 1 else 0
		lastPick = os.clock()
		sfx.play("coin", 0.7, 1 + math.min(chain, 8) * 0.07)
		sparkle(c.spot, GOLD, 18)
		task.spawn(function()
			local ok, got = ask("pickup", i)
			if ok then
				LobbyFun.collected += 1
				popText(c.spot, "+" .. tostring(got) .. " 🪙", Color3.fromRGB(255, 225, 90))
			end
		end)
	end

	-- Mushrooms: land on a cap and it throws you up, squashing like jelly.
	local lobby = Workspace:WaitForChild("Lobby", 30)
	local world = lobby and lobby:WaitForChild("World", 30)
	local lastBounce = 0
	if world then
		for _, cap in ipairs(world:GetDescendants()) do
			if cap:IsA("BasePart") and cap:GetAttribute("Bounce") then
				local mesh = cap:FindFirstChildOfClass("SpecialMesh")
				cap.Touched:Connect(function(hit)
					local char = character()
					if not char or not hit:IsDescendantOf(char) or os.clock() - lastBounce < 0.4 then
						return
					end
					local root = char:FindFirstChild("HumanoidRootPart") :: BasePart?
					local hum = char:FindFirstChildOfClass("Humanoid")
					if not root or not hum or root.Position.Y < cap.Position.Y then
						return
					end
					lastBounce = os.clock()
					hum:ChangeState(Enum.HumanoidStateType.Jumping)
					local v = root.AssemblyLinearVelocity
					root.AssemblyLinearVelocity = Vector3.new(v.X, cap:GetAttribute("Bounce") :: number, v.Z)
					sfx.play("boing", 0.9, 0.9 + math.random() * 0.25)
					sparkle(root.Position - Vector3.new(0, 2.5, 0), cap.Color, 12)
					if mesh then
						mesh.Scale = Vector3.new(1.18, 0.65, 1.18)
						TweenService:Create(mesh, TweenInfo.new(0.6, Enum.EasingStyle.Elastic), { Scale = Vector3.one }):Play()
					end
				end)
			end
		end
	end

	local clouds = world and world:FindFirstChild("Clouds") :: Model?
	local cloudBase = clouds and clouds:GetPivot()
	local balloons = {}
	if world then
		for _, m in ipairs(world:GetChildren()) do
			if m:IsA("Model") and m:GetAttribute("Bob") then
				table.insert(balloons, { model = m, base = m:GetPivot(), k = m:GetAttribute("Bob") :: number })
			end
		end
	end

	local t = 0
	RunService.RenderStepped:Connect(function(dt)
		t += dt
		local char = character()
		local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
		local now = os.clock()
		for i, c in ipairs(LobbyFun.coins) do
			if now < c.readyAt then
				continue
			end
			if not c.part.Parent then
				c.part.Parent = folder
				sparkle(c.spot, GOLD, 8)
			end
			local cf = CFrame.new(c.spot + Vector3.new(0, math.sin(t * 2.2 + i) * 0.4, 0)) * CFrame.Angles(0, t * 2.5 + i, 0) * CFrame.Angles(0, math.pi / 2, 0)
			c.part.CFrame = cf
			local face = c.part:FindFirstChild("Face") :: BasePart?
			if face then
				face.CFrame = cf
			end
			if root and (root.Position - c.spot).Magnitude < 4.5 then
				collect(i)
			end
		end
		if clouds and cloudBase then
			clouds:PivotTo(cloudBase * CFrame.Angles(0, t * 0.012, 0))
		end
		for _, b in ipairs(balloons) do
			local s = t * 1.3 + b.k * 1.7
			b.model:PivotTo(b.base * CFrame.Angles(math.sin(s) * 0.06, 0, math.cos(s * 0.8) * 0.06) * CFrame.new(0, math.sin(s * 1.6) * 0.3, 0))
		end
	end)
end

return LobbyFun
