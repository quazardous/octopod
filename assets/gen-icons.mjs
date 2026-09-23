#!/usr/bin/env node
// Draws octopod's icon — a tako in the Japanese way: a twisted hachimaki round its head,
// its lips pouted into a tube — and packs it into the multi-size .ico files the Windows
// tray shows. The SVGs are the source; the .ico files are committed, so neither the tray
// nor an install needs this script.
//
//   node assets/gen-icons.mjs        (fetches @resvg/resvg-js-cli through npx, once)
//
// octopod.ico: the edge runs. octopod-down.ico: it does not (or Docker does not answer),
// the tako asleep and grey.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
const SIZES = [16, 20, 24, 32, 40, 48, 64, 256];

function tako({ body, dark, cheek, band, twist, awake }) {
  const eyes = awake
    ? `<ellipse cx="100" cy="112" rx="11" ry="14" fill="#1d1d1f"/><ellipse cx="156" cy="112" rx="11" ry="14" fill="#1d1d1f"/>
       <circle cx="104" cy="106" r="4.5" fill="#fff"/><circle cx="160" cy="106" r="4.5" fill="#fff"/>`
    : `<path d="M88 114 q12 10 24 0 M144 114 q12 10 24 0" fill="none" stroke="#1d1d1f" stroke-width="7" stroke-linecap="round"/>`;
  // Six arms seen from the front, fanned out under the head, each tip curled outward.
  const arms = [
    'M70 160 C44 176 24 196 30 214 C34 226 50 224 50 212',
    'M96 176 C84 200 74 222 82 236 C88 246 102 240 98 228',
    'M120 182 C116 206 112 228 118 240',
    'M136 182 C140 206 144 228 138 240',
    'M160 176 C172 200 182 222 174 236 C168 246 154 240 158 228',
    'M186 160 C212 176 232 196 226 214 C222 226 206 224 206 212',
  ];
  const stroke = (color, width) =>
    arms.map((d) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  ${stroke(dark, 30)}${stroke(body, 18)}
  <ellipse cx="128" cy="106" rx="86" ry="78" fill="${body}" stroke="${dark}" stroke-width="9"/>
  <path d="M206 84 C224 70 244 64 248 74 C250 82 236 88 222 90 C238 96 248 108 242 114 C234 120 218 106 208 94 Z" fill="${band}" stroke="${dark}" stroke-width="6" stroke-linejoin="round"/>
  <path d="M46 78 Q128 40 210 78 L206 100 Q128 64 50 100 Z" fill="${band}" stroke="${dark}" stroke-width="7" stroke-linejoin="round"/>
  <path d="M74 66 l12 24 M104 58 l10 24 M136 56 l8 24 M166 60 l8 24 M194 70 l5 22" stroke="${twist}" stroke-width="7" stroke-linecap="round"/>
  <circle cx="210" cy="88" r="11" fill="${band}" stroke="${dark}" stroke-width="6"/>
  ${eyes}
  <ellipse cx="80" cy="138" rx="15" ry="9" fill="${cheek}" opacity="0.8"/>
  <ellipse cx="176" cy="138" rx="15" ry="9" fill="${cheek}" opacity="0.8"/>
  <ellipse cx="128" cy="148" rx="19" ry="17" fill="${body}" stroke="${dark}" stroke-width="8"/>
  <ellipse cx="128" cy="148" rx="7" ry="6" fill="${dark}"/>
</svg>
`;
}

const ICONS = {
  octopod: tako({ body: '#ef5a4c', dark: '#7c1d17', cheek: '#ff9fb2', band: '#ffffff', twist: '#e0473b', awake: true }),
  'octopod-down': tako({ body: '#9aa3ad', dark: '#3e454d', cheek: '#c6ccd3', band: '#e6e9ec', twist: '#8a939c', awake: false }),
};

/** An .ico of PNG frames: a 6-byte header, one 16-byte entry per frame, then the PNGs. */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    header[at] = size >= 256 ? 0 : size;
    header[at + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(data.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

/** One SVG to one PNG, `size` pixels wide, from the vector. */
function render(svgFile, size, pngFile) {
  execFileSync('npx', ['-y', '@resvg/resvg-js-cli', '--fit-width', String(size), fileURLToPath(svgFile), pngFile], { stdio: 'ignore', shell: process.platform === 'win32' });
}

const work = mkdtempSync(join(tmpdir(), 'octopod-icons-'));
try {
  for (const [name, svg] of Object.entries(ICONS)) {
    const svgFile = new URL(`${name}.svg`, here);
    writeFileSync(svgFile, svg);
    const pngs = SIZES.map((size) => {
      const out = join(work, `${name}-${size}.png`);
      // Each size rendered from the vector: no frame is a downscaled bitmap.
      render(svgFile, size, out);
      return { size, data: readFileSync(out) };
    });
    writeFileSync(new URL(`${name}.ico`, here), ico(pngs));
    writeFileSync(new URL(`${name}.png`, here), pngs.find((p) => p.size === 256).data);
    console.log(`assets/${name}.svg, .ico (${SIZES.join(', ')}), .png`);
  }
  // The tray's menu shows the GitHub mark as a bitmap: WinForms draws no SVG.
  render(new URL('github.svg', here), 32, fileURLToPath(new URL('github-32.png', here)));
  console.log('assets/github-32.png');
} finally {
  rmSync(work, { recursive: true, force: true });
}
