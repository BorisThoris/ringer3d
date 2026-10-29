// Steam Inventory (ISteamInventory) for the shell. steamworks.js has no inventory bindings, so
// this calls Steam's flat C API in the same steam_api64.dll through koffi (FFI). Steam must be
// initialised first (steamworks.init in main.cjs): both then share the one loaded DLL.
//
// Every operation here is generic (list, drop, exchange, consume, buy, set a property); what
// the item definitions mean (which itemdef is which marble tier, bags, trade-ups) is the game's
// business (src/steamItems.ts). Results come back as plain JSON: item ids as decimal strings.
const fs = require('node:fs');
const path = require('node:path');

const OK = 1;
const PENDING = 22;

function findDll() {
  const candidates = [
    path.join(path.dirname(require.resolve('steamworks.js')), 'dist', 'win64', 'steam_api64.dll'),
    path.join(path.dirname(process.execPath), 'steam_api64.dll'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function createInventory() {
  const koffi = require('koffi');
  const dll = findDll();
  if (!dll) throw new Error('steam_api64.dll not found');
  const lib = koffi.load(dll);
  const f = (sig) => lib.func(sig);
  const Self = f('void* SteamAPI_SteamInventory_v003()');
  const GetResultStatus = f('int SteamAPI_ISteamInventory_GetResultStatus(void* self, int32 h)');
  const GetResultItems = f('bool SteamAPI_ISteamInventory_GetResultItems(void* self, int32 h, void* out, _Inout_ uint32* n)');
  const GetResultItemProperty = f('bool SteamAPI_ISteamInventory_GetResultItemProperty(void* self, int32 h, uint32 i, const char* name, void* buf, _Inout_ uint32* n)');
  const DestroyResult = f('void SteamAPI_ISteamInventory_DestroyResult(void* self, int32 h)');
  const GetAllItems = f('bool SteamAPI_ISteamInventory_GetAllItems(void* self, _Out_ int32* h)');
  const TriggerItemDrop = f('bool SteamAPI_ISteamInventory_TriggerItemDrop(void* self, _Out_ int32* h, int32 def)');
  const ExchangeItems = f(
    'bool SteamAPI_ISteamInventory_ExchangeItems(void* self, _Out_ int32* h, const int32* gen, const uint32* genQty, uint32 genN, const uint64* destroy, const uint32* destroyQty, uint32 destroyN)',
  );
  const ConsumeItem = f('bool SteamAPI_ISteamInventory_ConsumeItem(void* self, _Out_ int32* h, uint64 item, uint32 qty)');
  const StartPurchase = f('uint64 SteamAPI_ISteamInventory_StartPurchase(void* self, const int32* defs, const uint32* qty, uint32 n)');
  const LoadItemDefinitions = f('bool SteamAPI_ISteamInventory_LoadItemDefinitions(void* self)');
  const GetItemDefinitionIDs = f('bool SteamAPI_ISteamInventory_GetItemDefinitionIDs(void* self, void* out, _Inout_ uint32* n)');
  const GetItemDefinitionProperty = f('bool SteamAPI_ISteamInventory_GetItemDefinitionProperty(void* self, int32 def, const char* name, void* buf, _Inout_ uint32* n)');
  const StartUpdateProperties = f('uint64 SteamAPI_ISteamInventory_StartUpdateProperties(void* self)');
  const SetPropertyInt64 = f('bool SteamAPI_ISteamInventory_SetPropertyInt64(void* self, uint64 update, uint64 item, const char* name, int64 v)');
  const SubmitUpdateProperties = f('bool SteamAPI_ISteamInventory_SubmitUpdateProperties(void* self, uint64 update, _Out_ int32* h)');

  const self = Self();
  if (!self) throw new Error('ISteamInventory unavailable (is Steam initialised?)');

  const str = (read) => {
    const n = [0];
    if (!read(null, n) || !n[0]) return '';
    const buf = Buffer.alloc(n[0]);
    return read(buf, n) ? buf.toString('utf8').replace(/\0.*$/s, '') : '';
  };

  /** Wait for a result handle, read its items (with their dynamic properties), free it. */
  async function settle(h, what) {
    const t0 = Date.now();
    let status;
    while ((status = GetResultStatus(self, h)) === PENDING) {
      if (Date.now() - t0 > 20000) {
        DestroyResult(self, h);
        throw new Error(`${what}: Steam did not answer`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    try {
      if (status !== OK) throw new Error(`${what}: Steam said EResult ${status}`);
      const n = [0];
      GetResultItems(self, h, null, n);
      const buf = Buffer.alloc(Math.max(1, n[0]) * 16);
      if (n[0] && !GetResultItems(self, h, buf, n)) throw new Error(`${what}: could not read items`);
      const items = [];
      for (let i = 0; i < n[0]; i++) {
        const o = i * 16;
        const props = str((b, len) => GetResultItemProperty(self, h, i, 'dynamic_props', b, len));
        items.push({
          itemId: buf.readBigUInt64LE(o).toString(),
          def: buf.readInt32LE(o + 8),
          qty: buf.readUInt16LE(o + 12),
          // 0x100 = removed (consumed / traded away), 0x200 = consumed
          removed: (buf.readUInt16LE(o + 14) & 0x300) !== 0,
          props: props ? safeJson(props) : {},
        });
      }
      return items;
    } finally {
      DestroyResult(self, h);
    }
  }

  const handle = () => [0];
  const run = async (what, start) => {
    const h = handle();
    if (!start(h)) throw new Error(`${what}: Steam refused the request`);
    return settle(h[0], what);
  };

  return {
    /** Every item the player holds in this app's inventory. */
    all: () => run('inventory', (h) => GetAllItems(self, h)),
    /** A playtime drop from a playtimegenerator itemdef: Steam decides whether one is due. */
    drop: (listDef) => run('drop', (h) => TriggerItemDrop(self, h, listDef)),
    /** Generate `gen` itemdefs while destroying `destroy` items; Steam checks the itemdef's recipe. */
    exchange: (gen, destroy) =>
      run('exchange', (h) =>
        ExchangeItems(
          self,
          h,
          Int32Array.from(gen),
          Uint32Array.from(gen.map(() => 1)),
          gen.length,
          BigUint64Array.from(destroy.map((d) => BigInt(d))),
          Uint32Array.from(destroy.map(() => 1)),
          destroy.length,
        ),
      ),
    consume: (itemId, qty = 1) => run('consume', (h) => ConsumeItem(self, h, BigInt(itemId), qty)),
    /** Open Steam's checkout overlay for these itemdefs (items with a price on the partner site). */
    buy: (defs) => StartPurchase(self, Int32Array.from(defs), Uint32Array.from(defs.map(() => 1)), defs.length).toString(),
    /** Item definitions with a few display properties. */
    defs: (props = ['name', 'type']) => {
      LoadItemDefinitions(self);
      const n = [0];
      GetItemDefinitionIDs(self, null, n);
      if (!n[0]) return [];
      const ids = Buffer.alloc(n[0] * 4);
      GetItemDefinitionIDs(self, ids, n);
      return Array.from({ length: n[0] }, (_, i) => {
        const def = ids.readInt32LE(i * 4);
        return { def, ...Object.fromEntries(props.map((p) => [p, str((b, len) => GetItemDefinitionProperty(self, def, p, b, len))])) };
      });
    },
    /** Set an integer dynamic property on items (e.g. a marble's capture tally). */
    setProps: (sets) =>
      run('properties', (h) => {
        const u = StartUpdateProperties(self);
        for (const s of sets) SetPropertyInt64(self, u, BigInt(s.itemId), s.name, BigInt(Math.trunc(s.value)));
        return SubmitUpdateProperties(self, u, h);
      }),
  };
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

module.exports = { createInventory };
