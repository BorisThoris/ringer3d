// Copy the place with a ReplicatedStorage.ShotRig marker so the probe plugin runs only there.
const fs = require('fs');
let s = fs.readFileSync(process.argv[2], 'utf8');
const tag = '<Item class="ReplicatedStorage" referent="RBX000007"><Properties><string name="Name">ReplicatedStorage</string></Properties>';
if (!s.includes(tag)) throw new Error('ReplicatedStorage tag not found');
s = s.replace(tag, tag + '<Item class="Folder" referent="RBXSHOT"><Properties><string name="Name">ShotRig</string></Properties></Item>');
fs.writeFileSync(process.argv[3], s);
console.log('ok');
