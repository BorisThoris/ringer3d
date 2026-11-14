-- How a shot plays out on screen, as the web game's GameSession does it (src/game/session.ts):
-- the fixed 1/120 s steps are consumed in real time, 3x when fast-forward is on, and the moment
-- the first mib rolls over the ring line the game drops to a quarter speed and eases back to full
-- over 0.9 s. Slow motion only changes how fast the steps are consumed, never the steps.
-- The server uses `duration` to know how long its players are watching; each client uses
-- `Clock` to replay the shot frame by frame.

local Sim = require(script.Parent.Sim)

local Playback = {}

Playback.SLOWMO_SECONDS = 0.9
Playback.SLOWMO_RATE = 0.25
Playback.FAST = 3
local MAX_STEPS_PER_FRAME = 12
local DT = Sim.WORLD.dt

export type Clock = {
	acc: number,
	slowmo: number,
	crossed: boolean,
}

function Playback.clock(): Clock
	return { acc = 0, slowmo = 0, crossed = false }
end

--- How many steps to run this frame. `crossedNow`: the first mib went over the line in a step
--- already run (starts the slow motion).
function Playback.advance(c: Clock, dt: number, fast: boolean, crossedNow: boolean): (number, number)
	if crossedNow and not c.crossed then
		c.crossed = true
		c.slowmo = Playback.SLOWMO_SECONDS
	end
	local slow = 1
	if c.slowmo > 0 then
		local k = 1 - c.slowmo / Playback.SLOWMO_SECONDS
		slow = Playback.SLOWMO_RATE + (1 - Playback.SLOWMO_RATE) * k * k
		c.slowmo -= dt
	end
	local speed = (if fast then Playback.FAST else 1) * slow
	c.acc += dt * speed
	local n = 0
	local cap = MAX_STEPS_PER_FRAME * speed
	while c.acc >= DT and n < cap do
		c.acc -= DT
		n += 1
	end
	if n >= cap then
		c.acc = 0
	end
	return n, slow
end

--- Real seconds to play `steps` steps when the first mib crosses the line after `crossStep`
--- steps (nil: none does), at 60 frames a second.
function Playback.duration(steps: number, crossStep: number?, fast: boolean?): number
	local c = Playback.clock()
	local done, t = 0, 0
	local frame = 1 / 60
	while done < steps and t < 60 do
		local n = Playback.advance(c, frame, fast == true, crossStep ~= nil and done >= crossStep)
		done += n
		t += frame
	end
	return t
end

--- The step after which a mib (not the taw) is first outside the ring, for `sim`'s current
--- state; call after every step until it returns a number.
function Playback.crossedNow(sim): boolean
	for _, b in ipairs(sim.bodies) do
		if b.id ~= Sim.SHOOTER_ID and not b.holed and Sim.isOutsideRing(b.px, b.pz) then
			return true
		end
	end
	return false
end

--- Turn each body's spin into an orientation (for drawing only): call once per step.
function Playback.spin(sim, rot: { [number]: CFrame })
	local dt = DT
	for _, b in ipairs(sim.bodies) do
		local w = Vector3.new(b.wx, b.wy, b.wz)
		local m = w.Magnitude
		local r = rot[b.id] or CFrame.identity
		if m > 1e-6 then
			r = CFrame.fromAxisAngle(w / m, m * dt) * r
		end
		rot[b.id] = r
	end
end

--- Where a wall or post prop stands for a prop state (x, z in web units, a its yaw), on a table
--- whose ring centre is `origin`, drawn `scale` studs to the unit.
function Playback.propCFrame(p, state, origin: Vector3, scale: number?): CFrame
	local S = scale or 4
	if p.kind == "wall" then
		return CFrame.new(origin + Vector3.new(state.x * S, p.h * S / 2, state.z * S)) * CFrame.Angles(0, -state.a, 0)
	end
	local h = (p.h or Sim.BUMPER_H) * S
	return CFrame.new(origin + Vector3.new(state.x * S, h / 2, state.z * S)) * CFrame.Angles(0, -state.a, 0) * CFrame.Angles(0, 0, math.pi / 2)
end

--- A fingerprint of where a shot left everything (FNV-1a over the quantized positions), so a
--- client can prove its replay landed exactly where the server's did.
function Playback.layoutHash(layout): string
	local parts = {}
	local function add(m)
		if m then
			table.insert(parts, string.format("%d:%.5f:%.5f:%.5f", m.id or 0, m.x, m.y, m.z))
		end
	end
	for _, m in ipairs(layout.targets or {}) do
		add(m)
	end
	add(layout.shooter)
	table.sort(parts)
	local h = 2166136261
	for _, ch in ipairs({ string.byte(table.concat(parts, ";"), 1, -1) }) do
		h = bit32.bxor(h, ch)
		-- h * 16777619 (= 2^24 + 403), kept exact in 32 bits.
		h = (bit32.lshift(h, 24) + h * 403) % 4294967296
	end
	return string.format("%08x", h)
end

--- The furthest any marble ended from where the other layout put it (web units).
function Playback.drift(a, b): number
	local where = {}
	for _, m in ipairs(a.targets or {}) do
		where[m.id] = m
	end
	if a.shooter then
		where[a.shooter.id or -1] = a.shooter
	end
	local worst = 0
	local function check(m)
		local o = m and where[m.id or -1]
		if o then
			worst = math.max(worst, math.sqrt((o.x - m.x) ^ 2 + (o.y - m.y) ^ 2 + (o.z - m.z) ^ 2))
		elseif m then
			worst = math.huge
		end
	end
	for _, m in ipairs(b.targets or {}) do
		check(m)
	end
	check(b.shooter)
	return worst
end

return Playback
