const assert = require('node:assert/strict');
const test = require('node:test');

const { ScreenshotSelectionService } = require('../services/screenshotSelectionService');

function createThumbnail({ empty = true } = {}) {
  return {
    isEmpty: () => empty,
    toDataURL: () => 'data:image/png;base64,abc',
    getSize: () => ({ width: 10, height: 10 }),
  };
}

function createDisplay() {
  return {
    id: 1,
    bounds: {
      width: 1280,
      height: 720,
    },
    scaleFactor: 1,
  };
}

test('captureDisplay returns capture_permission_denied when macOS screen permission is denied', async () => {
  const service = new ScreenshotSelectionService(
    { isPackaged: true },
    {
      desktopCapturerModule: {
        getSources: async () => [
          {
            display_id: '1',
            thumbnail: createThumbnail({ empty: true }),
          },
        ],
      },
      screenModule: {
        getDisplayMatching: () => createDisplay(),
      },
      systemPreferencesModule: {
        getMediaAccessStatus: () => 'denied',
      },
      platform: 'darwin',
    },
  );

  await assert.rejects(
    async () => service.captureDisplay(createDisplay()),
    (error) => error?.message === 'capture_permission_denied',
  );
});

test('captureDisplay keeps generic reason when screen permission is granted but source is unavailable', async () => {
  const service = new ScreenshotSelectionService(
    { isPackaged: true },
    {
      desktopCapturerModule: {
        getSources: async () => [
          {
            display_id: '1',
            thumbnail: createThumbnail({ empty: true }),
          },
        ],
      },
      screenModule: {
        getDisplayMatching: () => createDisplay(),
      },
      systemPreferencesModule: {
        getMediaAccessStatus: () => 'granted',
      },
      platform: 'darwin',
    },
  );

  await assert.rejects(
    async () => service.captureDisplay(createDisplay()),
    (error) => error?.message === 'capture_not_supported',
  );
});
