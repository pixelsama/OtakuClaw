import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  TextField,
  Tooltip,
} from '@mui/material';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import CameraAltRoundedIcon from '@mui/icons-material/CameraAltRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import RouteRoundedIcon from '@mui/icons-material/RouteRounded';
import TravelExploreRoundedIcon from '@mui/icons-material/TravelExploreRounded';
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

export default function ScenicGuideShell({
  desktopMode = false,
  platform = '',
  onWindowControl,
  onOpenAdminPortal,
  initialManifest = null,
  initialAnswerResult = null,
}) {
  const questionInputRef = useRef(null);
  const [manifest, setManifest] = useState(initialManifest);
  const [loadingManifest, setLoadingManifest] = useState(true);
  const [questionText, setQuestionText] = useState('');
  const [askingQuestion, setAskingQuestion] = useState(false);
  const [answerResult, setAnswerResult] = useState(initialAnswerResult);
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
        label: '讲解资料',
        value: imported ? formatNumber(manifest?.knowledgeSummary?.knowledgeBlockCount || 0) : '--',
        icon: <CheckCircleRoundedIcon />,
      },
    ],
    [imported, manifest?.knowledgeSummary?.knowledgeBlockCount, summary.routeCount, summary.spotCount],
  );

  const routeNames = useMemo(
    () => [
      '历史文化爱好者路线',
      '自然风光爱好者路线',
      '亲子家庭路线',
    ],
    [],
  );

  const suggestedQuestions = useMemo(
    () => [
      '灵山大佛有什么特色？',
      '九龙灌浴适合什么时候看？',
      '亲子家庭适合走哪条路线？',
    ],
    [],
  );

  const activePromptText = answerResult?.question || questionText.trim() || '九龙灌浴有什么看点？';
  const answerStatusLabel = askingQuestion
    ? '检索中'
    : answerResult?.status === 'no_hit'
      ? '未命中'
      : answerResult?.answer
        ? '可追溯来源'
        : imported
          ? '可追溯来源'
          : '准备中';

  const answerConfidenceLabel = Number.isFinite(answerResult?.confidence)
    ? `匹配度 ${Math.round(answerResult.confidence * 100)}%`
    : '';

  const handleAskQuestion = useCallback(async (nextQuestion) => {
    const normalizedQuestion = typeof nextQuestion === 'string' ? nextQuestion.trim() : questionText.trim();
    if (!normalizedQuestion || askingQuestion || !imported) {
      return;
    }

    setAskingQuestion(true);
    setFeedback(null);
    setQuestionText(normalizedQuestion);
    try {
      const result = await desktopBridge.scenicGuide.askQuestion({
        question: normalizedQuestion,
        limit: 5,
      });
      if (result?.ok) {
        setAnswerResult(result);
        return;
      }

      setAnswerResult(null);
      setFeedback({
        severity: 'warning',
        text: result?.error?.message || '导览回答失败',
      });
    } catch (error) {
      setAnswerResult(null);
      setFeedback({
        severity: 'warning',
        text: error?.message || '导览回答失败',
      });
    } finally {
      setAskingQuestion(false);
    }
  }, [askingQuestion, imported, questionText]);

  const handleSubmitQuestion = useCallback((event) => {
    event.preventDefault();
    void handleAskQuestion();
  }, [handleAskQuestion]);

  const handleUseSuggestedQuestion = useCallback((question) => {
    setQuestionText(question);
    void handleAskQuestion(question);
  }, [handleAskQuestion]);

  const handleShowPlannedFeature = useCallback((featureName) => {
    setFeedback({
      severity: 'info',
      text: `${featureName}正在接入中，当前版本先支持文字导览问答。`,
    });
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

          <Tooltip title="景区管理后台">
            <IconButton
              className="scenic-guide-admin-button"
              aria-label="景区管理后台"
              onClick={onOpenAdminPortal}
            >
              <AdminPanelSettingsRoundedIcon />
            </IconButton>
          </Tooltip>
        </header>

        <Box className="scenic-guide-status-row">
          {!imported ? (
            <Alert
              severity="info"
              icon={loadingManifest ? <CircularProgress size={18} /> : <ErrorOutlineRoundedIcon />}
              className="scenic-guide-alert"
            >
              导览资料准备中，请联系景区工作人员
            </Alert>
          ) : (
            <Alert severity="success" icon={<CheckCircleRoundedIcon />} className="scenic-guide-alert">
              灵山胜境导览资料已就绪
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
                <span>{activePromptText}</span>
                <Chip size="small" label={answerStatusLabel} />
              </Box>

              <Box
                component="form"
                className="scenic-guide-question-form"
                onSubmit={handleSubmitQuestion}
              >
                <TextField
                  inputRef={questionInputRef}
                  value={questionText}
                  onChange={(event) => {
                    setQuestionText(event.target.value);
                  }}
                  placeholder={imported ? '输入想问的景点、路线或游玩建议' : '导入官方资料后可开始提问'}
                  multiline
                  minRows={3}
                  fullWidth
                  disabled={!imported || askingQuestion}
                />
                <Button
                  type="submit"
                  variant="contained"
                  disabled={!imported || askingQuestion || !questionText.trim()}
                >
                  {askingQuestion ? '检索中' : '开始导览'}
                </Button>
              </Box>

              <Box className="scenic-guide-answer-panel" aria-label="导览回答">
                {askingQuestion ? (
                  <Box className="scenic-guide-answer-placeholder">
                    <CircularProgress size={20} />
                    <span>正在检索灵山胜境官方资料并整理回答</span>
                  </Box>
                ) : answerResult?.answer ? (
                  <>
                    <Box className="scenic-guide-answer-copy">
                      <p>{answerResult.answer}</p>
                    </Box>
                    <Box className="scenic-guide-answer-meta">
                      {answerConfidenceLabel ? (
                        <Chip size="small" label={answerConfidenceLabel} />
                      ) : null}
                      <Chip
                        size="small"
                        label={`来源 ${Array.isArray(answerResult.sources) ? answerResult.sources.length : 0} 条`}
                      />
                    </Box>
                    {Array.isArray(answerResult.sources) && answerResult.sources.length ? (
                      <Box className="scenic-guide-source-list" aria-label="来源列表">
                        {answerResult.sources.map((source) => (
                          <Box className="scenic-guide-source-item" key={source.blockId || source.title}>
                            <strong>{source.title}</strong>
                            <span>{source.excerpt}</span>
                          </Box>
                        ))}
                      </Box>
                    ) : null}
                  </>
                ) : (
                  <Box className="scenic-guide-answer-placeholder">
                    <ChatBubbleOutlineRoundedIcon />
                    <span>可以先问景点特色、官方路线、游玩顺序或亲子推荐。</span>
                  </Box>
                )}
              </Box>
            </Box>

            <Box className="scenic-guide-actions" aria-label="导览输入">
              <Tooltip title="文字提问">
                <IconButton
                  className="scenic-guide-action-button"
                  aria-label="文字提问"
                  disabled={!imported}
                  onClick={() => {
                    questionInputRef.current?.focus?.();
                  }}
                >
                  <ChatBubbleOutlineRoundedIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={imported ? '语音问答开发中' : '语音提问'}>
                <IconButton
                  className="scenic-guide-action-button"
                  aria-label="语音提问"
                  disabled={!imported}
                  onClick={() => {
                    handleShowPlannedFeature('语音问答');
                  }}
                >
                  <MicRoundedIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={imported ? '拍照问导游开发中' : '拍照问导游'}>
                <IconButton
                  className="scenic-guide-action-button"
                  aria-label="拍照问导游"
                  disabled={!imported}
                  onClick={() => {
                    handleShowPlannedFeature('拍照问导游');
                  }}
                >
                  <CameraAltRoundedIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </section>

          <aside className="scenic-guide-side">
            <section className="scenic-guide-tourist-panel" aria-label="推荐问法">
              <Box className="scenic-guide-section-heading">
                <ChatBubbleOutlineRoundedIcon />
                <h2>推荐问法</h2>
              </Box>
              <Box className="scenic-guide-route-list">
                {suggestedQuestions.map((question) => (
                  <button
                    className="scenic-guide-route-item scenic-guide-route-button"
                    type="button"
                    key={question}
                    disabled={!imported || askingQuestion}
                    onClick={() => {
                      handleUseSuggestedQuestion(question);
                    }}
                  >
                    <span>{question}</span>
                    <Chip size="small" label={imported ? '可问' : '准备中'} />
                  </button>
                ))}
              </Box>
            </section>

            <section className="scenic-guide-stat-grid" aria-label="导览资料摘要">
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
