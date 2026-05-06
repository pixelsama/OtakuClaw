import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Tooltip,
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import DatasetRoundedIcon from '@mui/icons-material/DatasetRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import RouteRoundedIcon from '@mui/icons-material/RouteRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import TravelExploreRoundedIcon from '@mui/icons-material/TravelExploreRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import WindowTitleBar from '../components/window/WindowTitleBar.jsx';
import { desktopBridge } from '../services/desktopBridge.js';
import { hasImportedOfficialData } from './ScenicGuideShell.jsx';
import './ScenicAdminShell.css';

function formatNumber(value, fallback = '--') {
  return Number.isFinite(value) ? value.toLocaleString('zh-CN') : fallback;
}

function normalizeImportError(result) {
  if (result?.canceled) {
    return '';
  }
  return result?.error?.message || '资料包导入失败';
}

function normalizeSourceStatus(sources = []) {
  return (Array.isArray(sources) ? sources : []).map((source) => ({
    id: source.id || source.fileName,
    fileName: source.fileName || source.id || '官方资料文件',
    role: source.role || '',
    exists: source.exists !== false,
  }));
}

export default function ScenicAdminShell({
  desktopMode = false,
  platform = '',
  onWindowControl,
  onBackToGuide,
  onOpenAdvancedSettings,
  initialManifest = null,
}) {
  const [manifest, setManifest] = useState(initialManifest);
  const [knowledgeSummary, setKnowledgeSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const imported = hasImportedOfficialData(manifest);
  const summary = manifest?.importSummary || {};
  const resolvedKnowledgeSummary = knowledgeSummary || manifest?.knowledgeSummary || null;

  const loadAdminState = useCallback(async () => {
    setLoading(true);
    try {
      const [manifestResult, knowledgeResult] = await Promise.all([
        desktopBridge.scenicGuide.getManifest(),
        desktopBridge.scenicGuide.getKnowledgeSummary(),
      ]);
      if (manifestResult?.ok) {
        setManifest(manifestResult.manifest || null);
      }
      if (knowledgeResult?.ok) {
        setKnowledgeSummary(knowledgeResult.knowledgeSummary || null);
      }
    } catch (error) {
      setFeedback({
        severity: 'warning',
        text: error?.message || '后台状态读取失败',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAdminState();
  }, [loadAdminState]);

  const metrics = useMemo(
    () => [
      {
        key: 'spots',
        label: '官方点位',
        value: imported ? formatNumber(summary.spotCount) : '--',
        icon: <TravelExploreRoundedIcon />,
      },
      {
        key: 'routes',
        label: '官方路线',
        value: imported ? formatNumber(summary.routeCount) : '--',
        icon: <RouteRoundedIcon />,
      },
      {
        key: 'records',
        label: '行为记录',
        value: imported ? formatNumber(summary.behaviorDataRowCount) : '--',
        icon: <DatasetRoundedIcon />,
      },
      {
        key: 'blocks',
        label: '知识块',
        value: resolvedKnowledgeSummary ? formatNumber(resolvedKnowledgeSummary.knowledgeBlockCount) : '--',
        icon: <DescriptionRoundedIcon />,
      },
    ],
    [imported, resolvedKnowledgeSummary, summary.behaviorDataRowCount, summary.routeCount, summary.spotCount],
  );

  const sourceStatus = useMemo(
    () => normalizeSourceStatus(manifest?.sources),
    [manifest?.sources],
  );

  const handleImportOfficialData = useCallback(async () => {
    setImporting(true);
    setFeedback(null);
    try {
      const picked = await desktopBridge.scenicGuide.pickDataDirectory();
      if (!picked?.ok) {
        const errorText = normalizeImportError(picked);
        if (errorText) {
          setFeedback({ severity: 'warning', text: errorText });
        }
        return;
      }

      const result = await desktopBridge.scenicGuide.importOfficialData({
        directoryPath: picked.directoryPath,
      });
      if (!result?.ok) {
        setFeedback({
          severity: 'error',
          text: normalizeImportError(result),
        });
        return;
      }

      setManifest(result.manifest || null);
      setKnowledgeSummary(result.knowledgeSummary || null);
      setFeedback({
        severity: 'success',
        text: '官方资料包已导入并重建知识库',
      });
    } catch (error) {
      setFeedback({
        severity: 'error',
        text: error?.message || '资料包导入失败',
      });
    } finally {
      setImporting(false);
    }
  }, []);

  return (
    <Box className="scenic-admin-shell">
      {desktopMode && (
        <WindowTitleBar
          platform={platform}
          onMinimize={() => {
            void onWindowControl?.('minimize');
          }}
          onToggleMaximize={() => {
            void onWindowControl?.('toggle-maximize');
          }}
          onClose={() => {
            void onWindowControl?.('close');
          }}
        />
      )}

      <Box className="scenic-admin-main">
        <header className="scenic-admin-header">
          <Box className="scenic-admin-title">
            <Tooltip title="返回游客端">
              <IconButton aria-label="返回游客端" onClick={onBackToGuide} className="scenic-admin-icon-button">
                <ArrowBackRoundedIcon />
              </IconButton>
            </Tooltip>
            <Box>
              <h1>景区管理后台</h1>
              <p>官方资料、知识库与导览运营管理</p>
            </Box>
          </Box>

          <Box className="scenic-admin-actions">
            <Button
              variant="contained"
              startIcon={importing ? <CircularProgress size={16} color="inherit" /> : <UploadFileRoundedIcon />}
              onClick={handleImportOfficialData}
              disabled={importing}
            >
              {importing ? '导入中' : '导入官方资料包'}
            </Button>
            <Tooltip title="高级设置">
              <IconButton
                aria-label="高级设置"
                onClick={onOpenAdvancedSettings}
                className="scenic-admin-icon-button"
              >
                <SettingsRoundedIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </header>

        <Box className="scenic-admin-status-row">
          <Alert
            severity={imported ? 'success' : 'info'}
            icon={loading ? <CircularProgress size={18} /> : imported ? <CheckCircleRoundedIcon /> : <DatasetRoundedIcon />}
            className="scenic-admin-alert"
          >
            {imported ? '官方资料与知识库已就绪' : '请导入比赛官方资料包'}
          </Alert>
          {feedback?.text ? (
            <Alert severity={feedback.severity || 'info'} className="scenic-admin-feedback">
              {feedback.text}
            </Alert>
          ) : null}
        </Box>

        <section className="scenic-admin-metrics" aria-label="后台摘要">
          {metrics.map((metric) => (
            <Box className="scenic-admin-metric" key={metric.key}>
              <span>{metric.icon}</span>
              <strong>{metric.value}</strong>
              <em>{metric.label}</em>
            </Box>
          ))}
        </section>

        <Box className="scenic-admin-grid">
          <section className="scenic-admin-section" aria-label="数据源管理">
            <Box className="scenic-admin-section-heading">
              <DatasetRoundedIcon />
              <h2>数据源管理</h2>
            </Box>
            <Box className="scenic-admin-list">
              {(sourceStatus.length ? sourceStatus : [
                { id: 'spot', fileName: '景点结构化数据集', exists: false },
                { id: 'guide', fileName: '历史文化与游览指南', exists: false },
                { id: 'behavior', fileName: '旅游行为数据', exists: false },
              ]).map((source) => (
                <Box className="scenic-admin-list-item" key={source.id}>
                  <span>{source.fileName}</span>
                  <Chip size="small" label={source.exists ? '已识别' : '待导入'} />
                </Box>
              ))}
            </Box>
          </section>

          <section className="scenic-admin-section" aria-label="知识库状态">
            <Box className="scenic-admin-section-heading">
              <DescriptionRoundedIcon />
              <h2>知识库状态</h2>
            </Box>
            <Box className="scenic-admin-list">
              <Box className="scenic-admin-list-item">
                <span>官方知识块</span>
                <Chip size="small" label={formatNumber(resolvedKnowledgeSummary?.officialKnowledgeBlockCount || 0)} />
              </Box>
              <Box className="scenic-admin-list-item">
                <span>人工补充知识</span>
                <Chip size="small" label={formatNumber(resolvedKnowledgeSummary?.manualKnowledgeBlockCount || 0)} />
              </Box>
              <Box className="scenic-admin-list-item">
                <span>知识库版本</span>
                <Chip size="small" label={formatNumber(resolvedKnowledgeSummary?.version || 0)} />
              </Box>
            </Box>
          </section>

          <section className="scenic-admin-section scenic-admin-section--wide" aria-label="路线管理">
            <Box className="scenic-admin-section-heading">
              <RouteRoundedIcon />
              <h2>路线管理</h2>
            </Box>
            <Box className="scenic-admin-route-row">
              {['历史文化爱好者路线', '自然风光爱好者路线', '亲子家庭路线'].map((routeName) => (
                <Box className="scenic-admin-route" key={routeName}>
                  <strong>{routeName}</strong>
                  <Chip size="small" label={imported ? '官方路线' : '待导入'} />
                </Box>
              ))}
            </Box>
          </section>
        </Box>
      </Box>
    </Box>
  );
}
