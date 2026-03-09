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
  if (code === 'nanobot_missing_config') {
    return t('error.nanobotMissingConfig');
  }
  if (code === 'nanobot_not_enabled') {
    return t('error.nanobotNotEnabled');
  }
  if (code === 'nanobot_runtime_not_ready') {
    return t('error.nanobotRuntimeNotReady');
  }
  if (code === 'nanobot_boot_failed') {
    return t('error.nanobotBootFailed');
  }
  if (code === 'nanobot_provider_unavailable') {
    return t('error.nanobotProviderUnavailable');
  }
  if (code === 'nanobot_model_call_failed') {
    return t('error.nanobotModelCallFailed');
  }
  if (code === 'nanobot_unreachable') {
    return t('error.nanobotUnreachable');
  }
  if (code === 'nanobot_skills_invalid_archive') {
    return t('error.nanobotSkillsInvalidArchive');
  }
  if (code === 'nanobot_skills_conflict') {
    return t('error.nanobotSkillsConflict');
  }
  if (code === 'nanobot_skills_not_found') {
    return t('error.nanobotSkillsNotFound');
  }
  if (code === 'nanobot_skills_import_failed') {
    return t('error.nanobotSkillsImportFailed');
  }
  if (code === 'nanobot_skills_delete_failed') {
    return t('error.nanobotSkillsDeleteFailed');
  }
  if (code === 'nanobot_skills_open_library_failed') {
    return t('error.nanobotSkillsOpenLibraryFailed');
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
