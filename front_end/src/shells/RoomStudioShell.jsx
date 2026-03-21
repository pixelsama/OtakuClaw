import { useState } from 'react';
import { Button, Chip, Stack, Typography } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';
import HomeRepairServiceRoundedIcon from '@mui/icons-material/HomeRepairServiceRounded';
import OfficeScene from '../components/office/OfficeScene.jsx';
import OfficeSceneEditor from '../components/office/OfficeSceneEditor.jsx';
import './RoomStudioShell.css';

function normalizeText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function resolveThemeLabel(editor = null) {
  const themeId = normalizeText(editor?.themeId, '');
  const themeOptions = Array.isArray(editor?.themeOptions) ? editor.themeOptions : [];
  const matchedTheme = themeOptions.find((option) => normalizeText(option?.id, '') === themeId);
  return normalizeText(matchedTheme?.label, themeId || 'Room Theme');
}

function countVisibleFurniture(editor = null) {
  const furniture = Array.isArray(editor?.furniture) ? editor.furniture : [];
  return furniture.reduce((count, item) => (item?.hidden ? count : count + 1), 0);
}

export default function RoomStudioShell({
  scene,
  editor,
  onBackToRoom,
  onAgentClick,
  compact = false,
  desktopMode = false,
}) {
  const furniture = Array.isArray(editor?.furniture) ? editor.furniture : [];
  const [selectedFurnitureId, setSelectedFurnitureId] = useState(furniture[0]?.id || '');
  const title = normalizeText(scene?.title, 'Pixel Room');
  const subtitle = normalizeText(scene?.subtitle, 'Room Studio');
  const caption = normalizeText(
    scene?.caption,
    'Tune the room as content: place furniture, switch themes, and shape the stage before returning.',
  );
  const primaryAgentName = normalizeText(scene?.primaryAgent?.displayName, 'OtakuClaw');
  const agentCount = Number.isFinite(scene?.agentCount) ? scene.agentCount : 0;
  const themeLabel = resolveThemeLabel(editor);
  const visibleFurnitureCount = countVisibleFurniture(editor);
  const totalFurnitureCount = Array.isArray(editor?.furniture) ? editor.furniture.length : 0;
  const editable = Boolean(editor);

  return (
    <section
      className={`room-studio-shell ${compact ? 'is-compact' : ''} ${desktopMode ? 'is-desktop' : 'is-web'}`.trim()}
      aria-label="Room Studio"
    >
      <div className="room-studio-shell__backdrop" aria-hidden="true" />

      <div className="room-studio-shell__frame">
        <header className="room-studio-shell__header">
          <div className="room-studio-shell__title-group">
            <div className="room-studio-shell__eyebrow">ROOM STUDIO</div>
            <h1 className="room-studio-shell__title">{title}</h1>
            <p className="room-studio-shell__subtitle">
              {subtitle}
              {' '}
              ·
              {' '}
              {caption}
            </p>
          </div>

          <div className="room-studio-shell__meta">
            <Chip
              className="room-studio-shell__meta-chip"
              icon={<HomeRepairServiceRoundedIcon fontSize="small" />}
              label={editable ? 'Edit mode' : 'Read only'}
              size="small"
            />
            <Chip
              className="room-studio-shell__meta-chip"
              label={themeLabel}
              size="small"
              variant="outlined"
            />
            <Chip
              className="room-studio-shell__meta-chip"
              label={`${visibleFurnitureCount}/${totalFurnitureCount || 0} furniture visible`}
              size="small"
              variant="outlined"
            />
            <Chip
              className="room-studio-shell__meta-chip"
              label={`${agentCount} agent${agentCount === 1 ? '' : 's'} in scene`}
              size="small"
              variant="outlined"
            />
            <Chip
              className="room-studio-shell__meta-chip"
              label={primaryAgentName}
              size="small"
              variant="outlined"
            />
            <Chip
              className="room-studio-shell__meta-chip"
              icon={<DesktopWindowsRoundedIcon fontSize="small" />}
              label={desktopMode ? 'Desktop studio' : 'Browser preview'}
              size="small"
              variant="outlined"
            />
            <Button
              className="room-studio-shell__back-button"
              variant="contained"
              startIcon={<ArrowBackRoundedIcon />}
              onClick={() => {
                onBackToRoom?.();
              }}
            >
              返回房间
            </Button>
          </div>
        </header>

        <div className="room-studio-shell__toolbar">
          <Stack className="room-studio-shell__toolbar-copy" spacing={0.5}>
            <Typography className="room-studio-shell__toolbar-label" variant="overline">
              Workflow
            </Typography>
            <Typography className="room-studio-shell__toolbar-title" variant="h6">
              Edit the room as a content layer
            </Typography>
            <Typography className="room-studio-shell__toolbar-text" variant="body2">
              This mode is for layout, furniture, and theme decisions. The room stays live while you tune it.
            </Typography>
          </Stack>

          <div className="room-studio-shell__toolbar-pill-group" role="group" aria-label="Room studio status">
            <span className="room-studio-shell__toolbar-pill">Live room workspace</span>
            <span className="room-studio-shell__toolbar-pill">Furniture editor attached</span>
            <span className="room-studio-shell__toolbar-pill">Return path ready</span>
          </div>
        </div>

        <div className="room-studio-shell__workspace">
          <div className="room-studio-shell__scene-pane">
            {scene ? (
              // Browse mode: full-bleed room view without chrome. Editor is rendered
              // in the separate editor pane so the scene stays purely visual.
              <OfficeScene
                scene={scene}
                compact={compact}
                presentationMode="browse"
                onAgentClick={onAgentClick}
                className="room-studio-shell__scene"
              />
            ) : (
              <div className="room-studio-shell__empty-state">
                <AutoAwesomeRoundedIcon className="room-studio-shell__empty-icon" />
                <Typography className="room-studio-shell__empty-title" variant="h5">
                  No room scene loaded
                </Typography>
                <Typography className="room-studio-shell__empty-text" variant="body2">
                  The studio shell is ready, but it needs a scene payload before the workspace can render.
                </Typography>
              </div>
            )}
          </div>
          <aside className="room-studio-shell__editor-pane" aria-label="Pixel room editor workspace">
            {editor ? (
              <OfficeSceneEditor
                {...editor}
                selectedFurnitureId={selectedFurnitureId}
                onSelectFurniture={setSelectedFurnitureId}
              />
            ) : null}
          </aside>
        </div>

        <footer className="room-studio-shell__footer">
          <div className="room-studio-shell__footer-note">
            <AutoAwesomeRoundedIcon fontSize="small" />
            <span>Room edits apply immediately and stay inside the Pixel Room content layer.</span>
          </div>
          <Button
            className="room-studio-shell__footer-button"
            variant="outlined"
            onClick={() => {
              onBackToRoom?.();
            }}
          >
            Exit Studio
          </Button>
        </footer>
      </div>
    </section>
  );
}
