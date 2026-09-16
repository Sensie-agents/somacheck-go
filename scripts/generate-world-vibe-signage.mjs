#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/opt/homebrew/lib/node_modules/playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const topicsPath = path.join(root, 'world-vibe', 'topics.json');
const defaultOutput = path.join(root, '.artifacts', 'world-vibe-signage');
const outputDirectory = path.resolve(process.argv[2] || defaultOutput);
const fontPath = process.env.SOMACHECK_SIGNAGE_FONT_PATH || '/Users/theagents/Library/Fonts/HankenGrotesk[wght].ttf';

const BASE_URL = 'https://go.somacheck.com/world-vibe/share';
const PRIVACY_LINE = 'Your check-in stays in your SomaCheck account. This event sees only aggregate results.';
const ACTION_TITLE = 'Scan with your phone camera.';
const ACTION_DETAIL = 'Tap the link. Check in with SomaCheck.';

const COLORS = Object.freeze({
  paper: '#FBF6EE',
  ink: '#261D16',
  emerald: '#12A594',
  white: '#FFFFFF',
});

const FORMATS = Object.freeze([
  {
    id: 'tabletop-a4',
    label: 'Tabletop / counter',
    width: 2480,
    height: 3508,
    dpi: 300,
    qrPixels: 900,
    minimumQrInches: 3,
    minimumPrivacyPoints: 12,
    minimumUrlPoints: 10,
    layout: 'portrait',
    padding: 160,
    brandSize: 48,
    formatSize: 42,
    statementSize: 154,
    actionTitleSize: 68,
    actionDetailSize: 48,
    privacySize: 52,
    urlSize: 42,
  },
  {
    id: 'booth-11x17',
    label: 'Booth / storefront',
    width: 3300,
    height: 5100,
    dpi: 300,
    qrPixels: 1800,
    minimumQrInches: 6,
    minimumPrivacyPoints: 12,
    minimumUrlPoints: 12,
    layout: 'portrait',
    padding: 220,
    brandSize: 66,
    formatSize: 54,
    statementSize: 216,
    actionTitleSize: 96,
    actionDetailSize: 68,
    privacySize: 56,
    urlSize: 64,
  },
  {
    id: 'arena-4k',
    label: 'Large display / arena',
    width: 3840,
    height: 2160,
    dpi: null,
    qrPixels: 1080,
    minimumQrInches: null,
    minimumPrivacyPoints: null,
    minimumUrlPoints: null,
    layout: 'landscape',
    padding: 150,
    brandSize: 54,
    formatSize: 46,
    statementSize: 192,
    actionTitleSize: 78,
    actionDetailSize: 58,
    privacySize: 42,
    urlSize: 34,
  },
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function decodeQr(filePath) {
  return execFileSync('/opt/homebrew/bin/zbarimg', ['--quiet', '--raw', filePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function posterHtml({ format, statement, url, qrDataUrl, fontDataUrl }) {
  const landscape = format.layout === 'landscape';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- hallmark: utility-first physical handoff; inherited SomaCheck palette and typography; no ornamental motion -->
  <style>
    @font-face {
      font-family: "Hanken Grotesk";
      src: url("${fontDataUrl}") format("truetype");
      font-style: normal;
      font-weight: 100 900;
    }
    :root {
      --paper: ${COLORS.paper};
      --ink: ${COLORS.ink};
      --emerald: ${COLORS.emerald};
      --white: ${COLORS.white};
      --page-width: ${format.width}px;
      --page-height: ${format.height}px;
      --page-padding: ${format.padding}px;
      --qr-size: ${format.qrPixels}px;
      --font-brand: ${format.brandSize}px;
      --font-format: ${format.formatSize}px;
      --font-statement: ${format.statementSize}px;
      --font-action-title: ${format.actionTitleSize}px;
      --font-action-detail: ${format.actionDetailSize}px;
      --font-privacy: ${format.privacySize}px;
      --font-url: ${format.urlSize}px;
    }
    * { box-sizing: border-box; }
    html, body {
      width: var(--page-width);
      height: var(--page-height);
      margin: 0;
      overflow: hidden;
      background: var(--paper);
      color: var(--ink);
      font-family: "Hanken Grotesk", system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    .poster {
      width: 100%;
      height: 100%;
      padding: var(--page-padding);
      display: grid;
      grid-template-rows: auto 1fr;
      gap: ${landscape ? 90 : 120}px;
    }
    .masthead {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 48px;
      border-bottom: ${landscape ? 8 : 10}px solid var(--emerald);
      padding-bottom: ${landscape ? 34 : 44}px;
    }
    .brand {
      font-size: var(--font-brand);
      font-weight: 760;
      letter-spacing: -0.02em;
    }
    .brand-mark { color: var(--emerald); }
    .format-label {
      font-size: var(--font-format);
      font-weight: 650;
      color: var(--emerald);
    }
    .content {
      display: grid;
      grid-template-columns: ${landscape ? 'minmax(0, 1fr) auto' : '1fr'};
      grid-template-rows: ${landscape ? '1fr' : 'auto 1fr'};
      align-items: ${landscape ? 'center' : 'stretch'};
      gap: ${landscape ? 150 : 100}px;
      min-height: 0;
    }
    .message {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
    }
    .statement {
      max-width: ${landscape ? 1900 : 2800}px;
      margin: 0;
      font-size: var(--font-statement);
      font-weight: 760;
      line-height: 0.98;
      letter-spacing: -0.045em;
      text-wrap: balance;
    }
    .statement::before {
      content: "“";
      color: var(--emerald);
      margin-right: 0.04em;
    }
    .statement::after {
      content: "”";
      color: var(--emerald);
      margin-left: 0.04em;
    }
    .handoff {
      display: grid;
      grid-template-columns: ${landscape ? '1fr' : 'minmax(0, 1fr) auto'};
      align-items: center;
      gap: ${landscape ? 54 : 100}px;
      min-height: 0;
    }
    .instructions {
      display: flex;
      flex-direction: column;
      gap: ${landscape ? 32 : 42}px;
      min-width: 0;
    }
    .step-number {
      display: inline-grid;
      place-items: center;
      width: 1.5em;
      height: 1.5em;
      margin-right: 0.25em;
      border-radius: 50%;
      background: var(--emerald);
      color: var(--white);
      font-size: 0.72em;
      vertical-align: 0.12em;
    }
    .action-title {
      margin: 0;
      font-size: var(--font-action-title);
      font-weight: 760;
      line-height: 1.08;
      letter-spacing: -0.025em;
    }
    .action-detail {
      margin: 0;
      max-width: 1150px;
      font-size: var(--font-action-detail);
      font-weight: 610;
      line-height: 1.18;
    }
    .privacy {
      margin: ${landscape ? 18 : 26}px 0 0;
      max-width: 1300px;
      font-size: var(--font-privacy);
      font-weight: 520;
      line-height: 1.26;
    }
    .qr-group {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: ${landscape ? 24 : 28}px;
    }
    .qr-frame {
      box-sizing: content-box;
      width: var(--qr-size);
      height: var(--qr-size);
      padding: ${landscape ? 42 : 48}px;
      background: var(--white);
      border: ${landscape ? 12 : 14}px solid var(--ink);
      border-radius: ${landscape ? 34 : 40}px;
    }
    .qr-frame img {
      display: block;
      width: 100%;
      height: 100%;
      image-rendering: pixelated;
    }
    .fallback-url {
      max-width: calc(var(--qr-size) + 220px);
      overflow-wrap: anywhere;
      text-align: center;
      font-size: var(--font-url);
      font-weight: 650;
      line-height: 1.18;
    }
  </style>
</head>
<body>
  <main class="poster" data-design-macrostructure="utility-first-poster">
    <header class="masthead">
      <div class="brand">SomaCheck<span class="brand-mark">*</span></div>
      <div class="format-label">World Vibe</div>
    </header>
    <section class="content">
      <div class="message">
        <p class="statement">${escapeHtml(statement)}</p>
      </div>
      <div class="handoff">
        <div class="instructions">
          <p class="action-title"><span class="step-number">1</span>${escapeHtml(ACTION_TITLE)}</p>
          <p class="action-detail"><span class="step-number">2</span>${escapeHtml(ACTION_DETAIL)}</p>
          <p class="privacy">${escapeHtml(PRIVACY_LINE)}</p>
        </div>
        <div class="qr-group">
          <div class="qr-frame"><img src="${qrDataUrl}" alt="QR code for ${escapeHtml(statement)}"></div>
          <div class="fallback-url">${escapeHtml(url)}</div>
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

async function main() {
  const [topicsBytes, fontBytes] = await Promise.all([
    readFile(topicsPath),
    readFile(fontPath),
  ]);
  const topicsDocument = JSON.parse(topicsBytes.toString('utf8'));
  const topics = topicsDocument.topics;
  if (!Array.isArray(topics) || topics.length === 0) {
    throw new Error('world-vibe/topics.json must contain a non-empty topics array');
  }
  if (new Set(topics.map((topic) => topic.id)).size !== topics.length) {
    throw new Error('world-vibe/topics.json contains duplicate topic ids');
  }

  await mkdir(outputDirectory, { recursive: true });
  const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const fontDataUrl = `data:font/ttf;base64,${fontBytes.toString('base64')}`;
  const browser = await chromium.launch({ headless: true });
  const artifacts = [];

  try {
    for (const topic of topics) {
      const url = `${BASE_URL}/${topic.id}`;
      const qrSourcePath = path.join(root, 'world-vibe', 'assets', `qr-${topic.id}.png`);
      const sourceDecode = decodeQr(qrSourcePath);
      if (sourceDecode !== url) {
        throw new Error(`Source QR mismatch for ${topic.id}: ${sourceDecode}`);
      }
      const qrBytes = await readFile(qrSourcePath);
      const qrDataUrl = `data:image/png;base64,${qrBytes.toString('base64')}`;

      for (const format of FORMATS) {
        const page = await browser.newPage({
          viewport: { width: format.width, height: format.height },
          deviceScaleFactor: 1,
        });
        await page.setContent(posterHtml({
          format,
          statement: topic.statement,
          url,
          qrDataUrl,
          fontDataUrl,
        }), { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);

        const renderedMetrics = await page.evaluate(() => {
          const qr = document.querySelector('.qr-frame img').getBoundingClientRect();
          const frame = document.querySelector('.qr-frame').getBoundingClientRect();
          const privacy = getComputedStyle(document.querySelector('.privacy'));
          const fallbackUrl = getComputedStyle(document.querySelector('.fallback-url'));
          return {
            qrWidth: qr.width,
            qrHeight: qr.height,
            frameWidth: frame.width,
            frameHeight: frame.height,
            privacyFontPixels: Number.parseFloat(privacy.fontSize),
            urlFontPixels: Number.parseFloat(fallbackUrl.fontSize),
          };
        });
        if (renderedMetrics.qrWidth !== format.qrPixels || renderedMetrics.qrHeight !== format.qrPixels) {
          throw new Error(`${topic.id}/${format.id} QR image is ${renderedMetrics.qrWidth}x${renderedMetrics.qrHeight}, expected ${format.qrPixels}x${format.qrPixels}`);
        }
        const qrInches = format.dpi ? renderedMetrics.qrWidth / format.dpi : null;
        const privacyPoints = format.dpi ? renderedMetrics.privacyFontPixels * 72 / format.dpi : null;
        const urlPoints = format.dpi ? renderedMetrics.urlFontPixels * 72 / format.dpi : null;
        if (format.dpi && qrInches < format.minimumQrInches) {
          throw new Error(`${format.id} rendered QR is below its minimum physical size`);
        }
        if (format.dpi && privacyPoints < format.minimumPrivacyPoints) {
          throw new Error(`${format.id} rendered privacy copy is below its minimum point size`);
        }
        if (format.dpi && urlPoints < format.minimumUrlPoints) {
          throw new Error(`${format.id} rendered fallback URL is below its minimum point size`);
        }

        const overflow = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
          clientWidth: document.documentElement.clientWidth,
          clientHeight: document.documentElement.clientHeight,
        }));
        if (overflow.width !== format.width || overflow.height !== format.height ||
            overflow.clientWidth !== format.width || overflow.clientHeight !== format.height) {
          throw new Error(`${topic.id}/${format.id} overflows: ${JSON.stringify(overflow)}`);
        }

        const fileName = `${topic.id}--${format.id}.png`;
        const outputPath = path.join(outputDirectory, fileName);
        await page.screenshot({ path: outputPath, type: 'png', omitBackground: false });
        await page.close();

        if (format.dpi) {
          const densityPath = path.join(outputDirectory, `${topic.id}--${format.id}.density.png`);
          execFileSync('/opt/homebrew/bin/magick', [
            outputPath,
            '-define', 'png:exclude-chunks=date,time',
            '-density', String(format.dpi),
            '-units', 'pixelsperinch',
            densityPath,
          ]);
          await rename(densityPath, outputPath);
        }

        const renderedDecode = decodeQr(outputPath);
        if (renderedDecode !== url) {
          throw new Error(`Rendered QR mismatch for ${topic.id}/${format.id}: ${renderedDecode}`);
        }
        const renderedBytes = await readFile(outputPath);
        const geometry = execFileSync('/opt/homebrew/bin/magick', [
          'identify', '-format', '%w %h', outputPath,
        ], { encoding: 'utf8' }).trim().split(' ').map(Number);
        if (geometry[0] !== format.width || geometry[1] !== format.height) {
          throw new Error(`Rendered geometry mismatch for ${topic.id}/${format.id}: ${geometry.join('x')}`);
        }

        artifacts.push({
          topicId: topic.id,
          statement: topic.statement,
          url,
          formatId: format.id,
          formatLabel: format.label,
          file: fileName,
          width: format.width,
          height: format.height,
          dpi: format.dpi,
          qrPixels: format.qrPixels,
          qrRenderedWidth: renderedMetrics.qrWidth,
          qrRenderedHeight: renderedMetrics.qrHeight,
          qrFrameOuterWidth: renderedMetrics.frameWidth,
          qrFrameOuterHeight: renderedMetrics.frameHeight,
          qrInches,
          privacyFontPixels: renderedMetrics.privacyFontPixels,
          privacyPoints,
          urlFontPixels: renderedMetrics.urlFontPixels,
          urlPoints,
          decodedUrl: renderedDecode,
          sha256: sha256(renderedBytes),
        });
      }
    }
  } finally {
    await browser.close();
  }

  const manifest = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    candidateOnly: true,
    physicalDeviceGate: 'Mike\'s iPhone 12 mini',
    source: {
      gitHead,
      topicsFile: 'world-vibe/topics.json',
      topicsSha256: sha256(topicsBytes),
      topicCount: topics.length,
      topicIds: topics.map((topic) => topic.id),
    },
    design: {
      macrostructure: 'utility-first physical handoff',
      typeface: 'Hanken Grotesk',
      fontSha256: sha256(fontBytes),
      colors: COLORS,
      actionTitle: ACTION_TITLE,
      actionDetail: ACTION_DETAIL,
      privacyLine: PRIVACY_LINE,
    },
    formats: FORMATS.map(({ id, label, width, height, dpi, qrPixels, minimumQrInches, minimumPrivacyPoints, minimumUrlPoints }) => ({
      id, label, width, height, dpi, qrPixels, minimumQrInches, minimumPrivacyPoints, minimumUrlPoints,
    })),
    artifacts,
  };
  await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ outputDirectory, artifactCount: artifacts.length, manifest }, null, 2)}\n`);
}

await main();
