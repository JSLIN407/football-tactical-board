/**
 * Generates crisp PNG mobile app icons (180x180, 192x192, 512x512 + Android mipmap icons) using pure Node zlib,
 * generates dist/pure.html (Full-Screen Pure Tactical Board PWA), syncs docs/ for GitHub Pages hosting,
 * and packages standalone single-file HTML apps (AI版 & 手機純享版) into release/.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const rootDir = process.cwd();
const iconsDir = path.join(rootDir, 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const nameBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([nameBuf, data])), 0);
  return Buffer.concat([len, nameBuf, data, crcBuf]);
}

function renderTacticalIconPng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const pad = Math.round(size * 0.14);
  const cx = size / 2;
  const cy = size / 2;
  const lineW = Math.max(2, Math.round(size * 0.018));

  const homeDot = { x: size * 0.36, y: size * 0.66, r: size * 0.085 };
  const awayDot = { x: size * 0.64, y: size * 0.36, r: size * 0.085 };
  const ballDot = { x: size * 0.48, y: size * 0.52, r: size * 0.048 };

  for (let y = 0; y < size; y++) {
    const rowOffset = y * (size * 4 + 1);
    raw[rowOffset] = 0;

    for (let x = 0; x < size; x++) {
      const px = rowOffset + 1 + x * 4;
      let r = 15, g = 34, b = 24;

      if (x >= pad && x < size - pad && y >= pad && y < size - pad) {
        const stripe = Math.floor(((y - pad) / (size - pad * 2)) * 8) % 2 === 0;
        r = stripe ? 29 : 24;
        g = stripe ? 77 : 66;
        b = stripe ? 48 : 41;

        const onBorder =
          x - pad < lineW ||
          size - pad - x <= lineW ||
          y - pad < lineW ||
          size - pad - y <= lineW;
        const onHalfLine = Math.abs(y - cy) < lineW * 0.85;
        const distCenter = Math.hypot(x - cx, y - cy);
        const onCenterCircle = Math.abs(distCenter - size * 0.14) < lineW * 0.9;

        if (onBorder || onHalfLine || onCenterCircle) {
          r = 226;
          g = 242;
          b = 233;
        }
      }

      const dHome = Math.hypot(x - homeDot.x, y - homeDot.y);
      if (dHome <= homeDot.r + lineW) {
        if (dHome > homeDot.r - lineW * 0.4) {
          r = 255; g = 255; b = 255;
        } else {
          r = 239; g = 68; b = 68;
        }
      }

      const dAway = Math.hypot(x - awayDot.x, y - awayDot.y);
      if (dAway <= awayDot.r + lineW) {
        if (dAway > awayDot.r - lineW * 0.4) {
          r = 255; g = 255; b = 255;
        } else {
          r = 59; g = 130; b = 246;
        }
      }

      const dBall = Math.hypot(x - ballDot.x, y - ballDot.y);
      if (dBall <= ballDot.r) {
        r = 250; g = 204; b = 21;
      }

      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const mode = process.argv[2] || 'icons';

if (mode === 'icons' || mode === 'all') {
  fs.writeFileSync(path.join(iconsDir, 'apple-touch-icon.png'), renderTacticalIconPng(180));
  fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), renderTacticalIconPng(192));
  fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), renderTacticalIconPng(512));

  const androidResDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'res');
  if (fs.existsSync(androidResDir)) {
    const mipmaps = [
      ['mipmap-mdpi', 48],
      ['mipmap-hdpi', 72],
      ['mipmap-xhdpi', 96],
      ['mipmap-xxhdpi', 144],
      ['mipmap-xxxhdpi', 192],
    ];
    for (const [folder, sz] of mipmaps) {
      const targetDir = path.join(androidResDir, folder);
      if (fs.existsSync(targetDir)) {
        const pngBuf = renderTacticalIconPng(sz);
        fs.writeFileSync(path.join(targetDir, 'ic_launcher.png'), pngBuf);
        fs.writeFileSync(path.join(targetDir, 'ic_launcher_round.png'), pngBuf);
        fs.writeFileSync(path.join(targetDir, 'ic_launcher_foreground.png'), pngBuf);
      }
    }
  }
  console.log('Generated mobile icons in public/icons/ and Android mipmap folders');
}

if (mode === 'bundle' || mode === 'all') {
  const distDir = path.join(rootDir, 'dist');
  const assetsDir = path.join(distDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    const distIndexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
    const pureDistHtml = distIndexHtml
      .replace('./manifest.webmanifest', './manifest-pure.webmanifest')
      .replace('content="#121b17"', 'content="#143321"')
      .replace('content="AI戰術板"', 'content="戰術板純享"')
      .replace(/<title>.*?<\/title>/, '<title>足球戰術板（手機純享全螢幕版）</title>')
      .replace('<head>', '<head>\n    <script>window.__PURE_TACTICAL_BOARD__ = true;</script>');
    fs.writeFileSync(path.join(distDir, 'pure.html'), pureDistHtml, 'utf8');

    const files = fs.readdirSync(assetsDir);
    const cssFile = files.find((f) => f.endsWith('.css'));
    const jsFile = files.find((f) => f.endsWith('.js'));
    const iconB64 = fs.readFileSync(path.join(iconsDir, 'apple-touch-icon.png')).toString('base64');

    if (cssFile && jsFile) {
      const cssContent = fs.readFileSync(path.join(assetsDir, cssFile), 'utf8');
      const jsContent = fs.readFileSync(path.join(assetsDir, jsFile), 'utf8');
      const safeJs = jsContent.replace(/<\/script>/gi, '<\\/script>');

      const releaseDir = path.join(rootDir, 'release');
      fs.mkdirSync(releaseDir, { recursive: true });

      const aiStandaloneHtml = `<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#121b17" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="AI戰術板" />
    <link rel="apple-touch-icon" href="data:image/png;base64,${iconB64}" />
    <link rel="icon" type="image/png" href="data:image/png;base64,${iconB64}" />
    <title>AI 足球空間戰術推演板（手機隨身版）</title>
    <style>${cssContent}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${safeJs}</script>
  </body>
</html>`;

      const pureStandaloneHtml = `<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#143321" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="戰術板純享" />
    <link rel="apple-touch-icon" href="data:image/png;base64,${iconB64}" />
    <link rel="icon" type="image/png" href="data:image/png;base64,${iconB64}" />
    <title>足球戰術板（手機純享全螢幕版）</title>
    <script>window.__PURE_TACTICAL_BOARD__ = true;</script>
    <style>${cssContent}</style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module">${safeJs}</script>
  </body>
</html>`;

      const aiOutPath = path.join(releaseDir, 'AI足球戰術板_手機隨身版.html');
      const pureOutPath = path.join(releaseDir, '足球戰術板_手機純享版.html');
      fs.writeFileSync(aiOutPath, aiStandaloneHtml, 'utf8');
      fs.writeFileSync(pureOutPath, pureStandaloneHtml, 'utf8');

      // Sync dist/ + downloads/ to docs/ for GitHub Pages cloud hosting
      const docsDir = path.join(rootDir, 'docs');
      fs.rmSync(docsDir, { recursive: true, force: true });
      fs.cpSync(distDir, docsDir, { recursive: true });
      fs.writeFileSync(path.join(docsDir, '.nojekyll'), '', 'utf8');

      const docsDlDir = path.join(docsDir, 'downloads');
      fs.mkdirSync(docsDlDir, { recursive: true });
      fs.copyFileSync(pureOutPath, path.join(docsDlDir, 'Football-Tactical-Board-Pure-v1.2.1.html'));
      fs.copyFileSync(aiOutPath, path.join(docsDlDir, 'AI-Football-Tactical-Board-Standalone-v1.2.1.html'));

      console.log('Bundled AI & Pure mobile apps and synced docs/:', pureOutPath);
    }
  }
}
