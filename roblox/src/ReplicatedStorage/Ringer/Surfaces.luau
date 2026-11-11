--!strict
-- The ground of each field as the web game's physics has it (src/game/arenas.ts `surface`), in
-- web units. Ringer.Sim plays every shot on these; Config.ARENAS only says how a field looks.

export type Surface = {
	linearDamping: number,
	angularDamping: number,
	friction: number,
	marbleRestitution: number,
	rollDecel: number,
	bumps: { amp: number, scale: number, stretch: number },
	camber: { x: number, z: number },
	hop: number,
	edge: { restitution: number, friction: number },
}

local DEFAULT: Surface = {
	linearDamping = 0.08,
	angularDamping = 0.3,
	friction = 0.6,
	marbleRestitution = 0.93,
	rollDecel = 11,
	bumps = { amp = 0, scale = 1, stretch = 1 },
	camber = { x = 0, z = 0 },
	hop = 0,
	edge = { restitution = 0.5, friction = 0.2 },
}

local function with(t: { [string]: any }): Surface
	local s = table.clone(DEFAULT) :: any
	for k, v in pairs(t) do
		s[k] = v
	end
	return s
end

local Surfaces: { [string]: Surface } = {
	desk = with({
		rollDecel = 7,
		friction = 0.5,
		linearDamping = 0.05,
		marbleRestitution = 0.92,
		bumps = { amp = 0.012, scale = 9, stretch = 1 },
		camber = { x = 0.004, z = 0 },
		edge = { restitution = 0.35, friction = 0.4 },
	}),
	culdesac = with({
		rollDecel = 9,
		linearDamping = 0.12,
		marbleRestitution = 0.86,
		bumps = { amp = 0.045, scale = 6, stretch = 1 },
		camber = { x = 0, z = 0.04 },
		edge = { restitution = 0.62, friction = 0.3 },
	}),
	grass = with({
		rollDecel = 14,
		friction = 0.85,
		linearDamping = 0.3,
		angularDamping = 0.6,
		marbleRestitution = 0.78,
		bumps = { amp = 0.2, scale = 3.5, stretch = 1 },
		hop = 4,
		edge = { restitution = 0.05, friction = 1 },
	}),
	sand = with({
		rollDecel = 13,
		friction = 0.7,
		linearDamping = 0.25,
		angularDamping = 0.7,
		marbleRestitution = 0.72,
		bumps = { amp = 0.1, scale = 2.2, stretch = 3 },
		hop = 0,
		edge = { restitution = 0.05, friction = 1 },
	}),
	ice = with({
		rollDecel = 5.6,
		friction = 0.12,
		linearDamping = 0.08,
		angularDamping = 0.1,
		marbleRestitution = 0.88,
		bumps = { amp = 0.03, scale = 12, stretch = 1 },
		edge = { restitution = 0.05, friction = 1 },
	}),
	gravel = with({
		rollDecel = 12,
		friction = 0.8,
		linearDamping = 0.2,
		angularDamping = 0.5,
		marbleRestitution = 0.8,
		bumps = { amp = 0.05, scale = 1.4, stretch = 1 },
		edge = { restitution = 0.12, friction = 0.9 },
	}),
	minigolf = with({
		rollDecel = 8,
		friction = 0.6,
		linearDamping = 0.1,
		angularDamping = 0.4,
		marbleRestitution = 0.9,
		edge = { restitution = 0.6, friction = 0.25 },
	}),
}

return Surfaces
