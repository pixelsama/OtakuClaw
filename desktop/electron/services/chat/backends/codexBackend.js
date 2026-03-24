const { AcpBackendAdapter } = require('./acpBackend');

const DEFAULT_SETTINGS = {
  enabled: false,
  timeoutMs: 120_000,
  askTimeoutMs: 8_000,
  permissionMode: 'deny',
  runner: {
    protocol: 'acp',
    transport: 'stdio',
    command: 'codex-acp',
    args: [],
    cwd: '',
    env: {},
  },
};

class CodexBackendAdapter extends AcpBackendAdapter {
  constructor(options = {}) {
    super({
      name: 'codex',
      settingsKey: 'codex',
      displayName: 'Codex',
      defaults: DEFAULT_SETTINGS,
      ...options,
    });
  }
}

module.exports = {
  CodexBackendAdapter,
  DEFAULT_CODEX_BACKEND_SETTINGS: DEFAULT_SETTINGS,
};
