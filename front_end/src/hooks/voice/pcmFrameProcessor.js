class PCMFrameProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    const channel = input?.[0];
    if (!channel || !channel.length) {
      return true;
    }

    // Copy before postMessage because Worklet input buffers are reused by the engine.
    this.port.postMessage(new Float32Array(channel));
    return true;
  }
}

registerProcessor('pcm-frame-processor', PCMFrameProcessor);
