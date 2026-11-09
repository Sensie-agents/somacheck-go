import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const topics = [
  { slug: 'gut-vs-dashboard', statement: 'I trust my gut more than my dashboard' },
  { slug: 'ai-at-work', statement: 'I feel hopeful about AI at work' },
  { slug: 'present-leadership', statement: 'I am fully present with the people I lead' }
];

function extractMetaContent(html, attrName, attrValue) {
  const patterns = [
    new RegExp(`<meta[^>]+${attrName}=["']${attrValue}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attrName}=["']${attrValue}["']`, 'i')
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match) return match[1];
  }
  return null;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const filePath = path.join(root, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
  try {
    const body = await readFile(filePath);
    response.writeHead(200);
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end('not found');
  }
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function assertImageServes(ogImageUrl, label) {
  assert.ok(ogImageUrl, `${label}: og:image must be present`);
  const pathname = new URL(ogImageUrl).pathname;
  const response = await fetch(`${origin}${pathname}`);
  assert.equal(response.status, 200, `${label}: og:image (${pathname}) must resolve locally with a 200`);
}

try {
  for (const topic of topics) {
    const html = await readFile(path.join(root, 'world-vibe', 'share', topic.slug, 'index.html'), 'utf8');
    const ogTitle = extractMetaContent(html, 'property', 'og:title');
    const ogDescription = extractMetaContent(html, 'property', 'og:description');
    const ogImage = extractMetaContent(html, 'property', 'og:image');
    const twitterCard = extractMetaContent(html, 'name', 'twitter:card');

    assert.ok(ogTitle && ogTitle.includes(topic.statement), `${topic.slug}: og:title must carry the exact statement`);
    assert.ok(ogDescription, `${topic.slug}: og:description must be present`);
    assert.match(ogDescription, /3-second/i, `${topic.slug}: description must truthfully mention the 3-second check`);
    assert.match(ogDescription, /5 people/i, `${topic.slug}: description must truthfully mention the 5-person unlock`);
    assert.doesNotMatch(ogDescription, /—|verdict|diagnos|truth\b/i, `${topic.slug}: description must respect copy boundaries`);
    await assertImageServes(ogImage, topic.slug);
    assert.equal(twitterCard, 'summary_large_image', `${topic.slug}: twitter:card must be present`);
  }

  const portalHtml = await readFile(path.join(root, 'world-vibe', 'legacy', 'index.html'), 'utf8');
  const portalTitle = extractMetaContent(portalHtml, 'property', 'og:title');
  const portalDescription = extractMetaContent(portalHtml, 'property', 'og:description');
  const portalImage = extractMetaContent(portalHtml, 'property', 'og:image');
  const portalTwitterCard = extractMetaContent(portalHtml, 'name', 'twitter:card');

  assert.ok(portalTitle, 'portal: og:title must be present');
  assert.ok(portalDescription, 'portal: og:description must be present');
  assert.match(portalDescription, /3-second/i, 'portal: description must mention the 3-second check');
  assert.match(portalDescription, /5 people/i, 'portal: description must mention the 5-person unlock');
  await assertImageServes(portalImage, 'portal');
  assert.equal(portalTwitterCard, 'summary_large_image', 'portal: twitter:card must be present');

  console.log(JSON.stringify({ passed: true, topicPagesChecked: topics.length, portalChecked: true }));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
