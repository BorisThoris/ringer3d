-- Showing off, and coming back tomorrow: what keeps players in the top Roblox games.
--
-- * Nameplates: over every player's head, their level and title, their rarest marble in its
--   rarity's colour, and a VIP tag. What you've earned is what everyone sees.
-- * Announcements: the whole server hears about a Legendary or Mythic out of a bag, a win streak,
--   a Tower cleared, a level milestone (client: a banner and a system chat line).
-- * Daily quests: three a day, each finishable in one session (played, won, marbles knocked out,
--   fields visited, lawn coins, bags), for coins. Progress is kept in the profile.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Ringer.Config)
local MarbleLook = require(ReplicatedStorage.Ringer.MarbleLook)
local Data = require(script.Parent.Data)
local Economy = require(script.Parent.Economy)

local Social = {}

-- ---- Levels and titles (the same XP as the client's Rewards bar) -------------------------------

local TITLES = { { 1, "Rookie" }, { 5, "Flicker" }, { 10, "Sharpshooter" }, { 20, "Marble Master" }, { 35, "Ring Legend" }, { 50, "Ringer King" } }
local RARITY_RANK = { Common = 1, Rare = 2, Epic = 3, Legendary = 4, Mythic = 5, Limited = 6, Exclusive = 7 }

function Social.level(played: number, wins: number): number
	local xp = played * 10 + wins * 15
	local n = 1
	while 25 * (n + 1) * n <= xp do
		n += 1
	end
	return n
end

function Social.title(level: number): string
	local t = TITLES[1][2]
	for _, row in ipairs(TITLES) do
		if level >= row[1] then
			t = row[2]
		end
	end
	return t
end

--- The rarest marble a profile holds: its name and rarity.
function Social.best(p: any): (string?, string?)
	local bestId, bestRank = nil, 0
	local function consider(id: string)
		local look = MarbleLook.lookFor(id)
		local rank = RARITY_RANK[look.rarity or "Common"] or 1
		if rank > bestRank then
			bestId, bestRank = id, rank
		end
	end
	for id in pairs(p.owned or {}) do
		consider(id)
	end
	for _, o in ipairs(p.forged or {}) do
		consider(o.id)
	end
	if not bestId then
		return nil, nil
	end
	local look = MarbleLook.lookFor(bestId)
	return look.name, look.rarity
end

-- ---- Nameplates ---------------------------------------------------------------------------------

local function plate(player: Player)
	local char = player.Character
	local head = char and char:FindFirstChild("Head")
	local p = Data.get(player)
	if not head or not p then
		return
	end
	local gui = head:FindFirstChild("Nameplate") :: BillboardGui?
	if not gui then
		local g = Instance.new("BillboardGui")
		g.Name = "Nameplate"
		g.Size = UDim2.fromOffset(220, 58)
		g.StudsOffset = Vector3.new(0, 2.6, 0)
		g.MaxDistance = 80
		g.LightInfluence = 0
		g.Parent = head
		local function line(name: string, y: number, h: number)
			local l = Instance.new("TextLabel")
			l.Name = name
			l.BackgroundTransparency = 1
			l.Position = UDim2.fromScale(0, y)
			l.Size = UDim2.fromScale(1, h)
			l.Font = Enum.Font.FredokaOne
			l.TextScaled = true
			l.TextColor3 = Color3.new(1, 1, 1)
			l.TextStrokeTransparency = 0.1
			l.Parent = g
		end
		line("Title", 0, 0.5)
		line("Best", 0.5, 0.42)
		gui = g
		-- Roblox's own name stays; ours sits above it.
	end
	local level = Social.level(p.played, p.wins)
	local vip = Economy.hasPass(player, "vip")
	local title = (gui :: BillboardGui):FindFirstChild("Title") :: TextLabel
	title.Text = (if vip then "👑 " else "") .. "Lv " .. level .. " · " .. Social.title(level)
	title.TextColor3 = if vip then Color3.fromRGB(255, 215, 80) else Color3.new(1, 1, 1)
	local name, rarity = Social.best(p)
	local best = (gui :: BillboardGui):FindFirstChild("Best") :: TextLabel
	best.Text = if name then "✨ " .. name else ""
	best.TextColor3 = Config.RARITY_COLOR[rarity or "Common"] or Color3.new(1, 1, 1)
	player:SetAttribute("Level", level)
end
Social.plate = plate

-- ---- Announcements ------------------------------------------------------------------------------

Social.announceRemote = nil :: RemoteEvent?
Social.log = {} :: { string } -- what was announced (tests read it)

function Social.announce(text: string, color: Color3?)
	table.insert(Social.log, text)
	if #Social.log > 50 then
		table.remove(Social.log, 1)
	end
	local r = Social.announceRemote
	if r then
		r:FireAllClients(text, color or Color3.fromRGB(255, 220, 90))
	end
end

--- A bag opened: Legendary and up is news.
function Social.bagOpened(player: Player, id: string)
	local look = MarbleLook.lookFor(id)
	local rarity = look.rarity or "Common"
	if (RARITY_RANK[rarity] or 1) >= RARITY_RANK.Legendary then
		Social.announce(string.format("🎉 %s unboxed a %s %s!", player.DisplayName, string.upper(rarity), look.name or "marble"), Config.RARITY_COLOR[rarity])
	end
	Social.quest(player, "bags", 1)
end

local streaks: { [Player]: number } = {}
--- A game finished for this player.
function Social.gameOver(player: Player, won: boolean, score: number, arena: string, levelBefore: number)
	streaks[player] = if won then (streaks[player] or 0) + 1 else 0
	local s = streaks[player]
	if won and (s == 3 or s == 5 or s == 10 or (s > 10 and s % 5 == 0)) then
		Social.announce(string.format("🔥 %s is on a %d-win streak!", player.DisplayName, s), Color3.fromRGB(255, 130, 60))
	end
	if score >= Config.TARGETS then
		Social.announce(string.format("💥 %s swept the whole ring!", player.DisplayName), Color3.fromRGB(120, 220, 255))
	end
	Social.quest(player, "played", 1)
	if won then
		Social.quest(player, "wins", 1)
	end
	Social.quest(player, "captured", score)
	Social.quest(player, "fields", 1, arena)
	local p = Data.get(player)
	if p then
		local level = Social.level(p.played, p.wins)
		if level > levelBefore and level % 5 == 0 then
			Social.announce(string.format("⭐ %s reached level %d: %s!", player.DisplayName, level, Social.title(level)), Color3.fromRGB(255, 230, 120))
		end
	end
end

-- ---- Daily quests -------------------------------------------------------------------------------

Social.QUESTS = {
	{ id = "play3", text = "Play 3 games", stat = "played", goal = 3, reward = 60 },
	{ id = "win1", text = "Win a game", stat = "wins", goal = 1, reward = 80 },
	{ id = "win3", text = "Win 3 games", stat = "wins", goal = 3, reward = 150 },
	{ id = "cap10", text = "Knock out 10 marbles", stat = "captured", goal = 10, reward = 70 },
	{ id = "cap25", text = "Knock out 25 marbles", stat = "captured", goal = 25, reward = 140 },
	{ id = "fields2", text = "Play on 2 different fields", stat = "fields", goal = 2, reward = 70 },
	{ id = "lawn10", text = "Grab 10 coins on the lobby lawn", stat = "lawn", goal = 10, reward = 40 },
	{ id = "bag1", text = "Open a Marble Bag", stat = "bags", goal = 1, reward = 50 },
}
local BY_ID = {}
for _, q in ipairs(Social.QUESTS) do
	BY_ID[q.id] = q
end

local function today(): number
	return math.floor(os.time() / 86400)
end

--- Today's three quests for a player (a stable pick from the day and their id), made fresh at
--- the first look each day.
function Social.quests(player: Player): any
	local p = Data.get(player)
	if not p then
		return nil
	end
	local d = today()
	if not p.quests or p.quests.day ~= d then
		local rng = Random.new(d * 7919 + player.UserId % 100000)
		-- The first is always an easy one (play or win once), so every day starts with a quick win;
		-- the other two are drawn from the rest.
		local easy = if rng:NextNumber() < 0.5 then "play3" else "win1"
		local list = { { id = easy, progress = 0, claimed = false } }
		local pool = {}
		for _, q in ipairs(Social.QUESTS) do
			if q.id ~= easy then
				table.insert(pool, q)
			end
		end
		for _ = 1, 2 do
			local pick = table.remove(pool, rng:NextInteger(1, #pool))
			table.insert(list, { id = pick.id, progress = 0, claimed = false })
		end
		Data.update(player, function(pp)
			pp.quests = { day = d, list = list, fields = {} }
		end)
	end
	local out = {}
	for _, e in ipairs(p.quests.list) do
		local q = BY_ID[e.id]
		if q then
			table.insert(out, { id = e.id, text = q.text, goal = q.goal, reward = q.reward, progress = math.min(e.progress, q.goal), claimed = e.claimed })
		end
	end
	return out
end

--- Count `amount` toward any of today's quests that track `stat` (`key` for distinct counts).
function Social.quest(player: Player, stat: string, amount: number, key: string?)
	local p = Data.get(player)
	if not p then
		return
	end
	Social.quests(player)
	Data.update(player, function(pp)
		local qs = pp.quests
		if stat == "fields" then
			if not key or qs.fields[key] then
				return
			end
			qs.fields[key] = true
		end
		for _, e in ipairs(qs.list) do
			local q = BY_ID[e.id]
			if q and q.stat == stat and not e.claimed then
				e.progress = math.min(q.goal, e.progress + amount)
			end
		end
	end)
end

--- Claim a finished quest's coins. (ok, coins or why)
function Social.claim(player: Player, id: string): (boolean, any)
	local p = Data.get(player)
	local q = BY_ID[id]
	if not p or not q or not p.quests or p.quests.day ~= today() then
		return false, "That quest isn't one of today's."
	end
	for _, e in ipairs(p.quests.list) do
		if e.id == id then
			if e.claimed then
				return false, "Already claimed."
			end
			if e.progress < q.goal then
				return false, "Not finished yet."
			end
			Data.update(player, function()
				e.claimed = true
			end)
			return true, Economy.give(player, q.reward, "quest:" .. id)
		end
	end
	return false, "That quest isn't one of today's."
end

-- ---- Wiring -------------------------------------------------------------------------------------

function Social.start(announceRemote: RemoteEvent)
	Social.announceRemote = announceRemote
	local function watch(player: Player)
		player.CharacterAdded:Connect(function()
			task.wait(0.5)
			plate(player)
		end)
		if player.Character then
			plate(player)
		end
	end
	for _, pl in ipairs(Players:GetPlayers()) do
		watch(pl)
	end
	Players.PlayerAdded:Connect(watch)
	Players.PlayerRemoving:Connect(function(pl)
		streaks[pl] = nil
	end)
	Data.changed.Event:Connect(function(player)
		plate(player)
	end)
end

return Social
