-- Marble Mountain's world: the track (from RaceTrack's frames), gates, crowds, the terrain mountain,
-- forests, the waterfall, clouds, far peaks, the valley, the lake and the finish village. Shared:
-- each racer's client builds it when they first race (nobody else pays for it), and the previews
-- and tests build it on a cloud server.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

local RaceTrack = require(ReplicatedStorage.Ringer.RaceTrack)
local RaceSim = require(ReplicatedStorage.Ringer.RaceSim)

local RaceWorld = {}

local rgb = Color3.fromRGB

local function part(parent: Instance, props: { [string]: any }): Part
	local p = Instance.new("Part")
	p.Anchored = true
	p.CanCollide = false
	p.CanTouch = false
	p.CanQuery = false
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Material = Enum.Material.SmoothPlastic
	for k, v in pairs(props) do
		(p :: any)[k] = v
	end
	p.Parent = parent
	return p
end

local function ball(parent: Instance, at: Vector3, size: Vector3, color: Color3, material: Enum.Material?): Part
	local p = part(parent, { Size = size, CFrame = CFrame.new(at), Color = color, Material = material or Enum.Material.SmoothPlastic })
	local m = Instance.new("SpecialMesh")
	m.MeshType = Enum.MeshType.Sphere
	m.Parent = p
	return p
end

-- Each section's colours: track floor (two tones, alternating for a sense of speed), walls, trim.
local THEME = {
	["Summit Drop"] = { rgb(235, 245, 255), rgb(210, 230, 250), rgb(90, 170, 255), rgb(255, 255, 255) },
	["Snowcap Esses"] = { rgb(235, 245, 255), rgb(210, 230, 250), rgb(120, 140, 255), rgb(255, 255, 255) },
	["The Fork"] = { rgb(255, 235, 150), rgb(255, 215, 110), rgb(255, 120, 80), rgb(255, 255, 255) },
	["Ice Bridge"] = { rgb(170, 225, 255), rgb(140, 205, 250), rgb(255, 255, 255), rgb(255, 255, 255) },
	["Pillar Spiral"] = { rgb(255, 190, 220), rgb(255, 165, 205), rgb(170, 100, 255), rgb(255, 255, 255) },
	["Pine Canyon"] = { rgb(200, 235, 160), rgb(175, 220, 135), rgb(255, 150, 60), rgb(255, 255, 255) },
	["Canyon Leap"] = { rgb(255, 225, 120), rgb(255, 200, 80), rgb(255, 80, 80), rgb(255, 255, 255) },
	["Corkscrew"] = { rgb(255, 180, 150), rgb(255, 155, 125), rgb(70, 160, 255), rgb(255, 255, 255) },
	["Waterfall Chute"] = { rgb(150, 220, 255), rgb(120, 200, 245), rgb(40, 120, 230), rgb(255, 255, 255) },
	["Glow Tunnel"] = { rgb(120, 90, 200), rgb(100, 70, 180), rgb(255, 90, 220), rgb(120, 255, 240) },
	["Valley Sprint"] = { rgb(190, 240, 150), rgb(165, 228, 125), rgb(255, 200, 50), rgb(255, 255, 255) },
	["Finish"] = { rgb(255, 255, 255), rgb(40, 40, 50), rgb(255, 80, 120), rgb(255, 255, 255) },
}
local function theme(section: string)
	return THEME[section] or THEME["Valley Sprint"]
end

local function frameCF(f: RaceTrack.Frame, u: number, h: number): CFrame
	local p = RaceTrack.world(f, u, h)
	-- Columns: right, up, back (-tangent).
	return CFrame.fromMatrix(p, Vector3.new(f.rx, f.ry, f.rz), Vector3.new(f.ux, f.uy, f.uz), Vector3.new(-f.tx, -f.ty, -f.tz))
end

-- ---- Triangles: the track's surface as one continuous mesh ----------------------------------------
-- Any triangle drawn with two right-angled WedgeParts (the well-known method from EgoMoose's
-- "3D triangles" article): the floor between two cross-sections becomes two triangles, so it follows
-- every bank and twist of the spline with no gaps and no stepped edges. `thick` grows away from the
-- side `down` points to, so the top face stays on the surface.

local function wedge(parent: Instance, size: Vector3, cf: CFrame, color: Color3, material: Enum.Material, name: string)
	local w = Instance.new("WedgePart")
	w.Name = name
	w.Anchored = true
	w.CanCollide, w.CanQuery, w.CanTouch = false, false, false
	w.TopSurface, w.BottomSurface = Enum.SurfaceType.Smooth, Enum.SurfaceType.Smooth
	w.Size = size
	w.CFrame = cf
	w.Color = color
	w.Material = material
	w.Parent = parent
	return w
end

local function triangle(parent: Instance, a: Vector3, b: Vector3, c: Vector3, color: Color3, material: Enum.Material, thick: number, down: Vector3, name: string)
	local ab, ac, bc = b - a, c - a, c - b
	local abd, acd, bcd = ab:Dot(ab), ac:Dot(ac), bc:Dot(bc)
	if abd > acd and abd > bcd then
		c, a = a, c
	elseif acd > bcd and acd > abd then
		a, b = b, a
	end
	ab, ac, bc = b - a, c - a, c - b
	local right = ac:Cross(ab)
	if right.Magnitude < 1e-6 then
		return
	end
	right = right.Unit
	local up = bc:Cross(right).Unit
	local back = bc.Unit
	local height = math.abs(ab:Dot(up))
	local shift = down * (thick / 2)
	wedge(parent, Vector3.new(thick, height, math.abs(ab:Dot(back))), CFrame.fromMatrix((a + b) / 2 + shift, right, up, back), color, material, name)
	wedge(parent, Vector3.new(thick, height, math.abs(ac:Dot(back))), CFrame.fromMatrix((a + c) / 2 + shift, -right, up, -back), color, material, name)
end

local function box(parent: Instance, p: Vector3, q: Vector3, w: number, h: number, upv: Vector3, color: Color3, name: string, material: Enum.Material?)
	local len = (q - p).Magnitude
	if len < 0.05 then
		return
	end
	return part(parent, { Name = name, Size = Vector3.new(w, h, len + 0.6), CFrame = CFrame.lookAt((p + q) / 2, q, upv), Color = color, Material = material or Enum.Material.SmoothPlastic })
end

--- The track: a triangle-mesh floor in speed stripes, walls in alternating kerb colours with a
--- rail on top, a beam underneath, tunnel rings, boost chevrons, and the sections' signs.
local SEG = 2 -- frames per mesh segment (8 studs)
local function buildPath(folder: Folder, path: RaceTrack.Path, main: RaceTrack.Path?, others: { RaceTrack.Path }?)
	local fs = path.frames
	-- Where a branch leaves or rejoins, the other track's floor runs under this one's wall: leave
	-- the wall out there so the way in is open. Only points near a branch's ends are searched.
	local ends = {}
	for _, q in ipairs(others or {}) do
		if q ~= main then
			table.insert(ends, q.frames[1])
			table.insert(ends, q.frames[#q.frames])
		end
	end
	local function overOther(f: RaceTrack.Frame, u: number): boolean
		local x, y, z = f.x + f.rx * u, f.y + f.ry * u, f.z + f.rz * u
		local near = false
		for _, e in ipairs(ends) do
			if (e.x - x) ^ 2 + (e.y - y) ^ 2 + (e.z - z) ^ 2 < 250 * 250 then
				near = true
				break
			end
		end
		if not near then
			return false
		end
		for _, q in ipairs(others or {}) do
			if q ~= path then
				local s, qu, qh, along = RaceTrack.nearest(q, x, y, z, 0, q.length)
				if along < RaceTrack.STEP and math.abs(qh) < 8 and math.abs(qu) < RaceTrack.frame(q, s).w / 2 + 1 then
					return true
				end
			end
		end
		return false
	end
	local lastSection = ""
	local function onMain(f: RaceTrack.Frame): boolean
		-- A branch shares the main path's floor where it leaves and rejoins: draw only its own part.
		if not main or path == main then
			return false
		end
		local s, u, h, along = RaceTrack.nearest(main, f.x, f.y, f.z, 0, main.length)
		if along < RaceTrack.STEP and math.abs(h) < 6 then
			return math.abs(u) < RaceTrack.frame(main, s).w / 2 + 1
		end
		return false
	end
	for i = 1, #fs - SEG, SEG do
		local a, b = fs[i], fs[i + SEG]
		if onMain(a) or onMain(b) then
			continue
		end
		local th = theme(a.section)
		local stripe = (i // SEG) % 2 == 0
		local ua = Vector3.new(a.ux, a.uy, a.uz)
		local ub = Vector3.new(b.ux, b.uy, b.uz)
		local La, Ra = RaceTrack.world(a, -a.w / 2, 0), RaceTrack.world(a, a.w / 2, 0)
		local Lb, Rb = RaceTrack.world(b, -b.w / 2, 0), RaceTrack.world(b, b.w / 2, 0)
		local downv = -(ua + ub).Unit
		if a.floor and b.floor then
			local col = if stripe then th[1] else th[2]
			triangle(folder, La, Ra, Rb, col, Enum.Material.SmoothPlastic, 1.2, downv, "Track")
			triangle(folder, La, Rb, Lb, col, Enum.Material.SmoothPlastic, 1.2, downv, "Track")
			-- A beam underneath, so the track reads as a built thing and not a ribbon.
			local ca, cb = RaceTrack.world(a, 0, -2.6), RaceTrack.world(b, 0, -2.6)
			box(folder, ca, cb, math.min(a.w, b.w) * 0.45, 3, -downv, th[3]:Lerp(Color3.new(0, 0, 0), 0.3), "Beam")
			if a.walls and b.walls then
				for _, sd in ipairs({ -1, 1 }) do
					if overOther(a, sd * (a.w / 2 + 0.6)) or overOther(b, sd * (b.w / 2 + 0.6)) then
						continue
					end
					local wa = RaceTrack.world(a, sd * (a.w / 2 + 0.6), RaceTrack.WALL_H / 2 - 0.6)
					local wb = RaceTrack.world(b, sd * (b.w / 2 + 0.6), RaceTrack.WALL_H / 2 - 0.6)
					-- Kerb colours: the section's colour and white, alternating.
					box(folder, wa, wb, 1.2, RaceTrack.WALL_H + 1.2, -downv, if stripe then th[3] else Color3.fromRGB(255, 255, 255), "Wall")
					local ra = RaceTrack.world(a, sd * (a.w / 2 + 0.6), RaceTrack.WALL_H - 0.1)
					local rb = RaceTrack.world(b, sd * (b.w / 2 + 0.6), RaceTrack.WALL_H - 0.1)
					box(folder, ra, rb, 1.8, 0.6, -downv, th[4], "Rail")
				end
			end
		end
		local mid = RaceTrack.frame(path, (i - 1 + SEG / 2) * RaceTrack.STEP)
		if a.roof and (i // SEG) % 2 == 0 then
			-- Rings of light: an arch of glowing segments over the tunnel.
			local r = mid.w / 2 + 3
			for k = 0, 8 do
				local ang = k / 8 * math.pi
				local u, h = math.cos(ang) * r, math.sin(ang) * r * 0.8
				part(folder, { Name = "Ring", Size = Vector3.new(4, 1.2, 1.2), CFrame = frameCF(mid, u, h) * CFrame.Angles(0, 0, ang + math.pi / 2), Color = if (i // 4) % 2 == 0 then th[3] else th[4], Material = Enum.Material.Neon })
			end
			part(folder, { Name = "TunnelShell", Size = Vector3.new(mid.w + 14, 1, 17), CFrame = frameCF(mid, 0, r * 0.8 + 2), Color = rgb(90, 80, 110), Material = Enum.Material.Rock })
		end
		if a.boost > 0 and a.floor then
			-- Chevrons pointing down the track.
			for _, sd in ipairs({ -1, 1 }) do
				part(folder, { Name = "Boost", Size = Vector3.new(1.2, 0.12, 6), CFrame = frameCF(mid, sd * 3, 0.08) * CFrame.Angles(0, sd * 0.6, 0), Color = rgb(255, 230, 60), Material = Enum.Material.Neon })
			end
		end
		if a.section ~= lastSection then
			lastSection = a.section
			local sign = part(folder, { Name = "SectionSign", Size = Vector3.one, CFrame = frameCF(mid, 0, 14), Transparency = 1 })
			local gui = Instance.new("BillboardGui")
			gui.Size = UDim2.fromScale(26, 4.2)
			gui.LightInfluence = 0
			gui.MaxDistance = 260
			gui.Parent = sign
			local l = Instance.new("TextLabel")
			l.BackgroundTransparency = 1
			l.Size = UDim2.fromScale(1, 1)
			l.Font = Enum.Font.FredokaOne
			l.TextScaled = true
			l.Text = string.upper(a.section)
			l.TextColor3 = Color3.new(1, 1, 1)
			l.Parent = gui
			local st = Instance.new("UIStroke")
			st.Thickness = 3
			st.Color = rgb(30, 22, 40)
			st.Parent = l
		end
	end
end

-- Gates: start, checkpoints, finish. Two posts and a banner across the track, standing upright
-- whatever the track's bank.
local function upright(f: RaceTrack.Frame): RaceTrack.Frame
	local rx, rz = -f.tz, f.tx
	local m = math.max(1e-6, math.sqrt(rx * rx + rz * rz))
	local g = table.clone(f)
	g.rx, g.ry, g.rz = rx / m, 0, rz / m
	g.ux, g.uy, g.uz = 0, 1, 0
	return g
end
local function gate(folder: Folder, f0: RaceTrack.Frame, text: string, color: Color3, big: boolean?)
	local f = upright(f0)
	local h = if big then 20 else 13
	for _, sd in ipairs({ -1, 1 }) do
		part(folder, { Name = "GatePost", Shape = Enum.PartType.Cylinder, Size = Vector3.new(h, 2.4, 2.4), CFrame = frameCF(f, sd * (f.w / 2 + 2), h / 2) * CFrame.Angles(0, 0, math.pi / 2), Color = rgb(255, 255, 255) })
		ball(folder, RaceTrack.world(f, sd * (f.w / 2 + 2), h + 1), Vector3.new(3.4, 3.4, 3.4), color, Enum.Material.Neon)
	end
	local banner = part(folder, { Name = "Banner", Size = Vector3.new(f.w + 4, if big then 6 else 4, 0.6), CFrame = frameCF(f, 0, h - 2), Color = color })
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Back
	gui.LightInfluence = 0
	gui.PixelsPerStud = 24
	gui.Parent = banner
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Size = UDim2.fromScale(1, 1)
	l.Font = Enum.Font.FredokaOne
	l.TextScaled = true
	l.Text = text
	l.TextColor3 = Color3.new(1, 1, 1)
	l.Parent = gui
	local copy = gui:Clone()
	copy.Face = Enum.NormalId.Front
	copy.Parent = banner
	if big then
		-- A checkered band on the floor.
		for k = 0, 9 do
			part(folder, { Name = "Checker", Size = Vector3.new(f.w / 10, 0.1, 3), CFrame = frameCF(f, -f.w / 2 + (k + 0.5) * f.w / 10, 0.06), Color = if k % 2 == 0 then rgb(255, 255, 255) else rgb(30, 30, 40) })
		end
	end
end

-- ---- Crowds: spectator marbles on bleachers, flags flying -----------------------------------------

local FANS = { rgb(255, 90, 110), rgb(255, 200, 50), rgb(80, 200, 255), rgb(120, 230, 110), rgb(190, 110, 255), rgb(255, 150, 60), rgb(255, 255, 255) }
local function crowd(folder: Folder, f0: RaceTrack.Frame, side: number, rng: Random)
	local f = upright(f0)
	local base = side * (f.w / 2 + 10)
	for row = 0, 2 do
		local u = base + side * row * 5
		local h = row * 3
		part(folder, { Name = "Bleacher", Size = Vector3.new(4.6, 1.2 + h, 34), CFrame = frameCF(f, u, (1.2 + h) / 2 - 0.4), Color = rgb(240, 240, 250) })
		for k = 0, 5 do
			local along = -14 + k * 5.6 + rng:NextNumber(-0.8, 0.8)
			local col = FANS[rng:NextInteger(1, #FANS)]
			local at = RaceTrack.world(f, u, h + 3.2) + Vector3.new(f.tx, 0, f.tz).Unit * along
			ball(folder, at, Vector3.new(3.6, 3.6, 3.6), col)
			-- Eyes on the side facing the track.
			local toTrack = (RaceTrack.world(f, 0, h + 3.2) + Vector3.new(f.tx, 0, f.tz).Unit * along - at).Unit
			local left = Vector3.new(0, 1, 0):Cross(toTrack).Unit
			for _, e in ipairs({ -1, 1 }) do
				ball(folder, at + toTrack * 1.55 + left * e * 0.6 + Vector3.new(0, 0.5, 0), Vector3.new(0.9, 1.1, 0.5), rgb(255, 255, 255))
				ball(folder, at + toTrack * 1.85 + left * e * 0.6 + Vector3.new(0, 0.45, 0), Vector3.new(0.45, 0.55, 0.3), rgb(25, 20, 35))
			end
			if rng:NextNumber() < 0.35 then
				-- A little flag on a stick.
				local stick = at + Vector3.new(0, 2.4, 0)
				part(folder, { Name = "FlagStick", Size = Vector3.new(0.15, 3.4, 0.15), CFrame = CFrame.new(stick + Vector3.new(0, 1.2, 0)), Color = rgb(120, 90, 60) })
				part(folder, { Name = "FanFlag", Size = Vector3.new(0.1, 1.2, 1.8), CFrame = CFrame.new(stick + Vector3.new(0, 2.3, 0.9)), Color = FANS[rng:NextInteger(1, #FANS)] })
			end
		end
	end
	-- Tall flags behind the stands.
	for k = -1, 1, 2 do
		local at = RaceTrack.world(f, base + side * 18, 0) + Vector3.new(f.tx, 0, f.tz).Unit * k * 12
		part(folder, { Name = "FlagPole", Size = Vector3.new(0.5, 18, 0.5), CFrame = CFrame.new(at + Vector3.new(0, 9, 0)), Color = rgb(255, 255, 255) })
		part(folder, { Name = "Flag", Size = Vector3.new(0.2, 5, 8), CFrame = CFrame.new(at + Vector3.new(0, 15.5, 4)), Color = FANS[rng:NextInteger(1, #FANS)] })
	end
end

-- ---- The world round the track ------------------------------------------------------------------

local function pine(folder: Instance, at: Vector3, h: number, snow: boolean)
	part(folder, { Name = "Trunk", Shape = Enum.PartType.Cylinder, Size = Vector3.new(h * 0.3, h * 0.1, h * 0.1), CFrame = CFrame.new(at + Vector3.new(0, h * 0.15, 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = rgb(107, 74, 48), Material = Enum.Material.Wood })
	for i = 0, 3 do
		local fr = i / 4
		local r = h * 0.32 * (1 - fr) + h * 0.05
		part(folder, { Name = "Needles", Shape = Enum.PartType.Cylinder, Size = Vector3.new(h * 0.16, r * 2, r * 2), CFrame = CFrame.new(at + Vector3.new(0, h * (0.3 + fr * 0.6), 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = if i % 2 == 0 then rgb(42, 120, 70) else rgb(52, 140, 80), Material = Enum.Material.LeafyGrass })
		if snow then
			part(folder, { Name = "Snow", Shape = Enum.PartType.Cylinder, Size = Vector3.new(h * 0.04, r * 1.5, r * 1.5), CFrame = CFrame.new(at + Vector3.new(0, h * (0.3 + fr * 0.6) + h * 0.09, 0)) * CFrame.Angles(0, 0, math.pi / 2), Color = rgb(245, 250, 255), Material = Enum.Material.Snow })
		end
	end
end

local function materialFor(y: number): Enum.Material
	if y > 640 then
		return Enum.Material.Snow
	elseif y > 470 then
		return Enum.Material.Rock
	elseif y > 200 then
		return Enum.Material.LeafyGrass
	end
	return Enum.Material.Grass
end

--- A faceted low-poly mountain or hill standing on `at`: a jittered base ring, a snow line (or a
--- grassy shoulder), a leaning summit; each facet a slightly different shade so the light reads it.
local function mountain(folder: Folder, rng: Random, at: Vector3, h: number, snowy: boolean)
	local n = 6
	local r = h * (if snowy then 0.75 else 1.6)
	local apex = at + Vector3.new(rng:NextNumber(-0.15, 0.15) * r, h, rng:NextNumber(-0.15, 0.15) * r)
	local lineAt = rng:NextNumber(0.55, 0.68)
	local base, line = {}, {}
	local spin = rng:NextNumber() * math.pi
	for k = 1, n do
		local ang = spin + k / n * math.pi * 2 + rng:NextNumber(-0.25, 0.25)
		local rr = r * rng:NextNumber(0.75, 1.15)
		base[k] = at + Vector3.new(math.cos(ang) * rr, -10, math.sin(ang) * rr)
		line[k] = base[k]:Lerp(apex, lineAt + rng:NextNumber(-0.06, 0.06))
	end
	for k = 1, n do
		local k2 = k % n + 1
		local inward = (at + Vector3.new(0, h * 0.4, 0) - (base[k] + base[k2]) / 2).Unit
		local shade = rng:NextNumber(-12, 12)
		local low = if snowy then rgb(112 + shade, 128 + shade, 158 + shade) else rgb(104 + shade, 168 + shade, 92 + shade)
		local high = if snowy then rgb(238 + shade * 0.5, 244 + shade * 0.4, 255) else rgb(124 + shade, 186 + shade, 104 + shade)
		local lowM = if snowy then Enum.Material.Rock else Enum.Material.Grass
		local highM = if snowy then Enum.Material.Snow else Enum.Material.Grass
		triangle(folder, base[k], base[k2], line[k2], low, lowM, 3, inward, "Peak")
		triangle(folder, base[k], line[k2], line[k], low, lowM, 3, inward, "Peak")
		triangle(folder, line[k], line[k2], apex, high, highM, 3, inward, "Peak")
	end
end

--- The mountain: terrain ridges under every stretch of track (none under the gaps or the bridge,
--- which cross chasms), the massif round the summit, forests, cliffs, the waterfall, clouds, the
--- valley and the lake.
local function buildWorld(folder: Folder, course: any, rng: Random)
	local T = Workspace.Terrain
	local O = RaceTrack.ORIGIN
	local main = course.paths.main
	-- Ridges: balls whose tops sit 7 studs under the track.
	for id, path in pairs(course.paths) do
		if id == "bridge" then
			continue
		end
		for i = 1, #path.frames, 10 do
			local f = path.frames[i]
			local near = false
			for k = math.max(1, i - 12), math.min(#path.frames, i + 12) do
				if not path.frames[k].floor then
					near = true
				end
			end
			if not near and not f.roof then
				local r = 46
				local c = O + Vector3.new(f.x, f.y - r - 7, f.z)
				T:FillBall(c, r, materialFor(f.y))
			end
		end
	end
	-- The massif round the summit and the valley floor.
	T:FillBall(O + Vector3.new(-120, 640, -60), 260, Enum.Material.Rock)
	T:FillBall(O + Vector3.new(-200, 820, -180), 120, Enum.Material.Snow)
	T:FillBall(O + Vector3.new(80, 700, -200), 150, Enum.Material.Snow)
	T:FillBlock(CFrame.new(O + Vector3.new(1300, 5, 1600)), Vector3.new(2600, 10, 1400), Enum.Material.Grass)
	-- The lake past the finish.
	T:FillBlock(CFrame.new(O + Vector3.new(2150, 6, 1720)), Vector3.new(420, 12, 520), Enum.Material.Water)
	-- Forests beside the lower track, snowy pines up high; never on the track.
	for i = 1, #main.frames, 6 do
		local f = main.frames[i]
		if f.roof or not f.floor then
			continue
		end
		for _, sd in ipairs({ -1, 1 }) do
			if rng:NextNumber() < 0.55 then
				local off = sd * (f.w / 2 + rng:NextNumber(14, 50))
				local at = O + Vector3.new(f.x + f.rx * off, f.y - 10 - math.abs(off) * 0.25, f.z + f.rz * off)
				pine(folder, at, rng:NextNumber(22, 38), f.y > 600)
			end
		end
	end
	-- The waterfall beside the chute: a sheet of glassy water and spray at its foot.
	local falls = course.paths.falls
	local top = falls.frames[math.floor(#falls.frames * 0.35)]
	local foot = falls.frames[math.floor(#falls.frames * 0.75)]
	local wx = O + Vector3.new(top.x - top.rx * 40, top.y + 30, top.z - top.rz * 40)
	local wy = O + Vector3.new(foot.x - foot.rx * 40, foot.y - 30, foot.z - foot.rz * 40)
	-- Built from explicit axes: the fall is near vertical, where a look-at rotation is undefined.
	local down = (wy - wx).Unit
	local across = Vector3.new(top.rx, 0, top.rz).Unit
	local facing = across:Cross(down).Unit
	local sheet = part(folder, { Name = "Waterfall", Size = Vector3.new(26, (wx - wy).Magnitude, 3), CFrame = CFrame.fromMatrix((wx + wy) / 2, across, -down, facing), Color = rgb(170, 225, 255), Material = Enum.Material.Glass, Transparency = 0.25 })
	local mist = Instance.new("ParticleEmitter")
	mist.Texture = "rbxasset://textures/particles/smoke_main.dds"
	mist.Color = ColorSequence.new(Color3.new(1, 1, 1))
	mist.Size = NumberSequence.new(8, 22)
	mist.Transparency = NumberSequence.new(0.5, 1)
	mist.Lifetime = NumberRange.new(2, 3)
	mist.Rate = 6
	mist.Speed = NumberRange.new(4, 8)
	mist.Parent = sheet
	-- Clouds drifting below the summit.
	for i = 1, 22 do
		local a = rng:NextNumber() * math.pi * 2
		local d = rng:NextNumber(300, 1400)
		local c = O + Vector3.new(800 + math.cos(a) * d, rng:NextNumber(560, 760), 800 + math.sin(a) * d)
		for k = 1, 4 do
			ball(folder, c + Vector3.new((k - 2.5) * 22, rng:NextNumber(-4, 6), rng:NextNumber(-8, 8)), Vector3.new(40, 22, 30), rgb(255, 255, 255))
		end
	end
	-- Far peaks all round, so the horizon is mountains, not void.
	for i = 0, 23 do
		local a = i / 24 * math.pi * 2
		local d = rng:NextNumber(2400, 3000)
		local at = O + Vector3.new(900 + math.cos(a) * d, 0, 850 + math.sin(a) * d)
		local h = rng:NextNumber(500, 950)
		mountain(folder, rng, at, h, true)
	end
	-- Foothills and pine groves on the plain between the mountain and the far peaks, kept clear
	-- of the course's own footprint.
	local function clearOfCourse(p: Vector3): boolean
		for _, path in pairs(course.paths) do
			for i = 1, #path.frames, 8 do
				local f = path.frames[i]
				if (f.x + O.X - p.X) ^ 2 + (f.z + O.Z - p.Z) ^ 2 < 260 * 260 then
					return false
				end
			end
		end
		return true
	end
	local placed = 0
	for _ = 1, 120 do
		if placed >= 26 then
			break
		end
		local a = rng:NextNumber() * math.pi * 2
		local d = rng:NextNumber(1300, 2200)
		local at = O + Vector3.new(900 + math.cos(a) * d, 0, 850 + math.sin(a) * d)
		if clearOfCourse(at) then
			placed += 1
			mountain(folder, rng, at, rng:NextNumber(70, 160), false)
			for _ = 1, 5 do
				local off = Vector3.new(rng:NextNumber(-260, 260), 0, rng:NextNumber(-260, 260))
				pine(folder, at + off, rng:NextNumber(26, 44), false)
			end
		end
	end
	-- The valley floor out to the far peaks.
	-- A 4x4 grid of 2048-stud tiles (a part's largest size) reaching past the peaks, so no view from
	-- the summit finds the edge of the world.
	for gx = -2, 1 do
		for gz = -2, 1 do
			local c = O + Vector3.new(900 + (gx + 0.5) * 2048, -2, 850 + (gz + 0.5) * 2048)
			local far = math.max(math.abs(gx + 0.5), math.abs(gz + 0.5)) > 1
			part(folder, { Name = "Valley", Size = Vector3.new(2048, 4, 2048), CFrame = CFrame.new(c), Color = if far then rgb(132, 178, 110) else rgb(120, 200, 100), Material = Enum.Material.Grass })
		end
	end
	-- The finish village: little pastel chalets by the lake.
	local fin = main.frames[#main.frames]
	for k = 1, 6 do
		local at = O + Vector3.new(fin.x + rng:NextNumber(-160, 60), 10, fin.z + (if k % 2 == 0 then 1 else -1) * rng:NextNumber(70, 140))
		part(folder, { Name = "Chalet", Size = Vector3.new(30, 22, 26), CFrame = CFrame.new(at + Vector3.new(0, 11, 0)), Color = ({ rgb(255, 190, 210), rgb(255, 230, 150), rgb(170, 220, 255) })[k % 3 + 1] })
		part(folder, { Name = "ChaletRoof", Size = Vector3.new(34, 4, 30), CFrame = CFrame.new(at + Vector3.new(0, 24, 0)), Color = rgb(210, 70, 60) })
	end
end

--- Build the whole race once. Returns its folder and the course's centre (for previews).
local built: any = nil
function RaceWorld.build(parent: Instance?): any
	if built then
		return built
	end
	local course = RaceTrack.get()
	local folder = Instance.new("Folder")
	folder.Name = "MarbleMountain"
	local all = {}
	for _, id in ipairs(course.order) do
		table.insert(all, course.paths[id])
	end
	for _, id in ipairs(course.order) do
		buildPath(folder, course.paths[id], course.paths.main, all)
	end
	local main = course.paths.main
	gate(folder, RaceTrack.frame(main, course.checkpoints[1] + 6), "START", rgb(70, 200, 120), true)
	for k = 2, #course.checkpoints do
		gate(folder, RaceTrack.frame(main, course.checkpoints[k]), "CHECKPOINT " .. (k - 1), rgb(70, 160, 255))
	end
	gate(folder, RaceTrack.frame(main, course.finish), "FINISH", rgb(255, 80, 120), true)
	-- The start platform at the summit.
	local s0 = RaceTrack.frame(main, 0)
	part(folder, { Name = "StartDeck", Size = Vector3.new(60, 4, 60), CFrame = frameCF(s0, 0, -2) * CFrame.new(0, 0, 20), Color = rgb(255, 255, 255), CanCollide = true })
	buildWorld(folder, course, Random.new(42))
	-- Crowds at the start, the big jump, the Corkscrew and the finish.
	local crng = Random.new(9)
	crowd(folder, RaceTrack.frame(main, 40), -1, crng)
	crowd(folder, RaceTrack.frame(main, 40), 1, crng)
	crowd(folder, RaceTrack.frame(main, 2260), -1, crng)
	crowd(folder, RaceTrack.frame(main, 2440), 1, crng)
	crowd(folder, RaceTrack.frame(main, 2860), -1, crng)
	crowd(folder, RaceTrack.frame(main, course.finish - 40), -1, crng)
	crowd(folder, RaceTrack.frame(main, course.finish - 40), 1, crng)
	crowd(folder, RaceTrack.frame(main, course.finish + 40), -1, crng)
	crowd(folder, RaceTrack.frame(main, course.finish + 40), 1, crng)
	folder.Parent = parent or Workspace
	local f = RaceTrack.frame(main, main.length / 2)
	built = { folder = folder, centre = RaceTrack.ORIGIN + Vector3.new(900, 450, 850), course = course, start = RaceSim.position(RaceSim.new()) }
	return built
end


return RaceWorld
