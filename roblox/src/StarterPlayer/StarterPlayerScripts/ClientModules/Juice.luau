-- What makes a shot feel good (src/render/juice.ts and GameView's feedback, plus more): camera
-- trauma (a shake that grows with the square of the hit) and a zoom punch on the flick,
-- shockwave rings where hard hits land, sparks at every clack, a capture celebration (a burst in
-- the marble's colour, a ring, "+1" rising over the ring and a combo call for doubles and
-- more), and each marble's signature effect thrown out when it hits. All cosmetic.

local Debris = game:GetService("Debris")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Juice = {}
Juice.trauma = 0
Juice.fovKick = 0

local TEX = {
	sparkle = "rbxasset://textures/particles/sparkles_main.dds",
	sparks = "rbxasset://textures/particles/fire_sparks_main.dds",
	ring = "rbxasset://textures/particles/explosion01_shockwave_main.dds",
	fire = "rbxasset://textures/particles/fire_main.dds",
	glow = "rbxasset://textures/particles/forcefield_glow_main.dds",
	vortex = "rbxasset://textures/particles/forcefield_vortex_main.dds",
}

local folder: Folder? = nil
local function holder(): Folder
	if not folder or not folder.Parent then
		folder = Instance.new("Folder")
		folder.Name = "Juice"
		folder.Parent = Workspace
	end
	return folder :: Folder
end

--- An invisible anchor at `pos` that lives `life` seconds.
local function anchor(pos: Vector3, life: number): Part
	local p = Instance.new("Part")
	p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
	p.Transparency = 1
	p.Size = Vector3.one * 0.2
	p.CFrame = CFrame.new(pos)
	p.Parent = holder()
	Debris:AddItem(p, life)
	return p
end

local function emit(at: Part, props: { [string]: any }, n: number)
	local e = Instance.new("ParticleEmitter")
	e.Rate = 0
	e.LightInfluence = 0
	e.SpreadAngle = Vector2.new(180, 180)
	for k, v in pairs(props) do
		(e :: any)[k] = v
	end
	e.Parent = at
	e:Emit(n)
end

Juice.gui = nil :: Instance? -- where screen flashes go (set by the client)

--- A blink of white over the whole screen: an impact frame.
function Juice.screenFlash(strength: number)
	local g = Juice.gui
	if not g then
		return
	end
	local f = Instance.new("Frame")
	f.BackgroundColor3 = Color3.new(1, 1, 1)
	f.BackgroundTransparency = 1 - math.clamp(strength, 0, 1) * 0.55
	f.BorderSizePixel = 0
	f.Size = UDim2.fromScale(1, 1)
	f.ZIndex = 80
	f.Active = false
	f.Parent = g
	TweenService:Create(f, TweenInfo.new(0.16), { BackgroundTransparency = 1 }):Play()
	Debris:AddItem(f, 0.2)
end

--- Camera trauma, 0..1.
function Juice.kick(amount: number)
	Juice.trauma = math.min(1, Juice.trauma + amount)
end

--- The flick: a zoom punch and a nudge, scaled by power.
function Juice.launch(power: number)
	Juice.fovKick = math.max(Juice.fovKick, 2 + power * 6)
	Juice.kick(0.12 + power * 0.2)
end

--- A ring of air where a hard hit lands: a flat neon ring that spreads and fades.
function Juice.shockwave(pos: Vector3, strength: number, color: Color3)
	local k = math.min(1, strength / 1200)
	local size = (0.5 + k * 1.3) * 4 * 2
	-- A see-through plate on the ground carrying a drawn ring (so nothing under it is hidden).
	local plate = Instance.new("Part")
	plate.Name = "Shockwave"
	plate.Anchored, plate.CanCollide, plate.CanQuery, plate.CanTouch, plate.CastShadow = true, false, false, false, false
	plate.Transparency = 1
	plate.Size = Vector3.new(size * 0.2, 0.05, size * 0.2)
	plate.CFrame = CFrame.new(pos.X, pos.Y - 0.25, pos.Z)
	plate.Parent = holder()
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Top
	gui.LightInfluence = 0
	gui.Brightness = 3
	gui.CanvasSize = Vector2.new(256, 256)
	gui.Parent = plate
	local circle = Instance.new("Frame")
	circle.BackgroundTransparency = 1
	circle.Size = UDim2.fromScale(1, 1)
	circle.Parent = gui
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0.5, 0)
	corner.Parent = circle
	local stroke = Instance.new("UIStroke")
	stroke.Color = color
	stroke.Thickness = 14
	stroke.Transparency = 0.1
	stroke.Parent = circle
	local life = 0.35 + k * 0.25
	local info = TweenInfo.new(life, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
	TweenService:Create(plate, info, { Size = Vector3.new(size, 0.05, size) }):Play()
	TweenService:Create(stroke, info, { Transparency = 1, Thickness = 4 }):Play()
	Debris:AddItem(plate, life + 0.1)
end

--- Sparks where two marbles (or a marble and the bank) meet.
function Juice.sparks(pos: Vector3, strength: number, color: Color3?)
	local k = math.clamp(strength / 900, 0.15, 1)
	emit(anchor(pos, 1.2), {
		Texture = TEX.sparks,
		Color = ColorSequence.new(Color3.new(1, 1, 1), color or Color3.fromRGB(255, 220, 140)),
		Size = NumberSequence.new(0.55 * k + 0.15, 0),
		Lifetime = NumberRange.new(0.15, 0.35),
		Speed = NumberRange.new(6 * k, 16 * k),
		Drag = 6,
		Acceleration = Vector3.new(0, -30, 0),
		LightEmission = 1,
		Brightness = 4,
	}, math.floor(10 + 26 * k))
end

--- A captured marble: a burst in its colour, a ring, "+1" rising, and the shooter's call.
function Juice.capture(pos: Vector3, color: Color3, count: number)
	Juice.kick(0.35)
	Juice.shockwave(pos, 1200, color)
	local a = anchor(pos + Vector3.new(0, 0.6, 0), 2.5)
	emit(a, { Texture = TEX.sparkle, Color = ColorSequence.new(color, Color3.new(1, 1, 1)), Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.9), NumberSequenceKeypoint.new(1, 0) }), Lifetime = NumberRange.new(0.6, 1.1), Speed = NumberRange.new(8, 18), Acceleration = Vector3.new(0, -20, 0), Drag = 2, LightEmission = 1, Brightness = 5, RotSpeed = NumberRange.new(-200, 200) }, 40)
	emit(a, { Texture = TEX.glow, Color = ColorSequence.new(color), Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 2), NumberSequenceKeypoint.new(1, 9) }), Transparency = NumberSequence.new(0.3, 1), Lifetime = NumberRange.new(0.5), Speed = NumberRange.new(0), LightEmission = 1 }, 1)
	-- "+1" floating up, in the marble's colour, with the call for a double or better.
	local calls = { [2] = "DOUBLE!", [3] = "TRIPLE!", [4] = "MEGA!", [5] = "ULTRA!" }
	local text = "+1"
	if count >= 2 then
		text = calls[math.min(count, 5)] or "UNSTOPPABLE!"
	end
	local bb = Instance.new("BillboardGui")
	bb.Size = UDim2.fromOffset(240, 80)
	bb.AlwaysOnTop = true
	bb.LightInfluence = 0
	bb.StudsOffsetWorldSpace = Vector3.new(0, 3, 0)
	bb.Parent = a
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.FredokaOne
	label.Text = text
	label.TextScaled = true
	label.TextColor3 = color:Lerp(Color3.new(1, 1, 1), 0.3)
	label.TextStrokeTransparency = 0
	label.TextStrokeColor3 = Color3.fromRGB(30, 22, 40)
	label.Parent = bb
	local scale = Instance.new("UIScale")
	scale.Scale = 0.2
	scale.Parent = label
	TweenService:Create(scale, TweenInfo.new(0.35, Enum.EasingStyle.Back), { Scale = if count >= 2 then 1.25 else 1 }):Play()
	TweenService:Create(bb, TweenInfo.new(1.6, Enum.EasingStyle.Quad), { StudsOffsetWorldSpace = Vector3.new(0, 9, 0) }):Play()
	task.delay(1.1, function()
		TweenService:Create(label, TweenInfo.new(0.5), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
	end)
end

--- A marble's signature effect thrown out when it hits hard: flames, lightning, stars...
function Juice.signature(pos: Vector3, fx: string?, color: Color3)
	if not fx or fx == "" then
		return
	end
	local a = anchor(pos, 1.5)
	if fx:find("flames") or fx:find("lava") or fx:find("embers") then
		emit(a, { Texture = TEX.fire, Color = ColorSequence.new(Color3.fromRGB(255, 230, 140), color), Size = NumberSequence.new(1.2, 0), Lifetime = NumberRange.new(0.3, 0.5), Speed = NumberRange.new(4, 9), Acceleration = Vector3.new(0, 12, 0), LightEmission = 1, Brightness = 3 }, 18)
	end
	if fx:find("lightning") then
		emit(a, { Texture = TEX.sparks, Color = ColorSequence.new(Color3.new(1, 1, 1), color), Size = NumberSequence.new(0.5, 0), Lifetime = NumberRange.new(0.1, 0.25), Speed = NumberRange.new(20, 30), Drag = 10, LightEmission = 1, Brightness = 8 }, 26)
	end
	if fx:find("galaxy") or fx:find("vortex") or fx:find("stardust") or fx:find("rainbow") then
		local rainbow = fx:find("rainbow") ~= nil
		emit(a, { Texture = TEX.sparkle, Color = if rainbow then ColorSequence.new({ ColorSequenceKeypoint.new(0, Color3.fromRGB(255, 80, 80)), ColorSequenceKeypoint.new(0.5, Color3.fromRGB(80, 255, 120)), ColorSequenceKeypoint.new(1, Color3.fromRGB(120, 120, 255)) }) else ColorSequence.new(Color3.new(1, 1, 1), color), Size = NumberSequence.new(0.6, 0), Lifetime = NumberRange.new(0.4, 0.8), Speed = NumberRange.new(5, 12), Drag = 3, LightEmission = 1, Brightness = 5, RotSpeed = NumberRange.new(-180, 180) }, 22)
	end
	if fx:find("snow") or fx:find("hearts") or fx:find("bubbles") or fx:find("wisps") or fx:find("coins") then
		emit(a, { Texture = TEX.glow, Color = ColorSequence.new(color), Size = NumberSequence.new(0.6, 0), Lifetime = NumberRange.new(0.5, 0.9), Speed = NumberRange.new(3, 7), Acceleration = Vector3.new(0, 6, 0), LightEmission = 1, Brightness = 3 }, 14)
	end
end

-- ---- Cartoon hits: POW! BONK! and a flash on the marbles that met -----------------------------

local WORDS = { "POW!", "BONK!", "WHAM!", "BAM!", "CLACK!", "BOOM!", "SMASH!", "ZAP!" }
local WORD_COLORS = { Color3.fromRGB(255, 220, 40), Color3.fromRGB(255, 120, 40), Color3.fromRGB(80, 220, 255), Color3.fromRGB(255, 90, 200), Color3.fromRGB(140, 255, 90) }
local lastPow = 0
local rng = Random.new()

--- A comic-book word over a spiky star where a hard hit lands.
function Juice.pow(pos: Vector3, strength: number)
	local now = os.clock()
	if now - lastPow < 0.22 then
		return
	end
	lastPow = now
	local k = math.clamp((strength - 250) / 1200, 0, 1)
	local a = anchor(pos + Vector3.new(0, 1.5, 0), 1.2)
	local bb = Instance.new("BillboardGui")
	local px = math.floor(120 + 90 * k)
	bb.Size = UDim2.fromOffset(px * 2, px)
	bb.AlwaysOnTop = true
	bb.LightInfluence = 0
	bb.StudsOffsetWorldSpace = Vector3.new(0, 2.5, 0)
	bb.Parent = a
	local color = WORD_COLORS[rng:NextInteger(1, #WORD_COLORS)]
	-- The spiky star: squares turned round a centre, like a comic burst.
	local star = Instance.new("Frame")
	star.AnchorPoint = Vector2.new(0.5, 0.5)
	star.Position = UDim2.fromScale(0.5, 0.5)
	star.Size = UDim2.fromOffset(px * 0.9, px * 0.9)
	star.BackgroundTransparency = 1
	star.Parent = bb
	for i = 0, 3 do
		local sq = Instance.new("Frame")
		sq.AnchorPoint = Vector2.new(0.5, 0.5)
		sq.Position = UDim2.fromScale(0.5, 0.5)
		sq.Size = UDim2.fromScale(0.72, 0.72)
		sq.Rotation = i * 22.5
		sq.BackgroundColor3 = Color3.new(1, 1, 1)
		sq.BorderSizePixel = 0
		sq.Parent = star
		local st = Instance.new("UIStroke")
		st.Color = color
		st.Thickness = 4
		st.Parent = sq
	end
	local word = Instance.new("TextLabel")
	word.BackgroundTransparency = 1
	word.Size = UDim2.fromScale(1, 1)
	word.Font = Enum.Font.FredokaOne
	word.Text = WORDS[rng:NextInteger(1, #WORDS)]
	word.TextScaled = true
	word.TextColor3 = color
	word.TextStrokeTransparency = 0
	word.TextStrokeColor3 = Color3.fromRGB(30, 22, 40)
	word.Rotation = rng:NextNumber(-14, 14)
	word.ZIndex = 2
	word.Parent = bb
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 4
	stroke.Color = Color3.fromRGB(30, 22, 40)
	stroke.Parent = word
	local scale = Instance.new("UIScale")
	scale.Scale = 0.1
	scale.Parent = star
	local s2 = Instance.new("UIScale")
	s2.Scale = 0.1
	s2.Parent = word
	TweenService:Create(scale, TweenInfo.new(0.18, Enum.EasingStyle.Back), { Scale = 1 }):Play()
	TweenService:Create(s2, TweenInfo.new(0.22, Enum.EasingStyle.Back), { Scale = 1 }):Play()
	TweenService:Create(star, TweenInfo.new(0.6), { Rotation = 45 }):Play()
	task.delay(0.55, function()
		TweenService:Create(scale, TweenInfo.new(0.2), { Scale = 0 }):Play()
		TweenService:Create(s2, TweenInfo.new(0.2), { Scale = 0 }):Play()
	end)
	-- Cartoon stars flying off.
	emit(a, { Texture = TEX.sparkle, Color = ColorSequence.new(color, Color3.new(1, 1, 1)), Size = NumberSequence.new(1.1, 0), Lifetime = NumberRange.new(0.3, 0.6), Speed = NumberRange.new(10, 20), Drag = 4, Acceleration = Vector3.new(0, -25, 0), LightEmission = 1, Brightness = 5, RotSpeed = NumberRange.new(-300, 300) }, 12)
end

--- The marbles that met flash white for a blink.
function Juice.flash(pos: Vector3, within: number, tableModel: Instance?)
	local marbles = tableModel and tableModel:FindFirstChild("Marbles")
	if not marbles then
		return
	end
	for _, m in ipairs(marbles:GetChildren()) do
		if m:IsA("BasePart") and (m.Position - pos).Magnitude < within + m.Size.X then
			local hl = Instance.new("Highlight")
			hl.FillColor = Color3.new(1, 1, 1)
			hl.FillTransparency = 0.2
			hl.OutlineColor = Color3.fromRGB(255, 240, 150)
			hl.OutlineTransparency = 0
			hl.DepthMode = Enum.HighlightDepthMode.Occluded
			hl.Parent = m
			TweenService:Create(hl, TweenInfo.new(0.22), { FillTransparency = 1, OutlineTransparency = 1 }):Play()
			Debris:AddItem(hl, 0.3)
		end
	end
end

--- Shake the camera about the pose the rig gave it, and the zoom punch. Call after placing it.
local clock = 0
function Juice.apply(camera: Camera, target: Vector3, baseFov: number, dt: number)
	clock += dt
	local shake = Juice.trauma * Juice.trauma
	if shake > 0.0001 then
		local d = (camera.CFrame.Position - target).Magnitude
		local a = shake * d * 0.012
		local t = clock * 31
		local off = Vector3.new(math.sin(t * 1.3) + math.sin(t * 2.9 + 1.7) * 0.5, math.sin(t * 1.7 + 0.4) + math.sin(t * 3.3) * 0.5, math.sin(t * 1.1 + 2.1) + math.sin(t * 2.3 + 0.9) * 0.5) * a
		camera.CFrame = CFrame.lookAt(camera.CFrame.Position + off, target)
	end
	Juice.trauma = math.max(0, Juice.trauma - dt * 1.8)
	camera.FieldOfView = baseFov + Juice.fovKick
	Juice.fovKick *= math.exp(-dt * 7)
	if Juice.fovKick < 0.01 then
		Juice.fovKick = 0
	end
end

function Juice.clear()
	Juice.trauma = 0
	Juice.fovKick = 0
end

-- ---- Coins and speed ---------------------------------------------------------------------------

local RunService = game:GetService("RunService")
local GOLD = Color3.fromRGB(255, 200, 40)

--- A fountain of spinning gold coins where a marble was won, worth `amount` ("+4 🪙").
function Juice.coins(pos: Vector3, amount: number)
	local coins = {}
	for i = 1, math.clamp(amount + 2, 4, 9) do
		local c = Instance.new("Part")
		c.Name = "Coin"
		c.Shape = Enum.PartType.Cylinder
		c.Size = Vector3.new(0.3, 1.5, 1.5)
		c.Anchored, c.CanCollide, c.CanQuery, c.CanTouch, c.CastShadow = true, false, false, false, false
		c.Material = Enum.Material.Metal
		c.Reflectance = 0.3
		c.Color = if i % 3 == 0 then Color3.fromRGB(255, 230, 110) else GOLD
		c.CFrame = CFrame.new(pos)
		c.Parent = holder()
		local a = rng:NextNumber() * math.pi * 2
		local out = rng:NextNumber(4, 9)
		table.insert(coins, { part = c, v = Vector3.new(math.cos(a) * out, rng:NextNumber(20, 28), math.sin(a) * out), spin = rng:NextNumber(10, 18), at = pos })
	end
	local t = 0
	local conn
	conn = RunService.Heartbeat:Connect(function(dt)
		t += dt
		for _, c in ipairs(coins) do
			c.v += Vector3.new(0, -60 * dt, 0)
			c.at += c.v * dt
			if c.at.Y < pos.Y then
				-- A bounce on the ground, losing most of it.
				c.at = Vector3.new(c.at.X, pos.Y, c.at.Z)
				c.v = Vector3.new(c.v.X * 0.5, -c.v.Y * 0.35, c.v.Z * 0.5)
			end
			c.part.CFrame = CFrame.new(c.at) * CFrame.Angles(t * c.spin, t * c.spin * 0.6, 0)
			if t > 0.9 then
				c.part.Transparency = math.min(1, (t - 0.9) / 0.4)
			end
		end
		if t > 1.3 then
			conn:Disconnect()
			for _, c in ipairs(coins) do
				c.part:Destroy()
			end
		end
	end)
	-- "+4 🪙" in gold, under the capture call.
	local a = anchor(pos + Vector3.new(0, 1, 0), 1.8)
	local bb = Instance.new("BillboardGui")
	bb.Size = UDim2.fromOffset(150, 50)
	bb.AlwaysOnTop = true
	bb.LightInfluence = 0
	bb.StudsOffsetWorldSpace = Vector3.new(0, 1, 0)
	bb.Parent = a
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.FredokaOne
	label.Text = "+" .. amount .. " 🪙"
	label.TextScaled = true
	label.TextColor3 = Color3.fromRGB(255, 225, 90)
	label.TextStrokeTransparency = 0
	label.TextStrokeColor3 = Color3.fromRGB(30, 22, 40)
	label.Parent = bb
	TweenService:Create(bb, TweenInfo.new(1.4, Enum.EasingStyle.Quad), { StudsOffsetWorldSpace = Vector3.new(0, 6, 0) }):Play()
	task.delay(1, function()
		TweenService:Create(label, TweenInfo.new(0.4), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
	end)
end

-- ---- Words and stamps -------------------------------------------------------------------------

--- A word popping up in the world: rises, wobbles, fades. `drift` > 0 rises, < 0 sinks.
function Juice.word(pos: Vector3, text: string, color: Color3, size: number?, drift: number?)
	local a = anchor(pos + Vector3.new(0, 1.5, 0), 2)
	local bb = Instance.new("BillboardGui")
	bb.Size = UDim2.fromOffset(260 * (size or 1), 90 * (size or 1))
	bb.AlwaysOnTop = true
	bb.LightInfluence = 0
	bb.StudsOffsetWorldSpace = Vector3.new(0, 2, 0)
	bb.Parent = a
	local label = Instance.new("TextLabel")
	label.BackgroundTransparency = 1
	label.Size = UDim2.fromScale(1, 1)
	label.Font = Enum.Font.FredokaOne
	label.Text = text
	label.TextScaled = true
	label.TextColor3 = color
	label.TextStrokeTransparency = 0
	label.TextStrokeColor3 = Color3.fromRGB(30, 22, 40)
	label.Rotation = rng:NextNumber(-10, 10)
	label.Parent = bb
	local scale = Instance.new("UIScale")
	scale.Scale = 0.2
	scale.Parent = label
	TweenService:Create(scale, TweenInfo.new(0.3, Enum.EasingStyle.Back), { Scale = 1 }):Play()
	TweenService:Create(bb, TweenInfo.new(1.4, Enum.EasingStyle.Quad), { StudsOffsetWorldSpace = Vector3.new(0, 2 + 5 * (drift or 1), 0) }):Play()
	task.delay(0.9, function()
		TweenService:Create(label, TweenInfo.new(0.45), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
	end)
end

local lastBounce = 0
--- A hard rebound off the bank: a springy word and a ring of the field's stuff.
function Juice.rebound(pos: Vector3, strength: number)
	local now = os.clock()
	if now - lastBounce < 0.5 then
		return
	end
	lastBounce = now
	Juice.word(pos, ({ "BOING!", "BOUNCE!", "REBOUND!", "SPROING!" })[rng:NextInteger(1, 4)], Color3.fromRGB(120, 230, 255), 0.75 + math.min(strength, 1200) / 2400)
	Juice.shockwave(pos, strength * 0.7, Color3.fromRGB(150, 235, 255))
end

--- A marble rolled back into the ring: the cheer taken back. A sinking "BACK IN!", a drooping ring.
function Juice.reenter(pos: Vector3)
	Juice.word(pos, "BACK IN! -1", Color3.fromRGB(255, 120, 90), 0.9, -0.4)
	local a = anchor(pos + Vector3.new(0, 0.4, 0), 1.5)
	emit(a, { Texture = TEX.glow, Color = ColorSequence.new(Color3.fromRGB(255, 110, 90)), Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 8), NumberSequenceKeypoint.new(1, 1) }), Transparency = NumberSequence.new(0.4, 1), Lifetime = NumberRange.new(0.5), Speed = NumberRange.new(0), LightEmission = 1 }, 1)
	emit(a, { Texture = TEX.sparkle, Color = ColorSequence.new(Color3.fromRGB(255, 150, 120)), Size = NumberSequence.new(0.5, 0), Lifetime = NumberRange.new(0.5, 0.8), Speed = NumberRange.new(2, 5), Acceleration = Vector3.new(0, -25, 0), LightEmission = 1 }, 14)
	Juice.kick(0.15)
end

--- A big stamp across the screen ("OUT!", "TURN OVER", "-1 POINT"), with a red edge flash.
function Juice.stamp(text: string, color: Color3?)
	local g = Juice.gui
	if not g then
		return
	end
	local c = color or Color3.fromRGB(255, 80, 80)
	local edge = Instance.new("Frame")
	edge.Name = "StampEdge"
	edge.Size = UDim2.fromScale(1, 1)
	edge.BackgroundColor3 = c
	edge.BackgroundTransparency = 0.55
	edge.BorderSizePixel = 0
	edge.ZIndex = 81
	edge.Active = false
	edge.Parent = g
	local grad = Instance.new("UIGradient")
	grad.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0), NumberSequenceKeypoint.new(0.25, 1), NumberSequenceKeypoint.new(0.75, 1), NumberSequenceKeypoint.new(1, 0) })
	grad.Parent = edge
	local label = Instance.new("TextLabel")
	label.Name = "Stamp"
	label.AnchorPoint = Vector2.new(0.5, 0.5)
	label.Position = UDim2.fromScale(0.5, 0.42)
	label.Size = UDim2.fromScale(0.6, 0.18)
	label.BackgroundTransparency = 1
	label.Font = Enum.Font.FredokaOne
	label.TextScaled = true
	label.Text = text
	label.TextColor3 = c
	label.Rotation = -8
	label.ZIndex = 82
	label.Parent = g
	local stroke = Instance.new("UIStroke")
	stroke.Thickness = 5
	stroke.Color = Color3.fromRGB(30, 22, 40)
	stroke.Parent = label
	local scale = Instance.new("UIScale")
	scale.Scale = 3
	scale.Parent = label
	TweenService:Create(scale, TweenInfo.new(0.28, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 }):Play()
	TweenService:Create(edge, TweenInfo.new(0.9), { BackgroundTransparency = 1 }):Play()
	Juice.kick(0.35)
	task.delay(1.2, function()
		TweenService:Create(label, TweenInfo.new(0.4), { TextTransparency = 1 }):Play()
		TweenService:Create(stroke, TweenInfo.new(0.4), { Transparency = 1 }):Play()
	end)
	Debris:AddItem(label, 1.7)
	Debris:AddItem(edge, 1.7)
end

--- Anime speed lines rushing in from the screen's edges on a hard flick.
function Juice.speedLines(power: number)
	local g = Juice.gui
	if not g or power < 0.55 then
		return
	end
	local frame = Instance.new("Frame")
	frame.Name = "SpeedLines"
	frame.BackgroundTransparency = 1
	frame.Size = UDim2.fromScale(1, 1)
	frame.ZIndex = 79
	frame.Active = false
	frame.Parent = g
	local n = math.floor(14 + power * 16)
	for i = 1, n do
		local a = i / n * math.pi * 2 + rng:NextNumber(-0.1, 0.1)
		local line = Instance.new("Frame")
		line.AnchorPoint = Vector2.new(0, 0.5)
		line.BackgroundColor3 = Color3.new(1, 1, 1)
		line.BackgroundTransparency = 0.25
		line.BorderSizePixel = 0
		-- From just outside the screen's middle third out past its edge.
		local len = rng:NextNumber(0.25, 0.45)
		line.Size = UDim2.new(len, 0, 0, rng:NextInteger(2, 5))
		line.Position = UDim2.fromScale(0.5 + math.cos(a) * 0.32, 0.5 + math.sin(a) * 0.32)
		line.Rotation = math.deg(a)
		line.Parent = frame
		TweenService:Create(line, TweenInfo.new(0.35, Enum.EasingStyle.Quad), { BackgroundTransparency = 1, Position = UDim2.fromScale(0.5 + math.cos(a) * 0.5, 0.5 + math.sin(a) * 0.5) }):Play()
	end
	Debris:AddItem(frame, 0.4)
end

return Juice
