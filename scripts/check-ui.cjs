const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate HTML id');
for (const file of ['app.js', 'library.js', 'player-extras.js', 'actors.js', 'enhance.js', 'reader.js', 'update.js', 'notes.js', 'feed.js']) {
  const code = fs.readFileSync(path.join(root, 'ui', file), 'utf8');
  for (const match of code.matchAll(/\$\('#([^']+)'\)/g)) {
    if (!ids.includes(match[1])) throw new Error(`${file}: missing #${match[1]}`);
  }
}
console.log(`UI references checked: ${ids.length} unique ids`);
