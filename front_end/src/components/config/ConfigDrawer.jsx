import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Tab,
  Tabs,
  TextField,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import Live2DControls from '../controls/Live2DControls.jsx';
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

const CONFIG_DRAWER_WIDTH = 420;

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
  openClawSettings,
  settingsSaving = false,
  settingsTesting = false,
  settingsFeedback = '',
  settingsError = '',
  onOpenClawSettingChange,
  onSaveOpenClawSettings,
  onTestOpenClawSettings,
  onClearSavedToken,
}) {
  const { language, setLanguage, t } = useI18n();
  const { themeMode, setThemeMode } = useThemeMode();
  const [activeConfigTab, setActiveConfigTab] = useState(0);

  useEffect(() => {
    if (!open) {
      setActiveConfigTab(0);
    }
  }, [open]);

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
              <Tab label={t('app.tab.openclaw')} />
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
              <Stack spacing={2}>
                {!desktopMode && <Alert severity="warning">{t('app.webModeWarning')}</Alert>}

                {desktopMode && !openClawSettings.hasSecureStorage && (
                  <Alert severity="warning">{t('app.keychainWarning')}</Alert>
                )}

                <TextField
                  label="OpenClaw Base URL"
                  value={openClawSettings.baseUrl}
                  onChange={(event) => onOpenClawSettingChange?.('baseUrl', event.target.value)}
                  placeholder="http://127.0.0.1:18789"
                  fullWidth
                />

                <TextField
                  label="OpenClaw Token"
                  value={openClawSettings.token}
                  onChange={(event) => onOpenClawSettingChange?.('token', event.target.value)}
                  type="password"
                  autoComplete="off"
                  placeholder={openClawSettings.hasToken ? t('app.tokenSavedPlaceholder') : ''}
                  fullWidth
                />

                <TextField
                  label="OpenClaw Agent ID"
                  value={openClawSettings.agentId}
                  onChange={(event) => onOpenClawSettingChange?.('agentId', event.target.value)}
                  placeholder="main"
                  fullWidth
                />

                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    onClick={onSaveOpenClawSettings}
                    disabled={settingsSaving || settingsTesting}
                  >
                    {settingsSaving ? t('app.savingSettings') : t('app.saveSettings')}
                  </Button>
                  <Button
                    variant="outlined"
                    onClick={onTestOpenClawSettings}
                    disabled={settingsSaving || settingsTesting}
                  >
                    {settingsTesting ? t('app.testingConnection') : t('app.connectionTest')}
                  </Button>
                  <Button
                    variant="text"
                    color="warning"
                    onClick={onClearSavedToken}
                    disabled={settingsSaving || settingsTesting || !openClawSettings.hasToken}
                  >
                    {t('app.clearToken')}
                  </Button>
                </Stack>

                {settingsError && <Alert severity="error">{settingsError}</Alert>}
                {settingsFeedback && <Alert severity="success">{settingsFeedback}</Alert>}
              </Stack>
            )}

            {activeConfigTab === 2 && (
              <Stack spacing={2}>
                <Box sx={{ fontWeight: 600 }}>{t('preferences.title')}</Box>
                <Stack spacing={1}>
                  <Box sx={{ color: 'text.secondary', fontSize: 14 }}>{t('preferences.language')}</Box>
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
                </Stack>
                <Stack spacing={1}>
                  <Box sx={{ color: 'text.secondary', fontSize: 14 }}>{t('preferences.theme')}</Box>
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
                </Stack>
              </Stack>
            )}
          </Stack>
        </Box>
      </Stack>
    </Drawer>
  );
}
