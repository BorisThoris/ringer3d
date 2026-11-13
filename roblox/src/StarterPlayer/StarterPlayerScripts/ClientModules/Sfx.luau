-- Sound, the web game's (src/render/audio.ts): Kenney's CC0 glass impacts for marble on marble,
-- the field's own contact recordings for the bank and the flick, a rolling rumble coloured by the
-- surface and driven by how fast the marbles move, chimes for the turn, a capture, a win and a
-- loss, and an ambient pad per field. Plus the shop's own: coins, a purchase, the shimmer of an
-- equipped marble and the Marble Bag's reveal stings, growing with rarity.
--
-- Everything is one audio asset, a sprite built by roblox/audio/build_sprite.py; each sound is a
-- PlaybackRegion of it (Ringer.SfxIndex says where). With no asset id yet every call is silent.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local SoundService = game:GetService("SoundService")
local TweenService = game:GetService("TweenService")

local Ids = require(ReplicatedStorage.Ringer.Ids)
local Index = require(ReplicatedStorage.Ringer.SfxIndex)

local Sfx = {}

local ASSET = (Ids.audio and Ids.audio.sfx) or 0
Sfx.enabled = ASSET ~= 0
Sfx.sfxVolume = 0.8
Sfx.musicVolume = 0.45
Sfx.log = nil :: { string }? -- tests set a table to see what was played

-- The web game's surface sounds (audio.ts SURFACE_SOUNDS).
local SURFACE = {
	wood = { kerb = "impactWood_medium", tap = "impactWood_light", kerbVol = 0.9, tapVol = 0.5, roll = 1.1 },
	concrete = { kerb = "impactPlate_medium", tap = "footstep_concrete", kerbVol = 0.8, tapVol = 0.35, roll = 0.9 },
	grass = { kerb = "impactSoft_heavy", tap = "footstep_grass", kerbVol = 0.9, tapVol = 0.4, roll = 0.45 },
	sand = { kerb = "impactSoft_heavy", tap = "impactSoft_medium", kerbVol = 0.8, tapVol = 0.35, roll = 0.55 },
	ice = { kerb = "impactPlate_light", tap = "footstep_snow", kerbVol = 0.8, tapVol = 0.3, roll = 0.75 },
	gravel = { kerb = "impactMining", tap = "footstep_concrete", kerbVol = 0.8, tapVol = 0.45, roll = 1.1 },
	turf = { kerb = "impactWood_medium", tap = "footstep_carpet", kerbVol = 0.9, tapVol = 0.45, roll = 0.7 },
}
Sfx.SURFACE = SURFACE

local group = Instance.new("SoundGroup")
group.Name = "RingerSfx"
group.Volume = Sfx.sfxVolume
group.Parent = SoundService
local musicGroup = Instance.new("SoundGroup")
musicGroup.Name = "RingerMusic"
musicGroup.Volume = Sfx.musicVolume
musicGroup.Parent = SoundService

local surface = "concrete"
local lastClack = 0
local roll: Sound? = nil
local pad: Sound? = nil
local rng = Random.new()

local function note(what: string)
	if Sfx.log then
		table.insert(Sfx.log, what)
	end
end

local function make(name: string, loop: boolean?, music: boolean?): Sound?
	local r = Index[name]
	if not r then
		return nil
	end
	local s = Instance.new("Sound")
	s.Name = name
	s.SoundId = "rbxassetid://" .. ASSET
	s.PlaybackRegionsEnabled = true
	s.PlaybackRegion = NumberRange.new(r[1], r[2])
	if loop then
		s.Looped = true
		s.LoopRegion = NumberRange.new(r[1], r[2])
	end
	s.SoundGroup = if music then musicGroup else group
	s.Parent = SoundService
	return s
end

--- Play a one-shot sound (a random take of a recording when it has several) at `vol`.
function Sfx.play(name: string, vol: number?, rate: number?): boolean
	local takes = {}
	if Index[name] then
		table.insert(takes, name)
	else
		for i = 0, 4 do
			if Index[name .. "_" .. i] then
				table.insert(takes, name .. "_" .. i)
			end
		end
	end
	if #takes == 0 then
		return false
	end
	local pick = takes[rng:NextInteger(1, #takes)]
	note(pick)
	if not Sfx.enabled then
		return true
	end
	local s = make(pick)
	if not s then
		return false
	end
	s.Volume = math.clamp(vol or 1, 0, 2)
	s.PlaybackSpeed = (rate or 1) * (0.94 + rng:NextNumber() * 0.12)
	s:Play()
	local r = Index[pick]
	task.delay((r[2] - r[1]) / s.PlaybackSpeed + 0.2, function()
		s:Destroy()
	end)
	return true
end

--- The ground changes: its contact recordings and the colour of the rolling sound.
function Sfx.setSurface(kind: string)
	if not SURFACE[kind] then
		return
	end
	surface = kind
	if roll then
		roll:Destroy()
		roll = nil
	end
	if Sfx.enabled then
		roll = make("roll_" .. kind, true)
		if roll then
			roll.Volume = 0
			roll:Play()
		end
	end
end

--- The thumb flick: the shooter scuffs the surface as it leaves.
function Sfx.launch(power: number)
	local s = SURFACE[surface]
	Sfx.play(s.tap, s.tapVol * (0.4 + power * 0.6))
end

--- A contact: glass on glass, the field's bank, or a mini-golf bumper. strength ~ contact force.
function Sfx.clack(strength: number, kind: string?)
	local now = os.clock()
	if now - lastClack < 0.012 then
		return
	end
	lastClack = now
	local vol = math.min(1, math.log10(1 + strength) / 3.2)
	if vol < 0.04 then
		return
	end
	if kind == "bumper" then
		Sfx.play("impactPunch_medium", 0.35 + vol * 0.65, 1.1)
	elseif kind and kind ~= "marble" then
		local s = SURFACE[surface]
		Sfx.play(s.kerb, vol * s.kerbVol)
	else
		local take = if vol > 0.75 then "impactGlass_heavy" elseif vol > 0.4 then "impactGlass_medium" else "impactGlass_light"
		Sfx.play(take, 0.25 + vol * 0.75, 1.15)
	end
end

--- The rolling rumble, driven every frame by the marbles' total speed (web units/s).
function Sfx.setRolling(speed: number)
	if roll then
		local v = math.min(0.35, speed * 0.02) * SURFACE[surface].roll
		roll.Volume += (v * 2.2 - roll.Volume) * 0.25
	end
end

--- capture, turn, win, lose, tap.
function Sfx.chime(kind: string)
	Sfx.play("chime_" .. kind, 1)
end

-- ---- Music: upbeat tracks (ACE-Step, roblox/audio) for the lobby and the match ----------------
local track: Sound? = nil
local trackName: string? = nil
--- Play the lobby or match music, crossfading from whatever played. False if it has no asset.
function Sfx.music(name: string): boolean
	local id = Ids.audio and Ids.audio[name]
	if not id or id == 0 then
		return false
	end
	note("music_" .. name)
	if trackName == name and track then
		return true
	end
	if track then
		local old = track
		TweenService:Create(old, TweenInfo.new(1.2), { Volume = 0 }):Play()
		task.delay(1.3, function()
			old:Destroy()
		end)
	end
	local m = Instance.new("Sound")
	m.Name = "Music_" .. name
	m.SoundId = "rbxassetid://" .. id
	m.Looped = true
	m.Volume = 0
	m.SoundGroup = musicGroup
	m.Parent = SoundService
	m:Play()
	TweenService:Create(m, TweenInfo.new(1.5), { Volume = 1 }):Play()
	track, trackName = m, name
	return true
end

--- The field's ambient pad: bright, calm, night, cold, ominous.
function Sfx.startPad(mood: string)
	Sfx.stopPad()
	-- Upbeat match music when it is there; the pad is the fallback.
	if Sfx.music("match") then
		return
	end
	note("pad_" .. mood)
	if not Sfx.enabled then
		return
	end
	local s = make("pad_" .. mood, true, true)
	if s then
		s.Volume = 0
		s:Play()
		TweenService:Create(s, TweenInfo.new(3), { Volume = 1 }):Play()
		pad = s
	end
end

function Sfx.stopPad()
	if pad then
		local s = pad
		pad = nil
		TweenService:Create(s, TweenInfo.new(1), { Volume = 0 }):Play()
		task.delay(1.1, function()
			s:Destroy()
		end)
	end
	if roll then
		roll.Volume = 0
	end
end

--- The shop and the bag: coin, buy, equip, whoosh, tick, reveal_common/rare/epic/legendary.
function Sfx.ui(name: string, vol: number?)
	Sfx.play(name, vol or 0.9)
end

--- A rarity's reveal sting (Mythic and up get the legendary one).
function Sfx.reveal(tier: string?)
	local t = string.lower(tier or "common")
	local name = if t == "rare" then "reveal_rare" elseif t == "epic" then "reveal_epic" elseif t == "common" or t == "uncommon" then "reveal_common" else "reveal_legendary"
	Sfx.play(name, 1)
end

function Sfx.setVolumes(sfx: number, music: number)
	Sfx.sfxVolume, Sfx.musicVolume = sfx, music
	group.Volume = sfx
	musicGroup.Volume = music
end

return Sfx
