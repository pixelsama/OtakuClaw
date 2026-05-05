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
import CameraAltRoundedIcon from '@mui/icons-material/CameraAltRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import RouteRoundedIcon from '@mui/icons-material/RouteRounded';
import TravelExploreRoundedIcon from '@mui/icons-material/TravelExploreRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import WindowTitleBar from '../components/window/WindowTitleBar.jsx';
import { desktopBridge } from '../services/desktopBridge.js';
import './ScenicGuideShell.css';

function hasImportedOfficialData(manifest) {
  return Boolean(
    manifest?.datasetId
      && manifest?.scenicId === 'lingshan'
      && Number(manifest?.importSummary?.spotCount || 0) > 0,
  );
}

function formatNumber(value, fallback = '--') {
  return Number.isFinite(value) ? value.toLocaleString('zh-CN') : fallback;
}

function normalizeImportError(result) {
  if (result?.canceled) {
    return '';
  }
  return result?.error?.message || '资料包导入失败';
}

export default function ScenicGuideShell({
  desktopMode = false,
  platform = '',
  onWindowControl,
  initialManifest = null,
}) {
  const [manifest, setManifest] = useState(initialManifest);
  const [loadingManifest, setLoadingManifest] = useState(true);
  const [importing, setImporting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const imported = hasImportedOfficialData(manifest);
  const summary = manifest?.importSummary || {};

  const loadManifest = useCallback(async () => {
    setLoadingManifest(true);
    try {
      const result = await desktopBridge.scenicGuide.getManifest();
      if (result?.ok) {
        setManifest(result.manifest || null);
      } else {
        setFeedback({
          severity: 'warning',
          text: result?.error?.message || '资料状态读取失败',
        });
      }
    } catch (error) {
      setFeedback({
        severity: 'warning',
        text: error?.message || '资料状态读取失败',
      });
    } finally {
      setLoadingManifest(false);
    }
  }, []);

  useEffect(() => {
    void loadManifest();
  }, [loadManifest]);

  const stats = useMemo(
    () => [
      {
        key: 'spots',
        label: '官方点位',
        value: imported ? formatNumber(summary.spotCount) : '--',
        icon: <TravelExploreRoundedIcon />,
      },
      {
        key: 'routes',
        label: '推荐路线',
        value: imported ? formatNumber(summary.routeCount) : '--',
        icon: <RouteRoundedIcon />,
      },
      {
        key: 'records',
        label: '游客记录',
        value: imported ? formatNumber(summary.behaviorDataRowCount) : '--',
        icon: <CheckCircleRoundedIcon />,
      },
    ],
    [imported, summary.behaviorDataRowCount, summary.routeCount, summary.spotCount],
  );

  const routeNames = useMemo(
    () => [
      '历史文化爱好者路线',
      '自然风光爱好者路线',
      '亲子家庭路线',
    ],
    [],
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
      setFeedback({
        severity: 'success',
        text: '官方资料包已导入',
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
    <Box className="scenic-guide-shell">
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

      <Box className="scenic-guide-main">
        <header className="scenic-guide-header">
          <Box className="scenic-guide-brand">
            <Box className="scenic-guide-brand-mark" aria-hidden="true">
              <TravelExploreRoundedIcon />
            </Box>
            <Box>
              <h1>灵山胜境 AI 导游</h1>
              <p>景区导览服务 AI 数字人</p>
            </Box>
          </Box>

          <Button
            variant="contained"
            startIcon={importing ? <CircularProgress size={16} color="inherit" /> : <UploadFileRoundedIcon />}
            onClick={handleImportOfficialData}
            disabled={importing}
            className="scenic-guide-import-button"
          >
            {importing ? '导入中' : '导入官方资料包'}
          </Button>
        </header>

        <Box className="scenic-guide-status-row">
          {!imported ? (
            <Alert
              severity="info"
              icon={loadingManifest ? <CircularProgress size={18} /> : <ErrorOutlineRoundedIcon />}
              className="scenic-guide-alert"
            >
              请管理员导入官方资料包
            </Alert>
          ) : (
            <Alert severity="success" icon={<CheckCircleRoundedIcon />} className="scenic-guide-alert">
              官方资料包已就绪
            </Alert>
          )}
          {feedback?.text ? (
            <Alert severity={feedback.severity || 'info'} className="scenic-guide-feedback">
              {feedback.text}
            </Alert>
          ) : null}
        </Box>

        <Box className="scenic-guide-content">
          <section className="scenic-guide-stage" aria-label="数字人导览台">
            <Box className="scenic-guide-avatar-panel">
              <Box className="scenic-guide-avatar" aria-hidden="true">
                <TravelExploreRoundedIcon />
              </Box>
              <Box className="scenic-guide-avatar-copy">
                <h2>数字人讲解员</h2>
                <p>{imported ? '灵山胜境资料已连接' : '等待官方资料连接'}</p>
              </Box>
            </Box>

            <Box className="scenic-guide-dialog-surface">
              <Box className="scenic-guide-dialog-heading">
                <ChatBubbleOutlineRoundedIcon />
                <span>导览问答</span>
              </Box>
              <Box className="scenic-guide-prompt-row">
                <span>九龙灌浴有什么看点？</span>
                <Chip size="small" label={imported ? '可追溯来源' : '待导入'} />
              </Box>
            </Box>

            <Box className="scenic-guide-actions" aria-label="导览输入">
              <Tooltip title="文字提问">
                <IconButton className="scenic-guide-action-button" aria-label="文字提问" disabled={!imported}>
                  <ChatBubbleOutlineRoundedIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="语音提问">
                <IconButton className="scenic-guide-action-button" aria-label="语音提问" disabled={!imported}>
                  <MicRoundedIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="拍照问导游">
                <IconButton className="scenic-guide-action-button" aria-label="拍照问导游" disabled={!imported}>
                  <CameraAltRoundedIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </section>

          <aside className="scenic-guide-side">
            <section className="scenic-guide-stat-grid" aria-label="资料摘要">
              {stats.map((item) => (
                <Box className="scenic-guide-stat" key={item.key}>
                  <span className="scenic-guide-stat-icon">{item.icon}</span>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </Box>
              ))}
            </section>

            <section className="scenic-guide-routes" aria-label="官方路线">
              <Box className="scenic-guide-section-heading">
                <RouteRoundedIcon />
                <h2>官方路线</h2>
              </Box>
              <Box className="scenic-guide-route-list">
                {routeNames.map((routeName) => (
                  <Box className="scenic-guide-route-item" key={routeName}>
                    <span>{routeName}</span>
                    <Chip size="small" label={imported ? '已加载' : '待加载'} />
                  </Box>
                ))}
              </Box>
            </section>
          </aside>
        </Box>
      </Box>
    </Box>
  );
}

export { hasImportedOfficialData };
