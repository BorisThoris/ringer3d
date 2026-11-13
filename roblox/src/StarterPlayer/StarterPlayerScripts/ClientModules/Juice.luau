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
		Size = NumberSequence.new(0.35 * k + 0.1, 0),
		Lifetime = NumberRange.new(0.15, 0.35),
		Speed = NumberRange.new(6 * k, 16 * k),
		Drag = 6,
		Acceleration = Vector3.new(0, -30, 0),
		LightEmission = 1,
		Brightness = 4,
	}, math.floor(6 + 14 * k))
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

return Juice
