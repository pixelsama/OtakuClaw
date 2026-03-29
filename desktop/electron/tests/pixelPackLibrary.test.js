const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PixelPackLibrary,
} = require('../services/pixelPackLibrary');

function createApp(userDataPath) {
  return {
    getPath(name) {
      assert.equal(name, 'userData');
      return userDataPath;
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSettingsStoreStub() {
  const state = {
    ui: {
      pixelPack: {
        activePackId: '',
        activeVersion: '',
        overrides: {},
      },
    },
  };

  return {
    state,
    getForMain() {
      return clone(state);
    },
    getPublic() {
      return clone(state);
    },
    async save(partialSettings = {}) {
      const nextPixelPack = partialSettings?.ui?.pixelPack || {};
      state.ui.pixelPack = {
        ...state.ui.pixelPack,
        ...nextPixelPack,
        overrides: clone(nextPixelPack.overrides || state.ui.pixelPack.overrides || {}),
      };
      return this.getPublic();
    },
  };
}

async function createImportedPackFixture(outputDir, { characters = null } = {}) {
  await fs.mkdir(path.join(outputDir, 'assets', 'backgrounds'), { recursive: true });
  await fs.writeFile(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: 1,
      packId: 'com.otakuclaw.pixel.demo',
      name: 'Pixel Demo',
      version: '1.1.0',
      engine: '>=0.2.1',
      contractRevision: '1.1',
      assets: {
        'bg.office.main': {
          path: 'assets/backgrounds/office.webp',
          type: 'image',
        },
      },
      scene: {
        backdrop: {
          assetKey: 'bg.office.main',
        },
      },
      ...(characters ? { characters } : {}),
    }),
    'utf-8',
  );
  await fs.writeFile(path.join(outputDir, 'assets', 'backgrounds', 'office.webp'), 'fake-image', 'utf-8');
}

test('resolveProtocolUrl supports pack asset URLs and rejects traversal', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixel-pack-protocol-test-'));
  const library = new PixelPackLibrary(createApp(root));
  const expected = path.join(
    root,
    'pixel-packs',
    'com.otakuclaw.pixel.demo',
    '1.1.0',
    'assets',
    'backgrounds',
    'office.webp',
  );

  assert.equal(
    library.resolveProtocolUrl(
      'openclaw-pixel-pack:///com.otakuclaw.pixel.demo/1.1.0/assets/backgrounds/office.webp',
    ),
    expected,
  );
  assert.equal(
    library.resolveProtocolUrl(
      'openclaw-pixel-pack://com.otakuclaw.pixel.demo/1.1.0/assets/backgrounds/office.webp',
    ),
    expected,
  );

  assert.throws(
    () => library.resolveProtocolUrl('openclaw-pixel-pack://../outside.webp'),
    (error) => error && error.code === 'pixel_pack_invalid_path',
  );
});

test('validateZip rejects traversal entries before extraction', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixel-pack-validate-traversal-test-'));
  const library = new PixelPackLibrary(createApp(root));
  let extractCalled = false;

  library.listZipEntries = async () => ['../evil.txt'];
  library.extractZip = async () => {
    extractCalled = true;
  };

  await assert.rejects(
    () => library.validateZip(path.join(root, 'fixture.zip')),
    (error) => error && error.code === 'pixel_pack_invalid_archive',
  );
  assert.equal(extractCalled, false);
});

test('validateZip accepts a valid pack manifest and references', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixel-pack-validate-test-'));
  const library = new PixelPackLibrary(createApp(root));

  library.listZipEntries = async () => [
    'manifest.json',
    'assets/backgrounds/office.webp',
  ];
  library.extractZip = async (_zipPath, outputDir) => {
    await createImportedPackFixture(outputDir);
  };

  const validation = await library.validateZip(path.join(root, 'fixture.zip'));
  assert.equal(validation.ok, true);
  assert.equal(validation.valid, true);
  assert.equal(validation.pack.packId, 'com.otakuclaw.pixel.demo');
  assert.equal(validation.pack.version, '1.1.0');
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.pack.assetBaseUrl, 'openclaw-pixel-pack:///com.otakuclaw.pixel.demo/1.1.0/');
  assert.equal(validation.manifest.scene.backdrop.assetKey, 'bg.office.main');
});

test('validateZip accepts optional characters and anchors in the manifest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixel-pack-validate-characters-test-'));
  const library = new PixelPackLibrary(createApp(root));
  const characters = {
    star: {
      label: 'Star',
      stateSprites: {
        idle: {
          assetKey: 'bg.office.main',
        },
        writing: {
          assetKey: 'bg.office.main',
        },
      },
      anchors: {
        stand: {
          offsetY: 0,
        },
      },
    },
  };

  library.listZipEntries = async () => [
    'manifest.json',
    'assets/backgrounds/office.webp',
  ];
  library.extractZip = async (_zipPath, outputDir) => {
    await createImportedPackFixture(outputDir, { characters });
  };

  const validation = await library.validateZip(path.join(root, 'fixture.zip'));
  assert.equal(validation.ok, true);
  assert.equal(validation.valid, true);
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.manifest.characters.star.stateSprites.idle.assetKey, 'bg.office.main');
  assert.equal(validation.manifest.characters.star.anchors.stand.offsetY, 0);
});

test('validateZip rejects character stateSprites that reference missing assets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixel-pack-validate-characters-missing-asset-test-'));
  const library = new PixelPackLibrary(createApp(root));

  library.listZipEntries = async () => [
    'manifest.json',
    'assets/backgrounds/office.webp',
  ];
  library.extractZip = async (_zipPath, outputDir) => {
    await fs.mkdir(path.join(outputDir, 'assets', 'backgrounds'), { recursive: true });
    await fs.writeFile(
      path.join(outputDir, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        packId: 'com.otakuclaw.pixel.demo',
        name: 'Pixel Demo',
        version: '1.1.0',
        engine: '>=0.2.1',
        contractRevision: '1.1',
        assets: {
          'bg.office.main': {
            path: 'assets/backgrounds/office.webp',
            type: 'image',
          },
        },
        characters: {
          star: {
            stateSprites: {
              idle: {
                assetKey: 'missing.asset.key',
              },
            },
          },
        },
      }),
      'utf-8',
    );
    await fs.writeFile(path.join(outputDir, 'assets', 'backgrounds', 'office.webp'), 'fake-image', 'utf-8');
  };

  const validation = await library.validateZip(path.join(root, 'fixture.zip'));
  assert.equal(validation.valid, false);
  assert.equal(
    validation.errors.some(
      (error) => error.code === 'pixel_pack_missing_asset_reference'
        && error.path === 'characters.star.stateSprites.idle.assetKey',
    ),
    true,
  );
});

test('import activate remove list and export manage installed packs and active settings', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixel-pack-lifecycle-test-'));
  const settingsStore = createSettingsStoreStub();
  const library = new PixelPackLibrary(createApp(root), { settingsStore });
  const zipPath = path.join(root, 'fixture.zip');
  const exportPath = path.join(root, 'exported-pack.zip');
  const createdZipCalls = [];

  library.listZipEntries = async () => [
    'manifest.json',
    'assets/backgrounds/office.webp',
  ];
  library.extractZip = async (_zipPath, outputDir) => {
    await createImportedPackFixture(outputDir);
  };
  library.createZipArchive = async (sourceDir, destinationZipPath) => {
    createdZipCalls.push({ sourceDir, destinationZipPath });
    await fs.writeFile(destinationZipPath, `source:${sourceDir}`, 'utf-8');
  };

  const imported = await library.importZip(zipPath);
  assert.equal(imported.importedPack.packId, 'com.otakuclaw.pixel.demo');
  assert.equal(imported.importedPack.version, '1.1.0');
  await fs.stat(path.join(root, 'pixel-packs', 'com.otakuclaw.pixel.demo', '1.1.0'));

  const listing = await library.listPacks();
  assert.equal(listing.packs.length, 1);
  assert.equal(listing.packs[0].active, false);

  const activated = await library.activatePack('com.otakuclaw.pixel.demo', '1.1.0');
  assert.equal(activated.activePackId, 'com.otakuclaw.pixel.demo');
  assert.equal(settingsStore.state.ui.pixelPack.activePackId, 'com.otakuclaw.pixel.demo');
  assert.equal(settingsStore.state.ui.pixelPack.activeVersion, '1.1.0');

  const activeManifest = await library.getActiveManifest();
  assert.equal(activeManifest.found, true);
  assert.equal(activeManifest.pack.packId, 'com.otakuclaw.pixel.demo');

  const exported = await library.exportPack('com.otakuclaw.pixel.demo', '1.1.0', exportPath);
  assert.equal(exported.destinationPath, exportPath);
  assert.equal(createdZipCalls.length, 1);
  assert.equal(createdZipCalls[0].sourceDir, path.join(root, 'pixel-packs', 'com.otakuclaw.pixel.demo', '1.1.0'));

  const removed = await library.removePack('com.otakuclaw.pixel.demo', '1.1.0');
  assert.equal(removed.removedPackId, 'com.otakuclaw.pixel.demo');
  assert.equal(removed.removedVersion, '1.1.0');
  assert.equal(settingsStore.state.ui.pixelPack.activePackId, '');
  assert.equal(settingsStore.state.ui.pixelPack.activeVersion, '');

  const afterRemove = await library.getActiveManifest();
  assert.equal(afterRemove.found, false);
});
