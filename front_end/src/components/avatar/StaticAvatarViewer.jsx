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
import { useI18n } from '../../i18n/I18nContext.jsx';
import '../live2d/Live2DViewer.css';
import './StaticAvatarViewer.css';

const STATE_FALLBACK_ORDER = ['idle', 'writing', 'researching', 'executing', 'error'];

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeFrameState(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized) {
    return 'idle';
  }
  if (normalized === 'error') {
    return 'error';
  }
  if (normalized === 'executing') {
    return 'executing';
  }
  if (normalized === 'researching' || normalized === 'searching') {
    return 'researching';
  }
  if (
    normalized === 'writing'
    || normalized === 'thinking'
    || normalized === 'streaming'
    || normalized === 'singing'
    || normalized === 'gaming'
  ) {
    return 'writing';
  }
  return 'idle';
}

function resolveStateAsset(states = {}, preferredState = 'idle') {
  const normalizedState = normalizeFrameState(preferredState);
  if (states[normalizedState]) {
    return {
      state: normalizedState,
      src: states[normalizedState],
    };
  }

  for (const fallbackState of STATE_FALLBACK_ORDER) {
    if (states[fallbackState]) {
      return {
        state: fallbackState,
        src: states[fallbackState],
      };
    }
  }

  return {
    state: normalizedState,
    src: '',
  };
}

const StaticAvatarViewer = forwardRef(function StaticAvatarViewer(
  {
    pack = null,
    businessState = 'idle',
    className,
    scale = 1,
    hitTest = null,
    onModelLoaded,
    onModelError,
  },
  ref,
) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentState, setCurrentState] = useState('idle');
  const [currentSrc, setCurrentSrc] = useState('');
  const [modelScale, setModelScale] = useState(clamp(scale, 0.1, 3));

  const containerRef = useRef(null);
  const imageRef = useRef(null);
  const imageCacheRef = useRef(new Map());
  const loadingTasksRef = useRef(new Map());
  const hitCanvasRef = useRef({ state: '', canvas: null });
  const packRef = useRef(pack);
  const currentStateRef = useRef(currentState);
  const modelScaleRef = useRef(modelScale);

  useEffect(() => {
    packRef.current = pack;
  }, [pack]);

  useEffect(() => {
    currentStateRef.current = currentState;
  }, [currentState]);

  useEffect(() => {
    modelScaleRef.current = modelScale;
  }, [modelScale]);

  useEffect(() => {
    setModelScale(clamp(scale, 0.1, 3));
  }, [scale]);

  const loadImage = useCallback((stateKey, src) => {
    if (!src) {
      return Promise.reject(new Error('empty_static_avatar_state_asset'));
    }

    const cached = imageCacheRef.current.get(stateKey);
    if (cached && cached.src === src) {
      return Promise.resolve(cached.image);
    }

    const taskKey = `${stateKey}:${src}`;
    const runningTask = loadingTasksRef.current.get(taskKey);
    if (runningTask) {
      return runningTask;
    }

    const task = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.loading = 'eager';
      image.onload = () => {
        imageCacheRef.current.set(stateKey, {
          src,
          image,
        });
        resolve(image);
      };
      image.onerror = () => {
        reject(new Error(`static_avatar_load_failed:${stateKey}`));
      };
      image.src = src;
    }).finally(() => {
      loadingTasksRef.current.delete(taskKey);
    });

    loadingTasksRef.current.set(taskKey, task);
    return task;
  }, []);

  useEffect(() => {
    const states = pack?.states && typeof pack.states === 'object' ? pack.states : {};
    if (!pack || Object.keys(states).length === 0) {
      setCurrentSrc('');
      setCurrentState('idle');
      setError('');
      setLoading(false);
      return;
    }

    const { state, src } = resolveStateAsset(states, businessState);
    setCurrentState(state);
    setCurrentSrc(src || '');
    setError('');

    if (!src) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    loadImage(state, src)
      .then((image) => {
        if (cancelled) {
          return;
        }
        setLoading(false);
        onModelLoaded?.({
          state,
          src,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }
        setLoading(false);
        const message = typeof loadError?.message === 'string' ? loadError.message : 'static_avatar_load_failed';
        setError(message);
        onModelError?.(loadError);
      });

    for (const [stateKey, stateSrc] of Object.entries(states)) {
      if (!stateSrc || stateKey === state) {
        continue;
      }
      void loadImage(stateKey, stateSrc).catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [businessState, loadImage, onModelError, onModelLoaded, pack]);

  const hitTestConfig = useMemo(() => {
    const fromPack = pack?.hitTest && typeof pack.hitTest === 'object' ? pack.hitTest : {};
    const fromProps = hitTest && typeof hitTest === 'object' ? hitTest : {};
    const modeRaw = `${fromProps.mode || fromPack.mode || 'alpha'}`.trim().toLowerCase();
    const thresholdRaw = Number.parseInt(
      Number.isFinite(fromProps.alphaThreshold) ? fromProps.alphaThreshold : fromPack.alphaThreshold,
      10,
    );

    return {
      mode: modeRaw === 'rect' ? 'rect' : 'alpha',
      alphaThreshold: clamp(Number.isFinite(thresholdRaw) ? thresholdRaw : 10, 0, 255),
    };
  }, [hitTest, pack]);

  const isPointOnModel = useCallback((clientX, clientY, alphaThresholdOverride) => {
    const imageElement = imageRef.current;
    if (!imageElement || !currentSrc) {
      return false;
    }

    const rect = imageElement.getBoundingClientRect();
    if (
      clientX < rect.left
      || clientX > rect.right
      || clientY < rect.top
      || clientY > rect.bottom
    ) {
      return false;
    }

    const mode = hitTestConfig.mode;
    if (mode === 'rect') {
      return true;
    }

    const activeState = currentStateRef.current;
    const cachedImage = imageCacheRef.current.get(activeState)?.image;
    const image = cachedImage || imageElement;
    const naturalWidth = image.naturalWidth || imageElement.naturalWidth;
    const naturalHeight = image.naturalHeight || imageElement.naturalHeight;
    if (!naturalWidth || !naturalHeight) {
      return true;
    }

    const localX = ((clientX - rect.left) / rect.width) * naturalWidth;
    const localY = ((clientY - rect.top) / rect.height) * naturalHeight;
    const pixelX = clamp(Math.floor(localX), 0, Math.max(0, naturalWidth - 1));
    const pixelY = clamp(Math.floor(localY), 0, Math.max(0, naturalHeight - 1));

    const threshold = Number.isFinite(alphaThresholdOverride)
      ? clamp(alphaThresholdOverride, 0, 255)
      : hitTestConfig.alphaThreshold;

    try {
      let hitCanvas = hitCanvasRef.current;
      if (!hitCanvas.canvas || hitCanvas.state !== activeState) {
        const canvas = document.createElement('canvas');
        canvas.width = naturalWidth;
        canvas.height = naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          return true;
        }
        ctx.clearRect(0, 0, naturalWidth, naturalHeight);
        ctx.drawImage(image, 0, 0, naturalWidth, naturalHeight);
        hitCanvas = {
          state: activeState,
          canvas,
        };
        hitCanvasRef.current = hitCanvas;
      }

      const ctx = hitCanvas.canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        return true;
      }

      const alpha = ctx.getImageData(pixelX, pixelY, 1, 1).data[3] || 0;
      return alpha >= threshold;
    } catch {
      return true;
    }
  }, [currentSrc, hitTestConfig.alphaThreshold, hitTestConfig.mode]);

  const managerRef = useRef({
    isModelLoaded: false,
    getModelScale: () => modelScaleRef.current,
    setModelScale: (nextScale) => {
      const normalized = clamp(Number(nextScale), 0.1, 3);
      setModelScale(normalized);
      return normalized;
    },
    setPointerNormalized: () => {},
  });

  managerRef.current.isModelLoaded = Boolean(currentSrc) && !loading && !error;

  useImperativeHandle(ref, () => ({
    getManager: () => managerRef.current,
    syncCanvasSize: () => {},
    setPointerNormalized: () => {},
    isPointOnModel,
    initAudioContext: async () => false,
    ensureAudioContextReady: async () => false,
    playAudioWithLipSync: async () => false,
    stopAudioAndLipSync: () => {},
    speak: async () => false,
    stopSpeaking: () => {},
    getAudioContextReady: () => false,
    getUserInteracted: () => false,
    getIsPlayingAudio: () => false,
    testLipSyncAnimation: () => {},
    testRandomMotion: () => {},
    playMotion: () => {},
    setExpression: () => {},
    setExpressionFromFile: async () => {},
    setMotionFromFile: async () => {},
  }), [isPointOnModel]);

  const containerClassName = useMemo(
    () => ['live2d-container', 'static-avatar-container', className].filter(Boolean).join(' '),
    [className],
  );

  const imageStyle = useMemo(
    () => ({
      '--static-avatar-scale': modelScale,
    }),
    [modelScale],
  );

  return (
    <div className={containerClassName} ref={containerRef}>
      {currentSrc ? (
        <img
          ref={imageRef}
          src={currentSrc}
          alt={pack?.name || 'Static Avatar'}
          className="static-avatar-image"
          draggable={false}
          style={imageStyle}
        />
      ) : null}

      {loading ? (
        <div className="loading-overlay">
          <CircularProgress color="primary" size={50} />
          <p>{t('avatar.loadingStaticAvatar')}</p>
        </div>
      ) : null}

      {error ? (
        <div className="error-overlay">
          <ErrorOutlineIcon color="error" sx={{ fontSize: 48 }} />
          <p>{t('avatar.loadFailed')}</p>
        </div>
      ) : null}

      {!loading && !error && !currentSrc ? (
        <div className="empty-overlay">
          <p>{t('avatar.noStaticAvatarSelected')}</p>
        </div>
      ) : null}
    </div>
  );
});

export default StaticAvatarViewer;
