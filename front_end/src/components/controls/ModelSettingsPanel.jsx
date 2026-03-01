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
  return (
    <Accordion defaultExpanded>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
          <SettingsSuggestIcon fontSize="small" />
          <Typography sx={{ fontWeight: 600 }}>模型设置</Typography>
          <Chip
            size="small"
            color={modelLoaded ? 'success' : 'warning'}
            label={modelLoaded ? '模型已加载' : '加载中'}
          />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <FormControl fullWidth size="small">
            <InputLabel id="model-select-label">模型</InputLabel>
            <Select
              labelId="model-select-label"
              value={selectedModel}
              label="模型"
              onChange={(event) => onChangeModel(event.target.value)}
            >
              {availableModels.map((model) => (
                <MenuItem key={model.path} value={model.path}>
                  {model.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

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
