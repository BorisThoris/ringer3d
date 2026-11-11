-- (Pasted into tests/sim.luau by scripts/sim-fixtures.ts after SETS and CASES.)
local ONLY = nil -- set to a group name to run just that group
local groups, order = {}, {}
local worst = {}
local t0 = os.clock()
local steps = 0
for ci, c in ipairs(CASES) do
	local gname = string.match(c.group, "^[^:]+")
	if c.group:sub(1, 6) == "piece:" then
		gname = c.group
	end
	if ONLY and gname ~= ONLY then
		continue
	end
	local pieces = if c.set > 0 then SETS[c.set] else {}
	local layout = { targets = c.targets, shooter = nil }
	local sim = Sim.new(layout, Surfaces[c.arena], c.shot, c.first, pieces)
	local broken = 0
	while not sim.done do
		sim:step()
		broken += #sim.broke
	end
	steps += sim.steps
	local got = sim:resultLayout()
	local w = c.want
	-- Position error, marble by marble (by id), in web units.
	local err, n, maxErr = 0, 0, 0
	local byId = {}
	for _, t in ipairs(got.targets) do
		byId[t.id] = t
	end
	if got.shooter then
		byId[100] = got.shooter
	end
	local function cmp(a, b)
		if not (a and b) then
			return
		end
		local e = math.sqrt((a.x - b.x) ^ 2 + (a.z - b.z) ^ 2)
		err += e
		n += 1
		maxErr = math.max(maxErr, e)
	end
	for _, t in ipairs(w.targets) do
		cmp(t, byId[t.id])
	end
	cmp(w.shooter, got.shooter)
	-- Loose props: where each ended up.
	local perr, pn = 0, 0
	if w.props and got.props then
		local gp = {}
		for _, p in ipairs(got.props) do
			gp[p.i] = p
		end
		for _, p in ipairs(w.props) do
			local q = gp[p.i]
			if q and not p.broken and not q.broken then
				perr += math.sqrt((p.x - q.x) ^ 2 + (p.z - q.z) ^ 2)
				pn += 1
			end
		end
	end
	local captured = 0
	for _, t in ipairs(got.targets) do
		if Sim.isOutsideRing(t.x, t.z) then
			captured += 1
		end
	end
	local s = got.shooter
	local shooterOut = not s or Sim.isOutsideRing(s.x, s.z)
	local g = groups[gname]
	if not g then
		g = { pe = 0, pn = 0, n = 0, err = 0, max = 0, cap = 0, out = 0, brk = 0, steps = 0, capJs = 0, capLua = 0 }
		groups[gname] = g
		table.insert(order, gname)
	end
	g.n += 1
	g.pe += perr
	g.pn += pn
	g.err += if n > 0 then err / n else 0
	g.max = math.max(g.max, maxErr)
	g.cap += if captured == w.captured then 1 else 0
	g.out += if shooterOut == w.shooterOut then 1 else 0
	g.brk += if (broken > 0) == (w.broken > 0) then 1 else 0
	g.steps += sim.steps / math.max(1, w.steps)
	g.capJs += w.captured
	g.capLua += captured
	table.insert(worst, { e = maxErr, i = ci, g = c.group, a = c.arena, p = c.shot.power, sp = c.shot.spin, st = sim.steps, ws = w.steps })
end
local secs = os.clock() - t0
print(string.format("%d steps in %.2fs: %.1f us a step", steps, secs, secs / math.max(1, steps) * 1e6))
print("group              n  meanErr  maxErr  capSame  outSame  brkSame  steps/js  caps js/lua  propErr")
local summary = {}
for _, k in ipairs(order) do
	local g = groups[k]
	local line = string.format(
		"%-16s %3d  %7.3f %7.3f   %5.0f%%   %5.0f%%   %5.0f%%   %6.2f    %d/%d   %s",
		k, g.n, g.err / g.n, g.max, g.cap / g.n * 100, g.out / g.n * 100, g.brk / g.n * 100, g.steps / g.n, g.capJs, g.capLua,
		if g.pn > 0 then string.format("%.3f", g.pe / g.pn) else "-"
	)
	print(line)
	summary[k] = { n = g.n, meanErr = g.err / g.n, cap = g.cap / g.n, out = g.out / g.n, brk = g.brk / g.n, steps = g.steps / g.n, capJs = g.capJs, capLua = g.capLua }
end
table.sort(worst, function(a, b)
	return a.e > b.e
end)
for i = 1, math.min(12, #worst) do
	local w = worst[i]
	print(string.format("worst %d: case %d %s %s power %.2f spin %d err %.2f steps %d vs %d", i, w.i, w.g, w.a, w.p, w.sp, w.e, w.st, w.ws))
end
-- What "plays the same" means, measured 2026-11-11 (see roblox/PARITY.md). A free roll or a
-- piece interaction is near exact; a break scatters chaotically, so only its totals must agree.
local bad = {}
local function need(ok, what)
	if not ok then
		table.insert(bad, what)
	end
end
if not ONLY then
	need(summary.roll.meanErr < 0.15, "roll error")
	need(summary.hit.cap >= 0.95, "hit captures")
	need(summary.hit.meanErr < 1.0, "hit error")
	need(summary.map.cap >= 0.85, "map captures")
	need(math.abs(summary["break"].capLua - summary["break"].capJs) <= 2, "break capture total")
	need(math.abs(summary.map.capLua - summary.map.capJs) <= 4, "map capture total")
	for k, g in pairs(summary) do
		need(g.brk == 1, k .. " breaks")
		if k:sub(1, 6) == "piece:" then
			need(g.meanErr < 1.0, k .. " error")
			need(g.cap == 1, k .. " captures")
		end
	end
end
if #bad > 0 then
	error("parity lost: " .. table.concat(bad, ", "))
end
print("parity holds")
return summary
