// Renders assets/icon.svg into assets/icon.png (256px) and assets/icon.ico (16–256px, PNG-compressed
// entries), and copies the SVG to ui/icon.svg for the page favicon. Run: npm run icon
const fs = require('node:fs');
const path = require('node:path');
const { Resvg } = require('@resvg/resvg-js');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/icon.svg'), 'utf8');
const render = size => new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();

fs.writeFileSync(path.join(root, 'assets/icon.png'), render(256));

// ICO container: 6-byte header, one 16-byte directory entry per image, then the PNG data.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(render);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((size, index) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(images[index].length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += images[index].length;
  return entry;
});
fs.writeFileSync(path.join(root, 'assets/icon.ico'), Buffer.concat([header, ...entries, ...images]));
fs.copyFileSync(path.join(root, 'assets/icon.svg'), path.join(root, 'ui/icon.svg'));
console.log(`icon.png, icon.ico (${sizes.join('/')}px), ui/icon.svg updated`);
