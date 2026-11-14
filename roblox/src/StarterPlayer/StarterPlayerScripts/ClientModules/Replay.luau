-- Watching a shot: the server sends the shot and the layout it was played from, and this
-- replays it on Ringer.Sim, the same physics the server used, frame by frame (fast-forward and
-- the capture slow motion as the web game plays them). It moves the table's own marble and prop
-- parts locally; when the server then sets where everything came to rest, that agrees.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Sim = require(ReplicatedStorage.Ringer.Sim)
local Surfaces = require(ReplicatedStorage.Ringer.Surfaces)
local Playback = require(ReplicatedStorage.Ringer.Playback)
local Maps = require(ReplicatedStorage.Ringer.Maps)
local Config = require(ReplicatedStorage.Ringer.Config)

local Replay = {}
Replay.fast = false
Replay.onImpact = function(_kind: string, _strength: number, _pos: Vector3) end
Replay.onCross = function(_pos: Vector3) end
-- A marble that had gone over the line rolled back into the ring.
Replay.onReenter = function(_pos: Vector3) end
Replay.onBreak = function(_pos: Vector3, _color: Color3, _material: Enum.Material) end
-- Every frame: the sim's marbles and the table's centre, for what they kick up off the ground.
Replay.onBodies = function(_bodies: { any }, _origin: Vector3, _dt: number) end
-- Every frame: the marbles' total speed (web units/s), for the rolling sound.
Replay.onFrame = function(_speed: number) end
Replay.playing = false
-- Hit-stop: the replay holds still for a blink on big hits (at most HITSTOP_MAX a shot).
local HITSTOP_MAX = 0.3
local frozenUntil, frozenTotal = 0, 0
function Replay.hitStop(seconds: number)
	local s = math.min(seconds, HITSTOP_MAX - frozenTotal)
	if s > 0.005 then
		frozenTotal += s
		frozenUntil = math.max(frozenUntil, os.clock()) + s
	end
end

local S = Config.MAP_SCALE
local maps = {} -- table id -> pieces
local rots = {} -- table id -> marble id -> CFrame
local conn: RBXScriptConnection? = nil

local function piecesFor(state)
	local m = maps[state.id]
	if not m then
		m = Maps.generate(state.arena, state.difficulty, state.mapSeed).pieces
		maps[state.id] = m
	end
	return m
end

--- Stop any replay in progress (the table closed, or a new shot arrived).
function Replay.stop()
	if conn then
		conn:Disconnect()
		conn = nil
	end
	Replay.playing = false
end

--- Replay `data` (the server's "shot" event) on the table described by `state`; calls `done`
--- when it has played out.
function Replay.play(state, data, done: () -> ())
	Replay.stop()
	local model = Workspace:FindFirstChild("Table" .. state.id)
	if not model then
		done()
		return
	end
	local marbles = model:WaitForChild("Marbles", 2)
	local mapFolder = model:FindFirstChild("Map")
	local pieces = piecesFor(state)
	local origin: Vector3 = state.origin
	local sim = Sim.new(data.layout, Surfaces[state.arena], data.shot, data.first, pieces, { events = true })
	local rot = rots[state.id]
	if not rot then
		rot = {}
		rots[state.id] = rot
	end
	if data.first then
		rot[Sim.SHOOTER_ID] = CFrame.identity
	end
	local parts = {}
	local function partFor(id: number): BasePart?
		local p = parts[id]
		if p and p.Parent then
			return p
		end
		if not marbles then
			return nil
		end
		p = marbles:FindFirstChild(if id == Sim.SHOOTER_ID then "Shooter" else "Mib" .. id) :: BasePart?
		parts[id] = p
		return p
	end
	local function world(x, y, z)
		return origin + Vector3.new(x * S, y * S, z * S)
	end

	local clock = Playback.clock()
	local crossed = false
	-- Marbles already outside the ring when the shot starts don't count as crossing it.
	local outside = {}
	for _, b in ipairs(sim.bodies) do
		if b.id ~= Sim.SHOOTER_ID and Sim.isOutsideRing(b.px, b.pz) then
			outside[b.id] = true
		end
	end
	Replay.playing = true
	frozenUntil, frozenTotal = 0, 0
	-- RenderStepped on a client; Heartbeat lets tests replay on a server.
	local frame = if RunService:IsClient() then RunService.RenderStepped else RunService.Heartbeat
	conn = frame:Connect(function(dt)
		local n = if os.clock() < frozenUntil then 0 else Playback.advance(clock, math.min(dt, 0.1), Replay.fast, crossed)
		for _ = 1, n do
			if sim.done then
				break
			end
			local impacts = sim:step()
			Playback.spin(sim, rot)
			for _, imp in ipairs(impacts) do
				Replay.onImpact(imp.kind, imp.strength, world(imp.x, imp.y, imp.z))
			end
			if not crossed and Playback.crossedNow(sim) then
				crossed = true
			end
			-- Every target marble over the line is a cheer; one rolling back in is a groan.
			for _, b in ipairs(sim.bodies) do
				if b.id ~= Sim.SHOOTER_ID and not b.holed then
					local out = Sim.isOutsideRing(b.px, b.pz)
					-- Back in only when clearly inside, so one on the line doesn't flicker.
					local d = math.sqrt(b.px * b.px + b.pz * b.pz)
					if out and not outside[b.id] then
						outside[b.id] = true
						Replay.onCross(world(b.px, b.py, b.pz))
					elseif d < Sim.WORLD.ringRadius - 0.15 and outside[b.id] then
						outside[b.id] = nil
						Replay.onReenter(world(b.px, b.py, b.pz))
					end
				end
			end
		end
		local speed = 0
		for _, b in ipairs(sim.bodies) do
			speed += math.sqrt(b.vx * b.vx + b.vz * b.vz)
		end
		Replay.onFrame(if sim.done then 0 else speed)
		if n > 0 and not sim.done then
			Replay.onBodies(sim.bodies, origin, math.min(dt, 0.1))
		end
		for _, b in ipairs(sim.bodies) do
			local part = partFor(b.id)
			if part then
				part.CFrame = CFrame.new(world(b.px, b.py, b.pz)) * (rot[b.id] or CFrame.identity)
			end
		end
		if mapFolder then
			for _, p in ipairs(sim.props) do
				local part = mapFolder:FindFirstChild("Prop" .. p.i) :: BasePart?
				if part then
					if p.broken then
						if part.LocalTransparencyModifier < 1 then
							Replay.onBreak(part.Position, part.Color, part.Material)
						end
						part.LocalTransparencyModifier = 1
						for _, d in ipairs(part:GetDescendants()) do
							if d:IsA("BasePart") then
								d.LocalTransparencyModifier = 1
							end
						end
					elseif p.loose then
						part.CFrame = Playback.propCFrame(p.piece, p, origin, S)
					end
				end
			end
		end
		if sim.done then
			Replay.stop()
			Replay.lastLayout = sim:resultLayout()
			done()
		end
	end)
end

--- The table is gone: forget it.
function Replay.forget(id: number)
	maps[id] = nil
	rots[id] = nil
end

return Replay
