const assert = require('node:assert/strict');
const test = require('node:test');

const { registerStaticAvatarsIpc } = require('../ipc/staticAvatars');

function createIpcMainMock() {
  const handlers = new Map();

  return {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    async invoke(channel, payload) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`Missing handler for ${channel}`);
      }
      return handler({}, payload);
    },
    removeHandler(channel) {
      handlers.delete(channel);
    },
  };
}

test('static-avatars:list returns packs', async () => {
  const ipcMain = createIpcMainMock();
  registerStaticAvatarsIpc({
    ipcMain,
    avatarLibrary: {
      listPacks: async () => [{ packId: 'demo', name: 'Demo' }],
    },
  });

  const result = await ipcMain.invoke('static-avatars:list');
  assert.equal(result.ok, true);
  assert.equal(result.packs.length, 1);
  assert.equal(result.packs[0].packId, 'demo');
});

test('static-avatars:import-zip handles library errors', async () => {
  const ipcMain = createIpcMainMock();

  registerStaticAvatarsIpc({
    ipcMain,
    avatarLibrary: {
      importZip: async () => {
        const error = new Error('broken manifest');
        error.code = 'static_avatar_invalid_manifest';
        throw error;
      },
    },
    dialogModule: {
      showOpenDialog: async () => ({
        canceled: false,
        filePaths: ['/tmp/demo.zip'],
      }),
    },
  });

  const result = await ipcMain.invoke('static-avatars:import-zip');
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'static_avatar_invalid_manifest');
});

test('static-avatars:remove forwards packId payload', async () => {
  const ipcMain = createIpcMainMock();
  let receivedPackId = '';

  registerStaticAvatarsIpc({
    ipcMain,
    avatarLibrary: {
      removePack: async (packId) => {
        receivedPackId = packId;
        return {
          removedPackId: packId,
          packs: [],
        };
      },
    },
  });

  const result = await ipcMain.invoke('static-avatars:remove', { packId: 'demo-pack' });
  assert.equal(receivedPackId, 'demo-pack');
  assert.equal(result.ok, true);
  assert.equal(result.removedPackId, 'demo-pack');
});
