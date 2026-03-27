import { useEffect } from 'react';
import { reduceOfficeActivityHint } from '../../components/office/officeSceneConfig.js';
import { desktopBridge } from '../../services/desktopBridge.js';

function toPermissionRequestQueueItem(event = {}) {
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  const permissionRequestId =
    typeof payload.permissionRequestId === 'string' ? payload.permissionRequestId.trim() : '';
  if (!permissionRequestId) {
    return null;
  }

  return {
    permissionRequestId,
    streamId: typeof event.streamId === 'string' ? event.streamId.trim() : '',
    backend:
      typeof payload.backend === 'string' && payload.backend.trim()
        ? payload.backend.trim()
        : typeof event.backend === 'string'
          ? event.backend.trim()
          : '',
    transport: typeof payload.transport === 'string' ? payload.transport.trim() : '',
    requestId: typeof payload.requestId === 'string' ? payload.requestId.trim() : '',
    permission: typeof payload.permission === 'string' ? payload.permission.trim() : '',
    toolName: typeof payload.toolName === 'string' ? payload.toolName.trim() : '',
    reason: typeof payload.reason === 'string' ? payload.reason.trim() : '',
    askTimeoutMs:
      Number.isFinite(payload.askTimeoutMs) && payload.askTimeoutMs > 0
        ? Math.min(Math.floor(payload.askTimeoutMs), 60_000)
        : 8_000,
  };
}

function registerOfficeActivityAssembly({ setOfficeActivityHint }) {
  return desktopBridge.conversation.onEvent((event = {}) => {
    setOfficeActivityHint((current) => reduceOfficeActivityHint(current, event));
  });
}

function registerPermissionQueueAssembly({ setPermissionRequestQueue }) {
  return desktopBridge.conversation.onEvent((event = {}) => {
    if (event?.channel !== 'chat') {
      return;
    }

    if (event.type === 'permission-request') {
      const nextItem = toPermissionRequestQueueItem(event);
      if (!nextItem) {
        return;
      }

      setPermissionRequestQueue((currentQueue) => {
        if (currentQueue.some((item) => item.permissionRequestId === nextItem.permissionRequestId)) {
          return currentQueue;
        }
        return [...currentQueue, nextItem];
      });
      return;
    }

    if (event.type !== 'done' && event.type !== 'error') {
      return;
    }

    const streamId = typeof event.streamId === 'string' ? event.streamId.trim() : '';
    if (!streamId) {
      return;
    }

    setPermissionRequestQueue((currentQueue) =>
      currentQueue.filter((item) => item.streamId !== streamId));
  });
}

const DESKTOP_CONVERSATION_ASSEMBLIES = Object.freeze([
  {
    key: 'office-activity-hint',
    register: registerOfficeActivityAssembly,
  },
  {
    key: 'permission-request-queue',
    register: registerPermissionQueueAssembly,
  },
]);

export function useDesktopConversationAssemblies({
  desktopMode,
  setOfficeActivityHint,
  setPermissionRequestQueue,
  setPermissionDecisionSubmitting,
}) {
  useEffect(() => {
    if (!desktopMode) {
      setOfficeActivityHint(null);
      setPermissionRequestQueue([]);
      setPermissionDecisionSubmitting(false);
      return () => {};
    }

    const disposers = DESKTOP_CONVERSATION_ASSEMBLIES.map((assembly) =>
      assembly.register({
        setOfficeActivityHint,
        setPermissionRequestQueue,
      }));

    return () => {
      for (const dispose of disposers) {
        if (typeof dispose === 'function') {
          dispose();
        }
      }
    };
  }, [desktopMode, setOfficeActivityHint, setPermissionRequestQueue, setPermissionDecisionSubmitting]);
}
