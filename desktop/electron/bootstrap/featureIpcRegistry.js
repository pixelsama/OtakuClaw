const { registerOfficeStateIpc } = require('../ipc/officeState');
const { registerValueStateIpc } = require('../ipc/valueState');
const { registerLive2DModelsIpc } = require('../ipc/live2dModels');
const { registerPixelPacksIpc } = require('../ipc/pixelPacks');
const { registerStaticAvatarsIpc } = require('../ipc/staticAvatars');
const { registerAppUpdaterIpc } = require('../ipc/appUpdater');
const { registerNanobotSkillsIpc } = require('../ipc/nanobotSkills');
const { registerNanobotRuntimeIpc } = require('../ipc/nanobotRuntime');
const { registerAcpRunnerRuntimeIpc } = require('../ipc/acpRunnerRuntime');
const { registerSettingsIpc } = require('../ipc/settings');
const { registerScreenshotCaptureIpc } = require('../ipc/screenshotCapture');
const { registerVoiceModelsIpc } = require('../ipc/voiceModels');
const { registerModeIpc } = require('../window/modeIpc');

function registerFeatureIpcModules(context = {}) {
  const disposers = {};
  const {
    ipcMain,
    settingsStore,
    getWindow,
    backendManager,
    officeStateStore,
    officePresenceProducer,
    valueStateStore,
    valueProposalService,
    appUpdaterService,
    windowModeManager,
    onModeChanged,
    live2dModelLibrary,
    pixelPackLibrary,
    staticAvatarLibrary,
    screenshotCaptureService,
    screenshotSelectionService,
    nanobotRuntimeManager,
    acpRunnerRuntimeManager,
    nanobotSkillsLibrary,
    voiceModelLibrary,
    taskManager,
    emitNanobotProgress,
    emitAcpRunnerProgress,
    emitVoiceModelDownloadProgress,
    emitDownloadTaskProgress,
    onVoiceSelectionChanged,
  } = context;

  registerSettingsIpc({
    ipcMain,
    settingsStore,
    getWindow,
    backendManager,
  });

  disposers.officeState = registerOfficeStateIpc({
    ipcMain,
    officeStateStore,
    officePresenceProducer,
  });

  disposers.valueState = registerValueStateIpc({
    ipcMain,
    valueStateStore,
    valueProposalService,
  });

  disposers.appUpdater = registerAppUpdaterIpc({
    ipcMain,
    appUpdaterService,
  });

  disposers.mode = registerModeIpc({
    ipcMain,
    windowModeManager,
    onModeChanged,
  });

  disposers.live2dModels = registerLive2DModelsIpc({
    ipcMain,
    getWindow,
    modelLibrary: live2dModelLibrary,
  });

  disposers.pixelPacks = registerPixelPacksIpc({
    ipcMain,
    getWindow,
    pixelPackLibrary,
  });

  disposers.staticAvatars = registerStaticAvatarsIpc({
    ipcMain,
    getWindow,
    avatarLibrary: staticAvatarLibrary,
  });

  disposers.screenshotCapture = registerScreenshotCaptureIpc({
    ipcMain,
    getWindow,
    screenshotCaptureService,
    screenshotSelectionService,
  });

  disposers.nanobotRuntime = registerNanobotRuntimeIpc({
    ipcMain,
    nanobotRuntimeManager,
    emitProgress: emitNanobotProgress,
  });

  disposers.acpRunnerRuntime = registerAcpRunnerRuntimeIpc({
    ipcMain,
    acpRunnerRuntimeManager,
    settingsStore,
    emitProgress: emitAcpRunnerProgress,
  });

  disposers.nanobotSkills = registerNanobotSkillsIpc({
    ipcMain,
    getWindow,
    skillsLibrary: nanobotSkillsLibrary,
  });

  disposers.voiceModels = registerVoiceModelsIpc({
    ipcMain,
    voiceModelLibrary,
    emitDownloadProgress: emitVoiceModelDownloadProgress,
    emitTaskProgress: emitDownloadTaskProgress,
    taskManager,
    onSelectionChanged: onVoiceSelectionChanged,
  });

  return disposers;
}

function disposeFeatureIpcModules(disposers = {}) {
  for (const dispose of Object.values(disposers)) {
    if (typeof dispose === 'function') {
      dispose();
    }
  }
}

module.exports = {
  registerFeatureIpcModules,
  disposeFeatureIpcModules,
};
