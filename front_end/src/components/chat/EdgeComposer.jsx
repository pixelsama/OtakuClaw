import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, IconButton, TextField } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import StopCircleIcon from '@mui/icons-material/StopCircle';
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

function normalizeErrorMessage(error) {
  if (!error) {
    return '发送失败，请稍后重试。';
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

  return '发送失败，请稍后重试。';
}

export default function EdgeComposer({
  variant = 'main',
  isStreaming = false,
  onSubmit,
  onStop,
  externalError = '',
  onDismissExternalError,
  onExpandedChange,
  placeholder = '输入你想让她说的话...',
}) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const autoHideTimerRef = useRef(null);

  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState('');
  const [localError, setLocalError] = useState('');
  const [isImeComposing, setIsImeComposing] = useState(false);

  const effectiveError = useMemo(() => localError || externalError || '', [externalError, localError]);

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
    onDismissExternalError?.();
  }, [clearAutoHideTimer, isStreaming, onDismissExternalError]);

  const submit = useCallback(async () => {
    const content = value.trim();
    if (!content) {
      setLocalError('请输入要发送的内容。');
      return;
    }

    setLocalError('');
    onDismissExternalError?.();

    try {
      await onSubmit?.(content);
      setValue('');
      clearAutoHideTimer();
      autoHideTimerRef.current = setTimeout(() => {
        setExpanded(false);
      }, 1500);
    } catch (error) {
      setLocalError(normalizeErrorMessage(error));
    }
  }, [clearAutoHideTimer, onDismissExternalError, onSubmit, value]);

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
    return () => {
      clearAutoHideTimer();
    };
  }, [clearAutoHideTimer]);

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
        className="text-toggle edge-composer-toggle"
        color="primary"
        onClick={() => {
          if (expanded) {
            closeComposer();
          } else {
            openComposer();
          }
        }}
        title="发送文字消息"
      >
        <EditIcon />
      </IconButton>

      {expanded && (
        <Box className="edge-composer-panel">
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
            placeholder={placeholder}
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
              收起
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<SendIcon fontSize="small" />}
              onClick={() => {
                void submit();
              }}
              disabled={isStreaming}
            >
              发送
            </Button>
            <Button
              size="small"
              color="warning"
              startIcon={<StopCircleIcon fontSize="small" />}
              onClick={onStop}
              disabled={!isStreaming}
            >
              停止
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
