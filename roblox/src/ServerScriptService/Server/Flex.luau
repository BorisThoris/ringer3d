-- Flex: what players show off, and the classic Roblox hooks that bring them (and their friends)
-- back.
--
-- * Auras: every level tier lights the player up for the whole server (sparks at Lv 5, a glow at
--   10, rising stars at 20, a blaze at 35, a prism at 50). The race record holder and this week's
--   leader wear a crown. Everyone can see what you've earned from across the lobby.
-- * Friend boost: +10% coins for each friend playing in the same server (up to +30%), so inviting
--   friends pays.
-- * Codes: promo codes typed into the Gifts panel, each once per player, saved in the profile.
--
-- The rules are plain functions (auraFor, redeem, friendBoost) the tests check without players.

local Players = game:GetService("Players")

local Data = require(script.Parent.Data)
local Economy = require(script.Parent.Economy)

local Flex = {}

-- ---- Auras ---------------------------------------------------------------------------------------

Flex.AURAS = {
	{ level = 5, name = "Spark" },
	{ level = 10, name = "Glow" },
	{ level = 20, name = "Stars" },
	{ level = 35, name = "Blaze" },
	{ level = 50, name = "Prism" },
}

--- The aura for a level (nil below the first tier).
function Flex.auraFor(level: number): string?
	local name = nil
	for _, a in ipairs(Flex.AURAS) do
		if level >= a.level then
			name = a.name
		end
	end
	return name
end

local SPARKLE = "rbxasset://textures/particles/sparkles_main.dds"
local FIRE = "rbxasset://textures/particles/fire_main.dds"

local function emitter(parent: Instance, props: { [string]: any })
	local e = Instance.new("ParticleEmitter")
	e.Texture = SPARKLE
	e.LightEmission = 1
	e.LockedToPart = false
	for k, v in pairs(props) do
		(e :: any)[k] = v
	end
	e.Parent = parent
	return e
end

local function seq(...: Color3): ColorSequence
	local cs = { ... }
	if #cs == 1 then
		return ColorSequence.new(cs[1])
	end
	local keys = {}
	for i, c in ipairs(cs) do
		table.insert(keys, ColorSequenceKeypoint.new((i - 1) / (#cs - 1), c))
	end
	return ColorSequence.new(keys)
end

local function light(parent: Instance, color: Color3, range: number, brightness: number)
	local l = Instance.new("PointLight")
	l.Color = color
	l.Range = range
	l.Brightness = brightness
	l.Parent = parent
end

local RGB = Color3.fromRGB
-- Each aura's look: emitters (and a light) on an attachment at the character's feet.
Flex.STYLES = {
	Spark = function(at)
		emitter(at, { Color = seq(RGB(255, 255, 255)), Size = NumberSequence.new(0.25, 0), Rate = 8, Lifetime = NumberRange.new(0.8, 1.4), Speed = NumberRange.new(1.5, 3), SpreadAngle = Vector2.new(180, 180) })
	end,
	Glow = function(at)
		emitter(at, { Color = seq(RGB(120, 210, 255)), Size = NumberSequence.new(0.4, 0), Rate = 14, Lifetime = NumberRange.new(1, 1.6), Speed = NumberRange.new(2, 4), SpreadAngle = Vector2.new(180, 180) })
		light(at, RGB(120, 210, 255), 10, 1.2)
	end,
	Stars = function(at)
		emitter(at, { Color = seq(RGB(200, 140, 255), RGB(255, 220, 120)), Size = NumberSequence.new(0.6, 0), Rate = 18, Lifetime = NumberRange.new(1.4, 2), Speed = NumberRange.new(3, 5), Acceleration = Vector3.new(0, 4, 0), SpreadAngle = Vector2.new(40, 40), EmissionDirection = Enum.NormalId.Top })
		light(at, RGB(200, 140, 255), 12, 1.5)
	end,
	Blaze = function(at)
		emitter(at, { Texture = FIRE, Color = seq(RGB(255, 220, 90), RGB(255, 90, 40)), Size = NumberSequence.new(1.6, 0.2), Transparency = NumberSequence.new(0.2, 1), Rate = 26, Lifetime = NumberRange.new(0.6, 1), Speed = NumberRange.new(4, 7), SpreadAngle = Vector2.new(20, 20), EmissionDirection = Enum.NormalId.Top })
		light(at, RGB(255, 150, 60), 14, 2)
	end,
	Prism = function(at)
		emitter(at, { Color = seq(RGB(255, 80, 80), RGB(255, 220, 60), RGB(80, 255, 140), RGB(80, 160, 255), RGB(220, 90, 255)), Size = NumberSequence.new(0.8, 0), Rate = 34, Lifetime = NumberRange.new(1.2, 2), Speed = NumberRange.new(3, 6), Acceleration = Vector3.new(0, 3, 0), SpreadAngle = Vector2.new(180, 180), RotSpeed = NumberRange.new(-90, 90) })
		light(at, RGB(255, 255, 255), 16, 2.2)
	end,
	-- The shop's auras.
	Frost = function(at)
		emitter(at, { Color = seq(RGB(220, 245, 255), RGB(140, 210, 255)), Size = NumberSequence.new(0.5, 0.1), Rate = 22, Lifetime = NumberRange.new(1.5, 2.2), Speed = NumberRange.new(1, 2), Acceleration = Vector3.new(0, -1, 0), SpreadAngle = Vector2.new(180, 180), RotSpeed = NumberRange.new(-60, 60) })
		light(at, RGB(170, 230, 255), 12, 1.4)
	end,
	Toxic = function(at)
		emitter(at, { Texture = "rbxasset://textures/particles/smoke_main.dds", Color = seq(RGB(140, 255, 90), RGB(60, 200, 60)), Size = NumberSequence.new(1.2, 2.4), Transparency = NumberSequence.new(0.4, 1), Rate = 12, Lifetime = NumberRange.new(1.2, 1.8), Speed = NumberRange.new(2, 3), EmissionDirection = Enum.NormalId.Top, SpreadAngle = Vector2.new(25, 25) })
		emitter(at, { Color = seq(RGB(170, 255, 120)), Size = NumberSequence.new(0.4, 0), Rate = 14, Lifetime = NumberRange.new(1, 1.5), Speed = NumberRange.new(3, 5), EmissionDirection = Enum.NormalId.Top, SpreadAngle = Vector2.new(30, 30) })
		light(at, RGB(120, 255, 90), 12, 1.6)
	end,
	Galaxy = function(at)
		emitter(at, { Texture = "rbxasset://textures/particles/smoke_main.dds", Color = seq(RGB(90, 40, 170), RGB(30, 20, 90)), Size = NumberSequence.new(2, 3), Transparency = NumberSequence.new(0.3, 1), Rate = 10, Lifetime = NumberRange.new(1.5, 2.2), Speed = NumberRange.new(1, 2), SpreadAngle = Vector2.new(180, 180) })
		emitter(at, { Color = seq(RGB(255, 255, 255), RGB(180, 160, 255)), Size = NumberSequence.new(0.35, 0), Rate = 30, Lifetime = NumberRange.new(1.5, 2.5), Speed = NumberRange.new(2, 4), SpreadAngle = Vector2.new(180, 180) })
		light(at, RGB(150, 110, 255), 14, 1.8)
	end,
	Inferno = function(at)
		emitter(at, { Texture = FIRE, Color = seq(RGB(255, 240, 150), RGB(255, 60, 20), RGB(120, 0, 0)), Size = NumberSequence.new(2.4, 0.4), Transparency = NumberSequence.new(0.1, 1), Rate = 40, Lifetime = NumberRange.new(0.8, 1.3), Speed = NumberRange.new(6, 10), SpreadAngle = Vector2.new(25, 25), EmissionDirection = Enum.NormalId.Top })
		emitter(at, { Texture = "rbxasset://textures/particles/smoke_main.dds", Color = seq(RGB(60, 40, 40)), Size = NumberSequence.new(2, 4), Transparency = NumberSequence.new(0.5, 1), Rate = 8, Lifetime = NumberRange.new(1.5, 2), Speed = NumberRange.new(6, 8), EmissionDirection = Enum.NormalId.Top })
		light(at, RGB(255, 100, 40), 18, 2.5)
	end,
	Celestial = function(at)
		emitter(at, { Color = seq(RGB(255, 250, 220), RGB(255, 215, 90)), Size = NumberSequence.new(1, 0), LightEmission = 1, Rate = 40, Lifetime = NumberRange.new(1.5, 2.5), Speed = NumberRange.new(4, 7), Acceleration = Vector3.new(0, 5, 0), SpreadAngle = Vector2.new(180, 180), RotSpeed = NumberRange.new(-120, 120) })
		emitter(at, { Color = seq(RGB(255, 80, 80), RGB(255, 220, 60), RGB(80, 255, 140), RGB(80, 160, 255), RGB(220, 90, 255)), Size = NumberSequence.new(0.5, 0), Rate = 24, Lifetime = NumberRange.new(2, 3), Speed = NumberRange.new(1, 2), SpreadAngle = Vector2.new(180, 180) })
		light(at, RGB(255, 240, 200), 22, 3)
	end,
}

--- Dress a character's root in its aura (and crown); replaces whatever it wore.
function Flex.dress(character: Model, aura: string?, crown: boolean, main: boolean?)
	local root = character:FindFirstChild("HumanoidRootPart") :: BasePart?
	local head = character:FindFirstChild("Head") :: BasePart?
	if not root then
		return
	end
	for _, name in ipairs({ "Aura", "AuraPillarTop" }) do
		local old = root:FindFirstChild(name)
		if old then
			old:Destroy()
		end
	end
	if head and head:FindFirstChild("Crown") then
		(head :: any).Crown:Destroy()
	end
	if head and head:FindFirstChild("MainCharacter") then
		(head :: any).MainCharacter:Destroy()
	end
	local at = Instance.new("Attachment")
	at.Name = "Aura"
	at.Position = Vector3.new(0, -1.5, 0)
	at.Parent = root
	local style = aura and Flex.STYLES[aura]
	if style then
		style(at)
	end
	if crown and head then
		local g = Instance.new("BillboardGui")
		g.Name = "Crown"
		g.Size = UDim2.fromOffset(70, 70)
		g.StudsOffset = Vector3.new(0, 5.6, 0)
		g.LightInfluence = 0
		g.MaxDistance = 140
		g.Parent = head
		local t = Instance.new("TextLabel")
		t.BackgroundTransparency = 1
		t.Size = UDim2.fromScale(1, 1)
		t.TextScaled = true
		t.Text = "👑"
		t.Parent = g
		emitter(at, { Color = seq(RGB(255, 215, 80)), Size = NumberSequence.new(0.5, 0), Rate = 20, Lifetime = NumberRange.new(1, 1.6), Speed = NumberRange.new(2, 4), SpreadAngle = Vector2.new(180, 180) })
	end
	-- The server's Main Character (most aura): a pillar of light and a title everyone can see.
	if main then
		-- Saturated gold, little light emission: white additive sparks vanish against a bright sky
		-- (seen in the first play-mode check).
		emitter(at, { Color = seq(RGB(255, 214, 70), RGB(255, 140, 30)), LightEmission = 0.35, Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, 2), NumberSequenceKeypoint.new(1, 0.4) }), Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.05), NumberSequenceKeypoint.new(0.7, 0.3), NumberSequenceKeypoint.new(1, 1) }), Rate = 70, Lifetime = NumberRange.new(1.3, 1.9), Speed = NumberRange.new(9, 14), SpreadAngle = Vector2.new(4, 4), EmissionDirection = Enum.NormalId.Top })
		-- A gold ring round the feet.
		emitter(at, { Color = seq(RGB(255, 225, 90)), LightEmission = 0.3, Size = NumberSequence.new(0.8, 0), Rate = 50, Lifetime = NumberRange.new(0.6, 0.9), Speed = NumberRange.new(5, 6), SpreadAngle = Vector2.new(0, 180), EmissionDirection = Enum.NormalId.Right, Acceleration = Vector3.new(0, 2, 0) })
		light(at, RGB(255, 210, 110), 14, 1.5) -- brighter washed the whole lobby yellow
		-- The pillar itself: a beam from the feet into the sky. Particle counts drop with graphics
		-- quality (the play-mode check saw two sparks); a beam always draws.
		local top = Instance.new("Attachment")
		top.Name = "AuraPillarTop"
		top.Position = Vector3.new(0, 32.5, 0)
		top.Parent = root
		local beam = Instance.new("Beam")
		beam.Attachment0 = at
		beam.Attachment1 = top
		beam.FaceCamera = true
		beam.Width0 = 3.2
		beam.Width1 = 0.6
		beam.LightEmission = 0.5
		beam.LightInfluence = 0
		beam.Color = seq(RGB(255, 225, 110), RGB(255, 160, 40))
		beam.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.25), NumberSequenceKeypoint.new(0.6, 0.55), NumberSequenceKeypoint.new(1, 1) })
		beam.Parent = at
		if head then
			local g = Instance.new("BillboardGui")
			g.Name = "MainCharacter"
			-- In studs, so it reads as a sign over them at any screen size.
			g.Size = UDim2.fromScale(11, 1.6)
			g.StudsOffset = Vector3.new(0, if crown then 8 else 6.2, 0)
			g.LightInfluence = 0
			g.MaxDistance = 160
			g.Parent = head
			local t = Instance.new("TextLabel")
			t.BackgroundTransparency = 1
			t.Size = UDim2.fromScale(1, 1)
			t.TextScaled = true
			t.Font = Enum.Font.FredokaOne
			t.Text = "⭐ MAIN CHARACTER ⭐"
			t.TextColor3 = RGB(255, 255, 255)
			t.Parent = g
			local grad = Instance.new("UIGradient")
			grad.Rotation = 90
			grad.Color = seq(RGB(255, 245, 170), RGB(255, 170, 40))
			grad.Parent = t
			local stroke = Instance.new("UIStroke")
			stroke.Thickness = 3
			stroke.Color = RGB(80, 40, 0)
			stroke.Parent = t
		end
	end
end

-- ---- The aura shop -------------------------------------------------------------------------------
-- Auras for coins: a coin sink that shows. Level auras stay free once their level is reached; a
-- player wears any aura they own or have unlocked, or none.
Flex.SHOP = {
	{ name = "Frost", price = 2500 },
	{ name = "Toxic", price = 6000 },
	{ name = "Galaxy", price = 15000 },
	{ name = "Inferno", price = 40000 },
	{ name = "Celestial", price = 100000 },
}
local SHOP_PRICE = {}
for _, a in ipairs(Flex.SHOP) do
	SHOP_PRICE[a.name] = a.price
end

--- Can profile `p` at `level` wear `name`?
function Flex.canWear(p: any, level: number, name: string): boolean
	if SHOP_PRICE[name] then
		return (p.auras or {})[name] == true
	end
	for _, a in ipairs(Flex.AURAS) do
		if a.name == name then
			return level >= a.level
		end
	end
	return false
end

--- What profile `p` at `level` wears: its pick if it can, "none" for none, else its level's aura.
function Flex.choose(p: any, level: number): string?
	local pick = p.auraPick
	if pick == "none" then
		return nil
	end
	if pick and Flex.canWear(p, level, pick) then
		return pick
	end
	return Flex.auraFor(level)
end

--- Buy a shop aura for profile `p` with `coins`: ok, or why not. (Spending is the caller's.)
function Flex.buyCheck(p: any, name: any): (boolean, any)
	local price = typeof(name) == "string" and SHOP_PRICE[name]
	if not price then
		return false, "That aura isn't for sale."
	end
	if (p.auras or {})[name] then
		return false, "You already own it."
	end
	if (p.coins or 0) < price then
		return false, string.format("You need %d more coins.", price - (p.coins or 0))
	end
	return true, price
end

-- Who wears the crown: set by the race's boards (Flex.start's refresher).
Flex.crowned = {} :: { [number]: boolean }

function Flex.refresh(player: Player)
	local level = player:GetAttribute("Level") or 1
	local p = Data.get(player)
	local aura = if p then Flex.choose(p, level) else Flex.auraFor(level)
	local crown = Flex.crowned[player.UserId] == true
	local main = Flex.mainId == player.UserId
	player:SetAttribute("Aura", aura)
	player:SetAttribute("Crown", crown or nil)
	player:SetAttribute("MainCharacter", main or nil)
	if player.Character then
		Flex.dress(player.Character, aura, crown, main)
	end
end

-- The server's Main Character: the UserId with the most aura (set by Main from Aura.mainOf).
Flex.mainId = nil :: number?
--- Hand the Main Character title to `id` (or nobody); redresses whoever gained or lost it.
function Flex.setMain(id: number?): boolean
	if Flex.mainId == id then
		return false
	end
	local was = Flex.mainId
	Flex.mainId = id
	for _, p in ipairs(Players:GetPlayers()) do
		if p.UserId == was or p.UserId == id then
			Flex.refresh(p)
		end
	end
	return true
end

function Flex.auraShop(player: Player): any
	local p = Data.get(player)
	if not p then
		return nil
	end
	local level = player:GetAttribute("Level") or 1
	return { shop = Flex.SHOP, levels = Flex.AURAS, owned = p.auras or {}, pick = p.auraPick, wearing = Flex.choose(p, level), level = level }
end

function Flex.buyAura(player: Player, name: any): (boolean, any)
	local p = Data.get(player)
	if not p then
		return false, "Your profile is still loading."
	end
	local ok, res = Flex.buyCheck(p, name)
	if not ok then
		return false, res
	end
	if not Economy.spend(player, res, "aura:" .. name) then
		return false, "Not enough coins."
	end
	Data.update(player, function(pp)
		pp.auras = pp.auras or {}
		pp.auras[name] = true
		pp.auraPick = name
	end)
	Flex.refresh(player)
	return true, Flex.auraShop(player)
end

function Flex.pickAura(player: Player, name: any): (boolean, any)
	local p = Data.get(player)
	if not p or typeof(name) ~= "string" then
		return false, "Which aura?"
	end
	local level = player:GetAttribute("Level") or 1
	if name ~= "none" and not Flex.canWear(p, level, name) then
		return false, "You haven't unlocked that aura yet."
	end
	Data.update(player, function(pp)
		pp.auraPick = name
	end)
	Flex.refresh(player)
	return true, Flex.auraShop(player)
end

-- ---- Friend boost --------------------------------------------------------------------------------

Flex.FRIEND_BONUS = 0.1
Flex.FRIEND_MAX = 3

--- The coin multiplier for this many friends in the server.
function Flex.friendBoost(friends: number): number
	return 1 + math.min(friends, Flex.FRIEND_MAX) * Flex.FRIEND_BONUS
end

local friendCache: { [string]: boolean } = {}
local function areFriends(a: Player, b: Player): boolean
	local key = math.min(a.UserId, b.UserId) .. ":" .. math.max(a.UserId, b.UserId)
	if friendCache[key] == nil then
		local ok, yes = pcall(a.IsFriendsWith, a, b.UserId)
		friendCache[key] = ok and yes == true
	end
	return friendCache[key]
end

local function recountFriends()
	local all = Players:GetPlayers()
	for _, p in ipairs(all) do
		local n = 0
		for _, q in ipairs(all) do
			if q ~= p and areFriends(p, q) then
				n += 1
			end
		end
		Economy.friends[p] = n
		p:SetAttribute("Friends", if n > 0 then n else nil)
	end
end

-- ---- Codes ---------------------------------------------------------------------------------------

-- Code -> reward. Upper case; players' typing is trimmed and upper-cased. Retire one by giving it
-- `expired = true` (it then says so instead of "not a code").
Flex.CODES = {
	RINGER = { coins = 150 },
	MARBLES = { coins = 200 },
	MOUNTAIN = { coins = 300 },
	GOLDRUSH = { coins = 500 },
}

--- Redeem `raw` against profile `p` (marks it used). Returns ok and the coins, or why not.
function Flex.redeem(p: any, raw: any): (boolean, any)
	if typeof(raw) ~= "string" or #raw > 40 then
		return false, "That's not a code."
	end
	local code = string.upper((raw:gsub("^%s+", ""):gsub("%s+$", "")))
	local c = Flex.CODES[code]
	if not c then
		return false, "That's not a code."
	end
	if c.expired then
		return false, "That code has expired."
	end
	p.codes = p.codes or {}
	if p.codes[code] then
		return false, "You've already used that code."
	end
	p.codes[code] = true
	return true, c.coins
end

--- The request handler: redeem for a player and pay out (codes aren't multiplied).
function Flex.redeemFor(player: Player, raw: any): (boolean, any)
	local p = Data.get(player)
	if not p then
		return false, "Your profile is still loading."
	end
	local ok, res = false, nil
	Data.update(player, function(pp)
		ok, res = Flex.redeem(pp, raw)
	end)
	if not ok then
		return false, res
	end
	return true, { coins = Economy.give(player, res, "code", true) }
end

-- ---- Daily spin --------------------------------------------------------------------------------

-- The wheel, in order round it: { weight, kind, amount }. Coins are multiplied like any earned
-- coins; "double" is 15 minutes of double coins; "bag" opens a Marble Bag (coins where bags are
-- restricted).
Flex.WHEEL = {
	{ 30, "coins", 25 },
	{ 22, "coins", 50 },
	{ 8, "double", 900 },
	{ 18, "coins", 100 },
	{ 5, "bag", 0 },
	{ 10, "coins", 250 },
	{ 4, "coins", 500 },
	{ 3, "coins", 1000 },
}
Flex.SPIN_EVERY = 20 * 3600 -- a little under a day, so the same time tomorrow always works

--- Seconds until the next free spin for profile `p` (0 when ready).
function Flex.spinLeft(p: any, now: number): number
	return math.max(0, (p.lastSpin or 0) + Flex.SPIN_EVERY - now)
end

--- Spin for profile `p` (marks the time): the segment won, or false and the seconds left.
function Flex.spin(p: any, now: number, rng: Random): (any, number)
	local left = Flex.spinLeft(p, now)
	if left > 0 then
		return false, left
	end
	local total = 0
	for _, w in ipairs(Flex.WHEEL) do
		total += w[1]
	end
	local roll = rng:NextNumber() * total
	local pick = #Flex.WHEEL
	for i, w in ipairs(Flex.WHEEL) do
		roll -= w[1]
		if roll < 0 then
			pick = i
			break
		end
	end
	p.lastSpin = now
	return pick, 0
end

--- The request handler: spin and pay out. Returns the segment, what it gave, and the next spin.
function Flex.spinFor(player: Player, collectibles: any): (boolean, any)
	if not Data.get(player) then
		return false, "Your profile is still loading."
	end
	local pick, left = false, 0
	Data.update(player, function(pp)
		pick, left = Flex.spin(pp, os.time(), Random.new())
	end)
	if not pick then
		return false, { left = left }
	end
	local seg = Flex.WHEEL[pick]
	local out: any = { segment = pick, kind = seg[2], left = Flex.SPIN_EVERY }
	if seg[2] == "coins" then
		out.coins = Economy.give(player, seg[3], "spin")
	elseif seg[2] == "double" then
		Data.update(player, function(pp)
			pp.boostUntil = math.max(pp.boostUntil or 0, os.time()) + seg[3]
		end)
		out.seconds = seg[3]
	elseif seg[2] == "bag" then
		local got = if collectibles.bagsRestricted(player) then nil else collectibles.openBag(player, Random.new())
		if got then
			out.bag = got
		else
			out.kind = "coins"
			out.coins = Economy.give(player, 300, "spin")
		end
	end
	return true, out
end

function Flex.spinInfo(player: Player): any
	local p = Data.get(player)
	local boost = p and math.max(0, (p.boostUntil or 0) - os.time()) or 0
	return { left = if p then Flex.spinLeft(p, os.time()) else Flex.SPIN_EVERY, wheel = Flex.WHEEL, boost = boost, favorited = p ~= nil and p.favorited == true }
end

-- ---- Favourite ------------------------------------------------------------------------------------

--- The client asked the player to favourite the game: remember it, so it never asks again. (No
--- reward: paying for favourites is the kind of incentive Roblox's rules restrict.)
function Flex.favoriteAsked(player: Player): boolean
	if Data.get(player) then
		Data.update(player, function(pp)
			pp.favorited = true
		end)
	end
	return true
end

-- ---- Wiring --------------------------------------------------------------------------------------

--- Start: auras follow levels and characters; the crown follows `leaders()` (user ids), checked
--- every minute; friend counts follow joins and leaves.
function Flex.start(leaders: () -> { number })
	local function watch(player: Player)
		player:GetAttributeChangedSignal("Level"):Connect(function()
			Flex.refresh(player)
		end)
		player.CharacterAdded:Connect(function()
			task.wait(0.6)
			Flex.refresh(player)
		end)
		if player.Character then
			Flex.refresh(player)
		end
		task.spawn(recountFriends)
	end
	for _, p in ipairs(Players:GetPlayers()) do
		watch(p)
	end
	Players.PlayerAdded:Connect(watch)
	Players.PlayerRemoving:Connect(function(p)
		Economy.friends[p] = nil
		task.defer(recountFriends)
	end)
	task.spawn(function()
		while true do
			local ok, ids = pcall(leaders)
			if ok and typeof(ids) == "table" then
				local now = {}
				for _, id in ipairs(ids) do
					now[id] = true
				end
				local changed = false
				for id in pairs(now) do
					changed = changed or not Flex.crowned[id]
				end
				for id in pairs(Flex.crowned) do
					changed = changed or not now[id]
				end
				Flex.crowned = now
				if changed then
					for _, p in ipairs(Players:GetPlayers()) do
						Flex.refresh(p)
					end
				end
			end
			task.wait(60)
		end
	end)
end

return Flex
