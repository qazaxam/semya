// Иконки приложения и обложки станций для экрана блокировки. Запуск: npm run icons
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { MAIN, POPULAR } from '../src/stations.js';
import { initials } from '../src/label.js';

const dir = 'public/icons/';
const rounded = readFileSync(dir + 'icon.svg', 'utf8');
// квадрат без прозрачных углов: iPhone сам скругляет иконки
const square = Buffer.from(rounded.replace(/rx="\d+"/, 'rx="0"'));
const png = (svg, size, file) => sharp(Buffer.isBuffer(svg) ? svg : Buffer.from(svg), { density: 300 }).resize(size, size).png().toFile(file);

await png(rounded, 192, dir + 'icon-192.png');
await png(rounded, 512, dir + 'icon-512.png');
await png(square, 180, dir + 'apple-touch-icon.png');
// Android: рисунок внутри безопасной зоны (80%)
await png(rounded.replace('<rect width="512" height="512" rx="112"', '<rect width="512" height="512" rx="0"').replace('r="176"', 'r="150"'), 512, dir + 'icon-maskable-512.png');

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
// обложка станции 512×512: цвет станции, крупные буквы, частота
for (const st of [...MAIN, ...POPULAR]) {
  const label = esc(initials(st.name));
  const size = label.length > 2 ? 190 : 230;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${st.color}"/><stop offset="1" stop-color="#0e0d14" stop-opacity=".55"/></linearGradient></defs>
    <rect width="512" height="512" fill="${st.color}"/><rect width="512" height="512" fill="url(#g)"/>
    <text x="256" y="${st.fm ? 300 : 335}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="${size}" fill="#fff">${label}</text>
    ${st.fm ? `<text x="256" y="400" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="54" fill="#fff" opacity=".85">${esc(st.fm)} FM</text>` : ''}
    <text x="256" y="474" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="30" fill="#fff" opacity=".6">${esc(st.name)}</text>
  </svg>`;
  await png(svg, 512, `public/art/${st.id}.png`);
}
console.log('Иконки и обложки готовы');
