import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  useMediaQuery,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import Live2DControls from './components/controls/Live2DControls.jsx';
import { useStreamingChat } from './hooks/useStreamingChat.js';
import { useSubtitleFeed } from './hooks/useSubtitleFeed.js';
import { usePetHoverPassthrough } from './hooks/pet/usePetHoverPassthrough.js';
import { ModeProvider, MODE_PET, MODE_WINDOW, useModeContext } from './mode/ModeContext.jsx';
import MainShell from './shells/MainShell.jsx';
import PetShell from './shells/PetShell.jsx';
import { desktopBridge } from './services/desktopBridge.js';

const DEFAULT_MODEL = '';
const CONFIG_DRAWER_WIDTH = 420;

const defaultOpenClawSettings = {
  baseUrl: '',
  token: '',
  agentId: 'main',
  hasToken: false,
  hasSecureStorage: true,
};

function normalizeErrorMessage(error) {
  if (!error) {
    return '请求失败，请稍后重试。';
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error?.message === 'string' && error.message) {
    return error.message;
  }

  if (typeof error?.payload?.message === 'string' && error.payload.message) {
    return error.payload.message;
  }

  return '请求失败，请稍后重试。';
}

function AppContent({ desktopMode }) {
  const live2dViewerRef = useRef(null);
  const subtitleTextRef = useRef('');
  const { isPetMode, setMode } = useModeContext();
  const isNarrowViewport = useMediaQuery('(max-width:900px)');

  const [modelLoaded, setModelLoaded] = useState(false);
  const [currentModelPath, setCurrentModelPath] = useState(DEFAULT_MODEL);
  const [motions, setMotions] = useState([]);
  const [expressions, setExpressions] = useState([]);
  const [platform, setPlatform] = useState(() =>
    desktopMode ? desktopBridge.window.getPlatformSync() : 'unknown',
  );

  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [activeConfigTab, setActiveConfigTab] = useState(0);
  const [composerExternalError, setComposerExternalError] = useState('');

  const [openClawSettings, setOpenClawSettings] = useState(defaultOpenClawSettings);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsTesting, setSettingsTesting] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState('');
  const [settingsError, setSettingsError] = useState('');

  const { subtitleText, appendDelta, replaceText, clearSubtitle, beginStream } = useSubtitleFeed();
  const { startStreaming, cancelStreaming, onDelta, onDone, onError, isStreaming } = useStreamingChat();

  const handleModelLoaded = useCallback(() => {
    setModelLoaded(true);
    live2dViewerRef.current?.initAudioContext?.();
  }, []);

  const handleModelError = useCallback((error) => {
    setModelLoaded(false);
    console.error('Model error in App:', error);
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      try {
        const settings = await desktopBridge.settings.get();
        if (!mounted) {
          return;
        }

        setOpenClawSettings({
          ...defaultOpenClawSettings,
          ...settings,
        });
      } catch (error) {
        console.error('Failed to load OpenClaw settings:', error);
      }
    };

    void loadSettings();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    subtitleTextRef.current = subtitleText;
  }, [subtitleText]);

  useEffect(() => {
    const detachDelta = onDelta((delta) => appendDelta(delta));
    const detachDone = onDone(() => replaceText(subtitleTextRef.current));
    const detachError = onError((error) => {
      console.error('字幕流式输出发生错误:', error);
      clearSubtitle();
      setComposerExternalError(normalizeErrorMessage(error));
    });

    return () => {
      detachDelta?.();
      detachDone?.();
      detachError?.();
    };
  }, [appendDelta, clearSubtitle, onDelta, onDone, onError, replaceText]);

  useEffect(() => {
    return () => {
      void cancelStreaming();
    };
  }, [cancelStreaming]);

  useEffect(() => {
    if (!desktopMode) {
      return;
    }

    let mounted = true;
    const loadPlatform = async () => {
      try {
        const result = await desktopBridge.window.getPlatform();
        if (!mounted) {
          return;
        }

        setPlatform(result?.platform || 'unknown');
      } catch (error) {
        console.error('Failed to load platform info:', error);
      }
    };

    void loadPlatform();

    return () => {
      mounted = false;
    };
  }, [desktopMode]);

  const sendUserText = useCallback(
    async (content, options = {}) => {
      if (!content) return;
      beginStream();
      await startStreaming(options.sessionId || 'default', content, options.payload);
    },
    [beginStream, startStreaming],
  );

  const stopStreaming = useCallback(() => {
    void cancelStreaming();
  }, [cancelStreaming]);

  const setDesktopWindowMode = useCallback(
    async (nextMode) => {
      if (nextMode !== MODE_WINDOW && nextMode !== MODE_PET) {
        return;
      }

      if (!desktopMode) {
        return;
      }

      await setMode(nextMode);
    },
    [desktopMode, setMode],
  );

  const updatePetHover = useCallback(
    (componentId, isHovering) => {
      if (!desktopMode) {
        return;
      }

      desktopBridge.mode.updateHover(componentId, isHovering);
    },
    [desktopMode],
  );

  const { bindHover: bindPetHover, setHover: setPetHover } = usePetHoverPassthrough({
    desktopMode,
    isPetMode,
    updateHover: updatePetHover,
  });

  const controlWindow = useCallback(
    async (action) => {
      if (!desktopMode || isPetMode) {
        return;
      }

      try {
        await desktopBridge.window.control(action);
      } catch (error) {
        console.error(`Window control failed: ${action}`, error);
      }
    },
    [desktopMode, isPetMode],
  );

  const submitTextComposer = useCallback(
    async (content) => {
      setComposerExternalError('');
      await sendUserText(content, { sessionId: 'text-composer' });
    },
    [sendUserText],
  );

  const dismissComposerExternalError = useCallback(() => {
    setComposerExternalError('');
  }, []);

  const stageStyle = useMemo(
    () => ({
      height: '100dvh',
      minHeight: '100dvh',
      transition: 'padding-right 220ms ease',
      paddingRight: showConfigPanel && !isPetMode && !isNarrowViewport ? `${CONFIG_DRAWER_WIDTH}px` : 0,
      background: isPetMode
        ? 'transparent'
        : 'radial-gradient(circle at top, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.06)), linear-gradient(180deg, #e5eeff 0%, #f9fbff 100%)',
    }),
    [isNarrowViewport, isPetMode, showConfigPanel],
  );

  const handleControlModelChange = useCallback((modelPath) => {
    setCurrentModelPath(modelPath || '');
    setModelLoaded(false);
  }, []);

  const handleOpenClawSettingChange = useCallback((field, value) => {
    setOpenClawSettings((prev) => ({
      ...prev,
      [field]: value,
    }));
    setSettingsFeedback('');
    setSettingsError('');
  }, []);

  const saveOpenClawSettings = useCallback(async () => {
    setSettingsSaving(true);
    setSettingsError('');
    setSettingsFeedback('');

    try {
      const payload = {
        baseUrl: openClawSettings.baseUrl,
        agentId: openClawSettings.agentId,
      };
      const token = openClawSettings.token.trim();
      if (token) {
        payload.token = token;
      }

      const saved = await desktopBridge.settings.save(payload);
      setOpenClawSettings({
        ...defaultOpenClawSettings,
        ...saved,
      });
      setSettingsFeedback('OpenClaw 配置已保存。');
    } catch (error) {
      console.error('Save OpenClaw settings failed:', error);
      setSettingsError(normalizeErrorMessage(error));
    } finally {
      setSettingsSaving(false);
    }
  }, [openClawSettings.agentId, openClawSettings.baseUrl, openClawSettings.token]);

  const testOpenClawSettings = useCallback(async () => {
    setSettingsTesting(true);
    setSettingsError('');
    setSettingsFeedback('');

    try {
      const payload = {
        baseUrl: openClawSettings.baseUrl,
        agentId: openClawSettings.agentId,
      };
      const token = openClawSettings.token.trim();
      if (token) {
        payload.token = token;
      }

      const result = await desktopBridge.settings.testConnection(payload);
      if (!result?.ok) {
        setSettingsError(normalizeErrorMessage(result?.error));
      } else {
        const latency = typeof result.latencyMs === 'number' ? `（${result.latencyMs}ms）` : '';
        setSettingsFeedback(`OpenClaw 连接成功${latency}`);
      }
    } catch (error) {
      console.error('Test OpenClaw settings failed:', error);
      setSettingsError(normalizeErrorMessage(error));
    } finally {
      setSettingsTesting(false);
    }
  }, [openClawSettings.agentId, openClawSettings.baseUrl, openClawSettings.token]);

  const clearSavedToken = useCallback(async () => {
    setSettingsSaving(true);
    setSettingsError('');
    setSettingsFeedback('');

    try {
      const saved = await desktopBridge.settings.save({ clearToken: true });
      setOpenClawSettings((prev) => ({
        ...prev,
        ...saved,
        token: '',
      }));
      setSettingsFeedback('已清除保存的 Token。');
    } catch (error) {
      console.error('Clear token failed:', error);
      setSettingsError(normalizeErrorMessage(error));
    } finally {
      setSettingsSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!isPetMode) {
      return;
    }

    setShowConfigPanel(false);
  }, [isPetMode]);

  useEffect(() => {
    setModelLoaded(false);
  }, [isPetMode]);

  useEffect(() => {
    if (!showConfigPanel) {
      setActiveConfigTab(0);
    }
  }, [showConfigPanel]);

  const textComposerProps = useMemo(
    () => ({
      isStreaming,
      onSubmit: submitTextComposer,
      onStop: stopStreaming,
      externalError: composerExternalError,
      onDismissExternalError: dismissComposerExternalError,
    }),
    [
      composerExternalError,
      dismissComposerExternalError,
      isStreaming,
      stopStreaming,
      submitTextComposer,
    ],
  );

  return (
    <Box sx={stageStyle}>
      {isPetMode ? (
        <PetShell
          desktopMode={desktopMode}
          platform={platform}
          live2dViewerRef={live2dViewerRef}
          currentModelPath={currentModelPath}
          motions={motions}
          expressions={expressions}
          onModelLoaded={handleModelLoaded}
          onModelError={handleModelError}
          subtitleText={subtitleText}
          onSwitchToWindowMode={() => setDesktopWindowMode(MODE_WINDOW)}
          bindPetHover={bindPetHover}
          setPetHover={setPetHover}
          textComposerProps={textComposerProps}
        />
      ) : (
        <MainShell
          desktopMode={desktopMode}
          platform={platform}
          live2dViewerRef={live2dViewerRef}
          currentModelPath={currentModelPath}
          motions={motions}
          expressions={expressions}
          onModelLoaded={handleModelLoaded}
          onModelError={handleModelError}
          subtitleText={subtitleText}
          onOpenConfigPanel={() => setShowConfigPanel(true)}
          onSwitchToPetMode={() => setDesktopWindowMode(MODE_PET)}
          onWindowControl={controlWindow}
          textComposerProps={textComposerProps}
        />
      )}

      <Drawer
        anchor="right"
        open={showConfigPanel && !isPetMode}
        onClose={() => setShowConfigPanel(false)}
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
              <IconButton onClick={() => setShowConfigPanel(false)}>
                <CloseIcon />
              </IconButton>
              <span>设置面板</span>
              {modelLoaded && <Chip color="success" size="small" label="模型已加载" />}
            </Stack>
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2 }}>
            <Stack spacing={2}>
              <Tabs value={activeConfigTab} onChange={(_, tab) => setActiveConfigTab(tab)} variant="fullWidth">
                <Tab label="Live2D 控制面板" />
                <Tab label="OpenClaw 设置" />
              </Tabs>
              <Divider />

              {activeConfigTab === 0 && (
                <Live2DControls
                  live2dViewerRef={live2dViewerRef}
                  modelLoaded={modelLoaded}
                  isPetMode={isPetMode}
                  onModelChange={handleControlModelChange}
                  onMotionsUpdate={setMotions}
                  onExpressionsUpdate={setExpressions}
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
                    if (!manager) return;
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
                  {!desktopMode && (
                    <Alert severity="warning">
                      当前为 Web 模式，Token 会存入浏览器本地存储，仅建议用于开发测试。
                    </Alert>
                  )}

                  {desktopMode && !openClawSettings.hasSecureStorage && (
                    <Alert severity="warning">系统密钥链不可用，Token 将回退为本地明文存储。</Alert>
                  )}

                  <TextField
                    label="OpenClaw Base URL"
                    value={openClawSettings.baseUrl}
                    onChange={(event) => handleOpenClawSettingChange('baseUrl', event.target.value)}
                    placeholder="http://127.0.0.1:18789"
                    fullWidth
                  />

                  <TextField
                    label="OpenClaw Token"
                    value={openClawSettings.token}
                    onChange={(event) => handleOpenClawSettingChange('token', event.target.value)}
                    type="password"
                    autoComplete="off"
                    placeholder={openClawSettings.hasToken ? '已保存（留空表示不修改）' : ''}
                    fullWidth
                  />

                  <TextField
                    label="OpenClaw Agent ID"
                    value={openClawSettings.agentId}
                    onChange={(event) => handleOpenClawSettingChange('agentId', event.target.value)}
                    placeholder="main"
                    fullWidth
                  />

                  <Stack direction="row" spacing={1}>
                    <Button variant="contained" onClick={saveOpenClawSettings} disabled={settingsSaving || settingsTesting}>
                      {settingsSaving ? '保存中...' : '保存设置'}
                    </Button>
                    <Button variant="outlined" onClick={testOpenClawSettings} disabled={settingsSaving || settingsTesting}>
                      {settingsTesting ? '测试中...' : '连接测试'}
                    </Button>
                    <Button
                      variant="text"
                      color="warning"
                      onClick={clearSavedToken}
                      disabled={settingsSaving || settingsTesting || !openClawSettings.hasToken}
                    >
                      清除 Token
                    </Button>
                  </Stack>

                  {settingsError && <Alert severity="error">{settingsError}</Alert>}
                  {settingsFeedback && <Alert severity="success">{settingsFeedback}</Alert>}
                </Stack>
              )}
            </Stack>
          </Box>
        </Stack>
      </Drawer>
    </Box>
  );
}

export default function App() {
  const desktopMode = desktopBridge.isDesktop();

  return (
    <ModeProvider desktopMode={desktopMode}>
      <AppContent desktopMode={desktopMode} />
    </ModeProvider>
  );
}
