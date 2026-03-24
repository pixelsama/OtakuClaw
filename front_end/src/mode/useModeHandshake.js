function scheduleFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    globalThis.requestAnimationFrame(callback);
    return;
  }

  setTimeout(callback, 0);
}

export function scheduleAfterTwoFrames(callback) {
  if (typeof callback !== 'function') {
    return;
  }

  scheduleFrame(() => {
    scheduleFrame(() => {
      callback();
    });
  });
}

export function notifyWithHandshake(notifyFn, mode) {
  if (typeof notifyFn !== 'function') {
    return;
  }

  let invoked = false;
  let watchdogTimer = null;

  const invokeOnce = () => {
    if (invoked) {
      return;
    }
    invoked = true;
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
    notifyFn(mode);
  };

  // rAF can pause while the window is hidden/backgrounded. Keep the two-frame
  // handshake behavior, but guarantee a bounded-time fallback.
  scheduleAfterTwoFrames(invokeOnce);
  watchdogTimer = setTimeout(invokeOnce, 120);
}
