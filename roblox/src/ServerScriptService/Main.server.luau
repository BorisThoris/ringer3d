-- Ringer 3D on Roblox: the server. Builds the lobby, matches players (a duel against another
-- player, a game against a bot, or the next floor of the Tower), runs each table, and pays out.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Lighting = game:GetService("Lighting")
local ServerScriptService = game:GetService("ServerScriptService")

local Config = require(ReplicatedStorage.Ringer.Config)
local MarbleLook = require(ReplicatedStorage.Ringer.MarbleLook)
local Server = ServerScriptService.Server
local Table = require(Server.Table)
local Data = require(Server.Data)
local Economy = require(Server.Economy)
local Collectibles = require(Server.Collectibles)
local Market = require(Server.Market)
local Leaderboard = require(Server.Leaderboard)

-- ---- Remotes --------------------------------------------------------------------------------
local remotes = Instance.new("Folder")
remotes.Name = "Remotes"
local function remote(class: string, name: string)
	local r = Instance.new(class)
	r.Name = name
	r.Parent = remotes
	return r
end
local TableEvent = remote("RemoteEvent", "TableEvent") :: RemoteEvent
local Shoot = remote("RemoteEvent", "Shoot") :: RemoteEvent
local Request = remote("RemoteFunction", "Request") :: RemoteFunction
local ProfileSync = remote("RemoteEvent", "ProfileSync") :: RemoteEvent
local Notify = remote("RemoteEvent", "Notify") :: RemoteEvent
local BagOpened = remote("RemoteEvent", "BagOpened") :: RemoteEvent
remotes.Parent = ReplicatedStorage.Ringer

local function notify(player: Player, text: string, kind: string?)
	Notify:FireClient(player, text, kind or "info")
end
Market.notify = notify
Market.bagOpened = function(player, got)
	BagOpened:FireClient(player, got)
end

-- ---- The world --------------------------------------------------------------------------------
Lighting.ClockTime = 14.5
Lighting.Brightness = 2.2
Lighting.EnvironmentDiffuseScale = 0.6
Lighting.EnvironmentSpecularScale = 0.7
Lighting.OutdoorAmbient = Color3.fromRGB(150, 140, 160)
local bloom = Instance.new("BloomEffect")
bloom.Intensity = 0.6
bloom.Size = 30
bloom.Threshold = 1.4
bloom.Parent = Lighting
local cc = Instance.new("ColorCorrectionEffect")
cc.Saturation = 0.12
cc.Contrast = 0.06
cc.Parent = Lighting

local lobby = Instance.new("Model")
lobby.Name = "Lobby"
lobby.Parent = workspace

local function lobbyPart(props)
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	for k, v in pairs(props) do
		(p :: any)[k] = v
	end
	p.Parent = lobby
	return p
end

-- A round plaza with a giant ring of giant marbles in the middle: the lobby is the game's poster.
lobbyPart({ Name = "Plaza", Shape = Enum.PartType.Cylinder, Size = Vector3.new(2, 150, 150), CFrame = CFrame.new(0, -1, 0) * CFrame.Angles(0, 0, math.pi / 2), Material = Enum.Material.Pavement, Color = Color3.fromRGB(120, 110, 130) })
lobbyPart({ Name = "Rug", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.2, 64, 64), CFrame = CFrame.new(0, 0.05, 0) * CFrame.Angles(0, 0, math.pi / 2), Material = Enum.Material.Fabric, Color = Color3.fromRGB(150, 60, 50) })
for i = 0, 59 do
	local a = i / 60 * math.pi * 2
	lobbyPart({ Name = "Chalk", Size = Vector3.new(2.1, 0.08, 0.5), CFrame = CFrame.lookAt(Vector3.new(math.cos(a) * 20, 0.2, math.sin(a) * 20), Vector3.new(0, 0.2, 0)), Material = Enum.Material.SmoothPlastic, Color = Color3.fromRGB(245, 240, 230), CanCollide = false })
end
local showcase = { "obsidian", "aurora", "volt", "nova", "rime", "ember", "tide", "jade", "comet" }
for i, id in ipairs(showcase) do
	local a = i / #showcase * math.pi * 2
	local ball = MarbleLook.make(Config.MARBLE[id], 3)
	ball.Anchored = true
	ball.CFrame = CFrame.new(math.cos(a) * 11, 3, math.sin(a) * 11)
	ball.Parent = lobby
end
local spawn = Instance.new("SpawnLocation")
spawn.Anchored = true
spawn.Size = Vector3.new(10, 1, 10)
spawn.CFrame = CFrame.new(0, 0.5, 42)
spawn.Material = Enum.Material.Neon
spawn.Color = Color3.fromRGB(255, 120, 60)
spawn.Duration = 0
spawn.Parent = lobby
Leaderboard.board(CFrame.new(0, 10, -45) * CFrame.Angles(0, 0, 0), lobby)

-- ---- Matches ----------------------------------------------------------------------------------
local tables: { [number]: any } = {} -- slot -> table
local active: { [Player]: any } = {} -- player -> table they play at
local queue: { { player: Player, since: number } } = {}

local function slotOrigin(slot: number): Vector3
	local col = (slot - 1) % 8
	local row = math.floor((slot - 1) / 8)
	return Vector3.new((col + 1) * Config.TABLE_SPACING, 0, (row - 3) * Config.TABLE_SPACING)
end

local function freeSlot(): number
	local s = 1
	while tables[s] do
		s += 1
	end
	return s
end

local function freeze(player: Player, cf: CFrame?)
	local char = player.Character
	local hum = char and char:FindFirstChildOfClass("Humanoid")
	if not (char and hum) then
		return
	end
	if cf then
		char:PivotTo(cf)
		hum.WalkSpeed = 0
		hum.JumpHeight = 0
	else
		hum.WalkSpeed = 16
		hum.JumpHeight = 7.2
		char:PivotTo(spawn.CFrame + Vector3.new(math.random(-3, 3), 4, math.random(-3, 3)))
	end
end

local function seatFor(player: Player): Table.Seat
	local p = Data.get(player)
	return {
		kind = "player",
		player = player,
		name = player.DisplayName,
		marble = p and p.equipped or "ember",
		trail = player:GetAttribute("Trails") == true,
	}
end

local function send(tbl, kind: string, data: any)
	for _, player in ipairs(tbl:players()) do
		TableEvent:FireClient(player, kind, data, tbl.id)
	end
end

local function pay(tbl, result: Table.Result)
	for i, seat in ipairs(tbl.seats) do
		local player = seat.player
		if not (player and player.Parent) then
			continue
		end
		local won = #result.winners == 1 and result.winners[1] == i
		local score = result.scores[i]
		local coins = score * Config.COINS.capture + (won and Config.COINS.win or Config.COINS.loss)
		if won and tbl.mode == "duel" then
			coins += Config.COINS.pvpWinBonus
		end
		local got = Economy.give(player, coins, "match:" .. tbl.mode)
		local extra = {}
		Data.update(player, function(p)
			p.played += 1
			p.captured += score
			if won then
				p.wins += 1
			end
		end)
		local p = Data.get(player)
		if won and p then
			Leaderboard.record(player, p.wins)
			Economy.badge(player, "firstWin")
		end
		if score >= Config.TARGETS then
			Economy.badge(player, "sweep")
		end
		if tbl.mode == "tower" and p then
			local floor = tbl.floor
			if won then
				Economy.progression(player, floor, Enum.AnalyticsProgressionType.Complete)
				if floor == p.tower then
					local stage = Config.TOWER[floor]
					extra.towerCoins = Economy.give(player, stage.reward, "tower:" .. floor)
					Data.update(player, function(pp)
						pp.tower = floor + 1
						pp.towerBest = math.max(pp.towerBest, floor)
					end)
					if floor >= 7 then
						local unlock = Config.TOWER[floor].marble
						Collectibles.grant(player, unlock)
						extra.unlocked = unlock
					end
					if floor == #Config.TOWER then
						Economy.badge(player, "towerTop")
					end
				end
			else
				Economy.progression(player, floor, Enum.AnalyticsProgressionType.Fail)
			end
		end
		Economy.funnel(player, 4, "Finished a match")
		TableEvent:FireClient(player, "result", {
			won = won,
			draw = #result.winners > 1,
			coins = got + (extra.towerCoins or 0),
			scores = result.scores,
			mode = tbl.mode,
			floor = tbl.floor,
			unlocked = extra.unlocked,
			abandoned = result.abandoned ~= nil,
		}, tbl.id)
	end
end

local function startTable(seats: { Table.Seat }, arena: string, mode: string, floor: number?)
	local slot = freeSlot()
	local tbl = Table.new({
		seats = seats,
		arena = arena,
		origin = slotOrigin(slot),
		mode = mode,
		floor = floor,
		send = send,
	})
	tables[slot] = tbl
	for i, seat in ipairs(seats) do
		if seat.player then
			active[seat.player] = tbl
			freeze(seat.player, tbl.built.stands[i])
			Economy.funnel(seat.player, 2, "Started a match")
		end
	end
	task.spawn(function()
		local result = tbl:run()
		pay(tbl, result)
		task.wait(4)
		for _, seat in ipairs(tbl.seats) do
			if seat.player and active[seat.player] == tbl then
				active[seat.player] = nil
				if seat.player.Parent then
					freeze(seat.player, nil)
				end
			end
		end
		tables[slot] = nil
		tbl:destroy()
	end)
	return tbl
end

local function randomArena(rng: Random): string
	return Config.ARENA_ORDER[rng:NextInteger(1, #Config.ARENA_ORDER)]
end

local rng = Random.new()

local function botSeat(botId: string, name: string?, marble: string?): Table.Seat
	local bot = Config.BOTS[botId] or Config.BOTS.casual
	local pool = { "tide", "pip", "jade", "rime", "ironside", "volt" }
	return { kind = "bot", bot = bot.id, name = name or (bot.label .. " Bot"), marble = marble or pool[rng:NextInteger(1, #pool)] }
end

local function dequeue(player: Player)
	for i = #queue, 1, -1 do
		if queue[i].player == player then
			table.remove(queue, i)
		end
	end
end

-- Pair waiting duellists; anyone waiting too long gets a bot instead.
task.spawn(function()
	while true do
		task.wait(1)
		for i = #queue, 1, -1 do
			if not queue[i].player.Parent or active[queue[i].player] then
				table.remove(queue, i)
			end
		end
		while #queue >= 2 do
			local a = table.remove(queue, 1)
			local b = table.remove(queue, 1)
			startTable({ seatFor(a.player), seatFor(b.player) }, randomArena(rng), "duel")
		end
		if #queue == 1 and os.clock() - queue[1].since > 25 then
			local q = table.remove(queue, 1)
			notify(q.player, "No one else is free right now: a bot takes the other seat.", "info")
			startTable({ seatFor(q.player), botSeat("regular") }, randomArena(rng), "bot")
		end
	end
end)

-- ---- Requests from the client -----------------------------------------------------------------
local function publicProfile(player: Player)
	local p = Data.get(player)
	if not p then
		return nil
	end
	return {
		coins = p.coins,
		wins = p.wins,
		played = p.played,
		captured = p.captured,
		owned = p.owned,
		limiteds = p.limiteds,
		equipped = p.equipped,
		tower = p.tower,
		towerBest = p.towerBest,
		streak = p.streak,
		dailyReady = p.lastDaily < math.floor(os.time() / 86400),
		vip = Economy.hasPass(player, "vip"),
		trails = Economy.hasPass(player, "trails"),
		premium = player.MembershipType == Enum.MembershipType.Premium,
		unsaved = player:GetAttribute("UnsavedProfile") == true,
	}
end

Data.changed.Event:Connect(function(player, _)
	ProfileSync:FireClient(player, publicProfile(player))
end)

local handlers = {}

function handlers.profile(player: Player)
	Data.await(player)
	return {
		profile = publicProfile(player),
		bagsRestricted = Collectibles.bagsRestricted(player),
		minted = Collectibles.minted(),
		top = Leaderboard.top,
	}
end

function handlers.play(player: Player, args)
	if active[player] then
		return false, "You're already in a game."
	end
	local p = Data.await(player)
	if not p then
		return false, "Still loading your profile."
	end
	dequeue(player)
	local mode = args and args.mode
	if mode == "duel" then
		table.insert(queue, { player = player, since = os.clock() })
		return true, "queued"
	elseif mode == "bot" then
		local bot = Config.BOTS[args.bot] and args.bot or "casual"
		local arena = Config.ARENAS[args.arena] and args.arena or randomArena(rng)
		startTable({ seatFor(player), botSeat(bot) }, arena, "bot")
		return true
	elseif mode == "tower" then
		local floor = math.clamp(p.tower, 1, #Config.TOWER)
		local stage = Config.TOWER[floor]
		startTable({ seatFor(player), botSeat(stage.bot, stage.name, stage.marble) }, stage.arena, "tower", floor)
		Economy.progression(player, floor, Enum.AnalyticsProgressionType.Start)
		return true
	end
	return false, "Unknown mode."
end

function handlers.cancel(player: Player)
	dequeue(player)
	return true
end

function handlers.leave(player: Player)
	local tbl = active[player]
	if tbl then
		-- Leaving mid-game forfeits: the table sees the seat as gone.
		tbl.abandoned = tbl:seatOf(player) or tbl.current
		for _, seat in ipairs(tbl.seats) do
			if seat.player == player then
				seat.player = nil
			end
		end
		active[player] = nil
		freeze(player, nil)
	end
	return true
end

function handlers.equip(player: Player, id)
	local p = Data.get(player)
	if not (p and typeof(id) == "string" and p.owned[id]) then
		return false
	end
	Data.update(player, function(pp)
		pp.equipped = id
	end)
	return true
end

function handlers.buy(player: Player, id)
	if typeof(id) ~= "string" then
		return false
	end
	return Collectibles.buy(player, id)
end

function handlers.bag(player: Player)
	if Collectibles.bagsRestricted(player) then
		return false, "Marble Bags aren't available where you are."
	end
	if not Economy.spend(player, Config.BAG_PRICE, "bag") then
		return false, "Not enough coins."
	end
	local got = Collectibles.openBag(player, rng)
	return got ~= nil, got
end

function handlers.daily(player: Player)
	local p = Data.get(player)
	local today = math.floor(os.time() / 86400)
	if not p or p.lastDaily >= today then
		return false, "Come back tomorrow!"
	end
	local streak = (p.lastDaily == today - 1) and p.streak + 1 or 1
	local amount = Config.COINS.daily[math.min(streak, #Config.COINS.daily)]
	Data.update(player, function(pp)
		pp.streak = streak
		pp.lastDaily = today
	end)
	local got = Economy.give(player, amount, "daily")
	return true, { coins = got, streak = streak }
end

Request.OnServerInvoke = function(player: Player, action: string, args: any)
	local h = handlers[action]
	if not h then
		return false, "Unknown request."
	end
	local ok, a, b = pcall(h, player, args)
	if not ok then
		warn("Request", action, "failed:", a)
		return false, "Something went wrong."
	end
	return a, b
end

Shoot.OnServerEvent:Connect(function(player: Player, tableId, placeAngle, aimAngle, power)
	local tbl = active[player]
	if tbl and tbl.id == tableId then
		if tbl:submit(player, placeAngle, aimAngle, power) then
			Economy.funnel(player, 3, "Took a shot")
		end
	end
end)

-- ---- Players ----------------------------------------------------------------------------------
Players.PlayerAdded:Connect(function(player)
	Economy.funnel(player, 1, "Joined")
	task.spawn(function()
		local p = Data.await(player)
		if p and not p.welcomed then
			Data.update(player, function(pp)
				pp.welcomed = true
			end)
			Economy.badge(player, "welcome")
		end
	end)
end)

Players.PlayerRemoving:Connect(function(player)
	dequeue(player)
	Collectibles.forget(player)
	local tbl = active[player]
	if tbl then
		tbl.abandoned = tbl:seatOf(player) or tbl.current
	end
	active[player] = nil
end)

Data.start()
Market.start()
Leaderboard.start()
