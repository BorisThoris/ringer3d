-- Ringer 3D on Roblox: the server. Builds the lobby, matches players (a duel against another
-- player, a game against a bot, or the next floor of the Tower), runs each table, and pays out.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
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
-- Lighting (Future, bloom, saturation, a bright sky) is in the place file: see lighting.json.
-- The lobby follows the top-earning games' look: flat saturated toy colours, a giant mascot,
-- the collectibles on show with rarity labels, big outlined gradient text.
local RunService = game:GetService("RunService")
local rgb = Color3.fromRGB

local lobby = Instance.new("Model")
lobby.Name = "Lobby"
lobby.Parent = workspace

local function lobbyPart(props, parent: Instance?)
	local p = Instance.new("Part")
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	for k, v in pairs(props) do
		(p :: any)[k] = v
	end
	p.Parent = parent or lobby
	return p
end

local function disc(name: string, radius: number, y: number, color: Color3, thick: number?)
	return lobbyPart({ Name = name, Shape = Enum.PartType.Cylinder, Size = Vector3.new(thick or 0.2, radius * 2, radius * 2), CFrame = CFrame.new(0, y, 0) * CFrame.Angles(0, 0, math.pi / 2), Color = color })
end

--- Big outlined text with a gradient, the way the top games letter everything.
local function bigText(parent: Instance, text: string, colors: { Color3 }, size: Vector2, offset: Vector3?)
	local gui = Instance.new("BillboardGui")
	gui.Size = UDim2.fromScale(size.X, size.Y)
	gui.StudsOffset = offset or Vector3.zero
	gui.LightInfluence = 0
	gui.MaxDistance = 400
	gui.Parent = parent
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Text = text
	label.TextScaled = true
	label.Font = Enum.Font.FredokaOne
	label.TextColor3 = Color3.new(1, 1, 1)
	label.Parent = gui
	local stroke = Instance.new("UIStroke")
	stroke.Color = rgb(30, 22, 40)
	stroke.Thickness = 4
	stroke.Parent = label
	local keys = {}
	for i, c in ipairs(colors) do
		table.insert(keys, ColorSequenceKeypoint.new((i - 1) / math.max(1, #colors - 1), c))
	end
	local grad = Instance.new("UIGradient")
	grad.Color = ColorSequence.new(keys)
	grad.Rotation = 90
	grad.Parent = label
	return label
end

-- Ground: a lawn, a cream plaza, and the sky-blue ring pad in the middle.
disc("Lawn", 110, -1.1, rgb(85, 200, 75), 2)
disc("Plaza", 46, -0.02, rgb(255, 214, 160))
disc("PadRim", 25.2, 0, rgb(255, 255, 255))
disc("Pad", 24, 0.02, rgb(70, 160, 255))
for i = 0, 59 do
	local a = i / 60 * math.pi * 2
	lobbyPart({ Name = "Chalk", Size = Vector3.new(2.3, 0.08, 0.8), CFrame = CFrame.lookAt(Vector3.new(math.cos(a) * 19, 0.15, math.sin(a) * 19), Vector3.new(0, 0.15, 0)), Color = rgb(255, 255, 255), CanCollide = false })
end
-- Coloured tiles round the plaza's edge.
local tileColors = { rgb(255, 90, 90), rgb(255, 205, 50), rgb(70, 200, 120), rgb(70, 160, 255), rgb(170, 100, 255) }
for i = 0, 39 do
	local a = i / 40 * math.pi * 2
	lobbyPart({ Name = "Tile", Size = Vector3.new(6.6, 0.3, 4), CFrame = CFrame.lookAt(Vector3.new(math.cos(a) * 44, 0, math.sin(a) * 44), Vector3.new(0, 0, 0)), Color = tileColors[i % #tileColors + 1] })
end

-- The collectibles on pedestals, each labelled with its rarity in the rarity's colour.
local showcase = { "obsidian", "aurora", "pumpkin", "volt", "nova", "rime", "ember", "tide", "comet" }
for i, id in ipairs(showcase) do
	local look = Config.MARBLE[id]
	local a = i / #showcase * math.pi * 2
	local at = Vector3.new(math.cos(a) * 12, 0, math.sin(a) * 12)
	local rc = Config.RARITY_COLOR[look.rarity] or rgb(255, 255, 255)
	lobbyPart({ Name = "Pedestal", Shape = Enum.PartType.Cylinder, Size = Vector3.new(1.6, 6.4, 6.4), CFrame = CFrame.new(at + Vector3.new(0, 0.8, 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = rgb(255, 255, 255) })
	lobbyPart({ Name = "Glow", Shape = Enum.PartType.Cylinder, Size = Vector3.new(0.3, 6.9, 6.9), CFrame = CFrame.new(at + Vector3.new(0, 1.5, 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = rc, CanCollide = false })
	local ball = MarbleLook.make(look, 2.4)
	ball.Anchored = true
	ball.CFrame = CFrame.new(at + Vector3.new(0, 4.1, 0))
	ball.Parent = lobby
	local holder = lobbyPart({ Name = "Label", Size = Vector3.new(1, 1, 1), CFrame = CFrame.new(at + Vector3.new(0, 7.8, 0)), Transparency = 1, CanCollide = false, CanQuery = false, CanTouch = false })
	bigText(holder, look.name, { rgb(255, 255, 255), rgb(255, 235, 190) }, Vector2.new(6.5, 1.2)).Parent.MaxDistance = 45
	bigText(holder, string.upper(look.rarity), { rc:Lerp(rgb(255, 255, 255), 0.35), rc }, Vector2.new(4.5, 0.9), Vector3.new(0, -1, 0)).Parent.MaxDistance = 45
end

-- The mascot: a giant Jack-o'-Marble with a face, bobbing and turning over the ring.
local mascot = Instance.new("Model")
mascot.Name = "Mascot"
mascot.Parent = lobby
local body = MarbleLook.make(Config.MARBLE.pumpkin, 7)
body.Anchored = true
body.CFrame = CFrame.new()
body.Parent = mascot
local function facePart(props)
	return lobbyPart(props, mascot)
end
for _, side in ipairs({ -1, 1 }) do
	facePart({ Name = "Eye", Shape = Enum.PartType.Ball, Size = Vector3.new(3.4, 3.8, 3.4), CFrame = CFrame.new(side * 2.4, 1.6, 6.1), Color = rgb(255, 255, 255), CanCollide = false })
	facePart({ Name = "Pupil", Shape = Enum.PartType.Ball, Size = Vector3.new(2, 2.3, 2), CFrame = CFrame.new(side * 2.4, 1.4, 7.4), Color = rgb(25, 20, 35), CanCollide = false })
	facePart({ Name = "Shine", Shape = Enum.PartType.Ball, Size = Vector3.new(0.7, 0.7, 0.7), CFrame = CFrame.new(side * 2.4 + 0.5, 2.1, 8.3), Material = Enum.Material.Neon, Color = rgb(255, 255, 255), CanCollide = false })
	facePart({ Name = "Cheek", Shape = Enum.PartType.Ball, Size = Vector3.new(1.6, 1, 0.6), CFrame = CFrame.new(side * 4.3, -0.9, 5.7), Color = rgb(255, 120, 150), CanCollide = false })
end
facePart({ Name = "Smile", Shape = Enum.PartType.Ball, Size = Vector3.new(4.4, 1.5, 1.4), CFrame = CFrame.new(0, -1.9, 6.4), Color = rgb(60, 20, 30), CanCollide = false })
-- The face looks at +Z (the spawn); every part keeps its offset from the body as it moves.
local mascotHome = CFrame.new(0, 17, 0)
local mascotParts = {}
for _, p in ipairs(mascot:GetDescendants()) do
	if p:IsA("BasePart") then
		mascotParts[p] = p.CFrame
	end
end
RunService.Heartbeat:Connect(function()
	local t = os.clock()
	local cf = mascotHome * CFrame.new(0, math.sin(t * 1.4) * 1.2, 0) * CFrame.Angles(0, math.sin(t * 0.5) * 0.7, 0)
	for p, off in pairs(mascotParts) do
		p.CFrame = cf * off
	end
end)
local sign = lobbyPart({ Name = "Sign", Size = Vector3.new(1, 1, 1), CFrame = CFrame.new(0, 31, 0), Transparency = 1, CanCollide = false, CanQuery = false, CanTouch = false })
bigText(sign, "MARBLE DUELS", { rgb(255, 240, 90), rgb(255, 140, 40) }, Vector2.new(46, 8))
bigText(sign, "🎃 HALLOWEEN LIMITED 🎃", { rgb(255, 200, 120), rgb(255, 110, 30) }, Vector2.new(30, 3.4), Vector3.new(0, -5.2, 0))

-- Round toy trees round the lawn.
local treeColors = { rgb(120, 225, 90), rgb(255, 160, 205), rgb(255, 200, 80), rgb(90, 210, 150) }
local decor = Random.new(7)
for i = 0, 21 do
	local a = (i + 0.3) / 22 * math.pi * 2
	local d = 72 + decor:NextNumber() * 18
	local at = Vector3.new(math.cos(a) * d, 0, math.sin(a) * d)
	local h = 6 + decor:NextNumber() * 4
	local c = 9 + decor:NextNumber() * 5
	if math.abs(at.X) < 14 and at.Z > 0 then
		continue -- keep the view from the spawn clear
	end
	lobbyPart({ Name = "Trunk", Size = Vector3.new(1.8, h, 1.8), CFrame = CFrame.new(at + Vector3.new(0, h / 2, 0)), Color = rgb(150, 95, 55) })
	lobbyPart({ Name = "Crown", Shape = Enum.PartType.Ball, Size = Vector3.new(c, c, c), CFrame = CFrame.new(at + Vector3.new(0, h + c * 0.35, 0)), Color = treeColors[i % #treeColors + 1] })
end

-- Halloween: carved pumpkins glowing round the plaza's edge.
for i = 0, 11 do
	local a = i / 12 * math.pi * 2 + 0.26
	local pos = Vector3.new(math.cos(a) * 56, 2.2, math.sin(a) * 56)
	local pumpkin = lobbyPart({ Name = "Pumpkin", Shape = Enum.PartType.Ball, Size = Vector3.new(5, 4.4, 5), CFrame = CFrame.lookAt(pos, Vector3.new(0, 2.2, 0)), Color = rgb(255, 120, 20) })
	local glow = Instance.new("PointLight")
	glow.Color = rgb(255, 170, 60)
	glow.Range = 14
	glow.Brightness = 1.6
	glow.Parent = pumpkin
	lobbyPart({ Name = "Stem", Size = Vector3.new(0.6, 1.2, 0.6), CFrame = CFrame.new(pos + Vector3.new(0, 2.6, 0)), Color = rgb(70, 150, 50) })
	local face = Instance.new("SurfaceGui")
	face.Face = Enum.NormalId.Front
	face.LightInfluence = 0
	face.Parent = pumpkin
	local eyes = Instance.new("TextLabel")
	eyes.Size = UDim2.fromScale(1, 1)
	eyes.BackgroundTransparency = 1
	eyes.Text = "▲ ▲\n◡◡◡"
	eyes.TextScaled = true
	eyes.Font = Enum.Font.FredokaOne
	eyes.TextColor3 = rgb(255, 230, 120)
	eyes.Parent = face
end

local spawn = Instance.new("SpawnLocation")
spawn.Anchored = true
spawn.Size = Vector3.new(10, 1, 10)
spawn.CFrame = CFrame.new(0, 0.5, 38)
spawn.Material = Enum.Material.Neon
spawn.Color = rgb(255, 205, 50)
spawn.Duration = 0
spawn.Parent = lobby
-- The board's text is on its Front (-Z) face; turned round so it faces the spawn at +Z.
Leaderboard.board(CFrame.new(0, 10, -40) * CFrame.Angles(0, math.pi, 0), lobby)

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
