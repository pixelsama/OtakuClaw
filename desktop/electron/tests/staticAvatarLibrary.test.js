const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { StaticAvatarLibrary } = require('../services/staticAvatarLibrary');

function createLibraryWithRoot(rootDir) {
  const app = {
    getPath(name) {
      assert.equal(name, 'userData');
      return rootDir;
    },
  };
  return new StaticAvatarLibrary(app);
}

test('resolveProtocolUrl supports triple-slash protocol path', () => {
  const root = path.join(os.tmpdir(), 'openclaw-avatar-lib-test-a');
  const library = createLibraryWithRoot(root);
  const resolved = library.resolveProtocolUrl(
    'openclaw-avatar:///demo-pack-1/assets/character/idle.webp',
  );

  assert.equal(
    resolved,
    path.join(root, 'static-avatars', 'demo-pack-1', 'assets', 'character', 'idle.webp'),
  );
});

test('resolveProtocolUrl rejects path traversal', () => {
  const root = path.join(os.tmpdir(), 'openclaw-avatar-lib-test-b');
  const library = createLibraryWithRoot(root);

  assert.throws(
    () => library.resolveProtocolUrl('openclaw-avatar://../outside.webp'),
    /invalid_avatar_path/,
  );
});

test('importZip rejects unsafe ZIP entries', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-avatar-lib-test-c-'));
  const library = createLibraryWithRoot(root);
  library.listZipEntries = async () => ['../outside.png'];
  library.extractZip = async () => {
    throw new Error('extract should not be called when entries are unsafe');
  };

  await assert.rejects(
    () => library.importZip('/tmp/mock-avatar.zip'),
    (error) => error?.code === 'static_avatar_invalid_archive',
  );
});

test('importZip parses manifest and returns imported pack', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openclaw-avatar-lib-test-d-'));
  const library = createLibraryWithRoot(root);

  library.listZipEntries = async () => [
    'manifest.json',
    'assets/character/idle.webp',
    'assets/character/writing.webp',
    'assets/character/researching.webp',
    'assets/character/executing.webp',
    'assets/character/error.webp',
  ];

  library.extractZip = async (_zipPath, outputDir) => {
    const assetsDir = path.join(outputDir, 'assets', 'character');
    await fs.mkdir(assetsDir, { recursive: true });
    const manifest = {
      schemaVersion: 1,
      packId: 'com.otakuclaw.avatar.demo',
      name: 'Demo Static Avatar',
      version: '1.0.0',
      states: {
        idle: 'assets/character/idle.webp',
        writing: 'assets/character/writing.webp',
        researching: 'assets/character/researching.webp',
        executing: 'assets/character/executing.webp',
        error: 'assets/character/error.webp',
      },
      hitTest: {
        mode: 'alpha',
        alphaThreshold: 12,
      },
    };

    await fs.writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    for (const fileName of ['idle.webp', 'writing.webp', 'researching.webp', 'executing.webp', 'error.webp']) {
      await fs.writeFile(path.join(assetsDir, fileName), 'fake-image-content', 'utf-8');
    }
  };

  const result = await library.importZip('/tmp/mock-avatar.zip');
  assert.equal(result.imported.packId, 'com.otakuclaw.avatar.demo');
  assert.equal(result.imported.name, 'Demo Static Avatar');
  assert.equal(result.imported.hitTest.mode, 'alpha');
  assert.equal(result.imported.hitTest.alphaThreshold, 12);
  assert.equal(Array.isArray(result.packs), true);
  assert.equal(result.packs.length, 1);
  assert.equal(result.packs[0].states.idle.startsWith('openclaw-avatar:///'), true);
});
