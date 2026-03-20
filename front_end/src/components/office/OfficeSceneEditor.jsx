import { useEffect, useMemo, useState } from 'react';

function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, Math.min(100, numeric));
}

function formatPercent(value) {
  return `${Number(clampPercent(value).toFixed(1))}%`;
}

export default function OfficeSceneEditor({
  themeId = '',
  themeOptions = [],
  furniture = [],
  previewMode = 'live',
  onPreviewModeChange,
  onThemeChange,
  onFurnitureHiddenChange,
  onFurniturePositionChange,
  onFurnitureReset,
}) {
  const [selectedFurnitureId, setSelectedFurnitureId] = useState(furniture[0]?.id || '');

  useEffect(() => {
    if (furniture.some((item) => item.id === selectedFurnitureId)) {
      return;
    }

    setSelectedFurnitureId(furniture[0]?.id || '');
  }, [furniture, selectedFurnitureId]);

  const selectedFurniture = useMemo(
    () => furniture.find((item) => item.id === selectedFurnitureId) || furniture[0] || null,
    [furniture, selectedFurnitureId],
  );

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
                setSelectedFurnitureId(item.id);
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

      {selectedFurniture ? (
        <div className="office-room__editor-section office-room__editor-section--detail">
          <div className="office-room__editor-row">
            <div>
              <div className="office-room__editor-label">{selectedFurniture.label}</div>
              <div className="office-room__editor-help">
                {selectedFurniture.visibleWhenStates.length > 0
                  ? `Auto-shows during: ${selectedFurniture.visibleWhenStates.join(', ')}.`
                  : 'Always available in the current theme.'}
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
        </div>
      ) : null}
    </aside>
  );
}
