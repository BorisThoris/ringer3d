--!native
--!optimize 2
-- One shot's worth of physics, the web game's ShotSim (src/core/physics.ts) in pure Luau.
--
-- The web game rebuilds a Rapier world from a quantized layout for every shot and steps it at
-- a fixed 1/120 s, so a shot's outcome is a function of (layout, shot, field, map). This does the
-- same with a small rigid-body solver of its own: marbles are spheres with full spin, loose props
-- slide and turn on the ground, everything else is fixed. Contacts are solved with sequential
-- impulses (8 iterations, as Rapier is set up) with Rapier's combine rules for friction and
-- restitution, speculative contacts so nothing tunnels, and then the web game's own per-step
-- rules on top: rolling resistance, ground patches, slopes and hops, cups, smash-through,
-- the re-roll after an obstacle, the safety net and the rest test. Everything is in web units
-- (ring radius 5.5); the table scales by Config.MAP_SCALE only to draw.
--
-- Nothing here touches Instances, the clock or math.random: the server plays the shot, every
-- client replays the same shot to draw it, and the bot imagines shots with it.

local Forge = require(script.Parent.Forge)
local imul = Forge.imul

local Sim = {}

local WORLD = {
	ringRadius = 5.5,
	targetRadius = 0.16,
	shooterRadius = 0.21,
	targetSpacing = 0.5,
	boundaryRadius = 13,
	gravity = -30,
	dt = 1 / 120,
	maxShotSpeed = 27,
	maxShotSteps = 120 * 16,
	restLinear = 0.035,
	restAngular = 0.25,
	restSteps = 24,
}
Sim.WORLD = WORLD
Sim.TARGET_COUNT = 13
Sim.SHOOTER_ID = 100
Sim.QUANT = { angle = 1e-4, power = 1e-4, spin = 1e-3 }

local MARBLE_FRICTION = 0.25
local MARBLE_DENSITY = 2.6
local PROP_FRICTION = 0.45
local PROP_DAMPING = 1.6
local SMASH_KEEP = 0.6
local ROLL_G = (5 / 7) * -WORLD.gravity
local HOP_MIN_SPEED = 4
local HOP_MAX = 2.6
local SETTLE_SPEED = 0.3
local BUMPER_H = 0.45
local BUMPER_BOUNCE = 1.25
local HOLE_SPEED = 7
local STICKY = 2.2
local SLICK = 0.2
local BOOST = 22
local POCKET_X = WORLD.boundaryRadius + 4
local ITERATIONS = 8
-- Solver switches, for tuning against the web game's fixtures (tests/sim.luau).
local TUNE = { pgs = 1, pairsFirst = false, groundBounce = false, bounceMin = 0.6 }
Sim.TUNE = TUNE
-- A contact only bounces on first touch and when it closes faster than this: resting contacts
-- (gravity's 0.25 u/s a step) never chatter.
local BOUNCE_MIN = 0.6
local SLOP = 0.0005
-- Rapier's cap on angular speed: a quarter turn per step (30 pi rad/s at 1/120 s).
local MAX_SPIN = (math.pi / 4) / WORLD.dt
Sim.HOLE_SPEED = HOLE_SPEED
Sim.BUMPER_H = BUMPER_H

-- ---- Props (src/core/props.ts) ------------------------------------------------------------
local PROP_TRAITS: { [string]: { density: number?, breakAt: number? } } = {
	book = { density = 4 },
	eraser = { density = 5 },
	ruler = { density = 6 },
	mug = { density = 2, breakAt = 360 },
	pot = { density = 2, breakAt = 260 },
	brick = { density = 8 },
	cone = { density = 1.5 },
	log = { density = 5 },
	flowerpot = { density = 2.5, breakAt = 270 },
	driftwood = { density = 4 },
	sandcastle = { breakAt = 120 },
	iceblock = { density = 7, breakAt = 420 },
}
Sim.PROP_TRAITS = PROP_TRAITS

function Sim.propTraits(p): { density: number?, breakAt: number? }?
	if p.kind ~= "wall" and p.kind ~= "post" then
		return nil
	end
	local t = p.skin and PROP_TRAITS[p.skin]
	return t
end

--- Every prop where the map put it (`i` is the 1-based piece index).
function Sim.initialProps(pieces)
	local out = {}
	for i, p in ipairs(pieces) do
		if Sim.propTraits(p) then
			table.insert(out, { i = i, x = p.x, z = p.z, a = if p.kind == "wall" then p.a else 0 })
		end
	end
	return out
end

-- ---- Quantizing (JS Math.round: half up) -------------------------------------------------
local function round(v: number): number
	return math.floor(v + 0.5)
end
local function q(v: number, step: number): number
	return round(v / step) * step
end
local function qPos(v: number): number
	return round(v * 1e5) / 1e5
end
Sim.qPos = qPos

function Sim.quantizeShot(s)
	return {
		placeAngle = q(s.placeAngle, Sim.QUANT.angle),
		aimAngle = q(s.aimAngle, Sim.QUANT.angle),
		power = math.clamp(q(s.power, Sim.QUANT.power), 0, 1),
		spin = math.clamp(q(s.spin or 0, Sim.QUANT.spin), -1, 1),
	}
end

local function qm(m)
	return { id = m.id, x = qPos(m.x), y = qPos(m.y), z = qPos(m.z) }
end

function Sim.quantizeLayout(l)
	local targets = {}
	for _, t in ipairs(l.targets) do
		table.insert(targets, qm(t))
	end
	table.sort(targets, function(a, b)
		return a.id < b.id
	end)
	local out = { targets = targets, shooter = l.shooter and qm(l.shooter) or nil, props = nil :: any }
	if l.props then
		local props = {}
		for _, p in ipairs(l.props) do
			table.insert(props, { i = p.i, x = qPos(p.x), z = qPos(p.z), a = qPos(p.a), broken = p.broken or nil })
		end
		table.sort(props, function(a, b)
			return a.i < b.i
		end)
		out.props = props
	end
	return out
end

--- Classic starting cross: one in the centre and three along each arm (ids 0..12).
function Sim.startingLayout()
	local targets = {}
	local s = WORLD.targetSpacing
	local y = WORLD.targetRadius
	table.insert(targets, { id = 0, x = 0, y = y, z = 0 })
	local id = 1
	for _, arm in ipairs({ { 1, 0 }, { -1, 0 }, { 0, 1 }, { 0, -1 } }) do
		for k = 1, 3 do
			table.insert(targets, { id = id, x = arm[1] * s * k, y = y, z = arm[2] * s * k })
			id += 1
		end
	end
	return Sim.quantizeLayout({ targets = targets, shooter = nil })
end

function Sim.placementPoint(placeAngle: number): (number, number)
	local r = WORLD.ringRadius + WORLD.shooterRadius + 0.02
	return math.cos(placeAngle) * r, math.sin(placeAngle) * r
end

function Sim.isOutsideRing(x: number, z: number): boolean
	return math.sqrt(x * x + z * z) > WORLD.ringRadius
end

-- ---- The bump field (bit-identical to the web game's) -------------------------------------
local U32 = 4294967296
local function lattice(ix: number, iz: number): number
	local h = (imul(ix % U32, 374761393) + imul(iz % U32, 668265263)) % U32
	h = imul(bit32.bxor(h, bit32.rshift(h, 13)), 1274126177)
	h = bit32.bxor(h, bit32.rshift(h, 16))
	return h / 2147483648 - 1
end

local function noiseGrad(u: number, v: number, w: number): (number, number)
	local iu = math.floor(u)
	local iv = math.floor(v)
	local fu = u - iu
	local fv = v - iv
	local a = lattice(iu, iv)
	local b = lattice(iu + 1, iv)
	local c = lattice(iu, iv + 1)
	local d = lattice(iu + 1, iv + 1)
	local su = fu * fu * fu * (fu * (fu * 6 - 15) + 10)
	local sv = fv * fv * fv * (fv * (fv * 6 - 15) + 10)
	local du = 30 * fu * fu * (fu * (fu - 2) + 1)
	local dvv = 30 * fv * fv * (fv * (fv - 2) + 1)
	return w * du * (b - a + (a - b - c + d) * sv), w * dvv * (c - a + (a - b - c + d) * su)
end

--- Slope (rise over run) of the field's bump surface at (x, z).
function Sim.bumpSlope(x: number, z: number, p): (number, number)
	local u = x / (p.scale * p.stretch)
	local v = z / p.scale
	local ax, az = noiseGrad(u, v, 1)
	local bx, bz = noiseGrad(u * 2.03 + 17.1, v * 2.03 + 5.3, 0.5)
	local k = p.amp * 0.8
	return (ax + bx) * k / p.stretch, (az + bz) * k
end

-- ---- Bodies -------------------------------------------------------------------------------
-- A marble: a sphere with full 3D motion. A prop: a box or cylinder standing on the ground that
-- slides (x, z) and turns about y only. Statics never move.

type Body = {
	id: number,
	r: number,
	invM: number,
	invI: number,
	px: number,
	py: number,
	pz: number,
	vx: number,
	vy: number,
	vz: number,
	wx: number,
	wy: number,
	wz: number,
	holed: boolean,
	struck: boolean,
	smash: boolean,
	pre: { number }?,
}

local function newMarble(m, radius: number): Body
	local mass = MARBLE_DENSITY * (4 / 3) * math.pi * radius ^ 3
	return {
		id = m.id,
		r = radius,
		invM = 1 / mass,
		invI = 1 / (0.4 * mass * radius * radius),
		px = m.x,
		py = math.max(m.y, radius),
		pz = m.z,
		vx = 0,
		vy = 0,
		vz = 0,
		wx = 0,
		wy = 0,
		wz = 0,
		holed = false,
		struck = false,
		smash = false,
		pre = nil,
	}
end

-- ---- Closest points -------------------------------------------------------------------------

-- Box with centre (cx, cy, cz), half sizes (hx, hy, hz), local x along (ca, sa) in xz.
-- Returns the closest point to (x, y, z) and whether (x, y, z) is inside; when inside, the point
-- is on the nearest face.
local function boxClosest(cx, cy, cz, hx, hy, hz, ca, sa, x, y, z)
	local dx, dy, dz = x - cx, y - cy, z - cz
	local lx = dx * ca + dz * sa
	local lz = -dx * sa + dz * ca
	local ly = dy
	local inside = math.abs(lx) <= hx and math.abs(ly) <= hy and math.abs(lz) <= hz
	if inside then
		-- Push out through the nearest face.
		local ex, ey, ez = hx - math.abs(lx), hy - math.abs(ly), hz - math.abs(lz)
		if ex <= ey and ex <= ez then
			lx = if lx >= 0 then hx else -hx
		elseif ey <= ez then
			ly = if ly >= 0 then hy else -hy
		else
			lz = if lz >= 0 then hz else -hz
		end
	else
		lx = math.clamp(lx, -hx, hx)
		ly = math.clamp(ly, -hy, hy)
		lz = math.clamp(lz, -hz, hz)
	end
	return cx + lx * ca - lz * sa, cy + ly, cz + lx * sa + lz * ca, inside
end

-- Vertical cylinder: centre (cx, cy, cz), half height hh, radius r.
local function cylClosest(cx, cy, cz, hh, r, x, y, z)
	local dx, dz = x - cx, z - cz
	local d = math.sqrt(dx * dx + dz * dz)
	local ly = y - cy
	local inside = d <= r and math.abs(ly) <= hh
	local ux, uz = 1, 0
	if d > 1e-9 then
		ux, uz = dx / d, dz / d
	end
	if inside then
		if r - d < hh - math.abs(ly) then
			return cx + ux * r, y, cz + uz * r, true
		end
		return x, cy + (if ly >= 0 then hh else -hh), z, true
	end
	local rr = math.min(d, r)
	return cx + ux * rr, cy + math.clamp(ly, -hh, hh), cz + uz * rr, false
end

-- ---- Statics ------------------------------------------------------------------------------
-- Each static: kind (box | cyl | sphere | capsule), shape numbers, restitution, friction, the
-- event kind ("piece" or "bumper") and a bounding circle in xz for a quick reject.

local function makeStatics(pieces, propIndex: { [number]: boolean })
	local out = {}
	for i, p in ipairs(pieces) do
		if propIndex[i] then
			continue
		end
		local k = p.kind
		if k == "wall" then
			local half = math.sqrt((p.len / 2) ^ 2 + (p.thick / 2) ^ 2)
			table.insert(out, {
				kind = "box", cx = p.x, cy = p.h / 2, cz = p.z, hx = p.len / 2, hy = p.h / 2, hz = p.thick / 2,
				ca = math.cos(p.a), sa = math.sin(p.a), rest = 0.55, fric = 0.3, ev = "piece", bx = p.x, bz = p.z, br = half,
			})
		elseif k == "post" then
			table.insert(out, { kind = "cyl", cx = p.x, cy = p.h / 2, cz = p.z, hh = p.h / 2, r = p.r, rest = 0.5, fric = 0.3, ev = "piece", bx = p.x, bz = p.z, br = p.r })
		elseif k == "bumper" then
			table.insert(out, { kind = "cyl", cx = p.x, cy = BUMPER_H / 2, cz = p.z, hh = BUMPER_H / 2, r = p.r, rest = BUMPER_BOUNCE, fric = 0.1, ev = "bumper", bx = p.x, bz = p.z, br = p.r })
		elseif k == "bump" then
			local cy = p.r * (1 - 2 * p.sink)
			local cap = math.sqrt(math.max(0, p.r * p.r - cy * cy))
			if cy + p.r > 0 then
				table.insert(out, { kind = "sphere", cx = p.x, cy = cy, cz = p.z, r = p.r, rest = 0.2, fric = 0.6, ev = "piece", bx = p.x, bz = p.z, br = if cy >= 0 then p.r else cap })
			end
		elseif k == "ridge" then
			local dx, dz = p.x2 - p.x1, p.z2 - p.z1
			local len = math.sqrt(dx * dx + dz * dz)
			if len >= 1e-3 then
				table.insert(out, {
					kind = "capsule", x1 = p.x1, z1 = p.z1, x2 = p.x2, z2 = p.z2, cy = -p.r * 0.35, r = p.r, rest = 0.2, fric = 0.5, ev = "piece",
					bx = (p.x1 + p.x2) / 2, bz = (p.z1 + p.z2) / 2, br = len / 2 + p.r,
				})
			end
		end
	end
	return out
end

-- Closest point on a static to (x, y, z); returns qx, qy, qz, inside.
local function staticClosest(s, x, y, z)
	local k = s.kind
	if k == "box" then
		return boxClosest(s.cx, s.cy, s.cz, s.hx, s.hy, s.hz, s.ca, s.sa, x, y, z)
	elseif k == "cyl" then
		return cylClosest(s.cx, s.cy, s.cz, s.hh, s.r, x, y, z)
	elseif k == "sphere" then
		local dx, dy, dz = x - s.cx, y - s.cy, z - s.cz
		local d = math.sqrt(dx * dx + dy * dy + dz * dz)
		if d < 1e-9 then
			return s.cx, s.cy + s.r, s.cz, true
		end
		local k2 = s.r / d
		return s.cx + dx * k2, s.cy + dy * k2, s.cz + dz * k2, d < s.r
	else
		-- Capsule: closest point on the axis, then out to the surface.
		local ax, az = s.x2 - s.x1, s.z2 - s.z1
		local t = math.clamp(((x - s.x1) * ax + (z - s.z1) * az) / (ax * ax + az * az), 0, 1)
		local cx, cz = s.x1 + ax * t, s.z1 + az * t
		local dx, dy, dz = x - cx, y - s.cy, z - cz
		local d = math.sqrt(dx * dx + dy * dy + dz * dz)
		if d < 1e-9 then
			return cx, s.cy + s.r, cz, true
		end
		local k2 = s.r / d
		return cx + dx * k2, s.cy + dy * k2, cz + dz * k2, d < s.r
	end
end

-- ---- Props --------------------------------------------------------------------------------
type Prop = {
	i: number,
	piece: any,
	traits: any,
	loose: boolean,
	box: boolean,
	hx: number,
	hz: number,
	h: number,
	r: number,
	br: number,
	x: number,
	z: number,
	a: number,
	vx: number,
	vz: number,
	w: number,
	invM: number,
	invI: number,
	rg: number,
	broken: boolean,
	start: any,
}

-- Closest point on a prop's solid to (x, y, z).
local function propClosest(p: Prop, x, y, z)
	if p.box then
		return boxClosest(p.x, p.h / 2, p.z, p.hx, p.h / 2, p.hz, math.cos(p.a), math.sin(p.a), x, y, z)
	end
	return cylClosest(p.x, p.h / 2, p.z, p.h / 2, p.r, x, y, z)
end

-- 2D outline of a prop for prop-vs-world contacts: corners of a box, or nil for a circle.
local function corners(p: Prop): { number }
	local ca, sa = math.cos(p.a), math.sin(p.a)
	local out = table.create(8)
	for _, s in ipairs({ { 1, 1 }, { -1, 1 }, { -1, -1 }, { 1, -1 } }) do
		local lx, lz = s[1] * p.hx, s[2] * p.hz
		table.insert(out, p.x + lx * ca - lz * sa)
		table.insert(out, p.z + lx * sa + lz * ca)
	end
	return out
end

-- Deepest point of shape A (prop, or circle cx,cz,r) inside 2D box B (centre, halves, angle).
-- Returns depth, normal (out of B toward A) and point, or nil.
local function intoBox2(px: { number }?, cx, cz, cr, bx, bz, hx, hz, ca, sa)
	local best, bnx, bnz, bqx, bqz = nil, 0, 0, 0, 0
	local function test(x, z, rad)
		local dx, dz = x - bx, z - bz
		local lx = dx * ca + dz * sa
		local lz = -dx * sa + dz * ca
		local qx, qz = math.clamp(lx, -hx, hx), math.clamp(lz, -hz, hz)
		local ox, oz = lx - qx, lz - qz
		local d = math.sqrt(ox * ox + oz * oz)
		local depth, nx, nz
		if d > 1e-9 then
			depth = rad - d
			nx, nz = ox / d, oz / d
		else
			local ex, ez = hx - math.abs(lx), hz - math.abs(lz)
			if ex < ez then
				depth, nx, nz = ex + rad, (if lx >= 0 then 1 else -1), 0
			else
				depth, nx, nz = ez + rad, 0, (if lz >= 0 then 1 else -1)
			end
		end
		if depth > -0.02 and (best == nil or depth > best) then
			best = depth
			bnx, bnz = nx * ca - nz * sa, nx * sa + nz * ca
			bqx, bqz = bx + qx * ca - qz * sa, bz + qx * sa + qz * ca
		end
	end
	if px then
		for k = 1, 8, 2 do
			test(px[k], px[k + 1], 0)
		end
	else
		test(cx, cz, cr)
	end
	if best == nil then
		return nil
	end
	return best, bnx, bnz, bqx, bqz
end

-- ---- The simulation -----------------------------------------------------------------------
local ShotSim = {}
ShotSim.__index = ShotSim
Sim.ShotSim = ShotSim

local function launch(b: Body, shot)
	local speed = shot.power * WORLD.maxShotSpeed
	local dx = math.cos(shot.aimAngle)
	local dz = math.sin(shot.aimAngle)
	b.vx, b.vy, b.vz = dx * speed, 0, dz * speed
	-- Rolling without slipping is (v / r) * (up x dir) = (dz, 0, -dx) * v / r; spin scales it.
	local k = (speed / b.r) * shot.spin
	b.wx, b.wy, b.wz = dz * k, 0, -dx * k
end

--- `layout`, `surface` (Ringer.Surfaces), `shot` (or nil: just set the table), whether this is a
--- turn's first shot (the taw is placed on the line), and the map's pieces.
--- `opts.events`: collect impacts for effects (the bot leaves it off).
function Sim.new(layout, surface, shot, isFirstShotOfTurn: boolean, pieces, opts: { events: boolean? }?)
	local self = setmetatable({}, ShotSim)
	pieces = pieces or {}
	self.surface = surface
	self.events = opts ~= nil and opts.events == true
	self.zones = {}
	self.holes = {}
	for _, p in ipairs(pieces) do
		if p.kind == "zone" then
			table.insert(self.zones, p)
		elseif p.kind == "hole" then
			table.insert(self.holes, p)
		end
	end
	local L = Sim.quantizeLayout(layout)
	self.steps = 0
	self.done = false
	self.restCount = 0
	self.bodies = {} :: { Body }
	self.holed = {} :: { [number]: { x: number, z: number } }
	self.broke = {} :: { Prop }
	self.contacts = {} -- this step's
	self.touching = {} -- pair key -> true, last step's contacts (bounce on first touch only)

	-- Props.
	local states = L.props or Sim.initialProps(pieces)
	self.props = {} :: { Prop }
	self.carried = {}
	self.breakable = false
	local propIndex = {}
	for i, p in ipairs(pieces) do
		if Sim.propTraits(p) then
			propIndex[i] = true
		end
	end
	for _, s in ipairs(states) do
		local piece = pieces[s.i]
		local traits = piece and Sim.propTraits(piece)
		if not piece or not traits then
			continue
		end
		if s.broken then
			table.insert(self.carried, s)
			continue
		end
		local loose = traits.density ~= nil
		local box = piece.kind == "wall"
		local hx = if box then piece.len / 2 else piece.r
		local hz = if box then piece.thick / 2 else piece.r
		local mass, inertia = math.huge, math.huge
		if loose then
			if box then
				mass = traits.density * piece.len * piece.h * piece.thick
				inertia = mass * (piece.len ^ 2 + piece.thick ^ 2) / 12
			else
				mass = traits.density * math.pi * piece.r ^ 2 * piece.h
				inertia = mass * piece.r ^ 2 / 2
			end
		end
		if traits.breakAt ~= nil then
			self.breakable = true
		end
		table.insert(self.props, {
			i = s.i,
			piece = piece,
			traits = traits,
			loose = loose,
			box = box,
			hx = hx,
			hz = hz,
			h = piece.h,
			r = if box then 0 else piece.r,
			br = if box then math.sqrt(hx * hx + hz * hz) else piece.r,
			x = s.x,
			z = s.z,
			a = s.a,
			vx = 0,
			vz = 0,
			w = 0,
			invM = if loose then 1 / mass else 0,
			invI = if loose then 1 / inertia else 0,
			rg = if loose then math.sqrt(inertia / mass) else 1,
			broken = false,
			start = { i = s.i, x = s.x, z = s.z, a = s.a },
		})
	end
	self.statics = makeStatics(pieces, propIndex)

	for _, t in ipairs(L.targets) do
		table.insert(self.bodies, newMarble(t, WORLD.targetRadius))
	end
	local shooter = L.shooter
	if shot and isFirstShotOfTurn then
		local x, z = Sim.placementPoint(shot.placeAngle)
		shooter = { id = Sim.SHOOTER_ID, x = qPos(x), y = WORLD.shooterRadius, z = qPos(z) }
	end
	if shooter then
		local b = newMarble({ id = Sim.SHOOTER_ID, x = shooter.x, y = shooter.y, z = shooter.z }, WORLD.shooterRadius)
		table.insert(self.bodies, b)
		self.shooter = b
		if shot then
			launch(b, Sim.quantizeShot(shot))
		end
	end
	if not shot then
		self.done = true
	end
	return self
end

-- ---- Contacts -----------------------------------------------------------------------------
-- A contact between body A (a marble or prop) and B (marble, prop or nil for the world).
-- n points from B to A; s is the separation (negative: overlapping).

local function marbleVelAt(b: Body, rx, ry, rz)
	-- v + w x r
	return b.vx + b.wy * rz - b.wz * ry, b.vy + b.wz * rx - b.wx * rz, b.vz + b.wx * ry - b.wy * rx
end

local function propVelAt(p: Prop, rx, _ry, rz)
	return p.vx + p.w * rz, 0, p.vz - p.w * rx
end

-- 1/k along d for one side.
local function marbleK(b: Body, rx, ry, rz, dx, dy, dz)
	local cx, cy, cz = ry * dz - rz * dy, rz * dx - rx * dz, rx * dy - ry * dx
	return b.invM + b.invI * (cx * cx + cy * cy + cz * cz)
end

local function propK(p: Prop, rx, _ry, rz, dx, _dy, dz)
	local cy = rz * dx - rx * dz
	return p.invM * (dx * dx + dz * dz) + p.invI * cy * cy
end

local function marbleApply(b: Body, rx, ry, rz, jx, jy, jz)
	b.vx += jx * b.invM
	b.vy += jy * b.invM
	b.vz += jz * b.invM
	b.wx += (ry * jz - rz * jy) * b.invI
	b.wy += (rz * jx - rx * jz) * b.invI
	b.wz += (rx * jy - ry * jx) * b.invI
end

local function propApply(p: Prop, rx, _ry, rz, jx, _jy, jz)
	p.vx += jx * p.invM
	p.vz += jz * p.invM
	p.w += (rz * jx - rx * jz) * p.invI
end

function ShotSim:addContact(a, aProp: boolean, b, bProp: boolean, nx, ny, nz, s, qx, qy, qz, rest, fric, ev, key)
	local c = {
		a = a,
		aProp = aProp,
		b = b,
		bProp = bProp,
		nx = nx,
		ny = ny,
		nz = nz,
		s = s,
		rest = rest,
		fric = fric,
		ev = ev,
		key = key,
		accN = 0,
		fx = 0,
		fy = 0,
		fz = 0,
		bias = 0,
		kn = 0,
	}
	if aProp then
		c.rax, c.ray, c.raz = qx - a.x, qy - a.h / 2, qz - a.z
	else
		-- A sphere touches along the normal, wherever the touch point was found.
		c.rax, c.ray, c.raz = -nx * a.r, -ny * a.r, -nz * a.r
	end
	if b then
		if bProp then
			c.rbx, c.rby, c.rbz = qx - b.x, qy - b.h / 2, qz - b.z
		else
			c.rbx, c.rby, c.rbz = nx * b.r, ny * b.r, nz * b.r
		end
	end
	c.qx, c.qy, c.qz = qx, qy, qz
	table.insert(self.contacts, c)
end

local function relVel(c)
	local ax, ay, az
	if c.aProp then
		ax, ay, az = propVelAt(c.a, c.rax, c.ray, c.raz)
	else
		ax, ay, az = marbleVelAt(c.a, c.rax, c.ray, c.raz)
	end
	if c.b then
		local bx, by, bz
		if c.bProp then
			bx, by, bz = propVelAt(c.b, c.rbx, c.rby, c.rbz)
		else
			bx, by, bz = marbleVelAt(c.b, c.rbx, c.rby, c.rbz)
		end
		return ax - bx, ay - by, az - bz
	end
	return ax, ay, az
end

local function kAlong(c, dx, dy, dz)
	local k = if c.aProp then propK(c.a, c.rax, c.ray, c.raz, dx, dy, dz) else marbleK(c.a, c.rax, c.ray, c.raz, dx, dy, dz)
	if c.b then
		k += if c.bProp then propK(c.b, c.rbx, c.rby, c.rbz, dx, dy, dz) else marbleK(c.b, c.rbx, c.rby, c.rbz, dx, dy, dz)
	end
	return k
end

local function applyImpulse(c, jx, jy, jz)
	if c.aProp then
		propApply(c.a, c.rax, c.ray, c.raz, jx, jy, jz)
	else
		marbleApply(c.a, c.rax, c.ray, c.raz, jx, jy, jz)
	end
	if c.b then
		if c.bProp then
			propApply(c.b, c.rbx, c.rby, c.rbz, -jx, -jy, -jz)
		else
			marbleApply(c.b, c.rbx, c.rby, c.rbz, -jx, -jy, -jz)
		end
	end
end

-- A marble against a solid that doesn't move this step: the contact normal and point where
-- the marble will first touch it (conservative advancement along its velocity), and the gap
-- along that normal now. Returns nil when it can't touch within the step.
local function toi(a: Body, dt: number, reach: number, closest, shape)
	local qx, qy, qz, inside = closest(shape, a.px, a.py, a.pz)
	local dx, dy, dz = a.px - qx, a.py - qy, a.pz - qz
	local dd = math.sqrt(dx * dx + dy * dy + dz * dz)
	if inside then
		if dd < 1e-9 then
			return nil
		end
		return -dx / dd, -dy / dd, -dz / dd, -dd - a.r, qx, qy, qz
	end
	if dd < 1e-9 or dd - a.r > reach then
		return nil
	end
	local nx, ny, nz = dx / dd, dy / dd, dz / dd
	local gap = dd - a.r
	if gap > 1e-4 then
		-- Advance to the touch.
		local t = 0
		local x, y, z = a.px, a.py, a.pz
		local tx, ty, tz, tnx, tny, tnz = qx, qy, qz, nx, ny, nz
		for k = 1, 6 do
			local vn = -(a.vx * tnx + a.vy * tny + a.vz * tnz)
			if vn <= 1e-6 then
				if k == 1 and gap > 0.01 then
					return nil -- moving away or along it, clear of it
				end
				break
			end
			local g = math.sqrt((x - tx) ^ 2 + (y - ty) ^ 2 + (z - tz) ^ 2) - a.r
			if g <= 1e-4 then
				break
			end
			t += g / vn
			if t > dt then
				break
			end
			x, y, z = a.px + a.vx * t, a.py + a.vy * t, a.pz + a.vz * t
			local q2x, q2y, q2z, in2 = closest(shape, x, y, z)
			if in2 then
				break
			end
			local ex, ey, ez = x - q2x, y - q2y, z - q2z
			local el = math.sqrt(ex * ex + ey * ey + ez * ez)
			if el < 1e-9 then
				break
			end
			tx, ty, tz, tnx, tny, tnz = q2x, q2y, q2z, ex / el, ey / el, ez / el
		end
		if t > dt then
			return nil -- it won't touch this step; the next step finds the true touch
		end
		nx, ny, nz = tnx, tny, tnz
		qx, qy, qz = tx, ty, tz
		-- Gap along the touch normal, measured from here.
		gap = math.max(0, (a.px - qx) * nx + (a.py - qy) * ny + (a.pz - qz) * nz - a.r)
	end
	return nx, ny, nz, gap, qx, qy, qz
end

--- Find this step's contacts (speculative: anything that could touch within the step).
function ShotSim:collide()
	table.clear(self.contacts)
	local dt = WORLD.dt
	local S = self.surface
	local bodies = self.bodies
	local n = #bodies
	local mr = S.marbleRestitution
	local kerbR = WORLD.boundaryRadius
	local edgeRest = math.min(S.edge.restitution, mr)
	local edgeFric = MARBLE_FRICTION * S.edge.friction
	for i = 1, n do
		local a = bodies[i]
		if a.holed then
			continue
		end
		local speedA = math.sqrt(a.vx * a.vx + a.vy * a.vy + a.vz * a.vz)
		local reachA = speedA * dt + 0.01
		-- Ground (y = 0): friction is the field's, restitution min(0.15, marble).
		local sG = a.py - a.r
		if sG < reachA then
			self:addContact(a, false, nil, false, 0, 1, 0, sG, a.px, a.py - a.r, a.pz, math.min(0.15, mr), S.friction, nil, nil)
		end
		-- The kerb, carried up as a wall.
		local d = math.sqrt(a.px * a.px + a.pz * a.pz)
		local sK = kerbR - d - a.r
		if sK < reachA and d > 1e-6 then
			local ux, uz = a.px / d, a.pz / d
			self:addContact(a, false, nil, false, -ux, 0, -uz, sK, ux * kerbR, a.py, uz * kerbR, edgeRest, edgeFric, "kerb", 2e6 + a.id)
		end
		-- Other marbles.
		for j = i + 1, n do
			local b = bodies[j]
			if b.holed then
				continue
			end
			local dx, dy, dz = a.px - b.px, a.py - b.py, a.pz - b.pz
			local reach = reachA + math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz) * dt + a.r + b.r
			local d2 = dx * dx + dy * dy + dz * dz
			if d2 < reach * reach then
				local dd = math.sqrt(d2)
				if dd > 1e-9 then
					-- The normal where they will touch (Rapier's CCD finds the time of impact),
					-- not where they are now: a thin cut must leave on the true contact line.
					local R = a.r + b.r
					local ux, uy, uz = a.vx - b.vx, a.vy - b.vy, a.vz - b.vz
					local cx, cy, cz = dx, dy, dz
					if dd > R then
						local qa = ux * ux + uy * uy + uz * uz
						local qb = dx * ux + dy * uy + dz * uz
						local qc = d2 - R * R
						local disc = qb * qb - qa * qc
						if qa > 1e-12 and qb < 0 and disc >= 0 then
							local t = (-qb - math.sqrt(disc)) / qa
							if t >= 0 and t <= dt then
								cx, cy, cz = dx + ux * t, dy + uy * t, dz + uz * t
							end
						end
					end
					local cl = math.sqrt(cx * cx + cy * cy + cz * cz)
					local nx, ny, nz = cx / cl, cy / cl, cz / cl
					local sN = dx * nx + dy * ny + dz * nz - R
					self:addContact(a, false, b, false, nx, ny, nz, sN, b.px + nx * b.r, b.py + ny * b.r, b.pz + nz * b.r, mr, MARBLE_FRICTION * MARBLE_FRICTION, "marble", math.min(a.id, b.id) * 1000 + math.max(a.id, b.id))
				end
			end
		end
		-- Fixed pieces.
		for si, st in ipairs(self.statics) do
			local ox, oz = a.px - st.bx, a.pz - st.bz
			local lim = st.br + a.r + reachA
			if ox * ox + oz * oz > lim * lim then
				continue
			end
			local dx, dy, dz, s, qx, qy, qz = toi(a, dt, reachA, staticClosest, st)
			if dx then
				self:addContact(a, false, nil, false, dx, dy, dz, s, qx, qy, qz, math.max(st.rest, mr), MARBLE_FRICTION * st.fric, st.ev, 1e6 + si * 1000 + a.id)
			end
		end
		-- Props.
		for _, p in ipairs(self.props) do
			if p.broken then
				continue
			end
			local ox, oz = a.px - p.x, a.pz - p.z
			local lim = p.br + a.r + reachA + math.sqrt(p.vx * p.vx + p.vz * p.vz) * dt
			if ox * ox + oz * oz > lim * lim then
				continue
			end
			local dx, dy, dz, s, qx, qy, qz = toi(a, dt, reachA + math.sqrt(p.vx * p.vx + p.vz * p.vz) * dt, propClosest, p)
			if not dx then
				continue
			end
			self:addContact(a, false, if p.loose then p else nil, p.loose, dx, dy, dz, s, qx, qy, qz, math.max(0.35, mr), MARBLE_FRICTION * PROP_FRICTION, "prop", 3e6 + p.i * 1000 + a.id)
			self.contacts[#self.contacts].prop = p
		end
	end

	-- Loose props against the world and each other, in the ground plane.
	for pi, p in ipairs(self.props) do
		if p.broken or not p.loose then
			continue
		end
		local pc = if p.box then corners(p) else nil
		local reach = math.sqrt(p.vx * p.vx + p.vz * p.vz) * dt + 0.01
		local function hit(nx, nz, depth, qx, qz, other, otherProp: boolean, rest, fric, key, prop2)
			self:addContact(p, true, other, otherProp, nx, 0, nz, -depth, qx, p.h / 2, qz, rest, fric, "prop", key)
			local c = self.contacts[#self.contacts]
			c.prop = p
			c.prop2 = prop2
		end
		-- Kerb.
		if pc then
			for k = 1, 8, 2 do
				local x, z = pc[k], pc[k + 1]
				local d = math.sqrt(x * x + z * z)
				if d > kerbR - reach then
					hit(-x / d, -z / d, d - kerbR, x, z, nil, false, math.max(0.35, S.edge.restitution), (PROP_FRICTION + S.edge.friction) / 2, 4e6 + p.i * 10 + k, nil)
				end
			end
		else
			local d = math.sqrt(p.x * p.x + p.z * p.z)
			if d + p.r > kerbR - reach and d > 1e-6 then
				hit(-p.x / d, -p.z / d, d + p.r - kerbR, p.x / d * kerbR, p.z / d * kerbR, nil, false, math.max(0.35, S.edge.restitution), (PROP_FRICTION + S.edge.friction) / 2, 4e6 + p.i * 10, nil)
			end
		end
		-- Fixed walls and posts.
		for si, st in ipairs(self.statics) do
			if st.kind ~= "box" and st.kind ~= "cyl" then
				continue
			end
			local ox, oz = p.x - st.bx, p.z - st.bz
			local lim = st.br + p.br + reach
			if ox * ox + oz * oz > lim * lim then
				continue
			end
			local depth, nx, nz, qx, qz
			if st.kind == "box" then
				depth, nx, nz, qx, qz = intoBox2(pc, p.x, p.z, p.r, st.cx, st.cz, st.hx, st.hz, st.ca, st.sa)
			else
				-- Post: a circle; treat it as a tiny box for a box prop, or circle-circle.
				local dx, dz = p.x - st.cx, p.z - st.cz
				if pc then
					-- Deepest point of the post inside the prop's box, reversed.
					local d2, mx, mz, px2, pz2 = intoBox2(nil, st.cx, st.cz, st.r, p.x, p.z, p.hx, p.hz, math.cos(p.a), math.sin(p.a))
					if d2 then
						depth, nx, nz, qx, qz = d2, -mx, -mz, px2, pz2
					end
				else
					local d = math.sqrt(dx * dx + dz * dz)
					if d > 1e-9 then
						depth, nx, nz = p.r + st.r - d, dx / d, dz / d
						qx, qz = st.cx + nx * st.r, st.cz + nz * st.r
					end
				end
			end
			if depth and depth > -reach then
				hit(nx, nz, depth, qx, qz, nil, false, math.max(0.35, st.rest), (PROP_FRICTION + st.fric) / 2, 5e6 + pi * 1000 + si, nil)
			end
		end
		-- Other props (each pair once, or against a set prop).
		for qi, o in ipairs(self.props) do
			if o == p or o.broken or (o.loose and qi < pi) then
				continue
			end
			local ox, oz = p.x - o.x, p.z - o.z
			local lim = o.br + p.br + reach + math.sqrt(o.vx * o.vx + o.vz * o.vz) * dt
			if ox * ox + oz * oz > lim * lim then
				continue
			end
			local depth, nx, nz, qx, qz
			if o.box then
				depth, nx, nz, qx, qz = intoBox2(pc, p.x, p.z, p.r, o.x, o.z, o.hx, o.hz, math.cos(o.a), math.sin(o.a))
				if pc then
					-- Box against box: the other way round too; keep the deeper.
					local d2, mx, mz, x2, z2 = intoBox2(corners(o), 0, 0, 0, p.x, p.z, p.hx, p.hz, math.cos(p.a), math.sin(p.a))
					if d2 and (not depth or d2 > depth) then
						depth, nx, nz, qx, qz = d2, -mx, -mz, x2, z2
					end
				end
			elseif pc then
				local d2, mx, mz, x2, z2 = intoBox2(nil, o.x, o.z, o.r, p.x, p.z, p.hx, p.hz, math.cos(p.a), math.sin(p.a))
				if d2 then
					depth, nx, nz, qx, qz = d2, -mx, -mz, x2, z2
				end
			else
				local d = math.sqrt(ox * ox + oz * oz)
				if d > 1e-9 then
					depth, nx, nz = p.r + o.r - d, ox / d, oz / d
					qx, qz = o.x + nx * o.r, o.z + nz * o.r
				end
			end
			if depth and depth > -reach then
				hit(nx, nz, depth, qx, qz, if o.loose then o else nil, o.loose, 0.35, PROP_FRICTION, 6e6 + math.min(p.i, o.i) * 1000 + math.max(p.i, o.i), o)
			end
		end
	end
end

--- Rapier's solver (TGS, soft): the step is cut into ITERATIONS substeps; each one applies
--- gravity and damping, solves every contact once, moves the bodies, and updates each contact's
--- gap by how far its two sides moved. Contacts found at the start of the step persist through
--- it (speculative: a gap may close, no more), and a bounce is set up once, on first touch.
function ShotSim:solve()
	local dt = WORLD.dt
	local h = dt / ITERATIONS
	local S = self.surface
	local touching = self.touching
	local now = {}
	local contacts = self.contacts
	for _, c in ipairs(contacts) do
		local rx, ry, rz = relVel(c)
		local vn = rx * c.nx + ry * c.ny + rz * c.nz
		c.kn = 1 / kAlong(c, c.nx, c.ny, c.nz)
		local key = c.key
		local first = key == nil or not touching[key]
		c.bounce = nil
		if first and vn < -TUNE.bounceMin and c.rest > 0 and vn * dt <= -c.s and (TUNE.groundBounce or c.key ~= nil) then
			c.bounce = -c.rest * vn
		end
		if key and c.s < 0.002 - vn * dt then
			now[key] = true
		end
	end
	self.touching = now

	local bodies = self.bodies
	local ld = 1 / (1 + h * S.linearDamping)
	local ad = 1 / (1 + h * S.angularDamping)
	local gh = WORLD.gravity * h
	if TUNE.pairsFirst then
		table.sort(contacts, function(x, y)
			return (x.b ~= nil) and (y.b == nil)
		end)
	end
	for _ = 1, ITERATIONS do
		for _, b in ipairs(bodies) do
			if not b.holed then
				b.vy += gh
				b.vx *= ld
				b.vy *= ld
				b.vz *= ld
				b.wx *= ad
				b.wy *= ad
				b.wz *= ad
			end
		end
		for _, c in ipairs(contacts) do
			c.sub = 0
			c.subF = 0
		end
		for _ = 1, TUNE.pgs do
		for _, c in ipairs(contacts) do
			local rx, ry, rz = relVel(c)
			local vn = rx * c.nx + ry * c.ny + rz * c.nz
			local target = 0
			if c.s > 0 then
				target = -c.s / h
			end
			-- Once they touch, the bounce holds for the rest of the step: whatever else pushes on
			-- either marble (the ground under a mib) can't eat into it.
			if c.bounce and (c.hit or vn * h <= -c.s) then
				c.hit = true
				target = math.max(target, c.bounce)
			end
			local sub = c.sub
			local acc = math.max(0, sub + (target - vn) * c.kn)
			local dl = acc - sub
			c.sub = acc
			if dl ~= 0 then
				c.accN += dl
				applyImpulse(c, c.nx * dl, c.ny * dl, c.nz * dl)
			end
			if acc > 0 then
				-- Friction against the slip at the contact, up to mu times this push.
				if c.fric > 0 then
					rx, ry, rz = relVel(c)
					vn = rx * c.nx + ry * c.ny + rz * c.nz
					local tx, ty, tz = rx - vn * c.nx, ry - vn * c.ny, rz - vn * c.nz
					local ts = math.sqrt(tx * tx + ty * ty + tz * tz)
					if ts > 1e-9 then
						tx, ty, tz = tx / ts, ty / ts, tz / ts
						local j = math.min(ts / kAlong(c, tx, ty, tz), math.max(0, c.fric * acc - c.subF))
						c.subF += j
						applyImpulse(c, -tx * j, -ty * j, -tz * j)
					end
				end
			end
		end
		end
		-- Move, and close each contact's gap by the move. Rapier never turns a body more than a
		-- quarter turn a step: a fast topspin shot slips until the marble slows to match.
		for _, b in ipairs(bodies) do
			if not b.holed then
				local w2 = b.wx * b.wx + b.wy * b.wy + b.wz * b.wz
				if w2 > MAX_SPIN * MAX_SPIN then
					local k = MAX_SPIN / math.sqrt(w2)
					b.wx *= k
					b.wy *= k
					b.wz *= k
				end
				b.px += b.vx * h
				b.py += b.vy * h
				b.pz += b.vz * h
			end
		end
		for _, p in ipairs(self.props) do
			if p.loose and not p.broken then
				p.x += p.vx * h
				p.z += p.vz * h
				p.a -= p.w * h
			end
		end
		for _, c in ipairs(contacts) do
			local a, b = c.a, c.b
			local dvx, dvy, dvz
			if c.aProp then
				dvx, dvy, dvz = a.vx, 0, a.vz
			else
				dvx, dvy, dvz = a.vx, a.vy, a.vz
			end
			if b then
				if c.bProp then
					dvx -= b.vx
					dvz -= b.vz
				else
					dvx -= b.vx
					dvy -= b.vy
					dvz -= b.vz
				end
			end
			c.s += (dvx * c.nx + dvy * c.ny + dvz * c.nz) * h
		end
	end
end

--- Push apart whatever still overlaps after moving (position correction).
function ShotSim:separate()
	for _, c in ipairs(self.contacts) do
		if c.s >= -SLOP then
			continue
		end
		-- Re-measure only for the cheap cases; others use the pre-move depth.
		local depth = -c.s - SLOP
		local ia = if c.aProp then c.a.invM else c.a.invM
		local ib = if c.b then c.b.invM else 0
		local tot = ia + ib
		if tot <= 0 then
			continue
		end
		local push = depth * 0.8
		local ka, kb = push * ia / tot, push * ib / tot
		if c.aProp then
			c.a.x += c.nx * ka
			c.a.z += c.nz * ka
		else
			c.a.px += c.nx * ka
			c.a.py += c.ny * ka
			c.a.pz += c.nz * ka
		end
		if c.b and kb > 0 then
			if c.bProp then
				c.b.x -= c.nx * kb
				c.b.z -= c.nz * kb
			else
				c.b.px -= c.nx * kb
				c.b.py -= c.ny * kb
				c.b.pz -= c.nz * kb
			end
		end
	end
end

--- Advance one fixed step. Returns impacts during the step (for sound and effects) when the
--- sim was made with `events`.
function ShotSim:step()
	if self.done then
		return {}
	end
	local dt = WORLD.dt
	local S = self.surface
	table.clear(self.broke)
	local bodies = self.bodies
	if self.breakable then
		for _, b in ipairs(bodies) do
			b.pre = { b.vx, b.vy, b.vz }
		end
	end

	local pld = 1 / (1 + dt * (PROP_DAMPING + S.linearDamping))
	local pad = 1 / (1 + dt * PROP_DAMPING * 2)
	local pmu = PROP_FRICTION * S.friction / MARBLE_FRICTION * -WORLD.gravity
	for _, p in ipairs(self.props) do
		if p.broken or not p.loose then
			continue
		end
		p.vx *= pld
		p.vz *= pld
		p.w *= pad
		-- Dry friction on the ground slows the slide and the turn.
		local sp = math.sqrt(p.vx * p.vx + p.vz * p.vz)
		if sp > 0 then
			local f = math.max(0, sp - pmu * dt) / sp
			p.vx *= f
			p.vz *= f
		end
		local aw = math.abs(p.w)
		if aw > 0 then
			p.w *= math.max(0, aw - pmu / p.rg * dt) / aw
		end
	end

	self:collide()
	self:solve()

	self:separate()
	self.steps += 1

	-- Contact forces: impacts, the re-roll after an obstacle, breaking props.
	local impacts = {}
	local struck = {}
	local smashers = {}
	for _, c in ipairs(self.contacts) do
		if c.ev == nil or c.accN <= 0 then
			continue
		end
		local force = c.accN / dt
		local marbleA = not c.aProp
		local marbleB = c.b ~= nil and not c.bProp
		local threshold = if c.ev == "marble" then 8 else 2
		if force <= threshold then
			continue
		end
		local kind = if c.ev == "bumper" then "bumper" elseif c.ev == "marble" then "marble" else "kerb"
		if self.events then
			table.insert(impacts, { strength = force, x = c.qx, y = c.qy, z = c.qz, kind = kind })
		end
		local m = if marbleA then c.a elseif marbleB then c.b else nil
		if kind ~= "marble" and m then
			struck[m] = true
		end
		local prop = c.prop
		local at = prop and prop.traits.breakAt
		if prop and at and not prop.broken and force > at then
			prop.broken = true
			table.insert(self.broke, prop)
			if m then
				smashers[m] = true
			end
		elseif c.prop2 then
			local p2 = c.prop2
			local at2 = p2.traits.breakAt
			if at2 and not p2.broken and force > at2 then
				p2.broken = true
				table.insert(self.broke, p2)
			end
		end
	end
	-- A broken prop leaves the table at once; the marble that smashed it punches on through.
	for m in pairs(smashers) do
		local v = m.pre
		if v then
			local k = SMASH_KEEP
			m.vx, m.vy, m.vz = v[1] * k, v[2] * k, v[3] * k
			m.wx, m.wy, m.wz = v[3] * k / m.r, 0, -v[1] * k / m.r
			struck[m] = nil
		end
	end
	-- After an obstacle the marble rolls the new way (keeping the old roll dragged it back in).
	for b in pairs(struck) do
		b.wx, b.wz = b.vz / b.r, -b.vx / b.r
	end

	-- Safety net: past the edge or under the ground, set down just inside the kerb.
	local B = WORLD.boundaryRadius
	for _, b in ipairs(bodies) do
		if b.holed then
			continue
		end
		local r = math.sqrt(b.px * b.px + b.pz * b.pz)
		if b.py > -0.5 and r < B + 0.6 then
			continue
		end
		if r > 1e-6 then
			local k = (B - 1) / r
			b.px, b.pz = b.px * k, b.pz * k
		else
			b.px, b.pz = B - 1, 0
		end
		b.py = b.r
		b.vx, b.vy, b.vz, b.wx, b.wy, b.wz = 0, 0, 0, 0, 0, 0
	end

	-- The ground underfoot: cups, patches, slopes, hops, rolling resistance.
	local dv = S.rollDecel * dt
	local pull = ROLL_G * dt
	for _, b in ipairs(bodies) do
		if b.holed or b.py > b.r + 0.03 then
			continue
		end
		local vx, vy, vz = b.vx, b.vy, b.vz
		local cup = nil
		for _, h in ipairs(self.holes) do
			local lip = h.r - b.r * 0.3
			if (b.px - h.x) ^ 2 + (b.pz - h.z) ^ 2 < lip * lip then
				cup = h
				break
			end
		end
		if cup and vx * vx + vz * vz < HOLE_SPEED * HOLE_SPEED then
			self.holed[b.id] = { x = cup.x, z = cup.z }
			b.holed = true
			b.vx, b.vy, b.vz, b.wx, b.wy, b.wz = 0, 0, 0, 0, 0, 0
			b.px, b.py, b.pz = cup.x, -1, cup.z
			continue
		end
		local decel = dv
		for _, z in ipairs(self.zones) do
			if (b.px - z.x) ^ 2 + (b.pz - z.z) ^ 2 > z.r * z.r then
				continue
			end
			if z.effect == "sticky" then
				decel *= z.k or STICKY
			elseif z.effect == "slick" then
				decel *= z.k or SLICK
			else
				vx += math.cos(z.a) * BOOST * dt
				vz += math.sin(z.a) * BOOST * dt
			end
		end
		local sx, sz = S.camber.x, S.camber.z
		if S.bumps.amp > 0 then
			local bx, bz = Sim.bumpSlope(b.px, b.pz, S.bumps)
			sx += bx
			sz += bz
		end
		local sp0 = math.sqrt(vx * vx + vz * vz)
		local hold = math.min(1, sp0 / SETTLE_SPEED)
		vx -= sx * pull * hold
		vz -= sz * pull * hold
		local sp = math.sqrt(vx * vx + vz * vz)
		if sp <= 0 then
			continue
		end
		if S.hop > 0 and sp > HOP_MIN_SPEED and vy < 0.05 and b.py < b.r + 0.01 then
			local rise = (sx * vx + sz * vz) / sp
			if rise > 0 then
				vy = math.max(vy, math.min(HOP_MAX, S.hop * sp * rise))
			end
		end
		local f = math.max(0, sp - decel) / sp
		b.vx, b.vy, b.vz = vx * f, vy, vz * f
		b.wx *= f
		b.wy *= f
		b.wz *= f
	end

	-- At rest?
	local resting = true
	local rl, ra = WORLD.restLinear, WORLD.restAngular
	for _, b in ipairs(bodies) do
		if b.holed then
			continue
		end
		if b.vx * b.vx + b.vy * b.vy + b.vz * b.vz > rl * rl or b.wx * b.wx + b.wy * b.wy + b.wz * b.wz > ra * ra then
			resting = false
			break
		end
	end
	if resting then
		for _, p in ipairs(self.props) do
			if p.broken or not p.loose then
				continue
			end
			if p.vx * p.vx + p.vz * p.vz > rl * rl or math.abs(p.w) > ra then
				resting = false
				break
			end
		end
	end
	self.restCount = if resting then self.restCount + 1 else 0
	if self.restCount >= WORLD.restSteps or self.steps >= WORLD.maxShotSteps then
		self.done = true
	end
	return impacts
end

--- Run to completion (the server's result, and the bot's imagination).
function ShotSim:runToEnd()
	while not self.done do
		self:step()
	end
end

--- Final positions, quantized: the next layout. Holed marbles are reported in a pocket beyond
--- the ring, where the rules already count them out.
function ShotSim:resultLayout()
	local targets = {}
	local shooter = nil
	for _, b in ipairs(self.bodies) do
		local m
		if b.holed then
			m = { id = b.id, x = POCKET_X, y = WORLD.targetRadius, z = 0 }
		else
			m = { id = b.id, x = b.px, y = b.py, z = b.pz }
		end
		if b.id == Sim.SHOOTER_ID then
			shooter = m
		else
			table.insert(targets, m)
		end
	end
	if #self.props == 0 and #self.carried == 0 then
		return Sim.quantizeLayout({ targets = targets, shooter = shooter })
	end
	local props = table.clone(self.carried)
	for _, p in ipairs(self.props) do
		if p.broken then
			local s = table.clone(p.start)
			s.broken = true
			table.insert(props, s)
		elseif not p.loose then
			table.insert(props, p.start)
		else
			table.insert(props, { i = p.i, x = p.x, z = p.z, a = p.a })
		end
	end
	return Sim.quantizeLayout({ targets = targets, shooter = shooter, props = props })
end

--- Compact fingerprint of a layout, as the web game's (desync checks, tests).
function Sim.layoutHash(l): string
	local h = 2166136261
	local function mix(n: number)
		local v = round(n * 1e4) % U32
		h = imul(bit32.bxor(h, v), 16777619)
	end
	for _, t in ipairs(l.targets) do
		mix(t.id)
		mix(t.x)
		mix(t.z)
	end
	if l.shooter then
		mix(l.shooter.x)
		mix(l.shooter.z)
	end
	for _, p in ipairs(l.props or {}) do
		mix(p.i - 1)
		mix(p.x)
		mix(p.z)
		mix(p.a)
		mix(if p.broken then 1 else 0)
	end
	return string.format("%08x", h)
end

return Sim
