-- The downhill race: Marble Mountain. Builds the track and its world once (track from RaceTrack's
-- frames, the mountain in terrain, forests, cliffs, the waterfall, clouds, the lake at the finish),
-- runs each player's race (they race on their own client on RaceSim; the server replays the input
-- log on the same deterministic sim to verify the time), and keeps records: personal bests, a
-- global leaderboard, medals and coins.

local DataStoreService = game:GetService("DataStoreService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local RaceTrack = require(ReplicatedStorage.Ringer.RaceTrack)
local RaceSim = require(ReplicatedStorage.Ringer.RaceSim)
local Data = require(script.Parent.Data)
local Economy = require(script.Parent.Economy)
local Aura = require(script.Parent.Aura)

local RaceWorld = require(ReplicatedStorage.Ringer.RaceWorld)

local Race = {}

--- Build the world here too (previews and tests do; a live server never needs it).
function Race.build(parent: Instance?): any
	return RaceWorld.build(parent)
end

-- Medal times (seconds), set from the playthrough report (scripts/race-report.mjs): the expert
-- takes both shortcuts in about 36 s; a clean main route is about 50 s, an average one 54.
Race.MEDALS = { { "Gold", 39.5, 120 }, { "Silver", 45, 70 }, { "Bronze", 55, 40 } }
Race.FINISH_COINS = 20
-- A gold run takes under a minute and pays ~190 coins, ten times a duel's rate: the first few
-- finishes each day pay in full, the rest a quarter, so racing never replaces the duels.
Race.FULL_PAY_RUNS = 5
Race.LATER_SHARE = 0.25
--- The share of a finish's coins paid for the `n`th finish of the day (1 = the first).
function Race.payShare(n: number): number
	return if n <= Race.FULL_PAY_RUNS then 1 else Race.LATER_SHARE
end
-- Stars on the learnable lines: a coin each, and a bonus for the whole set in one run.
Race.STAR_COINS = 1
Race.ALL_STARS_BONUS = 25
-- The light the client sets while racing (also the preview's).
Race.LIGHT = { clock = 15.8, sky = { 110, 175, 255 }, horizon = { 255, 220, 200 }, fog = { 225, 225, 245 }, density = 0.12, sun = { 255, 236, 205 } }

-- ---- Sessions, verification, records ------------------------------------------------------------

local sessions: { [Player]: { started: number } } = {}
Race.sessions = sessions -- (the tests backdate a session to finish a bot run)
local board = nil
pcall(function()
	board = DataStoreService:GetOrderedDataStore("RaceBest_c" .. RaceTrack.VERSION)
end)
-- Each player's best run as its input log, for the ghost they race against (its own store: a log
-- is far bigger than a profile should be). Cached per player while they're here.
local ghosts = nil
pcall(function()
	ghosts = DataStoreService:GetDataStore("RaceGhost_c" .. RaceTrack.VERSION)
end)
local ghostCache: { [Player]: any } = {}
Race.GHOST_MAX = 6000 -- input changes; a longer log is not kept as a ghost
-- Read a stored ghost. Only a log that still replays to its time on this course counts (the course
-- may have changed since).
local function fetchGhost(userId: number): any
	-- Someone in this server already has their ghost cached.
	for pl, g in pairs(ghostCache) do
		if g and (pl :: any).UserId == userId then
			return g
		end
	end
	local got = nil
	if ghosts then
		pcall(function()
			got = ghosts:GetAsync(tostring(userId))
		end)
	end
	if got and typeof(got.log) == "table" and RaceSim.validLog(got.log) then
		local st = RaceSim.replay(got.log)
		if st.finished and math.abs(st.finishTick / 60 - (got.time or -1)) < 1e-6 then
			return got
		end
	end
	return nil
end
local function loadGhost(player: Player): any
	if ghostCache[player] ~= nil then
		return ghostCache[player] or nil
	end
	local got = fetchGhost(player.UserId)
	ghostCache[player] = got or false
	return got
end
Race.loadGhost = loadGhost

-- The record ghost: the all-time leader's best run, so everyone can race the record holder. Read
-- again at most every five minutes, or when the leader changes.
local record: any = nil
local recordAt, recordId = -math.huge, nil
function Race.recordGhost(): any
	local top = Race.top()
	local lead = top[1]
	if not lead or not lead.userId then
		return nil
	end
	if lead.userId ~= recordId or os.clock() - recordAt > 300 then
		recordAt, recordId = os.clock(), lead.userId
		local g = fetchGhost(lead.userId)
		record = if g then { userId = lead.userId, name = lead.name, time = g.time, log = g.log } else nil
	end
	return record
end

--- Your rival on the board: the slowest time still faster than your best (the bottom of the board
--- before you have a best), never you and never the leader (the record ghost already is). Entries
--- are { userId, name, time }, fastest first.
function Race.rivalFor(top: { any }, userId: number, best: number?): any
	local pick = nil
	for i, e in ipairs(top) do
		if i > 1 and e.userId ~= userId and (best == nil or e.time < best) then
			pick = e
		end
	end
	return pick
end
-- Ghosts of rivals, read at most every five minutes each.
local rivalCache: { [number]: { at: number, g: any } } = {}
function Race.rivalGhost(player: Player, best: number?): any
	local r = Race.rivalFor(Race.top(), player.UserId, best)
	if not r then
		return nil
	end
	local c = rivalCache[r.userId]
	if not c or os.clock() - c.at > 300 then
		c = { at = os.clock(), g = fetchGhost(r.userId) }
		rivalCache[r.userId] = c
	end
	return if c.g then { name = r.name, time = c.g.time, log = c.g.log } else nil
end

-- This week's board: a fresh one every Monday, so there is always a race anyone can win.
local function week(): number
	return math.floor((os.time() - 4 * 86400) / (7 * 86400)) -- the Unix epoch was a Thursday
end
Race.week = week
local function weekBoard(w: number?)
	local ok, b = pcall(function()
		return DataStoreService:GetOrderedDataStore("RaceWeek_c" .. RaceTrack.VERSION .. "_" .. (w or week()))
	end)
	return if ok then b else nil
end

-- Weekly prizes: the top ten of last week's board are paid the first time they come back.
Race.WEEK_PRIZES = { 1000, 600, 400, 250, 250, 150, 150, 150, 150, 150 }
function Race.weekPrize(rank: number?): number
	return if rank then Race.WEEK_PRIZES[rank] or 0 else 0
end
--- Where `userId` finished in a board's top entries ({ key = "id", ... }), or nil.
function Race.rankIn(entries: { any }, userId: number): number?
	for i, e in ipairs(entries) do
		if tonumber(e.key) == userId then
			return i
		end
	end
	return nil
end
Race.announce = function(_text: string, _color: Color3?) end
Race.quest = function(_player: Player, _stat: string, _n: number) end

function Race.racing(player: Player): boolean
	return sessions[player] ~= nil
end

--- A profile's race records belong to the layout they were set on: on a new layout they start
--- again (the first time the player races it).
function Race.currentCourse(player: Player)
	local p = Data.get(player)
	if p and p.raceCourse ~= RaceTrack.VERSION then
		Data.update(player, function(pp)
			pp.raceCourse = RaceTrack.VERSION
			pp.raceBest = nil
			pp.raceStars = nil
			pp.raceWeek = nil
		end)
	end
end

--- Start a race for `player`: their avatar waits on the start deck; the client takes over.
function Race.start(player: Player): (boolean, any)
	Race.currentCourse(player)
	sessions[player] = { started = os.clock() }
	local startAt = RaceSim.position(RaceSim.new())
	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if root then
		char:PivotTo(CFrame.new(startAt + Vector3.new(0, 8, 30)))
		root.Anchored = true
	end
	player:SetAttribute("Racing", true)
	local p = Data.get(player) or {}
	local ghost = loadGhost(player)
	local rec = Race.recordGhost()
	if rec and rec.userId == player.UserId then
		rec = nil -- you hold the record: your own ghost is it
	end
	local rival = Race.rivalGhost(player, p.raceBest)
	sessions[player].rivalTime = rival and rival.time
	return true, {
		countdown = 3, medals = Race.MEDALS, best = p.raceBest, bestStars = p.raceStars,
		ghost = ghost and ghost.log,
		record = rec and { name = rec.name, time = rec.time, log = rec.log },
		rival = rival,
	}
end

function Race.leave(player: Player)
	sessions[player] = nil
	player:SetAttribute("Racing", nil)
	local char = player.Character
	local root = char and char:FindFirstChild("HumanoidRootPart") :: BasePart?
	if root then
		root.Anchored = false
		char:PivotTo(CFrame.new(0, 5, 38))
	end
end

--- The racer says they finished: replay their inputs and pay for the verified time.
function Race.finish(player: Player, log: any): (boolean, any)
	local session = sessions[player]
	if not session then
		return false, "You're not racing."
	end
	Race.currentCourse(player)
	local ok, why = RaceSim.validLog(log)
	if not ok then
		return false, why
	end
	local st = RaceSim.replay(log)
	if not st.finished then
		return false, "That run didn't reach the finish."
	end
	local time = st.finishTick / 60
	-- It can't have taken less real time than it says (plus the countdown, minus a little slack).
	local real = os.clock() - session.started
	if real + 1.5 < time then
		return false, "That run was faster than real time."
	end
	session.started = os.clock() + 3 -- a new run starts after the next countdown
	-- Only real players reach the shared stores (the tests finish runs as plain tables, and the
	-- cloud test runs share this game's live DataStores).
	local isPlayer = typeof(player) == "Instance"
	local medal, coins = nil, Race.FINISH_COINS
	local starTotal = #RaceTrack.get().stars
	coins += st.starCount * Race.STAR_COINS
	if st.starCount == starTotal then
		coins += Race.ALL_STARS_BONUS
	end
	for _, m in ipairs(Race.MEDALS) do
		if time <= m[2] then
			medal = m[1]
			coins += m[3]
			break
		end
	end
	local p = Data.get(player)
	local pb = p and p.raceBest
	local newBest = pb == nil or time < pb
	local day = math.floor(os.time() / 86400)
	local today = if p and p.raceDay == day then (p.raceDayRuns or 0) + 1 else 1
	local share = Race.payShare(today)
	coins = math.max(1, math.floor(coins * share + 0.5))
	if p then
		Data.update(player, function(pp)
			pp.raceDay = day
			pp.raceDayRuns = today
			pp.raceRuns = (pp.raceRuns or 0) + 1
			if newBest then
				pp.raceBest = time
			end
			pp.raceStars = math.max(pp.raceStars or 0, st.starCount)
		end)
	end
	local got = Economy.give(player, coins, "race")
	if isPlayer then
		Economy.badge(player, "raceFinish")
		if medal == "Gold" then
			Economy.badge(player, "raceGold")
		end
		if st.starCount == starTotal then
			Economy.badge(player, "raceStars")
		end
	end
	Race.quest(player, "races", 1)
	if medal == "Gold" then
		Race.quest(player, "gold", 1)
	end
	if newBest and #log <= Race.GHOST_MAX then
		local entry = { log = log, time = time }
		ghostCache[player] = entry
		if ghosts and isPlayer then
			task.spawn(function()
				pcall(function()
					ghosts:SetAsync(tostring(player.UserId), entry)
				end)
			end)
		end
	end
	if newBest and board and isPlayer then
		task.spawn(function()
			pcall(function()
				board:SetAsync(tostring(player.UserId), math.floor(time * 1000))
			end)
		end)
	end
	-- This week's best, kept in the profile so only a better time is written.
	local wk = week()
	local weekBest = p and p.raceWeek and p.raceWeek.week == wk and p.raceWeek.best
	if p and (not weekBest or time < weekBest) then
		Data.update(player, function(pp)
			pp.raceWeek = { week = wk, best = time }
		end)
		local wb = weekBoard()
		if wb and isPlayer then
			task.spawn(function()
				pcall(function()
					wb:SetAsync(tostring(player.UserId), math.floor(time * 1000))
				end)
			end)
		end
	end
	local beatRival = session.rivalTime ~= nil and time < session.rivalTime
	Aura.give(player, Aura.forRace(medal, newBest and pb ~= nil, beatRival), 1)
	if medal == "Gold" and newBest then
		Race.announce(string.format("🥇 %s won GOLD on Marble Mountain in %.2fs!", player.DisplayName, time), Color3.fromRGB(255, 215, 80))
	end
	return true, { time = time, medal = medal, coins = got, reduced = share < 1,best = if newBest then time else pb, newBest = newBest, respawns = st.respawns, stars = st.starCount, starTotal = starTotal, bestStars = math.max(p and p.raceStars or 0, st.starCount) }
end

--- The top times: { name, time }, all time and this week (cached a minute).
local names: { [number]: string } = {}
local function read(store: any): { any }?
	if not store then
		return nil
	end
	local out = nil
	pcall(function()
		local page = store:GetSortedAsync(true, 10):GetCurrentPage()
		out = {}
		for _, e in ipairs(page) do
			local id = tonumber(e.key) :: number
			if not names[id] then
				pcall(function()
					names[id] = Players:GetNameFromUserIdAsync(id)
				end)
			end
			table.insert(out, { name = names[id] or "?", time = e.value / 1000, userId = id })
		end
	end)
	return out
end
local topCache, weekCache, topAt = {}, {}, -math.huge
local function refresh()
	if os.clock() - topAt < 60 then
		return
	end
	topAt = os.clock()
	topCache = read(board) or topCache
	weekCache = read(weekBoard()) or weekCache
end
function Race.top(): { any }
	refresh()
	return topCache
end
function Race.topWeek(): { any }
	refresh()
	return weekCache
end

-- Last week's top ten, read once per server per week.
local lastWeekTop: { any }?, lastWeekOf = nil, -1
--- Pay a player their prize from last week's board, once. (rank, coins) when paid.
function Race.payWeek(player: Player): (number?, number?)
	if typeof(player) ~= "Instance" then
		return nil, nil
	end
	local p = Data.get(player)
	local last = week() - 1
	if not p or p.weekPaid == last then
		return nil, nil
	end
	if lastWeekOf ~= last then
		local store = weekBoard(last)
		local got = nil
		if store then
			pcall(function()
				got = store:GetSortedAsync(true, #Race.WEEK_PRIZES):GetCurrentPage()
			end)
		end
		if not got then
			return nil, nil -- try again next visit
		end
		lastWeekTop, lastWeekOf = got, last
	end
	local rank = Race.rankIn(lastWeekTop :: { any }, player.UserId)
	Data.update(player, function(pp)
		pp.weekPaid = last
	end)
	local prize = Race.weekPrize(rank)
	if prize <= 0 then
		return nil, nil
	end
	local coins = Economy.give(player, prize, "raceWeek", true)
	Race.announce(string.format("🏆 %s finished #%d on last week's race board: +%d coins!", player.DisplayName, rank :: number, coins), Color3.fromRGB(255, 215, 80))
	return rank, coins
end

--- A board in the lobby by the race gate: the fastest times, all time and this week.
function Race.board(cf: CFrame, parent: Instance)
	local part = Instance.new("Part")
	part.Name = "RaceBoard"
	part.Anchored = true
	part.Size = Vector3.new(26, 18, 1)
	part.CFrame = cf
	part.Color = Color3.fromRGB(30, 40, 70)
	part.Parent = parent
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.PixelsPerStud = 36
	gui.LightInfluence = 0
	gui.Parent = part
	local head = Instance.new("TextLabel")
	head.BackgroundTransparency = 1
	head.Size = UDim2.new(1, 0, 0.16, 0)
	head.Font = Enum.Font.FredokaOne
	head.TextScaled = true
	head.Text = "🏔️ MARBLE MOUNTAIN · FASTEST"
	head.TextColor3 = Color3.fromRGB(255, 230, 120)
	head.Parent = gui
	local cols = {}
	for k, title in ipairs({ "THIS WEEK 🏆 prizes!", "ALL TIME" }) do
		local l = Instance.new("TextLabel")
		l.BackgroundTransparency = 1
		l.Position = UDim2.new((k - 1) * 0.5, 16, 0.18, 0)
		l.Size = UDim2.new(0.5, -24, 0.8, 0)
		l.Font = Enum.Font.FredokaOne
		l.TextSize = 30
		l.TextXAlignment = Enum.TextXAlignment.Left
		l.TextYAlignment = Enum.TextYAlignment.Top
		l.TextColor3 = Color3.fromRGB(235, 240, 255)
		l.Text = title .. "\n\n(loading)"
		l.Parent = gui
		cols[k] = { label = l, title = title }
	end
	local function fmt(t: number): string
		return string.format("%d:%05.2f", math.floor(t / 60), t % 60)
	end
	task.spawn(function()
		while part.Parent do
			for k, list in ipairs({ Race.topWeek(), Race.top() }) do
				local lines = { cols[k].title, "" }
				for i, e in ipairs(list) do
					table.insert(lines, string.format("%d. %s  %s", i, e.name, fmt(e.time)))
				end
				if #list == 0 then
					table.insert(lines, "Be the first!")
				end
				cols[k].label.Text = table.concat(lines, "\n")
			end
			task.wait(60)
		end
	end)
	return part
end

-- Ghosts: each racer's marble, relayed to the other racers ten times a second.
function Race.ghost(player: Player, pos: any, remote: RemoteEvent)
	if not sessions[player] or typeof(pos) ~= "Vector3" then
		return
	end
	for other in pairs(sessions) do
		if other ~= player and other.Parent then
			remote:FireClient(other, player.UserId, pos, player:GetAttribute("Marble"))
		end
	end
end

Players.PlayerRemoving:Connect(function(p)
	sessions[p] = nil
	ghostCache[p] = nil
end)

return Race
