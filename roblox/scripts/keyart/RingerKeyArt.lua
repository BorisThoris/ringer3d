-- Key-art rig (Studio local plugin): only in a place with ReplicatedStorage.PageShots.
-- Stages thumbnail scenes the way top Roblox games do theirs: the owner's avatar big in the
-- foreground, posed, acting on the game's hook (a flick, a Mythic held up, the aura pillar), from
-- the game's own assets. Captures land in tmp-capture-storage, logged "[keyart] capture <label>".
local RS = game:GetService("ReplicatedStorage")
if not RS:FindFirstChild("PageShots") then return end
local RunService = game:GetService("RunService")
if not RunService:IsEdit() then return end
local CaptureService = game:GetService("CaptureService")
local SSS = game:GetService("ServerScriptService")
local Players = game:GetService("Players")
local Lighting = game:GetService("Lighting")
local function log(...) print("[keyart]", ...) end
local OWNER = 11900418890

local cam = workspace.CurrentCamera
local function snap(label, from, at, fov, settle)
	local t1 = os.clock()
	while os.clock() - t1 < (settle or 2.5) do
		cam.CameraType = Enum.CameraType.Scriptable
		cam.FieldOfView = fov or 50
		cam.CFrame = CFrame.lookAt(from, at)
		cam.Focus = CFrame.new(at)
		task.wait()
	end
	-- A capture can go unanswered under load (three did): wait longer, then try once more.
	for attempt = 1, 2 do
		local done = false
		CaptureService:CaptureScreenshot(function(id) log("capture", label, id) done = true end)
		local t = os.clock()
		while not done and os.clock() - t < 12 do task.wait(0.1) end
		if done then break end
		log("capture timeout", label, attempt)
	end
	task.wait(0.6)
end
local function step(name, fn)
	local ok, err = pcall(fn)
	log("section", name, ok, ok and "" or tostring(err))
end

local t0 = os.clock()
while cam.ViewportSize.X < 1500 and os.clock() - t0 < 90 do task.wait(1) end
log("viewport", cam.ViewportSize)
RunService:Run()
task.wait(12)

-- Punchy grade, like the key art on the charts: saturated, contrasty, a little bloom.
local cc = Instance.new("ColorCorrectionEffect")
cc.Saturation = 0.28
cc.Contrast = 0.12
cc.Brightness = 0.03
cc.Parent = Lighting
local bloom = Instance.new("BloomEffect")
bloom.Intensity = 0.25
bloom.Size = 30
bloom.Threshold = 2.2
bloom.Parent = Lighting
Lighting.ClockTime = 14.2

-- The owner's avatar, anchored, ready to pose.
local function avatar(): Model
	local ok, desc = pcall(function() return Players:GetHumanoidDescriptionFromUserId(OWNER) end)
	log("avatar description", ok)
	if not ok then desc = Instance.new("HumanoidDescription") end
	-- The classic head and smile: a dynamic head ignores face decals and stays blank.
	desc.Head = 0
	desc.Face = 0
	pcall(function() desc.MoodAnimation = 0 end)
	local m = Players:CreateHumanoidModelFromDescription(desc, Enum.HumanoidRigType.R15)
	-- Only the root is anchored: anchored limbs ignore the joint constraints that pose them.
	for _, p in ipairs(m:GetDescendants()) do
		if p:IsA("BasePart") then p.Anchored = p.Name == "HumanoidRootPart" end
	end
	local hum = m:FindFirstChildOfClass("Humanoid")
	if hum then hum.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None end
	-- The classic big smile (ships with Roblox): the charts' avatars always emote.
	local head = m:FindFirstChild("Head")
	if head then
		local face = head:FindFirstChild("face") or head:FindFirstChildOfClass("Decal")
		if not face then
			face = Instance.new("Decal")
			face.Name = "face"
			face.Face = Enum.NormalId.Front
			face.Parent = head
		end
		(face :: Decal).Texture = "rbxasset://textures/face.png"
		local kids = {}
		for _, c in ipairs(head:GetChildren()) do table.insert(kids, c.ClassName .. ":" .. c.Name) end
		log("head", head.ClassName, head:IsA("MeshPart") and (head :: any).MeshId or "", head:IsA("MeshPart") and (head :: any).TextureID or "", table.concat(kids, ","))
		if head:IsA("MeshPart") then
			-- A dynamic head: the smile decal wraps badly over its mesh. Swap in a classic block
			-- head, moving its attachments (hair, hat, neck) and retargeting welds.
			if hum then
				hum.RequiresNeck = false
				hum.BreakJointsOnDeath = false
			end
			local new = Instance.new("Part")
			new.Name = "Head"
			new.Size = Vector3.new(2, 1, 1)
			new.Color = head.Color
			new.Anchored = false
			new.CanCollide = false
			new.TopSurface = Enum.SurfaceType.Smooth
			new.BottomSurface = Enum.SurfaceType.Smooth
			new.CFrame = head.CFrame
			local mesh = Instance.new("SpecialMesh")
			mesh.MeshType = Enum.MeshType.Head
			mesh.Scale = Vector3.new(1.25, 1.25, 1.25)
			mesh.Parent = new
			local smile = Instance.new("Decal")
			smile.Name = "face"
			smile.Face = Enum.NormalId.Front
			smile.Texture = "rbxasset://textures/face.png"
			smile.Parent = new
			for _, c in ipairs(head:GetChildren()) do
				if c:IsA("Attachment") or c:IsA("AnimationConstraint") or c:IsA("BallSocketConstraint") then
					c.Parent = new
				end
			end
			for _, d in ipairs(m:GetDescendants()) do
				for _, prop in ipairs({ "Part0", "Part1" }) do
					local ok2, v = pcall(function() return (d :: any)[prop] end)
					if ok2 and v == head then
						pcall(function() (d :: any)[prop] = new end)
					end
				end
			end
			new.Parent = m
			head:Destroy()
		end
	end
	m.Parent = workspace
	-- Let the rig finish building (accessories rebuild the joints), and stop the Animator
	-- resetting them, before anything is posed.
	task.wait(2)
	for _, d in ipairs(m:GetDescendants()) do
		if d:IsA("Animator") then d:Destroy() end
	end
	return m
end
local function pose(m: Model, joints: { [string]: CFrame })
	-- Every frame before physics, the way animation overrides are done: something rebuilds or
	-- resets the joints after a one-off set (two renders showed the arms still down).
	local motors = {}
	for _, d in ipairs(m:GetDescendants()) do
		-- Motor6D on classic rigs; AnimationConstraint on the new avatar joints (this avatar).
		if (d:IsA("Motor6D") or d:IsA("AnimationConstraint")) and joints[d.Name] then
			table.insert(motors, d)
		end
	end
	log("pose motors", #motors)
	local conn
	conn = RunService.Stepped:Connect(function()
		if not m.Parent then conn:Disconnect() return end
		for _, d in ipairs(motors) do
			d.Transform = joints[d.Name]
		end
	end)
end
local function place(m: Model, at: Vector3, face: Vector3)
	m:PivotTo(CFrame.lookAt(at, Vector3.new(face.X, at.Y, face.Z)))
end
local rad = math.rad

local MarbleLook = require(RS.Ringer.MarbleLook)
local function marble(id, r, at)
	local b = MarbleLook.make(MarbleLook.lookFor(id), r)
	b.Anchored = true
	b.CanCollide = false
	b.CFrame = CFrame.new(at) * CFrame.Angles(math.random() * 6, math.random() * 6, 0)
	b.Parent = workspace
	return b
end

-- A matte of the last shot: everything but `keep` hidden, the camera inside a flat neon-green
-- box (floor at the subject's feet), no grade. The compositor keys the green to cut the subject
-- out (the charts' white-outlined cutouts over a sunburst). Everything is put back after.
local GREEN = Color3.fromRGB(0, 255, 0)
local function matte(label, keep: { Instance }, from, at, fov, floorY)
	local function kept(x)
		for _, k in ipairs(keep) do
			if x == k or x:IsDescendantOf(k) then return true end
		end
		return false
	end
	local undo = {}
	for _, d in ipairs(workspace:GetDescendants()) do
		if kept(d) then
			-- The subject's silhouette must be solid: glass seen against green keys patchily, and
			-- loose sparkles become specks. Opaque white glass and no particles, in the matte only.
			if d:IsA("BasePart") and d.Transparency > 0 and d.Transparency < 1 then
				table.insert(undo, { d, "Transparency", d.Transparency })
				table.insert(undo, { d, "Material", d.Material })
				table.insert(undo, { d, "Color", d.Color })
				d.Transparency = 0
				d.Material = Enum.Material.SmoothPlastic
				d.Color = Color3.new(1, 1, 1)
			elseif d:IsA("ParticleEmitter") or d:IsA("Sparkles") then
				table.insert(undo, { d, "Enabled", d.Enabled })
				d.Enabled = false
			end
		elseif not kept(d) then
			if d:IsA("BasePart") or d:IsA("Decal") or d:IsA("Texture") then
				table.insert(undo, { d, "Transparency", d.Transparency })
				d.Transparency = 1
			elseif d:IsA("ParticleEmitter") or d:IsA("Beam") or d:IsA("Trail") or d:IsA("BillboardGui") or d:IsA("SurfaceGui") or d:IsA("Light") then
				table.insert(undo, { d, "Enabled", d.Enabled })
				d.Enabled = false
			end
		end
	end
	cc.Enabled = false
	bloom.Enabled = false
	local box = Instance.new("Model")
	box.Name = "MatteBox"
	-- Small: terrain doesn't hide like parts, so the walls must sit inside the far hills.
	local S = 80
	local T = workspace.Terrain
	local deco = T.Decoration
	pcall(function() T.Decoration = false end)
	local function wall(size, pos)
		local p = Instance.new("Part")
		p.Anchored = true
		p.CanCollide = false
		p.Material = Enum.Material.Neon
		p.Color = GREEN
		p.CastShadow = false
		p.Size = size
		p.CFrame = CFrame.new(pos)
		p.Parent = box
	end
	local c = Vector3.new(at.X, floorY + 0.25, at.Z) -- a hair above the grass surface
	wall(Vector3.new(S, 1, S), c - Vector3.new(0, 0.5, 0)) -- floor, top at floorY
	wall(Vector3.new(S, 1, S), c + Vector3.new(0, S / 2, 0))
	wall(Vector3.new(1, S, S), c + Vector3.new(S / 2, 0, 0))
	wall(Vector3.new(1, S, S), c - Vector3.new(S / 2, 0, 0))
	wall(Vector3.new(S, S, 1), c + Vector3.new(0, 0, S / 2))
	wall(Vector3.new(S, S, 1), c - Vector3.new(0, 0, S / 2))
	box.Parent = workspace
	snap(label .. "-matte", from, at, fov, 1.5)
	box:Destroy()
	pcall(function() T.Decoration = deco end)
	for _, u in ipairs(undo) do
		pcall(function() (u[1] :: any)[u[2]] = u[3] end)
	end
	cc.Enabled = true
	bloom.Enabled = true
end

-- 1. THE FLICK: the avatar at the ring's edge, arm out, marbles bursting out of the ring.
step("flick", function()
	local Table = require(SSS.Server.Table)
	local o = Vector3.new(2400, 0, 1500)
	local ok, tbl = pcall(Table.new, {
		seats = { { kind = "bot", bot = "expert", name = "A", marble = "ember" }, { kind = "bot", bot = "skilled", name = "B", marble = "tide" } },
		arena = "grass", origin = o, mode = "bot", seed = 7,
	})
	log("table", ok)
	task.wait(3)
	-- Burst: the cross flying outward and up from the middle.
	-- No green marbles: the matte keys green.
	local ids = { "ember", "tide", "aurora", "comet", "pumpkin", "pumpkin", "volt", "rime", "ironside", "pip", "ember", "tide", "comet" }
	local burst = {}
	for i, id in ipairs(ids) do
		local a = (i / #ids) * math.pi * 2
		local r = 2 + (i % 4) * 1.6
		local up = 0.6 + ((i * 7) % 5) * 0.7
		table.insert(burst, marble(id, 0.55, o + Vector3.new(math.cos(a) * r, up, math.sin(a) * r)))
	end
	-- Hide the table's own marbles so only the burst shows.
	if ok and tbl.parts then
		for _, p in pairs(tbl.parts) do
			if typeof(p) == "Instance" and p:IsA("BasePart") then p.Transparency = 1 end
		end
	end
	local shooter = marble("aurora", 0.85, o + Vector3.new(-3.2, 1.2, 4.2))
	-- The avatar kneels at the ring's edge, flicking hand forward.
	local m = avatar()
	local at = o + Vector3.new(-5.5, 2.2, 5.5)
	place(m, at, o)
	pose(m, {
		RightShoulder = CFrame.Angles(rad(80), 0, rad(-10)),
		RightElbow = CFrame.Angles(rad(15), 0, 0),
		LeftShoulder = CFrame.Angles(rad(-25), 0, rad(-35)),
		Waist = CFrame.Angles(rad(-18), rad(10), 0),
		Neck = CFrame.Angles(rad(-8), rad(-12), 0),
		RightHip = CFrame.Angles(rad(70), 0, 0),
		RightKnee = CFrame.Angles(rad(-95), 0, 0),
		LeftHip = CFrame.Angles(rad(-10), 0, 0),
		LeftKnee = CFrame.Angles(rad(-80), 0, 0),
	})
	task.wait(2)
	local face = at + Vector3.new(0, 1.5, 0)
	-- Low and wide: the avatar big on the left, the burst on the right.
	local back = (o - at).Unit
	local across = back:Cross(Vector3.yAxis)
	local keep = { m, shooter }
	for _, b in ipairs(burst) do table.insert(keep, b) end
	local camA, aimA = o + back * 3.5 + across * 1.2 + Vector3.new(0, 1.1, 0), face + Vector3.new(0, -0.6, 0)
	snap("flick-a", camA, aimA, 62, 3)
	matte("flick-a", keep, camA, aimA, 62, o.Y)
	local camF, aimF = face + (o - at).Unit * 5 + Vector3.new(1.5, 0.4, 0), face
	snap("flick-face", camF, aimF, 50, 2)
	matte("flick-face", keep, camF, aimF, 50, o.Y)
	m:Destroy()
	shooter:Destroy()
	for _, b in ipairs(burst) do b:Destroy() end
end)

-- 2. THE MYTHIC: the avatar holding a giant glowing Mythic marble over their head in the lobby.
step("mythic", function()
	local Forge = require(RS.Ringer.Forge)
	local _ = Forge
	local mythic = "blackhole" -- the Premium Mythic: a purple galaxy reads better than white glare
	local at = Vector3.new(-26, 2.9, 22)
	local m = avatar()
	place(m, at, Vector3.new(0, 0, 0))
	pose(m, {
		RightShoulder = CFrame.Angles(rad(165), 0, rad(14)),
		LeftShoulder = CFrame.Angles(rad(165), 0, rad(-14)),
		RightElbow = CFrame.Angles(rad(25), 0, 0),
		LeftElbow = CFrame.Angles(rad(25), 0, 0),
		Waist = CFrame.Angles(rad(8), 0, 0),
		Neck = CFrame.Angles(rad(14), 0, 0),
	})
	local look = (Vector3.new(0, at.Y, 0) - at).Unit
	local ball = marble(mythic, 2.6, at + Vector3.new(0, 6.2, 0) + look * 0.4)
	local glow = Instance.new("PointLight")
	glow.Range = 16
	glow.Brightness = 2.5
	glow.Color = MarbleLook.uiColor(MarbleLook.lookFor(mythic))
	glow.Parent = ball
	task.wait(2)
	local front = at + look * 10 + Vector3.new(0, 0.2, 0)
	local _ = front
	local feet = at.Y - 2.95
	-- Wider and a touch further back than before, so the whole pose and the marble fit with room
	-- for the outline.
	local camM, aimM = at + look * 10 + Vector3.new(0, -0.2, 0) + look:Cross(Vector3.yAxis) * 1.5, at + Vector3.new(0, 3.2, 0)
	snap("mythic-a", camM, aimM, 60, 3)
	matte("mythic-a", { m, ball }, camM, aimM, 60, feet)
	local camI, aimI = at + look * 6.5 + Vector3.new(0, 4.5, 0), at + Vector3.new(0, 4.4, 0)
	snap("mythic-icon", camI, aimI, 55, 2)
	matte("mythic-icon", { m, ball }, camI, aimI, 55, feet)
	m:Destroy()
	ball:Destroy()
end)

-- 3. MAIN CHARACTER: the avatar in the gold pillar, flexing, the Celestial aura on.
step("aura", function()
	local Flex = require(SSS.Server.Flex)
	local at = Vector3.new(24, 2.9, 24)
	local m = avatar()
	place(m, at, Vector3.new(0, 0, 0))
	pose(m, {
		RightShoulder = CFrame.Angles(0, 0, rad(145)),
		LeftShoulder = CFrame.Angles(0, 0, rad(-145)),
		RightElbow = CFrame.Angles(rad(10), 0, 0),
		LeftElbow = CFrame.Angles(rad(10), 0, 0),
		Neck = CFrame.Angles(rad(10), 0, 0),
	})
	Flex.dress(m, "Celestial", true, true)
	task.wait(4)
	local look = (Vector3.new(0, at.Y, 0) - at).Unit
	snap("aura-a", at + look * 7.5 + Vector3.new(0, -1, 0), at + Vector3.new(0, 3.8, 0), 64, 3)
	snap("aura-b", at + look * 8 + look:Cross(Vector3.yAxis) * 4 + Vector3.new(0, -0.5, 0), at + Vector3.new(0, 3.5, 0), 60, 2)
	m:Destroy()
end)

-- 4. THE RACE: a marble flying at the camera off a jump on Marble Mountain.
step("race", function()
	local RaceWorld = require(RS.Ringer.RaceWorld)
	local RaceTrack = require(RS.Ringer.RaceTrack)
	local built = RaceWorld.build(workspace)
	task.wait(5)
	local main = built.course.paths.main
	local jumps = 0
	for i, f in ipairs(main.frames) do
		if jumps < 2 and i > 1 and not f.floor and main.frames[i - 1].floor then
			jumps += 1
			local s = (i - 1) * RaceTrack.STEP + 10
			local fr = RaceTrack.frame(main, s)
			local p = RaceTrack.world(fr, 0, 2 + 6)
			local t = Vector3.new(fr.tx, fr.ty, fr.tz)
			local side = t:Cross(Vector3.yAxis).Unit
			local me = marble("aurora", 2, p)
			local g1 = marble("ember", 2, p - t * 9 + side * 3 + Vector3.new(0, -1.5, 0))
			local g2 = marble("tide", 2, p - t * 17 - side * 3 + Vector3.new(0, -2.5, 0))
			snap(("race-%d-front"):format(jumps), p + t * 5.5 + side * 1.5 + Vector3.new(0, -1, 0), p - t * 6 + Vector3.new(0, -2, 0), 75, 2)
			snap(("race-%d-low"):format(jumps), p + t * 6 - side * 5 + Vector3.new(0, -5, 0), p - t * 4 + Vector3.new(0, 1, 0), 78, 2)
			me:Destroy() g1:Destroy() g2:Destroy()
		end
	end
end)
log("done")
