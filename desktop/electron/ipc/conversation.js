function registerConversationIpc({
  ipcMain,
  conversationRuntime,
  resolvePermissionRequest,
} = {}) {
  if (!ipcMain || !conversationRuntime) {
    return () => {};
  }

  ipcMain.handle('conversation:submit-user-text', async (_event, request = {}) => {
    return conversationRuntime.submitUserText(request);
  });

  ipcMain.handle('conversation:abort-active', async (_event, request = {}) => {
    return conversationRuntime.abortActive(request);
  });

  ipcMain.handle('conversation:permission:resolve', async (_event, request = {}) => {
    if (typeof resolvePermissionRequest !== 'function') {
      return {
        ok: false,
        reason: 'permission_resolver_unavailable',
      };
    }
    return resolvePermissionRequest(request);
  });

  return () => {
    ipcMain.removeHandler('conversation:submit-user-text');
    ipcMain.removeHandler('conversation:abort-active');
    ipcMain.removeHandler('conversation:permission:resolve');
  };
}

module.exports = {
  registerConversationIpc,
};
