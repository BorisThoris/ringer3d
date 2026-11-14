-- First-time coaching: a friendly card that walks a brand-new player through their first game
-- (where to start, how to flick, what wins), each tip once, then never again once they've played.

local TweenService = game:GetService("TweenService")

local Coach = {}
Coach.shown = {} :: { [string]: boolean }
Coach.current = nil :: string?

local card: Frame? = nil
local text: TextLabel? = nil
local hand: TextLabel? = nil
local hideAt = 0

function Coach.attach(gui: Instance)
	local f = Instance.new("Frame")
	f.Name = "Coach"
	f.AnchorPoint = Vector2.new(0.5, 1)
	f.Position = UDim2.new(0.5, 0, 1, -150)
	f.Size = UDim2.fromOffset(560, 92)
	f.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
	f.Visible = false
	f.ZIndex = 70
	f.Parent = gui
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, 24)
	c.Parent = f
	local st = Instance.new("UIStroke")
	st.Thickness = 4
	st.Color = Color3.fromRGB(255, 190, 40)
	st.Parent = f
	local h = Instance.new("TextLabel")
	h.BackgroundTransparency = 1
	h.Size = UDim2.fromOffset(80, 80)
	h.Position = UDim2.fromOffset(10, 6)
	h.TextScaled = true
	h.Text = "👆"
	h.ZIndex = 71
	h.Parent = f
	local t = Instance.new("TextLabel")
	t.BackgroundTransparency = 1
	t.Position = UDim2.fromOffset(96, 8)
	t.Size = UDim2.new(1, -110, 1, -16)
	t.Font = Enum.Font.FredokaOne
	t.TextScaled = true
	t.TextWrapped = true
	t.TextColor3 = Color3.fromRGB(40, 30, 60)
	t.ZIndex = 71
	t.Parent = f
	card, text, hand = f, t, h
	-- The hand bobs to draw the eye.
	task.spawn(function()
		while f.Parent do
			if f.Visible and hand then
				TweenService:Create(hand, TweenInfo.new(0.4, Enum.EasingStyle.Sine), { Position = UDim2.fromOffset(10, 0) }):Play()
				task.wait(0.4)
				TweenService:Create(hand, TweenInfo.new(0.4, Enum.EasingStyle.Sine), { Position = UDim2.fromOffset(10, 12) }):Play()
				task.wait(0.4)
				if hideAt > 0 and os.clock() > hideAt then
					Coach.hide()
				end
			else
				task.wait(0.3)
			end
		end
	end)
end

--- Show tip `key` once (with `icon`), for `secs` seconds or until hidden.
function Coach.tip(key: string, message: string, icon: string?, secs: number?)
	if Coach.shown[key] or not card then
		return false
	end
	Coach.shown[key] = true
	Coach.current = key
	local f = card :: Frame
	;(text :: TextLabel).Text = message
	;(hand :: TextLabel).Text = icon or "👆"
	hideAt = if secs then os.clock() + secs else 0
	f.Visible = true
	local s = f:FindFirstChildOfClass("UIScale") or Instance.new("UIScale")
	s.Parent = f
	s.Scale = 0.5
	TweenService:Create(s, TweenInfo.new(0.35, Enum.EasingStyle.Back), { Scale = 1 }):Play()
	return true
end

function Coach.hide()
	Coach.current = nil
	hideAt = 0
	if card then
		card.Visible = false
	end
end

return Coach
