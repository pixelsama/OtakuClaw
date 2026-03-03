export function normalizeErrorMessage(error, t) {
  const fallbackMessage = t('common.requestFailed');

  if (!error) {
    return fallbackMessage;
  }

  if (typeof error === 'string') {
    const streamStatusMatch = /^流式接口请求失败:\s*(\d+)/.exec(error);
    if (streamStatusMatch?.[1]) {
      return t('error.streamRequestFailed', { status: streamStatusMatch[1] });
    }
    return error;
  }

  const code = error?.code || error?.payload?.code;
  if (code === 'openclaw_missing_config') {
    return t('error.openclawMissingConfig');
  }
  if (code === 'openclaw_unreachable') {
    return t('error.openclawUnreachable');
  }

  if (typeof error?.message === 'string' && error.message) {
    const streamStatusMatch = /^流式接口请求失败:\s*(\d+)/.exec(error.message);
    if (streamStatusMatch?.[1]) {
      return t('error.streamRequestFailed', { status: streamStatusMatch[1] });
    }
    return error.message;
  }

  if (typeof error?.payload?.message === 'string' && error.payload.message) {
    return error.payload.message;
  }

  return fallbackMessage;
}
