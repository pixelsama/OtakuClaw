const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { Live2DModelLibrary } = require('../services/live2dModelLibrary');

function createLibraryWithRoot(rootDir) {
  const app = {
    getPath(name) {
      assert.equal(name, 'userData');
      return rootDir;
    },
  };
  return new Live2DModelLibrary(app);
}

test('resolveProtocolUrl supports triple-slash protocol path', () => {
  const root = path.join(os.tmpdir(), 'openclaw-model-lib-test-a');
  const library = createLibraryWithRoot(root);
  const resolved = library.resolveProtocolUrl(
    'openclaw-model:///hiyori-20260302122658-lqbk5k/Hiyori.model3.json',
  );

  assert.equal(
    resolved,
    path.join(root, 'live2d-models', 'hiyori-20260302122658-lqbk5k', 'Hiyori.model3.json'),
  );
});

test('resolveProtocolUrl supports host + pathname protocol path', () => {
  const root = path.join(os.tmpdir(), 'openclaw-model-lib-test-b');
  const library = createLibraryWithRoot(root);
  const resolved = library.resolveProtocolUrl(
    'openclaw-model://hiyori-20260302122658-lqbk5k/Hiyori.model3.json',
  );

  assert.equal(
    resolved,
    path.join(root, 'live2d-models', 'hiyori-20260302122658-lqbk5k', 'Hiyori.model3.json'),
  );
});

test('resolveProtocolUrl rejects path traversal', () => {
  const root = path.join(os.tmpdir(), 'openclaw-model-lib-test-c');
  const library = createLibraryWithRoot(root);

  assert.throws(
    () => library.resolveProtocolUrl('openclaw-model://../outside.model3.json'),
    /invalid_model_path/,
  );
});
