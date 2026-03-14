export const NANOBOT_PROVIDER_OPTIONS = [
  { value: 'openrouter', labelKey: 'nanobot.provider.openrouter', fallbackLabel: 'OpenRouter' },
  { value: 'openai', labelKey: 'nanobot.provider.openai', fallbackLabel: 'OpenAI Compatible' },
  { value: 'anthropic', labelKey: 'nanobot.provider.anthropic', fallbackLabel: 'Anthropic' },
  { value: 'dashscope', labelKey: 'nanobot.provider.dashscope', fallbackLabel: 'DashScope' },
  { value: 'deepseek', labelKey: 'nanobot.provider.deepseek', fallbackLabel: 'DeepSeek' },
  { value: 'ollama', labelKey: 'nanobot.provider.ollama', fallbackLabel: 'Ollama' },
  { value: 'custom', labelKey: 'nanobot.provider.custom', fallbackLabel: 'Custom' },
];

export function extendNanobotProviderOptionsWithLegacy(options = [], currentValue = '') {
  const normalized = typeof currentValue === 'string' ? currentValue.trim() : '';
  if (!normalized) {
    return options;
  }
  if (options.some((item) => item?.value === normalized)) {
    return options;
  }
  return [
    {
      value: normalized,
      labelKey: 'nanobot.provider.legacy',
      fallbackLabel: `Legacy Provider (${normalized})`,
      legacyValue: normalized,
    },
    ...options,
  ];
}
