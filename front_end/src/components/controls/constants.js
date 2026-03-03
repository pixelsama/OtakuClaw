export const STORAGE_KEYS = {
  motionConfig: 'live2d-motion-config',
  expressionConfig: 'live2d_expression_config',
  modelConfig: 'live2d-model-config',
  cachedBackgrounds: 'live2d_cached_backgrounds',
};

export const DEFAULT_MOTIONS = [
  { id: 'm01', name: '待机', group: 'Idle', index: 0, filePath: null, fileName: null, clickAreas: [] },
  {
    id: 'm02',
    name: '点击身体',
    group: 'TapBody',
    index: 0,
    filePath: null,
    fileName: null,
    clickAreas: [],
  },
  {
    id: 'm03',
    name: '点击头部',
    group: 'TapHead',
    index: 0,
    filePath: null,
    fileName: null,
    clickAreas: [],
  },
  { id: 'm04', name: '挥手', group: 'Flick', index: 0, filePath: null, fileName: null, clickAreas: [] },
];

export const DEFAULT_EXPRESSIONS = [
  { id: 'f01', name: '开心', filePath: null, fileName: null, clickAreas: [] },
  { id: 'f02', name: '生气', filePath: null, fileName: null, clickAreas: [] },
  { id: 'f03', name: '惊讶', filePath: null, fileName: null, clickAreas: [] },
  { id: 'f04', name: '伤心', filePath: null, fileName: null, clickAreas: [] },
];

export const DEFAULT_CLICK_AREAS = [
  { id: 'Head', name: 'Head', color: '#FF5722' },
  { id: 'Body', name: 'Body', color: '#2196F3' },
];

export const CLICK_AREA_COLORS = [
  '#FF5722',
  '#E91E63',
  '#2196F3',
  '#4CAF50',
  '#FF9800',
  '#9C27B0',
  '#607D8B',
  '#795548',
  '#009688',
  '#CDDC39',
  '#FFC107',
];
