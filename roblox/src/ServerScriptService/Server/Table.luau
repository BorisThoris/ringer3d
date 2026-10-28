-- One table: a field, thirteen marbles, two (or more) seats, and the turns, played out on the
-- server's own physics. Seats are players or bots; with only bots it plays itself (the cloud
-- smoke test does exactly that).
--
-- Physics: Roblox spheres roll almost forever, so rolling resistance is applied by hand each
-- step (the web game's `rollDecel`), and a safety net sets down anything that ever gets past the
-- kerb or under the ground, so no shot can hang (the web game's 16 s softlock).

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Players = game:GetService("Players")

local Config = require(ReplicatedStorage.Ringer.Config)
local Rules = require(ReplicatedStorage.Ringer.Rules)
local Bot = require(ReplicatedStorage.Ringer.Bot)
local MarbleLook = require(ReplicatedStorage.Ringer.MarbleLook)
local Arena = require(script.Parent.Arena)

export type Seat = {
	kind: "player" | "bot",
	player: Player?,
	bot: string?, -- profile id
	name: string,
	marble: string,
	trail: boolean?,
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
	self.arena = Config.ARENAS[opts.arena] or Config.ARENAS.desk
	self.rng = Random.new(opts.seed or os.clock() * 1e6)
	self.send = opts.send or function() end
	self.finished = opts.finished or function() end
	self.scores = table.create(#opts.seats, 0)
	self.captured = {}
	for i = 1, #opts.seats do
		self.captured[i] = {}
	end
	self.current = self.rng:NextInteger(1, #opts.seats)
	self.firstShot = true
	self.shots = 0
	self.dryShots = 0
	self.phase = "aim"
	self.pending = nil -- a shot waiting to be played
	self.closed = false

	local model = Instance.new("Model")
	model.Name = "Table" .. self.id
	model.Parent = opts.parent or workspace
	self.model = model
	self.built = Arena.build(opts.origin, self.arena, #opts.seats, self.rng, model)
	self.origin = opts.origin

	-- The thirteen marbles, in the cross.
	local marbles = Instance.new("Folder")
	marbles.Name = "Marbles"
	marbles.Parent = model
	self.marbleFolder = marbles
	self.mibs = {}
	local physics = { density = 2.6, friction = 0.3, elasticity = self.arena.elasticity }
	for i, p in ipairs(Rules.startingCross()) do
		local colors = Config.MIB_COLORS[(i - 1) % #Config.MIB_COLORS + 1]
		local look = { id = "mib", name = "Mib", rarity = "Common", shell = colors[1], core = colors[2], material = Enum.Material.Glass, transparency = 0.3, glow = 0.2 }
		local ball = MarbleLook.make(look :: any, Config.MIB_R, physics)
		ball.Name = "Mib" .. i
		ball.Anchored = false
		ball.CFrame = CFrame.new(self:world(p, Config.MIB_R))
		ball.Parent = marbles
		ball:SetNetworkOwner(nil)
		table.insert(self.mibs, ball)
	end
	self.shooter = nil :: BasePart?
	return self
end

-- ---- Coordinates: ring-relative (x, z) on the ground <-> world ---------------------------
function Table:world(p: Vector2, radius: number): Vector3
	return self.origin + Vector3.new(p.X, radius, p.Y)
end

function Table:flat(v: Vector3): Vector2
	local d = v - self.origin
	return Vector2.new(d.X, d.Z)
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

--- What clients need to draw the table's HUD.
function Table:state()
	local seats = {}
	for i, s in ipairs(self.seats) do
		seats[i] = { name = s.name, marble = s.marble, bot = s.kind == "bot" and Config.BOTS[s.bot or "casual"].label or nil, userId = s.player and s.player.UserId or nil, score = self.scores[i] }
	end
	return {
		id = self.id,
		mode = self.mode,
		floor = self.floor,
		arena = self.arena.id,
		arenaName = self.arena.name,
		origin = self.origin,
		seats = seats,
		current = self.current,
		phase = self.phase,
		firstShot = self.firstShot,
		shooter = self.shooter and self.shooter.Position or nil,
		remaining = #self.mibs,
		turnEnds = self.turnEnds,
		seatAngle = Rules.seatAngle(self.current, #self.seats),
	}
end

function Table:broadcast(kind: string, data: any)
	self.send(self, kind, data)
end

--- A player's shot arrives. Ignored unless it is that player's turn and the numbers are sane.
function Table:submit(player: Player, placeAngle: number, aimAngle: number, power: number): boolean
	local seat = self:seatOf(player)
	if self.phase ~= "aim" or seat ~= self.current or self.pending then
		return false
	end
	for _, v in ipairs({ placeAngle, aimAngle, power }) do
		if typeof(v) ~= "number" or v ~= v or math.abs(v) > 1e6 then
			return false
		end
	end
	self.pending = { placeAngle = placeAngle, aimAngle = aimAngle, power = math.clamp(power, 0.05, 1) }
	return true
end

-- ---- One shot -----------------------------------------------------------------------------
function Table:launch(shot)
	local seat = self.seats[self.current]
	if self.firstShot or not self.shooter then
		if self.shooter then
			self.shooter:Destroy()
		end
		local look = Config.MARBLE[seat.marble] or Config.MARBLE.ember
		local ball = MarbleLook.make(look, Config.SHOOTER_R, { density = 2.6, friction = 0.3, elasticity = self.arena.elasticity })
		ball.Name = "Shooter"
		ball.Anchored = false
		ball.CFrame = CFrame.new(self:world(Rules.placement(shot.placeAngle), Config.SHOOTER_R))
		if seat.trail then
			MarbleLook.addTrail(ball, look.core)
		end
		ball.Parent = self.marbleFolder
		ball:SetNetworkOwner(nil)
		self.shooter = ball
	end
	local dir = Vector3.new(math.cos(shot.aimAngle), 0, math.sin(shot.aimAngle))
	local v = dir * shot.power * Config.MAX_SPEED
	local shooter = self.shooter :: BasePart
	shooter.AssemblyLinearVelocity = v
	-- Rolling, not sliding, from the start: spin to match the speed.
	shooter.AssemblyAngularVelocity = Vector3.new(v.Z, 0, -v.X) / Config.SHOOTER_R
	self.shots += 1
	self.phase = "rolling"
	self:broadcast("shot", { seat = self.current, aimAngle = shot.aimAngle, power = shot.power })
end

function Table:bodies(): { BasePart }
	local out = table.clone(self.mibs)
	if self.shooter then
		table.insert(out, self.shooter)
	end
	return out
end

--- Step the rolling resistance and the safety net until everything rests (or the cap).
function Table:roll()
	local started = os.clock()
	local still = 0
	local decel = self.arena.rollDecel
	local floorY = self.origin.Y
	while true do
		local dt = RunService.Heartbeat:Wait()
		local moving = false
		for _, b in ipairs(self:bodies()) do
			local r = b.Size.X / 2
			local p = b.Position
			local flat = self:flat(p)
			-- Safety net: past the kerb or under the ground -> set down inside the kerb, at rest.
			if p.Y < floorY - 3 or flat.Magnitude > Config.BOUND_R + 2 then
				local d = flat.Magnitude > 1e-3 and flat.Unit or Vector2.new(1, 0)
				b.AssemblyLinearVelocity = Vector3.zero
				b.AssemblyAngularVelocity = Vector3.zero
				b.CFrame = CFrame.new(self:world(d * (Config.BOUND_R - 3), r))
				continue
			end
			local v = b.AssemblyLinearVelocity
			local grounded = p.Y < floorY + r + 0.25
			if grounded then
				local h = Vector3.new(v.X, 0, v.Z)
				local sp = h.Magnitude
				if sp > 0 then
					local f = math.max(0, sp - decel * dt) / sp
					b.AssemblyLinearVelocity = Vector3.new(v.X * f, v.Y, v.Z * f)
					b.AssemblyAngularVelocity = b.AssemblyAngularVelocity * f
				end
			end
			if b.AssemblyLinearVelocity.Magnitude > Config.REST_SPEED then
				moving = true
			end
		end
		still = moving and 0 or still + dt
		if still >= Config.REST_TIME or os.clock() - started > Config.SHOT_CAP then
			break
		end
	end
	for _, b in ipairs(self:bodies()) do
		b.AssemblyLinearVelocity = Vector3.zero
		b.AssemblyAngularVelocity = Vector3.zero
	end
end

--- Score the shot and decide whose turn it is. Returns true when the game is over.
function Table:resolve(): boolean
	local seat = self.current
	local capturedNow = 0
	self.dryShots += 1
	for i = #self.mibs, 1, -1 do
		local ball = self.mibs[i]
		if Rules.isOutside(self:flat(ball.Position)) then
			table.remove(self.mibs, i)
			capturedNow += 1
			self.dryShots = 0
			self.scores[seat] += 1
			table.insert(self.captured[seat], ball.Name)
			self:broadcast("capture", { seat = seat, pos = ball.Position })
			ball.Anchored = true
			ball.CanCollide = false
			task.delay(0.6, function()
				ball:Destroy()
			end)
		end
	end
	local shooterOut = not self.shooter or Rules.isOutside(self:flat((self.shooter :: BasePart).Position))
	if shooterOut then
		self:broadcast("shooterOut", { seat = seat })
	end

	local winners = Rules.gameOver(self.scores, #self.mibs, self.dryShots)
	if winners then
		self.winners = winners
		return true
	end
	if capturedNow > 0 and not shooterOut then
		self.firstShot = false
		self:broadcast("shootAgain", { seat = seat })
	else
		if self.shooter then
			self.shooter:Destroy()
			self.shooter = nil
		end
		self.firstShot = true
		self.current = self.current % #self.seats + 1
	end
	return false
end

-- ---- The game loop ----------------------------------------------------------------------
function Table:wait(seconds: number): boolean
	local t = os.clock() + seconds
	while os.clock() < t do
		if self.closed then
			return false
		end
		task.wait(0.1)
	end
	return not self.closed
end

--- Play the whole game; returns the result (also passed to `finished`).
function Table:run(): Result
	task.wait(0.5)
	while not self.closed and not self.abandoned do
		local seat = self.seats[self.current]
		self.phase = "aim"
		self.pending = nil
		self.turnEnds = workspace:GetServerTimeNow() + Config.TURN_TIME
		self:broadcast("state", self:state())

		if seat.kind == "bot" then
			if not self:wait(0.6 + self.rng:NextNumber() * 0.9) then
				break
			end
			local from = (not self.firstShot and self.shooter) and self:flat((self.shooter :: BasePart).Position) or nil
			local mibs = {}
			for _, b in ipairs(self.mibs) do
				table.insert(mibs, self:flat(b.Position))
			end
			self.pending = Bot.plan(from, mibs, self.arena.rollDecel, Config.BOTS[seat.bot or "casual"], self.rng)
		else
			-- A player has TURN_TIME to shoot; then a weak shot is taken for them.
			while not self.pending and not self.closed do
				if not (seat.player and seat.player.Parent) then
					self.abandoned = self.current
					break
				end
				if workspace:GetServerTimeNow() > self.turnEnds then
					local a = Rules.seatAngle(self.current, #self.seats)
					self.pending = { placeAngle = a, aimAngle = a + math.pi, power = 0.15 }
					break
				end
				task.wait(0.1)
			end
			if self.abandoned then
				break
			end
		end
		if self.closed then
			break
		end
		self:launch(self.pending)
		self:roll()
		if self:resolve() then
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
end

return Table
