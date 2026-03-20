import './OfficeScene.css';

function OfficeFurniture({ item }) {
  return (
    <div
      className={`office-room__furniture office-room__furniture--${item.kind}`.trim()}
      style={{
        left: `${item.x}%`,
        top: `${item.y}%`,
        width: `${item.w}%`,
        height: `${item.h}%`,
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
  return (
    <div
      className={`office-room__occupant palette-${occupant.palette} ${occupant.isPrimary ? 'is-primary' : ''}`.trim()}
      style={{ left: `${occupant.slot.x}%`, top: `${occupant.slot.y}%` }}
      title={`${occupant.displayName}: ${occupant.businessState}`}
    >
      <div className="office-room__agent-shadow" aria-hidden="true" />
      <div className={`office-room__agent-sprite mood-${occupant.mood}`.trim()} aria-hidden="true">
        <span className="office-room__agent-face" aria-hidden="true">• •</span>
      </div>
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
}) {
  if (!scene) {
    return null;
  }

  const normalizedClassName = ['office-room', compact ? 'is-compact' : '', className].filter(Boolean).join(' ');
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

        <div className="office-room__stage">
          <div className="office-room__backdrop" aria-hidden="true" />
          <div className="office-room__grid" aria-hidden="true" />
          <div className="office-room__floor" aria-hidden="true" />
          {config.furniture.map((item) => (
            <OfficeFurniture key={item.id} item={item} />
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

        <div className="office-room__footer">
          <div className="office-room__legend">
            <span className="tone-idle">idle</span>
            <span className="tone-focus">writing</span>
            <span className="tone-sync">syncing</span>
            <span className="tone-error">error</span>
          </div>
          <div className="office-room__caption">
            {caption || labels.multiAgentReady}
          </div>
        </div>
      </div>
    </section>
  );
}
