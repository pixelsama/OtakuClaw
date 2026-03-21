import { Box, Button } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import OfficeScene from '../components/office/OfficeScene.jsx';
import OfficeSceneEditor from '../components/office/OfficeSceneEditor.jsx';
import './RoomStudioShell.css';

export default function RoomStudioShell({
  scene,
  editor,
  onBackToRoom,
  onAgentClick,
  desktopMode = false,
  compact = false,
}) {
  return (
    <section className={`room-studio-shell ${desktopMode ? 'is-desktop' : 'is-web'}`.trim()}>
      <div className="room-studio-shell__backdrop" aria-hidden="true" />

      <header className="room-studio-shell__bar">
        <div className="room-studio-shell__headline">
          <div className="room-studio-shell__eyebrow">Pixel Room Studio</div>
          <h2 className="room-studio-shell__title">{scene?.title || 'Pixel Room'}</h2>
          <p className="room-studio-shell__subtitle">
            {scene?.subtitle || 'Furniture editing workspace'}
          </p>
        </div>

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
      </header>

      <Box className="room-studio-shell__body">
        <div className="room-studio-shell__scene-pane">
          <OfficeScene
            scene={scene}
            compact={compact}
            variant="page"
            presentationMode="browse"
            onAgentClick={onAgentClick}
            className="room-studio-shell__scene"
          />
        </div>

        <aside className="room-studio-shell__editor-pane" aria-label="Pixel room editor workspace">
          {editor ? <OfficeSceneEditor {...editor} /> : null}
        </aside>
      </Box>
    </section>
  );
}
