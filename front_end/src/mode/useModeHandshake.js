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

  scheduleAfterTwoFrames(() => {
    notifyFn(mode);
  });
}
