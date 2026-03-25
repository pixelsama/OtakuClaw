const assert = require('node:assert/strict');
const test = require('node:test');

const { registerPixelPacksIpc } = require('../ipc/pixelPacks');

function createIpcMainMock() {
  const handlers = new Map();

  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
    async invoke(channel, payload) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`Missing handler for ${channel}`);
      }
      return handler({}, payload);
    },
  };
}

test('pixel packs ipc delegates list/validate/import and uses dialogs when needed', async () => {
  const ipcMain = createIpcMainMock();
  const calls = [];
  const library = {
    settingsStore: {
      getForMain() {
        return {
          ui: {
            pixelPack: {
              activePackId: 'com.otakuclaw.pixel.demo',
              activeVersion: '1.1.0',
              overrides: {},
            },
          },
        };
      },
      getPublic() {
        return this.getForMain();
      },
    },
    async listPacks() {
      calls.push('list');
      return {
        libraryPath: '/tmp/pixel-packs',
        activePackId: '',
        activeVersion: '',
        packs: [],
      };
    },
    async validateZip(zipPath) {
      calls.push(`validate:${zipPath}`);
      return {
        ok: true,
        valid: true,
        errors: [],
        warnings: [],
        manifest: {
          schemaVersion: 1,
          packId: 'com.otakuclaw.pixel.demo',
          version: '1.1.0',
          engine: '>=0.2.1',
        },
        pack: {
          packId: 'com.otakuclaw.pixel.demo',
          version: '1.1.0',
          name: 'Pixel Demo',
          description: '',
          schemaVersion: 1,
          contractRevision: '1.1',
          engine: '>=0.2.1',
          assetCount: 1,
          assetBaseUrl: 'openclaw-pixel-pack:///com.otakuclaw.pixel.demo/1.1.0/',
        },
      };
    },
    async importZip(zipPath) {
      calls.push(`import:${zipPath}`);
      return {
        importedPack: {
          packId: 'com.otakuclaw.pixel.demo',
          version: '1.1.0',
          name: 'Pixel Demo',
        },
        validation: {
          ok: true,
          valid: true,
          errors: [],
          warnings: [],
          manifest: {},
          pack: {
            packId: 'com.otakuclaw.pixel.demo',
            version: '1.1.0',
            name: 'Pixel Demo',
          },
        },
        packs: [],
      };
    },
    async getActiveManifest() {
      calls.push('active-manifest');
      return {
        found: true,
        activePackId: 'com.otakuclaw.pixel.demo',
        activeVersion: '1.1.0',
        manifest: {},
        validation: {
          ok: true,
          valid: true,
          errors: [],
          warnings: [],
          manifest: {},
          pack: {
            packId: 'com.otakuclaw.pixel.demo',
            version: '1.1.0',
          },
        },
        pack: {
          packId: 'com.otakuclaw.pixel.demo',
          version: '1.1.0',
          assetBaseUrl: 'openclaw-pixel-pack:///com.otakuclaw.pixel.demo/1.1.0/',
        },
      };
    },
  };

  registerPixelPacksIpc({
    ipcMain,
    getWindow: () => null,
    pixelPackLibrary: library,
    dialogModule: {
      showOpenDialog: async () => ({
        canceled: false,
        filePaths: ['/tmp/pixel-pack.zip'],
      }),
      showSaveDialog: async () => ({
        canceled: false,
        filePath: '/tmp/exported-pixel-pack.zip',
      }),
    },
  });

  const listResult = await ipcMain.invoke('pixel-packs:list');
  assert.equal(listResult.ok, true);
  assert.equal(listResult.libraryPath, '/tmp/pixel-packs');

  const validateResult = await ipcMain.invoke('pixel-packs:validate', {});
  assert.equal(validateResult.ok, true);
  assert.equal(validateResult.zipPath, '/tmp/pixel-pack.zip');
  assert.equal(validateResult.validation.valid, true);

  const importResult = await ipcMain.invoke('pixel-packs:import-zip', {});
  assert.equal(importResult.ok, true);
  assert.equal(importResult.zipPath, '/tmp/pixel-pack.zip');
  assert.equal(importResult.importedPack.packId, 'com.otakuclaw.pixel.demo');

  const activeManifestResult = await ipcMain.invoke('pixel-packs:get-active-manifest');
  assert.equal(activeManifestResult.ok, true);
  assert.equal(activeManifestResult.found, true);
  assert.equal(activeManifestResult.activePackId, 'com.otakuclaw.pixel.demo');

  assert.deepEqual(calls, [
    'list',
    'validate:/tmp/pixel-pack.zip',
    'import:/tmp/pixel-pack.zip',
    'active-manifest',
  ]);
});

test('pixel packs ipc uses active selection for remove/export and maps invalid targets', async () => {
  const ipcMain = createIpcMainMock();
  const calls = [];
  const library = {
    settingsStore: {
      getForMain() {
        return {
          ui: {
            pixelPack: {
              activePackId: 'com.otakuclaw.pixel.demo',
              activeVersion: '1.1.0',
              overrides: {},
            },
          },
        };
      },
      getPublic() {
        return this.getForMain();
      },
    },
    async activatePack(packId, version) {
      calls.push(`activate:${packId}:${version}`);
      return {
        activePackId: packId,
        activeVersion: version,
        manifest: {},
        validation: {
          ok: true,
          valid: true,
          errors: [],
          warnings: [],
          manifest: {},
          pack: {
            packId,
            version,
          },
        },
        pack: {
          packId,
          version,
          assetBaseUrl: `openclaw-pixel-pack:///${packId}/${version}/`,
        },
        settings: {},
      };
    },
    async removePack(packId, version) {
      calls.push(`remove:${packId}:${version}`);
      return {
        removedPackId: packId,
        removedVersion: version,
        packs: [],
        settings: {},
      };
    },
    async exportPack(packId, version, destinationPath) {
      calls.push(`export:${packId}:${version}:${destinationPath}`);
      return {
        ok: true,
        destinationPath,
        pack: {
          packId,
          version,
          assetBaseUrl: `openclaw-pixel-pack:///${packId}/${version}/`,
        },
      };
    },
  };

  registerPixelPacksIpc({
    ipcMain,
    getWindow: () => null,
    pixelPackLibrary: library,
    dialogModule: {
      showOpenDialog: async () => {
        throw new Error('should not open');
      },
      showSaveDialog: async () => ({
        canceled: false,
        filePath: '/tmp/exported-pixel-pack.zip',
      }),
    },
  });

  const activateResult = await ipcMain.invoke('pixel-packs:activate', {
    packId: 'com.otakuclaw.pixel.demo',
    version: '1.1.0',
  });
  assert.equal(activateResult.ok, true);

  const removeResult = await ipcMain.invoke('pixel-packs:remove', {});
  assert.equal(removeResult.ok, true);
  assert.equal(removeResult.removedPackId, 'com.otakuclaw.pixel.demo');

  const exportResult = await ipcMain.invoke('pixel-packs:export-zip', {});
  assert.equal(exportResult.ok, true);
  assert.equal(exportResult.destinationPath, '/tmp/exported-pixel-pack.zip');

  const invalidTargetResult = await ipcMain.invoke('pixel-packs:activate', {});
  assert.equal(invalidTargetResult.ok, false);
  assert.equal(invalidTargetResult.error.code, 'pixel_pack_invalid_target');

  assert.deepEqual(calls, [
    'activate:com.otakuclaw.pixel.demo:1.1.0',
    'remove:com.otakuclaw.pixel.demo:1.1.0',
    'export:com.otakuclaw.pixel.demo:1.1.0:/tmp/exported-pixel-pack.zip',
  ]);
});

test('pixel packs ipc validate supports explicit installed pack target', async () => {
  const ipcMain = createIpcMainMock();
  const calls = [];
  const library = {
    settingsStore: {
      getForMain() {
        return {
          ui: {
            pixelPack: {
              activePackId: '',
              activeVersion: '',
              overrides: {},
            },
          },
        };
      },
    },
    async validatePack(packId, version) {
      calls.push(`validate-pack:${packId}:${version}`);
      return {
        ok: true,
        valid: true,
        errors: [],
        warnings: [],
        manifest: {},
        pack: {
          packId,
          version,
          name: 'Pixel Demo',
          description: '',
          schemaVersion: 1,
          contractRevision: '1.1',
          engine: '>=0.2.1',
          assetCount: 1,
          assetBaseUrl: `openclaw-pixel-pack:///${packId}/${version}/`,
        },
      };
    },
  };

  registerPixelPacksIpc({
    ipcMain,
    getWindow: () => null,
    pixelPackLibrary: library,
    dialogModule: {
      showOpenDialog: async () => {
        throw new Error('should not open');
      },
    },
  });

  const result = await ipcMain.invoke('pixel-packs:validate', {
    packId: 'com.otakuclaw.pixel.demo',
    version: '1.1.0',
  });
  assert.equal(result.ok, true);
  assert.equal(result.validation.valid, true);
  assert.deepEqual(calls, ['validate-pack:com.otakuclaw.pixel.demo:1.1.0']);
});
