// Генерирует PNG-иконки из public/icons/icon.svg. Запуск: npm run icons
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const dir = 'public/icons/';
const rounded = readFileSync(dir + 'icon.svg', 'utf8');
// квадрат без прозрачных углов: iPhone сам скругляет иконки и обложки плеера
const square = Buffer.from(rounded.replace(/rx="\d+"/, 'rx="0"'));
const png = (svg, size, name) => sharp(svg, { density: 300 }).resize(size, size).png().toFile(dir + name + '.png');

await png(Buffer.from(rounded), 192, 'icon-192');
await png(Buffer.from(rounded), 512, 'icon-512');
await png(square, 180, 'apple-touch-icon');
await png(square, 512, 'icon-square-512');   // обложка радио на экране блокировки
await png(square, 512, 'icon-maskable-512'); // Android: рисунок внутри безопасной зоны
console.log('Иконки готовы');
