function toScenicGuideIpcError(error) {
  if (error && typeof error === 'object') {
    return {
      code: error.code || 'scenic_guide_ipc_error',
      message:
        typeof error.message === 'string' && error.message
          ? error.message
          : 'Scenic guide IPC request failed.',
    };
  }

  return {
    code: 'scenic_guide_ipc_error',
    message: 'Scenic guide IPC request failed.',
  };
}

function registerScenicGuideIpc({
  ipcMain,
  dialog,
  getWindow,
  officialDataManifestStore,
  officialDataImporter,
  scenicKnowledgeStore,
  scenicRagService,
} = {}) {
  if (!ipcMain) {
    return () => {};
  }

  ipcMain.handle('scenic-guide:get-manifest', async () => {
    try {
      return {
        ok: true,
        manifest: officialDataManifestStore?.getManifest?.() || null,
      };
    } catch (error) {
      return {
        ok: false,
        error: toScenicGuideIpcError(error),
      };
    }
  });

  ipcMain.handle('scenic-guide:pick-data-directory', async () => {
    try {
      if (!dialog || typeof dialog.showOpenDialog !== 'function') {
        return {
          ok: false,
          error: {
            code: 'dialog_unavailable',
            message: 'Directory picker is unavailable.',
          },
        };
      }

      const result = await dialog.showOpenDialog(getWindow?.() || undefined, {
        title: '选择灵山胜境官方资料包目录',
        properties: ['openDirectory'],
      });

      if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
        return {
          ok: false,
          canceled: true,
        };
      }

      return {
        ok: true,
        directoryPath: result.filePaths[0],
      };
    } catch (error) {
      return {
        ok: false,
        error: toScenicGuideIpcError(error),
      };
    }
  });

  ipcMain.handle('scenic-guide:inspect-data-directory', async (_event, request = {}) => {
    try {
      return officialDataImporter.inspectDataDirectory(request);
    } catch (error) {
      return {
        ok: false,
        error: toScenicGuideIpcError(error),
      };
    }
  });

  ipcMain.handle('scenic-guide:import-official-data', async (_event, request = {}) => {
    try {
      return officialDataImporter.importOfficialData(request);
    } catch (error) {
      return {
        ok: false,
        error: toScenicGuideIpcError(error),
      };
    }
  });

  ipcMain.handle('scenic-guide:get-import-summary', async () => {
    try {
      const manifest = officialDataManifestStore?.getManifest?.() || null;
      return {
        ok: true,
        importSummary: manifest?.importSummary || null,
        knowledgeSummary:
          scenicKnowledgeStore && typeof scenicKnowledgeStore.getSummary === 'function'
            ? scenicKnowledgeStore.getSummary()
            : manifest?.knowledgeSummary || null,
      };
    } catch (error) {
      return {
        ok: false,
        error: toScenicGuideIpcError(error),
      };
    }
  });

  ipcMain.handle('scenic-guide:get-knowledge-summary', async () => {
    try {
      return {
        ok: true,
        knowledgeSummary:
          scenicKnowledgeStore && typeof scenicKnowledgeStore.getSummary === 'function'
            ? scenicKnowledgeStore.getSummary()
            : null,
      };
    } catch (error) {
      return {
        ok: false,
        error: toScenicGuideIpcError(error),
      };
    }
  });

  ipcMain.handle('scenic-guide:list-spots', async (_event, request = {}) => {
    try {
      return {
        ok: true,
        spots:
          scenicKnowledgeStore && typeof scenicKnowledgeStore.listSpots === 'function'
            ? scenicKnowledgeStore.listSpots(request)
            : [],
      };
    } catch (error) {
      return {
        ok: false,
        error: toScenicGuideIpcError(error),
      };
    }
  });

  ipcMain.handle('scenic-guide:list-routes', async (_event, request = {}) => {
    try {
      return {
        ok: true,
        routes:
          scenicKnowledgeStore && typeof scenicKnowledgeStore.listRoutes === 'function'
            ? scenicKnowledgeStore.listRoutes(request)
            : [],
      };
    } catch (error) {
      return {
        ok: false,
        error: toScenicGuideIpcError(error),
      };
    }
  });

  ipcMain.handle('scenic-guide:list-knowledge-blocks', async (_event, request = {}) => {
    try {
      return {
        ok: true,
        knowledgeBlocks:
          scenicKnowledgeStore && typeof scenicKnowledgeStore.listKnowledgeBlocks === 'function'
            ? scenicKnowledgeStore.listKnowledgeBlocks(request)
            : [],
      };
    } catch (error) {
      return {
        ok: false,
        error: toScenicGuideIpcError(error),
      };
    }
  });

  ipcMain.handle('scenic-guide:ask-question', async (_event, request = {}) => {
    try {
      if (!scenicRagService || typeof scenicRagService.askQuestion !== 'function') {
        return {
          ok: false,
          error: {
            code: 'scenic_rag_unavailable',
            message: 'Scenic guide question answering is unavailable.',
          },
        };
      }

      return scenicRagService.askQuestion(request);
    } catch (error) {
      return {
        ok: false,
        error: toScenicGuideIpcError(error),
      };
    }
  });

  return () => {
    ipcMain.removeHandler('scenic-guide:get-manifest');
    ipcMain.removeHandler('scenic-guide:pick-data-directory');
    ipcMain.removeHandler('scenic-guide:inspect-data-directory');
    ipcMain.removeHandler('scenic-guide:import-official-data');
    ipcMain.removeHandler('scenic-guide:get-import-summary');
    ipcMain.removeHandler('scenic-guide:get-knowledge-summary');
    ipcMain.removeHandler('scenic-guide:list-spots');
    ipcMain.removeHandler('scenic-guide:list-routes');
    ipcMain.removeHandler('scenic-guide:list-knowledge-blocks');
    ipcMain.removeHandler('scenic-guide:ask-question');
  };
}

module.exports = {
  registerScenicGuideIpc,
  toScenicGuideIpcError,
};
