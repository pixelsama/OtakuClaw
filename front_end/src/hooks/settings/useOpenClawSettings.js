import { useCallback, useEffect, useState } from 'react';
import { desktopBridge } from '../../services/desktopBridge.js';

const defaultOpenClawSettings = {
  baseUrl: '',
  token: '',
  agentId: 'main',
  hasToken: false,
  hasSecureStorage: true,
};

export function buildOpenClawSettingsPayload(settings) {
  const payload = {
    baseUrl: settings?.baseUrl || '',
    agentId: settings?.agentId || '',
  };
  const token = settings?.token?.trim?.() || '';
  if (token) {
    payload.token = token;
  }
  return payload;
}

export function formatOpenClawSettingsError({ error, normalizeError, t }) {
  if (typeof normalizeError === 'function') {
    return normalizeError(error);
  }

  if (typeof error === 'string' && error) {
    return error;
  }

  if (typeof error?.message === 'string' && error.message) {
    return error.message;
  }

  return t('common.requestFailed');
}

export function useOpenClawSettings({ t, normalizeError }) {
  const [openClawSettings, setOpenClawSettings] = useState(defaultOpenClawSettings);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsTesting, setSettingsTesting] = useState(false);
  const [settingsFeedback, setSettingsFeedback] = useState('');
  const [settingsError, setSettingsError] = useState('');

  const formatError = useCallback(
    (error) => formatOpenClawSettingsError({ error, normalizeError, t }),
    [normalizeError, t],
  );

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      try {
        const settings = await desktopBridge.settings.get();
        if (!mounted) {
          return;
        }

        setOpenClawSettings({
          ...defaultOpenClawSettings,
          ...settings,
        });
      } catch (error) {
        console.error('Failed to load OpenClaw settings:', error);
      }
    };

    void loadSettings();

    return () => {
      mounted = false;
    };
  }, []);

  const onOpenClawSettingChange = useCallback((field, value) => {
    setOpenClawSettings((prev) => ({
      ...prev,
      [field]: value,
    }));
    setSettingsFeedback('');
    setSettingsError('');
  }, []);

  const onSaveOpenClawSettings = useCallback(async () => {
    setSettingsSaving(true);
    setSettingsError('');
    setSettingsFeedback('');

    try {
      const payload = buildOpenClawSettingsPayload(openClawSettings);

      const saved = await desktopBridge.settings.save(payload);
      setOpenClawSettings({
        ...defaultOpenClawSettings,
        ...saved,
      });
      setSettingsFeedback(t('app.settingsSaved'));
    } catch (error) {
      console.error('Save OpenClaw settings failed:', error);
      setSettingsError(formatError(error));
    } finally {
      setSettingsSaving(false);
    }
  }, [formatError, openClawSettings, t]);

  const onTestOpenClawSettings = useCallback(async () => {
    setSettingsTesting(true);
    setSettingsError('');
    setSettingsFeedback('');

    try {
      const payload = buildOpenClawSettingsPayload(openClawSettings);

      const result = await desktopBridge.settings.testConnection(payload);
      if (!result?.ok) {
        setSettingsError(formatError(result?.error));
      } else {
        const latency = typeof result.latencyMs === 'number' ? t('app.latency', { latency: result.latencyMs }) : '';
        setSettingsFeedback(t('app.settingsConnected', { latency }));
      }
    } catch (error) {
      console.error('Test OpenClaw settings failed:', error);
      setSettingsError(formatError(error));
    } finally {
      setSettingsTesting(false);
    }
  }, [formatError, openClawSettings, t]);

  const onClearSavedToken = useCallback(async () => {
    setSettingsSaving(true);
    setSettingsError('');
    setSettingsFeedback('');

    try {
      const saved = await desktopBridge.settings.save({ clearToken: true });
      setOpenClawSettings((prev) => ({
        ...prev,
        ...saved,
        token: '',
      }));
      setSettingsFeedback(t('app.tokenCleared'));
    } catch (error) {
      console.error('Clear token failed:', error);
      setSettingsError(formatError(error));
    } finally {
      setSettingsSaving(false);
    }
  }, [formatError, t]);

  return {
    openClawSettings,
    settingsSaving,
    settingsTesting,
    settingsFeedback,
    settingsError,
    onOpenClawSettingChange,
    onSaveOpenClawSettings,
    onTestOpenClawSettings,
    onClearSavedToken,
  };
}
