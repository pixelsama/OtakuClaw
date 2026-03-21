import { Button } from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import HomeRepairServiceRoundedIcon from '@mui/icons-material/HomeRepairServiceRounded';
import OfficeScene from '../components/office/OfficeScene.jsx';
import './RoomStudioShell.css';

export default function RoomStudioShell({
  scene,
  editor,
  onBackToRoom,
  compact = false,
  desktopMode = false,
}) {
  const shellClass = [
    'room-studio-shell',
    compact ? 'is-compact' : '',
    desktopMode ? 'is-desktop' : '',
  ].filter(Boolean).join(' ');

  return (
    <section className={shellClass} aria-label="Room Studio">
      {/* Layered decorative background */}
      <div className="room-studio-shell__bg" aria-hidden="true">
        <div className="room-studio-shell__bg-base" />
        <div className="room-studio-shell__bg-glow" />
        <div className="room-studio-shell__bg-grid" />
      </div>

      {/* Navigation header — edit-mode identity layer */}
      <header className="room-studio-shell__header">
        <div className="room-studio-shell__header-start">
          <Button
            className="room-studio-shell__back-btn"
            startIcon={<ArrowBackRoundedIcon />}
            onClick={onBackToRoom}
            aria-label="Back to Pixel Room"
          >
            Back to Room
          </Button>
          <nav className="room-studio-shell__breadcrumb" aria-label="Navigation breadcrumb">
            <span className="room-studio-shell__breadcrumb-item">Pixel Room</span>
            <span className="room-studio-shell__breadcrumb-sep" aria-hidden="true">/</span>
            <span className="room-studio-shell__breadcrumb-item is-active">Room Studio</span>
          </nav>
        </div>

        <div className="room-studio-shell__header-center">
          <span className="room-studio-shell__icon-wrap" aria-hidden="true">
            <HomeRepairServiceRoundedIcon className="room-studio-shell__title-icon" />
          </span>
          <h1 className="room-studio-shell__title">Room Studio</h1>
          <span className="room-studio-shell__mode-badge">Edit Mode</span>
        </div>

        <div className="room-studio-shell__header-end">
          <p className="room-studio-shell__hint">
            <span className="room-studio-shell__hint-item">Drag props to reposition</span>
            <span className="room-studio-shell__hint-sep" aria-hidden="true">·</span>
            <span className="room-studio-shell__hint-item">Click to select &amp; configure</span>
          </p>
        </div>
      </header>

      {/*
       * Office scene in workspace/editor mode.
       * OfficeScene with the editor prop handles drag interaction, furniture
       * selection, and OfficeSceneEditor rendering internally — keeping all
       * state in sync inside the component. Using workspace presentationMode
       * explicitly ensures the editor panel and scene chrome are always shown
       * regardless of whether editor is non-null.
       */}
      <OfficeScene
        scene={scene}
        editor={editor}
        compact={compact}
        variant="page"
        presentationMode="workspace"
        className="room-studio-scene"
      />
    </section>
  );
}
