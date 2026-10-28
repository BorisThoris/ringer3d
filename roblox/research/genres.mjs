// How are similar games classified? Search, then read each hit's genre from the public games API.
const ids = new Map();
for (const q of ['8 ball duels', 'marble mania', 'huge marble slide', 'ball vs ball', 'marble race creator', 'pool', 'curling', 'bowling']) {
  const r = await fetch(`https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&sessionId=${crypto.randomUUID()}&pageType=all`);
  const j = await r.json().catch(() => null);
  for (const g of (j?.searchResults || []).flatMap((s) => s.contents || []).filter((c) => c.contentType === 'Game').slice(0, 3)) ids.set(g.universeId, g.name);
}
const r = await fetch(`https://games.roblox.com/v1/games?universeIds=${[...ids.keys()].join(',')}`);
const j = await r.json();
for (const g of j.data) console.log(String(g.playing).padStart(6), (g.genre_l1 || g.genre || '').padEnd(18), (g.genre_l2 || '').padEnd(22), g.name);
