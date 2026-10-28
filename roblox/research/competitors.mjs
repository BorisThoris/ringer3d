// Roblox search results for marble-game queries, logged out: titles and how they're doing.
const rows = [];
for (const q of ['marble', 'marbles', 'marble game', 'marble duel', 'marble simulator', 'marble pvp', 'flick']) {
  const r = await fetch(`https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&sessionId=${crypto.randomUUID()}&pageType=all`, { headers: { 'user-agent': 'Mozilla/5.0' } });
  const j = await r.json().catch(() => null);
  const games = (j?.searchResults || []).flatMap((s) => s.contents || []).filter((c) => c.contentType === 'Game').slice(0, 10);
  console.log(`\n== ${q} (${r.status}, ${games.length})`);
  for (const g of games) console.log(String(g.playerCount).padStart(7), String(g.totalUpVotes).padStart(8), ' ', g.name);
}
