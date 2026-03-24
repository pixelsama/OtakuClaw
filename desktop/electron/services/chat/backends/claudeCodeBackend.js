const { AcpBackendAdapter } = require('./acpBackend');

const DEFAULT_SETTINGS = {
  enabled: false,
  timeoutMs: 120_000,
  askTimeoutMs: 8_000,
  permissionMode: 'deny',
  runner: {
    protocol: 'acp',
    transport: 'stdio',
    command: 'claude-agent-acp',
    args: [],
    cwd: '',
    env: {},
  },
};

class ClaudeCodeBackendAdapter extends AcpBackendAdapter {
  constructor(options = {}) {
    super({
      name: 'claude-code',
      settingsKey: 'claudeCode',
      displayName: 'Claude Code',
      defaults: DEFAULT_SETTINGS,
      ...options,
    });
  }
}

module.exports = {
  ClaudeCodeBackendAdapter,
  DEFAULT_CLAUDE_CODE_BACKEND_SETTINGS: DEFAULT_SETTINGS,
};
