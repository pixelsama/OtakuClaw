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
    'common.delete': '删除',

    'error.openclawMissingConfig': '请先填写 OpenClaw Base URL / Token / Agent ID。',
    'error.openclawUnreachable': '无法访问 OpenClaw。',
    'error.streamRequestFailed': '流式接口请求失败: {status}',

    'app.settingsPanel': '设置面板',
    'app.modelLoaded': '模型已加载',
    'app.tab.live2d': 'Live2D 控制面板',
    'app.tab.openclaw': 'OpenClaw 设置',
    'app.tab.preferences': '偏好设置',
    'app.webModeWarning': '当前为 Web 模式，Token 会存入浏览器本地存储，仅建议用于开发测试。',
    'app.keychainWarning': '系统密钥链不可用，Token 将回退为本地明文存储。',
    'app.tokenSavedPlaceholder': '已保存（留空表示不修改）',
    'app.saveSettings': '保存设置',
    'app.savingSettings': '保存中...',
    'app.connectionTest': '连接测试',
    'app.testingConnection': '测试中...',
    'app.clearToken': '清除 Token',
    'app.settingsSaved': 'OpenClaw 配置已保存。',
    'app.settingsConnected': 'OpenClaw 连接成功{latency}',
    'app.latency': '（{latency}ms）',
    'app.tokenCleared': '已清除保存的 Token。',
    'preferences.title': '偏好设置',
    'preferences.language': '语言',
    'preferences.theme': '主题',
    'preferences.theme.light': '浅色',
    'preferences.theme.dark': '深色',
    'preferences.theme.system': '跟随系统',

    'main.openSettings': '打开设置',
    'main.switchToPetMode': '切换到桌宠模式',

    'pet.switchToWindowMode': '切换到主窗口模式',
    'pet.lockedTitle': '已锁定（点击解锁）',
    'pet.unlockedTitle': '未锁定（点击锁定）',

    'composer.placeholder': '输入你想让她说的话...',
    'composer.sendTextTitle': '发送文字消息',
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
    'common.delete': 'Delete',

    'error.openclawMissingConfig': 'Please fill OpenClaw Base URL / Token / Agent ID first.',
    'error.openclawUnreachable': 'Unable to reach OpenClaw.',
    'error.streamRequestFailed': 'Streaming request failed: {status}',

    'app.settingsPanel': 'Settings Panel',
    'app.modelLoaded': 'Model Loaded',
    'app.tab.live2d': 'Live2D Control Panel',
    'app.tab.openclaw': 'OpenClaw Settings',
    'app.tab.preferences': 'Preferences',
    'app.webModeWarning': 'Web mode stores token in local browser storage. Use for development/testing only.',
    'app.keychainWarning': 'System keychain is unavailable. Token will fallback to plain local storage.',
    'app.tokenSavedPlaceholder': 'Saved (leave blank to keep unchanged)',
    'app.saveSettings': 'Save Settings',
    'app.savingSettings': 'Saving...',
    'app.connectionTest': 'Test Connection',
    'app.testingConnection': 'Testing...',
    'app.clearToken': 'Clear Token',
    'app.settingsSaved': 'OpenClaw settings saved.',
    'app.settingsConnected': 'OpenClaw connected{latency}',
    'app.latency': ' ({latency}ms)',
    'app.tokenCleared': 'Saved token has been cleared.',
    'preferences.title': 'Preferences',
    'preferences.language': 'Language',
    'preferences.theme': 'Theme',
    'preferences.theme.light': 'Light',
    'preferences.theme.dark': 'Dark',
    'preferences.theme.system': 'System',

    'main.openSettings': 'Open Settings',
    'main.switchToPetMode': 'Switch to Pet Mode',

    'pet.switchToWindowMode': 'Switch to Window Mode',
    'pet.lockedTitle': 'Locked (click to unlock)',
    'pet.unlockedTitle': 'Unlocked (click to lock)',

    'composer.placeholder': 'Type what you want her to say...',
    'composer.sendTextTitle': 'Send text message',
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
