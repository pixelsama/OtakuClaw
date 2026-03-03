import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Stack, TextField } from '@mui/material';
import { useI18n } from '../../i18n/I18nContext.jsx';
import { useSileroVad } from '../../hooks/voice/useSileroVad.js';
import { useVoiceSession } from '../../hooks/voice/useVoiceSession.js';

const STATUS_CHIP_COLOR = {
  idle: 'default',
  listening: 'info',
  transcribing: 'warning',
  speaking: 'success',
  error: 'error',
};

function clampToInt16(sample) {
  const clamped = Math.max(-1, Math.min(1, sample));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function splitFloat32ToPcmChunks(audioFloat32, frameSamples = 320) {
  if (!(audioFloat32 instanceof Float32Array) || audioFloat32.length === 0) {
    return [];
  }

  const int16 = new Int16Array(audioFloat32.length);
  for (let i = 0; i < audioFloat32.length; i += 1) {
    int16[i] = clampToInt16(audioFloat32[i]);
  }

  const chunks = [];
  for (let offset = 0; offset < int16.length; offset += frameSamples) {
    const segment = int16.slice(offset, Math.min(offset + frameSamples, int16.length));
    if (!segment.length) {
      continue;
    }

    const pcmChunk = new Uint8Array(segment.length * 2);
    const view = new DataView(pcmChunk.buffer);
    for (let i = 0; i < segment.length; i += 1) {
      view.setInt16(i * 2, segment[i], true);
    }
    chunks.push(pcmChunk);
  }

  return chunks;
}

export default function VoiceSettingsPanel({ desktopMode = false }) {
  const { t } = useI18n();
  const seqRef = useRef(0);
  const chunkIdRef = useRef(0);
  const [capturedFrames, setCapturedFrames] = useState(0);

  const {
    sessionId,
    status,
    active,
    lastPartialText,
    lastFinalText,
    lastError,
    flowControl,
    startSession,
    sendAudioChunk,
    commitInput,
    stopSession,
    stopTts,
  } = useVoiceSession({ desktopMode });

  const {
    isLoading: isVadLoading,
    isListening: isVadListening,
    isSpeaking: isVadSpeaking,
    vadError,
    start: startVad,
    stop: stopVad,
  } = useSileroVad();

  const statusColor = useMemo(() => STATUS_CHIP_COLOR[status] || 'default', [status]);

  const handleSpeechEnd = useCallback(
    async (audioFloat32) => {
      const chunks = splitFloat32ToPcmChunks(audioFloat32, 320);
      if (!chunks.length) {
        return;
      }

      for (const pcmChunk of chunks) {
        seqRef.current += 1;
        chunkIdRef.current += 1;
        setCapturedFrames((value) => value + 1);

        const sent = await sendAudioChunk({
          seq: seqRef.current,
          chunkId: chunkIdRef.current,
          pcmChunk,
          sampleRate: 16000,
          channels: 1,
          sampleFormat: 'pcm_s16le',
          isSpeech: true,
        });

        if (!sent?.ok) {
          return;
        }
      }

      await commitInput({
        finalSeq: seqRef.current,
      });
    },
    [commitInput, sendAudioChunk],
  );

  const handleStart = useCallback(async () => {
    const started = await startSession({ mode: 'vad' });
    if (!started?.ok) {
      return;
    }

    seqRef.current = 0;
    chunkIdRef.current = 0;
    setCapturedFrames(0);

    const vadStarted = await startVad({
      onSpeechEnd: handleSpeechEnd,
    });

    if (!vadStarted?.ok) {
      await stopSession({ reason: 'vad_start_failed' });
    }
  }, [handleSpeechEnd, startSession, startVad, stopSession]);

  const handleCommit = useCallback(async () => {
    if (!active) {
      return;
    }

    await commitInput({
      finalSeq: seqRef.current,
    });
  }, [active, commitInput]);

  const handleStop = useCallback(async () => {
    await stopVad();
    await stopSession({ reason: 'manual' });
    seqRef.current = 0;
    chunkIdRef.current = 0;
    setCapturedFrames(0);
  }, [stopSession, stopVad]);

  const handleStopTts = useCallback(async () => {
    await stopTts({ reason: 'manual' });
  }, [stopTts]);

  return (
    <Stack spacing={2}>
      <Box sx={{ fontWeight: 600 }}>{t('voice.title')}</Box>
      <Alert severity="info">{t('voice.vadHint')}</Alert>
      {!desktopMode && <Alert severity="warning">{t('voice.desktopOnly')}</Alert>}
      {desktopMode && <Alert severity="info">{t('voice.liveCaptureHint')}</Alert>}

      <Stack direction="row" spacing={1} alignItems="center">
        <Chip size="small" color={statusColor} label={`${t('voice.status')}: ${status}`} />
        <Chip
          size="small"
          color={isVadSpeaking ? 'warning' : isVadListening ? 'success' : 'default'}
          label={
            isVadLoading
              ? t('voice.vadLoading')
              : isVadSpeaking
                ? t('voice.vadSpeaking')
                : isVadListening
                  ? t('voice.vadListening')
                  : t('voice.vadStopped')
          }
        />
      </Stack>

      <TextField
        label={t('voice.sessionId')}
        value={sessionId}
        placeholder={t('voice.sessionIdPlaceholder')}
        disabled
        fullWidth
      />
      <TextField label={t('voice.vadModel')} value="Silero VAD v5" disabled fullWidth />
      <TextField
        label={t('voice.flowControl')}
        value={`${flowControl.action} (${flowControl.bufferedMs}ms)`}
        disabled
        fullWidth
      />
      <TextField label={t('voice.capturedFrames')} value={capturedFrames} disabled fullWidth />

      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <Button variant="contained" onClick={handleStart} disabled={!desktopMode || active || isVadLoading}>
          {t('voice.startSession')}
        </Button>
        <Button variant="outlined" onClick={handleCommit} disabled={!desktopMode || !active}>
          {t('voice.commitInput')}
        </Button>
        <Button variant="outlined" color="warning" onClick={handleStopTts} disabled={!desktopMode || !active}>
          {t('voice.stopTts')}
        </Button>
        <Button variant="text" color="error" onClick={handleStop} disabled={!desktopMode || !active}>
          {t('voice.stopSession')}
        </Button>
      </Stack>

      <TextField
        label={t('voice.partialText')}
        value={lastPartialText}
        placeholder={t('voice.empty')}
        disabled
        fullWidth
      />
      <TextField
        label={t('voice.finalText')}
        value={lastFinalText}
        placeholder={t('voice.empty')}
        disabled
        fullWidth
      />

      {!!lastError && <Alert severity="error">{lastError}</Alert>}
      {!!vadError && <Alert severity="warning">{vadError}</Alert>}
    </Stack>
  );
}
