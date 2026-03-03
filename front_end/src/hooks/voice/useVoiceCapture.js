import { useCallback, useMemo, useRef, useState } from 'react';

const DEFAULT_TARGET_SAMPLE_RATE = 16000;
const DEFAULT_FRAME_MS = 20;

function clampToInt16(sample) {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function downsampleFloat32(input, inputSampleRate, outputSampleRate) {
  if (!(input instanceof Float32Array) || input.length === 0) {
    return new Int16Array(0);
  }

  if (inputSampleRate <= outputSampleRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      out[i] = clampToInt16(input[i]);
    }
    return out;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);

  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < outputLength) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accumulator = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < input.length; i += 1) {
      accumulator += input[i];
      count += 1;
    }
    const average = count > 0 ? accumulator / count : 0;
    output[offsetResult] = clampToInt16(average);
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }

  return output;
}

function concatInt16(first, second) {
  if (!first?.length) {
    return second || new Int16Array(0);
  }
  if (!second?.length) {
    return first;
  }

  const merged = new Int16Array(first.length + second.length);
  merged.set(first, 0);
  merged.set(second, first.length);
  return merged;
}

function int16ToUint8(int16Samples) {
  const out = new Uint8Array(int16Samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < int16Samples.length; i += 1) {
    view.setInt16(i * 2, int16Samples[i], true);
  }
  return out;
}

export function useVoiceCapture() {
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const processorNodeRef = useRef(null);
  const gainNodeRef = useRef(null);
  const onPcmChunkRef = useRef(null);
  const pendingPcmRef = useRef(new Int16Array(0));
  const targetSampleRateRef = useRef(DEFAULT_TARGET_SAMPLE_RATE);
  const frameSamplesRef = useRef((DEFAULT_TARGET_SAMPLE_RATE * DEFAULT_FRAME_MS) / 1000);

  const [permission, setPermission] = useState('prompt');
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState('');

  const flushInt16Frames = useCallback(() => {
    const frameSamples = frameSamplesRef.current;
    if (!frameSamples || frameSamples <= 0) {
      return;
    }

    let buffer = pendingPcmRef.current;
    while (buffer.length >= frameSamples) {
      const frame = buffer.slice(0, frameSamples);
      const pcmChunk = int16ToUint8(frame);

      if (typeof onPcmChunkRef.current === 'function') {
        onPcmChunkRef.current({
          pcmChunk,
          sampleRate: targetSampleRateRef.current,
          channels: 1,
          sampleFormat: 'pcm_s16le',
        });
      }

      buffer = buffer.slice(frameSamples);
    }

    pendingPcmRef.current = buffer;
  }, []);

  const handleAudioFrame = useCallback(
    (floatFrame, inputSampleRate) => {
      const downsampled = downsampleFloat32(
        floatFrame,
        inputSampleRate,
        targetSampleRateRef.current || DEFAULT_TARGET_SAMPLE_RATE,
      );

      pendingPcmRef.current = concatInt16(pendingPcmRef.current, downsampled);
      flushInt16Frames();
    },
    [flushInt16Frames],
  );

  const requestPermission = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPermission('denied');
      setCaptureError('media_devices_unavailable');
      return { ok: false, reason: 'media_devices_unavailable' };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;
      setPermission('granted');
      setCaptureError('');
      return { ok: true };
    } catch (error) {
      const denied = error?.name === 'NotAllowedError' || error?.name === 'SecurityError';
      setPermission(denied ? 'denied' : 'error');
      setCaptureError(error?.message || 'microphone_permission_failed');
      return { ok: false, reason: error?.name || 'microphone_permission_failed' };
    }
  }, []);

  const stopCapture = useCallback(() => {
    try {
      processorNodeRef.current?.disconnect?.();
    } catch {
      // noop
    }
    processorNodeRef.current = null;

    try {
      sourceNodeRef.current?.disconnect?.();
    } catch {
      // noop
    }
    sourceNodeRef.current = null;

    try {
      gainNodeRef.current?.disconnect?.();
    } catch {
      // noop
    }
    gainNodeRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    pendingPcmRef.current = new Int16Array(0);
    onPcmChunkRef.current = null;
    setIsCapturing(false);
  }, []);

  const startCapture = useCallback(
    async ({
      onPcmChunk,
      targetSampleRate = DEFAULT_TARGET_SAMPLE_RATE,
      frameMs = DEFAULT_FRAME_MS,
    } = {}) => {
      if (isCapturing) {
        return { ok: true, reason: 'already_capturing' };
      }

      if (!streamRef.current) {
        const permissionResult = await requestPermission();
        if (!permissionResult.ok) {
          return permissionResult;
        }
      }

      onPcmChunkRef.current = typeof onPcmChunk === 'function' ? onPcmChunk : null;
      targetSampleRateRef.current = Number.isFinite(targetSampleRate)
        ? Math.max(8000, Math.floor(targetSampleRate))
        : DEFAULT_TARGET_SAMPLE_RATE;
      const safeFrameMs = Number.isFinite(frameMs) ? Math.max(10, Math.floor(frameMs)) : DEFAULT_FRAME_MS;
      frameSamplesRef.current = Math.max(
        1,
        Math.floor((targetSampleRateRef.current * safeFrameMs) / 1000),
      );
      pendingPcmRef.current = new Int16Array(0);

      try {
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        sourceNodeRef.current = audioContext.createMediaStreamSource(streamRef.current);

        let attached = false;
        if (audioContext.audioWorklet?.addModule) {
          try {
            await audioContext.audioWorklet.addModule(
              new URL('./pcmFrameProcessor.js', import.meta.url),
            );
            const workletNode = new AudioWorkletNode(audioContext, 'pcm-frame-processor', {
              numberOfInputs: 1,
              numberOfOutputs: 0,
              channelCount: 1,
            });
            workletNode.port.onmessage = (event) => {
              const floatFrame = event.data;
              if (floatFrame instanceof Float32Array) {
                handleAudioFrame(floatFrame, audioContext.sampleRate);
              }
            };
            sourceNodeRef.current.connect(workletNode);
            processorNodeRef.current = workletNode;
            attached = true;
          } catch (workletError) {
            console.warn('AudioWorklet capture unavailable, fallback to ScriptProcessor:', workletError);
          }
        }

        if (!attached) {
          const scriptNode = audioContext.createScriptProcessor(2048, 1, 1);
          const gainNode = audioContext.createGain();
          gainNode.gain.value = 0;

          scriptNode.onaudioprocess = (event) => {
            const channelData = event.inputBuffer.getChannelData(0);
            handleAudioFrame(channelData, audioContext.sampleRate);
          };

          sourceNodeRef.current.connect(scriptNode);
          scriptNode.connect(gainNode);
          gainNode.connect(audioContext.destination);

          processorNodeRef.current = scriptNode;
          gainNodeRef.current = gainNode;
        }

        setCaptureError('');
        setIsCapturing(true);
        return { ok: true };
      } catch (error) {
        stopCapture();
        setCaptureError(error?.message || 'capture_pipeline_start_failed');
        return { ok: false, reason: error?.name || 'capture_pipeline_start_failed' };
      }
    },
    [handleAudioFrame, isCapturing, requestPermission, stopCapture],
  );

  return useMemo(
    () => ({
      permission,
      isCapturing,
      captureError,
      requestPermission,
      startCapture,
      stopCapture,
    }),
    [permission, isCapturing, captureError, requestPermission, startCapture, stopCapture],
  );
}
