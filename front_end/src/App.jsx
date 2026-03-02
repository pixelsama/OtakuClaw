import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import Live2DViewer from './components/live2d/Live2DViewer.jsx';
import Live2DControls from './components/controls/Live2DControls.jsx';
import SubtitleBar from './components/subtitle/SubtitleBar.jsx';
import WindowTitleBar from './components/window/WindowTitleBar.jsx';
import { useStreamingChat } from './hooks/useStreamingChat.js';
import { useSubtitleFeed } from './hooks/useSubtitleFeed.js';
import { desktopBridge } from './services/desktopBridge.js';

const DEFAULT_MODEL = '/live2d/models/Haru/Haru.model3.json';
const MODE_WINDOW = 'window';
const MODE_PET = 'pet';

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

export default function App() {
  const live2dViewerRef = useRef(null);
  const subtitleTextRef = useRef('');
  const desktopMode = desktopBridge.isDesktop();

  const [modelLoaded, setModelLoaded] = useState(false);
  const [currentModelPath, setCurrentModelPath] = useState(DEFAULT_MODEL);
  const [motions, setMotions] = useState([]);
  const [expressions, setExpressions] = useState([]);
  const [windowMode, setWindowMode] = useState(MODE_WINDOW);
  const [platform, setPlatform] = useState(() =>
    desktopMode ? desktopBridge.window.getPlatformSync() : 'unknown',
  );

  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [showTextInputDialog, setShowTextInputDialog] = useState(false);
  const [textInputContent, setTextInputContent] = useState('');
  const [textInputError, setTextInputError] = useState('');

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
      setTextInputError(normalizeErrorMessage(error));
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
      return undefined;
    }

    let mounted = true;

    const loadCurrentMode = async () => {
      try {
        const result = await desktopBridge.mode.getCurrent();
        if (!mounted) {
          return;
        }

        const nextMode = result?.mode === MODE_PET ? MODE_PET : MODE_WINDOW;
        setWindowMode(nextMode);
      } catch (error) {
        console.error('Failed to load current window mode:', error);
      }
    };

    const detachPreChanged = desktopBridge.mode.onPreChanged((nextMode) => {
      const targetMode = nextMode === MODE_PET ? MODE_PET : MODE_WINDOW;
      setWindowMode(targetMode);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          desktopBridge.mode.notifyRendererReady(targetMode);
        });
      });
    });

    const detachModeChanged = desktopBridge.mode.onChanged((nextMode) => {
      const targetMode = nextMode === MODE_PET ? MODE_PET : MODE_WINDOW;
      setWindowMode(targetMode);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          desktopBridge.mode.notifyModeRendered(targetMode);
        });
      });
    });

    void loadCurrentMode();

    return () => {
      mounted = false;
      detachPreChanged?.();
      detachModeChanged?.();
    };
  }, [desktopMode]);

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

  const isPetMode = windowMode === MODE_PET;

  const setDesktopWindowMode = useCallback(
    async (nextMode) => {
      if (nextMode !== MODE_WINDOW && nextMode !== MODE_PET) {
        return;
      }

      if (!desktopMode) {
        return;
      }

      try {
        await desktopBridge.mode.set(nextMode);
      } catch (error) {
        console.error('Failed to switch window mode:', error);
      }
    },
    [desktopMode],
  );

  const bindPetHover = useCallback(
    (componentId) => {
      if (!desktopMode || !isPetMode) {
        return {};
      }

      return {
        onMouseEnter: () => desktopBridge.mode.updateHover(componentId, true),
        onMouseLeave: () => desktopBridge.mode.updateHover(componentId, false),
      };
    },
    [desktopMode, isPetMode],
  );

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

  const openTextInputDialog = useCallback(() => {
    setTextInputContent('');
    setTextInputError('');
    setShowTextInputDialog(true);
  }, []);

  const closeTextInputDialog = useCallback(() => {
    if (isStreaming) return;
    setShowTextInputDialog(false);
    setTextInputContent('');
    setTextInputError('');
  }, [isStreaming]);

  const submitTextInput = useCallback(async () => {
    const content = textInputContent.trim();
    if (!content) {
      setTextInputError('请输入要发送的内容。');
      return;
    }

    setTextInputError('');

    try {
      await sendUserText(content, { sessionId: 'text-dialog' });
      setShowTextInputDialog(false);
      setTextInputContent('');
    } catch (error) {
      console.error('发送文字消息失败:', error);
      setTextInputError(normalizeErrorMessage(error));
    }
  }, [sendUserText, textInputContent]);

  const stageStyle = useMemo(
    () => ({
      height: '100dvh',
      minHeight: '100dvh',
      background:
        isPetMode
          ? 'transparent'
          : 'radial-gradient(circle at top, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.06)), linear-gradient(180deg, #e5eeff 0%, #f9fbff 100%)',
    }),
    [isPetMode],
  );

  const handleControlModelChange = useCallback((modelPath) => {
    setCurrentModelPath(modelPath);
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
    setShowTextInputDialog(false);
  }, [isPetMode]);

  return (
    <Box sx={stageStyle}>
      <Box className={`live2d-stage ${isPetMode ? 'pet-mode' : 'window-mode'}`}>
        {desktopMode && !isPetMode && (
          <WindowTitleBar
            platform={platform}
            onMinimize={() => {
              void controlWindow('minimize');
            }}
            onToggleMaximize={() => {
              void controlWindow('toggle-maximize');
            }}
            onClose={() => {
              void controlWindow('close');
            }}
          />
        )}

        <Box className="live2d-hitbox" {...bindPetHover('live2d-hitbox')}>
          <Live2DViewer
            ref={live2dViewerRef}
            modelPath={currentModelPath}
            motions={motions}
            expressions={expressions}
            width={400}
            height={600}
            onModelLoaded={handleModelLoaded}
            onModelError={handleModelError}
            className="live2d-viewer"
          />

          {desktopMode && isPetMode && (
            <Box className="pet-mode-toggle-wrap" {...bindPetHover('pet-mode-toggle-wrap')}>
              <IconButton
                className="pet-mode-toggle"
                color="primary"
                onClick={() => {
                  void setDesktopWindowMode(MODE_WINDOW);
                }}
                title="切换到主窗口模式"
              >
                <SwapHorizIcon />
              </IconButton>
            </Box>
          )}
        </Box>

        {!isPetMode && (
          <IconButton className="config-toggle" color="primary" onClick={() => setShowConfigPanel(true)}>
            <TuneIcon />
          </IconButton>
        )}

        {!isPetMode && (
          <Box className="window-bottom-controls">
            {desktopMode && (
              <IconButton
                className="mode-toggle"
                color="primary"
                onClick={() => {
                  void setDesktopWindowMode(MODE_PET);
                }}
                title="切换到桌宠模式"
              >
                <SwapHorizIcon />
              </IconButton>
            )}
            <IconButton className="text-toggle" color="primary" onClick={openTextInputDialog}>
              <EditIcon />
            </IconButton>
          </Box>
        )}

        <SubtitleBar text={subtitleText} />
      </Box>

      <Dialog
        open={showConfigPanel && !isPetMode}
        onClose={() => setShowConfigPanel(false)}
        maxWidth="sm"
        fullWidth
        keepMounted
      >
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <IconButton onClick={() => setShowConfigPanel(false)}>
              <CloseIcon />
            </IconButton>
            <span>Live2D 控制面板</span>
            {modelLoaded && <Chip color="success" size="small" label="模型已加载" />}
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3}>
            <Live2DControls
              live2dViewerRef={live2dViewerRef}
              modelLoaded={modelLoaded}
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

            <Divider />

            <Stack spacing={2}>
              <Typography variant="h6">OpenClaw 设置</Typography>

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
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog open={showTextInputDialog && !isPetMode} onClose={closeTextInputDialog} maxWidth="sm" fullWidth>
        <DialogTitle>发送文字消息</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              value={textInputContent}
              onChange={(event) => setTextInputContent(event.target.value)}
              multiline
              minRows={3}
              maxRows={8}
              placeholder="输入你想让她说的话..."
              disabled={isStreaming}
              inputProps={{ maxLength: 400 }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submitTextInput();
                }
              }}
            />
            {textInputError && (
              <Box sx={{ color: 'error.main', fontSize: 14, lineHeight: 1.5 }}>{textInputError}</Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={closeTextInputDialog} disabled={isStreaming}>
            取消
          </Button>
          <Button variant="contained" onClick={() => void submitTextInput()} disabled={isStreaming}>
            {isStreaming ? '发送中' : '发送'}
          </Button>
          <Button variant="text" color="warning" onClick={stopStreaming} disabled={!isStreaming}>
            停止流式
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
