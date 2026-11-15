--!strict
-- The downhill race's marble physics: deterministic, fixed-step (60 Hz), plain arithmetic, so the
-- client that races and the server that checks the run get exactly the same result from the same
-- inputs. On the track the marble lives in track space (distance along the path, offset across
-- it): gravity pulls it down the slope and toward the low side of a bank, the turn's pull flings it
-- outward, it rolls, drags, bounces off walls, and boost pads push it. It leaves the track over a
-- crest it is too fast for, off an edge without a wall, into a gap, or when it jumps; in the air it
-- flies in world space until it lands back on any part of the course, or falls and respawns.

local RaceTrack = require(script.Parent.RaceTrack)

local RaceSim = {}

RaceSim.DT = 1 / 60
RaceSim.R = 2 -- marble radius, studs
local G = 110 -- gravity, studs/s^2 (lighter than Roblox's 196 so it feels like a marble, not a rock)
local STEER = 70 -- sideways acceleration at full steer
local PUSH = 22 -- forward push (W)
local BRAKE = 45 -- braking (S)
local ROLL = 3 -- rolling resistance
local DRAG = 0.0042 -- rolling drag on the track, per (stud/s)^2
local AIR_DRAG = 0.0008 -- much less in the air, so a jump carries its speed
local BOOST = 95
local JUMP = 34 -- jump speed off the surface
local WALL_BOUNCE = 0.35
local FALL = 120 -- this far below the course is a fall

export type Input = { steer: number, throttle: number, jump: boolean, respawn: boolean }
export type State = {
	tick: number,
	path: string,
	s: number, u: number,
	vs: number, vu: number,
	air: boolean,
	px: number, py: number, pz: number, -- world (track-origin space) while airborne
	vx: number, vy: number, vz: number,
	checkpoint: number, -- index into course.checkpoints of the last one passed
	finished: boolean,
	finishTick: number,
	respawns: number,
	lastJump: boolean,
	airTicks: number,
	events: { string }, -- what happened this step: "bump", "jump", "land", "boost", "checkpoint", "respawn", "finish", "path:<id>"
}

function RaceSim.new(): State
	local course = RaceTrack.get()
	return {
		tick = 0, path = "main", s = course.checkpoints[1], u = 0, vs = 6, vu = 0,
		air = false, px = 0, py = 0, pz = 0, vx = 0, vy = 0, vz = 0,
		checkpoint = 1, finished = false, finishTick = 0, respawns = 0,
		lastJump = false, airTicks = 0, events = {},
	}
end

local function respawn(st: State)
	local course = RaceTrack.get()
	st.path = "main"
	st.s = course.checkpoints[st.checkpoint]
	st.u, st.vs, st.vu = 0, 55, 0 -- back up to a rolling start, not a crawl
	st.air = false
	st.airTicks = 0
	st.respawns += 1
	table.insert(st.events, "respawn")
end

--- Where the marble's centre is, in world space.
function RaceSim.position(st: State): Vector3
	if st.air then
		return RaceTrack.ORIGIN + Vector3.new(st.px, st.py, st.pz)
	end
	local course = RaceTrack.get()
	local f = RaceTrack.frame(course.paths[st.path], st.s)
	return RaceTrack.world(f, st.u, RaceSim.R)
end

--- Its speed, studs/s.
function RaceSim.speed(st: State): number
	if st.air then
		return math.sqrt(st.vx * st.vx + st.vy * st.vy + st.vz * st.vz)
	end
	return math.sqrt(st.vs * st.vs + st.vu * st.vu)
end

--- The chase camera's position for a marble at `pos` moving along `heading`. On the ground it sits
--- on the track itself `back` studs behind (on the path it forked from, if that's further back), so
--- it follows the bends instead of cutting through the walls on the inside of a curve; in the air
--- it trails straight behind.
function RaceSim.chaseCamera(st: State, pos: Vector3, heading: Vector3): Vector3
	local spd = RaceSim.speed(st)
	local back = 18 + spd * 0.06
	local lift = Vector3.new(0, 7 + spd * 0.02, 0)
	if st.air then
		return pos - heading * back + lift
	end
	local course = RaceTrack.get()
	local p = course.paths[st.path]
	local s = st.s - back
	if s < 0 and p.fork then
		p, s = course.paths[p.fork.path], p.fork.s + s
	end
	local f = RaceTrack.frame(p, math.max(0, s))
	local edge = math.max(0, f.w / 2 - 4)
	return RaceTrack.world(f, math.clamp(st.u * 0.7, -edge, edge), 0) + lift
end

--- Progress down the course, 0..1 (for the HUD and the ghosts' order), by main-path distance.
function RaceSim.progress(st: State): number
	local course = RaceTrack.get()
	local p = course.paths[st.path]
	local s = st.s
	if p.fork and p.merge then
		s = p.fork.s + (p.merge.s - p.fork.s) * (st.s / p.length)
	end
	return math.clamp(s / course.finish, 0, 1)
end

local function takeOff(st: State, f: RaceTrack.Frame, vUp: number)
	-- Track-space velocity to world velocity, plus a push off the surface.
	st.vx = f.tx * st.vs + f.rx * st.vu + f.ux * vUp
	st.vy = f.ty * st.vs + f.ry * st.vu + f.uy * vUp
	st.vz = f.tz * st.vs + f.rz * st.vu + f.uz * vUp
	st.px = f.x + f.rx * st.u + f.ux * RaceSim.R
	st.py = f.y + f.ry * st.u + f.uy * RaceSim.R
	st.pz = f.z + f.rz * st.u + f.uz * RaceSim.R
	st.air = true
	st.airTicks = 0
end

local function onGround(st: State, input: Input)
	local course = RaceTrack.get()
	local path = course.paths[st.path]
	local f = RaceTrack.frame(path, st.s)
	local dt = RaceSim.DT
	-- Gravity along the track and across it (the bank).
	local as = -G * f.ty
	local au = -G * f.ry
	-- The turn: the frame's right vector swings as the track curves; the marble keeps going
	-- straight, so relative to the track it is pushed toward the outside.
	local ahead = RaceTrack.frame(path, math.min(path.length, st.s + 4))
	local turn = ((ahead.tx - f.tx) * f.rx + (ahead.ty - f.ty) * f.ry + (ahead.tz - f.tz) * f.rz) / 4
	au -= turn * st.vs * st.vs
	-- The player.
	au += input.steer * STEER
	if input.throttle > 0 then
		as += PUSH
	elseif input.throttle < 0 and st.vs > 0 then
		as -= BRAKE
	end
	if f.boost > 0 then
		as += BOOST
		table.insert(st.events, "boost")
	end
	-- Losses.
	local v = math.sqrt(st.vs * st.vs + st.vu * st.vu)
	if v > 0.01 then
		local loss = ROLL + DRAG * v * v
		as -= loss * st.vs / v
		au -= loss * st.vu / v
	end
	au -= st.vu * 1.6 -- the marble's grip settles sideways sliding
	st.vs += as * dt
	st.vu += au * dt
	if st.vs < 0 and st.s < course.checkpoints[1] + 1 then
		st.vs = 0
	end
	st.s += st.vs * dt
	st.u += st.vu * dt
	-- Ends of the path: a branch rejoins the main path; the main path ends past the finish.
	if st.s >= path.length then
		if path.merge then
			st.path = path.merge.path
			st.s = path.merge.s + (st.s - path.length)
			table.insert(st.events, "path:" .. st.path)
			return
		end
		st.s = path.length
		st.vs = math.min(st.vs, 0)
	end
	if st.s < 0 then
		st.s, st.vs = 0, 0
	end
	-- Forks: crossing a branch's start on the right half of the track takes the branch.
	if st.path == "main" then
		for _, id in ipairs(course.order) do
			local b = course.paths[id]
			if b.fork and b.fork.path == "main" and st.s >= b.fork.s and st.s - st.vs * dt < b.fork.s and st.u > 1 then
				st.path = id
				st.s = math.max(0, st.s - b.fork.s)
				-- The branch starts on the main path's centre line: the marble keeps its place across.
				st.vu *= 0.2 -- the branch's entry lines the marble up
				table.insert(st.events, "path:" .. id)
				return
			end
		end
	end
	local g = RaceTrack.frame(course.paths[st.path], st.s)
	-- No floor here: into the gap.
	if not g.floor then
		takeOff(st, g, 0)
		return
	end
	-- Walls stop the marble's side (it bounces); with no wall it rolls off once its centre passes
	-- the edge.
	if g.walls and math.abs(st.u) > g.w / 2 - RaceSim.R then
		local half = g.w / 2 - RaceSim.R
		st.u = math.clamp(st.u, -half, half)
		st.vu = -st.vu * WALL_BOUNCE
		st.vs *= 0.985
		table.insert(st.events, "bump")
	elseif not g.walls and math.abs(st.u) > g.w / 2 then
		takeOff(st, g, 0)
		return
	end
	-- Over a crest faster than gravity can hold it: airborne. The bend is measured over 16 studs
	-- so the small kinks where spline pieces meet don't launch it.
	local p2 = course.paths[st.path]
	local back = RaceTrack.frame(p2, math.max(0, st.s - 8))
	local up = RaceTrack.frame(p2, math.min(p2.length, st.s + 8))
	local bend = ((up.tx - back.tx) * g.ux + (up.ty - back.ty) * g.uy + (up.tz - back.tz) * g.uz) / 16
	if bend < 0 and -bend * st.vs * st.vs > G * g.uy * 1.1 + 12 then
		takeOff(st, g, 0)
		return
	end
	-- Jump.
	if input.jump and not st.lastJump then
		takeOff(st, g, JUMP)
		table.insert(st.events, "jump")
	end
end

local AIR_STEER = 28 -- sideways nudge in the air, to line up a landing

local function inAir(st: State, input: Input)
	local course = RaceTrack.get()
	local dt = RaceSim.DT
	st.airTicks += 1
	st.vy -= G * dt
	-- Air control: steer pushes sideways to the horizontal heading.
	local hx, hz = st.vx, st.vz
	local hm = math.sqrt(hx * hx + hz * hz)
	if hm > 1 and input.steer ~= 0 then
		st.vx += (-hz / hm) * input.steer * AIR_STEER * dt
		st.vz += (hx / hm) * input.steer * AIR_STEER * dt
	end
	local v = math.sqrt(st.vx * st.vx + st.vy * st.vy + st.vz * st.vz)
	local k = 1 - AIR_DRAG * v * dt
	st.vx *= k
	st.vy *= k
	st.vz *= k
	st.px += st.vx * dt
	st.py += st.vy * dt
	st.pz += st.vz * dt
	-- Landing: the nearest point on the current path near where it left, then on any path.
	local function tryLand(id: string, s0: number, s1: number): boolean
		local p = course.paths[id]
		local s, u, h, along = RaceTrack.nearest(p, st.px, st.py, st.pz, s0, s1)
		local f = RaceTrack.frame(p, s)
		-- Down to 12 studs under a landing's surface still counts: the marble catches the lip and
		-- pops up onto it, instead of dying on the edge.
		if f.floor and along < RaceTrack.STEP and math.abs(u) <= f.w / 2 and h <= RaceSim.R and h > -12 then
			st.path, st.s, st.u = id, s, u
			st.vs = st.vx * f.tx + st.vy * f.ty + st.vz * f.tz
			st.vu = (st.vx * f.rx + st.vy * f.ry + st.vz * f.rz) * 0.5
			st.air = false
			table.insert(st.events, "land")
			return true
		end
		return false
	end
	if st.airTicks > 3 then
		-- On its own path, only where it took off or further on (st.s holds the take-off point).
		if tryLand(st.path, st.s - 4, st.s + 600) then
			return
		end
		for _, id in ipairs(course.order) do
			if id ~= st.path and tryLand(id, 0, course.paths[id].length) then
				return
			end
		end
	end
	-- Fallen far below the course, or flying for too long: back to the last checkpoint.
	local p = course.paths[st.path]
	local _, _, h = RaceTrack.nearest(p, st.px, st.py, st.pz, st.s - 40, st.s + 600)
	if h < -FALL or st.airTicks > 60 * 8 then
		respawn(st)
	end
end

--- Advance one fixed step with this input.
function RaceSim.step(st: State, input: Input)
	table.clear(st.events)
	if st.finished then
		return
	end
	st.tick += 1
	if input.respawn then
		respawn(st)
	elseif st.air then
		inAir(st, input)
	else
		onGround(st, input)
	end
	st.lastJump = input.jump
	-- Checkpoints and the finish, by main-path distance.
	local course = RaceTrack.get()
	if st.path == "main" and not st.air then
		local nxt = course.checkpoints[st.checkpoint + 1]
		if nxt and st.s >= nxt then
			st.checkpoint += 1
			table.insert(st.events, "checkpoint")
		end
		if st.s >= course.finish then
			st.finished = true
			st.finishTick = st.tick
			table.insert(st.events, "finish")
		end
	end
end

-- ---- Bots: drive the course, for the tests and the medal times ------------------------------------

--- A bot's input for this state: steer toward a target line across the track (`line` -1..1 of the
--- half-width; positive keeps right, which takes the shortcuts), push on the straights, jump at the
--- lips of gaps.
function RaceSim.bot(st: State, line: number, shortcuts: boolean): Input
	local course = RaceTrack.get()
	if st.air then
		-- Steer toward the track below: its nearest point's centre, seen across the heading.
		local p = course.paths[st.path]
		local s = RaceTrack.nearest(p, st.px, st.py, st.pz, st.s - 40, st.s + 600)
		local f = RaceTrack.frame(p, s)
		local hx, hz = st.vx, st.vz
		local hm = math.max(1, math.sqrt(hx * hx + hz * hz))
		local side = ((f.x - st.px) * (-hz / hm) + (f.z - st.pz) * (hx / hm))
		return { steer = math.clamp(side * 0.2, -1, 1), throttle = 0, jump = false, respawn = false }
	end
	local p = course.paths[st.path]
	local f = RaceTrack.frame(p, st.s)
	local target = if f.w < 20 then 0 else line * (f.w / 2 - 4)
	-- Approaching a fork: line up on the side for the route wanted.
	if st.path == "main" then
		for _, id in ipairs(course.order) do
			local b = course.paths[id]
			if b.fork and st.s < b.fork.s and st.s > b.fork.s - 160 then
				target = if shortcuts then 6 else -6
			end
		end
	end
	local steer = math.clamp((target - st.u) * 0.35 - st.vu * 0.25, -1, 1)
	-- Look ahead for a gap: jump right at its lip.
	local jump = false
	for d = 4, 16, 4 do
		local a = RaceTrack.frame(p, math.min(p.length, st.s + d + st.vs * RaceSim.DT))
		if not a.floor then
			jump = d <= 8 and st.vs < 60
			break
		end
	end
	return { steer = steer, throttle = 1, jump = jump, respawn = false }
end

--- Run a bot to the finish (or `maxTicks`). Returns the state and the input log.
function RaceSim.runBot(line: number, shortcuts: boolean, maxTicks: number?): (State, { any })
	local st = RaceSim.new()
	local log = RaceSim.newLog()
	local limit = maxTicks or 60 * 60 * 4
	while not st.finished and st.tick < limit do
		local input = RaceSim.record(log, st.tick, RaceSim.bot(st, line, shortcuts))
		RaceSim.step(st, input)
	end
	return st, log
end

-- ---- Input logs: what the client sends, and the server replays -----------------------------------
-- Inputs only change now and then, so a log stores (tick, steer, throttle, jump, respawn) on change.
-- Steer is quantized to 1/16 so the replay sees exactly what the racer did.

function RaceSim.newLog(): { any }
	return {}
end

function RaceSim.quantize(input: Input): Input
	return {
		steer = math.floor(math.clamp(input.steer, -1, 1) * 16 + 0.5) / 16,
		throttle = if input.throttle > 0 then 1 elseif input.throttle < 0 then -1 else 0,
		jump = input.jump == true,
		respawn = input.respawn == true,
	}
end

--- Log this tick's input; returns the quantized input, which is what the racer must step with
--- (so a replay of the log is exact).
function RaceSim.record(log: { any }, tick: number, input: Input): Input
	local q = RaceSim.quantize(input)
	local last = log[#log]
	if last and last[2] == q.steer and last[3] == q.throttle and last[4] == q.jump and not q.respawn then
		return q
	end
	table.insert(log, { tick, q.steer, q.throttle, q.jump, q.respawn })
	return q
end

--- Replay a log from the start. Returns the final state (finished and finishTick if it got there).
function RaceSim.replay(log: { any }, maxTicks: number?): State
	local st = RaceSim.new()
	local limit = maxTicks or 60 * 60 * 6
	local i = 1
	local cur: Input = { steer = 0, throttle = 0, jump = false, respawn = false }
	while not st.finished and st.tick < limit do
		local entry = log[i]
		if entry and entry[1] == st.tick then
			cur = { steer = entry[2], throttle = entry[3], jump = entry[4], respawn = entry[5] }
			i += 1
		end
		RaceSim.step(st, cur)
		cur.respawn = false
	end
	return st
end

--- Check a log is well formed: ticks rising, values in range. (ok, why)
function RaceSim.validLog(log: any): (boolean, string?)
	if typeof(log) ~= "table" or #log > 20000 then
		return false, "bad log"
	end
	local last = -1
	for _, e in ipairs(log) do
		if typeof(e) ~= "table" or typeof(e[1]) ~= "number" or e[1] < last or e[1] ~= math.floor(e[1]) then
			return false, "bad tick"
		end
		if typeof(e[2]) ~= "number" or math.abs(e[2]) > 1 or typeof(e[3]) ~= "number" or math.abs(e[3]) > 1 then
			return false, "bad input"
		end
		if typeof(e[4]) ~= "boolean" or typeof(e[5]) ~= "boolean" then
			return false, "bad flags"
		end
		last = e[1]
	end
	return true, nil
end

return RaceSim
