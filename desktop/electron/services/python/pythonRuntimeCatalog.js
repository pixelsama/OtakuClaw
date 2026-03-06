const DEFAULT_PYTHON_VERSION = '3.12.12';

const PYTHON_RUNTIME_PACKAGES = {
  '3.12.12': {
    'darwin-arm64': {
      archiveUrl:
        'https://github.com/astral-sh/python-build-standalone/releases/download/20251010/cpython-3.12.12%2B20251010-aarch64-apple-darwin-install_only_stripped.tar.gz',
    },
    'darwin-x64': {
      archiveUrl:
        'https://github.com/astral-sh/python-build-standalone/releases/download/20251010/cpython-3.12.12%2B20251010-x86_64-apple-darwin-install_only_stripped.tar.gz',
    },
    'linux-x64': {
      archiveUrl:
        'https://github.com/astral-sh/python-build-standalone/releases/download/20251010/cpython-3.12.12%2B20251010-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz',
    },
    'win32-x64': {
      archiveUrl:
        'https://github.com/astral-sh/python-build-standalone/releases/download/20251010/cpython-3.12.12%2B20251010-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
    },
  },
};

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveRuntimePlatformKey() {
  return `${process.platform}-${process.arch}`;
}

function getDefaultPythonVersion() {
  return DEFAULT_PYTHON_VERSION;
}

function getPythonRuntimePackages(pythonVersion = DEFAULT_PYTHON_VERSION) {
  const version = sanitizeText(pythonVersion) || DEFAULT_PYTHON_VERSION;
  return PYTHON_RUNTIME_PACKAGES[version] || null;
}

function resolvePythonRuntimePackage(pythonVersion = DEFAULT_PYTHON_VERSION, packages = null) {
  const version = sanitizeText(pythonVersion) || DEFAULT_PYTHON_VERSION;
  const packageTable = packages && typeof packages === 'object' ? packages : getPythonRuntimePackages(version);
  const platformKey = resolveRuntimePlatformKey();
  const selected = packageTable?.[platformKey];
  const archiveUrl = sanitizeText(selected?.archiveUrl);
  return {
    pythonVersion: version,
    platformKey,
    archiveUrl,
  };
}

module.exports = {
  DEFAULT_PYTHON_VERSION,
  getDefaultPythonVersion,
  getPythonRuntimePackages,
  resolvePythonRuntimePackage,
  resolveRuntimePlatformKey,
};
