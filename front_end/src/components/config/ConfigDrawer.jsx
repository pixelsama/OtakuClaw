import { useEffect, useMemo, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Live2DControls from '../controls/Live2DControls.jsx';
import VoiceSettingsPanel from './VoiceSettingsPanel.jsx';
import { desktopBridge } from '../../services/desktopBridge.js';
import {
  LANGUAGE_EN_US,
  LANGUAGE_ZH_CN,
  useI18n,
} from '../../i18n/I18nContext.jsx';
import {
  THEME_MODE_DARK,
  THEME_MODE_LIGHT,
  THEME_MODE_SYSTEM,
  useThemeMode,
} from '../../theme/ThemeModeContext.jsx';
import {
  extendNanobotProviderOptionsWithLegacy,
  NANOBOT_PROVIDER_OPTIONS,
} from '../../constants/nanobotProviders.js';

const CONFIG_DRAWER_WIDTH = 420;
const MASKED_SECRET_VALUE = '********';
const DEFAULT_APP_UPDATER_STATE = {
  status: 'idle',
  updateInfo: null,
  progress: null,
  checkedAt: '',
  error: null,
  available: false,
  downloaded: false,
  supported: false,
};

function resolveUpdaterStatusLabel(t, status = 'idle') {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : 'idle';
  if (normalized === 'checking') {
    return t('preferences.updater.status.checking');
  }
  if (normalized === 'available') {
    return t('preferences.updater.status.available');
  }
  if (normalized === 'downloading') {
    return t('preferences.updater.status.downloading');
  }
  if (normalized === 'downloaded') {
    return t('preferences.updater.status.downloaded');
  }
  if (normalized === 'error') {
    return t('preferences.updater.status.error');
  }
  return t('preferences.updater.status.idle');
}

function resolveUpdaterFailureMessage(t, result = {}) {
  const reason = typeof result?.reason === 'string' ? result.reason : '';
  if (reason === 'app_not_packaged') {
    return t('preferences.updater.reason.appNotPackaged');
  }
  if (reason === 'updater_unavailable' || reason === 'desktop_app_updater_unavailable') {
    return t('preferences.updater.reason.unavailable');
  }

  if (typeof result?.error?.message === 'string' && result.error.message.trim()) {
    return result.error.message.trim();
  }
  return t('preferences.updater.actionFailed');
}

function formatUpdaterSpeed(bytesPerSecond = 0) {
  const bytes = Number.isFinite(bytesPerSecond) && bytesPerSecond > 0 ? bytesPerSecond : 0;
  if (bytes <= 0) {
    return '0 B/s';
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB/s`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB/s`;
  }
  return `${Math.round(bytes)} B/s`;
}

function normalizeMaskedSecretInput(rawValue, hasSavedSecret) {
  if (!hasSavedSecret) {
    return rawValue;
  }

  const value = typeof rawValue === 'string' ? rawValue : '';
  if (!value) {
    return '';
  }

  if (/^\*+$/.test(value)) {
    return '';
  }

  if (value.startsWith(MASKED_SECRET_VALUE)) {
    return value.slice(MASKED_SECRET_VALUE.length);
  }

  return value;
}

function SectionAccordion({
  title = '',
  defaultExpanded = false,
  children,
}) {
  return (
    <Accordion
      defaultExpanded={defaultExpanded}
      disableGutters
      elevation={0}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, '&::before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ fontWeight: 600 }}>{title}</Box>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={1.5}>{children}</Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export default function ConfigDrawer({
  open = false,
  isPetMode = false,
  isNarrowViewport = false,
  onClose,
  modelLoaded = false,
  desktopMode = false,
  live2dViewerRef,
  onModelChange,
  onMotionsUpdate,
  onExpressionsUpdate,
  chatBackendSettings = {},
  settingsSaving = false,
  settingsTesting = false,
  settingsFeedback = '',
  settingsError = '',
  onChatBackendChange,
  onOpenClawSettingChange,
  onNanobotSettingChange,
  onPickNanobotWorkspace,
  onTestChatBackendSettings,
  onClearSavedToken,
  nanobotRuntimeStatus = {},
  nanobotRuntimeInstalling = false,
  onInstallNanobotRuntime,
  nanobotSkills = {},
  nanobotSkillsLoading = false,
  nanobotSkillsImporting = false,
  nanobotSkillsDeletingName = '',
  onImportNanobotSkillsZip,
  onDeleteNanobotSkill,
  onOpenNanobotSkillsLibrary,
  onOpenDownloadCenter,
  onBuiltinTtsEnabledChange,
}) {
  const { language, setLanguage, t } = useI18n();
  const { themeMode, setThemeMode } = useThemeMode();
  const [activeConfigTab, setActiveConfigTab] = useState(0);
  const [appUpdaterState, setAppUpdaterState] = useState(DEFAULT_APP_UPDATER_STATE);
  const [appUpdaterBusy, setAppUpdaterBusy] = useState(false);
  const [appUpdaterError, setAppUpdaterError] = useState('');
  const [appUpdaterFeedback, setAppUpdaterFeedback] = useState('');
  const selectedBackend = 'nanobot';
  const openClawSettings = chatBackendSettings?.openclaw || {};
  const nanobotSettings = chatBackendSettings?.nanobot || {};
  const hasSecureStorage = chatBackendSettings?.hasSecureStorage !== false;
  const hasBackendSecret = selectedBackend === 'nanobot' ? nanobotSettings.hasApiKey : openClawSettings.hasToken;
  const nanobotRuntimeInstalled = Boolean(nanobotRuntimeStatus?.installed);
  const nanobotRuntimePath = nanobotRuntimeStatus?.repoPath || '';
  const openClawTokenSaved = Boolean(openClawSettings.hasToken && !(openClawSettings.token || '').trim());
  const nanobotApiKeySaved = Boolean(nanobotSettings.hasApiKey && !(nanobotSettings.apiKey || '').trim());
  const openClawTokenValue = openClawTokenSaved ? MASKED_SECRET_VALUE : (openClawSettings.token || '');
  const nanobotApiKeyValue = nanobotApiKeySaved ? MASKED_SECRET_VALUE : (nanobotSettings.apiKey || '');
  const customNanobotSkills = Array.isArray(nanobotSkills?.customSkills) ? nanobotSkills.customSkills : [];
  const builtinNanobotSkills = Array.isArray(nanobotSkills?.builtinSkills) ? nanobotSkills.builtinSkills : [];
  const normalizedSettingsFeedback = typeof settingsFeedback === 'string' ? settingsFeedback.toLowerCase() : '';
  const normalizedSettingsError = typeof settingsError === 'string' ? settingsError.toLowerCase() : '';
  const showSkillsFeedback =
    Boolean(settingsFeedback)
    && (settingsFeedback.includes('技能') || normalizedSettingsFeedback.includes('skill'));
  const showSkillsError =
    Boolean(settingsError)
    && (settingsError.includes('技能') || normalizedSettingsError.includes('skill'));
  const testButtonDisabled = settingsSaving
    || settingsTesting
    || (selectedBackend === 'nanobot' && !nanobotSettings.enabled);
  const nanobotProviderOptions = useMemo(
    () => extendNanobotProviderOptionsWithLegacy(NANOBOT_PROVIDER_OPTIONS, nanobotSettings.provider || ''),
    [nanobotSettings.provider],
  );
  const updaterStatus = typeof appUpdaterState?.status === 'string' ? appUpdaterState.status : 'idle';
  const updaterStatusLabel = resolveUpdaterStatusLabel(t, updaterStatus);
  const updaterAvailableVersion = typeof appUpdaterState?.updateInfo?.version === 'string'
    ? appUpdaterState.updateInfo.version.trim()
    : '';
  const updaterDownloadProgress = Number.isFinite(appUpdaterState?.progress?.percent)
    ? Math.max(0, Math.min(100, appUpdaterState.progress.percent))
    : 0;
  const updaterDownloadRate = formatUpdaterSpeed(appUpdaterState?.progress?.bytesPerSecond || 0);
  const updaterSupported = desktopMode && Boolean(appUpdaterState?.supported);
  const updaterIsDownloading = updaterStatus === 'downloading';
  const updaterHasAvailable = Boolean(appUpdaterState?.available);
  const updaterDownloaded = Boolean(appUpdaterState?.downloaded);
  const updaterVisibleError = appUpdaterError || (typeof appUpdaterState?.error?.message === 'string'
    ? appUpdaterState.error.message
    : '');

  const handleCheckForUpdates = async () => {
    setAppUpdaterBusy(true);
    setAppUpdaterError('');
    setAppUpdaterFeedback('');
    try {
      const result = await desktopBridge.appUpdater.check();
      if (!result?.ok) {
        setAppUpdaterError(resolveUpdaterFailureMessage(t, result));
        return;
      }

      const nextVersion = typeof result?.updateInfo?.version === 'string' ? result.updateInfo.version.trim() : '';
      if (nextVersion) {
        setAppUpdaterFeedback(t('preferences.updater.availableVersion', { version: nextVersion }));
      } else {
        setAppUpdaterFeedback(t('preferences.updater.checkedNoUpdate'));
      }
    } catch (error) {
      setAppUpdaterError(error?.message || t('preferences.updater.actionFailed'));
    } finally {
      setAppUpdaterBusy(false);
    }
  };

  const handleDownloadUpdate = async () => {
    setAppUpdaterBusy(true);
    setAppUpdaterError('');
    setAppUpdaterFeedback('');
    try {
      const result = await desktopBridge.appUpdater.download();
      if (!result?.ok) {
        setAppUpdaterError(resolveUpdaterFailureMessage(t, result));
        return;
      }
      setAppUpdaterFeedback(t('preferences.updater.downloadingStarted'));
    } catch (error) {
      setAppUpdaterError(error?.message || t('preferences.updater.actionFailed'));
    } finally {
      setAppUpdaterBusy(false);
    }
  };

  const handleInstallUpdate = async () => {
    setAppUpdaterBusy(true);
    setAppUpdaterError('');
    setAppUpdaterFeedback('');
    try {
      const result = await desktopBridge.appUpdater.install();
      if (!result?.ok) {
        setAppUpdaterError(resolveUpdaterFailureMessage(t, result));
        return;
      }
      setAppUpdaterFeedback(t('preferences.updater.installing'));
    } catch (error) {
      setAppUpdaterError(error?.message || t('preferences.updater.actionFailed'));
    } finally {
      setAppUpdaterBusy(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setActiveConfigTab(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !desktopMode) {
      return () => {};
    }

    let disposed = false;
    const loadUpdaterState = async () => {
      try {
        const result = await desktopBridge.appUpdater.getState();
        if (disposed || !result?.ok || !result?.state) {
          return;
        }
        setAppUpdaterState((current) => ({
          ...current,
          ...result.state,
        }));
      } catch (error) {
        if (!disposed) {
          setAppUpdaterError(error?.message || t('preferences.updater.loadFailed'));
        }
      }
    };

    void loadUpdaterState();
    const unsubscribe = desktopBridge.appUpdater.onState((payload = {}) => {
      if (disposed || !payload || typeof payload !== 'object') {
        return;
      }
      setAppUpdaterState((current) => ({
        ...current,
        ...payload,
      }));
      if (payload?.status === 'error') {
        const message = typeof payload?.error?.message === 'string' ? payload.error.message : '';
        setAppUpdaterError(message || t('preferences.updater.actionFailed'));
      } else {
        setAppUpdaterError('');
      }
      if (payload?.status === 'downloaded') {
        setAppUpdaterFeedback(t('preferences.updater.downloadedReady'));
      }
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [desktopMode, open, t]);

  return (
    <Drawer
      anchor="right"
      open={open && !isPetMode}
      onClose={onClose}
      variant={isNarrowViewport ? 'temporary' : 'persistent'}
      ModalProps={{ keepMounted: true }}
      PaperProps={{
        sx: {
          width: {
            xs: '100%',
            sm: CONFIG_DRAWER_WIDTH,
          },
          maxWidth: '100vw',
        },
      }}
    >
      <Stack sx={{ height: '100%' }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <IconButton onClick={onClose}>
              <CloseIcon />
            </IconButton>
            <span>{t('app.settingsPanel')}</span>
            {modelLoaded && <Chip color="success" size="small" label={t('app.modelLoaded')} />}
          </Stack>
        </Box>

        <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2 }}>
          <Stack spacing={2}>
            <Tabs value={activeConfigTab} onChange={(_event, tab) => setActiveConfigTab(tab)} variant="fullWidth">
              <Tab label={t('app.tab.live2d')} />
              <Tab label={t('app.tab.chatBackend')} />
              <Tab label={t('app.tab.voice')} />
              <Tab label={t('app.tab.preferences')} />
            </Tabs>
            <Divider />

            {activeConfigTab === 0 && (
              <Live2DControls
                live2dViewerRef={live2dViewerRef}
                modelLoaded={modelLoaded}
                isPetMode={isPetMode}
                onModelChange={onModelChange}
                onMotionsUpdate={onMotionsUpdate}
                onExpressionsUpdate={onExpressionsUpdate}
                onAutoEyeBlinkChange={(enabled) => {
                  live2dViewerRef.current?.getManager?.()?.setAutoEyeBlinkEnable(enabled);
                }}
                onAutoBreathChange={(enabled) => {
                  live2dViewerRef.current?.getManager?.()?.setAutoBreathEnable(enabled);
                }}
                onEyeTrackingChange={(enabled) => {
                  live2dViewerRef.current?.getManager?.()?.setEyeTracking(enabled);
                }}
                onModelScaleChange={(scale) => {
                  live2dViewerRef.current?.getManager?.()?.setModelScale(scale);
                }}
                onBackgroundChange={(backgroundConfig) => {
                  const manager = live2dViewerRef.current?.getManager?.();
                  if (!manager) {
                    return;
                  }

                  if (!backgroundConfig.hasBackground) {
                    manager.clearBackground();
                    return;
                  }

                  manager.setBackgroundOpacity(backgroundConfig.opacity ?? 1);
                }}
              />
            )}

            {activeConfigTab === 1 && (
              <Stack spacing={1.5}>
                {!desktopMode && <Alert severity="warning">{t('app.webModeWarning')}</Alert>}

                {desktopMode && !hasSecureStorage && (
                  <Alert severity="warning">{t('app.keychainWarning')}</Alert>
                )}

                <SectionAccordion title={t('app.chatBackendSelector')}>
                  <TextField
                    select
                    label={t('app.chatBackendSelector')}
                    value={selectedBackend}
                    onChange={(event) => onChatBackendChange?.(event.target.value)}
                    fullWidth
                  >
                    <MenuItem value="nanobot">{t('app.backend.nanobot')}</MenuItem>
                  </TextField>

                  {selectedBackend === 'openclaw' && (
                    <>
                      <TextField
                        label="OpenClaw Base URL"
                        value={openClawSettings.baseUrl || ''}
                        onChange={(event) => onOpenClawSettingChange?.('baseUrl', event.target.value)}
                        placeholder="http://127.0.0.1:18789"
                        fullWidth
                      />

                      <TextField
                        label="OpenClaw Token"
                        value={openClawTokenValue}
                        onChange={(event) => {
                          const nextToken = normalizeMaskedSecretInput(event.target.value, openClawTokenSaved);
                          onOpenClawSettingChange?.('token', nextToken);
                        }}
                        type="password"
                        autoComplete="off"
                        placeholder={openClawSettings.hasToken ? t('app.tokenSavedPlaceholder') : ''}
                        helperText={openClawTokenSaved ? t('app.tokenSavedPlaceholder') : ''}
                        fullWidth
                      />

                      <TextField
                        label="OpenClaw Agent ID"
                        value={openClawSettings.agentId || ''}
                        onChange={(event) => onOpenClawSettingChange?.('agentId', event.target.value)}
                        placeholder="main"
                        fullWidth
                      />
                    </>
                  )}

                  {selectedBackend === 'nanobot' && (
                    <>
                      {desktopMode && !nanobotRuntimeInstalled && (
                        <Alert
                          severity="warning"
                          action={(
                            <Button
                              color="inherit"
                              size="small"
                              disabled={nanobotRuntimeInstalling}
                              onClick={onInstallNanobotRuntime}
                            >
                              {nanobotRuntimeInstalling ? t('app.nanobotRuntimeInstalling') : t('app.nanobotRuntimeInstall')}
                            </Button>
                          )}
                        >
                          {t('app.nanobotRuntimeMissing')}
                        </Alert>
                      )}

                      {desktopMode && nanobotRuntimeInstalled && (
                        <Alert severity="success">
                          {t('app.nanobotRuntimeReady', { path: nanobotRuntimePath })}
                        </Alert>
                      )}

                      <TextField
                        select
                        label={t('app.nanobotEnabled')}
                        value={nanobotSettings.enabled ? 'true' : 'false'}
                        onChange={(event) => onNanobotSettingChange?.('enabled', event.target.value === 'true')}
                        fullWidth
                      >
                        <MenuItem value="true">{t('common.enabled')}</MenuItem>
                        <MenuItem value="false">{t('common.disabled')}</MenuItem>
                      </TextField>

                      <Stack spacing={1}>
                        <TextField
                          label={t('app.nanobotWorkspace')}
                          value={nanobotSettings.workspace || ''}
                          helperText={t('app.nanobotWorkspaceHelper')}
                          InputProps={{
                            readOnly: true,
                          }}
                          fullWidth
                        />
                        <Button
                          variant="outlined"
                          onClick={() => {
                            void onPickNanobotWorkspace?.();
                          }}
                          disabled={!desktopMode || settingsSaving || settingsTesting}
                        >
                          {t('app.nanobotWorkspaceBrowse')}
                        </Button>
                      </Stack>

                      <Alert severity={nanobotSettings.allowHighRiskTools ? 'warning' : 'info'}>
                        {t('app.nanobotPermissionsWarning')}
                      </Alert>

                      <TextField
                        select
                        label={t('app.nanobotAllowHighRiskTools')}
                        value={nanobotSettings.allowHighRiskTools ? 'true' : 'false'}
                        onChange={(event) => onNanobotSettingChange?.('allowHighRiskTools', event.target.value === 'true')}
                        helperText={t('app.nanobotAllowHighRiskToolsHelper')}
                        fullWidth
                      >
                        <MenuItem value="false">{t('common.disabled')}</MenuItem>
                        <MenuItem value="true">{t('common.enabled')}</MenuItem>
                      </TextField>

                      <TextField
                        select
                        label={t('app.nanobotProvider')}
                        value={nanobotSettings.provider || ''}
                        onChange={(event) => onNanobotSettingChange?.('provider', event.target.value)}
                        fullWidth
                      >
                        {nanobotProviderOptions.map((option) => (
                          <MenuItem key={option.value} value={option.value}>
                            {option.legacyValue
                              ? t('nanobot.provider.legacy', { provider: option.legacyValue })
                              : (() => {
                                const localized = t(option.labelKey);
                                return localized === option.labelKey ? option.fallbackLabel : localized;
                              })()}
                          </MenuItem>
                        ))}
                      </TextField>

                      <TextField
                        label={t('app.nanobotModel')}
                        value={nanobotSettings.model || ''}
                        onChange={(event) => onNanobotSettingChange?.('model', event.target.value)}
                        placeholder="anthropic/claude-opus-4-5"
                        fullWidth
                      />

                      <TextField
                        label={t('app.nanobotApiBase')}
                        value={nanobotSettings.apiBase || ''}
                        onChange={(event) => onNanobotSettingChange?.('apiBase', event.target.value)}
                        placeholder="https://openrouter.ai/api/v1"
                        fullWidth
                      />

                      <TextField
                        label={t('app.nanobotApiKey')}
                        value={nanobotApiKeyValue}
                        onChange={(event) => {
                          const nextApiKey = normalizeMaskedSecretInput(event.target.value, nanobotApiKeySaved);
                          onNanobotSettingChange?.('apiKey', nextApiKey);
                        }}
                        type="password"
                        autoComplete="off"
                        placeholder={nanobotSettings.hasApiKey ? t('app.tokenSavedPlaceholder') : ''}
                        helperText={nanobotApiKeySaved ? t('app.tokenSavedPlaceholder') : ''}
                        fullWidth
                      />
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: -0.5 }}>
                        <Button
                          size="small"
                          color="warning"
                          onClick={onClearSavedToken}
                          disabled={settingsSaving || settingsTesting || !nanobotSettings.hasApiKey}
                        >
                          {t('app.nanobotClearApiKey')}
                        </Button>
                      </Box>

                      <Stack direction="row" spacing={1}>
                        <TextField
                          label={t('app.nanobotMaxTokens')}
                          type="number"
                          value={nanobotSettings.maxTokens ?? 4096}
                          onChange={(event) =>
                            onNanobotSettingChange?.('maxTokens', Number.parseInt(event.target.value, 10) || 0)}
                          fullWidth
                        />
                        <TextField
                          label={t('app.nanobotTemperature')}
                          type="number"
                          value={nanobotSettings.temperature ?? 0.2}
                          onChange={(event) =>
                            onNanobotSettingChange?.('temperature', Number.parseFloat(event.target.value))}
                          inputProps={{ step: 0.1 }}
                          fullWidth
                        />
                      </Stack>

                      <TextField
                        select
                        label={t('app.nanobotReasoningEffort')}
                        value={nanobotSettings.reasoningEffort || ''}
                        onChange={(event) => onNanobotSettingChange?.('reasoningEffort', event.target.value)}
                        fullWidth
                      >
                        <MenuItem value="">{t('common.auto')}</MenuItem>
                        <MenuItem value="low">low</MenuItem>
                        <MenuItem value="medium">medium</MenuItem>
                        <MenuItem value="high">high</MenuItem>
                      </TextField>
                    </>
                  )}
                </SectionAccordion>

                {selectedBackend === 'nanobot' && (
                  <SectionAccordion title={t('app.nanobotSkillsTitle')}>
                    <Alert severity="info">{t('app.nanobotSkillsHelper')}</Alert>
                    {showSkillsError && <Alert severity="error">{settingsError}</Alert>}
                    {showSkillsFeedback && <Alert severity="success">{settingsFeedback}</Alert>}
                    <Stack direction="row" spacing={1}>
                      <Button
                        variant="outlined"
                        onClick={() => {
                          void onImportNanobotSkillsZip?.();
                        }}
                        disabled={!desktopMode || settingsSaving || settingsTesting || nanobotSkillsImporting}
                      >
                        {nanobotSkillsImporting ? t('app.nanobotSkillsImporting') : t('app.nanobotSkillsImportZip')}
                      </Button>
                      <Button
                        variant="text"
                        onClick={() => {
                          void onOpenNanobotSkillsLibrary?.();
                        }}
                        disabled={!desktopMode || settingsSaving || settingsTesting}
                      >
                        {t('app.nanobotSkillsOpenLibrary')}
                      </Button>
                    </Stack>
                    {nanobotSkillsLoading ? (
                      <Box sx={{ color: 'text.secondary', fontSize: 13 }}>
                        {t('app.nanobotSkillsLoading')}
                      </Box>
                    ) : (
                      <Stack spacing={1}>
                        <Box sx={{ color: 'text.secondary', fontSize: 13 }}>
                          {t('app.nanobotSkillsInstalled')}
                        </Box>
                        <Box
                          sx={{
                            p: 1.25,
                            borderRadius: 1,
                            border: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'background.paper',
                          }}
                        >
                          {customNanobotSkills.length ? (
                            <Stack spacing={1}>
                              {customNanobotSkills.map((skill) => {
                                const skillName = skill.skillName || skill.name || '';
                                const skillDescription = skill.description || t('app.nanobotSkillsNoDescription');
                                return (
                                  <Stack
                                    key={`custom-skill-${skillName}`}
                                    direction="row"
                                    spacing={1}
                                    alignItems="center"
                                    justifyContent="space-between"
                                  >
                                    <Box sx={{ minWidth: 0 }}>
                                      <Box sx={{ fontSize: 14, fontWeight: 600, wordBreak: 'break-word' }}>
                                        {skill.name || skillName}
                                      </Box>
                                      <Box sx={{ color: 'text.secondary', fontSize: 12, wordBreak: 'break-word' }}>
                                        {skillDescription}
                                      </Box>
                                    </Box>
                                    <Button
                                      color="warning"
                                      size="small"
                                      disabled={
                                        !desktopMode
                                        || settingsSaving
                                        || settingsTesting
                                        || !skillName
                                        || nanobotSkillsDeletingName === skillName
                                      }
                                      onClick={() => {
                                        if (!skillName) {
                                          return;
                                        }
                                        const confirmed =
                                          typeof window === 'undefined'
                                            ? true
                                            : window.confirm(t('app.nanobotSkillsDeleteConfirm', { name: skillName }));
                                        if (!confirmed) {
                                          return;
                                        }
                                        void onDeleteNanobotSkill?.(skillName);
                                      }}
                                    >
                                      {nanobotSkillsDeletingName === skillName
                                        ? t('app.nanobotSkillsDeleting')
                                        : t('common.delete')}
                                    </Button>
                                  </Stack>
                                );
                              })}
                            </Stack>
                          ) : (
                            <Box sx={{ color: 'text.secondary', fontSize: 13 }}>
                              {t('app.nanobotSkillsEmpty')}
                            </Box>
                          )}
                        </Box>

                        <Box sx={{ color: 'text.secondary', fontSize: 13 }}>
                          {t('app.nanobotSkillsBuiltin')}
                        </Box>
                        <Box
                          sx={{
                            p: 1.25,
                            borderRadius: 1,
                            border: '1px solid',
                            borderColor: 'divider',
                            bgcolor: 'background.paper',
                          }}
                        >
                          {builtinNanobotSkills.length ? (
                            <Stack spacing={1}>
                              {builtinNanobotSkills.map((skill) => (
                                <Box key={`builtin-skill-${skill.skillName || skill.name}`}>
                                  <Box sx={{ fontSize: 14, fontWeight: 600, wordBreak: 'break-word' }}>
                                    {skill.name || skill.skillName}
                                  </Box>
                                  <Box sx={{ color: 'text.secondary', fontSize: 12, wordBreak: 'break-word' }}>
                                    {skill.description || t('app.nanobotSkillsNoDescription')}
                                  </Box>
                                </Box>
                              ))}
                            </Stack>
                          ) : (
                            <Box sx={{ color: 'text.secondary', fontSize: 13 }}>
                              {t('app.nanobotSkillsBuiltinEmpty')}
                            </Box>
                          )}
                        </Box>
                      </Stack>
                    )}
                  </SectionAccordion>
                )}

                <SectionAccordion title={t('app.connectionTest')}>
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="outlined"
                      onClick={onTestChatBackendSettings}
                      disabled={testButtonDisabled}
                    >
                      {settingsTesting ? t('app.testingConnection') : t('app.connectionTest')}
                    </Button>
                    <Button
                      variant="text"
                      color="warning"
                      onClick={onClearSavedToken}
                      disabled={settingsSaving || settingsTesting || !hasBackendSecret}
                    >
                      {t('app.clearToken')}
                    </Button>
                  </Stack>

                  {settingsError && <Alert severity="error">{settingsError}</Alert>}
                  {settingsFeedback && <Alert severity="success">{settingsFeedback}</Alert>}
                </SectionAccordion>
              </Stack>
            )}

            {activeConfigTab === 2 && (
              <VoiceSettingsPanel
                desktopMode={desktopMode}
                onOpenDownloadCenter={onOpenDownloadCenter}
                onBuiltinTtsEnabledChange={onBuiltinTtsEnabledChange}
              />
            )}

            {activeConfigTab === 3 && (
              <Stack spacing={1.5}>
                <SectionAccordion title={t('preferences.language')}>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      variant={language === LANGUAGE_ZH_CN ? 'contained' : 'outlined'}
                      onClick={() => setLanguage(LANGUAGE_ZH_CN)}
                    >
                      {t('language.zh')}
                    </Button>
                    <Button
                      size="small"
                      variant={language === LANGUAGE_EN_US ? 'contained' : 'outlined'}
                      onClick={() => setLanguage(LANGUAGE_EN_US)}
                    >
                      {t('language.en')}
                    </Button>
                  </Stack>
                </SectionAccordion>

                <SectionAccordion title={t('preferences.theme')}>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Button
                      size="small"
                      variant={themeMode === THEME_MODE_LIGHT ? 'contained' : 'outlined'}
                      onClick={() => setThemeMode(THEME_MODE_LIGHT)}
                    >
                      {t('preferences.theme.light')}
                    </Button>
                    <Button
                      size="small"
                      variant={themeMode === THEME_MODE_DARK ? 'contained' : 'outlined'}
                      onClick={() => setThemeMode(THEME_MODE_DARK)}
                    >
                      {t('preferences.theme.dark')}
                    </Button>
                    <Button
                      size="small"
                      variant={themeMode === THEME_MODE_SYSTEM ? 'contained' : 'outlined'}
                      onClick={() => setThemeMode(THEME_MODE_SYSTEM)}
                    >
                      {t('preferences.theme.system')}
                    </Button>
                  </Stack>
                </SectionAccordion>

                <SectionAccordion title={t('preferences.updater.title')}>
                  {!desktopMode && (
                    <Alert severity="info">{t('preferences.updater.webUnsupported')}</Alert>
                  )}

                  {desktopMode && !updaterSupported && (
                    <Alert severity="info">{t('preferences.updater.reason.appNotPackaged')}</Alert>
                  )}

                  <Box sx={{ color: 'text.secondary', fontSize: 13 }}>
                    {t('preferences.updater.status.label', { status: updaterStatusLabel })}
                  </Box>

                  {updaterAvailableVersion && (
                    <Box sx={{ color: 'text.secondary', fontSize: 13 }}>
                      {t('preferences.updater.availableVersion', { version: updaterAvailableVersion })}
                    </Box>
                  )}

                  {updaterIsDownloading && (
                    <Stack spacing={0.75}>
                      <LinearProgress variant="determinate" value={updaterDownloadProgress} />
                      <Box sx={{ color: 'text.secondary', fontSize: 12 }}>
                        {t('preferences.updater.progress', {
                          percent: updaterDownloadProgress.toFixed(1),
                          speed: updaterDownloadRate,
                        })}
                      </Box>
                    </Stack>
                  )}

                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        void handleCheckForUpdates();
                      }}
                      disabled={!updaterSupported || appUpdaterBusy}
                    >
                      {appUpdaterBusy && updaterStatus === 'checking'
                        ? t('preferences.updater.checking')
                        : t('preferences.updater.check')}
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        void handleDownloadUpdate();
                      }}
                      disabled={!updaterSupported || appUpdaterBusy || updaterIsDownloading || !updaterHasAvailable || updaterDownloaded}
                    >
                      {updaterIsDownloading ? t('preferences.updater.downloading') : t('preferences.updater.download')}
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => {
                        void handleInstallUpdate();
                      }}
                      disabled={!updaterSupported || appUpdaterBusy || !updaterDownloaded}
                    >
                      {t('preferences.updater.install')}
                    </Button>
                  </Stack>

                  {!!updaterVisibleError && <Alert severity="error">{updaterVisibleError}</Alert>}
                  {!!appUpdaterFeedback && <Alert severity="success">{appUpdaterFeedback}</Alert>}
                </SectionAccordion>
              </Stack>
            )}
          </Stack>
        </Box>
      </Stack>
    </Drawer>
  );
}
