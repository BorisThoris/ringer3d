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
local Forge = require(ReplicatedStorage.Ringer.Forge)
local MarbleLook = require(ReplicatedStorage.Ringer.MarbleLook)
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
local coinText = Kit.label("0", 30, { Position = UDim2.fromOffset(48, 5), Size = UDim2.new(1, -56, 0, 40), TextXAlignment = Enum.TextXAlignment.Left, Parent = coinPill })
Kit.gradient(coinText, Color3.fromRGB(255, 250, 170), Kit.GOLD)
local shownCoins: number? = nil
-- Coins count up to the new total, with a "+N" when they grow.
local function setCoins(n: number)
	local from = shownCoins
	shownCoins = n
	if from == nil or n <= from then
		coinText.Text = Kit.comma(n)
		return
	end
	Kit.popup(screen, "+" .. Kit.comma(n - from), UDim2.new(0.5, 40, 0, 90))
	local v = Instance.new("NumberValue")
	v.Value = from
	v.Changed:Connect(function(x)
		coinText.Text = Kit.comma(x)
	end)
	local tw = TweenService:Create(v, TweenInfo.new(0.8, Enum.EasingStyle.Quad), { Value = n })
	tw.Completed:Connect(function()
		v:Destroy()
	end)
	tw:Play()
end

-- The live event, under the coins.
local event = Kit.label(string.format("✨ NEW: every Marble Bag mints a one-of-a-kind marble · %.1f%% hold a phenomenon", Forge.phenomenonOdds()), 20, { AnchorPoint = Vector2.new(0.5, 0), Position = UDim2.new(0.5, 0, 0, 62), Size = UDim2.fromOffset(620, 28), TextColor3 = Color3.fromRGB(255, 170, 60), Parent = hud })
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
			table.insert(odds, string.format("%s %g%%", t.rarity, t.weight))
		end
		table.insert(odds, string.format("✦ Phenomenon %.1f%% · Shiny %g%%", Forge.phenomenonOdds(), 100 / Forge.SHINY_ODDS))
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
				local lc = itemCard(bagsPage, look.name, string.format("Marble Book reward · %d of %d left", math.max(0, left), look.supply), Config.RARITY_COLOR.Limited)
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
-- What melting a generated marble pays (the server's Collectibles.meltValue, the web's meltValue).
local function meltValue(c): number
	local wear = if c.wear == "Mint" then 2 elseif c.wear == "Polished" then 1.25 else 1
	local fx = if c.effect ~= "none" then 4 else 1
	return math.floor(Config.MELT[c.tier] * wear * (if c.shiny then 5 else 1) * fx + 0.5)
end
local onBag -- the bag reveal, defined further down

local colPanel, colBody = Kit.panel(screen, "Your Marbles", UDim2.fromScale(0.8, 0.8))
panels.marbles = colPanel
local colTabs = Kit.new("Frame", { Size = UDim2.new(1, 0, 0, 50), BackgroundTransparency = 1, Parent = colBody })
Kit.new("UIListLayout", { FillDirection = Enum.FillDirection.Horizontal, Padding = UDim.new(0, 10), Parent = colTabs })
local colPages = Kit.new("Frame", { Position = UDim2.fromOffset(0, 60), Size = UDim2.new(1, 0, 1, -60), BackgroundTransparency = 1, Parent = colBody })
local colPageOf = {}
local colTab = "Collection"
local refreshCollection
local function colPage(name: string, cell: Vector2)
	local f = Kit.new("ScrollingFrame", { Name = name, Size = UDim2.fromScale(1, 1), BackgroundTransparency = 1, ScrollBarThickness = 8, AutomaticCanvasSize = Enum.AutomaticSize.Y, CanvasSize = UDim2.new(), Visible = name == colTab, Parent = colPages })
	Kit.new("UIGridLayout", { CellSize = UDim2.fromOffset(cell.X, cell.Y), CellPadding = UDim2.fromOffset(12, 12), SortOrder = Enum.SortOrder.LayoutOrder, Parent = f })
	colPageOf[name] = f
	Kit.button(name, Kit.BLUE, function()
		colTab = name
		for n, p in pairs(colPageOf) do
			p.Visible = n == name
		end
	end, { Size = UDim2.fromOffset(170, 46), Parent = colTabs })
	return f
end
local forgedGrid = colPage("Collection", Vector2.new(180, 300))
local namedGrid = colPage("Named", Vector2.new(170, 230))
local bookGrid = colPage("Marble Book", Vector2.new(340, 150))

-- Collection tools: sort order and trade-up mode.
local sortBy = "new"
local picking = false
local picked: { string } = {}
local function clear(f: Instance)
	for _, c in ipairs(f:GetChildren()) do
		if c:IsA("GuiObject") then
			c:Destroy()
		end
	end
end
local function rarityIndex(t: string): number
	return table.find(Forge.TIERS, t) or 0
end

local function forgedCard(o, c, order: number)
	local look = MarbleLook.lookFor(c.id)
	local color = Config.RARITY_COLOR[c.tier] or Kit.CREAM
	local isOn = profile.equipped == c.id
	local sel = table.find(picked, c.id) ~= nil
	local card = Kit.new("Frame", { LayoutOrder = order, BackgroundColor3 = sel and Color3.fromRGB(90, 70, 40) or Color3.fromRGB(56, 44, 80), Parent = forgedGrid })
	Kit.round(card, 16)
	Kit.stroke(card, color, c.effect ~= "none" and 4 or 3)
	Kit.preview(c.id, card, UDim2.new(1, 0, 0, 110))
	Kit.label(c.marble.name, 17, { Position = UDim2.fromOffset(4, 110), Size = UDim2.new(1, -8, 0, 40), TextWrapped = true, Parent = card })
	local traits = #c.traits > 0 and ("✦ " .. table.concat(c.traits, " · ")) or ""
	Kit.label(c.tier .. (traits ~= "" and ("\n" .. traits) or ""), 15, { Position = UDim2.fromOffset(4, 150), Size = UDim2.new(1, -8, 0, 36), TextColor3 = color, TextWrapped = true, Parent = card })
	Kit.label(string.format("%s %.4f · #%d · %d✕", c.wear, c.float, c.pattern, o.tally or 0), 13, { Position = UDim2.fromOffset(4, 188), Size = UDim2.new(1, -8, 0, 18), TextColor3 = Kit.CREAM, Parent = card })
	if picking then
		Kit.button(sel and "Picked" or "Pick", sel and Kit.GOLD or Kit.PURPLE, function()
			local i = table.find(picked, c.id)
			if i then
				table.remove(picked, i)
			elseif #picked < Forge.TRADE_UP_COUNT and not isOn then
				table.insert(picked, c.id)
			end
			refreshCollection()
		end, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -10), Size = UDim2.new(0.86, 0, 0, 40), Parent = card })
		return
	end
	Kit.button(isOn and "Equipped" or "Equip", isOn and Color3.fromRGB(110, 110, 120) or Kit.GREEN, function()
		ask("equip", c.id)
	end, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -56), Size = UDim2.new(0.86, 0, 0, 38), Parent = card })
	local melt = Kit.button("Melt " .. Kit.comma(meltValue(c)), Kit.RED, function()
		local ok, got = ask("melt", c.id)
		toast(ok and string.format("Melted %s: +%s coins", c.marble.name, Kit.comma(got)) or (typeof(got) == "string" and got or "Couldn't melt it."), ok and "good" or "bad")
	end, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -10), Size = UDim2.new(0.86, 0, 0, 38), Parent = card })
	melt.Visible = not isOn
end

refreshCollection = function()
	for _, f in ipairs({ forgedGrid, namedGrid, bookGrid }) do
		clear(f)
	end
	if not profile then
		return
	end

	-- ---- Collection: the generated marbles ----
	local list = {}
	for _, o in ipairs(profile.forged or {}) do
		local c = Forge.fromId(o.id)
		if c then
			table.insert(list, { o = o, c = c })
		end
	end
	table.sort(list, function(a, b)
		if sortBy == "rarity" then
			local ra, rb = rarityIndex(a.c.tier), rarityIndex(b.c.tier)
			if ra ~= rb then
				return ra > rb
			end
			return a.c.float < b.c.float
		elseif sortBy == "float" then
			return a.c.float < b.c.float
		end
		return (a.o.at or 0) > (b.o.at or 0)
	end)
	-- The tool row: sorting, and trade-ups (five of one rarity make one of the next).
	local bar = Kit.new("Frame", { LayoutOrder = -1, BackgroundColor3 = Color3.fromRGB(40, 30, 60), Parent = forgedGrid })
	Kit.round(bar, 16)
	Kit.new("UIListLayout", { Padding = UDim.new(0, 6), HorizontalAlignment = Enum.HorizontalAlignment.Center, VerticalAlignment = Enum.VerticalAlignment.Center, Parent = bar })
	Kit.label(string.format("%d marbles", #list), 18, { Size = UDim2.new(1, 0, 0, 24), Parent = bar })
	for _, s in ipairs({ { "new", "Newest" }, { "rarity", "Rarity" }, { "float", "Best float" } }) do
		Kit.button(s[2], sortBy == s[1] and Kit.GOLD or Kit.BLUE, function()
			sortBy = s[1]
			refreshCollection()
		end, { Size = UDim2.new(0.86, 0, 0, 34), Parent = bar })
	end
	Kit.button(picking and "Cancel trade-up" or "Trade up", Kit.PURPLE, function()
		picking = not picking
		picked = {}
		refreshCollection()
	end, { Size = UDim2.new(0.86, 0, 0, 34), Parent = bar })
	if picking then
		local tier = nil
		local same = true
		for _, id in ipairs(picked) do
			local c = Forge.fromId(id)
			if tier and c and c.tier ~= tier then
				same = false
			end
			tier = tier or (c and c.tier)
		end
		local up = tier and Forge.nextTier(tier)
		local ready = #picked == Forge.TRADE_UP_COUNT and same and up ~= nil
		Kit.button(ready and ("Make a " .. up) or string.format("%d of %d picked", #picked, Forge.TRADE_UP_COUNT), ready and Kit.GREEN or Color3.fromRGB(110, 110, 120), function()
			if not ready then
				toast(not same and "They all need to be the same rarity." or tier == "Mythic" and "Mythic is the top." or "Pick five of one rarity.", "bad")
				return
			end
			local ok, got = ask("tradeup", picked)
			picking = false
			picked = {}
			if ok then
				onBag(got)
			else
				toast(typeof(got) == "string" and got or "Couldn't trade up.", "bad")
			end
			refreshCollection()
		end, { Size = UDim2.new(0.86, 0, 0, 34), Parent = bar })
	end
	if #list == 0 then
		Kit.label("Open a Marble Bag in the Shop to start your collection. Every match pays coins.", 18, { LayoutOrder = 0, TextWrapped = true, Parent = forgedGrid })
	end
	for i, it in ipairs(list) do
		forgedCard(it.o, it.c, i)
	end

	-- ---- Named marbles: the catalogue ----
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
				or look.supply and "Marble Book reward"
				or "Marble Bags"
		end
		local c = itemCard(namedGrid, owned and look.name or "???", sub, owned and Config.RARITY_COLOR[look.rarity] or Color3.fromRGB(120, 120, 130))
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

	-- ---- The Marble Book ----
	local owned = {}
	for _, it in ipairs(list) do
		table.insert(owned, it.c)
	end
	for i, row in ipairs(Forge.bookProgress(owned)) do
		local paid = profile.book and profile.book[row.set.id]
		local card = Kit.new("Frame", { LayoutOrder = i, BackgroundColor3 = Color3.fromRGB(56, 44, 80), Parent = bookGrid })
		Kit.round(card, 16)
		Kit.stroke(card, row.done and Kit.GOLD or Color3.fromRGB(120, 110, 150), 3)
		local limited = Config.BOOK_LIMITED[row.set.id]
		Kit.label(string.format("%s  %d/%d", row.set.name, #row.got, #row.set.needs), 20, { Position = UDim2.fromOffset(10, 6), Size = UDim2.new(1, -20, 0, 26), Parent = card })
		local missing = {}
		for _, n in ipairs(row.set.needs) do
			if not table.find(row.got, n) then
				table.insert(missing, n)
			end
		end
		Kit.label(#missing == 0 and "Complete!" or ("Still to find: " .. table.concat(missing, ", ")), 14, { Position = UDim2.fromOffset(10, 34), Size = UDim2.new(1, -20, 0, 50), TextWrapped = true, TextColor3 = Kit.CREAM, Parent = card })
		local reward = Kit.comma(row.set.reward) .. " coins" .. (limited and (" + " .. Config.MARBLE[limited].name .. " Limited") or "")
		Kit.button(paid and "Claimed" or (row.done and ("Claim " .. reward) or reward), paid and Color3.fromRGB(110, 110, 120) or row.done and Kit.GREEN or Color3.fromRGB(80, 70, 110), function()
			if paid or not row.done then
				return
			end
			local ok, got = ask("book", row.set.id)
			if ok then
				toast(string.format("%s: +%s coins%s", row.set.name, Kit.comma(got.coins), got.limited and got.limited.serial and string.format(" and %s #%d", Config.MARBLE[got.limited.id].name, got.limited.serial) or ""), "good")
			else
				toast(typeof(got) == "string" and got or "Couldn't claim it.", "bad")
			end
		end, { AnchorPoint = Vector2.new(0.5, 1), Position = UDim2.new(0.5, 0, 1, -10), Size = UDim2.new(0.92, 0, 0, 40), Parent = card })
	end
end

-- =============================================================================================
-- Side buttons
-- =============================================================================================
Kit.button("🛒 Shop", Kit.GOLD, function()
	refreshShop()
	show("shop")
end, { Size = UDim2.fromOffset(150, 58), Parent = side })
Kit.button("🔮 Marbles", Kit.PURPLE, function()
	refreshCollection()
	show("marbles")
end, { Size = UDim2.fromOffset(150, 58), Parent = side })
local dailyButton = Kit.button("🎁 Daily", Kit.GREEN, function()
	local ok, got = ask("daily")
	if ok then
		toast(string.format("Day %d streak: +%d coins!", got.streak, got.coins), "good")
	else
		toast(typeof(got) == "string" and got or "Come back tomorrow!", "info")
	end
end, { Size = UDim2.fromOffset(150, 58), Parent = side })
-- A red "!" on Daily while a reward is waiting.
local dailyBadge = Kit.label("!", 24, { AnchorPoint = Vector2.new(0.5, 0.5), Position = UDim2.new(1, -4, 0, 4), Size = UDim2.fromOffset(30, 30), BackgroundTransparency = 0, BackgroundColor3 = Kit.RED, Visible = false, ZIndex = 5, Parent = dailyButton })
Kit.round(dailyBadge, 15)
Kit.stroke(dailyBadge, Kit.INK, 2)
Kit.button("👋 Invite", Kit.BLUE, function()
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

onBag = function(got)
	for _, c in ipairs(revealHolder:GetChildren()) do
		c:Destroy()
	end
	Kit.preview(got.id, revealHolder)
	local c = Forge.fromId(got.id)
	if c then
		-- A generated marble: its rarity, wear and anything special about it.
		local extra = #c.traits > 0 and ("\n✦ " .. table.concat(c.traits, " · ")) or ""
		revealText.Text = string.format("%s\n%s · %s %.4f%s", c.marble.name, c.tier, c.wear, c.float, extra)
		revealText.TextColor3 = Config.RARITY_COLOR[c.tier] or Kit.CREAM
		Kit.open(revealPanel)
		return
	end
	local look = Config.MARBLE[got.id]
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
	setCoins(p.coins)
	towerLabel.Text = p.tower > #Config.TOWER and "Conquered!" or string.format("Floor %d of %d: %s", p.tower, #Config.TOWER, Config.TOWER[p.tower].name)
	dailyButton.Text = "🎁 Daily"
	dailyBadge.Visible = p.dailyReady == true
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
			setCoins(profile.coins)
		end
	end
end)

-- On a phone the side buttons sit a little lower so thumbs reach them.
if UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled then
	side.Position = UDim2.new(0, 12, 0.5, -120)
end
