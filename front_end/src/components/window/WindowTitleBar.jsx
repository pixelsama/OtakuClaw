import { IconButton } from '@mui/material';
import RemoveIcon from '@mui/icons-material/Remove';
import CropSquareIcon from '@mui/icons-material/CropSquare';
import CloseIcon from '@mui/icons-material/Close';
import './WindowTitleBar.css';

export default function WindowTitleBar({
  platform = 'unknown',
  onMinimize,
  onToggleMaximize,
  onClose,
}) {
  const isMac = platform === 'darwin' || platform === 'mac';

  return (
    <div className={`window-titlebar-floating ${isMac ? 'window-titlebar-mac' : 'window-titlebar-win'}`}>
      <div className="window-titlebar-drag-strip" />
      {isMac ? (
        <div className="window-titlebar-mac-controls">
          <button className="window-titlebar-mac-btn close" type="button" onClick={onClose} />
          <button className="window-titlebar-mac-btn minimize" type="button" onClick={onMinimize} />
          <button className="window-titlebar-mac-btn zoom" type="button" onClick={onToggleMaximize} />
        </div>
      ) : (
        <div className="window-titlebar-win-controls">
          <IconButton size="small" className="window-titlebar-win-btn" onClick={onMinimize}>
            <RemoveIcon fontSize="inherit" />
          </IconButton>
          <IconButton size="small" className="window-titlebar-win-btn" onClick={onToggleMaximize}>
            <CropSquareIcon fontSize="inherit" />
          </IconButton>
          <IconButton size="small" className="window-titlebar-win-btn close" onClick={onClose}>
            <CloseIcon fontSize="inherit" />
          </IconButton>
        </div>
      )}
    </div>
  );
}
