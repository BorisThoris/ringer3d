// Pack roblox/src into a place file, Rojo-style, without Studio.
//   node roblox/scripts/build.mjs [out.rbxlx]
// Top-level folders under src are services (ReplicatedStorage, ServerScriptService, StarterPlayer...).
// Inside them: a folder becomes a Folder, `x.server.luau` a Script, `x.client.luau` a LocalScript,
// any other `x.luau` a ModuleScript. A folder holding `init.luau` becomes that ModuleScript, with
// the folder's other files as its children.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const out = process.argv[2] ?? join(root, 'build', 'ringer.rbxlx');

let ref = 0;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// A script's source goes in CDATA; a literal "]]>" inside it has to be split across two sections.
const cdata = (s) => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

function item(cls, name, props = '', children = '') {
  return `<Item class="${cls}" referent="RBX${String(++ref).padStart(6, '0')}"><Properties><string name="Name">${esc(name)}</string>${props}</Properties>${children}</Item>`;
}

function scriptItem(file) {
  const name = basename(file);
  const source = cdata(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  if (name.endsWith('.server.luau')) return item('Script', name.slice(0, -12), `<ProtectedString name="Source">${source}</ProtectedString>`);
  if (name.endsWith('.client.luau')) return item('LocalScript', name.slice(0, -12), `<ProtectedString name="Source">${source}</ProtectedString>`);
  return item('ModuleScript', name.slice(0, -5), `<ProtectedString name="Source">${source}</ProtectedString>`);
}

function children(dir) {
  return readdirSync(dir)
    .sort()
    .filter((n) => n !== 'init.luau')
    .map((n) => {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) return node(p);
      return n.endsWith('.luau') ? scriptItem(p) : '';
    })
    .join('');
}

function node(dir) {
  const init = join(dir, 'init.luau');
  try {
    statSync(init);
    return item('ModuleScript', basename(dir), `<ProtectedString name="Source">${cdata(readFileSync(init, 'utf8'))}</ProtectedString>`, children(dir));
  } catch {
    return item('Folder', basename(dir), '', children(dir));
  }
}

let services = readdirSync(src)
  .filter((n) => statSync(join(src, n)).isDirectory())
  .map((n) => item(n, n, '', children(join(src, n))))
  .join('');

// Test builds (CHECK=1) also carry every Script and LocalScript as a ModuleScript under
// ServerStorage.SyntaxCheck, so a cloud test can compile them all (a cloud server never runs
// LocalScripts) and report syntax errors with line numbers.
if (process.env.CHECK) {
  const copies = [];
  const walk = (dir, prefix) => {
    for (const n of readdirSync(dir).sort()) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, `${prefix}${n}.`);
      else if (/\.(server|client)\.luau$/.test(n)) {
        const name = prefix + n.replace(/\.luau$/, '');
        // Wrapped in a function that is never called: it compiles, nothing in it runs.
        const body = `return function(...)\n${readFileSync(p, 'utf8')}\nend`;
        copies.push(item('ModuleScript', name, `<ProtectedString name="Source">${cdata(body)}</ProtectedString>`));
      }
    }
  };
  walk(src, '');
  services += item('ServerStorage', 'ServerStorage', '', item('Folder', 'SyntaxCheck', '', copies.join('')));
}
// No XML declaration: the publish endpoint rejects files that start with one.
const xml = `<roblox version="4"><Meta name="ExplicitAutoJoints">true</Meta><External>null</External><External>nil</External>${services}</roblox>`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, xml);
console.log(`built ${out} (${ref} instances, ${(xml.length / 1024).toFixed(0)} KB)`);
