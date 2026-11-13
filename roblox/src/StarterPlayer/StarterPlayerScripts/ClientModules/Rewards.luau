-- The little loops that keep you playing: a player level with an XP bar that fills after every
-- match (10 XP a game, 15 more for a win: worked out from the profile's played and wins, so
-- nothing new is saved), a level-up party, coins that fly into the counter, and confetti when
-- you win.

local TweenService = game:GetService("TweenService")

local Kit = require(script.Parent.Kit)
local Sfx = require(script.Parent.Sfx)

local Rewards = {}

--- XP from the profile's numbers.
function Rewards.xp(played: number, wins: number): number
	return (played or 0) * 10 + (wins or 0) * 15
end

--- Total XP needed to reach `level` (level 1 needs 0): 25 n (n - 1), so each level takes 50 more.
function Rewards.xpFor(level: number): number
	return 25 * level * (level - 1)
end

--- Level, XP into it and XP the level spans.
function Rewards.level(played: number, wins: number): (number, number, number)
	local xp = Rewards.xp(played, wins)
	local n = 1
	while Rewards.xpFor(n + 1) <= xp do
		n += 1
	end
	return n, xp - Rewards.xpFor(n), Rewards.xpFor(n + 1) - Rewards.xpFor(n)
end

local screen: Instance? = nil
local badge: TextLabel? = nil
local fill: Frame? = nil
local xpText: TextLabel? = nil
local coinTarget: GuiObject? = nil
local shownLevel: number? = nil

--- The level badge and XP bar, under the coins.
function Rewards.attach(gui: Instance, hud: Instance, coins: GuiObject)
	screen = gui
	coinTarget = coins
	local holder = Kit.new("Frame", { Name = "Level", AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 96), Size = UDim2.fromOffset(300, 34), BackgroundTransparency = 1, Parent = hud })
	local b = Kit.label("1", 24, { Name = "Badge", Size = UDim2.fromOffset(46, 46), Position = UDim2.fromOffset(-8, -6), BackgroundTransparency = 0, BackgroundColor3 = Kit.PURPLE, ZIndex = 3, Parent = holder })
	Kit.round(b, 23)
	Kit.stroke(b, Kit.INK, 3)
	badge = b
	local back = Kit.new("Frame", { Position = UDim2.fromOffset(30, 6), Size = UDim2.new(1, -30, 0, 22), BackgroundColor3 = Kit.INK, Parent = holder })
	Kit.round(back, 11)
	local f = Kit.new("Frame", { Size = UDim2.fromScale(0, 1), BackgroundColor3 = Kit.GREEN, Parent = back })
	Kit.round(f, 11)
	Kit.new("UIGradient", { Color = ColorSequence.new(Color3.fromRGB(140, 255, 120), Color3.fromRGB(40, 190, 90)), Rotation = 90, Parent = f })
	fill = f
	xpText = Kit.label("", 15, { Size = UDim2.fromScale(1, 1), ZIndex = 2, Parent = back })
end

--- Paper confetti over the whole screen.
function Rewards.confetti(n: number, colors: { Color3 }?)
	if not screen then
		return
	end
	local rng = Random.new()
	for _ = 1, n do
		local col = if colors then colors[rng:NextInteger(1, #colors)] else Color3.fromHSV(rng:NextNumber(), 0.75, 1)
		local bit = Kit.new("Frame", { BackgroundColor3 = col, BorderSizePixel = 0, ZIndex = 60, Size = UDim2.fromOffset(rng:NextInteger(8, 14), rng:NextInteger(12, 22)), Position = UDim2.new(rng:NextNumber(), 0, -0.05, -rng:NextInteger(0, 200)), Rotation = rng:NextNumber(0, 360), Parent = screen })
		local tw = TweenService:Create(bit, TweenInfo.new(rng:NextNumber(1.8, 3.2), Enum.EasingStyle.Quad, Enum.EasingDirection.In), { Position = UDim2.new(bit.Position.X.Scale + rng:NextNumber(-0.15, 0.15), 0, 1.1, 0), Rotation = bit.Rotation + rng:NextNumber(-720, 720) })
		tw.Completed:Connect(function()
			bit:Destroy()
		end)
		tw:Play()
	end
end

--- Coins fly from `from` (a screen position) into the coin counter, with a sparkle run.
function Rewards.coinsFly(from: Vector2, count: number)
	if not screen or not coinTarget then
		return
	end
	local target = coinTarget.AbsolutePosition + coinTarget.AbsoluteSize / 2
	local n = math.clamp(math.floor(count / 10), 4, 16)
	local rng = Random.new()
	for i = 1, n do
		task.delay(i * 0.05, function()
			local c = Kit.new("TextLabel", { Text = "🪙", TextSize = 34, BackgroundTransparency = 1, AnchorPoint = Vector2.new(0.5, 0.5), Size = UDim2.fromOffset(40, 40), ZIndex = 61, Position = UDim2.fromOffset(from.X + rng:NextNumber(-60, 60), from.Y + rng:NextNumber(-30, 30)), Parent = screen })
			local mid = UDim2.fromOffset((from.X + target.X) / 2 + rng:NextNumber(-120, 120), math.min(from.Y, target.Y) - rng:NextNumber(40, 140))
			local t1 = TweenService:Create(c, TweenInfo.new(0.3, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), { Position = mid })
			t1.Completed:Connect(function()
				local t2 = TweenService:Create(c, TweenInfo.new(0.35, Enum.EasingStyle.Quad, Enum.EasingDirection.In), { Position = UDim2.fromOffset(target.X, target.Y), TextSize = 18 })
				t2.Completed:Connect(function()
					c:Destroy()
				end)
				t2:Play()
			end)
			t1:Play()
		end)
	end
	Sfx.ui("coin_fly")
	task.delay(0.7, function()
		Sfx.ui("coin")
		if coinTarget then
			local s = Kit.new("UIScale", { Scale = 1.25, Parent = coinTarget })
			TweenService:Create(s, TweenInfo.new(0.3, Enum.EasingStyle.Back), { Scale = 1 }):Play()
			task.delay(0.35, function()
				s:Destroy()
			end)
		end
	end)
end

--- A level up: a big banner, confetti and the fanfare.
function Rewards.levelUp(level: number)
	if not screen then
		return
	end
	local b = Kit.label("LEVEL " .. level .. "!", 80, { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.4), Size = UDim2.fromOffset(700, 120), TextColor3 = Kit.GOLD, ZIndex = 62, Parent = screen })
	b.TextStrokeTransparency = 0
	local sub = Kit.label("LEVEL UP", 34, { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.31), Size = UDim2.fromOffset(500, 50), TextColor3 = Color3.new(1, 1, 1), ZIndex = 62, Parent = screen })
	local s = Kit.new("UIScale", { Scale = 0.1, Parent = b })
	TweenService:Create(s, TweenInfo.new(0.45, Enum.EasingStyle.Back), { Scale = 1 }):Play()
	Sfx.ui("levelup")
	Rewards.confetti(70)
	task.delay(2.4, function()
		TweenService:Create(s, TweenInfo.new(0.3), { Scale = 0 }):Play()
		TweenService:Create(sub, TweenInfo.new(0.3), { TextTransparency = 1 }):Play()
		task.delay(0.35, function()
			b:Destroy()
			sub:Destroy()
		end)
	end)
end

--- New numbers from the server: fill the bar, and party on a level up.
function Rewards.update(profile)
	if not profile or not badge or not fill or not xpText then
		return
	end
	local level, into, span = Rewards.level(profile.played, profile.wins)
	badge.Text = tostring(level)
	xpText.Text = string.format("%d / %d XP", into, span)
	TweenService:Create(fill, TweenInfo.new(0.8, Enum.EasingStyle.Quad), { Size = UDim2.fromScale(math.clamp(into / span, 0.02, 1), 1) }):Play()
	if shownLevel and level > shownLevel then
		task.delay(1.2, Rewards.levelUp, level)
	end
	shownLevel = level
end

--- A win: the fanfare and confetti in the winner's colours.
function Rewards.win(color: Color3?)
	Sfx.ui("fanfare")
	Rewards.confetti(90, if color then { color, Kit.GOLD, Color3.new(1, 1, 1), Kit.GREEN, Kit.BLUE } else nil)
end

return Rewards
