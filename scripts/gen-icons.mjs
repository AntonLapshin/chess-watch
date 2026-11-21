// Generate 192x192 app icons: dark background, 2x2 checker, white knight mark.
// Output: assets/default.s/icon.png and assets/default.r/icon.png.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
<rect width="192" height="192" fill="#0E1116"/>
<rect x="24" y="24" width="72" height="72" fill="#E9E3D3"/>
<rect x="96" y="24" width="72" height="72" fill="#75836B"/>
<rect x="24" y="96" width="72" height="72" fill="#75836B"/>
<rect x="96" y="96" width="72" height="72" fill="#E9E3D3"/>
<g fill="#FFFFFF" stroke="#101418" stroke-width="5" stroke-linejoin="round">
<path d="M72 150 L78 96 L92 66 L112 48 L132 60 L122 78 L140 92 L134 112 L120 108 L114 132 L118 150 Z"/>
</g></svg>`;
const png = await sharp(Buffer.from(svg)).resize(192, 192).png().toBuffer();
for (const shape of ["s", "r"]) {
  const dir = path.join(root, "assets", `default.${shape}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "icon.png"), png);
  console.log(`gen-icons: wrote assets/default.${shape}/icon.png (192x192)`);
}
