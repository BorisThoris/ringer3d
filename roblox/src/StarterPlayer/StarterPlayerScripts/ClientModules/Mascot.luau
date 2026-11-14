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
Mascot.expression = "happy"
Mascot.express = function(_name: string, _secs: number?) end -- set once it has started
Mascot.step = function(_dt: number) end

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
	-- The label sits in the bubble frame, inside the BillboardGui.
	local gui = (label.Parent :: Frame).Parent :: BillboardGui
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
	-- The face this client draws: a mouth that smiles, grins, gasps and yawns, brows that lift
	-- and tilt, eyelids, and closed-eye arcs for laughing, winking and dozing.
	local R = 7
	local INK = Color3.fromRGB(60, 20, 30)
	local function piece(name: string, size: Vector3, color: Color3, shape: Enum.PartType?): BasePart
		local p = Instance.new("Part")
		p.Name = name
		p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
		p.Size = size
		p.Color = color
		p.Material = Enum.Material.SmoothPlastic
		if shape then
			p.Shape = shape
		end
		p.Parent = model
		return p
	end
	local mouth = {}
	for i = 1, 11 do
		mouth[i] = piece("Lip", Vector3.new(0.55, 0.3, 0.7), INK)
	end
	local holes = {}
	for i = 1, 3 do
		holes[i] = piece("MouthHole", Vector3.new(0.2, 2, 2), Color3.fromRGB(70, 15, 35), Enum.PartType.Cylinder)
	end
	local tongue = piece("Tongue", Vector3.new(0.22, 1.4, 1.4), Color3.fromRGB(255, 110, 140), Enum.PartType.Cylinder)
	local brows = { piece("Brow", Vector3.new(2.2, 0.3, 0.5), INK), piece("Brow", Vector3.new(2.2, 0.3, 0.5), INK) }
	local arcs = { {}, {} }
	for side = 1, 2 do
		for i = 1, 6 do
			arcs[side][i] = piece("EyeArc", Vector3.new(0.5, 0.3, 0.6), INK)
		end
	end
	local lids = {}
	for _, sd in ipairs({ -1, 1 }) do
		local lid = piece("Lid", Vector3.new(3.9, 3.9, 3.9), Color3.fromRGB(200, 165, 255), Enum.PartType.Ball)
		lid.Transparency = 1
		table.insert(lids, { part = lid, side = sd })
	end
	bubble = makeBubble(body :: BasePart)
	sparkles(body :: BasePart)

	-- A point on the body's surface (body space), pushed out by `lift`, and its outward normal.
	local function surface(x: number, y: number, lift: number): (Vector3, Vector3)
		local z = math.sqrt(math.max(0.5, R * R - x * x - y * y))
		local n = Vector3.new(x, y, z).Unit
		return n * (R + lift), n
	end
	-- Lay a chain of pieces along points (body space) on the surface.
	local function chain(cf: CFrame, segs: { BasePart }, pts: { Vector3 }, show: boolean)
		for i, seg in ipairs(segs) do
			local a, b = pts[i], pts[i + 1]
			local dirv = b - a
			if not show or dirv.Magnitude < 0.01 then
				seg.Transparency = 1
				continue
			end
			local mid = (a + b) / 2
			seg.Transparency = 0
			seg.Size = Vector3.new(seg.Size.X, seg.Size.Y, dirv.Magnitude + 0.2)
			seg.CFrame = cf * CFrame.lookAt(mid, mid + dirv, mid.Unit)
		end
	end
	local function disc(cf: CFrame, p: BasePart, x: number, y: number, d: number, lift: number)
		if d < 0.15 then
			p.Transparency = 1
			return
		end
		local at, n = surface(x, y, lift)
		p.Transparency = 0
		p.Size = Vector3.new(0.2, d, d)
		p.CFrame = cf * CFrame.lookAt(at, at + n) * CFrame.Angles(0, math.pi / 2, 0)
	end

	-- Expressions: the mouth's curve (smile up, frown down), how open it is, a round open mouth
	-- (a gasp or yawn), the brows' lift and tilt, and what the eyes do.
	local EXPR = {
		happy = { curve = 0.9, open = 0, brow = 0, tilt = 0, eyes = "open" },
		grin = { curve = 1.25, open = 0.6, brow = 0.35, tilt = 0, eyes = "happy" },
		surprised = { curve = 0, open = 1, brow = 0.9, tilt = 0, eyes = "wide", round = true },
		wink = { curve = 1.1, open = 0.25, brow = 0.2, tilt = 0.18, eyes = "wink" },
		love = { curve = 1.25, open = 0.35, brow = 0.3, tilt = 0, eyes = "love" },
		cheeky = { curve = 0.85, open = 0.35, brow = 0.15, tilt = -0.15, eyes = "open", tongue = true },
		sleepy = { curve = 0.3, open = 0, brow = -0.25, tilt = 0, eyes = "half" },
		yawn = { curve = 0, open = 1.3, brow = 0.25, tilt = 0, eyes = "closed", round = true },
	}
	Mascot.EXPRESSIONS = EXPR
	local cur = { curve = 0.9, open = 0, brow = 0, tilt = 0 }
	local face, faceUntil = "happy", 0
	function Mascot.express(name: string, secs: number?)
		if EXPR[name] then
			face = name
			faceUntil = os.clock() + (secs or 2)
			Mascot.expression = name
			if name == "love" then
				Mascot.hearts()
			end
		end
	end
	Mascot.expression = "happy"
	local pinkPupil = Color3.fromRGB(255, 70, 150)
	local darkPupil = Color3.fromRGB(25, 20, 35)

	local yaw = 0
	local nextBlink = os.clock() + 2
	local blinkUntil = 0
	local greeted = false
	local wasNear = false
	local nextIdle = os.clock() + 8
	local alone = 0
	local t = 0
	-- One frame of life (tests call it directly).
	function Mascot.step(dt: number)
		t += dt
		local char = player.Character
		local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
		local now = os.clock()
		-- Who to look at: you, if you're in the lobby; otherwise it gazes about.
		local target = home + Vector3.new(math.sin(t * 0.4) * 40, -8, 40)
		local near = false
		local dist = math.huge
		if root then
			dist = (root.Position - home).Magnitude
		end
		if root and dist < 160 then
			target = root.Position + Vector3.new(0, 2, 0)
			near = dist < 34
			if not greeted then
				greeted = true
				Mascot.cheer("Hi " .. player.DisplayName .. "! 👋")
				Mascot.express("wink", 2.2)
			end
			if near and not wasNear and now - lastSay > 6 then
				Mascot.cheer(({ "Ooh, hello up close! 😄", "Ready for a duel? 🎯", "Nice to see you! ✨" })[math.random(1, 3)])
				Mascot.express("grin", 2.2)
			end
			-- Bouncing off a mushroom, high in the air: a gasp, then a laugh.
			if root.Position.Y > home.Y + 8 and now - lastSay > 5 then
				Mascot.cheer(({ "Wheee! 🎉", "So high!! 🚀", "Do it again! 🍄" })[math.random(1, 3)])
				Mascot.express("surprised", 1.1)
				task.delay(1.1, Mascot.express, "grin", 1.6)
			end
		end
		wasNear = near
		-- Nobody about for a while: it gets drowsy and yawns.
		alone = if dist > 70 then alone + dt else 0
		if now - lastSay > 14 then
			say(TIPS[math.random(1, #TIPS)])
		end
		if now > nextIdle and now > faceUntil then
			nextIdle = now + math.random(6, 11)
			if alone > 15 then
				Mascot.express(if math.random() < 0.4 then "yawn" else "sleepy", 2.5)
			else
				Mascot.express(({ "cheeky", "wink", "grin", "love", "happy" })[math.random(1, 5)], 2)
			end
		end
		if now > faceUntil then
			face = if alone > 25 then "sleepy" else "happy"
			Mascot.expression = face
		end
		local e = EXPR[face]
		local k = math.min(1, dt * 9)
		-- Talking: the mouth opens and closes while its words type out.
		local talk = if now - lastSay < 1.4 and not e.round then 0.25 + 0.25 * math.sin(t * 22) else 0
		cur.curve += (e.curve - cur.curve) * k
		cur.open += (math.max(e.open, talk) - cur.open) * k
		cur.brow += (e.brow - cur.brow) * k
		cur.tilt += (e.tilt - cur.tilt) * k

		-- The body turns toward the target, unhurried.
		local d = target - home
		local want = math.atan2(d.X, d.Z)
		local diff = math.atan2(math.sin(want - yaw), math.cos(want - yaw))
		yaw += diff * math.min(1, dt * 2.2)
		-- Bob, sway, and a hop when it cheers.
		local hop = 0
		if now < hopUntil then
			local hk = (now - hopStart) / (hopUntil - hopStart)
			hop = math.sin(hk * math.pi) * 4
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
		-- Which eyes are drawn as arcs: both laughing or asleep, the left one winking.
		local arcL = e.eyes == "happy" or e.eyes == "closed" or e.eyes == "wink"
		local arcR = e.eyes == "happy" or e.eyes == "closed"
		for _, p in ipairs(parts) do
			local off = p.off
			local side = if off.Position.X < 0 then -1 else 1
			local hidden = (side < 0 and arcL) or (side > 0 and arcR)
			if p.name == "Pupil" or p.name == "Shine" then
				-- Rest on the eye's front, pushed toward the target.
				local eye = Vector3.new(side * 2.4, 1.6, 6.1)
				local push = Vector3.new(dir.X, dir.Y, math.max(dir.Z, 0.35)).Unit
				local at = eye + push * (if p.name == "Pupil" then 1.25 else 1.95) + (if p.name == "Shine" then Vector3.new(0.45, 0.45, 0) else Vector3.zero)
				p.part.CFrame = cf * CFrame.new(at)
				p.part.LocalTransparencyModifier = if blinking or hidden then 1 else 0
				if p.name == "Pupil" then
					p.part.Color = if e.eyes == "love" then pinkPupil else darkPupil
					local s = if e.eyes == "wide" then 1.5 elseif e.eyes == "love" then 2.3 else 2
					p.part.Size = Vector3.new(s, s, s)
				end
			elseif p.name == "Eye" then
				p.part.CFrame = cf * off
				p.part.LocalTransparencyModifier = if hidden then 1 else 0
			elseif p.name == "Smile" then
				p.part.CFrame = cf * off
				p.part.LocalTransparencyModifier = 1
			else
				p.part.CFrame = cf * off
			end
		end
		for _, l in ipairs(lids) do
			local hidden = (l.side < 0 and arcL) or (l.side > 0 and arcR)
			local drop = if e.eyes == "half" then 0.95 else 0
			l.part.CFrame = cf * CFrame.new(l.side * 2.4, 1.6 + drop, 6.3)
			l.part.Transparency = if (blinking or e.eyes == "half") and not hidden then 0 else 1
			if body then
				l.part.Color = (body :: BasePart).Color:Lerp(Color3.new(1, 1, 1), 0.15)
			end
		end
		-- Eye arcs: "^" laughing and winking, "u" asleep.
		for si, sd in ipairs({ -1, 1 }) do
			local show = if sd < 0 then arcL else arcR
			local bend = if e.eyes == "closed" then -0.55 else 0.65
			local pts = {}
			for i = 0, 6 do
				local dx = (i - 3) / 3 * 1.25
				table.insert(pts, (surface(sd * 2.4 + dx, 1.6 + bend * (1 - (dx / 1.25) ^ 2), 0.12)))
			end
			chain(cf, arcs[si], pts, show)
		end
		-- The mouth: a curved line, a dark opening under it when open, a tongue when cheeky.
		local w = 2.6 + cur.open * 0.4
		local cy = -1.7
		local pts = {}
		for i = 0, 11 do
			local x = (i - 5.5) / 5.5 * w
			table.insert(pts, (surface(x, cy - cur.curve * 0.9 * (1 - (x / w) ^ 2), 0.14)))
		end
		chain(cf, mouth, pts, not e.round)
		if e.round then
			disc(cf, holes[1], 0, cy - 0.4, 1 + cur.open * 1.3, 0.1)
			holes[2].Transparency, holes[3].Transparency = 1, 1
		else
			local depth = cur.open * 1.6
			local mid = cy - cur.curve * 0.9 * 0.55
			disc(cf, holes[1], 0, mid, depth, 0.08)
			disc(cf, holes[2], -w * 0.38, mid + 0.15, depth * 0.75, 0.08)
			disc(cf, holes[3], w * 0.38, mid + 0.15, depth * 0.75, 0.08)
		end
		if e.tongue or (cur.open > 0.45 and not e.round) then
			disc(cf, tongue, 0.25, cy - cur.curve * 0.9 - 0.35, if e.tongue then 1.4 else 0.9, 0.12)
		else
			tongue.Transparency = 1
		end
		-- Brows: lift for surprise, tilt for mischief.
		for bi, sd in ipairs({ -1, 1 }) do
			local at, n = surface(sd * 2.4, 3.75 + cur.brow * 0.7, 0.1)
			brows[bi].CFrame = cf * (CFrame.lookAt(at, at - n) * CFrame.Angles(0, 0, sd * cur.tilt))
		end
	end
	local tick = if RunService:IsClient() then RunService.RenderStepped else RunService.Heartbeat
	tick:Connect(Mascot.step)
end

--- Little hearts floating up off it (love).
function Mascot.hearts()
	if not body then
		return
	end
	for i = 1, 6 do
		local a = Instance.new("Part")
		a.Anchored, a.CanCollide, a.CanQuery, a.CanTouch = true, false, false, false
		a.Transparency = 1
		a.Size = Vector3.one * 0.2
		a.CFrame = (body :: BasePart).CFrame * CFrame.new(math.random(-6, 6), math.random(2, 6), 5)
		a.Parent = Workspace
		local bb = Instance.new("BillboardGui")
		bb.Size = UDim2.fromOffset(50, 50)
		bb.LightInfluence = 0
		bb.Parent = a
		local l = Instance.new("TextLabel")
		l.BackgroundTransparency = 1
		l.Size = UDim2.fromScale(1, 1)
		l.TextScaled = true
		l.Text = ({ "💖", "💕", "💗" })[i % 3 + 1]
		l.Parent = bb
		TweenService:Create(bb, TweenInfo.new(1.8, Enum.EasingStyle.Sine), { StudsOffsetWorldSpace = Vector3.new(math.random(-3, 3), 9, 0) }):Play()
		task.delay(1.2, function()
			TweenService:Create(l, TweenInfo.new(0.6), { TextTransparency = 1 }):Play()
		end)
		task.delay(2, function()
			a:Destroy()
		end)
	end
end

return Mascot
