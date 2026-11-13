-- One table: a field, its map, thirteen marbles, two (or more) seats, and the turns. Every shot
-- is played on Ringer.Sim, the web game's physics in Luau, from the table's layout: the server
-- plays it to the end at once (its result is final), tells the players the shot, and waits while
-- each client replays the same shot frame by frame. Seats are players or bots; with only bots
-- it plays itself (the cloud tests do exactly that, with `instant` set so nothing waits).
--
-- The rules are the web game's Match (src/core/match.ts): knuckle down anywhere on the line for
-- a turn's first shot, keep what you knock out, shoot again from where the taw stopped if you
-- captured and stayed in, otherwise the turn passes; the game ends when the ring is empty, the
-- lead can't be caught, or 40 shots in a row capture nothing.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Ringer.Config)
local Rules = require(ReplicatedStorage.Ringer.Rules)
local Bot = require(ReplicatedStorage.Ringer.Bot)
local Sim = require(ReplicatedStorage.Ringer.Sim)
local Surfaces = require(ReplicatedStorage.Ringer.Surfaces)
local Playback = require(ReplicatedStorage.Ringer.Playback)
local Forge = require(ReplicatedStorage.Ringer.Forge)
local MarbleLook = require(ReplicatedStorage.Ringer.MarbleLook)
local Maps = require(ReplicatedStorage.Ringer.Maps)
local Arena = require(script.Parent.Arena)
local Pieces = require(script.Parent.Pieces)

local S = Config.MAP_SCALE

export type Seat = {
	kind: "player" | "bot",
	player: Player?,
	bot: string?, -- profile id
	name: string,
	marble: string,
	trail: boolean?,
	fast: boolean?, -- this player has fast-forward on
}

export type Result = {
	winners: { number },
	scores: { number },
	captured: { { string } },
	shots: number,
	abandoned: number?, -- seat that left mid-game
}

local Table = {}
Table.__index = Table

local nextId = 0

function Table.new(opts: {
	seats: { Seat },
	arena: string,
	origin: Vector3,
	mode: string,
	floor: number?,
	seed: number?,
	difficulty: string?, -- the generated map's: easy, medium, hard
	mapSeed: number?,
	guide: string?, -- the most aim guide allowed: full, short, off
	series: { number }?, -- games won so far on a best-of floor, [you, them]
	wins: number?, -- games to win the series
	instant: boolean?, -- no waiting for replays or thinking (tests)
	watched: ((n: number) -> boolean)?, -- a test standing in for a player: true once shot n was watched
	send: ((tbl: any, kind: string, data: any) -> ())?,
	finished: ((tbl: any, result: Result) -> ())?,
	parent: Instance?,
})
	nextId += 1
	local self = setmetatable({}, Table)
	self.id = nextId
	self.mode = opts.mode
	self.floor = opts.floor
	self.seats = opts.seats
	self.instant = opts.instant == true
	self.watched = opts.watched
	self.guide = opts.guide or "full"
	self.series = opts.series
	self.wins = opts.wins
	self.arena = Config.ARENAS[opts.arena] or Config.ARENAS.desk
	self.surface = Surfaces[self.arena.id]
	self.seed = opts.seed or math.floor(os.clock() * 1e6) % 2147483647
	self.rng = Random.new(self.seed)
	self.send = opts.send or function() end
	self.finished = opts.finished or function() end
	self.scores = table.create(#opts.seats, 0)
	self.captured = {}
	for i = 1, #opts.seats do
		self.captured[i] = {}
	end
	-- Who lags first comes from the match seed, as in the web game.
	self.current = Forge.Rng.new(self.seed):int(#opts.seats) + 1
	self.firstShot = true
	self.shots = 0
	self.dryShots = 0
	self.phase = "aim"
	self.pending = nil -- a shot waiting to be played
	self.acks = {} -- players who finished watching the shot in flight
	self.closed = false

	local model = Instance.new("Model")
	model.Name = "Table" .. self.id
	model.Parent = opts.parent or workspace
	self.model = model
	self.built = Arena.build(opts.origin, self.arena, #opts.seats, self.rng, model, true)
	self.origin = opts.origin
	-- The field's generated map, exactly as the web game lays it out for the same spec.
	self.difficulty = if opts.difficulty and table.find(Maps.DIFFICULTIES, opts.difficulty) then opts.difficulty else "medium"
	self.mapSeed = opts.mapSeed or self.rng:NextInteger(1, 2 ^ 31 - 1)
	self.map = Maps.generate(self.arena.id, self.difficulty, self.mapSeed)
	Pieces.build(self.map, opts.origin, model)
	self.mapFolder = model:FindFirstChild("Map")

	self.layout = Sim.startingLayout()
	local marbles = Instance.new("Folder")
	marbles.Name = "Marbles"
	marbles.Parent = model
	self.marbleFolder = marbles
	self.parts = {} :: { [number]: BasePart } -- by marble id; the taw is Sim.SHOOTER_ID
	for _, t in ipairs(self.layout.targets) do
		local ball = MarbleLook.make(MarbleLook.mib(t.id), Config.MIB_R, nil, t.id * 1.37 + 0.5)
		ball.Name = "Mib" .. t.id
		ball.Anchored = true
		ball.CanCollide = false
		ball.CFrame = CFrame.new(self:world(t.x, t.y, t.z))
		ball.Parent = marbles
		self.parts[t.id] = ball
	end
	self.rot = {} :: { [number]: CFrame } -- each marble's turn, from the spin it rolled with
	return self
end

-- ---- Coordinates: web units on the ring <-> studs in the world ----------------------------
function Table:world(x: number, y: number, z: number): Vector3
	return self.origin + Vector3.new(x * S, y * S, z * S)
end

function Table:seatOf(player: Player): number?
	for i, s in ipairs(self.seats) do
		if s.player == player then
			return i
		end
	end
	return nil
end

function Table:players(): { Player }
	local out = {}
	for _, s in ipairs(self.seats) do
		if s.player and s.player.Parent then
			table.insert(out, s.player)
		end
	end
	return out
end

--- What clients need to draw the table, aim, and replay the next shot exactly.
function Table:state()
	local seats = {}
	for i, s in ipairs(self.seats) do
		seats[i] = { name = s.name, marble = s.marble, bot = s.kind == "bot" and Config.BOTS[s.bot or "casual"].label or nil, userId = if s.player and s.player:IsA("Player") then s.player.UserId else nil, score = self.scores[i] }
	end
	local shooter = self.layout.shooter
	return {
		id = self.id,
		mode = self.mode,
		floor = self.floor,
		arena = self.arena.id,
		arenaName = self.arena.name,
		mapName = self.map.name,
		difficulty = self.difficulty,
		mapSeed = self.mapSeed,
		origin = self.origin,
		seats = seats,
		current = self.current,
		phase = self.phase,
		firstShot = self.firstShot,
		shooter = if shooter and not self.firstShot then self:world(shooter.x, shooter.y, shooter.z) else nil,
		remaining = #self.layout.targets,
		seatAngle = Rules.seatAngle(self.current, #self.seats),
		shots = self.shots,
		layout = self.layout,
		guide = self.guide,
		series = self.series,
		wins = self.wins,
	}
end

function Table:broadcast(kind: string, data: any)
	self.send(self, kind, data)
end

--- A player's shot arrives. Ignored unless it is that player's turn and the numbers are sane.
function Table:submit(player: Player, placeAngle: number, aimAngle: number, power: number, spin: number?): boolean
	local seat = self:seatOf(player)
	if self.phase ~= "aim" or seat ~= self.current or self.pending then
		return false
	end
	for _, v in ipairs({ placeAngle, aimAngle, power }) do
		if typeof(v) ~= "number" or v ~= v or math.abs(v) > 1e6 then
			return false
		end
	end
	if power < Config.MIN_POWER then
		return false
	end
	local s = if typeof(spin) == "number" and spin == spin then math.clamp(spin, -1, 1) else 0
	self.pending = { placeAngle = placeAngle, aimAngle = aimAngle, power = math.clamp(power, 0, 1), spin = s }
	return true
end

--- A player left the table (quit or disconnected). As in the web game, a skilled bot takes
--- their seat and the game goes on; with nobody left to play for, it ends.
function Table:lose(player: Player)
	local seat = self:seatOf(player)
	if not seat then
		return
	end
	local s = self.seats[seat]
	s.player = nil
	s.kind = "bot"
	s.bot = s.bot or "skilled"
	s.lost = true
	self:broadcast("seatLost", { seat = seat, name = s.name })
	if #self:players() == 0 then
		self.abandoned = seat
	end
end

--- A player finished watching shot `n` (their replay ended).
function Table:ack(player: Player, n: number)
	if n == self.shots then
		self.acks[player] = true
	end
end

--- A player turned fast-forward on or off.
function Table:setFast(player: Player, on: boolean)
	local seat = self:seatOf(player)
	if seat then
		self.seats[seat].fast = on == true
	end
end

-- ---- One shot -----------------------------------------------------------------------------

--- Make sure there is a taw part for the shooter in play.
function Table:shooterPart(): BasePart
	local seat = self.seats[self.current]
	local ball = self.parts[Sim.SHOOTER_ID]
	if ball and ball:GetAttribute("Seat") == self.current then
		return ball
	end
	if ball then
		ball:Destroy()
	end
	local look = MarbleLook.lookFor(seat.marble)
	ball = MarbleLook.make(look, Config.SHOOTER_R, nil, self.current - 1 + 7)
	ball.Name = "Shooter"
	ball.Anchored = true
	ball.CanCollide = false
	ball:SetAttribute("Seat", self.current)
	if seat.trail then
		MarbleLook.addTrail(ball, look.core)
	end
	ball.Parent = self.marbleFolder
	self.parts[Sim.SHOOTER_ID] = ball
	self.rot[Sim.SHOOTER_ID] = CFrame.identity
	return ball
end

--- Play `shot` on the sim, let the players watch it, then score it. True when the game is over.
function Table:play(shot): boolean
	shot = Sim.quantizeShot(shot)
	local before = self.layout
	local first = self.firstShot
	local sim = Sim.new(before, self.surface, shot, first, self.map.pieces)
	local tawPart = self:shooterPart()
	if first then
		self.rot[Sim.SHOOTER_ID] = CFrame.identity
	end
	local b0 = sim.shooter
	if b0 then
		tawPart.CFrame = CFrame.new(self:world(b0.px, b0.py, b0.pz)) * self.rot[Sim.SHOOTER_ID]
	end
	local crossStep = nil
	local broken = {}
	while not sim.done do
		sim:step()
		Playback.spin(sim, self.rot)
		if not crossStep and Playback.crossedNow(sim) then
			crossStep = sim.steps
		end
		for _, p in ipairs(sim.broke) do
			table.insert(broken, { i = p.i, skin = p.piece.skin or p.piece.kind, pos = self:world(p.x, p.h / 2, p.z) })
		end
	end
	local after = sim:resultLayout()
	local holed = sim.holed

	self.shots += 1
	self.phase = "rolling"
	table.clear(self.acks)
	self:broadcast("shot", {
		seat = self.current,
		n = self.shots,
		shot = shot,
		first = first,
		layout = before,
		steps = sim.steps,
		crossStep = crossStep,
	})

	-- The players watch it: until each has replayed it, or as long as it takes at full speed.
	if not self.instant then
		local fastAll = true
		local humans = self:players()
		for _, s in ipairs(self.seats) do
			if s.player and not s.fast then
				fastAll = false
			end
		end
		local limit = os.clock() + Playback.duration(sim.steps, crossStep, false) + 1.5
		local soonest = os.clock() + Playback.duration(sim.steps, crossStep, fastAll and #humans > 0) * 0.9
		while os.clock() < limit and not self.closed do
			local all = os.clock() >= soonest
			for _, p in ipairs(humans) do
				if p.Parent and not self.acks[p] then
					all = false
				end
			end
			if self.watched then
				all = self.watched(self.shots)
			end
			if all and (#humans > 0 or self.watched or os.clock() >= soonest) then
				break
			end
			task.wait(0.05)
		end
	end

	-- The table now shows where everything came to rest (clients already replayed it there).
	for _, b in ipairs(after.targets) do
		local part = self.parts[b.id]
		if part then
			local cup = holed[b.id]
			local x, y, z = b.x, b.y, b.z
			if cup then
				x, y, z = cup.x, -1, cup.z
			end
			part.CFrame = CFrame.new(self:world(x, y, z)) * (self.rot[b.id] or CFrame.identity)
		end
	end
	local taw = after.shooter
	if taw and tawPart then
		tawPart.CFrame = CFrame.new(self:world(taw.x, taw.y, taw.z)) * (self.rot[Sim.SHOOTER_ID] or CFrame.identity)
	end
	for _, p in ipairs(after.props or {}) do
		local part = self.mapFolder and self.mapFolder:FindFirstChild("Prop" .. p.i)
		if part then
			if p.broken then
				part:Destroy()
			else
				part.CFrame = Playback.propCFrame(self.map.pieces[p.i], p, self.origin, S)
			end
		end
	end
	for _, b in ipairs(broken) do
		self:broadcast("break", b)
	end
	for id, cup in pairs(holed) do
		self:broadcast("cup", { pos = self:world(cup.x, 0, cup.z), id = id })
	end
	return self:resolve(after, holed)
end

-- Bots react like players do, once the shot has played out on the clients: pleased with a
-- capture, impressed by a big one from someone else, glum when their marble flies out.
local BOT_EMOTES = { mine = { "🔥", "😎", "👏" }, theirs = { "😮", "👏" }, out = { "😭", "😂" } }
function Table:botReactions(seat: number, took: number, shooterOut: boolean)
	-- Its own dice, so reactions never shift the game's.
	self.emoteRng = self.emoteRng or Random.new((self.seed or 1) + 7919)
	local rng = self.emoteRng
	local picks = {}
	for i, s in ipairs(self.seats) do
		if s.kind == "bot" then
			local list = nil
			if i == seat and took > 0 and rng:NextNumber() < 0.55 then
				list = BOT_EMOTES.mine
			elseif i == seat and shooterOut and rng:NextNumber() < 0.3 then
				list = BOT_EMOTES.out
			elseif i ~= seat and took >= 2 and rng:NextNumber() < 0.5 then
				list = BOT_EMOTES.theirs
			end
			if list then
				table.insert(picks, { seat = i, e = list[rng:NextInteger(1, #list)] })
			end
		end
	end
	if #picks > 0 then
		task.delay(2.4, function()
			for _, p in ipairs(picks) do
				self:broadcast("emote", p)
			end
		end)
	end
end

--- Score the shot and decide whose turn it is (the web game's Match.resolve).
function Table:resolve(after, holed): boolean
	local seat = self.current
	self.dryShots += 1
	local kept = {}
	local took = 0
	for _, t in ipairs(after.targets) do
		if Sim.isOutsideRing(t.x, t.z) then
			self.dryShots = 0
			self.scores[seat] += 1
			took += 1
			table.insert(self.captured[seat], "Mib" .. t.id)
			local part = self.parts[t.id]
			local cup = holed[t.id]
			local pos = if cup then self:world(cup.x, 0, cup.z) else self:world(t.x, t.y, t.z)
			self:broadcast("capture", { seat = seat, pos = pos, id = t.id })
			if part then
				self.parts[t.id] = nil
				task.delay(0.6, function()
					part:Destroy()
				end)
			end
		else
			table.insert(kept, t)
		end
	end
	after.targets = kept
	local shooter = after.shooter
	local shooterOut = not shooter or Sim.isOutsideRing(shooter.x, shooter.z)
	if shooterOut then
		self:broadcast("shooterOut", { seat = seat })
	end
	self.layout = after
	self:botReactions(seat, took, shooterOut)

	local winners = Rules.gameOver(self.scores, #after.targets, self.dryShots)
	if winners then
		self.winners = winners
		self.layout.shooter = nil
		return true
	end
	local capturedNow = self.dryShots == 0
	if capturedNow and not shooterOut then
		self.firstShot = false
		self:broadcast("shootAgain", { seat = seat })
	else
		-- Turn passes: the shooter is picked up.
		self.layout.shooter = nil
		local taw = self.parts[Sim.SHOOTER_ID]
		if taw then
			taw:Destroy()
			self.parts[Sim.SHOOTER_ID] = nil
		end
		self.firstShot = true
		self.current = self.current % #self.seats + 1
	end
	return false
end

-- ---- The game loop ----------------------------------------------------------------------
function Table:wait(seconds: number): boolean
	if self.instant then
		return not self.closed
	end
	local t = os.clock() + seconds
	while os.clock() < t do
		if self.closed then
			return false
		end
		task.wait(0.05)
	end
	return not self.closed
end

--- Is anyone watching this table with fast-forward on (a bot's preparation plays faster)?
function Table:fast(): boolean
	local any, all = false, true
	for _, s in ipairs(self.seats) do
		if s.player then
			any = true
			all = all and s.fast == true
		end
	end
	return any and all
end

--- A yield for long work: gives the frame back once this slice has run 12 ms (of a 16 ms frame), so a bot's think
--- (or several at once) never stalls the server.
function Table.slicer(): () -> ()
	local since = os.clock()
	return function()
		if os.clock() - since > 0.012 then
			task.wait()
			since = os.clock()
		end
	end
end

--- A bot's turn: think (imagining shots on the sim), then show the aim and fire.
function Table:botTurn(seat)
	local profile = Config.BOTS[seat.bot or "casual"]
	local rng = Bot.rng(self.seed, self.shots, self.current - 1)
	local started = os.clock()
	local seatAngle = Rules.seatAngle(self.current, #self.seats)
	local shot = Bot.plan({
		layout = self.layout,
		firstShot = self.firstShot,
		seatAngle = seatAngle,
		surface = self.surface,
		pieces = self.map.pieces,
	}, profile, rng, Table.slicer())
	if self.closed then
		return nil
	end
	local think = rng:range(profile.thinkMs[1], profile.thinkMs[2]) / 1000
	local speed = if self:fast() then Playback.FAST else 1
	if not self:wait(math.max(0, think - (os.clock() - started)) / speed) then
		return nil
	end
	-- Clients swing the aim round to the shot and charge it, as the web game does.
	self:broadcast("prepare", { seat = self.current, shot = shot, duration = 1.4 })
	if not self:wait(1.4 / speed) then
		return nil
	end
	return shot
end

--- Play the whole game; returns the result (also passed to `finished`).
function Table:run(): Result
	if not self.instant then
		task.wait(0.5)
	end
	while not self.closed and not self.abandoned do
		local seat = self.seats[self.current]
		self.phase = "aim"
		self.pending = nil
		self:broadcast("state", self:state())

		-- A beat before anyone acts: 1.1 s for a new turn, 0.7 s to shoot again (the web game's).
		if not self:wait(if self.firstShot then 1.1 else 0.7) then
			break
		end
		if seat.kind == "bot" then
			self.pending = self:botTurn(seat)
		else
			-- No clock, as in the web game: the player shoots when ready. If they go, a bot
			-- takes the seat (Table:lose) and this turn is played by it.
			while not self.pending and not self.closed and not self.abandoned and seat.kind ~= "bot" do
				if seat.player and not seat.player.Parent then
					self:lose(seat.player)
					break
				end
				task.wait(0.05)
			end
			if self.abandoned then
				break
			end
			if seat.kind == "bot" and not self.pending then
				self.pending = self:botTurn(seat)
			end
		end
		if self.closed or not self.pending then
			break
		end
		if self:play(self.pending) then
			break
		end
	end

	self.phase = "over"
	local result: Result = {
		winners = self.winners or {},
		scores = table.clone(self.scores),
		captured = self.captured,
		shots = self.shots,
		abandoned = self.abandoned,
	}
	if self.abandoned then
		-- Whoever stayed wins.
		result.winners = {}
		for i = 1, #self.seats do
			if i ~= self.abandoned then
				table.insert(result.winners, i)
			end
		end
	end
	self.result = result
	self:broadcast("state", self:state())
	self.finished(self, result)
	return result
end

function Table:destroy()
	self.closed = true
	self.model:Destroy()
	Arena.clear(self.origin)
end

return Table
