import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, IconButton, TextField } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useI18n } from '../../i18n/I18nContext.jsx';
import './EdgeComposer.css';

function isEditableTarget(target) {
  if (!target) {
    return false;
  }

  const tagName = target.tagName?.toLowerCase();
  if (tagName === 'input' || tagName === 'textarea') {
    return true;
  }

  if (typeof target.closest === 'function' && target.closest('[contenteditable="true"]')) {
    return true;
  }

  return false;
}

function normalizeErrorMessage(error, t) {
  const errorCode = typeof error?.message === 'string' ? error.message.trim() : '';
  if (errorCode === 'capture_permission_denied') {
    return t('composer.capturePermissionDenied');
  }
  if (errorCode === 'capture_not_supported') {
    return t('composer.captureUnsupported');
  }
  if (errorCode === 'capture_hide_failed') {
    return t('composer.captureHideFailed');
  }
  if (
    errorCode === 'capture_save_failed'
    || errorCode === 'capture_data_invalid'
    || errorCode === 'capture_too_large'
    || errorCode === 'capture_type_unsupported'
  ) {
    return t('composer.captureSaveFailed');
  }

  if (!error) {
    return t('common.sendFailed');
  }

  if (typeof error === 'string') {
    return error;
  }

  if (typeof error?.message === 'string' && error.message) {
    return error.message;
  }

  if (typeof error?.payload?.message === 'string' && error.payload.message) {
    return error.payload.message;
  }

  return t('common.sendFailed');
}

export default function EdgeComposer({
  variant = 'main',
  isStreaming = false,
  onSubmit,
  onStop,
  externalError = '',
  onDismissExternalError,
  onExpandedChange,
  placeholder,
  canCaptureScreen = false,
  onCaptureScreen,
  onReleaseCapture,
  voiceEnabled = false,
  voiceToggleDisabled = true,
  onToggleVoice,
}) {
  const { t } = useI18n();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const autoHideTimerRef = useRef(null);
  const captureDraftRef = useRef(null);

  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState('');
  const [localError, setLocalError] = useState('');
  const [isImeComposing, setIsImeComposing] = useState(false);
  const [captureDraft, setCaptureDraft] = useState(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const effectiveError = useMemo(() => localError || externalError || '', [externalError, localError]);

  const clearCaptureDraft = useCallback(
    (capture = captureDraft, { release = true } = {}) => {
      if (release && capture?.captureId) {
        void onReleaseCapture?.(capture.captureId);
      }
      setCaptureDraft(null);
    },
    [captureDraft, onReleaseCapture],
  );

  const clearAutoHideTimer = useCallback(() => {
    if (!autoHideTimerRef.current) {
      return;
    }

    clearTimeout(autoHideTimerRef.current);
    autoHideTimerRef.current = null;
  }, []);

  const openComposer = useCallback(() => {
    clearAutoHideTimer();
    setExpanded(true);
    setLocalError('');
    onDismissExternalError?.();

    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, [clearAutoHideTimer, onDismissExternalError]);

  const closeComposer = useCallback(() => {
    if (isStreaming) {
      return;
    }

    clearAutoHideTimer();
    setExpanded(false);
    setLocalError('');
    setValue('');
    clearCaptureDraft();
    onDismissExternalError?.();
  }, [clearAutoHideTimer, clearCaptureDraft, isStreaming, onDismissExternalError]);

  const submit = useCallback(async () => {
    const content = value.trim();
    if (!content) {
      setLocalError(t('composer.emptyInput'));
      return;
    }

    setLocalError('');
    onDismissExternalError?.();

    try {
      await onSubmit?.(content, {
        attachments: captureDraft
          ? [
              {
                kind: 'capture-image',
                captureId: captureDraft.captureId,
              },
            ]
          : [],
      });
      setValue('');
      setCaptureDraft(null);
      clearAutoHideTimer();
      autoHideTimerRef.current = setTimeout(() => {
        setExpanded(false);
      }, 1500);
    } catch (error) {
      setLocalError(normalizeErrorMessage(error, t));
    }
  }, [captureDraft, clearAutoHideTimer, onDismissExternalError, onSubmit, t, value]);

  const handleCaptureScreen = useCallback(async () => {
    if (isStreaming || isCapturing || typeof onCaptureScreen !== 'function') {
      return;
    }

    clearAutoHideTimer();
    setExpanded(true);
    setLocalError('');
    onDismissExternalError?.();
    setIsCapturing(true);

    try {
      const nextCapture = await onCaptureScreen();
      if (!nextCapture) {
        return;
      }

      if (captureDraft?.captureId && captureDraft.captureId !== nextCapture.captureId) {
        void onReleaseCapture?.(captureDraft.captureId);
      }
      setCaptureDraft(nextCapture);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    } catch (error) {
      setLocalError(normalizeErrorMessage(error, t));
    } finally {
      setIsCapturing(false);
    }
  }, [
    captureDraft?.captureId,
    clearAutoHideTimer,
    isCapturing,
    isStreaming,
    onCaptureScreen,
    onDismissExternalError,
    onReleaseCapture,
    t,
  ]);

  useEffect(() => {
    if (!expanded) {
      return undefined;
    }

    const onPointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) {
        return;
      }

      closeComposer();
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [closeComposer, expanded]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!expanded) {
        if (
          event.key === 'Enter' &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !isEditableTarget(event.target)
        ) {
          event.preventDefault();
          openComposer();
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        closeComposer();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [closeComposer, expanded, openComposer]);

  useEffect(() => {
    captureDraftRef.current = captureDraft;
  }, [captureDraft]);

  useEffect(() => {
    return () => {
      clearAutoHideTimer();
      if (captureDraftRef.current?.captureId) {
        void onReleaseCapture?.(captureDraftRef.current.captureId);
      }
    };
  }, [clearAutoHideTimer, onReleaseCapture]);

  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  return (
    <Box
      ref={rootRef}
      className={[
        'edge-composer',
        expanded ? 'expanded' : 'collapsed',
        `edge-composer-${variant}`,
      ]
        .filter(Boolean)
        .join(' ')}
      onPointerDownCapture={(event) => {
        event.stopPropagation();
      }}
    >
      <IconButton
        className={`voice-toggle edge-composer-toggle ${voiceEnabled ? 'is-active' : ''}`.trim()}
        color={voiceEnabled ? 'secondary' : 'primary'}
        onClick={() => {
          void onToggleVoice?.();
        }}
        disabled={voiceToggleDisabled}
        title={voiceEnabled ? t('composer.voiceDisableTitle') : t('composer.voiceEnableTitle')}
      >
        {voiceEnabled ? <MicIcon /> : <MicOffIcon />}
      </IconButton>

      <IconButton
        className="text-toggle edge-composer-toggle"
        color="primary"
        onClick={() => {
          if (expanded) {
            closeComposer();
          } else {
            openComposer();
          }
        }}
        title={t('composer.sendTextTitle')}
      >
        <EditIcon />
      </IconButton>

      {canCaptureScreen && (
        <IconButton
          className={`capture-toggle edge-composer-toggle ${captureDraft ? 'has-capture' : ''}`.trim()}
          color="primary"
          onClick={() => {
            void handleCaptureScreen();
          }}
          title={t('composer.captureTitle')}
          disabled={isStreaming || isCapturing}
        >
          <ContentCutIcon />
        </IconButton>
      )}

      {expanded && (
        <Box className="edge-composer-panel">
          {captureDraft && (
            <Box className="edge-composer-capture-preview">
              <img
                src={captureDraft.previewUrl}
                alt={t('composer.capturePreviewAlt')}
                className="edge-composer-capture-image"
              />
              <Box className="edge-composer-capture-meta">
                <Box className="edge-composer-capture-label">{t('composer.captureAttached')}</Box>
                <Box className="edge-composer-capture-name">{captureDraft.name}</Box>
              </Box>
              <IconButton
                size="small"
                className="edge-composer-capture-remove"
                onClick={() => {
                  clearCaptureDraft();
                }}
                disabled={isStreaming}
                title={t('composer.captureRemove')}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Box>
          )}

          <TextField
            inputRef={inputRef}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (localError) {
                setLocalError('');
              }
              if (externalError) {
                onDismissExternalError?.();
              }
            }}
            multiline
            minRows={variant === 'pet' ? 2 : 3}
            maxRows={6}
            placeholder={placeholder || t('composer.placeholder')}
            disabled={isStreaming}
            inputProps={{ maxLength: 400 }}
            onKeyDown={(event) => {
              if (event.nativeEvent?.isComposing || event.keyCode === 229 || isImeComposing) {
                return;
              }

              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
            onCompositionStart={() => {
              setIsImeComposing(true);
            }}
            onCompositionEnd={() => {
              setIsImeComposing(false);
            }}
            fullWidth
          />

          {effectiveError && <Box className="edge-composer-error">{effectiveError}</Box>}

          <Box className="edge-composer-actions">
            <Button
              size="small"
              startIcon={<CloseIcon fontSize="small" />}
              onClick={closeComposer}
              disabled={isStreaming}
            >
              {t('composer.collapse')}
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<SendIcon fontSize="small" />}
              onClick={() => {
                void submit();
              }}
              disabled={isStreaming || isCapturing}
            >
              {t('composer.send')}
            </Button>
            <Button
              size="small"
              color="warning"
              startIcon={<StopCircleIcon fontSize="small" />}
              onClick={onStop}
              disabled={!isStreaming}
            >
              {t('composer.stop')}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
