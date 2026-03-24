#!/usr/bin/env node

const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { _electron: electronLauncher } = require('playwright');

const ROOT = process.cwd();
const MOCK_STDIO = path.join(ROOT, 'tests/e2e/phase3/fixtures/mock_acp_stdio_runner.js');
const MOCK_HTTP = path.join(ROOT, 'tests/e2e/phase3/fixtures/mock_acp_http_server.js');
const MOCK_WS = path.join(ROOT, 'tests/e2e/phase3/fixtures/mock_acp_ws_server.js');
const DEV_URL = process.env.ELECTRON_DEV_SERVER_URL || 'http://127.0.0.1:3000';
const STRICT = process.argv.includes('--strict');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeError(error) {
  if (!error) {
    return 'Unknown error';
  }
  if (error.stack) {
    return String(error.stack).split('\n').slice(0, 4).join('\n');
  }
  return String(error.message || error);
}

function spawnFixture(scriptPath, env = {}) {
  const child = spawn('node', [scriptPath], {
    cwd: ROOT,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf-8');
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf-8');
  });

  const stop = async () => {
    if (child.exitCode !== null) {
      return;
    }
    child.kill('SIGTERM');
    await new Promise((resolve) => {
      child.once('exit', () => resolve());
      setTimeout(resolve, 2000);
    });
  };

  const waitReady = async (pattern, timeoutMs = 5000) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (pattern.test(stdout)) {
        return;
      }
      if (child.exitCode !== null) {
        throw new Error(`Fixture exited early (${child.exitCode}): ${stderr || stdout}`);
      }
      await sleep(60);
    }
    throw new Error(`Fixture did not become ready in ${timeoutMs}ms. stdout=${stdout} stderr=${stderr}`);
  };

  return {
    child,
    stop,
    waitReady,
    getLogs: () => ({ stdout, stderr }),
  };
}

async function attachCollector(window) {
  await window.evaluate(() => {
    window.__phase3Qa = window.__phase3Qa || {};
    window.__phase3Qa.events = [];
    if (window.__phase3Qa.unsubConversation) {
      try {
        window.__phase3Qa.unsubConversation();
      } catch {
        // ignore
      }
    }
    if (window.desktop?.conversation?.onEvent) {
      window.__phase3Qa.unsubConversation = window.desktop.conversation.onEvent((event) => {
        window.__phase3Qa.events.push({
          ts: Date.now(),
          channel: event?.channel || '',
          type: event?.type || '',
          backend: event?.backend || '',
          streamId: event?.streamId || '',
          payload: event?.payload || null,
        });
      });
    }
  });
}

function createElectronApi(window) {
  return {
    async clearEvents() {
      await window.evaluate(() => {
        if (!window.__phase3Qa) {
          window.__phase3Qa = { events: [] };
        }
        window.__phase3Qa.events = [];
      });
    },
    async events() {
      return window.evaluate(() => [...(window.__phase3Qa?.events || [])]);
    },
    async waitForEvent(predicate, timeoutMs = 10000, intervalMs = 80) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const events = await this.events();
        const hit = events.find(predicate);
        if (hit) {
          return hit;
        }
        await sleep(intervalMs);
      }
      throw new Error(`Timed out waiting for event after ${timeoutMs}ms`);
    },
    async waitForEvents(predicate, count, timeoutMs = 10000, intervalMs = 80) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < timeoutMs) {
        const events = await this.events();
        const hits = events.filter(predicate);
        if (hits.length >= count) {
          return hits;
        }
        await sleep(intervalMs);
      }
      throw new Error(`Timed out waiting for ${count} events after ${timeoutMs}ms`);
    },
    async getSettings() {
      return window.evaluate(() => window.desktop.settings.get());
    },
    async saveSettings(patch) {
      return window.evaluate((p) => window.desktop.settings.save(p), patch);
    },
    async submit(payload) {
      return window.evaluate((p) => window.desktop.conversation.submitUserText(p), payload);
    },
    async abortActive(payload) {
      return window.evaluate((p) => window.desktop.conversation.abortActive(p), payload);
    },
    async resolvePermission(payload) {
      return window.evaluate((p) => window.desktop.conversation.resolvePermissionRequest(p), payload);
    },
    async dialogText() {
      return window.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '');
    },
    async isDialogOpen() {
      return window.evaluate(() => Boolean(document.querySelector('[role="dialog"]')));
    },
    async clickAllow() {
      const button = window.getByRole('button', { name: /允许|Allow/i }).first();
      await button.click();
    },
    async clickDeny() {
      const button = window.getByRole('button', { name: /拒绝|Deny/i }).first();
      await button.click();
    },
    async pageHasSecretLikeText() {
      return window.evaluate(() => {
        const text = document.body.innerText || '';
        return /sk-[A-Za-z0-9]{8,}|api[_-]?key\s*[:=]\s*[A-Za-z0-9\-_]{8,}/i.test(text);
      });
    },
  };
}

async function main() {
  const results = [];
  const fixtures = [];

  const pushResult = ({ id, name, pass, details = '' }) => {
    results.push({ id, name, pass, details });
  };

  const runCase = async (id, name, fn) => {
    try {
      const details = await fn();
      pushResult({ id, name, pass: true, details: details || '' });
    } catch (error) {
      pushResult({ id, name, pass: false, details: summarizeError(error) });
    }
  };

  let electronApp;
  let appWindow;
  let api;

  try {
    electronApp = await electronLauncher.launch({
      args: ['.'],
      env: {
        ...process.env,
        ELECTRON_DEV_SERVER_URL: DEV_URL,
      },
    });
    appWindow = await electronApp.firstWindow();
    api = createElectronApi(appWindow);
    await attachCollector(appWindow);

    await runCase('2.1', 'Nanobot one-turn connectivity', async () => {
      const settings = await api.getSettings();
      await api.saveSettings({
        chatBackend: 'nanobot',
        nanobot: {
          ...(settings.nanobot || {}),
          enabled: true,
        },
      });
      await api.clearEvents();
      const start = await api.submit({
        sessionId: 'phase3-connect-nanobot',
        content: 'nanobot-connectivity-check',
        backend: 'nanobot',
        policy: 'latest-wins',
      });
      assert.equal(start.ok, true);
      const terminal = await api.waitForEvent(
        (event) => event.streamId === start.streamId && (event.type === 'done' || event.type === 'error'),
        30000,
      );
      if (terminal.type !== 'done') {
        throw new Error(`nanobot terminal type=${terminal.type} code=${terminal.payload?.code || ''} msg=${terminal.payload?.message || ''}`);
      }
      return `stream=${start.streamId}`;
    });

    await runCase('2.2', 'Codex one-turn connectivity (mock stdio echo)', async () => {
      const settings = await api.getSettings();
      await api.saveSettings({
        chatBackend: 'codex',
        codex: {
          ...(settings.codex || {}),
          enabled: true,
          permissionMode: 'deny',
          runner: {
            ...(settings.codex?.runner || {}),
            transport: 'stdio',
            command: 'node',
            args: [MOCK_STDIO, 'echo'],
            cwd: ROOT,
            endpoint: '',
            url: '',
            permissionEndpoint: '',
          },
        },
      });

      await api.clearEvents();
      const start = await api.submit({
        sessionId: 'phase3-connect-codex',
        content: 'codex-connectivity-check',
        backend: 'codex',
        policy: 'latest-wins',
      });
      assert.equal(start.ok, true);

      await api.waitForEvent((event) => event.streamId === start.streamId && event.type === 'text-delta', 8000);
      const done = await api.waitForEvent((event) => event.streamId === start.streamId && event.type === 'done', 8000);
      assert.equal(Boolean(done), true);
      return `stream=${start.streamId}`;
    });

    await runCase('2.3', 'Claude-code one-turn connectivity (mock stdio echo)', async () => {
      const settings = await api.getSettings();
      await api.saveSettings({
        chatBackend: 'claude-code',
        claudeCode: {
          ...(settings.claudeCode || {}),
          enabled: true,
          permissionMode: 'deny',
          runner: {
            ...(settings.claudeCode?.runner || {}),
            transport: 'stdio',
            command: 'node',
            args: [MOCK_STDIO, 'echo'],
            cwd: ROOT,
            endpoint: '',
            url: '',
            permissionEndpoint: '',
          },
        },
      });

      await api.clearEvents();
      const start = await api.submit({
        sessionId: 'phase3-connect-claude',
        content: 'claude-connectivity-check',
        backend: 'claude-code',
        policy: 'latest-wins',
      });
      assert.equal(start.ok, true);

      const done = await api.waitForEvent((event) => event.streamId === start.streamId && event.type === 'done', 8000);
      assert.equal(Boolean(done), true);
      return `stream=${start.streamId}`;
    });

    await runCase('2.4', 'Backend switch UI/runtime consistency', async () => {
      const settings = await api.getSettings();
      assert.equal(settings.chatBackend === 'codex' || settings.chatBackend === 'claude-code' || settings.chatBackend === 'nanobot', true);

      await api.saveSettings({ chatBackend: 'codex' });
      const afterCodex = await api.getSettings();
      assert.equal(afterCodex.chatBackend, 'codex');

      await api.saveSettings({ chatBackend: 'claude-code' });
      const afterClaude = await api.getSettings();
      assert.equal(afterClaude.chatBackend, 'claude-code');

      return `switch codex -> claude-code persisted`;
    });

    await runCase('3.1', 'Ask flow emits permission-request + dialog fields', async () => {
      const settings = await api.getSettings();
      await api.saveSettings({
        chatBackend: 'codex',
        codex: {
          ...(settings.codex || {}),
          enabled: true,
          permissionMode: 'ask',
          askTimeoutMs: 5000,
          runner: {
            ...(settings.codex?.runner || {}),
            transport: 'stdio',
            command: 'node',
            args: [MOCK_STDIO, 'permission-once'],
            cwd: ROOT,
            endpoint: '',
            url: '',
            permissionEndpoint: '',
          },
        },
      });

      await api.clearEvents();
      const start = await api.submit({
        sessionId: 'phase3-ask-fields',
        content: 'ask-fields',
        backend: 'codex',
        policy: 'latest-wins',
      });
      assert.equal(start.ok, true);

      const permissionEvent = await api.waitForEvent(
        (event) => event.streamId === start.streamId && event.type === 'permission-request',
        8000,
      );

      assert.equal(permissionEvent.payload?.backend, 'codex');
      assert.equal(permissionEvent.payload?.toolName, 'shell');
      assert.equal(permissionEvent.payload?.permission, 'exec');
      assert.equal(typeof permissionEvent.payload?.reason, 'string');

      const dialogText = await api.dialogText();
      assert.equal(dialogText.includes('后端') || dialogText.includes('Backend'), true);
      assert.equal(dialogText.includes('工具') || dialogText.includes('Tool'), true);
      assert.equal(dialogText.includes('权限') || dialogText.includes('Permission'), true);
      assert.equal(dialogText.includes('原因') || dialogText.includes('Reason'), true);

      return `permId=${permissionEvent.payload?.permissionRequestId || ''}`;
    });

    await runCase('3.2', 'Ask allow path', async () => {
      await api.clearEvents();
      const start = await api.submit({
        sessionId: 'phase3-ask-allow',
        content: 'ask-allow',
        backend: 'codex',
        policy: 'latest-wins',
      });

      await api.waitForEvent((event) => event.streamId === start.streamId && event.type === 'permission-request', 8000);
      await api.clickAllow();

      await api.waitForEvent(
        (event) => event.streamId === start.streamId && event.type === 'text-delta' && String(event.payload?.content || '').includes('permission-allow-ok'),
        8000,
      );
      await api.waitForEvent((event) => event.streamId === start.streamId && event.type === 'done', 8000);
      return `stream=${start.streamId}`;
    });

    await runCase('3.3', 'Ask deny path', async () => {
      await api.clearEvents();
      const start = await api.submit({
        sessionId: 'phase3-ask-deny',
        content: 'ask-deny',
        backend: 'codex',
        policy: 'latest-wins',
      });

      await api.waitForEvent((event) => event.streamId === start.streamId && event.type === 'permission-request', 8000);
      await api.clickDeny();
      const error = await api.waitForEvent((event) => event.streamId === start.streamId && event.type === 'error', 8000);
      assert.equal(error.payload?.code, 'permission_denied');
      assert.equal(error.payload?.message, 'user_deny');
      return `stream=${start.streamId}`;
    });

    await runCase('3.4', 'Ask timeout auto-deny', async () => {
      await api.clearEvents();
      const start = await api.submit({
        sessionId: 'phase3-ask-timeout',
        content: 'ask-timeout',
        backend: 'codex',
        policy: 'latest-wins',
      });
      await api.waitForEvent((event) => event.streamId === start.streamId && event.type === 'permission-request', 8000);
      const error = await api.waitForEvent((event) => event.streamId === start.streamId && event.type === 'error', 10000);
      assert.equal(error.payload?.code, 'permission_denied');
      assert.equal(error.payload?.message, 'user_timeout');
      return `stream=${start.streamId}`;
    });

    await runCase('3.5', 'Permission queue sequential handling', async () => {
      const settings = await api.getSettings();
      await api.saveSettings({
        codex: {
          ...(settings.codex || {}),
          enabled: true,
          permissionMode: 'ask',
          askTimeoutMs: 6000,
          runner: {
            ...(settings.codex?.runner || {}),
            transport: 'stdio',
            command: 'node',
            args: [MOCK_STDIO, 'permission-queue'],
            cwd: ROOT,
            endpoint: '',
            url: '',
            permissionEndpoint: '',
          },
        },
        fastPersona: {
          ...(settings.fastPersona || {}),
          enabled: true,
          configMode: 'custom',
          provider: 'openai',
          model: '',
          apiBase: '',
          clearApiKey: true,
        },
        chatBackend: 'codex',
      });

      const updatedSettings = await api.getSettings();
      assert.equal(updatedSettings.codex?.runner?.transport, 'stdio');
      assert.equal((updatedSettings.codex?.runner?.args || [])[1], 'permission-queue');

      await api.clearEvents();
      const start = await api.submit({
        sessionId: 'phase3-ask-queue',
        content: 'ask-queue',
        backend: 'codex',
        policy: 'latest-wins',
      });
      assert.equal(Boolean(start?.synthetic), false, '3.5 must run through backend stream, not synthetic fast-path.');

      const waitForDialogText = async (needle, timeoutMs = 10000) => {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
          const text = await api.dialogText();
          if (String(text || '').includes(needle)) {
            return text;
          }
          await sleep(80);
        }
        throw new Error(`Timed out waiting for permission dialog text: ${needle}`);
      };

      await waitForDialogText('Queue test request #1', 10000);
      await api.clickAllow();

      await waitForDialogText('Queue test request #2', 10000);
      await api.clickAllow();

      await api.waitForEvent(
        (event) => event.streamId === start.streamId && event.type === 'text-delta' && String(event.payload?.content || '').includes('queue-decisions: allow/allow'),
        8000,
      );
      await api.waitForEvent((event) => event.streamId === start.streamId && event.type === 'done', 8000);
      return `stream=${start.streamId} requests=2`;
    });

    await runCase('3.6', 'Pending permission cleared after stream end/abort', async () => {
      const settings = await api.getSettings();
      await api.saveSettings({
        codex: {
          ...(settings.codex || {}),
          enabled: true,
          permissionMode: 'ask',
          askTimeoutMs: 8000,
          runner: {
            ...(settings.codex?.runner || {}),
            transport: 'stdio',
            command: 'node',
            args: [MOCK_STDIO, 'permission-once'],
            cwd: ROOT,
            endpoint: '',
            url: '',
            permissionEndpoint: '',
          },
        },
      });

      await api.clearEvents();
      const start = await api.submit({
        sessionId: 'phase3-ask-cleanup',
        content: 'ask-cleanup',
        backend: 'codex',
        policy: 'latest-wins',
      });

      const permission = await api.waitForEvent(
        (event) => event.streamId === start.streamId && event.type === 'permission-request',
        8000,
      );
      const abortResult = await api.abortActive({ sessionId: 'phase3-ask-cleanup', reason: 'cleanup-check' });
      assert.equal(abortResult.ok, true);

      await sleep(1200);
      const resolveResult = await api.resolvePermission({
        permissionRequestId: permission.payload?.permissionRequestId,
        decision: 'allow',
        reason: 'late_allow',
      });
      assert.equal(resolveResult.ok, false);
      assert.equal(resolveResult.reason, 'permission_request_not_found');

      const dialogOpen = await api.isDialogOpen();
      assert.equal(dialogOpen, false);
      return `aborted=${(abortResult.aborted || []).length}`;
    });

    await runCase('4.1', 'Same-backend latest-wins long->short', async () => {
      const settings = await api.getSettings();
      await api.saveSettings({
        chatBackend: 'codex',
        codex: {
          ...(settings.codex || {}),
          enabled: true,
          permissionMode: 'deny',
          runner: {
            ...(settings.codex?.runner || {}),
            transport: 'stdio',
            command: 'node',
            args: [MOCK_STDIO],
            cwd: ROOT,
            endpoint: '',
            url: '',
            permissionEndpoint: '',
          },
        },
      });

      await api.clearEvents();
      const first = await api.submit({
        sessionId: 'phase3-latestwins-same',
        content: 'same-long',
        backend: 'codex',
        policy: 'latest-wins',
        options: { mockScenario: 'long' },
      });
      await sleep(500);
      const second = await api.submit({
        sessionId: 'phase3-latestwins-same',
        content: 'same-short',
        backend: 'codex',
        policy: 'latest-wins',
        options: { mockScenario: 'echo' },
      });

      await api.waitForEvent((event) => event.streamId === second.streamId && event.type === 'done', 8000);
      const firstTerminal = await api.waitForEvent(
        (event) => event.streamId === first.streamId && (event.type === 'done' || event.type === 'error'),
        8000,
      );
      assert.equal(firstTerminal.type, 'done');
      assert.equal(Boolean(firstTerminal.payload?.aborted), true);
      return `first=${first.streamId} second=${second.streamId}`;
    });

    await runCase('4.2', 'Cross-backend switch long->short observation', async () => {
      const settings = await api.getSettings();
      await api.saveSettings({
        codex: {
          ...(settings.codex || {}),
          enabled: true,
          permissionMode: 'deny',
          runner: {
            ...(settings.codex?.runner || {}),
            transport: 'stdio',
            command: 'node',
            args: [MOCK_STDIO, 'long'],
            cwd: ROOT,
            endpoint: '',
            url: '',
            permissionEndpoint: '',
          },
        },
        claudeCode: {
          ...(settings.claudeCode || {}),
          enabled: true,
          permissionMode: 'deny',
          runner: {
            ...(settings.claudeCode?.runner || {}),
            transport: 'stdio',
            command: 'node',
            args: [MOCK_STDIO, 'echo'],
            cwd: ROOT,
            endpoint: '',
            url: '',
            permissionEndpoint: '',
          },
        },
      });

      await api.clearEvents();
      const first = await api.submit({
        sessionId: 'phase3-cross-switch',
        content: 'cross-long',
        backend: 'codex',
        policy: 'latest-wins',
      });
      await sleep(600);
      const second = await api.submit({
        sessionId: 'phase3-cross-switch',
        content: 'cross-short',
        backend: 'claude-code',
        policy: 'latest-wins',
      });

      await api.waitForEvent((event) => event.streamId === second.streamId && event.type === 'done', 8000);
      await sleep(1200);
      const events = await api.events();
      const firstHasAbortedDone = events.some(
        (event) => event.streamId === first.streamId && event.type === 'done' && Boolean(event.payload?.aborted),
      );
      const firstStillStreaming = events.some(
        (event) => event.streamId === first.streamId && event.type === 'text-delta',
      ) && !firstHasAbortedDone;

      if (firstStillStreaming) {
        throw new Error('Cross-backend switch did not interrupt the long stream under latest-wins.');
      }
      return `firstInterrupted=${firstHasAbortedDone}`;
    });

    await runCase('4.3', 'Abort Active then immediate recovery', async () => {
      const settings = await api.getSettings();
      await api.saveSettings({
        codex: {
          ...(settings.codex || {}),
          enabled: true,
          permissionMode: 'deny',
          runner: {
            ...(settings.codex?.runner || {}),
            transport: 'stdio',
            command: 'node',
            args: [MOCK_STDIO],
            cwd: ROOT,
            endpoint: '',
            url: '',
            permissionEndpoint: '',
          },
        },
        claudeCode: {
          ...(settings.claudeCode || {}),
          enabled: true,
          permissionMode: 'deny',
          runner: {
            ...(settings.claudeCode?.runner || {}),
            transport: 'stdio',
            command: 'node',
            args: [MOCK_STDIO, 'echo'],
            cwd: ROOT,
            endpoint: '',
            url: '',
            permissionEndpoint: '',
          },
        },
      });

      await api.clearEvents();
      const first = await api.submit({
        sessionId: 'phase3-abort-recover',
        content: 'abort-me',
        backend: 'codex',
        policy: 'latest-wins',
        options: { mockScenario: 'long' },
      });
      await sleep(700);
      const aborted = await api.abortActive({ sessionId: 'phase3-abort-recover', reason: 'script-abort' });
      assert.equal(aborted.ok, true);

      const second = await api.submit({
        sessionId: 'phase3-abort-recover',
        content: 'recover',
        backend: 'claude-code',
        policy: 'latest-wins',
      });

      await api.waitForEvent((event) => event.streamId === second.streamId && event.type === 'done', 8000);
      const firstTerminal = await api.waitForEvent(
        (event) => event.streamId === first.streamId && (event.type === 'done' || event.type === 'error'),
        8000,
      );
      assert.equal(firstTerminal.type, 'done');
      assert.equal(Boolean(firstTerminal.payload?.aborted), true);
      return `aborted=${(aborted.aborted || []).length}`;
    });

    await runCase('5.1', 'Stdio missing command surfaces explicit error', async () => {
      const settings = await api.getSettings();
      await api.saveSettings({
        chatBackend: 'codex',
        codex: {
          ...(settings.codex || {}),
          enabled: true,
          permissionMode: 'deny',
          runner: {
            ...(settings.codex?.runner || {}),
            transport: 'stdio',
            command: '__missing_codex_acp__',
            args: [],
            cwd: '',
            endpoint: '',
            url: '',
            permissionEndpoint: '',
          },
        },
      });

      await api.clearEvents();
      const start = await api.submit({
        sessionId: 'phase3-err-stdio',
        content: 'stdio-missing',
        backend: 'codex',
        policy: 'latest-wins',
      });
      const error = await api.waitForEvent((event) => event.streamId === start.streamId && event.type === 'error', 8000);
      assert.equal(String(error.payload?.code || '').includes('runner_not_found'), true);
      return `code=${error.payload?.code}`;
    });

    await runCase('5.2', 'HTTP unreachable error + recover', async () => {
      const settings = await api.getSettings();
      await api.saveSettings({
        chatBackend: 'codex',
        codex: {
          ...(settings.codex || {}),
          enabled: true,
          permissionMode: 'deny',
          runner: {
            ...(settings.codex?.runner || {}),
            transport: 'http',
            endpoint: 'http://127.0.0.1:65530/acp',
            permissionEndpoint: '',
            command: '',
            args: [],
            cwd: '',
            url: '',
          },
        },
      });

      await api.clearEvents();
      const bad = await api.submit({
        sessionId: 'phase3-err-http',
        content: 'http-unreachable',
        backend: 'codex',
        policy: 'latest-wins',
      });
      const badError = await api.waitForEvent((event) => event.streamId === bad.streamId && event.type === 'error', 10000);
      assert.equal(Boolean(badError.payload?.message), true);

      const httpFixture = spawnFixture(MOCK_HTTP, {
        MOCK_ACP_SCENARIO: 'echo',
        MOCK_ACP_PORT: '8877',
      });
      fixtures.push(httpFixture);
      await httpFixture.waitReady(/mock-acp-http-listening/);

      const nextSettings = await api.getSettings();
      await api.saveSettings({
        codex: {
          ...(nextSettings.codex || {}),
          enabled: true,
          permissionMode: 'deny',
          runner: {
            ...(nextSettings.codex?.runner || {}),
            transport: 'http',
            endpoint: 'http://127.0.0.1:8877/acp',
            permissionEndpoint: 'http://127.0.0.1:8877/permission',
            command: '',
            args: [],
            cwd: '',
            url: '',
          },
        },
      });

      await api.clearEvents();
      const good = await api.submit({
        sessionId: 'phase3-err-http',
        content: 'http-recover',
        backend: 'codex',
        policy: 'latest-wins',
      });
      await api.waitForEvent((event) => event.streamId === good.streamId && event.type === 'done', 10000);
      return `bad=${badError.payload?.message || ''}`;
    });

    await runCase('5.3', 'WebSocket disconnect error + recover', async () => {
      const wsBadFixture = spawnFixture(MOCK_WS, {
        MOCK_ACP_SCENARIO: 'disconnect',
        MOCK_ACP_PORT: '8878',
      });
      fixtures.push(wsBadFixture);
      await wsBadFixture.waitReady(/mock-acp-ws-listening/);

      const settings = await api.getSettings();
      await api.saveSettings({
        chatBackend: 'codex',
        codex: {
          ...(settings.codex || {}),
          enabled: true,
          permissionMode: 'deny',
          runner: {
            ...(settings.codex?.runner || {}),
            transport: 'websocket',
            url: 'ws://127.0.0.1:8878/acp',
            endpoint: '',
            permissionEndpoint: '',
            command: '',
            args: [],
            cwd: '',
          },
        },
      });

      await api.clearEvents();
      const bad = await api.submit({
        sessionId: 'phase3-err-ws',
        content: '请执行 shell 命令（ws disconnect）',
        backend: 'codex',
        policy: 'latest-wins',
      });
      const badError = await api.waitForEvent((event) => event.streamId === bad.streamId && event.type === 'error', 12000);
      assert.equal(String(badError.payload?.code || '').includes('acp_stream_closed') || String(badError.payload?.message || '').includes('closed'), true);

      await wsBadFixture.stop();

      const wsGoodFixture = spawnFixture(MOCK_WS, {
        MOCK_ACP_SCENARIO: 'echo',
        MOCK_ACP_PORT: '8878',
      });
      fixtures.push(wsGoodFixture);
      await wsGoodFixture.waitReady(/mock-acp-ws-listening/);

      await api.clearEvents();
      const good = await api.submit({
        sessionId: 'phase3-err-ws',
        content: '请执行 shell 命令（ws recover）',
        backend: 'codex',
        policy: 'latest-wins',
      });
      await api.waitForEvent((event) => event.streamId === good.streamId && event.type === 'done', 12000);
      return `badCode=${badError.payload?.code || ''}`;
    });

    await runCase('5.4', 'Permission resolve failure defaults to deny without deadlock', async () => {
      const settings = await api.getSettings();
      await api.saveSettings({
        chatBackend: 'codex',
        codex: {
          ...(settings.codex || {}),
          enabled: true,
          permissionMode: 'ask',
          askTimeoutMs: 3000,
          runner: {
            ...(settings.codex?.runner || {}),
            transport: 'stdio',
            command: 'node',
            args: [MOCK_STDIO, 'permission-once'],
            cwd: ROOT,
            endpoint: '',
            url: '',
            permissionEndpoint: '',
          },
        },
      });

      await api.clearEvents();
      const start = await api.submit({
        sessionId: 'phase3-permission-resolve-fail',
        content: 'permission-fail',
        backend: 'codex',
        policy: 'latest-wins',
      });

      await api.waitForEvent((event) => event.streamId === start.streamId && event.type === 'permission-request', 8000);
      const badResolve = await api.resolvePermission({
        permissionRequestId: 'invalid-id',
        decision: 'allow',
        reason: 'invalid',
      });
      assert.equal(badResolve.ok, false);

      const terminal = await api.waitForEvent(
        (event) => event.streamId === start.streamId && (event.type === 'error' || event.type === 'done'),
        10000,
      );
      assert.equal(terminal.type, 'error');
      assert.equal(terminal.payload?.code, 'permission_denied');
      assert.equal(terminal.payload?.message, 'user_timeout');
      return `resolveReason=${badResolve.reason}`;
    });

    await runCase('6.1', 'Backend/transport/permission settings persist after reload', async () => {
      const settings = await api.getSettings();
      await api.saveSettings({
        chatBackend: 'codex',
        codex: {
          ...(settings.codex || {}),
          enabled: true,
          permissionMode: 'ask',
          askTimeoutMs: 6000,
          runner: {
            ...(settings.codex?.runner || {}),
            transport: 'websocket',
            url: 'ws://127.0.0.1:8878/acp',
            command: '',
            args: [],
            cwd: '',
            endpoint: '',
            permissionEndpoint: '',
          },
        },
      });

      await appWindow.reload({ waitUntil: 'domcontentloaded' });
      await attachCollector(appWindow);
      api = createElectronApi(appWindow);

      const after = await api.getSettings();
      assert.equal(after.chatBackend, 'codex');
      assert.equal(after.codex?.runner?.transport, 'websocket');
      assert.equal(after.codex?.runner?.url, 'ws://127.0.0.1:8878/acp');
      assert.equal(after.codex?.permissionMode, 'ask');
      return 'persisted codex websocket + ask';
    });

    await runCase('6.2', 'Ask mode label + no obvious secret leakage in renderer text', async () => {
      await appWindow.evaluate(() => {
        const cfgBtn = document.querySelector('button.config-toggle');
        if (cfgBtn) {
          cfgBtn.click();
        }
      });
      await sleep(600);
      const hasSecretLike = await api.pageHasSecretLikeText();
      assert.equal(hasSecretLike, false);
      return 'no obvious secret-like text in document.body';
    });
  } finally {
    for (const fixture of fixtures.reverse()) {
      try {
        await fixture.stop();
      } catch {
        // ignore
      }
    }

    if (electronApp) {
      await electronApp.close().catch(() => {});
    }
  }

  const passed = results.filter((item) => item.pass).length;
  const failed = results.length - passed;

  console.log('\nPhase3 Real-Device Regression Results');
  console.log('-------------------------------------');
  for (const item of results) {
    const status = item.pass ? 'PASS' : 'FAIL';
    console.log(`${status} [${item.id}] ${item.name}`);
    if (item.details) {
      console.log(`  ${item.details}`);
    }
  }

  console.log(`\nSummary: ${passed}/${results.length} passed, ${failed} failed.`);

  if (STRICT && failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
