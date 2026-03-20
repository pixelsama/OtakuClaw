import { resolveOfficeOccupantSprite } from './officeSceneAssets.js';
import './OfficeScene.css';

function OfficeDecorLayer({ layer }) {
  return (
    <div
      className={`office-room__prop office-room__prop--${layer.id}`}
      style={{
        left: `${layer.left}%`,
        top: `${layer.top}%`,
        width: `${layer.width}%`,
        aspectRatio: layer.aspectRatio,
        zIndex: layer.zIndex,
        opacity: layer.opacity,
        backgroundImage: `url(${layer.assetUrl})`,
        '--office-cols': layer.cols,
        '--office-rows': layer.rows,
      }}
      aria-hidden="true"
    />
  );
}

function OfficeAreaLabel({ area, count }) {
  return (
    <div
      className="office-room__area-label"
      style={{ left: `${area.x}%`, top: `${area.y}%` }}
      aria-hidden="true"
    >
      <span>{area.label}</span>
      {count > 0 ? <strong>{count}</strong> : null}
    </div>
  );
}

function OfficeOccupant({ occupant }) {
  const sprite = resolveOfficeOccupantSprite(occupant);

  return (
    <div
      className={[
        'office-room__occupant',
        `palette-${occupant.palette}`,
        occupant.isPrimary ? 'is-primary' : '',
        `state-${occupant.businessState}`,
      ].filter(Boolean).join(' ')}
      style={{ left: `${occupant.slot.x}%`, top: `${occupant.slot.y}%` }}
      title={`${occupant.displayName}: ${occupant.businessState}`}
    >
      <div className="office-room__agent-shadow" aria-hidden="true" />
      <div
        className={[
          'office-room__agent-sprite',
          `office-room__agent-sprite--${sprite.variant}`,
          `mood-${occupant.mood}`,
        ].filter(Boolean).join(' ')}
        style={{
          backgroundImage: `url(${sprite.asset})`,
          '--office-cols': sprite.cols,
          '--office-rows': sprite.rows,
        }}
        aria-hidden="true"
      />
      <div className="office-room__agent-name">{occupant.displayName}</div>
      <div className="office-room__agent-state">{occupant.businessState}</div>
      {occupant.detail ? <div className="office-room__agent-bubble">{occupant.detail}</div> : null}
    </div>
  );
}

export default function OfficeScene({
  scene,
  compact = false,
  className = '',
  variant = 'dock',
}) {
  if (!scene) {
    return null;
  }

  const normalizedClassName = [
    'office-room',
    compact ? 'is-compact' : '',
    variant === 'page' ? 'office-room--page' : 'office-room--dock',
    className,
  ].filter(Boolean).join(' ');
  const { title, subtitle, caption, labels, config, occupants, areaSummaries, primaryAgent, agentCount } = scene;

  return (
    <section className={normalizedClassName} aria-label={title}>
      <div className="office-room__chrome">
        <div className="office-room__header">
          <div>
            <div className="office-room__eyebrow">{subtitle}</div>
            <h2 className="office-room__title">{title}</h2>
          </div>
          <div className="office-room__summary">
            <span>{labels.primaryAgent}: {primaryAgent?.displayName || 'OtakuClaw'}</span>
            <span>{agentCount} agent{agentCount === 1 ? '' : 's'}</span>
          </div>
        </div>

        <div className="office-room__stage-wrap">
          <div className="office-room__stage">
            <div
              className="office-room__scene-backdrop"
              style={{ backgroundImage: `url(${config.backdrop.assetUrl})` }}
              aria-hidden="true"
            />
            <div className="office-room__scene-vignette" aria-hidden="true" />
            {config.furniture.filter((layer) => layer.isVisible !== false).map((layer) => (
              <OfficeDecorLayer key={layer.id} layer={layer} />
            ))}
            {Object.values(config.areas).map((area) => {
              const areaSummary = areaSummaries.find((item) => item.id === area.id);
              return (
                <OfficeAreaLabel
                  key={area.id}
                  area={area}
                  count={areaSummary?.occupantCount || 0}
                />
              );
            })}
            {occupants.map((occupant) => (
              <OfficeOccupant key={occupant.agentId} occupant={occupant} />
            ))}
          </div>
          <div className="office-room__plaque">{primaryAgent?.detail || caption || labels.multiAgentReady}</div>
        </div>

        <div className="office-room__footer">
          <div className="office-room__legend">
            <span className="tone-idle">idle</span>
            <span className="tone-focus">writing</span>
            <span className="tone-think">researching</span>
            <span className="tone-exec">executing</span>
            <span className="tone-sync">syncing</span>
            <span className="tone-error">error</span>
          </div>
          <div className="office-room__caption">{caption || labels.multiAgentReady}</div>
        </div>
      </div>
    </section>
  );
}
