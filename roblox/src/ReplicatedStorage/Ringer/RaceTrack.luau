--!strict
-- Marble Mountain: the downhill race's one signature track, as data and the geometry built from
-- it. Shared by the server (which builds it and verifies runs), the client (which races on it)
-- and the tests. Everything here is plain arithmetic, so every machine gets the same numbers.
--
-- A path is a list of waypoints (x, y, z, track width, and flags), smoothed with a Catmull-Rom
-- spline and sampled every STEP studs into frames: position, tangent, a banked right vector, the
-- surface's up, and the flags (walls, floor, roof, boost). The main path runs summit to finish;
-- branch paths leave it at a fork (take them by keeping right) and rejoin it further down.

local RaceTrack = {}

RaceTrack.STEP = 4 -- studs between samples
RaceTrack.ORIGIN = Vector3.new(-6000, 0, 0) -- where the mountain stands, far from the lobby and tables
RaceTrack.NAME = "Marble Mountain"
RaceTrack.WALL_H = 4

export type Frame = {
	x: number, y: number, z: number, -- centre of the track surface
	tx: number, ty: number, tz: number, -- tangent (unit)
	rx: number, ry: number, rz: number, -- right, banked (unit)
	ux: number, uy: number, uz: number, -- surface up (unit)
	w: number, -- width
	walls: boolean, floor: boolean, roof: boolean,
	boost: number, -- 0 none, else the boost's strength
	section: string,
}
export type Path = {
	id: string,
	frames: { Frame },
	length: number,
	fork: { path: string, s: number }?, -- where a branch leaves its parent
	merge: { path: string, s: number }?, -- where it rejoins
}

-- ---- The course --------------------------------------------------------------------------------
-- Waypoints relative to ORIGIN: { x, y, z, width, flags }. Flags: nowalls, gap (no floor),
-- roof, boost, kicker (only shapes the line). `section` names apply from that waypoint on.
local W = 30
local MAIN = {
	-- Summit Drop: the start deck tips straight over into a steep plunge off the peak (no flat to
	-- crawl along), then two rollers where the slope eases and steepens again. Downhill all the way,
	-- so nothing ever stalls in a dip.
	{ 0, 902, 0, 34, section = "Summit Drop" },
	{ 30, 897, 0, 34 },
	{ 90, 866, 0, 32 },
	{ 150, 846, 2, W },
	{ 190, 836, 4, W },
	{ 225, 821, 6, W },
	{ 262, 811, 8, W },
	{ 300, 796, 10, W },
	-- Snowcap Esses: three linked curves down the snowfield.
	{ 390, 770, 50, W, section = "Snowcap Esses" },
	{ 450, 752, 130, W },
	{ 455, 735, 225, W },
	{ 400, 718, 300, W },
	{ 385, 700, 390, W },
	{ 440, 684, 460, W },
	-- The Fork: keep right for the Ice Bridge, left for the long Spiral round the pillar.
	{ 530, 668, 500, 40, section = "The Fork" },
	{ 640, 655, 505, W, section = "Pillar Spiral" },
	{ 760, 642, 545, W },
	{ 850, 630, 640, W },
	{ 860, 618, 760, W },
	{ 790, 606, 850, W },
	{ 690, 594, 880, W },
	-- Pine Canyon: a twisting run through the forest, and the Canyon Leap over the gorge.
	{ 620, 580, 900, W, section = "Pine Canyon" },
	{ 560, 560, 980, W },
	{ 520, 540, 1080, W },
	{ 540, 520, 1170, W },
	-- Boost pads on the run-up and the lip, so everyone arrives fast enough to clear the gorge.
	{ 600, 506, 1240, W, boost = 1 },
	-- The kicker rises at the lip; the landing ramp is 40 studs below, over the gorge.
	{ 650, 512, 1280, W, kicker = true, boost = 1, section = "Canyon Leap" },
	{ 680, 514, 1300, W, gap = true },
	{ 716, 470, 1326, 36, gap = true },
	{ 776, 450, 1366, 36 },
	{ 846, 438, 1406, W },
	{ 900, 430, 1436, W },
	-- The Corkscrew: a tight banked hairpin down the cliff, boost pads on the inside line.
	{ 950, 430, 1440, W, section = "Corkscrew" },
	{ 1040, 420, 1420, W, boost = 1 },
	{ 1090, 410, 1350, W },
	{ 1070, 398, 1270, W },
	{ 990, 386, 1230, W },
	{ 900, 372, 1240, W },
	-- Glow Tunnel: into the mountain, rings of light overhead.
	{ 820, 355, 1270, W, roof = true, section = "Glow Tunnel" },
	{ 740, 330, 1330, W, roof = true },
	{ 690, 305, 1420, W, roof = true },
	{ 690, 280, 1520, W, roof = true },
	{ 740, 258, 1600, W },
	-- Valley Sprint: long fast sweepers through the meadow, boost pads, the finish by the lake.
	{ 830, 230, 1660, W, section = "Valley Sprint", boost = 1 },
	{ 940, 200, 1700, W },
	{ 1060, 165, 1720, W },
	{ 1180, 130, 1700, W, boost = 1 },
	{ 1300, 100, 1660, W },
	{ 1420, 75, 1640, W },
	{ 1540, 55, 1650, W, boost = 1 },
	-- River Leap: the finale, after both routes have rejoined. Boost pads, a kicker, the river
	-- under the gap, and a long wide landing in sight of the finish line.
	{ 1610, 49, 1664, W, boost = 1 },
	{ 1650, 52, 1672, W, kicker = true, boost = 1, section = "River Leap" },
	{ 1672, 53, 1677, W, gap = true },
	{ 1700, 44, 1683, 40, gap = true },
	{ 1740, 38, 1690, 40 },
	{ 1800, 34, 1700, 36, section = "Finish" },
	{ 1880, 32, 1710, 40 },
	{ 1960, 32, 1714, 40 },
	{ 2040, 32, 1716, 40 },
	{ 2080, 32, 1716, 40 },
}
-- The Ice Bridge: narrow, no walls, straight over the chasm from the fork to the spiral's end.
local ICE_BRIDGE = {
	{ 530, 668, 500, 24, nowalls = true, section = "Ice Bridge" },
	{ 575, 650, 600, 13, nowalls = true },
	{ 615, 628, 700, 12, nowalls = true },
	{ 650, 606, 800, 12, nowalls = true },
	{ 690, 594, 880, 14, nowalls = true },
}
-- The Waterfall Chute: off the outside of the Corkscrew, sweeping down the cliff face beside the
-- falls, one jump over the plunge pool, rejoining the Valley Sprint (it skips the tunnel).
local WATERFALL = {
	{ 1040, 420, 1420, 24, section = "Waterfall Chute" },
	{ 1100, 408, 1440, 23 },
	{ 1148, 390, 1468, 22 },
	{ 1168, 368, 1508, 22 },
	{ 1172, 356, 1545, 22 },
	{ 1172, 360, 1575, 22, kicker = true },
	{ 1172, 356, 1600, 22, gap = true },
	{ 1172, 292, 1650, 26, gap = true },
	{ 1172, 266, 1700, 26 },
	{ 1185, 225, 1735, 22 },
	{ 1230, 165, 1745, 20 },
	-- Run alongside the valley track before joining it, so the merge is a gentle angle.
	{ 1310, 122, 1722, 22 },
	{ 1400, 90, 1690, 24 },
	{ 1470, 70, 1665, 26 },
	{ 1540, 55, 1650, W },
}
-- The layout's version. Bump it whenever the course changes shape: times, boards and ghosts are
-- kept per version, so a record set on an old layout never stands on a new one.
RaceTrack.VERSION = 2
RaceTrack.FINISH_S_FROM_END = 220 -- the finish line, this far before the main path's end

-- ---- Spline -------------------------------------------------------------------------------------

local function catmull(p0: { number }, p1: { number }, p2: { number }, p3: { number }, t: number, k: number): number
	local t2, t3 = t * t, t * t * t
	return 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)
end

local function unit(x: number, y: number, z: number): (number, number, number)
	local m = math.sqrt(x * x + y * y + z * z)
	if m < 1e-9 then
		return 0, 0, 1
	end
	return x / m, y / m, z / m
end

--- Sample a waypoint list into frames every STEP studs.
local function build(id: string, pts: { any }): Path
	-- 1. Dense points along the spline, each with the waypoint data of the segment it is in.
	local dense = {}
	local n = #pts
	for i = 1, n - 1 do
		local p0 = pts[math.max(1, i - 1)]
		local p1, p2 = pts[i], pts[i + 1]
		local p3 = pts[math.min(n, i + 2)]
		-- A gap must not bend the track on either side of it: the lip carries straight on from the
		-- approach, and the landing starts along its own ramp.
		local function ext(a: { number }, b: { number }): { number }
			return { 2 * b[1] - a[1], 2 * b[2] - a[2], 2 * b[3] - a[3], b[4] }
		end
		if p2.gap and not p1.gap then
			p3 = ext(p1, p2)
		end
		if p1.gap and p0.gap and not p2.gap then
			p0 = ext(p2, p1)
		end
		if p1.gap and not p0.gap and p2.gap then
			-- inside the gap (lip to landing): straight, nothing is drawn here
			p0 = ext(p2, p1)
			p3 = ext(p1, p2)
		end
		local sub = 40
		for j = 0, sub - 1 do
			local t = j / sub
			table.insert(dense, {
				x = catmull(p0, p1, p2, p3, t, 1),
				y = catmull(p0, p1, p2, p3, t, 2),
				z = catmull(p0, p1, p2, p3, t, 3),
				w = p1[4] + (p2[4] - p1[4]) * t,
				src = p1,
				nxt = p2,
				t = t,
			})
		end
	end
	local last = pts[n]
	table.insert(dense, { x = last[1], y = last[2], z = last[3], w = last[4], src = last, nxt = last, t = 0 })
	-- 2. Arc length, then resample every STEP studs.
	local acc = { 0 }
	for i = 2, #dense do
		local a, b = dense[i - 1], dense[i]
		acc[i] = acc[i - 1] + math.sqrt((b.x - a.x) ^ 2 + (b.y - a.y) ^ 2 + (b.z - a.z) ^ 2)
	end
	local length = acc[#dense]
	local frames: { Frame } = {}
	local j = 1
	local section = "Course"
	local count = math.floor(length / RaceTrack.STEP)
	for k = 0, count do
		local s = k * RaceTrack.STEP
		while j < #dense - 1 and acc[j + 1] < s do
			j += 1
		end
		local a, b = dense[j], dense[j + 1]
		local seg = math.max(1e-6, acc[j + 1] - acc[j])
		local f = math.clamp((s - acc[j]) / seg, 0, 1)
		local src = a.src
		if src.section then
			section = src.section
		end
		-- A flag holds over a waypoint's whole segment only when both ends carry it (a gap runs
		-- from its first flagged waypoint to the last), except boosts, which mark one waypoint.
		local function both(flag: string): boolean
			return (a.src[flag] == true) and (a.nxt[flag] == true or a.t < 0.5)
		end
		table.insert(frames, {
			x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, z = a.z + (b.z - a.z) * f,
			tx = 0, ty = 0, tz = 1, rx = 1, ry = 0, rz = 0, ux = 0, uy = 1, uz = 0,
			w = a.w + (b.w - a.w) * f,
			walls = not both("nowalls"),
			floor = not (a.src.gap == true and a.nxt.gap == true),
			roof = both("roof"),
			boost = if a.src.boost and a.t < 0.35 then 1 else 0,
			section = section,
		})
	end
	-- 3. Tangents, then bank into the turns (from the horizontal curvature, smoothed), then right/up.
	local m = #frames
	local curv = table.create(m, 0)
	for i = 1, m do
		local p = frames[math.max(1, i - 1)]
		local q = frames[math.min(m, i + 1)]
		local tx, ty, tz = unit(q.x - p.x, q.y - p.y, q.z - p.z)
		frames[i].tx, frames[i].ty, frames[i].tz = tx, ty, tz
	end
	for i = 1, m do
		local p = frames[math.max(1, i - 3)]
		local q = frames[math.min(m, i + 3)]
		-- Signed horizontal curvature: the turn of the heading per stud (positive = turning right).
		local h1 = math.atan2(p.tz, p.tx)
		local h2 = math.atan2(q.tz, q.tx)
		local d = math.atan2(math.sin(h2 - h1), math.cos(h2 - h1))
		-- On near-vertical stretches the heading is noise: no turn there.
		local horiz = math.min(math.sqrt(p.tx * p.tx + p.tz * p.tz), math.sqrt(q.tx * q.tx + q.tz * q.tz))
		curv[i] = if horiz < 0.35 then 0 else d / math.max(1, 6 * RaceTrack.STEP)
	end
	for i = 1, m do
		local sum, cnt = 0, 0
		for k = math.max(1, i - 10), math.min(m, i + 10) do
			sum += curv[k]
			cnt += 1
		end
		local c = sum / cnt
		local fr = frames[i]
		-- Flat right vector (horizontal, perpendicular to the heading), then roll it by the bank.
		local rx, rz = -fr.tz, fr.tx
		local rm = math.sqrt(rx * rx + rz * rz)
		rx, rz = rx / math.max(rm, 1e-6), rz / math.max(rm, 1e-6)
		-- The bank a turn needs at the design speed: tan(bank) = v^2 / (g r), with v = 80 studs/s and
		-- g = 110, so v^2/g = 58 studs. A 100-stud-radius turn banks 30 degrees, a 300-stud one 11.
		local bank = math.clamp(math.atan(58 * c), -0.45, 0.45)
		-- Rodrigues: rotate (rx, 0, rz) about the tangent by `bank`.
		local tx, ty, tz = fr.tx, fr.ty, fr.tz
		local cb, sb = math.cos(bank), math.sin(bank)
		local cx, cy, cz = ty * rz - tz * 0, tz * rx - tx * rz, tx * 0 - ty * rx -- t x r
		local dot = tx * rx + tz * rz
		local nrx = rx * cb + cx * sb + tx * dot * (1 - cb)
		local nry = 0 * cb + cy * sb + ty * dot * (1 - cb)
		local nrz = rz * cb + cz * sb + tz * dot * (1 - cb)
		nrx, nry, nrz = unit(nrx, nry, nrz)
		fr.rx, fr.ry, fr.rz = nrx, nry, nrz
		-- up = right x tangent
		local ux, uy, uz = unit(nry * tz - nrz * ty, nrz * tx - nrx * tz, nrx * ty - nry * tx)
		if uy < 0 then
			ux, uy, uz = -ux, -uy, -uz
		end
		fr.ux, fr.uy, fr.uz = ux, uy, uz
	end
	return { id = id, frames = frames, length = count * RaceTrack.STEP }
end

-- ---- Queries ------------------------------------------------------------------------------------

--- The frame at arc length `s` along `path` (interpolated between samples).
function RaceTrack.frame(path: Path, s: number): Frame
	local fs = path.frames
	local x = math.clamp(s / RaceTrack.STEP, 0, #fs - 1)
	local i = math.floor(x)
	local f = x - i
	local a, b = fs[i + 1], fs[math.min(#fs, i + 2)]
	if f < 1e-6 or a == b then
		return a
	end
	local function l(p: number, q: number): number
		return p + (q - p) * f
	end
	return {
		x = l(a.x, b.x), y = l(a.y, b.y), z = l(a.z, b.z),
		tx = l(a.tx, b.tx), ty = l(a.ty, b.ty), tz = l(a.tz, b.tz),
		rx = l(a.rx, b.rx), ry = l(a.ry, b.ry), rz = l(a.rz, b.rz),
		ux = l(a.ux, b.ux), uy = l(a.uy, b.uy), uz = l(a.uz, b.uz),
		w = l(a.w, b.w),
		walls = a.walls, floor = a.floor, roof = a.roof, boost = a.boost, section = a.section,
	}
end

--- The nearest point on `path` to (x, y, z), searching samples from s0 to s1: its s, and the
--- point's offsets along the frame's right (u) and up (h).
function RaceTrack.nearest(path: Path, x: number, y: number, z: number, s0: number, s1: number): (number, number, number, number)
	local fs = path.frames
	local i0 = math.max(1, math.floor(s0 / RaceTrack.STEP) + 1)
	local i1 = math.min(#fs, math.floor(s1 / RaceTrack.STEP) + 1)
	local best, bi = math.huge, i0
	for i = i0, i1 do
		local f = fs[i]
		local d = (x - f.x) ^ 2 + (y - f.y) ^ 2 + (z - f.z) ^ 2
		if d < best then
			best, bi = d, i
		end
	end
	-- Refine along the tangent within the sample's step.
	local f = fs[bi]
	local along = (x - f.x) * f.tx + (y - f.y) * f.ty + (z - f.z) * f.tz
	local s = math.clamp((bi - 1) * RaceTrack.STEP + along, 0, path.length)
	local g = RaceTrack.frame(path, s)
	local dx, dy, dz = x - g.x, y - g.y, z - g.z
	-- The last value: how far the point still is along the track from s (near 0 unless the point
	-- lies beyond either end of the searched stretch).
	return s, dx * g.rx + dy * g.ry + dz * g.rz, dx * g.ux + dy * g.uy + dz * g.uz, math.abs(dx * g.tx + dy * g.ty + dz * g.tz)
end

local cache: any = nil
--- The whole course: its paths by id, the finish's s on the main path, checkpoints (s on main),
--- and the start.
function RaceTrack.get(): any
	if cache then
		return cache
	end
	local main = build("main", MAIN)
	local bridge = build("bridge", ICE_BRIDGE)
	local falls = build("falls", WATERFALL)
	local function anchor(p: Path, q: Path, s0: number, s1: number, x: number, y: number, z: number)
		local s = RaceTrack.nearest(q, x, y, z, s0, s1)
		return { path = q.id, s = s }
	end
	local bf, bl = bridge.frames[1], bridge.frames[#bridge.frames]
	bridge.fork = anchor(bridge, main, 0, main.length, bf.x, bf.y, bf.z)
	bridge.merge = anchor(bridge, main, bridge.fork.s, main.length, bl.x, bl.y, bl.z)
	local ff, fl = falls.frames[1], falls.frames[#falls.frames]
	falls.fork = anchor(falls, main, 0, main.length, ff.x, ff.y, ff.z)
	falls.merge = anchor(falls, main, falls.fork.s, main.length, fl.x, fl.y, fl.z)
	local finish = main.length - RaceTrack.FINISH_S_FROM_END
	-- Checkpoints every ~450 studs of the main path, plus the start; respawns go to the last one.
	-- None within 300 studs before a gap: a respawn needs room to get up to speed for the jump.
	local gaps = {}
	for i, f in ipairs(main.frames) do
		if not f.floor and (i == 1 or main.frames[i - 1].floor) then
			table.insert(gaps, (i - 1) * RaceTrack.STEP)
		end
	end
	local checkpoints = { 8 }
	local s = 450
	while s < finish - 100 do
		local at = s
		for _, g in ipairs(gaps) do
			if at < g and at > g - 300 then
				at = g - 300
			end
		end
		if at > checkpoints[#checkpoints] + 100 then
			table.insert(checkpoints, at)
		end
		s += 450
	end
	-- Stars: learnable lines. On the main path, a row of three on the inside of each section's
	-- sharpest bend (the fast line, but tight against the wall and fighting the turn's pull). Only
	-- on the main route: a full set means passing up both shortcuts, so stars and the gold medal
	-- are two different goals. Positions in track-origin space, sorted down the course.
	local stars = {}
	local function row(p: Path, s0: number, u: number)
		for k = 0, 2 do
			local f = RaceTrack.frame(p, s0 + k * 10)
			table.insert(stars, { path = p.id, s = s0 + k * 10, x = f.x + f.rx * u + f.ux * 3, y = f.y + f.ry * u + f.uy * 3, z = f.z + f.rz * u + f.uz * 3 })
		end
	end
	local fs = main.frames
	local best: { [string]: { i: number, turn: number } } = {}
	for i = 8, #fs - 8 do
		local f = fs[i]
		local clear = true
		for k = i - 12, i + 12 do
			local g = fs[math.clamp(k, 1, #fs)]
			if not g.floor then
				clear = false
			end
		end
		-- Not where the routes split or join: there the player is lining up for a route.
		local at = (i - 1) * RaceTrack.STEP
		for _, b in ipairs({ bridge.fork.s, bridge.merge.s, falls.fork.s, falls.merge.s }) do
			if at > b - 100 and at < b + 160 then
				clear = false
			end
		end
		if clear and at < finish - 60 then
			local a, b = fs[i - 6], fs[i + 6]
			local turn = (b.tx - a.tx) * f.rx + (b.ty - a.ty) * f.ry + (b.tz - a.tz) * f.rz
			local cur = best[f.section]
			if not cur or math.abs(turn) > math.abs(cur.turn) then
				best[f.section] = { i = i, turn = turn }
			end
		end
	end
	for _, b in pairs(best) do
		local f = fs[b.i]
		if math.abs(b.turn) > 0.05 then
			row(main, (b.i - 1) * RaceTrack.STEP - 10, (if b.turn > 0 then 1 else -1) * (f.w / 2 - 5))
		end
	end
	table.sort(stars, function(p, q)
		return p.s < q.s
	end)
	cache = {
		stars = stars,
		paths = { main = main, bridge = bridge, falls = falls },
		order = { "main", "bridge", "falls" },
		finish = finish,
		checkpoints = checkpoints,
		name = RaceTrack.NAME,
	}
	return cache
end

--- World position of a track-space point.
function RaceTrack.world(f: Frame, u: number, h: number): Vector3
	return RaceTrack.ORIGIN + Vector3.new(f.x + f.rx * u + f.ux * h, f.y + f.ry * u + f.uy * h, f.z + f.rz * u + f.uz * h)
end

return RaceTrack
