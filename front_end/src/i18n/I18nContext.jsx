import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const LANGUAGE_STORAGE_KEY = 'app.language';
export const LANGUAGE_ZH_CN = 'zh-CN';
export const LANGUAGE_EN_US = 'en-US';

const SUPPORTED_LANGUAGES = [LANGUAGE_ZH_CN, LANGUAGE_EN_US];

const MESSAGES = {
  [LANGUAGE_ZH_CN]: {
    'language.label': '语言',
    'language.zh': '中文',
    'language.en': 'English',

    'common.requestFailed': '请求失败，请稍后重试。',
    'common.sendFailed': '发送失败，请稍后重试。',
    'common.countItems': '{count} 个',
    'common.cancel': '取消',
    'common.close': '关闭',
    'common.delete': '删除',
    'common.enabled': '启用',
    'common.disabled': '禁用',
    'common.auto': '自动',

    'error.openclawMissingConfig': '请先填写 OpenClaw Base URL / Token / Agent ID。',
    'error.openclawUnreachable': '无法访问 OpenClaw。',
    'error.nanobotNotEnabled': 'Nanobot 当前处于禁用状态，请先切换为启用。',
    'error.nanobotMissingConfig': '请先完善 Nanobot 配置（Provider / Model / API Key）。',
    'error.nanobotRuntimeNotReady': 'Nanobot 运行时未就绪。',
    'error.nanobotBootFailed': 'Nanobot 启动失败。',
    'error.nanobotProviderUnavailable': 'Nanobot Provider 不可用。',
    'error.nanobotModelCallFailed': 'Nanobot 模型调用失败。',
    'error.nanobotUnreachable': '无法访问 Nanobot。',
    'error.streamRequestFailed': '流式接口请求失败: {status}',

    'app.settingsPanel': '设置面板',
    'app.modelLoaded': '模型已加载',
    'app.tab.live2d': 'Live2D 控制面板',
    'app.tab.chatBackend': '聊天后端设置',
    'app.tab.voice': '语音设置',
    'app.tab.preferences': '偏好设置',
    'app.chatBackendSelector': '聊天后端',
    'app.backend.openclaw': 'OpenClaw',
    'app.backend.nanobot': 'Nanobot',
    'app.nanobotEnabled': '启用 Nanobot',
    'app.nanobotWorkspace': 'Nanobot Workspace',
    'app.nanobotProvider': 'Nanobot Provider',
    'app.nanobotModel': 'Nanobot Model',
    'app.nanobotApiBase': 'Nanobot API Base',
    'app.nanobotApiKey': 'Nanobot API Key',
    'app.nanobotClearApiKey': '清除已保存 API Key',
    'app.nanobotMaxTokens': 'Nanobot Max Tokens',
    'app.nanobotTemperature': 'Nanobot Temperature',
    'app.nanobotReasoningEffort': 'Nanobot Reasoning Effort',
    'app.nanobotRuntimeMissing': '未检测到 Nanobot 运行时，请先下载后再联调。',
    'app.nanobotRuntimeInstall': '下载运行时',
    'app.nanobotRuntimeInstalling': '下载中...',
    'app.nanobotRuntimeReady': 'Nanobot 运行时已就绪：{path}',
    'app.nanobotRuntimeInstalled': 'Nanobot 运行时安装完成。',
    'download.defaultTitle': '下载任务',
    'download.voiceModelsTitle': '语音模型下载与安装',
    'download.nanobotRuntimeTitle': 'Nanobot 运行时下载与安装',
    'download.preparing': '准备中...',
    'download.eta': '预计剩余',
    'download.waitingStats': '正在获取下载大小与速度信息...',
    'download.noLogs': '暂无日志。',
    'download.showDetails': '详情',
    'download.hideDetails': '收起详情',
    'download.backgroundContinue': '后台继续',
    'app.webModeWarning': '当前为 Web 模式，Token 会存入浏览器本地存储，仅建议用于开发测试。',
    'app.keychainWarning': '系统密钥链不可用，Token 将回退为本地明文存储。',
    'app.tokenSavedPlaceholder': '已保存（留空表示不修改）',
    'app.saveSettings': '保存设置',
    'app.savingSettings': '保存中...',
    'app.connectionTest': '连接测试',
    'app.testingConnection': '测试中...',
    'app.clearToken': '清除 Token',
    'app.settingsSaved': '聊天后端配置已保存。',
    'app.settingsConnected': '连接成功{latency}',
    'app.settingsConnectedAutoSaved': '连接成功{latency}，配置已自动保存。',
    'app.latency': '（{latency}ms）',
    'app.tokenCleared': '已清除保存的 Token。',
    'preferences.title': '偏好设置',
    'preferences.language': '语言',
    'preferences.theme': '主题',
    'preferences.theme.light': '浅色',
    'preferences.theme.dark': '深色',
    'preferences.theme.system': '跟随系统',
    'voice.title': '语音设置',
    'voice.phase0Hint': '语音链路目前为 Phase 0 骨架，下一步将接入 AudioWorklet + 模型 VAD + ASR/TTS provider。',
    'voice.vadHint': '当前使用 Silero VAD 进行自动分段：检测到语音结束后会自动上传分片并触发 commit。',
    'voice.desktopOnly': '语音能力仅在桌面端可用。',
    'voice.liveCaptureHint': '当前会话会实时采集麦克风 PCM（16kHz/20ms 帧），点击“提交输入”后触发 ASR commit。',
    'voice.status': '状态',
    'voice.captureOn': '采集中',
    'voice.captureOff': '未采集',
    'voice.sessionId': 'Session ID',
    'voice.sessionIdPlaceholder': '尚未开始会话',
    'voice.permission': '麦克风权限',
    'voice.vadModel': 'VAD 模型',
    'voice.vadLoading': 'VAD 加载中',
    'voice.vadListening': 'VAD 监听中',
    'voice.vadSpeaking': '检测到语音',
    'voice.vadStopped': 'VAD 已停止',
    'voice.flowControl': '播放流控',
    'voice.capturedFrames': '已采集帧数',
    'voice.startSession': '开始会话',
    'voice.commitInput': '提交输入',
    'voice.stopSession': '停止会话',
    'voice.stopTts': '停止 TTS',
    'voice.partialText': 'ASR Partial',
    'voice.finalText': 'ASR Final',
    'voice.empty': '（空）',
    'voice.interactionMode': '交互模式',
    'voice.defaultFormat': '默认音频格式',
    'voice.mode.vad': '自动 VAD',

    'main.openSettings': '打开设置',
    'main.switchToPetMode': '切换到桌宠模式',

    'pet.switchToWindowMode': '切换到主窗口模式',
    'pet.lockedTitle': '已锁定（点击解锁）',
    'pet.unlockedTitle': '未锁定（点击锁定）',

    'composer.placeholder': '输入你想让她说的话...',
    'composer.sendTextTitle': '发送文字消息',
    'composer.voiceEnableTitle': '开启语音输入',
    'composer.voiceDisableTitle': '关闭语音输入',
    'composer.emptyInput': '请输入要发送的内容。',
    'composer.collapse': '收起',
    'composer.send': '发送',
    'composer.stop': '停止',

    'model.status.loaded': '模型已加载',
    'model.status.loading': '加载中',
    'model.status.unloaded': '未加载模型',

    'modelSettings.title': '模型设置',
    'modelSettings.importing': '导入中...',
    'modelSettings.importZip': '导入模型 ZIP',
    'modelSettings.modelLabel': '模型',
    'modelSettings.noModels': '暂无可用模型，请先导入 ZIP',
    'modelSettings.zipHint': '支持包含 `.model3.json` 的 Live2D 模型压缩包。',
    'modelSettings.scale': '模型缩放: {scale}',
    'modelSettings.autoEyeBlink': '自动眨眼',
    'modelSettings.autoBreath': '自动呼吸',
    'modelSettings.eyeTracking': '眼神跟随',
    'modelSettings.reset': '重置模型',

    'motion.title': '动作控制',
    'motion.manualInput': '手动输入动作文件名（可选）',
    'motion.manualPlaceholder': '留空可自动解析 model3.json；或每行一个文件名，例如:\nidle_01\ntap_body_01',
    'motion.parse': '自动解析（model3.json）/手动解析',
    'motion.parsing': '解析中...',
    'motion.availableFiles': '可用动作文件',
    'motion.newName': '新动作名称',
    'motion.add': '添加动作',
    'motion.upload': '上传动作文件',
    'motion.clearFile': '清除文件',
    'motion.linked': '已关联: {fileName}',
    'motion.play': '播放',
    'motion.clickArea': '点击区域',

    'expression.title': '表情控制',
    'expression.manualInput': '手动输入表情文件名（可选）',
    'expression.manualPlaceholder': '留空可自动解析 model3.json；或每行一个文件名，例如:\nsmile_01\nangry_01',
    'expression.parse': '自动解析（model3.json）/手动解析',
    'expression.parsing': '解析中...',
    'expression.availableFiles': '可用表情文件',
    'expression.newName': '新表情名称',
    'expression.add': '添加表情',
    'expression.upload': '上传表情文件',
    'expression.clearFile': '清除文件',
    'expression.linked': '已关联: {fileName}',
    'expression.apply': '应用',
    'expression.clickArea': '点击区域',

    'preset.title': '预设管理',
    'preset.name': '预设名称',
    'preset.save': '保存预设',
    'preset.import': '导入预设',
    'preset.empty': '暂无已保存预设',
    'preset.load': '加载',
    'preset.export': '导出',
    'preset.delete': '删除',
    'preset.unknownModel': '未知模型',

    'background.title': '背景控制',
    'background.upload': '上传背景',
    'background.clearCurrent': '清除当前背景',
    'background.opacity': '背景透明度: {opacity}%',
    'background.cached': '缓存背景 ({count})',
    'background.clearCache': '清空缓存',
    'background.apply': '应用',
    'background.delete': '删除',

    'live2d.loadingModel': '加载Live2D模型中...',
    'live2d.noModelSelected': '请先在控制面板导入并选择模型 ZIP',

    'controls.unsupportedModelImport': '当前环境不支持模型库导入。',
    'controls.loadModelLibraryFailed': '读取模型库失败，请重启后重试。',
    'controls.noModelHint': '尚未导入模型，请先导入 Live2D 模型 ZIP。',
    'controls.statusChip': '{status}',
    'controls.motionLabel': '动作',
    'controls.expressionLabel': '表情',
    'controls.clickAreaDialogTitle': '设置点击区域关联',
    'controls.clickAreaSelect': '选择点击区域（可多选）',
    'controls.clickAreaSelected': '已选择区域',
    'controls.clickAreaConflict': '区域冲突提醒',
    'controls.clickAreaConflictItem': '{areaName} 已被关联: {items}',
    'controls.clearAssociation': '取消关联',
    'controls.confirmAssociation': '确定关联 ({count} 个区域)',
    'controls.presetDeleteConfirm': '确定要删除预设 "{name}" 吗？',
    'controls.invalidPresetFile': '无效的预设文件格式',
    'controls.presetExistsOverwrite': '预设 "{name}" 已存在，是否覆盖？',
    'controls.presetFormatError': '预设文件格式错误',
    'controls.defaultPresetModel': '未知模型',
  },
  [LANGUAGE_EN_US]: {
    'language.label': 'Language',
    'language.zh': '中文',
    'language.en': 'English',

    'common.requestFailed': 'Request failed. Please try again later.',
    'common.sendFailed': 'Send failed. Please try again later.',
    'common.countItems': '{count} items',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.delete': 'Delete',
    'common.enabled': 'Enabled',
    'common.disabled': 'Disabled',
    'common.auto': 'Auto',

    'error.openclawMissingConfig': 'Please fill OpenClaw Base URL / Token / Agent ID first.',
    'error.openclawUnreachable': 'Unable to reach OpenClaw.',
    'error.nanobotNotEnabled': 'Nanobot is currently disabled. Enable it first.',
    'error.nanobotMissingConfig': 'Please complete Nanobot settings (Provider / Model / API Key).',
    'error.nanobotRuntimeNotReady': 'Nanobot runtime is not ready.',
    'error.nanobotBootFailed': 'Nanobot failed to boot.',
    'error.nanobotProviderUnavailable': 'Nanobot provider is unavailable.',
    'error.nanobotModelCallFailed': 'Nanobot model call failed.',
    'error.nanobotUnreachable': 'Unable to reach Nanobot.',
    'error.streamRequestFailed': 'Streaming request failed: {status}',

    'app.settingsPanel': 'Settings Panel',
    'app.modelLoaded': 'Model Loaded',
    'app.tab.live2d': 'Live2D Control Panel',
    'app.tab.chatBackend': 'Chat Backend',
    'app.tab.voice': 'Voice',
    'app.tab.preferences': 'Preferences',
    'app.chatBackendSelector': 'Chat Backend',
    'app.backend.openclaw': 'OpenClaw',
    'app.backend.nanobot': 'Nanobot',
    'app.nanobotEnabled': 'Enable Nanobot',
    'app.nanobotWorkspace': 'Nanobot Workspace',
    'app.nanobotProvider': 'Nanobot Provider',
    'app.nanobotModel': 'Nanobot Model',
    'app.nanobotApiBase': 'Nanobot API Base',
    'app.nanobotApiKey': 'Nanobot API Key',
    'app.nanobotClearApiKey': 'Clear Saved API Key',
    'app.nanobotMaxTokens': 'Nanobot Max Tokens',
    'app.nanobotTemperature': 'Nanobot Temperature',
    'app.nanobotReasoningEffort': 'Nanobot Reasoning Effort',
    'app.nanobotRuntimeMissing': 'Nanobot runtime is missing. Download it before testing.',
    'app.nanobotRuntimeInstall': 'Download Runtime',
    'app.nanobotRuntimeInstalling': 'Downloading...',
    'app.nanobotRuntimeReady': 'Nanobot runtime ready: {path}',
    'app.nanobotRuntimeInstalled': 'Nanobot runtime installed.',
    'download.defaultTitle': 'Download Task',
    'download.voiceModelsTitle': 'Voice Model Download & Install',
    'download.nanobotRuntimeTitle': 'Nanobot Runtime Download & Install',
    'download.preparing': 'Preparing...',
    'download.eta': 'ETA',
    'download.waitingStats': 'Collecting file size and speed info...',
    'download.noLogs': 'No logs yet.',
    'download.showDetails': 'Details',
    'download.hideDetails': 'Hide Details',
    'download.backgroundContinue': 'Keep in Background',
    'app.webModeWarning': 'Web mode stores token in local browser storage. Use for development/testing only.',
    'app.keychainWarning': 'System keychain is unavailable. Token will fallback to plain local storage.',
    'app.tokenSavedPlaceholder': 'Saved (leave blank to keep unchanged)',
    'app.saveSettings': 'Save Settings',
    'app.savingSettings': 'Saving...',
    'app.connectionTest': 'Test Connection',
    'app.testingConnection': 'Testing...',
    'app.clearToken': 'Clear Token',
    'app.settingsSaved': 'Chat backend settings saved.',
    'app.settingsConnected': 'Connected{latency}',
    'app.settingsConnectedAutoSaved': 'Connected{latency}. Settings auto-saved.',
    'app.latency': ' ({latency}ms)',
    'app.tokenCleared': 'Saved token has been cleared.',
    'preferences.title': 'Preferences',
    'preferences.language': 'Language',
    'preferences.theme': 'Theme',
    'preferences.theme.light': 'Light',
    'preferences.theme.dark': 'Dark',
    'preferences.theme.system': 'System',
    'voice.title': 'Voice',
    'voice.phase0Hint': 'Voice pipeline is in Phase 0 skeleton. AudioWorklet + model VAD + ASR/TTS providers will be integrated next.',
    'voice.vadHint': 'Silero VAD is enabled for auto segmentation. When speech ends, chunks are uploaded and commit is triggered automatically.',
    'voice.desktopOnly': 'Voice features are available on desktop runtime only.',
    'voice.liveCaptureHint': 'The session captures microphone PCM in real-time (16kHz / 20ms frame). Click "Commit Input" to trigger ASR commit.',
    'voice.status': 'Status',
    'voice.captureOn': 'Capturing',
    'voice.captureOff': 'Not Capturing',
    'voice.sessionId': 'Session ID',
    'voice.sessionIdPlaceholder': 'Session not started',
    'voice.permission': 'Microphone Permission',
    'voice.vadModel': 'VAD Model',
    'voice.vadLoading': 'VAD Loading',
    'voice.vadListening': 'VAD Listening',
    'voice.vadSpeaking': 'Speech Detected',
    'voice.vadStopped': 'VAD Stopped',
    'voice.flowControl': 'Playback Flow Control',
    'voice.capturedFrames': 'Captured Frames',
    'voice.startSession': 'Start Session',
    'voice.commitInput': 'Commit Input',
    'voice.stopSession': 'Stop Session',
    'voice.stopTts': 'Stop TTS',
    'voice.partialText': 'ASR Partial',
    'voice.finalText': 'ASR Final',
    'voice.empty': '(empty)',
    'voice.interactionMode': 'Interaction Mode',
    'voice.defaultFormat': 'Default Audio Format',
    'voice.mode.vad': 'Auto VAD',

    'main.openSettings': 'Open Settings',
    'main.switchToPetMode': 'Switch to Pet Mode',

    'pet.switchToWindowMode': 'Switch to Window Mode',
    'pet.lockedTitle': 'Locked (click to unlock)',
    'pet.unlockedTitle': 'Unlocked (click to lock)',

    'composer.placeholder': 'Type what you want her to say...',
    'composer.sendTextTitle': 'Send text message',
    'composer.voiceEnableTitle': 'Enable voice input',
    'composer.voiceDisableTitle': 'Disable voice input',
    'composer.emptyInput': 'Please enter content to send.',
    'composer.collapse': 'Collapse',
    'composer.send': 'Send',
    'composer.stop': 'Stop',

    'model.status.loaded': 'Model Loaded',
    'model.status.loading': 'Loading',
    'model.status.unloaded': 'No Model Loaded',

    'modelSettings.title': 'Model Settings',
    'modelSettings.importing': 'Importing...',
    'modelSettings.importZip': 'Import Model ZIP',
    'modelSettings.modelLabel': 'Model',
    'modelSettings.noModels': 'No models available. Import a ZIP first.',
    'modelSettings.zipHint': 'Supports Live2D model zip packages containing `.model3.json`.',
    'modelSettings.scale': 'Model Scale: {scale}',
    'modelSettings.autoEyeBlink': 'Auto Eye Blink',
    'modelSettings.autoBreath': 'Auto Breath',
    'modelSettings.eyeTracking': 'Eye Tracking',
    'modelSettings.reset': 'Reset Model',

    'motion.title': 'Motion Control',
    'motion.manualInput': 'Manual motion filenames (optional)',
    'motion.manualPlaceholder': 'Leave empty to auto-parse model3.json, or one filename per line, e.g.:\nidle_01\ntap_body_01',
    'motion.parse': 'Auto Parse (model3.json) / Manual Parse',
    'motion.parsing': 'Parsing...',
    'motion.availableFiles': 'Available Motion Files',
    'motion.newName': 'New Motion Name',
    'motion.add': 'Add Motion',
    'motion.upload': 'Upload Motion File',
    'motion.clearFile': 'Clear File',
    'motion.linked': 'Linked: {fileName}',
    'motion.play': 'Play',
    'motion.clickArea': 'Click Area',

    'expression.title': 'Expression Control',
    'expression.manualInput': 'Manual expression filenames (optional)',
    'expression.manualPlaceholder': 'Leave empty to auto-parse model3.json, or one filename per line, e.g.:\nsmile_01\nangry_01',
    'expression.parse': 'Auto Parse (model3.json) / Manual Parse',
    'expression.parsing': 'Parsing...',
    'expression.availableFiles': 'Available Expression Files',
    'expression.newName': 'New Expression Name',
    'expression.add': 'Add Expression',
    'expression.upload': 'Upload Expression File',
    'expression.clearFile': 'Clear File',
    'expression.linked': 'Linked: {fileName}',
    'expression.apply': 'Apply',
    'expression.clickArea': 'Click Area',

    'preset.title': 'Preset Management',
    'preset.name': 'Preset Name',
    'preset.save': 'Save Preset',
    'preset.import': 'Import Preset',
    'preset.empty': 'No saved presets yet',
    'preset.load': 'Load',
    'preset.export': 'Export',
    'preset.delete': 'Delete',
    'preset.unknownModel': 'Unknown Model',

    'background.title': 'Background Control',
    'background.upload': 'Upload Background',
    'background.clearCurrent': 'Clear Current Background',
    'background.opacity': 'Background Opacity: {opacity}%',
    'background.cached': 'Cached Backgrounds ({count})',
    'background.clearCache': 'Clear Cache',
    'background.apply': 'Apply',
    'background.delete': 'Delete',

    'live2d.loadingModel': 'Loading Live2D model...',
    'live2d.noModelSelected': 'Import and select a model ZIP in the control panel first.',

    'controls.unsupportedModelImport': 'Model library import is not supported in this environment.',
    'controls.loadModelLibraryFailed': 'Failed to load model library. Please restart and try again.',
    'controls.noModelHint': 'No model imported yet. Please import a Live2D model ZIP first.',
    'controls.statusChip': '{status}',
    'controls.motionLabel': 'Motion',
    'controls.expressionLabel': 'Expression',
    'controls.clickAreaDialogTitle': 'Set Click Area Associations',
    'controls.clickAreaSelect': 'Select click areas (multi-select)',
    'controls.clickAreaSelected': 'Selected Areas',
    'controls.clickAreaConflict': 'Area conflict notice',
    'controls.clickAreaConflictItem': '{areaName} already linked to: {items}',
    'controls.clearAssociation': 'Clear Association',
    'controls.confirmAssociation': 'Confirm ({count} areas)',
    'controls.presetDeleteConfirm': 'Are you sure you want to delete preset "{name}"?',
    'controls.invalidPresetFile': 'Invalid preset file format',
    'controls.presetExistsOverwrite': 'Preset "{name}" already exists. Overwrite it?',
    'controls.presetFormatError': 'Preset file format is invalid',
    'controls.defaultPresetModel': 'Unknown Model',
  },
};

function formatTemplate(message, params = {}) {
  if (typeof message !== 'string') {
    return '';
  }

  return message.replace(/\{(\w+)\}/g, (_, key) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      return String(params[key]);
    }
    return `{${key}}`;
  });
}

function getStoredLanguage() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return SUPPORTED_LANGUAGES.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

function detectLanguageFromBrowser() {
  if (typeof navigator === 'undefined') {
    return LANGUAGE_ZH_CN;
  }

  const browserLanguage = String(navigator.language || '').toLowerCase();
  return browserLanguage.startsWith('zh') ? LANGUAGE_ZH_CN : LANGUAGE_EN_US;
}

function getInitialLanguage() {
  return getStoredLanguage() || detectLanguageFromBrowser();
}

const I18nContext = createContext({
  language: LANGUAGE_ZH_CN,
  setLanguage: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(getInitialLanguage);

  const setLanguage = useCallback((nextLanguage) => {
    const normalized = SUPPORTED_LANGUAGES.includes(nextLanguage) ? nextLanguage : LANGUAGE_ZH_CN;
    setLanguageState(normalized);

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalized);
      } catch {
        // ignore storage write errors
      }
    }
  }, []);

  const t = useCallback(
    (key, params = {}) => {
      const localeMessages = MESSAGES[language] || {};
      const fallbackMessages = MESSAGES[LANGUAGE_ZH_CN];
      const template =
        localeMessages[key] ||
        fallbackMessages[key] ||
        key;

      return formatTemplate(template, params);
    },
    [language],
  );

  const contextValue = useMemo(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t],
  );

  return <I18nContext.Provider value={contextValue}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export function toLocaleTag(language) {
  return language === LANGUAGE_EN_US ? 'en-US' : 'zh-CN';
}
