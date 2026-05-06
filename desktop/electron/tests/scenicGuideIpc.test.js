const assert = require('node:assert/strict');
const test = require('node:test');

const { registerScenicGuideIpc } = require('../ipc/scenicGuide');

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
    hasHandler(channel) {
      return handlers.has(channel);
    },
  };
}

test('scenic guide ipc exposes manifest, import summary, and knowledge queries', async () => {
  const ipcMain = createIpcMainMock();
  const calls = [];

  const dispose = registerScenicGuideIpc({
    ipcMain,
    officialDataManifestStore: {
      getManifest() {
        calls.push('getManifest');
        return {
          datasetId: 'official-lingshan-2026',
          scenicId: 'lingshan',
          importSummary: { spotCount: 22 },
        };
      },
    },
    officialDataImporter: {
      inspectDataDirectory(request) {
        calls.push(['inspect', request]);
        return { ok: true, dataDirectory: request.directoryPath };
      },
      importOfficialData(request) {
        calls.push(['import', request]);
        return { ok: true, importSummary: { spotCount: 22 } };
      },
    },
    scenicKnowledgeStore: {
      getSummary() {
        calls.push('getSummary');
        return { knowledgeBlockCount: 94 };
      },
      listSpots(request) {
        calls.push(['spots', request]);
        return [{ spotId: 'LS-011' }];
      },
      listRoutes(request) {
        calls.push(['routes', request]);
        return [{ routeId: 'official-family-4h' }];
      },
      listKnowledgeBlocks(request) {
        calls.push(['blocks', request]);
        return [{ blockId: 'official:spot:LS-011' }];
      },
    },
    scenicRagService: {
      askQuestion(request) {
        calls.push(['ask', request]);
        return {
          ok: true,
          answer: '根据官方资料，灵山大佛是景区标志性景观。',
          sources: [{ blockId: 'official:spot:LS-011' }],
        };
      },
    },
  });

  assert.equal((await ipcMain.invoke('scenic-guide:get-manifest')).manifest.datasetId, 'official-lingshan-2026');
  assert.deepEqual(await ipcMain.invoke('scenic-guide:get-import-summary'), {
    ok: true,
    importSummary: { spotCount: 22 },
    knowledgeSummary: { knowledgeBlockCount: 94 },
  });
  assert.deepEqual(await ipcMain.invoke('scenic-guide:get-knowledge-summary'), {
    ok: true,
    knowledgeSummary: { knowledgeBlockCount: 94 },
  });
  assert.deepEqual(await ipcMain.invoke('scenic-guide:list-spots', { query: '灵山大佛' }), {
    ok: true,
    spots: [{ spotId: 'LS-011' }],
  });
  assert.deepEqual(await ipcMain.invoke('scenic-guide:list-routes', { query: '亲子' }), {
    ok: true,
    routes: [{ routeId: 'official-family-4h' }],
  });
  assert.deepEqual(await ipcMain.invoke('scenic-guide:list-knowledge-blocks', { query: '灵山大佛' }), {
    ok: true,
    knowledgeBlocks: [{ blockId: 'official:spot:LS-011' }],
  });
  assert.deepEqual(await ipcMain.invoke('scenic-guide:ask-question', { question: '灵山大佛有什么特色？' }), {
    ok: true,
    answer: '根据官方资料，灵山大佛是景区标志性景观。',
    sources: [{ blockId: 'official:spot:LS-011' }],
  });

  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === 'spots'));
  dispose();
  assert.equal(ipcMain.hasHandler('scenic-guide:list-spots'), false);
  assert.equal(ipcMain.hasHandler('scenic-guide:ask-question'), false);
});

test('scenic guide ipc maps knowledge store errors to safe errors', async () => {
  const ipcMain = createIpcMainMock();

  registerScenicGuideIpc({
    ipcMain,
    officialDataImporter: {},
    scenicKnowledgeStore: {
      listSpots() {
        const error = new Error('store unavailable');
        error.code = 'knowledge_store_unavailable';
        throw error;
      },
    },
  });

  const result = await ipcMain.invoke('scenic-guide:list-spots', {});
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'knowledge_store_unavailable');
});
