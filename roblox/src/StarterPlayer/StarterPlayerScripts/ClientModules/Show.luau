-- The match's showmanship: the intro (a crane round the field, the VS card, 3-2-1-FLICK!), a turn
-- banner nobody can miss (it swoops in big in the shooter's colour, then settles at the top as
-- "Tide is shooting"), a beacon over the marble whose turn it is, and emotes: a bubble over the
-- seat of whoever sent it.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage.Ringer.Config)
local Rules = require(ReplicatedStorage.Ringer.Rules)
local MarbleLook = require(ReplicatedStorage.Ringer.MarbleLook)
local Kit = require(script.Parent.Kit)
local Sfx = require(script.Parent.Sfx)
local Aim = require(script.Parent.Aim)

local Show = {}
Show.EMOTES = { "😂", "🔥", "😎", "😮", "😭", "👏" }
Show.INTRO_SECONDS = 3.6

local gui: Instance? = nil
local banner: Frame? = nil
local pill: TextLabel? = nil
local beacon: BillboardGui? = nil
local beaconPart: Part? = nil
local beaconConn: RBXScriptConnection? = nil
local lastTurnKey = ""
local feed: Frame? = nil

local function colorOf(seat): Color3
	return MarbleLook.uiColor(MarbleLook.lookFor(seat and seat.marble))
end

local function shortName(seat): string
	return (seat and seat.name or "?"):gsub(" Bot$", "")
end

--- Where to draw the interface (the match frame).
function Show.attach(parent: Instance)
	gui = parent
	feed = nil
	pill = Kit.label("", 22, {
		Name = "TurnPill",
		AnchorPoint = Vector2.new(0.5, 0),
		Position = UDim2.new(0.5, 0, 0, 84),
		Size = UDim2.fromOffset(360, 38),
		BackgroundTransparency = 0.1,
		BackgroundColor3 = Kit.INK,
		Visible = false,
		Parent = parent,
	})
	Kit.round(pill :: any, 19)
	Kit.stroke(pill :: any, Color3.new(1, 1, 1), 3)
end

-- ---- Whose turn ------------------------------------------------------------------------------

local function seatPosition(state, i: number): Vector3
	local a = Rules.seatAngle(i, #state.seats)
	return state.origin + Vector3.new(math.cos(a), 0, math.sin(a)) * Config.RING_R
end

local function placeBeacon(state)
	local seat = state.seats[state.current]
	if not seat then
		return
	end
	if not beaconPart or not beaconPart.Parent then
		beaconPart = Instance.new("Part")
		beaconPart.Name = "TurnBeacon"
		beaconPart.Anchored, beaconPart.CanCollide, beaconPart.CanQuery, beaconPart.CanTouch = true, false, false, false
		beaconPart.Transparency = 1
		beaconPart.Size = Vector3.one * 0.2
		beaconPart.Parent = Workspace
		beacon = Instance.new("BillboardGui")
		beacon.Size = UDim2.fromOffset(170, 74)
		beacon.AlwaysOnTop = true
		beacon.LightInfluence = 0
		beacon.Parent = beaconPart
		local name = Kit.label("", 22, { Name = "Name", Size = UDim2.new(1, 0, 0, 30), Parent = beacon })
		name.TextStrokeTransparency = 0
		local arrow = Kit.label("▼", 34, { Name = "Arrow", Position = UDim2.fromOffset(0, 28), Size = UDim2.new(1, 0, 0, 40), Parent = beacon })
		arrow.TextStrokeTransparency = 0
	end
	local color = colorOf(seat)
	local b = beacon :: BillboardGui
	(b:FindFirstChild("Name") :: TextLabel).Text = if seat.userId and game:GetService("Players").LocalPlayer and seat.userId == game:GetService("Players").LocalPlayer.UserId then "YOU" else shortName(seat)
	;(b:FindFirstChild("Name") :: TextLabel).TextColor3 = color
	;(b:FindFirstChild("Arrow") :: TextLabel).TextColor3 = color
	local base = state.shooter or seatPosition(state, state.current)
	if beaconConn then
		beaconConn:Disconnect()
	end
	beaconConn = (if RunService:IsClient() then RunService.RenderStepped else RunService.Heartbeat):Connect(function()
		if not beaconPart then
			return
		end
		local model = Workspace:FindFirstChild("Table" .. state.id)
		local taw = model and model:FindFirstChild("Marbles") and model.Marbles:FindFirstChild("Shooter")
		local at = if taw and Aim.state and Aim.state.phase == "aim" and not Aim.state.firstShot then (taw :: BasePart).Position else base
		beaconPart.Position = at + Vector3.new(0, 7 + math.sin(os.clock() * 4) * 0.8, 0)
	end)
	b.Enabled = true
end

--- A new turn: the big swoop, then the pill at the top, and the beacon over the shooter.
function Show.turn(state, mySeat: number?)
	if not gui or state.phase ~= "aim" then
		return
	end
	placeBeacon(state)
	local key = string.format("%s:%s:%s", tostring(state.id), tostring(state.current), tostring(state.shots))
	if key == lastTurnKey then
		return
	end
	lastTurnKey = key
	local seat = state.seats[state.current]
	local mine = mySeat == state.current
	local color = colorOf(seat)
	local title = if mine then (if state.firstShot then "YOUR TURN!" else "SHOOT AGAIN!") else string.upper(shortName(seat)) .. (if state.firstShot then "'S TURN" else " AGAIN")
	if pill then
		pill.Visible = true
		pill.Text = if mine then "🎯 Your shot" else ("⏳ " .. shortName(seat) .. " is shooting")
		pill.TextColor3 = color
		;(pill:FindFirstChildOfClass("UIStroke") :: UIStroke).Color = color
	end
	-- The swoop: a big ribbon in the shooter's colour across the middle of the screen.
	if banner then
		banner:Destroy()
	end
	local b = Kit.new("Frame", { Name = "TurnBanner", AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.36), Size = UDim2.new(1.2, 0, 0, 110), BackgroundColor3 = color, BackgroundTransparency = 0.15, BorderSizePixel = 0, Rotation = -3, ZIndex = 30, Parent = gui })
	banner = b
	Kit.new("UIGradient", { Color = ColorSequence.new(color:Lerp(Color3.new(1, 1, 1), 0.35), color:Lerp(Color3.new(0, 0, 0), 0.25)), Rotation = 90, Parent = b })
	local label = Kit.label(title, 64, { Size = UDim2.fromScale(1, 1), ZIndex = 31, TextColor3 = Color3.new(1, 1, 1), Parent = b })
	label.TextStrokeTransparency = 0
	local scale = Kit.new("UIScale", { Scale = 0.2, Parent = b })
	TweenService:Create(scale, TweenInfo.new(0.35, Enum.EasingStyle.Back), { Scale = 1 }):Play()
	Sfx.chime("turn")
	if mine then
		Sfx.ui("whoosh", 0.6)
	end
	task.delay(1.1, function()
		if banner == b then
			TweenService:Create(b, TweenInfo.new(0.3), { BackgroundTransparency = 1, Position = UDim2.fromScale(0.5, 0.08) }):Play()
			TweenService:Create(label, TweenInfo.new(0.3), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
			TweenService:Create(scale, TweenInfo.new(0.3), { Scale = 0.4 }):Play()
			task.delay(0.35, function()
				b:Destroy()
			end)
		end
	end)
end

--- The table is gone: take the banner, pill and beacon down.
function Show.clear()
	lastTurnKey = ""
	if banner then
		banner:Destroy()
		banner = nil
	end
	if pill then
		pill.Visible = false
	end
	if beaconConn then
		beaconConn:Disconnect()
		beaconConn = nil
	end
	if beaconPart then
		beaconPart:Destroy()
		beaconPart = nil
	end
end

-- ---- The intro -------------------------------------------------------------------------------

--- Before the first shot: the camera cranes round the field, the VS card slams in, 3-2-1-FLICK!
function Show.intro(state, mySeat: number?)
	if not gui then
		return
	end
	Aim.introUntil = os.clock() + Show.INTRO_SECONDS
	local root = Kit.new("Frame", { Name = "Intro", BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), ZIndex = 40, Parent = gui })
	-- Letterbox bars: it's a show now.
	local top = Kit.new("Frame", { BackgroundColor3 = Color3.new(0, 0, 0), BorderSizePixel = 0, Size = UDim2.new(1, 0, 0, 0), ZIndex = 40, Parent = root })
	local bottom = Kit.new("Frame", { BackgroundColor3 = Color3.new(0, 0, 0), BorderSizePixel = 0, AnchorPoint = Vector2.new(0, 1), Position = UDim2.fromScale(0, 1), Size = UDim2.new(1, 0, 0, 0), ZIndex = 40, Parent = root })
	TweenService:Create(top, TweenInfo.new(0.4), { Size = UDim2.new(1, 0, 0.11, 0) }):Play()
	TweenService:Create(bottom, TweenInfo.new(0.4), { Size = UDim2.new(1, 0, 0.11, 0) }):Play()
	local arena = Config.ARENAS[state.arena]
	local where = Kit.label((arena and arena.name or "") .. (if arena and arena.tagline then "\n" .. arena.tagline else ""), 22, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.fromScale(0.5, 0.97), Size = UDim2.new(0.9, 0, 0.09, 0), TextColor3 = Kit.CREAM, ZIndex = 41, TextTransparency = 1, Parent = root })
	TweenService:Create(where, TweenInfo.new(0.6), { TextTransparency = 0 }):Play()
	-- The VS card: each player's marble alive in its showcase, names in their colours.
	local card = Kit.new("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.45), Size = UDim2.fromOffset(720, 260), BackgroundTransparency = 1, ZIndex = 41, Parent = root })
	local n = #state.seats
	for i, seat in ipairs(state.seats) do
		local color = colorOf(seat)
		local x = if n == 2 then (if i == 1 then 0.2 else 0.8) else (i - 0.5) / n
		local slot = Kit.new("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(if i == 1 then -0.4 else 1.4, 0.45), Size = UDim2.fromOffset(220, 240), BackgroundTransparency = 1, ZIndex = 41, Parent = card })
		Kit.showcase(seat.marble or "ember", slot, UDim2.fromOffset(220, 170), MarbleLook.lookFor(seat.marble).rarity, color)
		local name = Kit.label(if i == mySeat then "YOU" else shortName(seat), 30, { Position = UDim2.fromOffset(0, 172), Size = UDim2.new(1, 0, 0, 36), TextColor3 = color, ZIndex = 42, Parent = slot })
		name.TextStrokeTransparency = 0
		TweenService:Create(slot, TweenInfo.new(0.5, Enum.EasingStyle.Back), { Position = UDim2.fromScale(x, 0.45) }):Play()
	end
	local vs = Kit.label("VS", 96, { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.42), Size = UDim2.fromOffset(200, 120), TextColor3 = Kit.GOLD, ZIndex = 43, Parent = card })
	vs.TextStrokeTransparency = 0
	local vsScale = Kit.new("UIScale", { Scale = 3, Parent = vs })
	task.delay(0.35, function()
		TweenService:Create(vsScale, TweenInfo.new(0.3, Enum.EasingStyle.Back, Enum.EasingDirection.Out), { Scale = 1 }):Play()
		Sfx.clack(1500, "marble")
	end)
	-- 3-2-1-FLICK!
	task.spawn(function()
		task.wait(1.4)
		TweenService:Create(card, TweenInfo.new(0.3), { Position = UDim2.fromScale(0.5, -0.4) }):Play()
		for _, word in ipairs({ "3", "2", "1", "FLICK!" }) do
			local w = Kit.label(word, if word == "FLICK!" then 120 else 140, { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.45), Size = UDim2.fromOffset(600, 180), TextColor3 = if word == "FLICK!" then Kit.GOLD else Kit.CREAM, ZIndex = 44, Parent = root })
			w.TextStrokeTransparency = 0
			local sc = Kit.new("UIScale", { Scale = 2.2, Parent = w })
			TweenService:Create(sc, TweenInfo.new(0.25, Enum.EasingStyle.Back), { Scale = 1 }):Play()
			if word == "FLICK!" then
				Sfx.ui("whoosh")
				Sfx.chime("capture")
			else
				Sfx.ui("tick", 0.8)
			end
			task.delay(0.42, function()
				TweenService:Create(w, TweenInfo.new(0.15), { TextTransparency = 1, TextStrokeTransparency = 1 }):Play()
				task.delay(0.2, function()
					w:Destroy()
				end)
			end)
			task.wait(0.5)
		end
		TweenService:Create(top, TweenInfo.new(0.4), { Size = UDim2.new(1, 0, 0, 0) }):Play()
		TweenService:Create(bottom, TweenInfo.new(0.4), { Size = UDim2.new(1, 0, 0, 0) }):Play()
		TweenService:Create(where, TweenInfo.new(0.3), { TextTransparency = 1 }):Play()
		task.wait(0.45)
		root:Destroy()
	end)
end

-- ---- The feed: what just happened, on screen ------------------------------------------------

--- A line sliding in on the left of the screen: "Tide: 🔥", "You captured a marble! +1".
function Show.feed(text: string, color: Color3?, big: string?)
	if not gui then
		return
	end
	if not feed or not feed.Parent then
		feed = Kit.new("Frame", { Name = "Feed", AnchorPoint = Vector2.new(0, 0.5), Position = UDim2.new(0, 16, 0.55, 0), Size = UDim2.fromOffset(380, 300), BackgroundTransparency = 1, Parent = gui })
		Kit.new("UIListLayout", { VerticalAlignment = Enum.VerticalAlignment.Bottom, Padding = UDim.new(0, 6), SortOrder = Enum.SortOrder.LayoutOrder, Parent = feed })
	end
	local f = feed :: Frame
	local row = Kit.new("Frame", { Size = UDim2.fromOffset(380, if big then 64 else 40), BackgroundColor3 = Kit.INK, BackgroundTransparency = 0.25, LayoutOrder = math.floor(os.clock() * 100), Parent = f })
	Kit.round(row, 14)
	Kit.stroke(row, color or Color3.new(1, 1, 1), 3)
	if big then
		Kit.label(big, 44, { Position = UDim2.fromOffset(6, 0), Size = UDim2.fromOffset(60, 64), Parent = row })
	end
	Kit.label(text, 20, { Position = UDim2.fromOffset(if big then 70 else 12, 0), Size = UDim2.new(1, if big then -80 else -24, 1, 0), TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = color or Kit.CREAM, Parent = row })
	local sc = Kit.new("UIScale", { Scale = 0.3, Parent = row })
	TweenService:Create(sc, TweenInfo.new(0.25, Enum.EasingStyle.Back), { Scale = 1 }):Play()
	-- Keep the last five.
	local rows = {}
	for _, c in ipairs(f:GetChildren()) do
		if c:IsA("Frame") then
			table.insert(rows, c)
		end
	end
	table.sort(rows, function(a, b)
		return a.LayoutOrder < b.LayoutOrder
	end)
	for i = 1, #rows - 5 do
		rows[i]:Destroy()
	end
	task.delay(4.5, function()
		if row.Parent then
			TweenService:Create(sc, TweenInfo.new(0.3), { Scale = 0 }):Play()
			task.delay(0.32, function()
				row:Destroy()
			end)
		end
	end)
end

--- An emote, big on screen too: it pops up by the middle and floats away.
function Show.screenEmote(emoji: string, who: string, color: Color3)
	if not gui then
		return
	end
	local rng = Random.new()
	local e = Kit.label(emoji, 110, { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(rng:NextNumber(0.3, 0.7), 0.62), Size = UDim2.fromOffset(160, 160), ZIndex = 35, Parent = gui })
	local sc = Kit.new("UIScale", { Scale = 0.2, Parent = e })
	TweenService:Create(sc, TweenInfo.new(0.3, Enum.EasingStyle.Back), { Scale = 1 }):Play()
	TweenService:Create(e, TweenInfo.new(1.8, Enum.EasingStyle.Quad), { Position = e.Position - UDim2.fromScale(0, 0.2), Rotation = rng:NextNumber(-20, 20) }):Play()
	task.delay(1.4, function()
		TweenService:Create(e, TweenInfo.new(0.4), { TextTransparency = 1 }):Play()
		task.delay(0.45, function()
			e:Destroy()
		end)
	end)
	Show.feed(who, color, emoji)
end

-- ---- Emotes ----------------------------------------------------------------------------------

--- A bubble with `emoji` over the seat of whoever sent it.
function Show.emote(state, seat: number, emoji: string)
	if not state or not state.seats[seat] then
		return
	end
	local a = Rules.seatAngle(seat, #state.seats)
	local at = state.origin + Vector3.new(math.cos(a), 0, math.sin(a)) * (Config.BOUND_R + 9) + Vector3.new(0, 14, 0)
	local p = Instance.new("Part")
	p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
	p.Transparency = 1
	p.Size = Vector3.one * 0.2
	p.Position = at
	p.Parent = Workspace
	local bb = Instance.new("BillboardGui")
	bb.Size = UDim2.fromOffset(120, 120)
	bb.AlwaysOnTop = true
	bb.LightInfluence = 0
	bb.Parent = p
	local bubble = Kit.new("Frame", { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.fromScale(0.5, 0.5), Size = UDim2.fromScale(0.92, 0.92), BackgroundColor3 = Color3.new(1, 1, 1), Parent = bb })
	Kit.round(bubble, 60)
	Kit.stroke(bubble, colorOf(state.seats[seat]), 5)
	Kit.label(emoji, 64, { Size = UDim2.fromScale(1, 1), Parent = bubble })
	local sc = Kit.new("UIScale", { Scale = 0.1, Parent = bubble })
	TweenService:Create(sc, TweenInfo.new(0.3, Enum.EasingStyle.Back), { Scale = 1 }):Play()
	TweenService:Create(p, TweenInfo.new(2.4, Enum.EasingStyle.Quad), { Position = at + Vector3.new(0, 6, 0) }):Play()
	Sfx.ui("tick", 0.7)
	local me = game:GetService("Players").LocalPlayer
	local s = state.seats[seat]
	Show.screenEmote(emoji, if s.userId and me and s.userId == me.UserId then "You" else shortName(s), colorOf(s))
	task.delay(1.9, function()
		TweenService:Create(sc, TweenInfo.new(0.3), { Scale = 0 }):Play()
	end)
	task.delay(2.4, function()
		p:Destroy()
	end)
end

return Show
