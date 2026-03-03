import { useCallback, useMemo, useRef, useState } from 'react';
import { MicVAD } from '@ricky0123/vad-web';

const DEFAULT_VAD_MODEL = 'v5';
const DEFAULT_VAD_ASSET_BASE =
  import.meta.env.VITE_VAD_ASSET_BASE_PATH || 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/';
const DEFAULT_ORT_ASSET_BASE =
  import.meta.env.VITE_ORT_WASM_BASE_PATH || 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/';

export function useSileroVad() {
  const vadRef = useRef(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [vadError, setVadError] = useState('');

  const start = useCallback(
    async ({ onSpeechStart, onSpeechEnd, onVADMisfire, model = DEFAULT_VAD_MODEL } = {}) => {
      if (isLoading) {
        return { ok: false, reason: 'vad_loading' };
      }

      if (vadRef.current && isListening) {
        return { ok: true, reason: 'already_listening' };
      }

      setIsLoading(true);
      setVadError('');

      try {
        const vad = await MicVAD.new({
          model,
          startOnLoad: false,
          baseAssetPath: DEFAULT_VAD_ASSET_BASE,
          onnxWASMBasePath: DEFAULT_ORT_ASSET_BASE,
          onSpeechStart: async () => {
            setIsSpeaking(true);
            if (typeof onSpeechStart === 'function') {
              await onSpeechStart();
            }
          },
          onSpeechEnd: async (audio) => {
            setIsSpeaking(false);
            if (typeof onSpeechEnd === 'function') {
              await onSpeechEnd(audio);
            }
          },
          onVADMisfire: async () => {
            setIsSpeaking(false);
            if (typeof onVADMisfire === 'function') {
              await onVADMisfire();
            }
          },
        });

        await vad.start();
        vadRef.current = vad;
        setIsListening(true);
        return { ok: true };
      } catch (error) {
        setVadError(error?.message || 'silero_vad_start_failed');
        return { ok: false, reason: error?.name || 'silero_vad_start_failed' };
      } finally {
        setIsLoading(false);
      }
    },
    [isListening, isLoading],
  );

  const stop = useCallback(async () => {
    const vad = vadRef.current;
    if (!vad) {
      return { ok: true, reason: 'not_started' };
    }

    try {
      await vad.destroy();
      return { ok: true };
    } catch (error) {
      setVadError(error?.message || 'silero_vad_stop_failed');
      return { ok: false, reason: error?.name || 'silero_vad_stop_failed' };
    } finally {
      vadRef.current = null;
      setIsListening(false);
      setIsSpeaking(false);
    }
  }, []);

  return useMemo(
    () => ({
      isLoading,
      isListening,
      isSpeaking,
      vadError,
      start,
      stop,
    }),
    [isLoading, isListening, isSpeaking, vadError, start, stop],
  );
}
