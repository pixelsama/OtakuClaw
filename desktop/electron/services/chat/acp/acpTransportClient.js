const { normalizeAcpBackendSettings } = require('./acpEventMapper');
const {
  runAcpStdioStream,
  testAcpStdioRunner,
  createAcpError,
} = require('./acpStdioClient');
const { runAcpHttpStream, testAcpHttpRunner } = require('./acpHttpClient');
const { runAcpWebSocketStream, testAcpWebSocketRunner } = require('./acpWebSocketClient');

function selectTransportHandler(settings = {}) {
  const normalized = normalizeAcpBackendSettings(settings);
  const transport = normalized?.runner?.transport || 'stdio';

  if (transport === 'stdio') {
    return {
      settings: normalized,
      runStream: runAcpStdioStream,
      testRunner: testAcpStdioRunner,
    };
  }

  if (transport === 'http') {
    return {
      settings: normalized,
      runStream: runAcpHttpStream,
      testRunner: testAcpHttpRunner,
    };
  }

  if (transport === 'websocket') {
    return {
      settings: normalized,
      runStream: runAcpWebSocketStream,
      testRunner: testAcpWebSocketRunner,
    };
  }

  throw createAcpError(
    'acp_runner_transport_unsupported',
    `Unsupported ACP transport: ${transport}`,
  );
}

async function runAcpStream(payload = {}) {
  const selected = selectTransportHandler(payload?.settings || {});
  return selected.runStream({
    ...payload,
    settings: selected.settings,
  });
}

async function testAcpRunner(payload = {}) {
  const selected = selectTransportHandler(payload?.settings || {});
  return selected.testRunner({
    ...payload,
    settings: selected.settings,
  });
}

module.exports = {
  runAcpStream,
  testAcpRunner,
  createAcpError,
};
