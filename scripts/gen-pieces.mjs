// Generate flat geometric chess pieces: SVG -> PNG via sharp.
// Output: images/pieces/{s,r}/<color><type>.png (12 each) at 38px (square)
// and 37px (round), plus web/public/images/pieces/{s,r}/ copies.
// White pieces: #FFFFFF fill, #101418 outline. Black: #14181C fill, #FFFFFF outline.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SIZES = { s: 38, r: 37 };
const COLORS = {
  w: { fill: "#FFFFFF", stroke: "#101418" },
  b: { fill: "#14181C", stroke: "#FFFFFF" },
};

// Simple flat silhouettes on a 100x100 viewBox. Each path is a single
// filled shape with a dark/light outline so it reads on both square colors.
const SHAPES = {
  p: `<circle cx="50" cy="26" r="14"/><path d="M34 44 Q50 36 66 44 L74 82 Q50 90 26 82 Z"/>`,
  r: `<path d="M28 14 h10 v8 h8 v-8 h8 v8 h8 v-8 h10 v22 h-6 v44 q-16 8 -32 0 v-44 h-6 Z"/>`,
  n: `<path d="M30 84 L34 44 L44 26 L58 14 L72 22 L66 34 L78 44 L74 58 L64 56 L60 72 L62 84 Z"/>`,
  b: `<path d="M50 10 L68 38 L60 52 L74 60 L78 72 L72 78 L28 78 L22 72 L26 60 L40 52 L32 38 Z"/><circle cx="50" cy="42" r="4"/>`,
  q: `<path d="M24 30 L32 48 L40 28 L50 46 L60 28 L68 48 L76 30 L72 62 L78 78 L22 78 L28 62 Z"/><circle cx="50" cy="18" r="5"/>`,
  k: `<path d="M46 8 h8 v10 h10 v8 h-10 v8 h-8 v-8 h-10 v-8 h10 Z"/><path d="M30 44 L38 58 L34 78 L66 78 L62 58 L70 44 Q50 36 30 44 Z"/>`,
};

function svgFor(type, color) {
  const { fill, stroke } = COLORS[color];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">` +
    `<g fill="${fill}" stroke="${stroke}" stroke-width="4" stroke-linejoin="round">${SHAPES[type]}</g></svg>`;
}

for (const [shape, size] of Object.entries(SIZES)) {
  for (const color of ["w", "b"]) {
    for (const type of ["p", "n", "b", "r", "q", "k"]) {
      const png = await sharp(Buffer.from(svgFor(type, color)))
        .resize(size, size)
        .png()
        .toBuffer();
      for (const base of [
        path.join(root, "images", "pieces", shape),
        path.join(root, "web", "public", "images", "pieces", shape),
      ]) {
        mkdirSync(base, { recursive: true });
        writeFileSync(path.join(base, `${color}${type}.png`), png);
      }
    }
  }
  console.log(`gen-pieces: wrote 12 PNGs at ${size}px for shape '${shape}'`);
}
