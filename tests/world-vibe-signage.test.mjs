import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outputDirectory = await mkdtemp(path.join(os.tmpdir(), 'world-vibe-signage-'));

try {
  execFileSync(process.execPath, [
    path.join(root, 'scripts', 'generate-world-vibe-signage.mjs'),
    outputDirectory,
  ], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });

  const [topicsDocument, manifest] = await Promise.all([
    readFile(path.join(root, 'world-vibe', 'topics.json'), 'utf8').then(JSON.parse),
    readFile(path.join(outputDirectory, 'manifest.json'), 'utf8').then(JSON.parse),
  ]);
  const expectedTopicIds = topicsDocument.topics.map((topic) => topic.id);

  assert.equal(manifest.candidateOnly, true);
  assert.equal(manifest.physicalDeviceGate, "Mike's iPhone 12 mini");
  assert.deepEqual(manifest.source.topicIds, expectedTopicIds, 'signage topic inventory must exactly match topics.json');
  assert.equal(manifest.source.topicCount, expectedTopicIds.length);
  assert.deepEqual(manifest.formats.map((format) => format.id), [
    'tabletop-a4',
    'booth-11x17',
    'arena-4k',
  ]);
  assert.equal(manifest.artifacts.length, expectedTopicIds.length * manifest.formats.length);

  for (const topic of topicsDocument.topics) {
    const topicArtifacts = manifest.artifacts.filter((artifact) => artifact.topicId === topic.id);
    assert.equal(topicArtifacts.length, manifest.formats.length);
    for (const artifact of topicArtifacts) {
      const expectedUrl = `https://go.somacheck.com/world-vibe/share/${topic.id}`;
      const artifactPath = path.join(outputDirectory, artifact.file);
      assert.equal(artifact.statement, topic.statement);
      assert.equal(artifact.url, expectedUrl);
      assert.equal(artifact.decodedUrl, expectedUrl);
      assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
      if (artifact.dpi) {
        const format = manifest.formats.find((candidate) => candidate.id === artifact.formatId);
        assert.ok(artifact.qrInches >= format.minimumQrInches);
      }

      const blurredPath = path.join(outputDirectory, `${topic.id}--${artifact.formatId}--blurred.png`);
      execFileSync('/opt/homebrew/bin/magick', [
        artifactPath, '-resize', '25%', '-blur', '0x0.5', blurredPath,
      ]);
      assert.equal(
        execFileSync('/opt/homebrew/bin/zbarimg', ['--quiet', '--raw', blurredPath], { encoding: 'utf8' }).trim(),
        expectedUrl,
        `${topic.id}/${artifact.formatId} must decode after 25% downscale and mild blur`
      );

      const rotatedPath = path.join(outputDirectory, `${topic.id}--${artifact.formatId}--rotated.png`);
      execFileSync('/opt/homebrew/bin/magick', [
        artifactPath, '-resize', '25%', '-background', 'white', '-rotate', '8', rotatedPath,
      ]);
      assert.equal(
        execFileSync('/opt/homebrew/bin/zbarimg', ['--quiet', '--raw', rotatedPath], { encoding: 'utf8' }).trim(),
        expectedUrl,
        `${topic.id}/${artifact.formatId} must decode after 25% downscale and 8 degree rotation`
      );
    }
  }

  assert.equal(
    manifest.design.privacyLine,
    'Your check-in stays in your SomaCheck account. This event sees only aggregate results.'
  );
  console.log(JSON.stringify({
    passed: true,
    topics: expectedTopicIds,
    formats: manifest.formats.map((format) => format.id),
    decodedArtifacts: manifest.artifacts.length,
    degradedDecodeChecks: manifest.artifacts.length * 2,
  }, null, 2));
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
