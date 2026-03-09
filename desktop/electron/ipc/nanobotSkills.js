const { dialog, shell } = require('electron');

function toNanobotSkillsError(error) {
  if (error && typeof error === 'object') {
    return {
      code: error.code || 'nanobot_skills_unknown_error',
      message:
        typeof error.message === 'string' && error.message
          ? error.message
          : 'Nanobot skills request failed.',
    };
  }

  return {
    code: 'nanobot_skills_unknown_error',
    message: 'Nanobot skills request failed.',
  };
}

function registerNanobotSkillsIpc({
  ipcMain,
  getWindow,
  skillsLibrary,
  dialogModule = dialog,
  shellModule = shell,
}) {
  ipcMain.handle('nanobot-skills:list', async () => {
    try {
      const result = await skillsLibrary.listSkills();
      return {
        ok: true,
        ...result,
      };
    } catch (error) {
      return {
        ok: false,
        error: toNanobotSkillsError(error),
      };
    }
  });

  ipcMain.handle('nanobot-skills:import-zip', async () => {
    const browserWindow = getWindow?.();
    const result = await dialogModule.showOpenDialog(browserWindow || undefined, {
      title: '导入 Nanobot Skills ZIP',
      properties: ['openFile'],
      filters: [{ name: 'ZIP Files', extensions: ['zip'] }],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return {
        ok: false,
        canceled: true,
      };
    }

    try {
      const imported = await skillsLibrary.importZip(result.filePaths[0]);
      return {
        ok: true,
        imported: {
          skills: imported.importedSkills || [],
          count: Number.isFinite(imported.importedCount) ? imported.importedCount : 0,
        },
        libraryPath: imported.libraryPath || '',
        customSkills: imported.customSkills || [],
        builtinSkills: imported.builtinSkills || [],
      };
    } catch (error) {
      return {
        ok: false,
        error: toNanobotSkillsError(error),
      };
    }
  });

  ipcMain.handle('nanobot-skills:delete', async (_event, payload = {}) => {
    try {
      const deleted = await skillsLibrary.deleteSkill(payload.skillName || '');
      return {
        ok: true,
        deletedSkillName: deleted.deletedSkillName || '',
        libraryPath: deleted.libraryPath || '',
        customSkills: deleted.customSkills || [],
        builtinSkills: deleted.builtinSkills || [],
      };
    } catch (error) {
      return {
        ok: false,
        error: toNanobotSkillsError(error),
      };
    }
  });

  ipcMain.handle('nanobot-skills:open-library', async () => {
    const libraryPath = skillsLibrary.getRootDir();
    try {
      const openResult = await shellModule.openPath(libraryPath);
      if (openResult) {
        return {
          ok: false,
          error: {
            code: 'nanobot_skills_open_library_failed',
            message: openResult,
          },
        };
      }
      return {
        ok: true,
        path: libraryPath,
      };
    } catch (error) {
      return {
        ok: false,
        error: toNanobotSkillsError(error),
      };
    }
  });

  return () => {
    ipcMain.removeHandler('nanobot-skills:list');
    ipcMain.removeHandler('nanobot-skills:import-zip');
    ipcMain.removeHandler('nanobot-skills:delete');
    ipcMain.removeHandler('nanobot-skills:open-library');
  };
}

module.exports = {
  registerNanobotSkillsIpc,
};
