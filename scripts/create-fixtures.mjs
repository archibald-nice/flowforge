import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const width = 320, height = 200;
const directory = new URL('../public/fixtures/', import.meta.url);
mkdirSync(directory, { recursive: true });
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const tag = Buffer.from(type);
  const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tag, bytes])));
  return Buffer.concat([size, tag, bytes, crc]);
}
const manifest = [];
for (let index = 1; index <= 30; index++) {
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    const bottle = (x > 139 && x < 180 && y > 71 && y < 173) || (x > 149 && x < 169 && y > 50 && y <= 71);
    const shadow = ((x - 164) / 54) ** 2 + ((y - 176) / 9) ** 2 < 1;
    const grain = (x * 17 + y * 13 + index * 11) % 5;
    const color = bottle ? [55 + index * 2, 96 + index, 113 + index] : shadow ? [184, 187, 166] : [232 - y / 20 + grain, 233 - y / 25 + grain, 216 - y / 18 + grain];
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.round(color[channel]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
  const file = `study-${String(index).padStart(2,'0')}.png`;
  writeFileSync(new URL(file,directory),png);
  manifest.push({ file, width, height, bytes: png.length, sha256: createHash('sha256').update(png).digest('hex'), origin: 'Original procedural geometric fixture; no external inputs', license: 'CC0-1.0' });
}
writeFileSync(new URL('manifest.json',directory),JSON.stringify(manifest,null,2)+'\n');
const assetDirectory = new URL('../src/assets/', import.meta.url);
mkdirSync(assetDirectory, { recursive: true });
writeFileSync(new URL('fixture-manifest.json', assetDirectory), JSON.stringify(manifest, null, 2) + '\n');
console.log('Created 30 original PNG fixtures and checksum manifest.');
