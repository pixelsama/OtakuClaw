import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  TextField,
} from '@mui/material';
import TuneIcon from '@mui/icons-material/Tune';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import Live2DViewer from './components/live2d/Live2DViewer.jsx';
import Live2DControls from './components/controls/Live2DControls.jsx';
import SubtitleBar from './components/subtitle/SubtitleBar.jsx';
import { useStreamingChat } from './hooks/useStreamingChat.js';
import { useSubtitleFeed } from './hooks/useSubtitleFeed.js';

const DEFAULT_MODEL = '/live2d/models/Haru/Haru.model3.json';

export default function App() {
  const live2dViewerRef = useRef(null);
  const subtitleTextRef = useRef('');

  const [modelLoaded, setModelLoaded] = useState(false);
  const [currentModelPath, setCurrentModelPath] = useState(DEFAULT_MODEL);
  const [motions, setMotions] = useState([]);
  const [expressions, setExpressions] = useState([]);

  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [showTextInputDialog, setShowTextInputDialog] = useState(false);
  const [textInputContent, setTextInputContent] = useState('');
  const [textInputError, setTextInputError] = useState('');

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
    subtitleTextRef.current = subtitleText;
  }, [subtitleText]);

  useEffect(() => {
    const detachDelta = onDelta((delta) => appendDelta(delta));
    const detachDone = onDone(() => replaceText(subtitleTextRef.current));
    const detachError = onError((error) => {
      console.error('字幕流式输出发生错误:', error);
      clearSubtitle();
    });

    return () => {
      detachDelta?.();
      detachDone?.();
      detachError?.();
    };
  }, [appendDelta, clearSubtitle, onDelta, onDone, onError, replaceText]);

  useEffect(() => {
    return () => {
      cancelStreaming();
    };
  }, [cancelStreaming]);

  const sendUserText = useCallback(
    async (content, options = {}) => {
      if (!content) return;
      beginStream();
      await startStreaming(options.sessionId || 'default', content, options.payload);
    },
    [beginStream, startStreaming],
  );

  const stopStreaming = useCallback(() => {
    cancelStreaming();
  }, [cancelStreaming]);

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
      setTextInputError('发送失败，请稍后重试。');
    }
  }, [sendUserText, textInputContent]);

  const stageStyle = useMemo(
    () => ({
      minHeight: '100vh',
      background:
        'radial-gradient(circle at top, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.06)), linear-gradient(180deg, #e5eeff 0%, #f9fbff 100%)',
    }),
    [],
  );

  const handleControlModelChange = useCallback((modelPath) => {
    setCurrentModelPath(modelPath);
    setModelLoaded(false);
  }, []);

  return (
    <Box sx={stageStyle}>
      <Box className="live2d-stage">
        <Live2DViewer
          ref={live2dViewerRef}
          modelPath={currentModelPath}
          motions={motions}
          expressions={expressions}
          width={400}
          height={600}
          onModelLoaded={handleModelLoaded}
          onModelError={handleModelError}
          className="live2d-canvas"
        />

        <IconButton className="config-toggle" color="primary" onClick={() => setShowConfigPanel(true)}>
          <TuneIcon />
        </IconButton>

        <IconButton className="text-toggle" color="primary" onClick={openTextInputDialog}>
          <EditIcon />
        </IconButton>

        <SubtitleBar text={subtitleText} />
      </Box>

      <Dialog
        open={showConfigPanel}
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
        </DialogContent>
      </Dialog>

      <Dialog open={showTextInputDialog} onClose={closeTextInputDialog} maxWidth="sm" fullWidth>
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
                  submitTextInput();
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
          <Button variant="contained" onClick={submitTextInput} disabled={isStreaming}>
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
