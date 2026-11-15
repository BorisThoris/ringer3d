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

--- Dress a character's root in its aura (and crown); replaces whatever it wore.
function Flex.dress(character: Model, aura: string?, crown: boolean)
	local root = character:FindFirstChild("HumanoidRootPart") :: BasePart?
	local head = character:FindFirstChild("Head") :: BasePart?
	if not root then
		return
	end
	local old = root:FindFirstChild("Aura")
	if old then
		old:Destroy()
	end
	if head and head:FindFirstChild("Crown") then
		(head :: any).Crown:Destroy()
	end
	local at = Instance.new("Attachment")
	at.Name = "Aura"
	at.Position = Vector3.new(0, -1.5, 0)
	at.Parent = root
	if aura == "Spark" then
		emitter(at, { Color = seq(Color3.fromRGB(255, 255, 255)), Size = NumberSequence.new(0.25, 0), Rate = 8, Lifetime = NumberRange.new(0.8, 1.4), Speed = NumberRange.new(1.5, 3), SpreadAngle = Vector2.new(180, 180) })
	elseif aura == "Glow" then
		emitter(at, { Color = seq(Color3.fromRGB(120, 210, 255)), Size = NumberSequence.new(0.4, 0), Rate = 14, Lifetime = NumberRange.new(1, 1.6), Speed = NumberRange.new(2, 4), SpreadAngle = Vector2.new(180, 180) })
		local l = Instance.new("PointLight")
		l.Color = Color3.fromRGB(120, 210, 255)
		l.Range = 10
		l.Brightness = 1.2
		l.Parent = at
	elseif aura == "Stars" then
		emitter(at, { Color = seq(Color3.fromRGB(200, 140, 255), Color3.fromRGB(255, 220, 120)), Size = NumberSequence.new(0.6, 0), Rate = 18, Lifetime = NumberRange.new(1.4, 2), Speed = NumberRange.new(3, 5), Acceleration = Vector3.new(0, 4, 0), SpreadAngle = Vector2.new(40, 40), EmissionDirection = Enum.NormalId.Top })
		local l = Instance.new("PointLight")
		l.Color = Color3.fromRGB(200, 140, 255)
		l.Range = 12
		l.Brightness = 1.5
		l.Parent = at
	elseif aura == "Blaze" then
		emitter(at, { Texture = FIRE, Color = seq(Color3.fromRGB(255, 220, 90), Color3.fromRGB(255, 90, 40)), Size = NumberSequence.new(1.6, 0.2), Transparency = NumberSequence.new(0.2, 1), Rate = 26, Lifetime = NumberRange.new(0.6, 1), Speed = NumberRange.new(4, 7), SpreadAngle = Vector2.new(20, 20), EmissionDirection = Enum.NormalId.Top })
		local l = Instance.new("PointLight")
		l.Color = Color3.fromRGB(255, 150, 60)
		l.Range = 14
		l.Brightness = 2
		l.Parent = at
	elseif aura == "Prism" then
		emitter(at, { Color = seq(Color3.fromRGB(255, 80, 80), Color3.fromRGB(255, 220, 60), Color3.fromRGB(80, 255, 140), Color3.fromRGB(80, 160, 255), Color3.fromRGB(220, 90, 255)), Size = NumberSequence.new(0.8, 0), Rate = 34, Lifetime = NumberRange.new(1.2, 2), Speed = NumberRange.new(3, 6), Acceleration = Vector3.new(0, 3, 0), SpreadAngle = Vector2.new(180, 180), RotSpeed = NumberRange.new(-90, 90) })
		local l = Instance.new("PointLight")
		l.Color = Color3.fromRGB(255, 255, 255)
		l.Range = 16
		l.Brightness = 2.2
		l.Parent = at
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
		emitter(at, { Color = seq(Color3.fromRGB(255, 215, 80)), Size = NumberSequence.new(0.5, 0), Rate = 20, Lifetime = NumberRange.new(1, 1.6), Speed = NumberRange.new(2, 4), SpreadAngle = Vector2.new(180, 180) })
	end
end

-- Who wears the crown: set by the race's boards (Flex.start's refresher).
Flex.crowned = {} :: { [number]: boolean }

function Flex.refresh(player: Player)
	local level = player:GetAttribute("Level") or 1
	local aura = Flex.auraFor(level)
	local crown = Flex.crowned[player.UserId] == true
	player:SetAttribute("Aura", aura)
	player:SetAttribute("Crown", crown or nil)
	if player.Character then
		Flex.dress(player.Character, aura, crown)
	end
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

Flex.FAVORITE_COINS = 100

--- The client says the player favourited the game (Roblox tells only the client): paid once.
function Flex.favorited(player: Player): (boolean, any)
	local p = Data.get(player)
	if not p or p.favorited then
		return false, "Thanks again!"
	end
	Data.update(player, function(pp)
		pp.favorited = true
	end)
	return true, { coins = Economy.give(player, Flex.FAVORITE_COINS, "favorite", true) }
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
