import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { desktopBridge } from '../../services/desktopBridge.js';
import { useI18n } from '../../i18n/I18nContext.jsx';

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeRenderMode(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'static' ? 'static' : 'live2d';
}

export default function StaticAvatarControls({
  desktopMode = false,
  renderMode = 'live2d',
  onRenderModeChange,
  selectedPackId = '',
  onSelectedPackIdChange,
  staticScale = 1,
  onStaticScaleChange,
  staticHitTest = null,
  onStaticHitTestChange,
  onPacksChange,
}) {
  const { t } = useI18n();
  const [packs, setPacks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const loadPacks = useCallback(async () => {
    if (!desktopMode) {
      setPacks([]);
      onPacksChange?.([]);
      return [];
    }

    setLoading(true);
    setError('');
    try {
      const result = await desktopBridge.staticAvatars.list();
      const nextPacks = Array.isArray(result?.packs) ? result.packs : [];
      setPacks(nextPacks);
      onPacksChange?.(nextPacks);
      return nextPacks;
    } catch (listError) {
      const message = typeof listError?.message === 'string' ? listError.message : t('avatar.controls.listFailed');
      setError(message);
      setPacks([]);
      onPacksChange?.([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [desktopMode, onPacksChange, t]);

  useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  const selectedPack = useMemo(
    () => packs.find((item) => item.packId === selectedPackId) || null,
    [packs, selectedPackId],
  );

  const hitTestMode = staticHitTest?.mode === 'rect' ? 'rect' : 'alpha';
  const hitTestThreshold = clamp(
    Number.isFinite(staticHitTest?.alphaThreshold) ? staticHitTest.alphaThreshold : 10,
    0,
    255,
  );

  const handleImportZip = async () => {
    setImporting(true);
    setError('');
    setFeedback('');
    try {
      const result = await desktopBridge.staticAvatars.importZip();
      if (!result?.ok) {
        if (!result?.canceled) {
          setError(result?.error?.message || t('avatar.controls.importFailed'));
        }
        return;
      }

      const nextPacks = Array.isArray(result.packs) ? result.packs : await loadPacks();
      const importedPackId = typeof result?.imported?.packId === 'string' ? result.imported.packId : '';
      if (importedPackId) {
        onSelectedPackIdChange?.(importedPackId);
      } else if (!selectedPackId && nextPacks.length > 0) {
        onSelectedPackIdChange?.(nextPacks[0].packId);
      }
      setFeedback(t('avatar.controls.importSucceeded'));
    } catch (importError) {
      const message = typeof importError?.message === 'string' ? importError.message : t('avatar.controls.importFailed');
      setError(message);
    } finally {
      setImporting(false);
    }
  };

  const handleRemoveSelected = async () => {
    const packId = selectedPack?.packId || '';
    if (!packId) {
      return;
    }

    const confirmed = typeof window === 'undefined'
      ? true
      : window.confirm(t('avatar.controls.removeConfirm', { name: selectedPack?.name || packId }));
    if (!confirmed) {
      return;
    }

    setRemoving(true);
    setError('');
    setFeedback('');
    try {
      const result = await desktopBridge.staticAvatars.remove(packId);
      if (!result?.ok) {
        setError(result?.error?.message || t('avatar.controls.removeFailed'));
        return;
      }

      const nextPacks = Array.isArray(result.packs) ? result.packs : await loadPacks();
      const nextSelected = nextPacks[0]?.packId || '';
      onSelectedPackIdChange?.(nextSelected);
      setFeedback(t('avatar.controls.removeSucceeded'));
    } catch (removeError) {
      const message = typeof removeError?.message === 'string' ? removeError.message : t('avatar.controls.removeFailed');
      setError(message);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Stack spacing={1.5}>
      {!desktopMode ? (
        <Alert severity="warning">{t('avatar.controls.desktopOnly')}</Alert>
      ) : null}

      <TextField
        select
        label={t('avatar.controls.renderMode')}
        value={normalizeRenderMode(renderMode)}
        onChange={(event) => onRenderModeChange?.(event.target.value)}
        fullWidth
      >
        <MenuItem value="live2d">{t('avatar.controls.renderModeLive2d')}</MenuItem>
        <MenuItem value="static">{t('avatar.controls.renderModeStatic')}</MenuItem>
      </TextField>

      {normalizeRenderMode(renderMode) === 'static' ? (
        <>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              onClick={() => {
                void handleImportZip();
              }}
              disabled={!desktopMode || importing}
            >
              {importing ? t('avatar.controls.importing') : t('avatar.controls.importZip')}
            </Button>
            <Button
              variant="text"
              color="warning"
              onClick={() => {
                void handleRemoveSelected();
              }}
              disabled={!desktopMode || removing || !selectedPack}
            >
              {removing ? t('avatar.controls.removing') : t('avatar.controls.removePack')}
            </Button>
          </Stack>

          <TextField
            select
            label={t('avatar.controls.packLabel')}
            value={selectedPackId}
            onChange={(event) => onSelectedPackIdChange?.(event.target.value)}
            helperText={loading ? t('avatar.controls.loadingPacks') : ''}
            fullWidth
          >
            {packs.length === 0 ? (
              <MenuItem value="">{t('avatar.controls.noPacks')}</MenuItem>
            ) : null}
            {packs.map((pack) => (
              <MenuItem key={pack.packId} value={pack.packId}>
                {pack.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label={t('avatar.controls.scaleLabel')}
            type="number"
            value={clamp(Number(staticScale), 0.1, 3)}
            onChange={(event) => {
              const nextScale = clamp(Number.parseFloat(event.target.value), 0.1, 3);
              onStaticScaleChange?.(nextScale);
            }}
            inputProps={{ min: 0.1, max: 3, step: 0.05 }}
            fullWidth
          />

          <TextField
            select
            label={t('avatar.controls.hitTestMode')}
            value={hitTestMode}
            onChange={(event) => onStaticHitTestChange?.({ mode: event.target.value })}
            fullWidth
          >
            <MenuItem value="alpha">{t('avatar.controls.hitTestModeAlpha')}</MenuItem>
            <MenuItem value="rect">{t('avatar.controls.hitTestModeRect')}</MenuItem>
          </TextField>

          {hitTestMode === 'alpha' ? (
            <TextField
              label={t('avatar.controls.alphaThreshold')}
              type="number"
              value={hitTestThreshold}
              onChange={(event) => {
                const nextThreshold = clamp(Number.parseInt(event.target.value, 10), 0, 255);
                onStaticHitTestChange?.({ alphaThreshold: nextThreshold });
              }}
              inputProps={{ min: 0, max: 255, step: 1 }}
              fullWidth
            />
          ) : null}

          {selectedPack ? (
            <Box sx={{ p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {selectedPack.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div">
                {t('avatar.controls.packId', { packId: selectedPack.packId })}
              </Typography>
              <Typography variant="caption" color="text.secondary" component="div">
                {t('avatar.controls.packVersion', { version: selectedPack.version || '1.0.0' })}
              </Typography>
            </Box>
          ) : null}
        </>
      ) : null}

      {error ? <Alert severity="error">{error}</Alert> : null}
      {feedback ? <Alert severity="success">{feedback}</Alert> : null}
    </Stack>
  );
}
