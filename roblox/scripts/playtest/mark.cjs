// Copy the place with a ReplicatedStorage.PlayRig marker so the playtest plugin runs only there.
const fs = require('fs');
let s = fs.readFileSync(process.argv[2], 'utf8');
const re = /(<Item class="ReplicatedStorage" referent="[^"]+"><Properties><string name="Name">ReplicatedStorage<\/string><\/Properties>)/;
if (!re.test(s)) throw new Error('ReplicatedStorage not found');
s = s.replace(re, '$1<Item class="Folder" referent="RBXPLAYRIG"><Properties><string name="Name">PlayRig</string></Properties></Item>');
fs.writeFileSync(process.argv[3], s);
console.log('marked');
