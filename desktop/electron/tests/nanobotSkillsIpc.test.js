const assert = require('node:assert/strict');
const test = require('node:test');

const { registerNanobotSkillsIpc } = require('../ipc/nanobotSkills');

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

test('nanobot skills ipc list delegates to skills library', async () => {
  const ipcMain = createIpcMainMock();
  const skillsLibrary = {
    listSkills: async () => ({
      libraryPath: '/tmp/nanobot-skills',
      customSkills: [{ skillName: 'weather' }],
      builtinSkills: [{ skillName: 'memory' }],
    }),
    importZip: async () => {
      throw new Error('should not call');
    },
    deleteSkill: async () => {
      throw new Error('should not call');
    },
    getRootDir: () => '/tmp/nanobot-skills',
  };

  registerNanobotSkillsIpc({
    ipcMain,
    skillsLibrary,
  });

  const result = await ipcMain.invoke('nanobot-skills:list');
  assert.equal(result.ok, true);
  assert.equal(result.libraryPath, '/tmp/nanobot-skills');
  assert.equal(result.customSkills.length, 1);
  assert.equal(result.builtinSkills.length, 1);
});

test('nanobot skills ipc import-zip returns canceled when user aborts dialog', async () => {
  const ipcMain = createIpcMainMock();
  const skillsLibrary = {
    listSkills: async () => ({ customSkills: [], builtinSkills: [], libraryPath: '' }),
    importZip: async () => {
      throw new Error('should not call');
    },
    deleteSkill: async () => {
      throw new Error('should not call');
    },
    getRootDir: () => '/tmp/nanobot-skills',
  };

  registerNanobotSkillsIpc({
    ipcMain,
    skillsLibrary,
    dialogModule: {
      showOpenDialog: async () => ({
        canceled: true,
        filePaths: [],
      }),
    },
  });

  const result = await ipcMain.invoke('nanobot-skills:import-zip');
  assert.equal(result.ok, false);
  assert.equal(result.canceled, true);
});

test('nanobot skills ipc delete delegates and returns refreshed listing', async () => {
  const ipcMain = createIpcMainMock();
  const skillsLibrary = {
    listSkills: async () => ({ customSkills: [], builtinSkills: [], libraryPath: '/tmp/nanobot-skills' }),
    importZip: async () => ({ importedCount: 0, importedSkills: [] }),
    deleteSkill: async (name) => ({
      deletedSkillName: name,
      libraryPath: '/tmp/nanobot-skills',
      customSkills: [],
      builtinSkills: [{ skillName: 'memory' }],
    }),
    getRootDir: () => '/tmp/nanobot-skills',
  };

  registerNanobotSkillsIpc({
    ipcMain,
    skillsLibrary,
  });

  const result = await ipcMain.invoke('nanobot-skills:delete', { skillName: 'weather' });
  assert.equal(result.ok, true);
  assert.equal(result.deletedSkillName, 'weather');
  assert.equal(result.builtinSkills.length, 1);
});

test('nanobot skills ipc open-library delegates to shell', async () => {
  const ipcMain = createIpcMainMock();
  const skillsLibrary = {
    listSkills: async () => ({ customSkills: [], builtinSkills: [], libraryPath: '/tmp/nanobot-skills' }),
    importZip: async () => ({ importedCount: 0, importedSkills: [] }),
    deleteSkill: async () => ({ customSkills: [], builtinSkills: [], libraryPath: '/tmp/nanobot-skills' }),
    getRootDir: () => '/tmp/nanobot-skills',
  };
  let openedPath = '';

  registerNanobotSkillsIpc({
    ipcMain,
    skillsLibrary,
    shellModule: {
      openPath: async (targetPath) => {
        openedPath = targetPath;
        return '';
      },
    },
  });

  const result = await ipcMain.invoke('nanobot-skills:open-library');
  assert.equal(result.ok, true);
  assert.equal(openedPath, '/tmp/nanobot-skills');
});
