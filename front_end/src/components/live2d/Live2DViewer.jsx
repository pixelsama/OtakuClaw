import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import CircularProgress from '@mui/material/CircularProgress';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import Live2DManager from '@/live2d/utils/Live2DManager.js';
import './Live2DViewer.css';

function getPointerPosition(event, rect) {
  if ('touches' in event && event.touches.length > 0) {
    const touch = event.touches[0];
    return {
      x: touch.clientX - rect.left,
      y: touch.clientY - rect.top,
    };
  }

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

const Live2DViewer = forwardRef(function Live2DViewer(
  {
    modelPath = '',
    width = 400,
    height = 600,
    motions = [],
    expressions = [],
    onModelLoaded,
    onModelError,
    onAreaClicked,
    className,
  },
  ref,
) {
  const live2dContainerRef = useRef(null);
  const live2dCanvasRef = useRef(null);
  const managerRef = useRef(null);

  const motionRef = useRef(motions);
  const expressionRef = useRef(expressions);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const audioContextRef = useRef(null);
  const analyserNodeRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioBufferRef = useRef(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioContextReady, setAudioContextReady] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);
  const [isTestingLipSync, setIsTestingLipSync] = useState(false);
  const isPlayingAudioRef = useRef(false);
  const audioContextReadyRef = useRef(false);
  const userInteractedRef = useRef(false);
  const initRequestIdRef = useRef(0);

  const animationFrameIdRef = useRef(null);

  useEffect(() => {
    motionRef.current = motions;
  }, [motions]);

  useEffect(() => {
    expressionRef.current = expressions;
  }, [expressions]);

  useEffect(() => {
    isPlayingAudioRef.current = isPlayingAudio;
  }, [isPlayingAudio]);

  useEffect(() => {
    audioContextReadyRef.current = audioContextReady;
  }, [audioContextReady]);

  useEffect(() => {
    userInteractedRef.current = userInteracted;
  }, [userInteracted]);

  const setUserInteractedOnce = useCallback(() => {
    userInteractedRef.current = true;
    setUserInteracted((prev) => (prev ? prev : true));
  }, []);

  const updateModelHitAreas = useCallback(() => {
    const manager = managerRef.current;
    if (manager && manager.isModelLoaded) {
      manager.getModelHitAreas();
    }
  }, []);

  const cleanup = useCallback(() => {
    // Invalidate any in-flight async initialization tasks.
    initRequestIdRef.current += 1;

    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }

    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.disconnect();
      } catch {
        // noop
      }
      audioSourceRef.current = null;
    }

    if (analyserNodeRef.current) {
      try {
        analyserNodeRef.current.disconnect();
      } catch {
        // noop
      }
      analyserNodeRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {
        // noop
      });
    }

    audioContextRef.current = null;
    audioBufferRef.current = null;
    audioContextReadyRef.current = false;
    setAudioContextReady(false);
    isPlayingAudioRef.current = false;
    setIsPlayingAudio(false);

    if (managerRef.current) {
      managerRef.current.release();
      managerRef.current = null;
    }
  }, []);

  const initLive2D = useCallback(async () => {
    const requestId = ++initRequestIdRef.current;

    try {
      if (!modelPath) {
        setLoading(false);
        setError('');
        return;
      }

      setLoading(true);
      setError('');

      if (!live2dCanvasRef.current || !live2dContainerRef.current) {
        throw new Error('Canvas element not found');
      }

      const canvas = live2dCanvasRef.current;
      const containerRect = live2dContainerRef.current.getBoundingClientRect();
      const devicePixelRatio = window.devicePixelRatio || 1;
      const displayWidth = containerRect.width || width;
      const displayHeight = containerRect.height || height;

      canvas.width = displayWidth * devicePixelRatio;
      canvas.height = displayHeight * devicePixelRatio;
      canvas.style.width = '100%';
      canvas.style.height = '100%';

      if (managerRef.current) {
        managerRef.current.release();
      }

      const manager = new Live2DManager();
      managerRef.current = manager;

      await manager.initialize(canvas);
      if (requestId !== initRequestIdRef.current || managerRef.current !== manager) {
        if (managerRef.current === manager) {
          managerRef.current = null;
        }
        manager.release();
        return;
      }

      const model = await manager.loadModel(modelPath);
      if (requestId !== initRequestIdRef.current || managerRef.current !== manager) {
        if (managerRef.current === manager) {
          managerRef.current = null;
        }
        manager.release();
        return;
      }

      manager.startRendering();
      if (requestId !== initRequestIdRef.current || managerRef.current !== manager) {
        if (managerRef.current === manager) {
          managerRef.current = null;
        }
        manager.release();
        return;
      }

      setLoading(false);
      updateModelHitAreas();
      onModelLoaded?.(model);
    } catch (err) {
      if (requestId !== initRequestIdRef.current) {
        // Ignore errors from stale/disposed initialization tasks.
        return;
      }
      console.error('Failed to initialize Live2D:', err);
      setError(`初始化失败: ${err?.message || '未知错误'}`);
      setLoading(false);
      onModelError?.(err);
    }
  }, [height, modelPath, onModelError, onModelLoaded, updateModelHitAreas, width]);

  const randomMotion = useCallback(() => {
    const manager = managerRef.current;
    if (!manager || !manager.isModelLoaded) {
      return;
    }
    manager.startMotion('Idle', 0, 2);
  }, []);

  const findMotionByClickArea = useCallback(
    (relativeX, relativeY) => {
      const manager = managerRef.current;
      const canvas = live2dCanvasRef.current;

      if (!manager || !manager.isModelLoaded || !canvas) {
        return null;
      }

      const screenX = relativeX * canvas.clientWidth;
      const screenY = relativeY * canvas.clientHeight;
      const hitAreaName = manager.hitTestAtScreenCoordinate(screenX, screenY);

      if (!hitAreaName) {
        return null;
      }

      const matchedMotions = motionRef.current.filter(
        (motion) => Array.isArray(motion.clickAreas) && motion.clickAreas.includes(hitAreaName),
      );
      const matchedExpressions = expressionRef.current.filter(
        (expression) =>
          Array.isArray(expression.clickAreas) && expression.clickAreas.includes(hitAreaName),
      );

      if (matchedExpressions.length > 0) {
        const selectedExpression =
          matchedExpressions[Math.floor(Math.random() * matchedExpressions.length)];

        if (selectedExpression.filePath) {
          manager.setExpressionFromFile(selectedExpression.filePath);
          return { type: 'expression', item: selectedExpression };
        }

        if (selectedExpression.fileName) {
          manager.setExpression(selectedExpression.fileName);
          return { type: 'expression', item: selectedExpression };
        }
      }

      if (matchedMotions.length > 0) {
        const selectedMotion = matchedMotions[Math.floor(Math.random() * matchedMotions.length)];

        if (selectedMotion.filePath) {
          manager.setMotionFromFile(selectedMotion.filePath);
        } else {
          manager.startMotion(selectedMotion.group, selectedMotion.index, 2);
        }

        return { type: 'motion', item: selectedMotion };
      }

      onAreaClicked?.(hitAreaName);
      return null;
    },
    [onAreaClicked],
  );

  const handlePointerMove = useCallback(
    (event) => {
      const manager = managerRef.current;
      const canvas = live2dCanvasRef.current;
      if (!manager || !canvas) {
        return;
      }

      setUserInteractedOnce();
      const rect = canvas.getBoundingClientRect();
      const { x, y } = getPointerPosition(event, rect);
      manager.onPointerMove(x, y);
    },
    [setUserInteractedOnce],
  );

  const initAudioContext = useCallback(async () => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      if (audioContextRef.current.state === 'suspended') {
        try {
          await audioContextRef.current.resume();
        } catch (err) {
          console.error('Failed to resume AudioContext:', err);
          return false;
        }
      }
      audioContextReadyRef.current = true;
      setAudioContextReady(true);
      return true;
    }

    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) {
        throw new Error('Browser does not support WebAudio API');
      }

      audioContextRef.current = new AudioContextCtor();
      analyserNodeRef.current = audioContextRef.current.createAnalyser();
      analyserNodeRef.current.fftSize = 256;

      if (audioContextRef.current.state === 'suspended') {
        try {
          await audioContextRef.current.resume();
        } catch (err) {
          console.warn('AudioContext is suspended:', err);
          setAudioContextReady(false);
          return false;
        }
      }

      audioContextReadyRef.current = true;
      setAudioContextReady(true);
      return true;
    } catch (err) {
      console.error('Failed to initialize AudioContext:', err);
      setError('无法初始化音频，语音功能将不可用。请检查浏览器音频权限。');
      audioContextReadyRef.current = false;
      setAudioContextReady(false);
      return false;
    }
  }, []);

  const ensureAudioContextReady = useCallback(async () => {
    if (audioContextReadyRef.current) {
      return true;
    }

    if (!userInteractedRef.current) {
      return false;
    }

    return initAudioContext();
  }, [initAudioContext]);

  const startLipSyncLoop = useCallback(() => {
    const manager = managerRef.current;
    const analyser = analyserNodeRef.current;

    if (!manager || !analyser) {
      return;
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateLipSync = () => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i += 1) {
        sum += dataArray[i];
      }

      const average = sum / bufferLength;
      const volume = Math.min(Math.max(average / 100, 0), 1.0);
      manager.setLipSyncValue(volume);

      if (audioSourceRef.current && isPlayingAudioRef.current) {
        animationFrameIdRef.current = requestAnimationFrame(updateLipSync);
      }
    };

    animationFrameIdRef.current = requestAnimationFrame(updateLipSync);
  }, []);

  const stopAudioAndLipSync = useCallback(() => {
    if (audioSourceRef.current && isPlayingAudioRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch {
        // noop
      }
    }

    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }

    const manager = managerRef.current;
    if (manager) {
      manager.setLipSyncValue(0);
    }

    isPlayingAudioRef.current = false;
    setIsPlayingAudio(false);
  }, []);

  const playAudioWithLipSync = useCallback(
    async (_text, audioUrl = null) => {
      const ready = await ensureAudioContextReady();
      if (!ready) {
        return;
      }

      if (isPlayingAudioRef.current) {
        stopAudioAndLipSync();
      }

      try {
        if (!audioUrl) {
          throw new Error('未提供可播放的音频URL（当前仅支持通过 WebSocket 获取的音频）。');
        }

        const response = await fetch(audioUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch audio: ${response.status}`);
        }

        const audioData = await response.arrayBuffer();
        audioBufferRef.current = await audioContextRef.current.decodeAudioData(audioData);

        audioSourceRef.current = audioContextRef.current.createBufferSource();
        audioSourceRef.current.buffer = audioBufferRef.current;
        audioSourceRef.current.connect(analyserNodeRef.current);
        analyserNodeRef.current.connect(audioContextRef.current.destination);

        audioSourceRef.current.onended = () => {
          isPlayingAudioRef.current = false;
          setIsPlayingAudio(false);
          managerRef.current?.setLipSyncValue(0);
          if (animationFrameIdRef.current) {
            cancelAnimationFrame(animationFrameIdRef.current);
            animationFrameIdRef.current = null;
          }
        };

        audioSourceRef.current.start(0);
        isPlayingAudioRef.current = true;
        setIsPlayingAudio(true);
        startLipSyncLoop();
      } catch (err) {
        console.error('Error during audio playback:', err);
        setIsPlayingAudio(false);
      }
    },
    [ensureAudioContextReady, startLipSyncLoop, stopAudioAndLipSync],
  );

  const testLipSyncAnimation = useCallback(() => {
    const manager = managerRef.current;
    if (!manager || !manager.isModelLoaded || isTestingLipSync) {
      return;
    }

    setUserInteractedOnce();
    setIsTestingLipSync(true);

    const startTime = Date.now();
    const duration = 5000;

    const animateLipSync = () => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / duration;

      if (progress >= 1) {
        manager.setLipSyncValue(0);
        setIsTestingLipSync(false);
        return;
      }

      const time = elapsed / 1000;
      const wave1 = Math.sin(time * 2) * 0.3;
      const wave2 = Math.sin(time * 8) * 0.4;
      const wave3 = Math.sin(time * 15) * 0.2;
      const noise = (Math.random() - 0.5) * 0.1;
      const speechPattern = Math.sin(time * 3) * 0.5 + 0.5;

      let lipValue = (wave1 + wave2 + wave3 + noise + 1) / 2;
      lipValue = Math.max(0, Math.min(1, lipValue));
      lipValue *= speechPattern;

      manager.setLipSyncValue(lipValue);
      requestAnimationFrame(animateLipSync);
    };

    requestAnimationFrame(animateLipSync);
  }, [isTestingLipSync, setUserInteractedOnce]);

  const testRandomMotion = useCallback(() => {
    const manager = managerRef.current;
    if (!manager || !manager.isModelLoaded) {
      return;
    }

    setUserInteractedOnce();
    manager.playRandomMotion('Idle', 3);
  }, [setUserInteractedOnce]);

  const handleCanvasClick = useCallback(
    async (event) => {
      const manager = managerRef.current;
      const canvas = live2dCanvasRef.current;
      if (!manager || !canvas) {
        return;
      }

      const wasInteracted = userInteractedRef.current;
      setUserInteractedOnce();
      if (!wasInteracted) {
        await initAudioContext();
      }

      const rect = canvas.getBoundingClientRect();
      const { x, y } = getPointerPosition(event, rect);
      const relativeX = x / rect.width;
      const relativeY = y / rect.height;

      const clickedResult = findMotionByClickArea(relativeX, relativeY);
      if (!clickedResult) {
        randomMotion();
      }
    },
    [findMotionByClickArea, initAudioContext, randomMotion, setUserInteractedOnce],
  );

  const handleResize = useCallback(() => {
    const manager = managerRef.current;
    const container = live2dContainerRef.current;
    const canvas = live2dCanvasRef.current;

    if (!manager || !container || !canvas) {
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const devicePixelRatio = window.devicePixelRatio || 1;
    const displayWidth = containerRect.width;
    const displayHeight = containerRect.height;

    canvas.width = displayWidth * devicePixelRatio;
    canvas.height = displayHeight * devicePixelRatio;

    if (manager.gl) {
      manager.gl.viewport(0, 0, canvas.width, canvas.height);
      manager.updateViewMatrix();
    }
  }, []);

  useEffect(() => {
    if (!modelPath) {
      cleanup();
      setLoading(false);
      setError('');
      return () => {
        cleanup();
      };
    }

    initLive2D();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      cleanup();
    };
  }, [cleanup, handleResize, initLive2D, modelPath]);

  const speak = useCallback(
    async (text) => {
      return playAudioWithLipSync(text);
    },
    [playAudioWithLipSync],
  );

  const isPointOnModel = useCallback((clientX, clientY, alphaThreshold = 10) => {
    const manager = managerRef.current;
    const canvas = live2dCanvasRef.current;

    if (!manager || !canvas || !manager.isModelLoaded) {
      return false;
    }

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      return false;
    }

    if (typeof manager.isOpaqueAtScreenCoordinate === 'function') {
      return manager.isOpaqueAtScreenCoordinate(x, y, alphaThreshold);
    }

    return Boolean(manager.hitTestAtScreenCoordinate?.(x, y));
  }, []);

  const stopSpeaking = useCallback(() => {
    stopAudioAndLipSync();
  }, [stopAudioAndLipSync]);

  useImperativeHandle(
    ref,
    () => ({
      getManager: () => managerRef.current,
      initAudioContext,
      playAudioWithLipSync,
      stopAudioAndLipSync,
      ensureAudioContextReady,
      speak,
      stopSpeaking,
      getAudioContextReady: () => audioContextReady,
      getUserInteracted: () => userInteracted,
      getIsPlayingAudio: () => isPlayingAudio,
      testLipSyncAnimation,
      testRandomMotion,
      playMotion: (motionGroup, motionIndex = 0) => {
        managerRef.current?.playMotion(motionGroup, motionIndex);
      },
      setExpression: (expressionId) => {
        managerRef.current?.setExpression(expressionId);
      },
      setExpressionFromFile: async (fileUrl) => {
        await managerRef.current?.setExpressionFromFile(fileUrl);
      },
      setMotionFromFile: async (fileUrl) => {
        await managerRef.current?.setMotionFromFile(fileUrl);
      },
      setPointerNormalized: (normalizedX, normalizedY) => {
        managerRef.current?.setPointerNormalized?.(normalizedX, normalizedY);
      },
      syncCanvasSize: () => {
        handleResize();
      },
      isPointOnModel,
    }),
    [
      audioContextReady,
      ensureAudioContextReady,
      initAudioContext,
      isPointOnModel,
      isPlayingAudio,
      playAudioWithLipSync,
      speak,
      stopAudioAndLipSync,
      stopSpeaking,
      handleResize,
      testLipSyncAnimation,
      testRandomMotion,
      userInteracted,
    ],
  );

  const containerClassName = useMemo(
    () => ['live2d-container', className].filter(Boolean).join(' '),
    [className],
  );

  return (
    <div className={containerClassName} ref={live2dContainerRef}>
      <canvas
        ref={live2dCanvasRef}
        className="live2d-canvas"
        onMouseMove={handlePointerMove}
        onClick={handleCanvasClick}
        onTouchMove={handlePointerMove}
      />

      {loading && (
        <div className="loading-overlay">
          <CircularProgress color="primary" size={50} />
          <p>加载Live2D模型中...</p>
        </div>
      )}

      {error && (
        <div className="error-overlay">
          <ErrorOutlineIcon color="error" sx={{ fontSize: 48 }} />
          <p>{error}</p>
        </div>
      )}

      {!modelPath && !loading && !error && (
        <div className="empty-overlay">
          <p>请先在控制面板导入并选择模型 ZIP</p>
        </div>
      )}
    </div>
  );
});

export default Live2DViewer;
