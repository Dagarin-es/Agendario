// Genera iconos adaptativos (con monocromo para iconos temáticos de Android 13+) y splash.
// Uso: node apps/mobile/scripts/icons.mjs  (desde la raíz del monorepo)
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const res = join(here, "../android/app/src/main/res");
const BG = "#4338CA";
const art = `
<rect x="22" y="16" width="44" height="64" rx="6" fill="#fff"/>
<rect x="66" y="20" width="12" height="14" rx="3" fill="#FCD34D"/>
<rect x="66" y="38" width="12" height="14" rx="3" fill="#A5B4FC"/>
<rect x="66" y="56" width="12" height="14" rx="3" fill="#F9A8D4"/>
<circle cx="44" cy="36" r="8" fill="${BG}"/>
<path d="M30 60 Q44 44 58 60 Z" fill="${BG}"/>
<path d="M50 78 L68 60 L73 65 L55 83 L48 85 Z" fill="#FCD34D" stroke="#312E81" stroke-width="1.8" stroke-linejoin="round"/>`;
const mono = `
<mask id="m"><rect width="96" height="96" fill="#fff"/><circle cx="44" cy="36" r="8" fill="#000"/><path d="M30 60 Q44 44 58 60 Z" fill="#000"/>
<path d="M50 78 L68 60 L73 65 L55 83 L48 85 Z" fill="#000" stroke="#000" stroke-width="5"/></mask>
<g fill="#fff"><rect x="22" y="16" width="44" height="64" rx="6" mask="url(#m)"/>
<rect x="66" y="20" width="12" height="14" rx="3"/><rect x="66" y="38" width="12" height="14" rx="3"/><rect x="66" y="56" width="12" height="14" rx="3" mask="url(#m)"/>
<path d="M50 78 L68 60 L73 65 L55 83 L48 85 Z"/></g>`;
const fg = (inner, scale = 0.78) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><g transform="translate(54 54) scale(${scale}) translate(-50 -50.5)">${inner}</g></svg>`;
const legacy = (round) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">${round ? `<circle cx="48" cy="48" r="48" fill="${BG}"/>` : `<rect width="96" height="96" rx="22" fill="${BG}"/>`}<g transform="translate(48 48) scale(${round ? 0.82 : 0.92}) translate(-50 -50.5)">${art}</g></svg>`;

const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const png = (svg, size, out) => sharp(Buffer.from(svg), { density: 600 }).resize(size, size).png().toFile(out);

for (const [d, k] of Object.entries(dens)) {
  const dir = join(res, `mipmap-${d}`);
  mkdirSync(dir, { recursive: true });
  await png(legacy(false), 48 * k, join(dir, "ic_launcher.png"));
  await png(legacy(true), 48 * k, join(dir, "ic_launcher_round.png"));
  await png(fg(art), 108 * k, join(dir, "ic_launcher_foreground.png"));
  await png(fg(mono), 108 * k, join(dir, "ic_launcher_monochrome.png"));
  // Icono del splash de Android 12+ (240dp con el dibujo dentro del círculo de 160dp)
  await png(fg(art, 0.62), 240 * k, join(dir, "ic_splash.png"));
}
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`;
writeFileSync(join(res, "mipmap-anydpi-v26/ic_launcher.xml"), adaptive);
writeFileSync(join(res, "mipmap-anydpi-v26/ic_launcher_round.xml"), adaptive);
writeFileSync(join(res, "values/ic_launcher_background.xml"),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);

// Splash clásico (Android < 12)
for (const dir of readdirSync(res).filter((d) => d.startsWith("drawable"))) {
  const f = join(res, dir, "splash.png");
  if (!existsSync(f)) continue;
  const { width, height } = await sharp(f).metadata();
  const s = Math.round(Math.min(width, height) * 0.38);
  const icon = await sharp(Buffer.from(legacy(false)), { density: 600 }).resize(s, s).png().toBuffer();
  await sharp({ create: { width, height, channels: 4, background: BG } })
    .composite([{ input: icon, gravity: "center" }]).png().toFile(f);
}
console.log("iconos y splash generados");
