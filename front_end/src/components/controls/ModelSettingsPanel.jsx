import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';

export default function ModelSettingsPanel({
  modelLoaded,
  availableModels,
  selectedModel,
  onChangeModel,
  isImportingModel,
  onImportModelZip,
  modelLibraryError,
  autoEyeBlink,
  onToggleAutoEyeBlink,
  autoBreath,
  onToggleAutoBreath,
  eyeTracking,
  onToggleEyeTracking,
  modelScale,
  onChangeModelScale,
  onCommitModelScale,
  onResetModel,
}) {
  const hasModels = availableModels.length > 0;
  const selectValue = hasModels ? selectedModel || availableModels[0].path : '';
  const statusLabel = selectedModel ? (modelLoaded ? '模型已加载' : '加载中') : '未加载模型';
  const statusColor = selectedModel ? (modelLoaded ? 'success' : 'warning') : 'default';

  return (
    <Accordion defaultExpanded>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
          <SettingsSuggestIcon fontSize="small" />
          <Typography sx={{ fontWeight: 600 }}>模型设置</Typography>
          <Chip
            size="small"
            color={statusColor}
            label={statusLabel}
          />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <Button
            variant="outlined"
            onClick={onImportModelZip}
            disabled={isImportingModel}
          >
            {isImportingModel ? '导入中...' : '导入模型 ZIP'}
          </Button>

          <FormControl fullWidth size="small">
            <InputLabel id="model-select-label">模型</InputLabel>
            <Select
              labelId="model-select-label"
              value={selectValue}
              label="模型"
              disabled={!hasModels}
              onChange={(event) => onChangeModel(event.target.value)}
            >
              {!hasModels && (
                <MenuItem value="" disabled>
                  暂无可用模型，请先导入 ZIP
                </MenuItem>
              )}
              {availableModels.map((model) => (
                <MenuItem key={model.path} value={model.path}>
                  {model.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {!hasModels && (
            <Typography variant="caption" color="text.secondary">
              支持包含 `.model3.json` 的 Live2D 模型压缩包。
            </Typography>
          )}

          {modelLibraryError && (
            <Typography variant="caption" color="error">
              {modelLibraryError}
            </Typography>
          )}

          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>
              模型缩放: {modelScale.toFixed(2)}
            </Typography>
            <Slider
              value={modelScale}
              min={0.1}
              max={3}
              step={0.1}
              onChange={(_, value) => onChangeModelScale(Number(value))}
              onChangeCommitted={(_, value) => onCommitModelScale?.(Number(value))}
            />
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={autoEyeBlink}
                onChange={(event) => onToggleAutoEyeBlink(event.target.checked)}
              />
            }
            label="自动眨眼"
          />
          <FormControlLabel
            control={
              <Switch
                checked={autoBreath}
                onChange={(event) => onToggleAutoBreath(event.target.checked)}
              />
            }
            label="自动呼吸"
          />
          <FormControlLabel
            control={
              <Switch
                checked={eyeTracking}
                onChange={(event) => onToggleEyeTracking(event.target.checked)}
              />
            }
            label="眼神跟随"
          />

          <Button variant="outlined" onClick={onResetModel}>
            重置模型
          </Button>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
