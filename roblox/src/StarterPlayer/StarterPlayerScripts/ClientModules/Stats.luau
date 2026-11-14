-- The stats overlay (F3, or the 📊 button): what is going on under the hood, for the curious and
-- for anyone judging the engineering. Frame rate and frame time, network ping, memory, parts in
-- the world, and the replay check: every shot is simulated on the server, then replayed on this
-- client on the same deterministic Luau physics (Ringer.Sim); the client fingerprints where
-- everything came to rest and compares it with the server's (Playback.layoutHash).

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local StatsService = game:GetService("Stats")
local UserInputService = game:GetService("UserInputService")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Sim = require(ReplicatedStorage.Ringer.Sim)

local Stats = {}
Stats.visible = false
Stats.lines = {} :: { string } -- the last text shown (tests read it)

local frame: Frame? = nil
local label: TextLabel? = nil
local verified: any = nil
local checks, matches = 0, 0
local parts = 0

--- Record a replay check from Replay.onVerified.
function Stats.verified(v: any)
	verified = v
	checks += 1
	if v.ok then
		matches += 1
	end
end

local function render(fps: number, ms: number)
	local player = Players.LocalPlayer
	local ping = 0
	if player then
		local ok, p = pcall(function()
			return player:GetNetworkPing()
		end)
		ping = if ok then p * 1000 else 0
	end
	local mem = 0
	pcall(function()
		mem = StatsService:GetTotalMemoryUsageMb()
	end)
	local lines = {
		string.format("FPS %d  (%.1f ms)", fps, ms),
		string.format("Ping %d ms   Memory %d MB", math.floor(ping + 0.5), math.floor(mem)),
		string.format("Parts in world %d", parts),
		string.format("Physics: Ringer.Sim, deterministic Luau, %d Hz", math.floor(1 / Sim.WORLD.dt + 0.5)),
	}
	if verified then
		table.insert(lines, string.format("Last shot: %d steps, fingerprint %s", verified.steps, verified.hash))
		table.insert(lines, if verified.ok then "Replay matches server: bit-for-bit ✓" else string.format("Replay drift %.4f studs", verified.drift * 4))
	else
		table.insert(lines, "Replay check: play a shot")
	end
	table.insert(lines, string.format("Shots verified this session: %d/%d", matches, checks))
	Stats.lines = lines
	if label then
		label.Text = table.concat(lines, "\n")
	end
end

--- Build the overlay into `gui`, with a toggle button in `buttonParent` (optional).
function Stats.attach(gui: Instance, buttonParent: Instance?)
	local f = Instance.new("Frame")
	f.Name = "Stats"
	f.AnchorPoint = Vector2.new(0, 0)
	-- Bottom-left, above its button: clear of the HUD along the top and the side buttons.
	f.Position = UDim2.new(0, 12, 1, -232)
	f.Size = UDim2.fromOffset(360, 170)
	f.BackgroundColor3 = Color3.fromRGB(20, 16, 32)
	f.BackgroundTransparency = 0.25
	f.Visible = false
	f.ZIndex = 90
	f.Parent = gui
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 10)
	corner.Parent = f
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Position = UDim2.fromOffset(12, 8)
	l.Size = UDim2.new(1, -24, 1, -16)
	l.Font = Enum.Font.Code
	l.TextSize = 14
	l.TextXAlignment = Enum.TextXAlignment.Left
	l.TextYAlignment = Enum.TextYAlignment.Top
	l.TextColor3 = Color3.fromRGB(200, 255, 210)
	l.ZIndex = 91
	l.Parent = f
	frame, label = f, l
	if buttonParent then
		local b = Instance.new("TextButton")
		b.Name = "StatsButton"
		b.Size = UDim2.fromOffset(40, 40)
		b.Position = UDim2.new(0, 12, 1, -52)
		b.BackgroundColor3 = Color3.fromRGB(20, 16, 32)
		b.BackgroundTransparency = 0.3
		b.Text = "📊"
		b.TextScaled = true
		b.ZIndex = 90
		b.Parent = buttonParent
		local c2 = Instance.new("UICorner")
		c2.CornerRadius = UDim.new(0, 10)
		c2.Parent = b
		b.Activated:Connect(function()
			Stats.toggle()
		end)
	end
	UserInputService.InputBegan:Connect(function(input, processed)
		if not processed and input.KeyCode == Enum.KeyCode.F3 then
			Stats.toggle()
		end
	end)
	local acc, frames, last = 0, 0, 0
	local tick = if RunService:IsClient() then RunService.RenderStepped else RunService.Heartbeat
	tick:Connect(function(dt)
		acc += dt
		frames += 1
		if acc >= 0.5 then
			local fps = frames / acc
			if Stats.visible then
				if os.clock() - last > 3 then
					last = os.clock()
					local n = 0
					for _, d in ipairs(Workspace:GetDescendants()) do
						if d:IsA("BasePart") then
							n += 1
						end
					end
					parts = n
				end
				render(math.floor(fps + 0.5), acc / frames * 1000)
			end
			acc, frames = 0, 0
		end
	end)
end

function Stats.toggle()
	Stats.visible = not Stats.visible
	if frame then
		frame.Visible = Stats.visible
	end
	if Stats.visible then
		render(0, 0)
	end
end

return Stats
