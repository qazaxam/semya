// Генерирует PNG-иконки из public/icons/icon.svg. Запуск: npm run icons
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const dir = 'public/icons/';
const svg = readFileSync(dir + 'icon.svg');

for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) {
  await sharp(svg, { density: 300 }).resize(size, size).png().toFile(`${dir}${name}.png`);
}
// maskable: иконка с полями (безопасная зона 80%) на цветном фоне
const inner = await sharp(svg, { density: 300 }).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#4a76a8' } })
  .composite([{ input: inner, gravity: 'center' }]).png().toFile(dir + 'icon-maskable-512.png');
console.log('Иконки готовы');
