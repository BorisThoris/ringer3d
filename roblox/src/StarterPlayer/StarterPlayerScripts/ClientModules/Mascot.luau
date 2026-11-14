-- The lobby's giant marble with a face, alive on this client: it turns to watch you (its pupils
-- follow you faster than its body), blinks, bobs and hops, sparkles, and talks in a speech bubble:
-- hello when you come near, a cheer when you bounce off a mushroom or grab a run of coins, and
-- tips now and then. Drawn locally, so every player gets its full attention.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Mascot = {}
Mascot.said = {} :: { string } -- what it has said (tests read this)

local TIPS = {
	"Wanna duel? Hit PLAY! 🎯",
	"Bounce on the mushrooms! 🍄",
	"Grab the gold coins on the lawn! 🪙",
	"Marble Bags hold one-of-a-kind marbles ✨",
	"Knock them out of the ring! 💥",
	"Come back tomorrow for your Daily gift 🎁",
	"Have you seen the Black Hole marble? 🌌",
}

local model: Model? = nil
local body: BasePart? = nil
local home = Vector3.new(0, 17, 0)
local parts: { { part: BasePart, off: CFrame, name: string } } = {}
local bubble: TextLabel? = nil
local hopUntil, hopStart = 0, 0
local lastSay = 0

local function say(text: string)
	table.insert(Mascot.said, text)
	lastSay = os.clock()
	if not bubble then
		return
	end
	local label = bubble :: TextLabel
	local gui = label.Parent :: BillboardGui
	gui.Enabled = true
	label.Text = ""
	local scale = label:FindFirstChildOfClass("UIScale")
	if scale then
		scale.Scale = 0.4
		TweenService:Create(scale, TweenInfo.new(0.35, Enum.EasingStyle.Back), { Scale = 1 }):Play()
	end
	local mine = lastSay
	task.spawn(function()
		-- Typed out a letter at a time, like it's talking (stops if it starts saying something else).
		local shown = {}
		for _, code in utf8.codes(text) do
			if lastSay ~= mine then
				return
			end
			table.insert(shown, utf8.char(code))
			label.Text = table.concat(shown)
			task.wait(0.025)
		end
	end)
	task.delay(4, function()
		if lastSay == mine then
			gui.Enabled = false
		end
	end)
end
Mascot.say = say

--- A happy hop, and maybe something to say.
function Mascot.cheer(text: string?)
	hopStart = os.clock()
	hopUntil = hopStart + 0.6
	if text then
		say(text)
	end
end

local function makeBubble(at: BasePart)
	local gui = Instance.new("BillboardGui")
	gui.Name = "Speech"
	gui.Size = UDim2.fromOffset(300, 70)
	gui.StudsOffsetWorldSpace = Vector3.new(0, 11, 0)
	gui.MaxDistance = 140
	gui.LightInfluence = 0
	gui.AlwaysOnTop = true
	gui.Enabled = false
	gui.Parent = at
	local frame = Instance.new("Frame")
	frame.Size = UDim2.fromScale(1, 1)
	frame.BackgroundColor3 = Color3.new(1, 1, 1)
	frame.Parent = gui
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 22)
	corner.Parent = frame
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 3
	stroke.Color = Color3.fromRGB(30, 22, 40)
	stroke.Parent = frame
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.new(1, -20, 1, -10)
	label.Position = UDim2.fromOffset(10, 5)
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.TextColor3 = Color3.fromRGB(30, 22, 40)
	label.Text = ""
	label.Parent = frame
	local scale = Instance.new("UIScale")
	scale.Parent = label
	return label
end

local function sparkles(at: BasePart)
	local e = Instance.new("ParticleEmitter")
	e.Name = "Glitter"
	e.Texture = "rbxasset://textures/particles/sparkles_main.dds"
	e.Color = ColorSequence.new({ ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 140, 220)), ColorSequenceKeypoint.new(0.5, Color3.fromRGB(255, 240, 140)), ColorSequenceKeypoint.new(1, Color3.fromRGB(140, 220, 255)) })
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(0.3, 0.7), NumberSequenceKeypoint.new(1, 0) })
	e.Lifetime = NumberRange.new(1.2, 2)
	e.Rate = 10
	e.Speed = NumberRange.new(1, 3)
	e.SpreadAngle = Vector2.new(180, 180)
	e.Shape = Enum.ParticleEmitterShape.Sphere
	e.LightEmission = 1
	e.Parent = at
	local light = Instance.new("PointLight")
	light.Color = Color3.fromRGB(255, 190, 240)
	light.Range = 22
	light.Brightness = 0.8
	light.Parent = at
end

--- Find the mascot and start it watching `player`.
function Mascot.start(player: Player)
	local lobby = Workspace:WaitForChild("Lobby", 30)
	model = lobby and lobby:WaitForChild("Mascot", 30) :: Model?
	if not model then
		return
	end
	body = model:WaitForChild("Body", 10) :: BasePart?
	if not body then
		return
	end
	local h = model:GetAttribute("Home")
	if typeof(h) == "Vector3" then
		home = h
	end
	local base = CFrame.new(home)
	for _, p in ipairs(model:GetDescendants()) do
		if p:IsA("BasePart") then
			table.insert(parts, { part = p, off = base:ToObjectSpace(p.CFrame), name = p.Name })
		end
	end
	-- Eyelids for blinking: a flat lid in the body's colour over each eye, hidden until it blinks.
	local lids = {}
	for _, s in ipairs({ -1, 1 }) do
		local lid = Instance.new("Part")
		lid.Name = "Lid"
		lid.Anchored, lid.CanCollide, lid.CanQuery, lid.CanTouch = true, false, false, false
		lid.Shape = Enum.PartType.Ball
		lid.Size = Vector3.new(3.9, 3.9, 3.9)
		lid.Color = Color3.fromRGB(255, 150, 200)
		lid.Transparency = 1
		lid.Parent = model
		table.insert(lids, { part = lid, side = s })
	end
	bubble = makeBubble(body :: BasePart)
	sparkles(body :: BasePart)

	local yaw = 0
	local nextBlink = os.clock() + 2
	local blinkUntil = 0
	local greeted = false
	local wasNear = false
	local t = 0
	RunService.RenderStepped:Connect(function(dt)
		t += dt
		local char = player.Character
		local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
		local now = os.clock()
		-- Who to look at: you, if you're in the lobby; otherwise it gazes about.
		local target = home + Vector3.new(math.sin(t * 0.4) * 40, -8, 40)
		local near = false
		if root and (root.Position - home).Magnitude < 160 then
			target = root.Position + Vector3.new(0, 2, 0)
			near = (root.Position - home).Magnitude < 34
			if not greeted then
				greeted = true
				Mascot.cheer("Hi " .. player.DisplayName .. "! 👋")
			end
			if near and not wasNear and now - lastSay > 6 then
				Mascot.cheer(({ "Ooh, hello up close! 😄", "Ready for a duel? 🎯", "Nice to see you! ✨" })[math.random(1, 3)])
			end
			-- Bouncing off a mushroom, high in the air.
			if root.Position.Y > home.Y + 8 and now - lastSay > 5 then
				Mascot.cheer(({ "Wheee! 🎉", "So high!! 🚀", "Do it again! 🍄" })[math.random(1, 3)])
			end
		end
		wasNear = near
		if now - lastSay > 14 then
			say(TIPS[math.random(1, #TIPS)])
		end
		-- The body turns toward the target, unhurried.
		local d = target - home
		local want = math.atan2(d.X, d.Z)
		local diff = math.atan2(math.sin(want - yaw), math.cos(want - yaw))
		yaw += diff * math.min(1, dt * 2.2)
		-- Bob, sway, and a hop when it cheers.
		local hop = 0
		if now < hopUntil then
			local k = (now - hopStart) / (hopUntil - hopStart)
			hop = math.sin(k * math.pi) * 4
		end
		local cf = CFrame.new(home + Vector3.new(0, math.sin(t * 1.6) * 1.1 + hop, 0)) * CFrame.Angles(0, yaw, math.sin(t * 1.1) * 0.06)
		-- Where the target is in the body's own space: the pupils roll that way.
		local look = cf:PointToObjectSpace(target)
		local dir = if look.Magnitude > 0.01 then look.Unit else Vector3.new(0, 0, 1)
		if now > nextBlink then
			blinkUntil = now + 0.13
			nextBlink = now + (if math.random() < 0.2 then 0.3 else math.random(25, 50) / 10)
		end
		local blinking = now < blinkUntil
		for _, p in ipairs(parts) do
			local off = p.off
			if p.name == "Pupil" or p.name == "Shine" then
				-- Rest on the eye's front, pushed toward the target.
				local side = if off.Position.X < 0 then -1 else 1
				local eye = Vector3.new(side * 2.4, 1.6, 6.1)
				local push = Vector3.new(dir.X, dir.Y, math.max(dir.Z, 0.35)).Unit
				local at = eye + push * (if p.name == "Pupil" then 1.25 else 1.95) + (if p.name == "Shine" then Vector3.new(0.45, 0.45, 0) else Vector3.zero)
				p.part.CFrame = cf * CFrame.new(at)
				p.part.LocalTransparencyModifier = if blinking then 1 else 0
			else
				p.part.CFrame = cf * off
			end
		end
		for _, l in ipairs(lids) do
			l.part.CFrame = cf * CFrame.new(l.side * 2.4, 1.6, 6.3)
			l.part.Transparency = if blinking then 0 else 1
		end
		if body then
			local b = body :: BasePart
			for _, l in ipairs(lids) do
				l.part.Color = b.Color:Lerp(Color3.new(1, 1, 1), 0.2)
			end
		end
	end)
end

return Mascot
