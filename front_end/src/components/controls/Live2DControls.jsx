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
  Stack,
  Typography,
} from '@mui/material';
import ModelSettingsPanel from './ModelSettingsPanel.jsx';
import MotionPanel from './MotionPanel.jsx';
import ExpressionPanel from './ExpressionPanel.jsx';
import BackgroundPanel from './BackgroundPanel.jsx';
import {
  CLICK_AREA_COLORS,
  DEFAULT_CLICK_AREAS,
  DEFAULT_EXPRESSIONS,
  DEFAULT_MOTIONS,
  STORAGE_KEYS,
} from './constants.js';
import { desktopBridge } from '../../services/desktopBridge.js';
import { useI18n } from '../../i18n/I18nContext.jsx';
import './Live2DControls.css';

// Temporary product decision: hide motion/expression controls from end users for now.
const SHOW_ADVANCED_LIVE2D_CONTROLS = false;
const SUPPORTED_BACKGROUND_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
const SUPPORTED_BACKGROUND_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp']);
const SUPPORTED_BACKGROUND_FILE_ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';

const serializeMotion = (motion) => ({
  id: motion.id,
  name: motion.name,
  group: motion.group,
  index: motion.index,
  filePath: motion.filePath || null,
  fileName: motion.fileName || null,
  clickAreas: motion.clickAreas || [],
});

const serializeExpression = (expression) => ({
  id: expression.id,
  name: expression.name,
  filePath: expression.filePath || null,
  fileName: expression.fileName || null,
  clickAreas: expression.clickAreas || [],
});

const mergeById = (defaults, saved) => {
  if (!Array.isArray(saved)) return defaults;
  const byId = new Map(defaults.map((item) => [item.id, { ...item }]));

  saved.forEach((item) => {
    const current = byId.get(item.id);
    if (current) {
      byId.set(item.id, {
        ...current,
        ...item,
        clickAreas: Array.isArray(item.clickAreas) ? item.clickAreas : current.clickAreas,
      });
    } else {
      byId.set(item.id, {
        ...item,
        clickAreas: Array.isArray(item.clickAreas) ? item.clickAreas : [],
      });
    }
  });

  return Array.from(byId.values());
};

function revokeIfBlob(path) {
  if (path && typeof path === 'string' && path.startsWith('blob:')) {
    URL.revokeObjectURL(path);
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(dataUrl, filename, mimeType) {
  const arr = dataUrl.split(',');
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mimeType });
}

function parseDataUrlMimeType(dataUrl) {
  if (typeof dataUrl !== 'string') {
    return 'image/png';
  }

  const match = /^data:([^;,]+)[;,]/i.exec(dataUrl);
  return match?.[1] || 'image/png';
}

function getFileExtension(filename) {
  if (typeof filename !== 'string') {
    return '';
  }
  const trimmed = filename.trim();
  const dot = trimmed.lastIndexOf('.');
  if (dot <= 0 || dot >= trimmed.length - 1) {
    return '';
  }
  return trimmed.slice(dot + 1).toLowerCase();
}

function isSupportedBackgroundFile(file) {
  if (!file) {
    return false;
  }

  const mimeType = typeof file.type === 'string' ? file.type.trim().toLowerCase() : '';
  if (mimeType && SUPPORTED_BACKGROUND_MIME_TYPES.has(mimeType)) {
    return true;
  }

  const extension = getFileExtension(file.name);
  return Boolean(extension && SUPPORTED_BACKGROUND_EXTENSIONS.has(extension));
}

function makeNewMotionId(motions) {
  return `m${String(motions.length + 1).padStart(2, '0')}`;
}

function makeNewExpressionId(expressions) {
  return `f${String(expressions.length + 1).padStart(2, '0')}`;
}

function parseModelDir(modelPath) {
  if (!modelPath || !modelPath.includes('/')) {
    return '';
  }
  return modelPath.substring(0, modelPath.lastIndexOf('/'));
}

function parseManualFiles(text, suffix, basePath) {
  const names = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return names.map((name) => {
    const withSuffix = name.endsWith(suffix) ? name : `${name}${suffix}`;
    return {
      name: name.replace(suffix, ''),
      path: `${basePath}/${withSuffix}`,
      fileName: withSuffix,
    };
  });
}

function normalizeAssetPath(baseDir, filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return null;
  }

  const trimmedPath = filePath.trim();
  if (/^(https?:)?\/\//.test(trimmedPath) || trimmedPath.startsWith('/')) {
    return trimmedPath;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\/?/i.test(baseDir)) {
    try {
      const normalizedBase = baseDir.endsWith('/') ? baseDir : `${baseDir}/`;
      return new URL(trimmedPath, normalizedBase).toString();
    } catch {
      // fallback below
    }
  }

  return `${baseDir}/${trimmedPath}`.replace(/\/+/g, '/');
}

function extractFileName(filePath) {
  if (typeof filePath !== 'string' || !filePath) {
    return '';
  }

  const parts = filePath.split('/');
  return parts[parts.length - 1] || '';
}

function stripFileSuffix(name, suffix) {
  if (!name) {
    return '';
  }

  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

function parseModelFileReferences(modelPath, modelJson) {
  const modelDir = parseModelDir(modelPath);
  const fileRefs = modelJson?.FileReferences || {};

  const motionFiles = [];
  const motionGroups = fileRefs?.Motions;
  if (motionGroups && typeof motionGroups === 'object') {
    Object.entries(motionGroups).forEach(([group, items]) => {
      if (!Array.isArray(items)) {
        return;
      }

      items.forEach((motion, index) => {
        const fileRefPath = motion?.File;
        const normalizedPath = normalizeAssetPath(modelDir, fileRefPath);
        const fileName = extractFileName(fileRefPath);
        if (!normalizedPath || !fileName) {
          return;
        }

        motionFiles.push({
          group,
          index,
          fileName,
          path: normalizedPath,
          name: stripFileSuffix(fileName, '.motion3.json') || `${group}_${index + 1}`,
        });
      });
    });
  }

  const expressionFiles = [];
  const expressionRefs = Array.isArray(fileRefs?.Expressions) ? fileRefs.Expressions : [];
  expressionRefs.forEach((expressionRef, index) => {
    const fileRefPath = expressionRef?.File;
    const normalizedPath = normalizeAssetPath(modelDir, fileRefPath);
    const fileName = extractFileName(fileRefPath);
    if (!normalizedPath || !fileName) {
      return;
    }

    expressionFiles.push({
      index,
      fileName,
      path: normalizedPath,
      name:
        expressionRef?.Name || stripFileSuffix(fileName, '.exp3.json') || `Expression_${index + 1}`,
    });
  });

  return {
    motionFiles,
    expressionFiles,
  };
}

function buildMotionsFromModelReferences(parsedMotionFiles, previousMotions) {
  const previousByFile = new Map(
    previousMotions
      .filter((motion) => motion?.fileName)
      .map((motion) => [motion.fileName, motion]),
  );

  return parsedMotionFiles.map((file, index) => {
    const previous = previousByFile.get(file.fileName);
    return {
      id: `m${String(index + 1).padStart(2, '0')}`,
      name: file.name,
      group: file.group || 'Idle',
      index: typeof file.index === 'number' ? file.index : 0,
      filePath: file.path,
      fileName: file.fileName,
      fileObject: null,
      clickAreas: Array.isArray(previous?.clickAreas) ? previous.clickAreas : [],
    };
  });
}

function buildExpressionsFromModelReferences(parsedExpressionFiles, previousExpressions) {
  const previousByFile = new Map(
    previousExpressions
      .filter((expression) => expression?.fileName)
      .map((expression) => [expression.fileName, expression]),
  );

  return parsedExpressionFiles.map((file, index) => {
    const previous = previousByFile.get(file.fileName);
    return {
      id: `f${String(index + 1).padStart(2, '0')}`,
      name: file.name,
      filePath: file.path,
      fileName: file.fileName,
      fileObject: null,
      clickAreas: Array.isArray(previous?.clickAreas) ? previous.clickAreas : [],
    };
  });
}

function normalizeModelScale(scale) {
  const rounded = Math.round(scale * 10) / 10;
  return Math.max(0.1, Math.min(3, rounded));
}

function cloneDefaultMotions() {
  return DEFAULT_MOTIONS.map((item) => ({ ...item }));
}

function cloneDefaultExpressions() {
  return DEFAULT_EXPRESSIONS.map((item) => ({ ...item }));
}

function normalizeLive2dState(state = {}) {
  return {
    selectedModelPath:
      typeof state.selectedModelPath === 'string'
        ? state.selectedModelPath
        : typeof state.selectedModel === 'string'
          ? state.selectedModel
          : '',
    modelScale:
      typeof state.modelScale === 'number' ? normalizeModelScale(state.modelScale) : 1,
    autoEyeBlink: typeof state.autoEyeBlink === 'boolean' ? state.autoEyeBlink : true,
    autoBreath: typeof state.autoBreath === 'boolean' ? state.autoBreath : true,
    eyeTracking: typeof state.eyeTracking === 'boolean' ? state.eyeTracking : true,
    motions: Array.isArray(state.motions) ? state.motions : cloneDefaultMotions(),
    expressions: Array.isArray(state.expressions) ? state.expressions : cloneDefaultExpressions(),
  };
}

export default function Live2DControls({
  live2dViewerRef,
  modelLoaded,
  isPetMode = false,
  live2dState = null,
  onLive2dStateChange,
  persistState,
  onModelChange,
  onMotionsUpdate,
  onExpressionsUpdate,
  onAutoEyeBlinkChange,
  onAutoBreathChange,
  onEyeTrackingChange,
  onModelScaleChange,
  onBackgroundChange,
}) {
  const { t } = useI18n();
  const desktopMode = desktopBridge.isDesktop();
  const isControlled = live2dState !== null;
  const shouldPersistState = typeof persistState === 'boolean' ? persistState : !isControlled;

  const [availableModels, setAvailableModels] = useState([]);
  const [internalSelectedModel, setInternalSelectedModel] = useState('');
  const [modelLibraryError, setModelLibraryError] = useState('');
  const [isImportingModel, setIsImportingModel] = useState(false);
  const [internalAutoEyeBlink, setInternalAutoEyeBlink] = useState(true);
  const [internalAutoBreath, setInternalAutoBreath] = useState(true);
  const [internalEyeTracking, setInternalEyeTracking] = useState(true);
  const [internalModelScale, setInternalModelScale] = useState(1.0);

  const [internalMotions, setInternalMotions] = useState(cloneDefaultMotions);
  const [internalExpressions, setInternalExpressions] = useState(cloneDefaultExpressions);

  const [manualMotionFiles, setManualMotionFiles] = useState('');
  const [availableMotionFiles, setAvailableMotionFiles] = useState([]);
  const [newMotionName, setNewMotionName] = useState('');

  const [manualExpressionFiles, setManualExpressionFiles] = useState('');
  const [availableExpressionFiles, setAvailableExpressionFiles] = useState([]);
  const [newExpressionName, setNewExpressionName] = useState('');
  const [isParsingModelFiles, setIsParsingModelFiles] = useState(false);

  const [backgroundImage, setBackgroundImage] = useState(null);
  const [backgroundOpacity, setBackgroundOpacity] = useState(1);
  const [hasBackground, setHasBackground] = useState(false);
  const [cachedBackgrounds, setCachedBackgrounds] = useState([]);
  const [backgroundUploadError, setBackgroundUploadError] = useState('');

  const [isHydrated, setIsHydrated] = useState(false);

  const [showClickAreaDialog, setShowClickAreaDialog] = useState(false);
  const [currentAssociationType, setCurrentAssociationType] = useState('motion');
  const [currentAssociationItemId, setCurrentAssociationItemId] = useState(null);
  const [selectedClickAreas, setSelectedClickAreas] = useState([]);
  const [availableClickAreas, setAvailableClickAreas] = useState(DEFAULT_CLICK_AREAS);

  const resolvedLive2dState = useMemo(
    () =>
      normalizeLive2dState(
        isControlled
          ? live2dState || {}
          : {
              selectedModelPath: internalSelectedModel,
              modelScale: internalModelScale,
              autoEyeBlink: internalAutoEyeBlink,
              autoBreath: internalAutoBreath,
              eyeTracking: internalEyeTracking,
              motions: internalMotions,
              expressions: internalExpressions,
            },
      ),
    [
      internalAutoBreath,
      internalAutoEyeBlink,
      internalExpressions,
      internalEyeTracking,
      internalModelScale,
      internalMotions,
      internalSelectedModel,
      isControlled,
      live2dState,
    ],
  );

  const {
    selectedModelPath: selectedModel,
    modelScale,
    autoEyeBlink,
    autoBreath,
    eyeTracking,
    motions,
    expressions,
  } = resolvedLive2dState;

  const motionsRef = useRef(motions);
  const expressionsRef = useRef(expressions);
  const parseRequestRef = useRef(0);
  const live2dStateRef = useRef(resolvedLive2dState);
  const syncedSelectedModelRef = useRef(selectedModel);

  useEffect(() => {
    motionsRef.current = motions;
  }, [motions]);

  useEffect(() => {
    expressionsRef.current = expressions;
  }, [expressions]);

  useEffect(() => {
    live2dStateRef.current = resolvedLive2dState;
  }, [resolvedLive2dState]);

  const updateDebugInfo = useCallback((message) => {
    const timestamp = new Date().toLocaleTimeString();
    console.debug(`[Live2DControls][${timestamp}] ${message}`);
  }, []);

  const getManager = useCallback(() => {
    return live2dViewerRef?.current?.getManager?.() || null;
  }, [live2dViewerRef]);

  const commitLive2dState = useCallback(
    (patch) => {
      const previousState = live2dStateRef.current;
      const partial = typeof patch === 'function' ? patch(previousState) : patch;

      if (!partial || typeof partial !== 'object') {
        return previousState;
      }

      const nextState = normalizeLive2dState({
        ...previousState,
        ...partial,
      });

      if (!isControlled) {
        if (Object.prototype.hasOwnProperty.call(partial, 'selectedModelPath')) {
          setInternalSelectedModel(nextState.selectedModelPath);
        }
        if (Object.prototype.hasOwnProperty.call(partial, 'modelScale')) {
          setInternalModelScale(nextState.modelScale);
        }
        if (Object.prototype.hasOwnProperty.call(partial, 'autoEyeBlink')) {
          setInternalAutoEyeBlink(nextState.autoEyeBlink);
        }
        if (Object.prototype.hasOwnProperty.call(partial, 'autoBreath')) {
          setInternalAutoBreath(nextState.autoBreath);
        }
        if (Object.prototype.hasOwnProperty.call(partial, 'eyeTracking')) {
          setInternalEyeTracking(nextState.eyeTracking);
        }
        if (Object.prototype.hasOwnProperty.call(partial, 'motions')) {
          setInternalMotions(nextState.motions);
        }
        if (Object.prototype.hasOwnProperty.call(partial, 'expressions')) {
          setInternalExpressions(nextState.expressions);
        }
      }

      live2dStateRef.current = nextState;
      onLive2dStateChange?.(nextState);
      return nextState;
    },
    [isControlled, onLive2dStateChange],
  );

  const saveMotionConfig = useCallback(
    (nextMotions) => {
      const nextState = commitLive2dState({ motions: nextMotions });
      if (shouldPersistState) {
        localStorage.setItem(
          STORAGE_KEYS.motionConfig,
          JSON.stringify({
            motions: nextMotions.map(serializeMotion),
          }),
        );
      }
      onMotionsUpdate?.(nextState.motions);
      onExpressionsUpdate?.(nextState.expressions);
    },
    [commitLive2dState, onExpressionsUpdate, onMotionsUpdate, shouldPersistState],
  );

  const saveExpressionConfig = useCallback(
    (nextExpressions) => {
      const nextState = commitLive2dState({ expressions: nextExpressions });
      if (shouldPersistState) {
        localStorage.setItem(
          STORAGE_KEYS.expressionConfig,
          JSON.stringify(nextExpressions.map(serializeExpression)),
        );
      }
      onExpressionsUpdate?.(nextState.expressions);
    },
    [commitLive2dState, onExpressionsUpdate, shouldPersistState],
  );

  const saveModelConfig = useCallback((config) => {
    if (!shouldPersistState) {
      return;
    }
    localStorage.setItem(STORAGE_KEYS.modelConfig, JSON.stringify(config));
  }, [shouldPersistState]);

  const loadAvailableModels = useCallback(async () => {
    if (!desktopMode) {
      setAvailableModels([]);
      setModelLibraryError(t('controls.unsupportedModelImport'));
      return [];
    }

    try {
      const result = await desktopBridge.models.list();
      const models = Array.isArray(result?.models) ? result.models : [];
      setAvailableModels(models);
      setModelLibraryError('');
      return models;
    } catch (error) {
      console.error('Failed to load model library:', error);
      setAvailableModels([]);
      setModelLibraryError(t('controls.loadModelLibraryFailed'));
      return [];
    }
  }, [desktopMode, t]);

  const updateAvailableClickAreas = useCallback(() => {
    const manager = getManager();
    if (manager && manager.isModelLoaded) {
      const hitAreas = manager.getModelHitAreas();
      const mapped = hitAreas.map((area, index) => ({
        id: area.name,
        name: area.name,
        color: CLICK_AREA_COLORS[index % CLICK_AREA_COLORS.length],
      }));
      if (mapped.length > 0) {
        setAvailableClickAreas(mapped);
        return;
      }
    }
    setAvailableClickAreas(DEFAULT_CLICK_AREAS);
  }, [getManager]);

  const autoParseModelFiles = useCallback(
    async (modelPath) => {
      if (!modelPath) {
        return;
      }

      const requestId = parseRequestRef.current + 1;
      parseRequestRef.current = requestId;
      setIsParsingModelFiles(true);

      try {
        const response = await fetch(modelPath, { cache: 'no-cache' });
        if (!response.ok) {
          throw new Error(`无法读取模型配置（${response.status} ${response.statusText}）`);
        }

        const modelJson = await response.json();
        const { motionFiles, expressionFiles } = parseModelFileReferences(modelPath, modelJson);

        if (parseRequestRef.current !== requestId) {
          return;
        }

        motionsRef.current.forEach((motion) => revokeIfBlob(motion.filePath));
        expressionsRef.current.forEach((expression) => revokeIfBlob(expression.filePath));

        const nextMotions = buildMotionsFromModelReferences(motionFiles, motionsRef.current);
        const nextExpressions = buildExpressionsFromModelReferences(
          expressionFiles,
          expressionsRef.current,
        );

        const finalMotions =
          nextMotions.length > 0 ? nextMotions : DEFAULT_MOTIONS.map((item) => ({ ...item }));
        const finalExpressions =
          nextExpressions.length > 0
            ? nextExpressions
            : DEFAULT_EXPRESSIONS.map((item) => ({ ...item }));

        setAvailableMotionFiles(motionFiles);
        setAvailableExpressionFiles(expressionFiles);

        saveMotionConfig(finalMotions);
        saveExpressionConfig(finalExpressions);

        updateDebugInfo(
          `已从 model3.json 自动解析：${motionFiles.length} 个动作，${expressionFiles.length} 个表情`,
        );
      } catch (error) {
        if (parseRequestRef.current !== requestId) {
          return;
        }

        setAvailableMotionFiles([]);
        setAvailableExpressionFiles([]);
        updateDebugInfo(`自动解析 model3.json 失败: ${error.message}`);
      } finally {
        if (parseRequestRef.current === requestId) {
          setIsParsingModelFiles(false);
        }
      }
    },
    [saveExpressionConfig, saveMotionConfig, updateDebugInfo],
  );

  useEffect(() => {
    if (isHydrated) {
      return;
    }

    let active = true;

    const hydrate = async () => {
      try {
        const initialPatch = {};
        let initialModelPath = selectedModel;

        if (shouldPersistState) {
          const storedMotion = JSON.parse(localStorage.getItem(STORAGE_KEYS.motionConfig) || '{}');
          const mergedMotions = mergeById(DEFAULT_MOTIONS, storedMotion.motions);
          initialPatch.motions = mergedMotions;
          onMotionsUpdate?.(mergedMotions);

          const storedExpressions = JSON.parse(
            localStorage.getItem(STORAGE_KEYS.expressionConfig) || '[]',
          );
          const mergedExpressions = mergeById(DEFAULT_EXPRESSIONS, storedExpressions);
          initialPatch.expressions = mergedExpressions;
          onExpressionsUpdate?.(mergedExpressions);

          const storedModel = JSON.parse(localStorage.getItem(STORAGE_KEYS.modelConfig) || '{}');
          initialModelPath =
            typeof storedModel.selectedModel === 'string' ? storedModel.selectedModel : initialModelPath;

          if (typeof storedModel.modelScale === 'number') {
            initialPatch.modelScale = storedModel.modelScale;
          }
          if (typeof storedModel.autoEyeBlink === 'boolean') {
            initialPatch.autoEyeBlink = storedModel.autoEyeBlink;
          }
          if (typeof storedModel.autoBreath === 'boolean') {
            initialPatch.autoBreath = storedModel.autoBreath;
          }
          if (typeof storedModel.eyeTracking === 'boolean') {
            initialPatch.eyeTracking = storedModel.eyeTracking;
          }
          if (typeof storedModel.backgroundOpacity === 'number') {
            setBackgroundOpacity(storedModel.backgroundOpacity);
          }

          const storedCache = JSON.parse(localStorage.getItem(STORAGE_KEYS.cachedBackgrounds) || '[]');
          if (Array.isArray(storedCache)) {
            setCachedBackgrounds(storedCache);
          }
        }

        const models = await loadAvailableModels();
        if (!active) {
          return;
        }

        if (!models.some((model) => model.path === initialModelPath)) {
          initialModelPath = models[0]?.path || '';
        }

        syncedSelectedModelRef.current = initialModelPath;
        const nextState = commitLive2dState({
          ...initialPatch,
          selectedModelPath: initialModelPath,
        });
        onModelChange?.(initialModelPath);

        if (initialModelPath) {
          void autoParseModelFiles(initialModelPath);
        } else {
          setAvailableMotionFiles([]);
          setAvailableExpressionFiles([]);
          updateDebugInfo(t('controls.noModelHint'));
        }

        if (initialPatch.motions && nextState.motions !== initialPatch.motions) {
          onMotionsUpdate?.(nextState.motions);
        }
        if (initialPatch.expressions && nextState.expressions !== initialPatch.expressions) {
          onExpressionsUpdate?.(nextState.expressions);
        }
      } catch (error) {
        console.error('Failed to restore state from localStorage:', error);
      } finally {
        if (active) {
          setIsHydrated(true);
        }
      }
    };

    void hydrate();

    return () => {
      active = false;
    };
  }, [
    autoParseModelFiles,
    commitLive2dState,
    isHydrated,
    loadAvailableModels,
    onExpressionsUpdate,
    onModelChange,
    onMotionsUpdate,
    selectedModel,
    shouldPersistState,
    t,
    updateDebugInfo,
  ]);

  useEffect(() => {
    if (!isHydrated) {
      syncedSelectedModelRef.current = selectedModel;
      return;
    }

    if (syncedSelectedModelRef.current === selectedModel) {
      return;
    }

    syncedSelectedModelRef.current = selectedModel;
    setManualMotionFiles('');
    setManualExpressionFiles('');

    if (!selectedModel) {
      setAvailableMotionFiles([]);
      setAvailableExpressionFiles([]);
      updateDebugInfo('未选择模型');
      return;
    }

    void autoParseModelFiles(selectedModel);
  }, [autoParseModelFiles, isHydrated, selectedModel, updateDebugInfo]);

  useEffect(() => {
    if (!isHydrated || !modelLoaded) return;

    const manager = getManager();
    if (!manager) return;

    manager.setAutoEyeBlinkEnable(autoEyeBlink);
    manager.setAutoBreathEnable(autoBreath);
    manager.setEyeTracking(eyeTracking);
    updateAvailableClickAreas();

    if (isPetMode) {
      manager.clearBackground();
      manager.setBackgroundOpacity(backgroundOpacity);
      return;
    }

    manager.setModelScale(modelScale);

    let cancelled = false;
    const restoreBackground = async () => {
      if (!hasBackground) {
        manager.clearBackground();
        manager.setBackgroundOpacity(backgroundOpacity);
        return;
      }

      const source = Array.isArray(backgroundImage) ? backgroundImage[0] : null;
      if (!source) {
        manager.setBackgroundOpacity(backgroundOpacity);
        return;
      }

      let file = null;
      if (source instanceof File) {
        file = source;
      } else if (source instanceof Blob) {
        file = new File([source], `background-${Date.now()}.png`, {
          type: source.type || 'image/png',
        });
      } else if (typeof source === 'string' && source.startsWith('data:')) {
        file = dataUrlToFile(
          source,
          `background-${Date.now()}.${parseDataUrlMimeType(source).split('/')[1] || 'png'}`,
          parseDataUrlMimeType(source),
        );
      }

      if (!file) {
        manager.setBackgroundOpacity(backgroundOpacity);
        return;
      }

      const success = await manager.loadBackgroundImage(file);
      if (!cancelled && !success) {
        updateDebugInfo('背景恢复失败，请重新应用背景。');
      }

      if (!cancelled) {
        manager.setBackgroundOpacity(backgroundOpacity);
      }
    };

    void restoreBackground();

    return () => {
      cancelled = true;
    };
  }, [
    autoBreath,
    autoEyeBlink,
    backgroundImage,
    backgroundOpacity,
    eyeTracking,
    getManager,
    hasBackground,
    isPetMode,
    isHydrated,
    modelLoaded,
    modelScale,
    updateDebugInfo,
    updateAvailableClickAreas,
  ]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    saveModelConfig({
      selectedModel,
      modelScale,
      autoEyeBlink,
      autoBreath,
      eyeTracking,
      backgroundOpacity,
      hasBackground,
    });
  }, [
    autoBreath,
    autoEyeBlink,
    backgroundOpacity,
    eyeTracking,
    hasBackground,
    isHydrated,
    modelScale,
    saveModelConfig,
    selectedModel,
  ]);

  useEffect(() => {
    return () => {
      motionsRef.current.forEach((motion) => revokeIfBlob(motion.filePath));
      expressionsRef.current.forEach((expression) => revokeIfBlob(expression.filePath));
    };
  }, []);

  const parseManualMotionFiles = useCallback(() => {
    if (!manualMotionFiles.trim()) {
      void autoParseModelFiles(selectedModel);
      return;
    }
    const modelDir = parseModelDir(selectedModel);
    if (!modelDir) {
      updateDebugInfo('请先选择模型');
      return;
    }
    const files = parseManualFiles(manualMotionFiles, '.motion3.json', `${modelDir}/motions`);
    setAvailableMotionFiles(files);
    updateDebugInfo(`手动添加了 ${files.length} 个动作文件`);
  }, [autoParseModelFiles, manualMotionFiles, selectedModel, updateDebugInfo]);

  const parseManualExpressionFiles = useCallback(() => {
    if (!manualExpressionFiles.trim()) {
      void autoParseModelFiles(selectedModel);
      return;
    }
    const modelDir = parseModelDir(selectedModel);
    if (!modelDir) {
      updateDebugInfo('请先选择模型');
      return;
    }
    const files = parseManualFiles(
      manualExpressionFiles,
      '.exp3.json',
      `${modelDir}/expressions`,
    );
    setAvailableExpressionFiles(files);
    updateDebugInfo(`手动添加了 ${files.length} 个表情文件`);
  }, [autoParseModelFiles, manualExpressionFiles, selectedModel, updateDebugInfo]);

  const addNewMotion = useCallback(() => {
    const trimmed = newMotionName.trim();
    if (!trimmed) {
      updateDebugInfo('请输入动作名称');
      return;
    }

    if (motions.some((motion) => motion.name === trimmed)) {
      updateDebugInfo('动作名称已存在，请使用其他名称');
      return;
    }

    const next = [
      ...motions,
      {
        id: makeNewMotionId(motions),
        name: trimmed,
        group: 'Custom',
        index: 0,
        filePath: null,
        fileName: null,
        fileObject: null,
        clickAreas: [],
      },
    ];

    saveMotionConfig(next);
    setNewMotionName('');
    updateDebugInfo(`已添加新动作: ${trimmed}`);
  }, [motions, newMotionName, saveMotionConfig, updateDebugInfo]);

  const removeMotion = useCallback(
    (motionId) => {
      if (motions.length <= 1) {
        updateDebugInfo('至少需要保留一个动作');
        return;
      }

      const next = motions.filter((motion) => {
        if (motion.id === motionId) {
          revokeIfBlob(motion.filePath);
          return false;
        }
        return true;
      });

      saveMotionConfig(next);
      updateDebugInfo(`已删除动作: ${motionId}`);
    },
    [motions, saveMotionConfig, updateDebugInfo],
  );

  const addNewExpression = useCallback(() => {
    const trimmed = newExpressionName.trim();
    if (!trimmed) {
      updateDebugInfo('请输入表情名称');
      return;
    }

    if (expressions.some((expression) => expression.name === trimmed)) {
      updateDebugInfo('表情名称已存在，请使用其他名称');
      return;
    }

    const next = [
      ...expressions,
      {
        id: makeNewExpressionId(expressions),
        name: trimmed,
        filePath: null,
        fileName: null,
        fileObject: null,
        clickAreas: [],
      },
    ];

    saveExpressionConfig(next);
    setNewExpressionName('');
    updateDebugInfo(`已添加新表情: ${trimmed}`);
  }, [expressions, newExpressionName, saveExpressionConfig, updateDebugInfo]);

  const removeExpression = useCallback(
    (expressionId) => {
      if (expressions.length <= 1) {
        updateDebugInfo('至少需要保留一个表情');
        return;
      }

      const next = expressions.filter((expression) => {
        if (expression.id === expressionId) {
          revokeIfBlob(expression.filePath);
          return false;
        }
        return true;
      });

      saveExpressionConfig(next);
      updateDebugInfo(`已删除表情: ${expressionId}`);
    },
    [expressions, saveExpressionConfig, updateDebugInfo],
  );

  const playMotion = useCallback(
    async (motionGroup, motionIndex, motionId) => {
      const manager = getManager();
      const motion = motions.find((item) => item.id === motionId);
      if (!manager || !motion) {
        return;
      }

      if (motion.filePath) {
        await live2dViewerRef.current?.setMotionFromFile?.(motion.filePath);
        updateDebugInfo(`播放动作: ${motion.name} (使用文件: ${motion.fileName})`);
      } else {
        manager.startMotion(motionGroup, motionIndex, 2);
        updateDebugInfo(`播放动作: ${motionGroup}[${motionIndex}]`);
      }
    },
    [getManager, live2dViewerRef, motions, updateDebugInfo],
  );

  const setExpression = useCallback(
    async (expressionId) => {
      const expression = expressions.find((item) => item.id === expressionId);
      if (!expression) {
        return;
      }

      if (expression.filePath) {
        await live2dViewerRef.current?.setExpressionFromFile?.(expression.filePath);
        updateDebugInfo(`设置表情: ${expression.name} (使用文件: ${expression.fileName})`);
      } else {
        live2dViewerRef.current?.setExpression?.(expressionId);
        updateDebugInfo(`设置表情: ${expression.name}`);
      }
    },
    [expressions, live2dViewerRef, updateDebugInfo],
  );

  const updateMotionFile = useCallback(
    async (motionId, file) => {
      if (!file) return;

      try {
        const text = await file.text();
        const motionData = JSON.parse(text);
        if (!motionData.Version || !motionData.Meta) {
          updateDebugInfo('文件格式不正确，请选择有效的 .motion3.json 文件');
          return;
        }

        const fileUrl = URL.createObjectURL(file);
        const next = motions.map((motion) => {
          if (motion.id !== motionId) return motion;
          revokeIfBlob(motion.filePath);
          return {
            ...motion,
            filePath: fileUrl,
            fileName: file.name,
            fileObject: file,
          };
        });

        saveMotionConfig(next);
        updateDebugInfo(`动作文件已关联: ${file.name}`);
      } catch (error) {
        console.error('Failed to read motion file:', error);
        updateDebugInfo('读取动作文件失败，请检查文件格式');
      }
    },
    [motions, saveMotionConfig, updateDebugInfo],
  );

  const updateExpressionFile = useCallback(
    async (expressionId, file) => {
      if (!file) return;
      if (!file.name.endsWith('.exp3.json')) {
        updateDebugInfo('错误: 请选择 .exp3.json 格式的表情文件');
        return;
      }

      try {
        const text = await file.text();
        const expressionData = JSON.parse(text);
        if (!expressionData.Type || expressionData.Type !== 'Live2D Expression') {
          updateDebugInfo('错误: 不是有效的 Live2D 表情文件');
          return;
        }

        const fileUrl = URL.createObjectURL(file);
        const next = expressions.map((expression) => {
          if (expression.id !== expressionId) return expression;
          revokeIfBlob(expression.filePath);
          return {
            ...expression,
            filePath: fileUrl,
            fileName: file.name,
            fileObject: file,
          };
        });

        saveExpressionConfig(next);
        updateDebugInfo(`表情文件已关联: ${file.name}`);
      } catch (error) {
        console.error('Failed to process expression file:', error);
        updateDebugInfo(`错误: 无法处理表情文件 - ${error.message}`);
      }
    },
    [expressions, saveExpressionConfig, updateDebugInfo],
  );

  const clearMotionFile = useCallback(
    (motionId) => {
      const next = motions.map((motion) => {
        if (motion.id !== motionId) return motion;
        revokeIfBlob(motion.filePath);
        return {
          ...motion,
          filePath: null,
          fileName: null,
          fileObject: null,
        };
      });
      saveMotionConfig(next);
    },
    [motions, saveMotionConfig],
  );

  const clearExpressionFile = useCallback(
    (expressionId) => {
      const next = expressions.map((expression) => {
        if (expression.id !== expressionId) return expression;
        revokeIfBlob(expression.filePath);
        return {
          ...expression,
          filePath: null,
          fileName: null,
          fileObject: null,
        };
      });
      saveExpressionConfig(next);
    },
    [expressions, saveExpressionConfig],
  );

  const linkMotionFile = useCallback(
    async (motionId, motionFile) => {
      const target = motions.find((motion) => motion.id === motionId);
      if (!target || !motionFile) return;

      try {
        const response = await fetch(motionFile.path);
        if (response.ok) {
          const blob = await response.blob();
          const file = new File([blob], motionFile.fileName, { type: 'application/json' });
          await updateMotionFile(motionId, file);
          return;
        }
      } catch {
        // fallback below
      }

      const next = motions.map((motion) => {
        if (motion.id !== motionId) return motion;
        revokeIfBlob(motion.filePath);
        return {
          ...motion,
          filePath: motionFile.path,
          fileName: motionFile.fileName,
          fileObject: null,
        };
      });

      saveMotionConfig(next);
      updateDebugInfo(`动作 ${target.name} 已关联文件路径: ${motionFile.fileName}`);
    },
    [motions, saveMotionConfig, updateDebugInfo, updateMotionFile],
  );

  const linkExpressionFile = useCallback(
    async (expressionId, expressionFile) => {
      const target = expressions.find((expression) => expression.id === expressionId);
      if (!target || !expressionFile) return;

      try {
        const response = await fetch(expressionFile.path);
        if (response.ok) {
          const blob = await response.blob();
          const file = new File([blob], expressionFile.fileName, { type: 'application/json' });
          await updateExpressionFile(expressionId, file);
          return;
        }
      } catch {
        // fallback below
      }

      const next = expressions.map((expression) => {
        if (expression.id !== expressionId) return expression;
        revokeIfBlob(expression.filePath);
        return {
          ...expression,
          filePath: expressionFile.path,
          fileName: expressionFile.fileName,
          fileObject: null,
        };
      });

      saveExpressionConfig(next);
      updateDebugInfo(`表情 ${target.name} 已关联文件路径: ${expressionFile.fileName}`);
    },
    [expressions, saveExpressionConfig, updateDebugInfo, updateExpressionFile],
  );

  const changeModel = useCallback(
    (modelPath) => {
      syncedSelectedModelRef.current = modelPath || '';
      commitLive2dState({ selectedModelPath: modelPath || '' });
      onModelChange?.(modelPath || '');
      setManualMotionFiles('');
      setManualExpressionFiles('');
      if (!modelPath) {
        setAvailableMotionFiles([]);
        setAvailableExpressionFiles([]);
        updateDebugInfo('未选择模型');
        return;
      }

      updateDebugInfo(`切换模型: ${modelPath}`);
      void autoParseModelFiles(modelPath);
    },
    [autoParseModelFiles, commitLive2dState, onModelChange, updateDebugInfo],
  );

  const importModelZip = useCallback(async () => {
    if (!desktopMode) {
      setModelLibraryError(t('controls.unsupportedModelImport'));
      return;
    }

    setIsImportingModel(true);
    setModelLibraryError('');

    try {
      const result = await desktopBridge.models.importZip();
      if (result?.canceled) {
        return;
      }

      if (!result?.ok) {
        const message = result?.error?.message || '导入模型失败。';
        setModelLibraryError(message);
        updateDebugInfo(`导入失败: ${message}`);
        return;
      }

      const models = Array.isArray(result?.models) ? result.models : await loadAvailableModels();
      setAvailableModels(models);
      const importedCount = Array.isArray(result?.imported?.models) ? result.imported.models.length : 0;
      updateDebugInfo(`导入完成：新增 ${importedCount} 个可用模型`);

      if (models.length === 0) {
        onModelChange?.('');
        syncedSelectedModelRef.current = '';
        commitLive2dState({ selectedModelPath: '' });
        return;
      }

      const importedPath = result?.imported?.models?.[0]?.path;
      const nextModelPath =
        (importedPath && models.some((model) => model.path === importedPath) && importedPath) ||
        (selectedModel && models.some((model) => model.path === selectedModel) && selectedModel) ||
        models[0].path;
      changeModel(nextModelPath);
    } catch (error) {
      const message = error?.message || '导入模型失败。';
      setModelLibraryError(message);
      updateDebugInfo(`导入失败: ${message}`);
    } finally {
      setIsImportingModel(false);
    }
  }, [
    changeModel,
    commitLive2dState,
    desktopMode,
    loadAvailableModels,
    onModelChange,
    selectedModel,
    t,
    updateDebugInfo,
  ]);

  const toggleAutoEyeBlink = useCallback(
    (enabled) => {
      commitLive2dState({ autoEyeBlink: enabled });
      getManager()?.setAutoEyeBlinkEnable(enabled);
      onAutoEyeBlinkChange?.(enabled);
      updateDebugInfo(`自动眨眼: ${enabled ? '开启' : '关闭'}`);
    },
    [commitLive2dState, getManager, onAutoEyeBlinkChange, updateDebugInfo],
  );

  const toggleAutoBreath = useCallback(
    (enabled) => {
      commitLive2dState({ autoBreath: enabled });
      getManager()?.setAutoBreathEnable(enabled);
      onAutoBreathChange?.(enabled);
      updateDebugInfo(`自动呼吸: ${enabled ? '开启' : '关闭'}`);
    },
    [commitLive2dState, getManager, onAutoBreathChange, updateDebugInfo],
  );

  const toggleEyeTracking = useCallback(
    (enabled) => {
      commitLive2dState({ eyeTracking: enabled });
      getManager()?.setEyeTracking(enabled);
      onEyeTrackingChange?.(enabled);
      updateDebugInfo(`眼神跟随: ${enabled ? '开启' : '关闭'}`);
    },
    [commitLive2dState, getManager, onEyeTrackingChange, updateDebugInfo],
  );

  const updateModelScale = useCallback(
    (scale) => {
      const normalizedScale = normalizeModelScale(scale);
      if (modelScale === normalizedScale) {
        return;
      }
      commitLive2dState({ modelScale: normalizedScale });
      getManager()?.setModelScale(normalizedScale);
      onModelScaleChange?.(normalizedScale);
    },
    [commitLive2dState, getManager, modelScale, onModelScaleChange],
  );

  const commitModelScale = useCallback(
    (scale) => {
      const normalizedScale = normalizeModelScale(scale);
      updateDebugInfo(`模型大小调整为: ${normalizedScale.toFixed(1)}`);
    },
    [updateDebugInfo],
  );

  const resetModel = useCallback(() => {
    setExpression('f01');
    playMotion('Idle', 0, 'm01');
    updateModelScale(1.0);
    updateDebugInfo('模型已重置到默认状态');
  }, [playMotion, setExpression, updateDebugInfo, updateModelScale]);

  const saveCacheToStorage = useCallback(
    (items) => {
      if (!shouldPersistState) {
        return;
      }
      localStorage.setItem(STORAGE_KEYS.cachedBackgrounds, JSON.stringify(items));
    },
    [shouldPersistState],
  );

  const addToCache = useCallback(
    async (file) => {
      const exists = cachedBackgrounds.some(
        (item) => item.name === file.name && item.size === file.size,
      );
      if (exists) {
        updateDebugInfo(`图片 ${file.name} 已存在于缓存中`);
        return;
      }

      const dataUrl = await fileToDataUrl(file);
      const next = [
        ...cachedBackgrounds,
        {
          id: Date.now().toString(),
          name: file.name,
          dataUrl,
          size: file.size,
          type: file.type,
          uploadTime: new Date().toISOString(),
        },
      ];
      setCachedBackgrounds(next);
      saveCacheToStorage(next);
      updateDebugInfo(`图片 ${file.name} 已添加到缓存`);
    },
    [cachedBackgrounds, saveCacheToStorage, updateDebugInfo],
  );

  const uploadBackground = useCallback(
    async (file) => {
      if (!file) return;
      if (!isSupportedBackgroundFile(file)) {
        const message = t('background.unsupportedFormat');
        setBackgroundUploadError(message);
        updateDebugInfo(`错误: ${message}`);
        return;
      }

      const manager = getManager();
      if (!manager || !manager.isInitialized) {
        const message = '错误: Live2D 管理器未初始化';
        setBackgroundUploadError(message);
        updateDebugInfo(message);
        return;
      }

      setBackgroundUploadError('');
      const success = await manager.loadBackgroundImage(file);
      if (!success) {
        const message = t('background.uploadFailed');
        setBackgroundUploadError(message);
        updateDebugInfo(message);
        return;
      }

      setHasBackground(true);
      setBackgroundImage([file]);
      onBackgroundChange?.({ image: [file], opacity: backgroundOpacity, hasBackground: true });
      await addToCache(file);
      updateDebugInfo(`背景图片上传成功: ${file.name}`);
    },
    [addToCache, backgroundOpacity, getManager, onBackgroundChange, t, updateDebugInfo],
  );

  const selectCachedBackground = useCallback(
    async (cacheItem) => {
      const manager = getManager();
      if (!manager || !manager.isInitialized) {
        updateDebugInfo('错误: Live2D 管理器未初始化');
        return;
      }

      const file = dataUrlToFile(cacheItem.dataUrl, cacheItem.name, cacheItem.type);
      const success = await manager.loadBackgroundImage(file);
      if (!success) {
        updateDebugInfo('缓存背景应用失败');
        return;
      }

      setHasBackground(true);
      setBackgroundImage([file]);
      onBackgroundChange?.({ image: [file], opacity: backgroundOpacity, hasBackground: true });
      updateDebugInfo(`缓存背景应用成功: ${cacheItem.name}`);
    },
    [backgroundOpacity, getManager, onBackgroundChange, updateDebugInfo],
  );

  const removeFromCache = useCallback(
    (cacheId) => {
      const next = cachedBackgrounds.filter((item) => item.id !== cacheId);
      setCachedBackgrounds(next);
      saveCacheToStorage(next);
      updateDebugInfo('已从缓存中删除图片');
    },
    [cachedBackgrounds, saveCacheToStorage, updateDebugInfo],
  );

  const clearAllCache = useCallback(() => {
    setCachedBackgrounds([]);
    saveCacheToStorage([]);
    updateDebugInfo('已清空所有缓存图片');
  }, [saveCacheToStorage, updateDebugInfo]);

  const updateBackgroundOpacity = useCallback(
    (opacity) => {
      setBackgroundOpacity(opacity);
      getManager()?.setBackgroundOpacity(opacity);
      onBackgroundChange?.({ image: backgroundImage, opacity, hasBackground });
      updateDebugInfo(`背景透明度设置为: ${(opacity * 100).toFixed(0)}%`);
    },
    [backgroundImage, getManager, hasBackground, onBackgroundChange, updateDebugInfo],
  );

  const clearBackground = useCallback(() => {
    getManager()?.clearBackground();
    setHasBackground(false);
    setBackgroundImage(null);
    setBackgroundUploadError('');
    onBackgroundChange?.({ image: null, opacity: backgroundOpacity, hasBackground: false });
    updateDebugInfo('背景已清除');
  }, [backgroundOpacity, getManager, onBackgroundChange, updateDebugInfo]);

  const currentAssociationItem = useMemo(() => {
    if (!currentAssociationItemId) return null;
    if (currentAssociationType === 'motion') {
      return motions.find((item) => item.id === currentAssociationItemId) || null;
    }
    return expressions.find((item) => item.id === currentAssociationItemId) || null;
  }, [currentAssociationItemId, currentAssociationType, expressions, motions]);

  const openClickAreaAssociation = useCallback(
    (itemId, type = 'motion') => {
      const item = type === 'motion'
        ? motions.find((motion) => motion.id === itemId)
        : expressions.find((expression) => expression.id === itemId);

      if (!item) return;

      setCurrentAssociationType(type);
      setCurrentAssociationItemId(itemId);
      setSelectedClickAreas(Array.isArray(item.clickAreas) ? [...item.clickAreas] : []);
      setShowClickAreaDialog(true);

      const manager = getManager();
      if (manager && manager.isModelLoaded) {
        manager.startMotion('Idle', 0, 3);
      }
    },
    [expressions, getManager, motions],
  );

  const toggleClickArea = useCallback((areaId) => {
    setSelectedClickAreas((prev) => {
      if (prev.includes(areaId)) {
        return prev.filter((item) => item !== areaId);
      }
      return [...prev, areaId];
    });
  }, []);

  const getAreaConflictItems = useCallback(
    (areaId) => {
      const list = currentAssociationType === 'motion' ? motions : expressions;
      return list.filter(
        (item) =>
          item.id !== currentAssociationItemId &&
          Array.isArray(item.clickAreas) &&
          item.clickAreas.includes(areaId),
      );
    },
    [currentAssociationItemId, currentAssociationType, expressions, motions],
  );

  const selectedAreaConflicts = useMemo(() => {
    return selectedClickAreas
      .map((areaId) => {
        const conflicts = getAreaConflictItems(areaId);
        if (conflicts.length === 0) {
          return null;
        }
        return {
          areaId,
          areaName: availableClickAreas.find((area) => area.id === areaId)?.name || areaId,
          items: conflicts,
        };
      })
      .filter(Boolean);
  }, [availableClickAreas, getAreaConflictItems, selectedClickAreas]);

  const confirmClickAreaAssociation = useCallback(() => {
    if (!currentAssociationItem) {
      return;
    }

    if (currentAssociationType === 'motion') {
      const next = motions.map((motion) =>
        motion.id === currentAssociationItem.id
          ? { ...motion, clickAreas: [...selectedClickAreas] }
          : motion,
      );
      saveMotionConfig(next);
    } else {
      const next = expressions.map((expression) =>
        expression.id === currentAssociationItem.id
          ? { ...expression, clickAreas: [...selectedClickAreas] }
          : expression,
      );
      saveExpressionConfig(next);
    }

    setShowClickAreaDialog(false);
    setCurrentAssociationItemId(null);
    setSelectedClickAreas([]);
    updateDebugInfo(
      `${currentAssociationType === 'motion' ? '动作' : '表情'} ${currentAssociationItem.name} 已更新点击区域关联`,
    );
  }, [
    currentAssociationItem,
    currentAssociationType,
    expressions,
    motions,
    saveExpressionConfig,
    saveMotionConfig,
    selectedClickAreas,
    updateDebugInfo,
  ]);

  const cancelClickAreaAssociation = useCallback(() => {
    setShowClickAreaDialog(false);
    setCurrentAssociationItemId(null);
    setSelectedClickAreas([]);
  }, []);

  const statusChip = selectedModel
    ? (modelLoaded ? t('model.status.loaded') : t('model.status.loading'))
    : t('model.status.unloaded');

  return (
    <Box className="live2d-controls-root">
      <Stack spacing={1.5}>
        {!modelLoaded && (
          <Alert severity={selectedModel ? 'info' : 'warning'} sx={{ py: 0.5 }}>
            {statusChip}
          </Alert>
        )}

        <ModelSettingsPanel
          modelLoaded={modelLoaded}
          availableModels={availableModels}
          selectedModel={selectedModel}
          onChangeModel={changeModel}
          isImportingModel={isImportingModel}
          onImportModelZip={importModelZip}
          modelLibraryError={modelLibraryError}
          autoEyeBlink={autoEyeBlink}
          onToggleAutoEyeBlink={toggleAutoEyeBlink}
          autoBreath={autoBreath}
          onToggleAutoBreath={toggleAutoBreath}
          eyeTracking={eyeTracking}
          onToggleEyeTracking={toggleEyeTracking}
          modelScale={modelScale}
          onChangeModelScale={updateModelScale}
          onCommitModelScale={commitModelScale}
          onResetModel={resetModel}
        />

        {SHOW_ADVANCED_LIVE2D_CONTROLS && (
          <MotionPanel
            modelLoaded={modelLoaded}
            motions={motions}
            availableMotionFiles={availableMotionFiles}
            isParsingModelFiles={isParsingModelFiles}
            manualMotionFiles={manualMotionFiles}
            onManualMotionFilesChange={setManualMotionFiles}
            onParseManualMotionFiles={parseManualMotionFiles}
            newMotionName={newMotionName}
            onNewMotionNameChange={setNewMotionName}
            onAddMotion={addNewMotion}
            onRemoveMotion={removeMotion}
            onLinkMotionFile={linkMotionFile}
            onUploadMotionFile={updateMotionFile}
            onClearMotionFile={clearMotionFile}
            onPlayMotion={playMotion}
            onOpenClickAreaAssociation={openClickAreaAssociation}
          />
        )}

        {SHOW_ADVANCED_LIVE2D_CONTROLS && (
          <ExpressionPanel
            modelLoaded={modelLoaded}
            expressions={expressions}
            availableExpressionFiles={availableExpressionFiles}
            isParsingModelFiles={isParsingModelFiles}
            manualExpressionFiles={manualExpressionFiles}
            onManualExpressionFilesChange={setManualExpressionFiles}
            onParseManualExpressionFiles={parseManualExpressionFiles}
            newExpressionName={newExpressionName}
            onNewExpressionNameChange={setNewExpressionName}
            onAddExpression={addNewExpression}
            onRemoveExpression={removeExpression}
            onLinkExpressionFile={linkExpressionFile}
            onUploadExpressionFile={updateExpressionFile}
            onClearExpressionFile={clearExpressionFile}
            onSetExpression={setExpression}
            onOpenClickAreaAssociation={openClickAreaAssociation}
          />
        )}

        <BackgroundPanel
          hasBackground={hasBackground}
          backgroundOpacity={backgroundOpacity}
          cachedBackgrounds={cachedBackgrounds}
          acceptedFileTypes={SUPPORTED_BACKGROUND_FILE_ACCEPT}
          backgroundUploadError={backgroundUploadError}
          onUploadBackground={uploadBackground}
          onUpdateBackgroundOpacity={updateBackgroundOpacity}
          onClearBackground={clearBackground}
          onSelectCachedBackground={selectCachedBackground}
          onRemoveCachedBackground={removeFromCache}
          onClearAllCache={clearAllCache}
        />

      </Stack>

      <Dialog open={showClickAreaDialog} onClose={cancelClickAreaAssociation} maxWidth="sm" fullWidth>
        <DialogTitle>
          {t('controls.clickAreaDialogTitle')}
          {currentAssociationItem ? ` - ${currentAssociationItem.name}` : ''}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2">{t('controls.clickAreaSelect')}</Typography>

            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {availableClickAreas.map((area) => {
                const selected = selectedClickAreas.includes(area.id);
                return (
                  <Chip
                    key={area.id}
                    label={area.name}
                    clickable
                    color={selected ? 'primary' : 'default'}
                    variant={selected ? 'filled' : 'outlined'}
                    onClick={() => toggleClickArea(area.id)}
                    sx={{
                      borderColor: selected ? area.color : undefined,
                    }}
                  />
                );
              })}
            </Stack>

            {selectedClickAreas.length > 0 && (
              <Box>
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {t('controls.clickAreaSelected')}
                </Typography>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                  {selectedClickAreas.map((areaId) => (
                    <Chip
                      key={areaId}
                      size="small"
                      color="primary"
                      label={availableClickAreas.find((area) => area.id === areaId)?.name || areaId}
                    />
                  ))}
                </Stack>
              </Box>
            )}

            {selectedAreaConflicts.length > 0 && (
              <Alert severity="warning" variant="outlined">
                <Stack spacing={0.5}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t('controls.clickAreaConflict')}
                  </Typography>
                  {selectedAreaConflicts.map((conflict) => (
                    <Typography key={conflict.areaId} variant="caption">
                      {t('controls.clickAreaConflictItem', {
                        areaName: conflict.areaName,
                        items: conflict.items.map((item) => item.name).join('、'),
                      })}
                    </Typography>
                  ))}
                </Stack>
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={cancelClickAreaAssociation}>{t('common.cancel')}</Button>
          <Button onClick={confirmClickAreaAssociation} variant="contained">
            {selectedClickAreas.length === 0
              ? t('controls.clearAssociation')
              : t('controls.confirmAssociation', { count: selectedClickAreas.length })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
