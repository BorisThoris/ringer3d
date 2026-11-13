-- Each field's light and air, as the web game sets them (src/game/arenas.ts sun, fog, ambient;
-- arenaBuilder.ts air): the lamplight over the desk, a bright street or lawn at midday, the
-- overcast lake with snow falling, dust motes drifting in the lamp's beam. Set on this client
-- only, while it watches a table; the lobby's light comes back when it leaves. Also turns the
-- mini-golf windmill's sails.

local Lighting = game:GetService("Lighting")
local RunService = game:GetService("RunService")
local TweenService = game:GetService("TweenService")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Ringer.Config)

local Ambience = {}
Ambience.current = nil :: string?

local saved = nil
local air: BasePart? = nil
local spin: RBXScriptConnection? = nil

local function lerp(a: Color3, b: Color3, t: number): Color3
	return a:Lerp(b, t)
end

local function save()
	local atm = Lighting:FindFirstChildOfClass("Atmosphere")
	local cc = Lighting:FindFirstChildOfClass("ColorCorrectionEffect")
	saved = {
		ClockTime = Lighting.ClockTime,
		Brightness = Lighting.Brightness,
		Ambient = Lighting.Ambient,
		OutdoorAmbient = Lighting.OutdoorAmbient,
		atm = atm and { Density = atm.Density, Color = atm.Color, Decay = atm.Decay, Haze = atm.Haze, Offset = atm.Offset },
		cc = cc and { TintColor = cc.TintColor, Saturation = cc.Saturation, Contrast = cc.Contrast, Brightness = cc.Brightness },
	}
end

local function tween(obj: Instance, props: { [string]: any })
	TweenService:Create(obj, TweenInfo.new(1.2, Enum.EasingStyle.Sine), props):Play()
end

local function makeAir(kind: string, origin: Vector3)
	local p = Instance.new("Part")
	p.Name = "Air"
	p.Anchored, p.CanCollide, p.CanQuery, p.CanTouch = true, false, false, false
	p.Transparency = 1
	local e = Instance.new("ParticleEmitter")
	if kind == "snow" then
		-- Snow over the lake: flakes drifting down and sideways.
		p.Size = Vector3.new(130, 1, 130)
		p.CFrame = CFrame.new(origin + Vector3.new(0, 48, 0))
		e.Texture = "rbxasset://textures/particles/sparkles_main.dds"
		e.Color = ColorSequence.new(Color3.new(1, 1, 1))
		e.Size = NumberSequence.new(0.35)
		e.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.1, 0.1), NumberSequenceKeypoint.new(0.9, 0.1), NumberSequenceKeypoint.new(1, 1) })
		e.Lifetime = NumberRange.new(12, 16)
		e.Rate = 70
		e.Speed = NumberRange.new(3.2, 4.2)
		e.EmissionDirection = Enum.NormalId.Bottom
		e.SpreadAngle = Vector2.new(18, 18)
		e.Acceleration = Vector3.new(0.6, 0, 0.3)
		e.RotSpeed = NumberRange.new(-60, 60)
		e.LightEmission = 0.2
	else
		-- Dust in the lamplight: slow warm motes hanging in the air.
		p.Size = Vector3.new(110, 22, 110)
		p.CFrame = CFrame.new(origin + Vector3.new(0, 12, 0))
		e.Shape = Enum.ParticleEmitterShape.Box
		e.ShapeInOut = Enum.ParticleEmitterShapeInOut.Outward
		e.Texture = "rbxasset://textures/particles/sparkles_main.dds"
		e.Color = ColorSequence.new(Color3.fromHex("#fff1d6"))
		e.Size = NumberSequence.new(0.18)
		e.Transparency = NumberSequence.new({ NumberSequenceKeypoint.new(0, 1), NumberSequenceKeypoint.new(0.3, 0.45), NumberSequenceKeypoint.new(0.7, 0.45), NumberSequenceKeypoint.new(1, 1) })
		e.Lifetime = NumberRange.new(8, 12)
		e.Rate = 40
		e.Speed = NumberRange.new(0.1, 0.4)
		e.SpreadAngle = Vector2.new(180, 180)
		e.LightEmission = 1
	end
	e.Parent = p
	p.Parent = Workspace
	return p
end

--- Light this client's world for the field `arenaId` around the table at `origin`.
function Ambience.enter(arenaId: string, origin: Vector3, tableId: number?)
	local arena = Config.ARENAS[arenaId]
	if not arena then
		return
	end
	if Ambience.current == arenaId .. tostring(origin) then
		return
	end
	if not saved then
		save()
	end
	Ambience.current = arenaId .. tostring(origin)
	local indoor = arenaId == "desk"
	tween(Lighting, {
		ClockTime = arena.sun.clock,
		Brightness = arena.sun.brightness * 1.15,
		Ambient = lerp(arena.ambient, Color3.new(0.45, 0.45, 0.5), 0.5),
		OutdoorAmbient = lerp(arena.sky.bottom, arena.ambient, 0.35),
	})
	local atm = Lighting:FindFirstChildOfClass("Atmosphere")
	if atm then
		-- The web game's fog: indoors the far desk melts into warm haze; outside, the sky's blue.
		tween(atm, { Density = if indoor then 0.36 else 0.24, Color = arena.fog, Decay = if indoor then arena.sky.bottom else arena.sky.top, Haze = if indoor then 1.6 else 0.6, Offset = 0.05 })
	end
	local cc = Lighting:FindFirstChildOfClass("ColorCorrectionEffect")
	if cc then
		-- Bright and punchy, toy-box colours: kids first.
		tween(cc, { TintColor = lerp(Color3.new(1, 1, 1), arena.sun.color, 0.35), Saturation = if arenaId == "ice" then 0.25 else 0.4, Contrast = 0.12, Brightness = 0.03 })
	end
	if air then
		air:Destroy()
		air = nil
	end
	if arena.air then
		air = makeAir(arena.air, origin)
	end
	if spin then
		spin:Disconnect()
		spin = nil
	end
	local model = tableId and Workspace:FindFirstChild("Table" .. tableId)
	local sails = model and model:FindFirstChild("Sails", true)
	if sails and sails:IsA("Model") then
		local base = sails:GetPivot()
		local a = 0
		spin = RunService.RenderStepped:Connect(function(dt)
			a += dt * 0.9
			sails:PivotTo(base * CFrame.Angles(0, 0, -a))
		end)
	end
end

--- Back to the lobby's light.
function Ambience.leave()
	if not Ambience.current then
		return
	end
	Ambience.current = nil
	if air then
		air:Destroy()
		air = nil
	end
	if spin then
		spin:Disconnect()
		spin = nil
	end
	if saved then
		tween(Lighting, { ClockTime = saved.ClockTime, Brightness = saved.Brightness, Ambient = saved.Ambient, OutdoorAmbient = saved.OutdoorAmbient })
		local atm = Lighting:FindFirstChildOfClass("Atmosphere")
		if atm and saved.atm then
			tween(atm, saved.atm)
		end
		local cc = Lighting:FindFirstChildOfClass("ColorCorrectionEffect")
		if cc and saved.cc then
			tween(cc, saved.cc)
		end
	end
end

return Ambience
