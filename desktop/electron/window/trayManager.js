const { Tray, Menu, nativeImage, app } = require('electron');

function createTrayImage() {
  const svg = encodeURIComponent(
    '<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 16 16\"><circle cx=\"8\" cy=\"8\" r=\"6\" fill=\"#4f8cff\"/></svg>',
  );
  const image = nativeImage.createFromDataURL(`data:image/svg+xml,${svg}`);

  if (image.isEmpty()) {
    return nativeImage.createEmpty();
  }

  return image.resize({ width: process.platform === 'darwin' ? 18 : 16, height: process.platform === 'darwin' ? 18 : 16 });
}

class TrayManager {
  constructor({ onSetMode, onToggleMousePassthrough, onShow, onHide }) {
    this.tray = null;
    this.currentMode = 'window';

    this.onSetMode = onSetMode;
    this.onToggleMousePassthrough = onToggleMousePassthrough;
    this.onShow = onShow;
    this.onHide = onHide;
  }

  create() {
    if (this.tray) {
      return;
    }

    this.tray = new Tray(createTrayImage());
    this.tray.setToolTip('OtakuClaw');
    this.updateMenu();
  }

  setMode(mode) {
    if (mode !== 'window' && mode !== 'pet') {
      return;
    }

    this.currentMode = mode;
    this.updateMenu();
  }

  updateMenu() {
    if (!this.tray) {
      return;
    }

    const menu = Menu.buildFromTemplate([
      {
        label: 'Window Mode',
        type: 'radio',
        checked: this.currentMode === 'window',
        click: () => this.onSetMode?.('window'),
      },
      {
        label: 'Pet Mode',
        type: 'radio',
        checked: this.currentMode === 'pet',
        click: () => this.onSetMode?.('pet'),
      },
      { type: 'separator' },
      ...(this.currentMode === 'pet'
        ? [
            {
              label: 'Toggle Mouse Passthrough',
              click: () => this.onToggleMousePassthrough?.(),
            },
            { type: 'separator' },
          ]
        : []),
      {
        label: 'Show',
        click: () => this.onShow?.(),
      },
      {
        label: 'Hide',
        click: () => this.onHide?.(),
      },
      { type: 'separator' },
      {
        label: 'Exit',
        click: () => app.quit(),
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  destroy() {
    this.tray?.destroy();
    this.tray = null;
  }
}

module.exports = {
  TrayManager,
};
