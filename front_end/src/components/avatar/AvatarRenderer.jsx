import { forwardRef, useImperativeHandle, useRef } from 'react';
import Live2DViewer from '../live2d/Live2DViewer.jsx';
import StaticAvatarViewer from './StaticAvatarViewer.jsx';

function normalizeRenderMode(value) {
  return typeof value === 'string' && value.trim().toLowerCase() === 'static' ? 'static' : 'live2d';
}

const AvatarRenderer = forwardRef(function AvatarRenderer(
  {
    renderMode = 'live2d',
    modelPath = '',
    motions = [],
    expressions = [],
    width = 400,
    height = 600,
    onModelLoaded,
    onModelError,
    onAreaClicked,
    className,
    staticPack = null,
    staticBusinessState = 'idle',
    staticScale = 1,
    staticHitTest = null,
  },
  ref,
) {
  const innerRef = useRef(null);
  const normalizedRenderMode = normalizeRenderMode(renderMode);

  useImperativeHandle(ref, () => ({
    getManager: () => innerRef.current?.getManager?.() || null,
    initAudioContext: (...args) => innerRef.current?.initAudioContext?.(...args),
    playAudioWithLipSync: (...args) => innerRef.current?.playAudioWithLipSync?.(...args),
    stopAudioAndLipSync: (...args) => innerRef.current?.stopAudioAndLipSync?.(...args),
    ensureAudioContextReady: (...args) => innerRef.current?.ensureAudioContextReady?.(...args),
    speak: (...args) => innerRef.current?.speak?.(...args),
    stopSpeaking: (...args) => innerRef.current?.stopSpeaking?.(...args),
    getAudioContextReady: (...args) => innerRef.current?.getAudioContextReady?.(...args),
    getUserInteracted: (...args) => innerRef.current?.getUserInteracted?.(...args),
    getIsPlayingAudio: (...args) => innerRef.current?.getIsPlayingAudio?.(...args),
    testLipSyncAnimation: (...args) => innerRef.current?.testLipSyncAnimation?.(...args),
    testRandomMotion: (...args) => innerRef.current?.testRandomMotion?.(...args),
    playMotion: (...args) => innerRef.current?.playMotion?.(...args),
    setExpression: (...args) => innerRef.current?.setExpression?.(...args),
    setExpressionFromFile: (...args) => innerRef.current?.setExpressionFromFile?.(...args),
    setMotionFromFile: (...args) => innerRef.current?.setMotionFromFile?.(...args),
    setPointerNormalized: (...args) => innerRef.current?.setPointerNormalized?.(...args),
    syncCanvasSize: (...args) => innerRef.current?.syncCanvasSize?.(...args),
    isPointOnModel: (...args) => innerRef.current?.isPointOnModel?.(...args) || false,
  }), []);

  if (normalizedRenderMode === 'static') {
    return (
      <StaticAvatarViewer
        ref={innerRef}
        pack={staticPack}
        businessState={staticBusinessState}
        scale={staticScale}
        hitTest={staticHitTest}
        onModelLoaded={onModelLoaded}
        onModelError={onModelError}
        className={className}
      />
    );
  }

  return (
    <Live2DViewer
      ref={innerRef}
      modelPath={modelPath}
      motions={motions}
      expressions={expressions}
      width={width}
      height={height}
      onModelLoaded={onModelLoaded}
      onModelError={onModelError}
      onAreaClicked={onAreaClicked}
      className={className}
    />
  );
});

export default AvatarRenderer;
