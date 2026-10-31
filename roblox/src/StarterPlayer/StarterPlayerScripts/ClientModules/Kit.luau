-- A tiny UI kit: rounded panels, chunky buttons with a press bounce, labels, toasts, and marble
-- previews in ViewportFrames. Everything scales with the screen (phones to monitors).

local Players = game:GetService("Players")
local TweenService = game:GetService("TweenService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage.Ringer.Config)
local MarbleLook = require(ReplicatedStorage.Ringer.MarbleLook)

local Kit = {}

Kit.FONT = Enum.Font.FredokaOne
Kit.INK = Color3.fromRGB(30, 22, 40)
Kit.CREAM = Color3.fromRGB(255, 248, 235)
Kit.ORANGE = Color3.fromRGB(255, 120, 50)
Kit.GREEN = Color3.fromRGB(70, 200, 110)
Kit.BLUE = Color3.fromRGB(60, 150, 255)
Kit.PURPLE = Color3.fromRGB(150, 90, 240)
Kit.GOLD = Color3.fromRGB(255, 200, 60)
Kit.RED = Color3.fromRGB(240, 70, 80)
Kit.PANEL = Color3.fromRGB(45, 95, 200)

function Kit.new(class: string, props: { [string]: any }?, children: { Instance }?): any
	local i = Instance.new(class)
	for k, v in pairs(props or {}) do
		if k ~= "Parent" then
			(i :: any)[k] = v
		end
	end
	for _, c in ipairs(children or {}) do
		c.Parent = i
	end
	if props and props.Parent then
		i.Parent = props.Parent
	end
	return i
end

function Kit.round(parent: Instance, px: number?)
	return Kit.new("UICorner", { CornerRadius = UDim.new(0, px or 14), Parent = parent })
end

function Kit.stroke(parent: Instance, color: Color3?, thickness: number?)
	return Kit.new("UIStroke", { Color = color or Kit.INK, Thickness = thickness or 3, ApplyStrokeMode = Enum.ApplyStrokeMode.Border, Parent = parent })
end

function Kit.label(text: string, size: number, props: { [string]: any }?)
	local l = Kit.new("TextLabel", {
		BackgroundTransparency = 1,
		Text = text,
		TextColor3 = Kit.CREAM,
		Font = Kit.FONT,
		TextSize = size,
		TextWrapped = true,
		Size = UDim2.new(1, 0, 0, size + 8),
	})
	Kit.new("UIStroke", { Color = Kit.INK, Thickness = math.max(1.5, size / 14), Parent = l })
	for k, v in pairs(props or {}) do
		(l :: any)[k] = v
	end
	return l
end

--- A chunky button: colour body, darker base, ink outline, bounces when pressed.
function Kit.button(text: string, color: Color3, onClick: () -> (), props: { [string]: any }?)
	local b = Kit.new("TextButton", {
		AutoButtonColor = false,
		BackgroundColor3 = color,
		Text = text,
		TextColor3 = Color3.new(1, 1, 1),
		Font = Kit.FONT,
		TextSize = 24,
		Size = UDim2.fromOffset(180, 54),
	})
	Kit.round(b, 14)
	Kit.stroke(b, Kit.INK, 3)
	Kit.new("UIStroke", { Color = Kit.INK, Thickness = 2, ApplyStrokeMode = Enum.ApplyStrokeMode.Contextual, Parent = b })
	Kit.new("UIGradient", {
		Color = ColorSequence.new(Color3.new(1, 1, 1), Color3.fromRGB(200, 200, 200)),
		Rotation = 90,
		Parent = b,
	})
	for k, v in pairs(props or {}) do
		(b :: any)[k] = v
	end
	local scale = Kit.new("UIScale", { Parent = b })
	b.MouseEnter:Connect(function()
		TweenService:Create(scale, TweenInfo.new(0.1), { Scale = 1.05 }):Play()
	end)
	b.MouseLeave:Connect(function()
		TweenService:Create(scale, TweenInfo.new(0.1), { Scale = 1 }):Play()
	end)
	b.Activated:Connect(function()
		scale.Scale = 0.9
		TweenService:Create(scale, TweenInfo.new(0.25, Enum.EasingStyle.Back), { Scale = 1 }):Play()
		onClick()
	end)
	return b
end

--- A centred panel with a title and a close button; returns (panel, body).
function Kit.panel(screen: Instance, title: string, size: UDim2, onClose: (() -> ())?)
	local panel = Kit.new("Frame", {
		Name = title,
		AnchorPoint = Vector2.new(0.5, 0.5),
		Position = UDim2.fromScale(0.5, 0.52),
		Size = size,
		BackgroundColor3 = Kit.PANEL,
		Visible = false,
		Parent = screen,
	})
	Kit.round(panel, 22)
	Kit.stroke(panel, Kit.INK, 4)
	-- Bright blue panels, lighter at the top, as in the top-earning games.
	Kit.new("UIGradient", { Color = ColorSequence.new(Color3.fromRGB(120, 190, 255), Color3.fromRGB(50, 110, 225)), Rotation = 90, Parent = panel })
	Kit.new("UISizeConstraint", { MaxSize = Vector2.new(980, 680), Parent = panel })
	local head = Kit.label(title, 34, { Position = UDim2.fromOffset(0, 10), Size = UDim2.new(1, 0, 0, 44), Parent = panel })
	head.ZIndex = 2
	local close = Kit.button("X", Kit.RED, function()
		panel.Visible = false
		if onClose then
			onClose()
		end
	end, { Size = UDim2.fromOffset(48, 48), Position = UDim2.new(1, -58, 0, 10), Parent = panel })
	close.ZIndex = 3
	local body = Kit.new("Frame", {
		Name = "Body",
		BackgroundTransparency = 1,
		Position = UDim2.fromOffset(16, 66),
		Size = UDim2.new(1, -32, 1, -82),
		Parent = panel,
	})
	return panel, body
end

function Kit.open(panel: GuiObject)
	panel.Visible = true
	local scale = panel:FindFirstChildOfClass("UIScale") or Kit.new("UIScale", { Parent = panel })
	scale.Scale = 0.85
	TweenService:Create(scale, TweenInfo.new(0.25, Enum.EasingStyle.Back), { Scale = 1 }):Play()
end

--- A slowly turning marble in a ViewportFrame.
function Kit.preview(id: string, parent: Instance, size: UDim2?): ViewportFrame
	local look = MarbleLook.lookFor(id)
	local vp = Kit.new("ViewportFrame", {
		BackgroundTransparency = 1,
		Size = size or UDim2.fromScale(1, 1),
		Ambient = Color3.fromRGB(170, 170, 180),
		LightColor = Color3.new(1, 1, 1),
		LightDirection = Vector3.new(-1, -1.5, -1),
		Parent = parent,
	})
	local ball = MarbleLook.make(look, 1)
	ball.Anchored = true
	ball.CFrame = CFrame.new()
	ball.Parent = vp
	local cam = Kit.new("Camera", { FieldOfView = 30, CFrame = CFrame.lookAt(Vector3.new(0, 0.6, 4.4), Vector3.zero), Parent = vp })
	vp.CurrentCamera = cam
	task.spawn(function()
		local a = 0
		while vp.Parent do
			a += 0.03
			ball.CFrame = CFrame.Angles(0.3, a, 0)
			task.wait(1 / 30)
		end
	end)
	return vp
end

local toastHolder: Frame? = nil
function Kit.toast(screen: Instance, text: string, kind: string?)
	if not toastHolder or not toastHolder.Parent then
		toastHolder = Kit.new("Frame", {
			BackgroundTransparency = 1,
			AnchorPoint = Vector2.new(0.5, 0),
			Position = UDim2.new(0.5, 0, 0, 90),
			Size = UDim2.new(0.6, 0, 0.5, 0),
			Parent = screen,
		})
		Kit.new("UIListLayout", { HorizontalAlignment = Enum.HorizontalAlignment.Center, Padding = UDim.new(0, 8), Parent = toastHolder })
	end
	local color = kind == "good" and Kit.GREEN or kind == "bad" and Kit.RED or Kit.BLUE
	local t = Kit.new("TextLabel", {
		BackgroundColor3 = color,
		Text = text,
		TextColor3 = Color3.new(1, 1, 1),
		Font = Kit.FONT,
		TextSize = 22,
		TextWrapped = true,
		AutomaticSize = Enum.AutomaticSize.XY,
		Size = UDim2.fromOffset(0, 0),
		Parent = toastHolder,
	})
	Kit.new("UIPadding", { PaddingLeft = UDim.new(0, 16), PaddingRight = UDim.new(0, 16), PaddingTop = UDim.new(0, 8), PaddingBottom = UDim.new(0, 8), Parent = t })
	Kit.round(t, 12)
	Kit.stroke(t, Kit.INK, 3)
	Kit.new("UISizeConstraint", { MaxSize = Vector2.new(560, 200), Parent = t })
	task.delay(3.2, function()
		TweenService:Create(t, TweenInfo.new(0.4), { BackgroundTransparency = 1, TextTransparency = 1 }):Play()
		task.wait(0.45)
		t:Destroy()
	end)
end

--- 12500 -> "12,500".
function Kit.comma(n: number): string
	local s = tostring(math.floor(n))
	local out = s:reverse():gsub("(%d%d%d)", "%1,"):reverse()
	return (out:gsub("^,", ""))
end

--- A vertical gradient over a label's text: the gold numbers of the top games.
function Kit.gradient(label: Instance, top: Color3, bottom: Color3)
	return Kit.new("UIGradient", { Color = ColorSequence.new(top, bottom), Rotation = 90, Parent = label })
end

--- A "+N" that pops up from a spot on screen and floats away.
function Kit.popup(screen: Instance, text: string, at: UDim2, color: Color3?)
	local l = Kit.label(text, 34, { AnchorPoint = Vector2.new(0.5, 0.5), Position = at, Size = UDim2.fromOffset(240, 44), ZIndex = 20, Parent = screen })
	Kit.gradient(l, Color3.fromRGB(255, 250, 170), color or Kit.GOLD)
	local s = Kit.new("UIScale", { Scale = 0.3, Parent = l })
	TweenService:Create(s, TweenInfo.new(0.3, Enum.EasingStyle.Back), { Scale = 1.15 }):Play()
	TweenService:Create(l, TweenInfo.new(1.2, Enum.EasingStyle.Quad), { Position = at + UDim2.fromOffset(0, -70) }):Play()
	task.delay(0.9, function()
		TweenService:Create(l, TweenInfo.new(0.35), { TextTransparency = 1 }):Play()
		local st = l:FindFirstChildOfClass("UIStroke")
		if st then
			TweenService:Create(st, TweenInfo.new(0.35), { Transparency = 1 }):Play()
		end
		task.wait(0.4)
		l:Destroy()
	end)
end

--- Scale the whole UI to the screen: designed at 1280x720.
function Kit.autoscale(screen: ScreenGui)
	local s = Kit.new("UIScale", { Parent = screen })
	local function fit()
		local v = Workspace.CurrentCamera.ViewportSize
		s.Scale = math.clamp(math.min(v.X / 1280, v.Y / 720), 0.55, 1.4)
	end
	fit()
	Workspace.CurrentCamera:GetPropertyChangedSignal("ViewportSize"):Connect(fit)
end

function Kit.player()
	return Players.LocalPlayer
end

return Kit
