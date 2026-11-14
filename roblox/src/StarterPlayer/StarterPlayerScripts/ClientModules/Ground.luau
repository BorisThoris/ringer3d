-- How the field answers the marbles, on this client: what a rolling marble kicks up (grass
-- clippings, sand, a spray of frost, gravel chips, chalk dust, a glint off the varnish), the tracks
-- it leaves in sand and on ice, a puff where a hopping marble lands, a burst of the bank's own
-- stuff where one slams into it, and chunks flying off a prop it smashes. While a field is
-- watched, its scenery sways too (tree crowns, palm fronds, bushes, grass tufts, flowers).

local Debris = game:GetService("Debris")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local Workspace = game:GetService("Workspace")

local Sim = require(ReplicatedStorage.Ringer.Sim)

local Ground = {}
Ground.surface = nil :: string?
Ground.emitted = 0 -- particles thrown so far (tests read it)
Ground.tracks = 0

local TEX = "rbxasset://textures/particles/sparkles_main.dds"
local SMOKE = "rbxasset://textures/particles/smoke_main.dds"
local hex = Color3.fromHex

-- What each surface throws up: colour, size, how high and how far it flies, and the texture.
local KICK = {
	grass = { colors = { hex("#5fd14a"), hex("#3aa83a"), hex("#9be05a") }, size = 0.35, up = 9, out = 4, tex = TEX, gravity = -40, tracks = false },
	turf = { colors = { hex("#4fd16a"), hex("#2fae4f") }, size = 0.3, up = 7, out = 4, tex = TEX, gravity = -40, tracks = false },
	sand = { colors = { hex("#f0d9a6"), hex("#e2c58a") }, size = 1.1, up = 5, out = 3, tex = SMOKE, gravity = -12, tracks = true, track = hex("#c9ad7a") },
	ice = { colors = { hex("#ffffff"), hex("#d8f0ff") }, size = 0.4, up = 4, out = 7, tex = TEX, gravity = -25, tracks = true, track = hex("#e8f6ff") },
	gravel = { colors = { hex("#9a9187"), hex("#7d766d"), hex("#b8afa3") }, size = 0.45, up = 10, out = 5, tex = TEX, gravity = -60, tracks = false },
	concrete = { colors = { hex("#f4f4f4"), hex("#d9d9e0") }, size = 0.9, up = 3, out = 3, tex = SMOKE, gravity = -6, tracks = false },
	wood = { colors = { hex("#fff3d6"), hex("#ffe0a8") }, size = 0.25, up = 3, out = 2, tex = TEX, gravity = -8, tracks = false },
}

local SWAY = { Crown = 0.6, Frond = 0.5, Bush = 0.25, Tuft = 0.18, Petals = 0.15, Middle = 0.15, Needles = 0.2, Sail = 0 }

local anchor: Part? = nil
local emitter: ParticleEmitter? = nil
local trackFolder: Folder? = nil
local trackList: { { part: BasePart, born: number } } = {}
local sway: { { part: BasePart, base: CFrame, k: number, amp: number } } = {}
local conn: RBXScriptConnection? = nil
local lastTrack: { [number]: Vector3 } = {}
local air: { [number]: boolean } = {}
local carry: { [number]: number } = {}
local S = 4 -- studs per web unit (Config.MAP_SCALE)

local function puff(at: Vector3, n: number, scale: number?)
	local e = emitter
	local a = anchor
	if not e or not a or n < 1 then
		return
	end
	a.Position = at
	if scale then
		local kick = KICK[Ground.surface or ""]
		local s = (kick and kick.size or 0.5) * scale
		e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, s), NumberSequenceKeypoint.new(1, s * 0.3) })
	end
	e:Emit(n)
	Ground.emitted += n
end

--- Start answering the marbles on the field `arenaSurface` (Config surface name) of `tableModel`.
function Ground.enter(surface: string, tableModel: Instance?)
	Ground.leave()
	Ground.surface = surface
	local kick = KICK[surface]
	if not kick then
		return
	end
	local a = Instance.new("Part")
	a.Name = "GroundFx"
	a.Anchored, a.CanCollide, a.CanQuery, a.CanTouch = true, false, false, false
	a.Transparency = 1
	a.Size = Vector3.one * 0.2
	a.Parent = Workspace
	anchor = a
	local e = Instance.new("ParticleEmitter")
	local keys = {}
	for i, c in ipairs(kick.colors) do
		table.insert(keys, ColorSequenceKeypoint.new((i - 1) / math.max(1, #kick.colors - 1), c))
	end
	e.Color = ColorSequence.new(keys)
	e.Texture = kick.tex
	e.Size = NumberSequence.new({ NumberSequenceKeypoint.new(0, kick.size), NumberSequenceKeypoint.new(1, kick.size * 0.3) })
	e.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 0.05), NumberSequenceKeypoint.new(0.7, 0.3), NumberSequenceKeypoint.new(1, 1) })
	e.Lifetime = NumberRange.new(0.5, 0.9)
	e.Speed = NumberRange.new(kick.out * 0.5, kick.out)
	e.SpreadAngle = Vector2.new(70, 70)
	e.EmissionDirection = Enum.NormalId.Top
	e.Acceleration = Vector3.new(0, kick.gravity, 0)
	e.RotSpeed = NumberRange.new(-300, 300)
	e.Rotation = NumberRange.new(0, 360)
	e.Drag = 1.5
	e.LightInfluence = 0.6
	e.Rate = 0
	e.Parent = a
	emitter = e
	if kick.tracks then
		local f = Instance.new("Folder")
		f.Name = "Tracks"
		f.Parent = Workspace
		trackFolder = f
	end
	-- The scenery sways in a breeze while you watch (the desk and the street are indoors-still).
	local scenery = tableModel and tableModel:FindFirstChild("Scenery", true)
	if scenery and surface ~= "wood" and surface ~= "concrete" then
		for _, p in ipairs(scenery:GetDescendants()) do
			local amp = SWAY[p.Name]
			if amp and amp > 0 and p:IsA("BasePart") then
				table.insert(sway, { part = p, base = p.CFrame, k = p.Position.X * 0.07 + p.Position.Z * 0.05, amp = amp })
			end
		end
	end
	local t = 0
	local frame = 0
	local tick = if RunService:IsClient() then RunService.RenderStepped else RunService.Heartbeat
	conn = tick:Connect(function(dt)
		t += dt
		frame += 1
		if frame % 2 == 0 then
			for _, s in ipairs(sway) do
				local w = t * 1.4 + s.k
				s.part.CFrame = s.base * CFrame.new(math.sin(w) * s.amp, 0, math.cos(w * 0.7) * s.amp * 0.5) * CFrame.Angles(math.sin(w * 0.9) * s.amp * 0.03, 0, math.cos(w) * s.amp * 0.04)
			end
		end
		-- Tracks fade out over a few seconds.
		local now = os.clock()
		for i = #trackList, 1, -1 do
			local tr = trackList[i]
			local age = now - tr.born
			if age > 6 then
				tr.part:Destroy()
				table.remove(trackList, i)
			else
				tr.part.Transparency = 0.45 + 0.55 * (age / 6)
			end
		end
	end)
end

--- Stop: the table was left.
function Ground.leave()
	if conn then
		conn:Disconnect()
		conn = nil
	end
	for _, s in ipairs(sway) do
		if s.part.Parent then
			s.part.CFrame = s.base
		end
	end
	sway = {}
	if anchor then
		anchor:Destroy()
		anchor = nil
	end
	emitter = nil
	if trackFolder then
		trackFolder:Destroy()
		trackFolder = nil
	end
	trackList = {}
	lastTrack, air, carry = {}, {}, {}
	Ground.surface = nil
end

--- Every replay frame: the marbles as the sim has them, and where the table's centre is.
function Ground.roll(bodies: { any }, origin: Vector3, dt: number)
	local kick = KICK[Ground.surface or ""]
	if not kick or not anchor then
		return
	end
	for _, b in ipairs(bodies) do
		local speed = math.sqrt(b.vx * b.vx + b.vz * b.vz)
		local onGround = b.py <= b.r * 1.25
		local at = origin + Vector3.new(b.px * S, 0.15, b.pz * S)
		-- A hop coming down: a puff where it lands.
		if air[b.id] and onGround then
			puff(at, 10, 1.6)
		end
		air[b.id] = not onGround
		if not onGround or speed < 0.6 then
			lastTrack[b.id] = nil
			continue
		end
		-- Kick-up in proportion to speed (fractional particles carry over to the next frame).
		local k = math.min(1, speed / Sim.WORLD.maxShotSpeed)
		local want = (carry[b.id] or 0) + dt * (6 + 60 * k)
		local n = math.floor(want)
		carry[b.id] = want - n
		if n > 0 then
			puff(at - Vector3.new(b.vx, 0, b.vz).Unit * b.r * S * 0.6, n, 0.6 + k)
		end
		-- Tracks in the sand and scratches on the ice, every stud or so.
		if kick.tracks and trackFolder and #trackList < 220 then
			local prev = lastTrack[b.id]
			if not prev then
				lastTrack[b.id] = at
			elseif (at - prev).Magnitude > 1.1 then
				local p = Instance.new("Part")
				p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch, p.CastShadow = true, false, false, false, false
				p.Size = Vector3.new(b.r * S * (if Ground.surface == "ice" then 0.35 else 1.1), 0.04, (at - prev).Magnitude + 0.1)
				p.CFrame = CFrame.lookAt((at + prev) / 2 - Vector3.new(0, 0.12, 0), at - Vector3.new(0, 0.12, 0))
				p.Color = kick.track
				p.Material = if Ground.surface == "ice" then Enum.Material.SmoothPlastic else Enum.Material.Sand
				p.Transparency = 0.45
				p.Parent = trackFolder
				table.insert(trackList, { part = p, born = os.clock() })
				Ground.tracks += 1
				lastTrack[b.id] = at
			end
		end
	end
end

--- A hit on the bank or a piece: a burst of the field's own stuff.
function Ground.slam(pos: Vector3, strength: number)
	puff(pos, math.clamp(math.floor(strength / 40), 4, 26), 1.4)
end

--- A prop smashed: chunks of it fly, tumble and bounce, then fade.
function Ground.shatter(pos: Vector3, color: Color3, material: Enum.Material?)
	local chunks = {}
	local rng = Random.new()
	for _ = 1, 9 do
		local c = Instance.new("Part")
		c.Anchored, c.CanCollide, c.CanQuery, c.CanTouch, c.CastShadow = true, false, false, false, false
		local s = rng:NextNumber(0.5, 1.4)
		c.Size = Vector3.new(s, s * rng:NextNumber(0.5, 1), s * rng:NextNumber(0.6, 1.2))
		c.Color = color:Lerp(Color3.new(1, 1, 1), rng:NextNumber(0, 0.25))
		c.Material = material or Enum.Material.SmoothPlastic
		c.CFrame = CFrame.new(pos)
		c.Parent = Workspace
		local a = rng:NextNumber() * math.pi * 2
		local out = rng:NextNumber(6, 14)
		table.insert(chunks, { part = c, at = pos, v = Vector3.new(math.cos(a) * out, rng:NextNumber(12, 22), math.sin(a) * out), w = Vector3.new(rng:NextNumber(-12, 12), rng:NextNumber(-12, 12), rng:NextNumber(-12, 12)), floor = pos.Y - 0.5 })
		Debris:AddItem(c, 2.5)
	end
	puff(pos, 18, 2)
	local t = 0
	local c2
	c2 = RunService.Heartbeat:Connect(function(dt)
		t += dt
		for _, c in ipairs(chunks) do
			c.v += Vector3.new(0, -70 * dt, 0)
			c.at += c.v * dt
			if c.at.Y < c.floor then
				c.at = Vector3.new(c.at.X, c.floor, c.at.Z)
				c.v = Vector3.new(c.v.X * 0.6, -c.v.Y * 0.3, c.v.Z * 0.6)
				c.w *= 0.6
			end
			if c.part.Parent then
				c.part.CFrame = CFrame.new(c.at) * CFrame.Angles(c.w.X * t, c.w.Y * t, c.w.Z * t)
				if t > 1.6 then
					c.part.Transparency = math.min(1, (t - 1.6) / 0.8)
				end
			end
		end
		if t > 2.4 then
			c2:Disconnect()
		end
	end)
end

return Ground
