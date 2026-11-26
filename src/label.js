// Короткая надпись на плитке станции: «Power Türk» → «PT», «Radyo Tokat» → «TO», «Kral FM» → «KR».
const SKIP = /^(radyo|radio|fm|the)$/i;
export function initials(name) {
  const words = name.split(/\s+/).filter((w) => !SKIP.test(w));
  const w = words.length ? words : name.split(/\s+/);
  const up = (x) => x.toLocaleUpperCase('tr');
  if (w.length === 1) return /^\d+$/.test(w[0]) ? w[0] : up(w[0].slice(0, 2));
  return up(w[0][0] + w[1][0]);
}
