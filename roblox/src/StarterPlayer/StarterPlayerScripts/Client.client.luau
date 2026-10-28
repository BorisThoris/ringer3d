-- Ringer 3D on Roblox: the client. The lobby HUD (coins, Play, Shop, Marbles, Daily, Invite),
-- the panels behind them, the in-match HUD, results, and the Marble Bag reveal.

local MarketplaceService = game:GetService("MarketplaceService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local SocialService = game:GetService("SocialService")
local TextChatService = game:GetService("TextChatService")
local TweenService = game:GetService("TweenService")
local UserInputService = game:GetService("UserInputService")

local Config = require(ReplicatedStorage.Ringer.Config)
local Modules = script.Parent:WaitForChild("ClientModules")
local Kit = require(Modules.Kit)
local Aim = require(Modules.Aim)

local player = Players.LocalPlayer
local Remotes = ReplicatedStorage.Ringer:WaitForChild("Remotes")
local Request = Remotes:WaitForChild("Request") :: RemoteFunction

local profile: any = nil
local shopInfo: any = { bagsRestricted = true, minted = {}, top = {} }
local inMatch = false
local lastPlay: any = nil

local screen = Kit.new("ScreenGui", { Name = "Ringer", ResetOnSpawn = false, IgnoreGuiInset = false, ZIndexBehavior = Enum.ZIndexBehavior.Sibling, Parent = player:WaitForChild("PlayerGui") })
Kit.autoscale(screen)

local function toast(text: string, kind: string?)
	Kit.toast(screen, text, kind)
end

local function ask(action: string, args: any?)
	local ok, a, b = pcall(Request.InvokeServer, Request, action, args)
	if not ok then
		return false, "Couldn't reach the server."
	end
	return a, b
end

-- =============================================================================================
-- Lobby HUD
-- =============================================================================================
local hud = Kit.new("Frame", { Name = "Lobby", BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), Parent = screen })

local coinPill = Kit.new("Frame", { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 8), Size = UDim2.fromOffset(200, 50), BackgroundColor3 = Kit.PANEL, Parent = hud })
Kit.round(coinPill, 25)
Kit.stroke(coinPill, Kit.INK, 3)
local coinIcon = Kit.new("Frame", { Position = UDim2.fromOffset(8, 8), Size = UDim2.fromOffset(34, 34), BackgroundColor3 = Kit.GOLD, Parent = coinPill })
Kit.round(coinIcon, 17)
Kit.stroke(coinIcon, Kit.INK, 2)
local coinText = Kit.label("0", 28, { Position = UDim2.fromOffset(48, 6), Size = UDim2.new(1, -56, 0, 38), TextXAlignment = Enum.TextXAlignment.Left, Parent = coinPill })

-- The live event, under the coins.
local event = Kit.label("🎃 HALLOWEEN: the Jack-o'-Marble Limited is in Marble Bags!", 20, { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 62), Size = UDim2.fromOffset(620, 28), TextColor3 = Color3.fromRGB(255, 170, 60), Parent = hud })
event.TextWrapped = false

local side = Kit.new("Frame", { Position = UDim2.new(0, 12, 0.5, -170), Size = UDim2.fromOffset(150, 340), BackgroundTransparency = 1, Parent = hud })
Kit.new("UIListLayout", { Padding = UDim.new(0, 10), Parent = side })

local playButton = nil
local panels: { [string]: GuiObject } = {}
local function show(name: string)
	for n, p in pairs(panels) do
		p.Visible = false
		if n == name then
			Kit.open(p)
		end
	end
end

-- =============================================================================================
-- Play panel
-- =============================================================================================
local playPanel, playBody = Kit.panel(screen, "Play", UDim2.fromScale(0.72, 0.7))
panels.play = playPanel
Kit.new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, HorizontalAlignment = Enum.HorizontalAlignment.Center, Padding = UDim.new(0, 14), Parent = playBody })

local function card(parent: Instance, title: string, text: string, color: Color3)
	local c = Kit.new("Frame", { Size = UDim2.new(0.31, 0, 1, 0), BackgroundColor3 = color, Parent = parent })
	Kit.round(c, 18)
	Kit.stroke(c, Kit.INK, 3)
	Kit.label(title, 30, { Position = UDim2.fromOffset(0, 12), Size = UDim2.new(1, 0, 0, 36), Parent = c })
	Kit.label(text, 18, { Position = UDim2.new(0, 10, 0, 56), Size = UDim2.new(1, -20, 0, 90), TextYAlignment = Enum.TextYAlignment.Top, Parent = c })
	return c
end

local queued = false
local function play(args)
	lastPlay = args
	local ok, why = ask("play", args)
	if not ok then
		toast(why or "Couldn't start.", "bad")
		return
	end
	playPanel.Visible = false
	if why == "queued" then
		queued = true
		toast("Looking for an opponent...", "info")
	end
end

local duel = card(playBody, "Duel", "Play another player on this server. Winner takes the bonus coins.", Kit.ORANGE)
Kit.button("Find a match", Kit.GREEN, function()
	play({ mode = "duel" })
end, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -16), Size = UDim2.new(0.85, 0, 0, 56), Parent = duel })

local botCard = card(playBody, "Vs Bot", "Practice against a bot. Pick how good it is.", Kit.BLUE)
local botChoice = "casual"
local botLabel = Kit.label("Casual", 24, { Position = UDim2.new(0, 0, 0, 150), Size = UDim2.new(1, 0, 0, 30), Parent = botCard })
local ladder = { "rookie", "novice", "casual", "regular", "skilled", "expert", "master", "legend" }
local function stepBot(d: number)
	local i = table.find(ladder, botChoice) or 3
	botChoice = ladder[math.clamp(i + d, 1, #ladder)]
	botLabel.Text = Config.BOTS[botChoice].label
end
Kit.button("<", Kit.PURPLE, function()
	stepBot(-1)
end, { Position = UDim2.new(0, 14, 0, 146), Size = UDim2.fromOffset(44, 40), Parent = botCard })
Kit.button(">", Kit.PURPLE, function()
	stepBot(1)
end, { Position = UDim2.new(1, -58, 0, 146), Size = UDim2.fromOffset(44, 40), Parent = botCard })
Kit.button("Play", Kit.GREEN, function()
	play({ mode = "bot", bot = botChoice })
end, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -16), Size = UDim2.new(0.85, 0, 0, 56), Parent = botCard })

local towerCard = card(playBody, "The Tower", "Eight floors, each foe tougher. The Black Taw waits at the top.", Kit.PURPLE)
local towerLabel = Kit.label("Floor 1 of 8", 24, { Position = UDim2.new(0, 0, 0, 150), Size = UDim2.new(1, 0, 0, 30), Parent = towerCard })
Kit.button("Climb", Kit.GREEN, function()
	if profile and profile.tower > #Config.TOWER then
		toast("You've conquered the Tower! Replaying the Black Taw.", "good")
	end
	play({ mode = "tower" })
end, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -16), Size = UDim2.new(0.85, 0, 0, 56), Parent = towerCard })

-- =============================================================================================
-- Shop panel: marbles for coins, Marble Bags (odds shown), and Robux items
-- =============================================================================================
local shopPanel, shopBody = Kit.panel(screen, "Shop", UDim2.fromScale(0.8, 0.8))
panels.shop = shopPanel
local tabs = Kit.new("Frame", { Size = UDim2.new(1, 0, 0, 50), BackgroundTransparency = 1, Parent = shopBody })
Kit.new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 10), Parent = tabs })
local pages = Kit.new("Frame", { Position = UDim2.fromOffset(0, 60), Size = UDim2.new(1, 0, 1, -60), BackgroundTransparency = 1, Parent = shopBody })
local pageOf = {}
local function page(name: string)
	local f = Kit.new("ScrollingFrame", {
		Name = name,
		Size = UDim2.fromScale(1, 1),
		BackgroundTransparency = 1,
		ScrollBarThickness = 8,
		AutomaticCanvasSize = Enum.AutomaticSize.Y,
		CanvasSize = UDim2.new(),
		Visible = false,
		Parent = pages,
	})
	Kit.new("UIGridLayout", { CellSize = UDim2.fromOffset(190, 250), CellPadding = UDim2.fromOffset(12, 12), Parent = f })
	pageOf[name] = f
	Kit.button(name, Kit.BLUE, function()
		for n, p in pairs(pageOf) do
			p.Visible = n == name
		end
	end, { Size = UDim2.fromOffset(150, 46), Parent = tabs })
	return f
end
local marblesPage = page("Marbles")
local bagsPage = page("Bags")
local robuxPage = page("Robux")
marblesPage.Visible = true

local function itemCard(parent: Instance, title: string, sub: string, color: Color3)
	local c = Kit.new("Frame", { BackgroundColor3 = Color3.fromRGB(56, 44, 80), Parent = parent })
	Kit.round(c, 16)
	Kit.stroke(c, color, 3)
	Kit.label(title, 22, { Position = UDim2.fromOffset(0, 120), Size = UDim2.new(1, 0, 0, 26), Parent = c })
	Kit.label(sub, 16, { Position = UDim2.fromOffset(0, 146), Size = UDim2.new(1, 0, 0, 40), TextColor3 = color, Parent = c })
	return c
end

local function refreshShop()
	for _, f in ipairs({ marblesPage, bagsPage, robuxPage }) do
		for _, c in ipairs(f:GetChildren()) do
			if c:IsA("Frame") then
				c:Destroy()
			end
		end
	end
	if not profile then
		return
	end
	-- Marbles for coins.
	for _, look in ipairs(Config.MARBLES) do
		if look.price then
			local c = itemCard(marblesPage, look.name, look.rarity, Config.RARITY_COLOR[look.rarity])
			Kit.preview(look.id, c, UDim2.new(1, 0, 0, 116))
			local owned = profile.owned[look.id]
			Kit.button(owned and "Owned" or (look.price .. " coins"), owned and Color3.fromRGB(110, 110, 120) or Kit.GREEN, function()
				if owned then
					return
				end
				local ok, why = ask("buy", look.id)
				toast(ok and ("You got " .. look.name .. "!") or (why or "Couldn't buy."), ok and "good" or "bad")
			end, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -10), Size = UDim2.new(0.86, 0, 0, 44), Parent = c })
		end
	end
	-- Bags: hidden where paid random items are restricted. Odds always on the card.
	if shopInfo.bagsRestricted then
		local c = itemCard(bagsPage, "Marble Bags", "Not available in your region.", Kit.RED)
		c.Size = UDim2.fromOffset(190, 250)
	else
		local odds = {}
		for _, t in ipairs(Config.BAG_ODDS) do
			table.insert(odds, string.format("%s %d%%", t.rarity, t.weight))
		end
		local c = itemCard(bagsPage, "Marble Bag", table.concat(odds, " · "), Kit.GOLD)
		local bag = Kit.new("Frame", { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 14), Size = UDim2.fromOffset(90, 100), BackgroundColor3 = Color3.fromRGB(150, 100, 60), Parent = c })
		Kit.round(bag, 30)
		Kit.stroke(bag, Kit.INK, 3)
		Kit.button(Config.BAG_PRICE .. " coins", Kit.GREEN, function()
			local ok, got = ask("bag")
			if not ok then
				toast(typeof(got) == "string" and got or "Couldn't open the bag.", "bad")
			end
		end, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -10), Size = UDim2.new(0.86, 0, 0, 44), Parent = c })
		if Config.PRODUCTS.bag ~= 0 then
			local r = itemCard(bagsPage, "Marble Bag", "Open one now for Robux", Kit.GOLD)
			Kit.button("Buy (R$)", Kit.GOLD, function()
				MarketplaceService:PromptProductPurchase(player, Config.PRODUCTS.bag)
			end, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -10), Size = UDim2.new(0.86, 0, 0, 44), Parent = r })
		end
		-- The Limiteds still left, so scarcity is visible.
		for _, look in ipairs(Config.MARBLES) do
			if look.supply then
				local left = look.supply - (shopInfo.minted[look.id] or 0)
				local lc = itemCard(bagsPage, look.name, string.format("Limited · %d of %d left", math.max(0, left), look.supply), Config.RARITY_COLOR.Limited)
				Kit.preview(look.id, lc, UDim2.new(1, 0, 0, 116))
			end
		end
	end
	-- Robux.
	local function robuxCard(title: string, sub: string, color: Color3, buy: () -> (), preview: string?)
		local c = itemCard(robuxPage, title, sub, color)
		if preview then
			Kit.preview(preview, c, UDim2.new(1, 0, 0, 116))
		end
		Kit.button("Get", Kit.GOLD, buy, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -10), Size = UDim2.new(0.86, 0, 0, 44), Parent = c })
	end
	if Config.PASSES.vip ~= 0 and not profile.vip then
		robuxCard("VIP", "2x coins · Golden Taw · VIP tag", Kit.GOLD, function()
			MarketplaceService:PromptGamePassPurchase(player, Config.PASSES.vip)
		end, "gold")
	end
	if Config.PASSES.trails ~= 0 and not profile.trails then
		robuxCard("Trails", "A glowing trail on every shot", Kit.BLUE, function()
			MarketplaceService:PromptGamePassPurchase(player, Config.PASSES.trails)
		end, "comet")
	end
	for _, k in ipairs({ "coins500", "coins1500", "coins5000" }) do
		if Config.PRODUCTS[k] ~= 0 then
			robuxCard(Config.PRODUCT_COINS[k] .. " coins", "Coins for marbles and bags", Kit.GOLD, function()
				MarketplaceService:PromptProductPurchase(player, Config.PRODUCTS[k])
			end)
		end
	end
	if not profile.premium then
		robuxCard("Prism", "Free with Roblox Premium, plus 25% more coins", Kit.PURPLE, function()
			pcall(MarketplaceService.PromptPremiumPurchase, MarketplaceService, player)
		end, "prism")
	end
end

-- =============================================================================================
-- Collection panel
-- =============================================================================================
local colPanel, colBody = Kit.panel(screen, "Your Marbles", UDim2.fromScale(0.8, 0.8))
panels.marbles = colPanel
local colGrid = Kit.new("ScrollingFrame", { Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, ScrollBarThickness = 8, AutomaticCanvasSize = Enum.AutomaticSize.Y, CanvasSize = UDim2.new(), Parent = colBody })
Kit.new("UIGridLayout", { CellSize = UDim2.fromOffset(170, 230), CellPadding = UDim2.fromOffset(12, 12), Parent = colGrid })

local function refreshCollection()
	for _, c in ipairs(colGrid:GetChildren()) do
		if c:IsA("Frame") then
			c:Destroy()
		end
	end
	if not profile then
		return
	end
	local serials = {}
	for _, l in ipairs(profile.limiteds) do
		serials[l.id] = serials[l.id] or {}
		table.insert(serials[l.id], "#" .. l.serial)
	end
	for _, look in ipairs(Config.MARBLES) do
		local owned = profile.owned[look.id]
		local sub = look.rarity
		if serials[look.id] then
			sub = "Limited " .. table.concat(serials[look.id], " ") .. " / " .. look.supply
		elseif not owned then
			sub = look.price and (look.price .. " coins in the Shop")
				or look.source == "tower" and "Beat the Tower"
				or look.source == "vip" and "VIP pass"
				or look.source == "premium" and "Roblox Premium"
				or "Marble Bags"
		end
		local c = itemCard(colGrid, owned and look.name or "???", sub, owned and Config.RARITY_COLOR[look.rarity] or Color3.fromRGB(120, 120, 130))
		local vp = Kit.preview(look.id, c, UDim2.new(1, 0, 0, 116))
		if not owned then
			vp.ImageColor3 = Color3.fromRGB(20, 20, 25)
		end
		if owned then
			local equipped = profile.equipped == look.id
			Kit.button(equipped and "Equipped" or "Equip", equipped and Color3.fromRGB(110, 110, 120) or Kit.GREEN, function()
				ask("equip", look.id)
			end, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -10), Size = UDim2.new(0.86, 0, 0, 40), Parent = c })
		end
	end
end

-- =============================================================================================
-- Side buttons
-- =============================================================================================
Kit.button("Shop", Kit.GOLD, function()
	refreshShop()
	show("shop")
end, { Size = UDim2.fromOffset(150, 58), Parent = side })
Kit.button("Marbles", Kit.PURPLE, function()
	refreshCollection()
	show("marbles")
end, { Size = UDim2.fromOffset(150, 58), Parent = side })
local dailyButton = Kit.button("Daily", Kit.GREEN, function()
	local ok, got = ask("daily")
	if ok then
		toast(string.format("Day %d streak: +%d coins!", got.streak, got.coins), "good")
	else
		toast(typeof(got) == "string" and got or "Come back tomorrow!", "info")
	end
end, { Size = UDim2.fromOffset(150, 58), Parent = side })
Kit.button("Invite", Kit.BLUE, function()
	local ok, can = pcall(SocialService.CanSendGameInviteAsync, SocialService, player)
	if ok and can then
		SocialService:PromptGameInvite(player)
	else
		toast("Invites aren't available right now.", "info")
	end
end, { Size = UDim2.fromOffset(150, 58), Parent = side })

playButton = Kit.button("PLAY", Kit.GREEN, function()
	if queued then
		ask("cancel")
		queued = false
		toast("Stopped looking for a match.", "info")
		return
	end
	show("play")
end, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -24), Size = UDim2.fromOffset(260, 80), TextSize = 40, Parent = hud })

-- =============================================================================================
-- In-match HUD
-- =============================================================================================
local match = Kit.new("Frame", { Name = "Match", BackgroundTransparency = 1, Size = UDim2.fromScale(1, 1), Visible = false, Parent = screen })
local cards = Kit.new("Frame", { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 8), Size = UDim2.fromOffset(620, 70), BackgroundTransparency = 1, Parent = match })
Kit.new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, HorizontalAlignment = Enum.HorizontalAlignment.Center, Padding = UDim.new(0, 16), Parent = cards })
local banner = Kit.label("", 30, { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 92), Size = UDim2.new(0.8, 0, 0, 40), Parent = match })
local hint = Kit.label("", 20, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -20), Size = UDim2.new(0.8, 0, 0, 30), Parent = match })
local meterBack = Kit.new("Frame", { AnchorPoint = Vector2.new(1, 0.5), Position = UDim2.new(1, -24, 0.5, 0), Size = UDim2.fromOffset(34, 260), BackgroundColor3 = Kit.PANEL, Visible = false, Parent = match })
Kit.round(meterBack, 12)
Kit.stroke(meterBack, Kit.INK, 3)
local meter = Kit.new("Frame", { AnchorPoint = Vector2.new(0, 1), Position = UDim2.fromScale(0, 1), Size = UDim2.fromScale(1, 0), BackgroundColor3 = Kit.GREEN, Parent = meterBack })
Kit.round(meter, 12)
Kit.button("Leave", Kit.RED, function()
	ask("leave")
end, { AnchorPoint = Vector2.new(1, 1), Position = UDim2.new(1, -16, 1, -16), Size = UDim2.fromOffset(120, 48), Parent = match })
Kit.button("View", Kit.BLUE, function()
	Aim.topView = not Aim.topView
end, { AnchorPoint = Vector2.new(1, 1), Position = UDim2.new(1, -146, 1, -16), Size = UDim2.fromOffset(110, 48), Parent = match })

Aim.onPower = function(power)
	meterBack.Visible = power ~= nil
	if power then
		meter.Size = UDim2.fromScale(1, power)
		meter.BackgroundColor3 = Kit.GREEN:Lerp(Kit.RED, power)
	end
end

local function seatCard(seat, active: boolean)
	local c = Kit.new("Frame", { Size = UDim2.fromOffset(280, 66), BackgroundColor3 = active and Kit.ORANGE or Kit.PANEL, Parent = cards })
	Kit.round(c, 16)
	Kit.stroke(c, active and Kit.GOLD or Kit.INK, active and 4 or 3)
	Kit.preview(seat.marble, c, UDim2.fromOffset(60, 60)).Position = UDim2.fromOffset(4, 3)
	Kit.label(seat.name .. (seat.bot and (" (" .. seat.bot .. ")") or ""), 20, { Position = UDim2.fromOffset(66, 6), Size = UDim2.new(1, -130, 0, 26), TextXAlignment = Enum.TextXAlignment.Left, TextTruncate = Enum.TextTruncate.AtEnd, Parent = c })
	Kit.label(tostring(seat.score), 40, { Position = UDim2.new(1, -64, 0, 10), Size = UDim2.fromOffset(56, 46), Parent = c })
end

local timerConn: RBXScriptConnection? = nil
local function onState(state)
	inMatch = state.phase ~= "over"
	match.Visible = true
	hud.Visible = false
	for _, p in pairs(panels) do
		p.Visible = false
	end
	queued = false
	Aim.set(state)
	for _, c in ipairs(cards:GetChildren()) do
		if c:IsA("Frame") then
			c:Destroy()
		end
	end
	for i, seat in ipairs(state.seats) do
		seatCard(seat, i == state.current and state.phase ~= "over")
	end
	local mine = Aim.mySeat == state.current
	if state.phase == "aim" then
		banner.Text = mine and (state.firstShot and "Your turn!" or "Shoot again!") or (state.seats[state.current].name .. "'s turn")
		hint.Text = mine and (state.firstShot and "Move to pick your spot on the line, then press, pull back and let go" or "Press, pull back and let go") or ""
	end
	if timerConn then
		timerConn:Disconnect()
	end
	if state.phase == "aim" and mine then
		timerConn = game:GetService("RunService").Heartbeat:Connect(function()
			local left = math.max(0, math.floor((state.turnEnds or 0) - workspace:GetServerTimeNow()))
			if left <= 10 then
				banner.Text = string.format("%s  %ds", state.firstShot and "Your turn!" or "Shoot again!", left)
			end
		end)
	end
end

Aim.onShot = function()
	hint.Text = ""
	if timerConn then
		timerConn:Disconnect()
		timerConn = nil
	end
end

-- =============================================================================================
-- Results and the Marble Bag reveal
-- =============================================================================================
local resultPanel, resultBody = Kit.panel(screen, "Result", UDim2.fromOffset(520, 380), function()
	Aim.stop()
	match.Visible = false
	hud.Visible = true
end)
local resultTitle = Kit.label("", 44, { Size = UDim2.new(1, 0, 0, 56), Parent = resultBody })
local resultText = Kit.label("", 22, { Position = UDim2.fromOffset(0, 66), Size = UDim2.new(1, 0, 0, 120), TextYAlignment = Enum.TextYAlignment.Top, Parent = resultBody })
Kit.button("Play again", Kit.GREEN, function()
	resultPanel.Visible = false
	Aim.stop()
	match.Visible = false
	hud.Visible = true
	if lastPlay then
		task.delay(0.3, play, lastPlay)
	end
end, { AnchorPoint = Vector2.new(0, 1), Position = UDim2.new(0, 10, 1, -6), Size = UDim2.new(0.46, 0, 0, 60), Parent = resultBody })
Kit.button("Lobby", Kit.BLUE, function()
	resultPanel.Visible = false
	Aim.stop()
	match.Visible = false
	hud.Visible = true
end, { AnchorPoint = Vector2.new(1, 1), Position = UDim2.new(1, -10, 1, -6), Size = UDim2.new(0.46, 0, 0, 60), Parent = resultBody })

local function onResult(r)
	inMatch = false
	meterBack.Visible = false
	banner.Text = ""
	hint.Text = ""
	resultTitle.Text = r.abandoned and (r.won and "They left: you win!" or "You left") or r.draw and "Draw!" or r.won and "You win!" or "You lose"
	resultTitle.TextColor3 = r.won and Kit.GOLD or Kit.CREAM
	local lines = { string.format("Score  %s", table.concat(r.scores, " - ")), string.format("+%d coins", r.coins) }
	if r.mode == "tower" then
		table.insert(lines, r.won and string.format("Floor %d cleared!", r.floor) or string.format("Floor %d: try again", r.floor))
	end
	if r.unlocked then
		table.insert(lines, "Unlocked: " .. Config.MARBLE[r.unlocked].name .. "!")
	end
	resultText.Text = table.concat(lines, "\n")
	Kit.open(resultPanel)
end

local revealPanel, revealBody = Kit.panel(screen, "Marble Bag", UDim2.fromOffset(460, 440))
local revealHolder = Kit.new("Frame", { Size = UDim2.new(1, 0, 0, 220), BackgroundTransparency = 1, Parent = revealBody })
local revealText = Kit.label("", 30, { Position = UDim2.fromOffset(0, 230), Size = UDim2.new(1, 0, 0, 90), Parent = revealBody })

local function onBag(got)
	for _, c in ipairs(revealHolder:GetChildren()) do
		c:Destroy()
	end
	local look = Config.MARBLE[got.id]
	Kit.preview(got.id, revealHolder)
	local line = look.name .. "\n" .. look.rarity
	if got.serial then
		line = string.format("%s\nLimited #%d of %d", look.name, got.serial, look.supply)
	elseif got.duplicate then
		line = string.format("%s (duplicate)\n+%d coins", look.name, got.duplicate)
	end
	revealText.Text = line
	revealText.TextColor3 = Config.RARITY_COLOR[look.rarity] or Kit.CREAM
	Kit.open(revealPanel)
end

-- =============================================================================================
-- Server events
-- =============================================================================================
Remotes:WaitForChild("ProfileSync").OnClientEvent:Connect(function(p)
	if not p then
		return
	end
	profile = p
	coinText.Text = tostring(p.coins)
	towerLabel.Text = p.tower > #Config.TOWER and "Conquered!" or string.format("Floor %d of %d: %s", p.tower, #Config.TOWER, Config.TOWER[p.tower].name)
	dailyButton.Text = p.dailyReady and "Daily!" or "Daily"
	if panels.shop.Visible then
		refreshShop()
	end
	if panels.marbles.Visible then
		refreshCollection()
	end
end)

Remotes:WaitForChild("Notify").OnClientEvent:Connect(toast)

Remotes:WaitForChild("BagOpened").OnClientEvent:Connect(onBag)

Remotes:WaitForChild("TableEvent").OnClientEvent:Connect(function(kind, data, id)
	if kind == "state" then
		onState(data)
	elseif kind == "result" then
		onResult(data)
	elseif kind == "capture" then
		local mine = data.seat == Aim.mySeat
		banner.Text = mine and "Got one!" or "Captured!"
	elseif kind == "shootAgain" then
		banner.Text = data.seat == Aim.mySeat and "Shoot again!" or "They shoot again"
	elseif kind == "shooterOut" and data.seat == Aim.mySeat then
		hint.Text = "Your marble left the ring: turn over"
	end
end)

-- Bags bought with coins come back through the request, Robux ones through BagOpened.
local oldAsk = ask
ask = function(action, args)
	local a, b = oldAsk(action, args)
	if action == "bag" and a and b then
		onBag(b)
	end
	return a, b
end

-- VIP tag in chat.
TextChatService.OnIncomingMessage = function(message: TextChatMessage)
	local props = Instance.new("TextChatMessageProperties")
	if message.TextSource then
		local from = Players:GetPlayerByUserId(message.TextSource.UserId)
		if from and from:GetAttribute("VIP") then
			props.PrefixText = "<font color='#FFC83C'>[VIP]</font> " .. message.PrefixText
		end
	end
	return props
end

Aim.start()
task.spawn(function()
	local info = ask("profile")
	if info then
		shopInfo = info
		if info.profile then
			profile = info.profile
			coinText.Text = tostring(profile.coins)
		end
	end
end)

-- On a phone the side buttons sit a little lower so thumbs reach them.
if UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled then
	side.Position = UDim2.new(0, 12, 0.5, -120)
end
