import { useEffect, useMemo, useState } from 'react';

function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(100, numeric));
}

function clampPositive(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0.1, Number(numeric.toFixed(3)));
}

function clampOpacity(value, fallback = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, Number(numeric.toFixed(3))));
}

function parseFiniteNumber(value, fallback = null) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return numeric;
}

function parseInteger(value, fallback = null) {
  const numeric = parseFiniteNumber(value, fallback);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.round(numeric);
}

function formatPercent(value) {
  return `${Number(clampPercent(value).toFixed(1))}%`;
}

function formatFrameList(frames = []) {
  if (!Array.isArray(frames) || frames.length === 0) {
    return '';
  }

  return frames.join(', ');
}

function parseFrameList(text = '') {
  if (typeof text !== 'string') {
    return [];
  }

  return text
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => parseInteger(segment, null))
    .filter((frame) => Number.isFinite(frame));
}

function normalizeStateList(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .filter(Boolean)
    .filter((value, index, items) => items.indexOf(value) === index);
}

function formatStateLabel(state = '') {
  if (!state) {
    return '';
  }
  return `${state.charAt(0).toUpperCase()}${state.slice(1)}`;
}

function resolveLayerAnimationMode(animation = null) {
  if (!animation || typeof animation !== 'object') {
    return 'none';
  }
  if (Array.isArray(animation.frames) && animation.frames.length > 0) {
    return 'list';
  }
  if (Number.isFinite(animation.fromFrame) && Number.isFinite(animation.toFrame)) {
    return 'range';
  }
  return 'none';
}

function normalizeLayerId(value, fallbackId = '') {
  if (typeof value !== 'string') {
    return fallbackId;
  }
  const normalized = value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '');
  return normalized || fallbackId;
}

function buildFurnitureHelpText(furniture) {
  if (!furniture) {
    return '';
  }

  const visibleWhenStates = Array.isArray(furniture.visibleWhenStates) ? furniture.visibleWhenStates : [];
  const hiddenWhenStates = Array.isArray(furniture.hiddenWhenStates) ? furniture.hiddenWhenStates : [];
  const variantStates = Array.isArray(furniture.variantStates) ? furniture.variantStates : [];
  const layerCount = Array.isArray(furniture.layers) ? furniture.layers.length : 0;
  const segments = [];
  if (visibleWhenStates.length > 0) {
    segments.push(`Visible when: ${visibleWhenStates.join(', ')}.`);
  }
  if (hiddenWhenStates.length > 0) {
    segments.push(`Hidden when: ${hiddenWhenStates.join(', ')}.`);
  }
  if (variantStates.length > 0) {
    segments.push(`Variant states: ${variantStates.join(', ')}.`);
  }
  segments.push(`${layerCount} layer${layerCount === 1 ? '' : 's'} configured.`);
  segments.push('Drag directly in the room for quick placement.');
  return segments.join(' ');
}

export default function OfficeSceneEditor({
  themeId = '',
  themeOptions = [],
  furniture = [],
  catalog = [],
  catalogCategories = [],
  availableStates = [],
  assetOptions = [],
  selectedFurnitureId = '',
  onSelectFurniture,
  previewMode = 'live',
  onPreviewModeChange,
  onThemeChange,
  onFurniturePatchChange,
  onFurnitureHiddenChange,
  onFurnitureStateRulesChange,
  onFurniturePositionChange,
  onFurnitureLayersChange,
  onFurnitureReset,
  onFurnitureEnabledChange,
}) {
  const [catalogCategoryId, setCatalogCategoryId] = useState('all');
  const [selectedLayerId, setSelectedLayerId] = useState('');
  const selectedFurniture = furniture.find((item) => item.id === selectedFurnitureId) || furniture[0] || null;
  const selectedFurnitureLayers = useMemo(
    () => (Array.isArray(selectedFurniture?.layers) ? selectedFurniture.layers : []),
    [selectedFurniture?.layers],
  );
  const selectedLayer = selectedFurnitureLayers.find((layer) => layer.id === selectedLayerId)
    || selectedFurnitureLayers[0]
    || null;
  const selectedFurnitureAutoStates = selectedFurniture
    ? [
        ...(Array.isArray(selectedFurniture.visibleWhenStates) ? selectedFurniture.visibleWhenStates : []),
        ...(Array.isArray(selectedFurniture.hiddenWhenStates) ? selectedFurniture.hiddenWhenStates : []),
        ...(Array.isArray(selectedFurniture.variantStates) ? selectedFurniture.variantStates : []),
      ]
        .filter((value, index, values) => value && values.indexOf(value) === index)
    : [];
  const availableCatalogCategories = useMemo(
    () => (catalogCategories.length > 0 ? catalogCategories : [{ id: 'all', label: 'All' }]),
    [catalogCategories],
  );
  const filteredCatalog = useMemo(
    () => catalog.filter((item) => catalogCategoryId === 'all' || item.category === catalogCategoryId),
    [catalog, catalogCategoryId],
  );
  const resolvedAvailableStates = useMemo(
    () => (availableStates.length > 0 ? availableStates : ['idle', 'writing', 'researching', 'executing', 'syncing', 'error']),
    [availableStates],
  );
  const resolvedAssetOptions = useMemo(
    () => (Array.isArray(assetOptions) ? assetOptions : []),
    [assetOptions],
  );

  useEffect(() => {
    if (availableCatalogCategories.some((item) => item.id === catalogCategoryId)) {
      return;
    }
    setCatalogCategoryId(availableCatalogCategories[0]?.id || 'all');
  }, [availableCatalogCategories, catalogCategoryId]);

  useEffect(() => {
    if (selectedFurnitureLayers.some((layer) => layer.id === selectedLayerId)) {
      return;
    }
    setSelectedLayerId(selectedFurnitureLayers[0]?.id || '');
  }, [selectedFurnitureLayers, selectedLayerId]);

  const applyFurniturePatch = (patch = {}) => {
    if (!selectedFurniture) {
      return;
    }
    onFurniturePatchChange?.(selectedFurniture.id, patch);
  };

  const applyLayerPatch = (layerId, patch = {}) => {
    if (!selectedFurniture || !layerId) {
      return;
    }

    const nextLayers = selectedFurnitureLayers.map((layer) => {
      if (layer.id !== layerId) {
        return layer;
      }
      const nextLayer = {
        ...layer,
      };
      for (const [field, value] of Object.entries(patch)) {
        if (value === null || typeof value === 'undefined') {
          delete nextLayer[field];
        } else {
          nextLayer[field] = value;
        }
      }
      return nextLayer;
    });
    onFurnitureLayersChange?.(selectedFurniture.id, nextLayers);
  };

  const handleLayerAnimationModeChange = (layer, nextMode) => {
    if (!layer) {
      return;
    }
    if (nextMode === 'none') {
      applyLayerPatch(layer.id, { animation: null });
      return;
    }
    if (nextMode === 'list') {
      applyLayerPatch(layer.id, {
        animation: {
          frames: [0],
          fps: parseFiniteNumber(layer.animation?.fps, 8) || 8,
        },
      });
      return;
    }
    applyLayerPatch(layer.id, {
      animation: {
        fromFrame: parseInteger(layer.animation?.fromFrame, 0) || 0,
        toFrame: parseInteger(layer.animation?.toFrame, 1) || 1,
        fps: parseFiniteNumber(layer.animation?.fps, 8) || 8,
      },
    });
  };

  const handleStateRuleToggle = (state, field, checked) => {
    if (!selectedFurniture) {
      return;
    }

    const visibleStates = new Set(normalizeStateList(selectedFurniture.visibleWhenStates));
    const hiddenStates = new Set(normalizeStateList(selectedFurniture.hiddenWhenStates));
    const normalizedState = typeof state === 'string' ? state.trim().toLowerCase() : '';
    if (!normalizedState) {
      return;
    }

    if (field === 'visible') {
      if (checked) {
        visibleStates.add(normalizedState);
        hiddenStates.delete(normalizedState);
      } else {
        visibleStates.delete(normalizedState);
      }
    } else if (field === 'hidden') {
      if (checked) {
        hiddenStates.add(normalizedState);
        visibleStates.delete(normalizedState);
      } else {
        hiddenStates.delete(normalizedState);
      }
    }

    onFurnitureStateRulesChange?.(selectedFurniture.id, {
      visibleWhenStates: [...visibleStates],
      hiddenWhenStates: [...hiddenStates],
    });
  };

  const handleAddLayer = () => {
    if (!selectedFurniture) {
      return;
    }

    const baseIdPrefix = `${selectedFurniture.id}-layer`;
    let sequence = selectedFurnitureLayers.length + 1;
    let nextLayerId = `${baseIdPrefix}-${sequence}`;
    while (selectedFurnitureLayers.some((layer) => layer.id === nextLayerId)) {
      sequence += 1;
      nextLayerId = `${baseIdPrefix}-${sequence}`;
    }

    const defaultAssetKey = selectedLayer?.assetKey
      || selectedFurniture.assetKey
      || resolvedAssetOptions[0]?.assetKey
      || '';
    const nextLayer = {
      id: nextLayerId,
      assetKey: defaultAssetKey,
      width: Number.isFinite(selectedLayer?.width) ? selectedLayer.width : selectedFurniture.width,
      zIndex: Number.isFinite(selectedLayer?.zIndex)
        ? selectedLayer.zIndex + 1
        : (Number.isFinite(selectedFurniture.zIndex) ? selectedFurniture.zIndex + 1 : 1),
      opacity: 1,
      frameIndex: 0,
      cols: Number.isFinite(selectedLayer?.cols) ? selectedLayer.cols : (Number.isFinite(selectedFurniture.cols) ? selectedFurniture.cols : 1),
      rows: Number.isFinite(selectedLayer?.rows) ? selectedLayer.rows : (Number.isFinite(selectedFurniture.rows) ? selectedFurniture.rows : 1),
      aspectRatio: selectedLayer?.aspectRatio || selectedFurniture.aspectRatio || '1 / 1',
    };
    onFurnitureLayersChange?.(selectedFurniture.id, [...selectedFurnitureLayers, nextLayer]);
    setSelectedLayerId(nextLayer.id);
  };

  const handleRemoveLayer = (layerId) => {
    if (!selectedFurniture) {
      return;
    }

    const nextLayers = selectedFurnitureLayers.filter((layer) => layer.id !== layerId);
    onFurnitureLayersChange?.(selectedFurniture.id, nextLayers);
    if (layerId === selectedLayerId) {
      setSelectedLayerId(nextLayers[0]?.id || '');
    }
  };

  return (
    <aside className="office-room__editor" aria-label="Pixel room editor">
      <div className="office-room__editor-section">
        <div className="office-room__editor-label">Theme</div>
        <label className="office-room__editor-field">
          <span className="office-room__editor-help">Choose the room preset you want to tune.</span>
          <select
            className="office-room__editor-select"
            value={themeId}
            onChange={(event) => {
              onThemeChange?.(event.target.value);
            }}
          >
            {themeOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="office-room__editor-section">
        <div className="office-room__editor-label">Preview</div>
        <div className="office-room__editor-help">
          Force a room state while editing furniture that only appears during specific agent states.
        </div>
        <div className="office-room__editor-pill-group" role="group" aria-label="Pixel room preview mode">
          <button
            type="button"
            className={`office-room__editor-pill ${previewMode === 'live' ? 'is-active' : ''}`.trim()}
            onClick={() => {
              onPreviewModeChange?.('live');
            }}
          >
            Live
          </button>
          <button
            type="button"
            className={`office-room__editor-pill ${previewMode === 'error' ? 'is-active' : ''}`.trim()}
            onClick={() => {
              onPreviewModeChange?.('error');
            }}
          >
            Error Preview
          </button>
        </div>
      </div>

      <div className="office-room__editor-section">
        <div className="office-room__editor-label">Furniture</div>
        <div className="office-room__editor-furniture-list" role="list">
          {furniture.map((item) => (
            <button
              key={item.id}
              type="button"
              className={[
                'office-room__editor-furniture-item',
                item.id === selectedFurniture?.id ? 'is-selected' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => {
                onSelectFurniture?.(item.id);
              }}
            >
              <span className="office-room__editor-furniture-main">
                <span>{item.label}</span>
                <span className={[
                  'office-room__editor-furniture-tag',
                  item.ruleLabel === 'Always' ? 'is-always' : 'is-state',
                ].join(' ')}
                >
                  {item.ruleLabel}
                </span>
              </span>
              <span className="office-room__editor-furniture-meta">
                {item.hidden ? 'Hidden' : item.isVisible ? 'Visible' : 'Waiting'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="office-room__editor-section">
        <div className="office-room__editor-row">
          <div>
            <div className="office-room__editor-label">Library</div>
            <div className="office-room__editor-help">Add or remove scene objects by category.</div>
          </div>
        </div>
        <div className="office-room__editor-pill-group" role="group" aria-label="Pixel room furniture categories">
          {availableCatalogCategories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={`office-room__editor-pill ${catalogCategoryId === category.id ? 'is-active' : ''}`.trim()}
              onClick={() => {
                setCatalogCategoryId(category.id);
              }}
            >
              {category.label}
            </button>
          ))}
        </div>
        <div className="office-room__editor-library-list" role="list">
          {filteredCatalog.map((item) => (
            <button
              key={item.id}
              type="button"
              className={[
                'office-room__editor-library-item',
                item.enabled ? 'is-enabled' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => {
                onFurnitureEnabledChange?.(item.id, !item.enabled);
                if (!item.enabled) {
                  onSelectFurniture?.(item.id);
                }
              }}
            >
              <span className="office-room__editor-furniture-main">
                <span>{item.label}</span>
                <span className="office-room__editor-library-badges">
                  <span className="office-room__editor-furniture-tag is-category">{item.categoryLabel}</span>
                  <span className={[
                    'office-room__editor-furniture-tag',
                    item.ruleLabel === 'Always' ? 'is-always' : 'is-state',
                  ].join(' ')}
                  >
                    {item.ruleLabel}
                  </span>
                </span>
              </span>
              <span className="office-room__editor-furniture-meta">
                {item.enabled ? (item.defaultEnabled ? 'Default' : 'Added') : 'Available'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {selectedFurniture ? (
        <div className="office-room__editor-section office-room__editor-section--detail">
          <div className="office-room__editor-row">
            <div>
              <div className="office-room__editor-label">{selectedFurniture.label}</div>
              <div className="office-room__editor-help">
                {buildFurnitureHelpText(selectedFurniture)}
              </div>
            </div>
            <button
              type="button"
              className="office-room__editor-reset"
              onClick={() => {
                onFurnitureReset?.(selectedFurniture.id);
              }}
            >
              Reset
            </button>
          </div>

          <label className="office-room__editor-toggle">
            <input
              type="checkbox"
              checked={!selectedFurniture.hidden}
              onChange={(event) => {
                onFurnitureHiddenChange?.(selectedFurniture.id, !event.target.checked);
              }}
            />
            <span>Show this furniture</span>
          </label>

          {selectedFurnitureAutoStates.length > 0 ? (
            <div className="office-room__editor-help">
              Active state reaction:
              {' '}
              {selectedFurniture.activeVariantState || (selectedFurniture.isVisible ? 'visible' : 'waiting')}
            </div>
          ) : null}

          <label className="office-room__editor-field">
            <span className="office-room__editor-range-header">
              <span>Horizontal</span>
              <strong>{formatPercent(selectedFurniture.left)}</strong>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={clampPercent(selectedFurniture.left)}
              onChange={(event) => {
                onFurniturePositionChange?.(selectedFurniture.id, {
                  left: Number(event.target.value),
                });
              }}
            />
          </label>

          <label className="office-room__editor-field">
            <span className="office-room__editor-range-header">
              <span>Vertical</span>
              <strong>{formatPercent(selectedFurniture.top)}</strong>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={clampPercent(selectedFurniture.top)}
              onChange={(event) => {
                onFurniturePositionChange?.(selectedFurniture.id, {
                  top: Number(event.target.value),
                });
              }}
            />
          </label>

          <div className="office-room__editor-grid">
            <label className="office-room__editor-field">
              <span className="office-room__editor-range-header">
                <span>Width (%)</span>
                <strong>{Number(clampPositive(selectedFurniture.width, 1).toFixed(2))}</strong>
              </span>
              <input
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                value={clampPositive(selectedFurniture.width, 1)}
                onChange={(event) => {
                  const nextValue = parseFiniteNumber(event.target.value, null);
                  if (!Number.isFinite(nextValue)) {
                    return;
                  }
                  applyFurniturePatch({ width: clampPositive(nextValue, 1) });
                }}
              />
            </label>

            <label className="office-room__editor-field">
              <span className="office-room__editor-range-header">
                <span>Z-Index</span>
                <strong>{parseInteger(selectedFurniture.zIndex, 0) || 0}</strong>
              </span>
              <input
                type="number"
                step="1"
                value={parseInteger(selectedFurniture.zIndex, 0) || 0}
                onChange={(event) => {
                  const nextValue = parseInteger(event.target.value, null);
                  if (!Number.isFinite(nextValue)) {
                    return;
                  }
                  applyFurniturePatch({ zIndex: nextValue });
                }}
              />
            </label>
          </div>

          <label className="office-room__editor-field">
            <span className="office-room__editor-range-header">
              <span>Opacity</span>
              <strong>{clampOpacity(selectedFurniture.opacity, 1).toFixed(2)}</strong>
            </span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={clampOpacity(selectedFurniture.opacity, 1)}
              onChange={(event) => {
                const nextValue = parseFiniteNumber(event.target.value, null);
                if (!Number.isFinite(nextValue)) {
                  return;
                }
                applyFurniturePatch({ opacity: clampOpacity(nextValue, 1) });
              }}
            />
          </label>

          <div className="office-room__editor-subtitle">State Rules</div>
          <div className="office-room__editor-help">
            Use both toggles to control when the furniture appears. A state cannot be visible and hidden at the same time.
          </div>
          <div className="office-room__editor-state-grid">
            <div className="office-room__editor-state-grid-header">State</div>
            <div className="office-room__editor-state-grid-header">Visible</div>
            <div className="office-room__editor-state-grid-header">Hidden</div>
            {resolvedAvailableStates.map((state) => {
              const visible = Array.isArray(selectedFurniture.visibleWhenStates)
                && selectedFurniture.visibleWhenStates.includes(state);
              const hidden = Array.isArray(selectedFurniture.hiddenWhenStates)
                && selectedFurniture.hiddenWhenStates.includes(state);
              return (
                <div key={state} className="office-room__editor-state-grid-row">
                  <span>{formatStateLabel(state)}</span>
                  <label className="office-room__editor-check">
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={(event) => {
                        handleStateRuleToggle(state, 'visible', event.target.checked);
                      }}
                    />
                  </label>
                  <label className="office-room__editor-check">
                    <input
                      type="checkbox"
                      checked={hidden}
                      onChange={(event) => {
                        handleStateRuleToggle(state, 'hidden', event.target.checked);
                      }}
                    />
                  </label>
                </div>
              );
            })}
          </div>

          <div className="office-room__editor-row">
            <div className="office-room__editor-subtitle">Layers</div>
            <button
              type="button"
              className="office-room__editor-reset"
              onClick={handleAddLayer}
            >
              Add Layer
            </button>
          </div>

          <div className="office-room__editor-layer-list" role="list">
            {selectedFurnitureLayers.map((layer) => (
              <div
                key={layer.id}
                role="button"
                tabIndex={0}
                className={[
                  'office-room__editor-layer-item',
                  selectedLayer?.id === layer.id ? 'is-selected' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => {
                  setSelectedLayerId(layer.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedLayerId(layer.id);
                  }
                }}
              >
                <span className="office-room__editor-furniture-main">
                  <span>{layer.id}</span>
                  <span className="office-room__editor-furniture-meta">{layer.assetKey || 'No asset'}</span>
                </span>
                <span className="office-room__editor-layer-actions">
                  <span className="office-room__editor-furniture-tag is-category">z {parseInteger(layer.zIndex, 0) || 0}</span>
                  <button
                    type="button"
                    className="office-room__editor-layer-remove"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleRemoveLayer(layer.id);
                    }}
                    aria-label={`Remove layer ${layer.id}`}
                  >
                    Remove
                  </button>
                </span>
              </div>
            ))}
          </div>

          {selectedLayer ? (
            <div className="office-room__editor-layer-panel">
              <div className="office-room__editor-grid">
                <label className="office-room__editor-field">
                  <span className="office-room__editor-range-header">
                    <span>Layer ID</span>
                  </span>
                  <input
                    type="text"
                    value={selectedLayer.id}
                    onChange={(event) => {
                      const nextLayerId = normalizeLayerId(event.target.value, selectedLayer.id);
                      if (!nextLayerId || nextLayerId === selectedLayer.id) {
                        return;
                      }
                      if (selectedFurnitureLayers.some((layer) => layer.id === nextLayerId)) {
                        return;
                      }
                      applyLayerPatch(selectedLayer.id, { id: nextLayerId });
                      setSelectedLayerId(nextLayerId);
                    }}
                  />
                </label>

                <label className="office-room__editor-field">
                  <span className="office-room__editor-range-header">
                    <span>Asset Key</span>
                  </span>
                  <select
                    className="office-room__editor-select"
                    value={selectedLayer.assetKey || ''}
                    onChange={(event) => {
                      const nextAssetKey = event.target.value;
                      const option = resolvedAssetOptions.find((asset) => asset.assetKey === nextAssetKey);
                      applyLayerPatch(selectedLayer.id, {
                        assetKey: nextAssetKey || null,
                        ...(option ? { cols: option.cols, rows: option.rows } : {}),
                      });
                    }}
                  >
                    {!resolvedAssetOptions.some((asset) => asset.assetKey === selectedLayer.assetKey) && selectedLayer.assetKey ? (
                      <option value={selectedLayer.assetKey}>{selectedLayer.assetKey}</option>
                    ) : null}
                    {resolvedAssetOptions.map((asset) => (
                      <option key={asset.assetKey} value={asset.assetKey}>
                        {asset.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="office-room__editor-grid">
                <label className="office-room__editor-field">
                  <span className="office-room__editor-range-header">
                    <span>Width (%)</span>
                    <strong>{Number(clampPositive(selectedLayer.width, 1).toFixed(2))}</strong>
                  </span>
                  <input
                    type="number"
                    min="0.1"
                    max="100"
                    step="0.1"
                    value={clampPositive(selectedLayer.width, 1)}
                    onChange={(event) => {
                      const nextValue = parseFiniteNumber(event.target.value, null);
                      if (!Number.isFinite(nextValue)) {
                        return;
                      }
                      applyLayerPatch(selectedLayer.id, { width: clampPositive(nextValue, 1) });
                    }}
                  />
                </label>

                <label className="office-room__editor-field">
                  <span className="office-room__editor-range-header">
                    <span>Z-Index</span>
                    <strong>{parseInteger(selectedLayer.zIndex, 0) || 0}</strong>
                  </span>
                  <input
                    type="number"
                    step="1"
                    value={parseInteger(selectedLayer.zIndex, 0) || 0}
                    onChange={(event) => {
                      const nextValue = parseInteger(event.target.value, null);
                      if (!Number.isFinite(nextValue)) {
                        return;
                      }
                      applyLayerPatch(selectedLayer.id, { zIndex: nextValue });
                    }}
                  />
                </label>
              </div>

              <div className="office-room__editor-grid">
                <label className="office-room__editor-field">
                  <span className="office-room__editor-range-header">
                    <span>Frame</span>
                    <strong>{parseInteger(selectedLayer.frameIndex, 0) || 0}</strong>
                  </span>
                  <input
                    type="number"
                    step="1"
                    value={parseInteger(selectedLayer.frameIndex, 0) || 0}
                    onChange={(event) => {
                      const nextValue = parseInteger(event.target.value, null);
                      if (!Number.isFinite(nextValue)) {
                        return;
                      }
                      applyLayerPatch(selectedLayer.id, { frameIndex: Math.max(0, nextValue) });
                    }}
                  />
                </label>

                <label className="office-room__editor-field">
                  <span className="office-room__editor-range-header">
                    <span>Aspect Ratio</span>
                  </span>
                  <input
                    type="text"
                    value={selectedLayer.aspectRatio || ''}
                    onChange={(event) => {
                      const nextAspectRatio = event.target.value.trim();
                      applyLayerPatch(selectedLayer.id, {
                        aspectRatio: nextAspectRatio || null,
                      });
                    }}
                  />
                </label>
              </div>

              <div className="office-room__editor-grid">
                <label className="office-room__editor-field">
                  <span className="office-room__editor-range-header">
                    <span>Cols</span>
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={Math.max(1, parseInteger(selectedLayer.cols, 1) || 1)}
                    onChange={(event) => {
                      const nextValue = parseInteger(event.target.value, null);
                      if (!Number.isFinite(nextValue)) {
                        return;
                      }
                      applyLayerPatch(selectedLayer.id, { cols: Math.max(1, nextValue) });
                    }}
                  />
                </label>

                <label className="office-room__editor-field">
                  <span className="office-room__editor-range-header">
                    <span>Rows</span>
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={Math.max(1, parseInteger(selectedLayer.rows, 1) || 1)}
                    onChange={(event) => {
                      const nextValue = parseInteger(event.target.value, null);
                      if (!Number.isFinite(nextValue)) {
                        return;
                      }
                      applyLayerPatch(selectedLayer.id, { rows: Math.max(1, nextValue) });
                    }}
                  />
                </label>
              </div>

              <label className="office-room__editor-field">
                <span className="office-room__editor-range-header">
                  <span>Layer Opacity</span>
                  <strong>{clampOpacity(selectedLayer.opacity, 1).toFixed(2)}</strong>
                </span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={clampOpacity(selectedLayer.opacity, 1)}
                  onChange={(event) => {
                    const nextValue = parseFiniteNumber(event.target.value, null);
                    if (!Number.isFinite(nextValue)) {
                      return;
                    }
                    applyLayerPatch(selectedLayer.id, { opacity: clampOpacity(nextValue, 1) });
                  }}
                />
              </label>

              <div className="office-room__editor-subtitle">Animation</div>
              <div className="office-room__editor-grid">
                <label className="office-room__editor-field">
                  <span className="office-room__editor-range-header">
                    <span>Mode</span>
                  </span>
                  <select
                    className="office-room__editor-select"
                    value={resolveLayerAnimationMode(selectedLayer.animation)}
                    onChange={(event) => {
                      handleLayerAnimationModeChange(selectedLayer, event.target.value);
                    }}
                  >
                    <option value="none">None</option>
                    <option value="range">Range</option>
                    <option value="list">Frame List</option>
                  </select>
                </label>

                {resolveLayerAnimationMode(selectedLayer.animation) !== 'none' ? (
                  <label className="office-room__editor-field">
                    <span className="office-room__editor-range-header">
                      <span>FPS</span>
                    </span>
                    <input
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={parseFiniteNumber(selectedLayer.animation?.fps, 8) || 8}
                      onChange={(event) => {
                        const nextFps = parseFiniteNumber(event.target.value, null);
                        if (!Number.isFinite(nextFps) || nextFps <= 0) {
                          return;
                        }
                        const mode = resolveLayerAnimationMode(selectedLayer.animation);
                        if (mode === 'list') {
                          applyLayerPatch(selectedLayer.id, {
                            animation: {
                              frames: parseFrameList(formatFrameList(selectedLayer.animation?.frames || [0])),
                              fps: nextFps,
                            },
                          });
                          return;
                        }
                        applyLayerPatch(selectedLayer.id, {
                          animation: {
                            fromFrame: parseInteger(selectedLayer.animation?.fromFrame, 0) || 0,
                            toFrame: parseInteger(selectedLayer.animation?.toFrame, 1) || 1,
                            fps: nextFps,
                          },
                        });
                      }}
                    />
                  </label>
                ) : null}
              </div>

              {resolveLayerAnimationMode(selectedLayer.animation) === 'range' ? (
                <div className="office-room__editor-grid">
                  <label className="office-room__editor-field">
                    <span className="office-room__editor-range-header">
                      <span>From Frame</span>
                    </span>
                    <input
                      type="number"
                      step="1"
                      value={parseInteger(selectedLayer.animation?.fromFrame, 0) || 0}
                      onChange={(event) => {
                        const fromFrame = parseInteger(event.target.value, null);
                        if (!Number.isFinite(fromFrame)) {
                          return;
                        }
                        applyLayerPatch(selectedLayer.id, {
                          animation: {
                            fromFrame,
                            toFrame: parseInteger(selectedLayer.animation?.toFrame, fromFrame) || fromFrame,
                            fps: parseFiniteNumber(selectedLayer.animation?.fps, 8) || 8,
                          },
                        });
                      }}
                    />
                  </label>

                  <label className="office-room__editor-field">
                    <span className="office-room__editor-range-header">
                      <span>To Frame</span>
                    </span>
                    <input
                      type="number"
                      step="1"
                      value={parseInteger(selectedLayer.animation?.toFrame, 1) || 1}
                      onChange={(event) => {
                        const toFrame = parseInteger(event.target.value, null);
                        if (!Number.isFinite(toFrame)) {
                          return;
                        }
                        applyLayerPatch(selectedLayer.id, {
                          animation: {
                            fromFrame: parseInteger(selectedLayer.animation?.fromFrame, 0) || 0,
                            toFrame,
                            fps: parseFiniteNumber(selectedLayer.animation?.fps, 8) || 8,
                          },
                        });
                      }}
                    />
                  </label>
                </div>
              ) : null}

              {resolveLayerAnimationMode(selectedLayer.animation) === 'list' ? (
                <label className="office-room__editor-field">
                  <span className="office-room__editor-range-header">
                    <span>Frames (comma separated)</span>
                  </span>
                  <input
                    type="text"
                    value={formatFrameList(selectedLayer.animation?.frames)}
                    onChange={(event) => {
                      const frames = parseFrameList(event.target.value);
                      applyLayerPatch(selectedLayer.id, {
                        animation: {
                          frames: frames.length > 0 ? frames : [0],
                          fps: parseFiniteNumber(selectedLayer.animation?.fps, 8) || 8,
                        },
                      });
                    }}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
