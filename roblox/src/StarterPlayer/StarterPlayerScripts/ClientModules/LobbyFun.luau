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
LobbyFun.onChain = function(_n: number) end -- a run of coins picked up quickly
LobbyFun.runPos = function(_u: number): Vector3
	return Vector3.zero
end

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
		LobbyFun.onChain(chain + 1)
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

	-- The rainbow: a shimmer of light running along its bands, and twinkles over it.
	local bands = {}
	local rainbow = world and world:FindFirstChild("Rainbow")
	if rainbow then
		for _, b in ipairs(rainbow:GetChildren()) do
			if b:IsA("BasePart") then
				-- Its place along the arc, 0..1, from its angle about the arc's centre.
				local p = b.Position
				local a = math.atan2(p.Y + 12, p.X)
				table.insert(bands, { part = b, color = b.Color, k = 1 - a / math.pi })
			end
		end
		for i = 1, 7 do
			local a = i / 8 * math.pi
			local tw = Instance.new("Part")
			tw.Anchored, tw.CanCollide, tw.CanQuery, tw.CanTouch = true, false, false, false
			tw.Transparency = 1
			tw.Size = Vector3.new(30, 30, 4)
			tw.CFrame = CFrame.new(Vector3.new(math.cos(a) * 102, -12 + math.sin(a) * 102, -235))
			tw.Parent = rainbow
			local e = Instance.new("ParticleEmitter")
			e.Shape = Enum.ParticleEmitterShape.Box
			e.Texture = "rbxasset://textures/particles/sparkles_main.dds"
			e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(0.5, 4), NumberSequenceKeypoint.new(1, 0) })
			e.Lifetime = NumberRange.new(0.8, 1.4)
			e.Rate = 3
			e.Speed = NumberRange.new(0)
			e.LightEmission = 1
			e.Parent = tw
		end
	end
	-- Swaying tree crowns and nodding flowers round the lawn.
	local sway = {}
	if lobby then
		for _, p in ipairs(lobby:GetDescendants()) do
			if p:IsA("BasePart") and (p.Name == "Crown" or p.Name == "Petals" or p.Name == "Middle") then
				table.insert(sway, { part = p, base = p.CFrame, k = p.Position.X * 0.05 + p.Position.Z * 0.07, amp = if p.Name == "Crown" then 0.5 else 0.15 })
			end
		end
	end
	-- The mushrooms breathe; the fountain marbles turn.
	local breathe = {}
	local spinners = {}
	if world then
		for _, p in ipairs(world:GetDescendants()) do
			if p:IsA("BasePart") and p:GetAttribute("Bounce") then
				table.insert(breathe, { mesh = p:FindFirstChildOfClass("SpecialMesh"), k = p.Position.X })
			elseif p:IsA("BasePart") and p.Name == "Marble" and p.Parent and p.Parent.Name == "Fountain" then
				table.insert(spinners, { part = p, base = p.CFrame })
			end
		end
	end
	-- A little flock of birds circling high over the park, flapping.
	local birds = {}
	local flock = Instance.new("Folder")
	flock.Name = "Birds"
	flock.Parent = Workspace
	for i = 1, 6 do
		local function piece(size: Vector3, color: Color3)
			local p = Instance.new("Part")
			p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
			p.Size = size
			p.Color = color
			p.Material = Enum.Material.SmoothPlastic
			p.Parent = flock
			return p
		end
		local tone = ({ Color3.fromRGB(255, 255, 255), Color3.fromRGB(255, 210, 120), Color3.fromRGB(150, 210, 255) })[i % 3 + 1]
		table.insert(birds, {
			body = piece(Vector3.new(0.9, 0.9, 2), tone),
			left = piece(Vector3.new(2.6, 0.15, 1.2), tone),
			right = piece(Vector3.new(2.6, 0.15, 1.2), tone),
			r = 70 + i * 9, y = 48 + (i % 3) * 7, speed = 0.12 + (i % 2) * 0.03, phase = i * 1.1,
		})
	end

	-- The marble run: marbles roll down the spiral, drop into the tube, ride up it and set off again.
	local runner = {}
	local run = world and world:FindFirstChild("MarbleRun")
	if run then
		local c = run:GetAttribute("centre") :: Vector3
		local R, top, bottom, turns = run:GetAttribute("radius") :: number, run:GetAttribute("top") :: number, run:GetAttribute("bottom") :: number, run:GetAttribute("turns") :: number
		local colors = { Color3.fromRGB(255, 80, 120), Color3.fromRGB(255, 200, 40), Color3.fromRGB(80, 200, 255), Color3.fromRGB(120, 230, 110), Color3.fromRGB(190, 110, 255), Color3.fromRGB(255, 140, 60), Color3.fromRGB(255, 255, 255), Color3.fromRGB(60, 220, 200) }
		local helix = function(s: number): Vector3
			local a = s * turns * math.pi * 2
			return c + Vector3.new(math.cos(a) * R, top - s * (top - bottom) + 1.05, math.sin(a) * R)
		end
		for i, col in ipairs(colors) do
			local b = Instance.new("Part")
			b.Name = "RunMarble"
			b.Shape = Enum.PartType.Ball
			b.Size = Vector3.new(1.7, 1.7, 1.7)
			b.Anchored, b.CanCollide, b.CanQuery, b.CanTouch = true, false, false, false
			b.Material = Enum.Material.SmoothPlastic
			b.Reflectance = 0.15
			b.Color = col
			b.Parent = run
			table.insert(runner, { part = b, phase = (i - 1) / #colors })
		end
		LobbyFun.runPos = function(u: number): Vector3
			-- 0..0.72 down the spiral, ..0.78 across into the tube, ..0.96 up the tube, ..1 out to the top.
			if u < 0.72 then
				return helix(u / 0.72)
			elseif u < 0.78 then
				local k = (u - 0.72) / 0.06
				return helix(1):Lerp(c + Vector3.new(0, bottom + 1.2, 0), k)
			elseif u < 0.96 then
				local k = (u - 0.78) / 0.18
				return c + Vector3.new(0, bottom + 1.2 + k * (top + 1 - bottom), 0)
			else
				local k = (u - 0.96) / 0.04
				return (c + Vector3.new(0, top + 2.2, 0)):Lerp(helix(0), k) + Vector3.new(0, math.sin(k * math.pi) * 1.2, 0)
			end
		end
	end

	local t = 0
	local frame = 0
	RunService.RenderStepped:Connect(function(dt)
		t += dt
		frame += 1
		-- Scenery at half rate: it's slow motion anyway, and it's a lot of parts.
		if frame % 2 == 0 then
			local wave = (t * 0.25) % 1.4 - 0.2
			for _, b in ipairs(bands) do
				local glow = math.max(0, 1 - math.abs(b.k - wave) * 7)
				b.part.Color = b.color:Lerp(Color3.new(1, 1, 1), glow * 0.55)
				b.part.Transparency = 0.18 - glow * 0.15
			end
			for _, s in ipairs(sway) do
				local a = t * 1.3 + s.k
				s.part.CFrame = s.base * CFrame.new(math.sin(a) * s.amp, math.abs(math.sin(a * 0.5)) * s.amp * 0.3, math.cos(a * 0.8) * s.amp * 0.6)
			end
		end
		for _, b in ipairs(breathe) do
			if b.mesh then
				local s = math.sin(t * 2 + b.k)
				-- Leave a bounce's squash alone until it has settled.
				if math.abs(b.mesh.Scale.Y - 1) < 0.08 then
					b.mesh.Scale = Vector3.new(1 + s * 0.025, 1 - s * 0.035, 1 + s * 0.025)
				end
			end
		end
		for _, m in ipairs(runner) do
			local u = (t / 14 + m.phase) % 1
			local p = LobbyFun.runPos(u)
			-- Rolling: turn about the direction it's going.
			local ahead = LobbyFun.runPos((u + 0.002) % 1) - p
			local axis = if ahead.Magnitude > 0.001 then ahead.Unit:Cross(Vector3.new(0, 1, 0)) else Vector3.new(1, 0, 0)
			m.part.CFrame = CFrame.new(p) * CFrame.fromAxisAngle(if axis.Magnitude > 0.01 then axis.Unit else Vector3.new(1, 0, 0), -t * 6)
		end
		for _, s in ipairs(spinners) do
			s.part.CFrame = s.base * CFrame.new(0, math.sin(t * 2) * 0.3, 0) * CFrame.Angles(0, t * 1.5, 0)
		end
		for _, b in ipairs(birds) do
			local a = t * b.speed + b.phase
			local pos = Vector3.new(math.cos(a) * b.r, b.y + math.sin(t * 0.7 + b.phase) * 3, math.sin(a) * b.r)
			local ahead = Vector3.new(-math.sin(a), 0, math.cos(a))
			local cf = CFrame.lookAt(pos, pos + ahead) * CFrame.Angles(0, 0, -0.25)
			local flap = math.sin(t * 9 + b.phase) * 0.6
			b.body.CFrame = cf
			b.left.CFrame = cf * CFrame.new(-0.4, 0, 0) * CFrame.Angles(0, 0, flap) * CFrame.new(-1.3, 0, 0)
			b.right.CFrame = cf * CFrame.new(0.4, 0, 0) * CFrame.Angles(0, 0, -flap) * CFrame.new(1.3, 0, 0)
		end
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
