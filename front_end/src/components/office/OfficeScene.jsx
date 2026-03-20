import officeBgAsset from '../../assets/office/star-office/office_bg.webp';
import deskAsset from '../../assets/office/star-office/desk-v3.webp';
import sofaAsset from '../../assets/office/star-office/sofa-idle-v3.png';
import sofaShadowAsset from '../../assets/office/star-office/sofa-shadow-v1.png';
import coffeeMachineAsset from '../../assets/office/star-office/coffee-machine-v3-grid.webp';
import starIdleAsset from '../../assets/office/star-office/star-idle-v5.png';
import starWorkingAsset from '../../assets/office/star-office/star-working-spritesheet-grid.webp';
import errorBugAsset from '../../assets/office/star-office/error-bug-spritesheet-grid.webp';
import guestRole1Asset from '../../assets/office/star-office/guest_role_1.png';
import guestRole2Asset from '../../assets/office/star-office/guest_role_2.png';
import guestRole3Asset from '../../assets/office/star-office/guest_role_3.png';
import guestRole4Asset from '../../assets/office/star-office/guest_role_4.png';
import guestRole5Asset from '../../assets/office/star-office/guest_role_5.png';
import guestRole6Asset from '../../assets/office/star-office/guest_role_6.png';
import './OfficeScene.css';

const GUEST_ROLE_ASSETS = [
  guestRole1Asset,
  guestRole2Asset,
  guestRole3Asset,
  guestRole4Asset,
  guestRole5Asset,
  guestRole6Asset,
];

const DECORATIVE_LAYERS = [
  {
    id: 'desk',
    asset: deskAsset,
    left: 6.3,
    top: 43.1,
    width: 21.6,
    cols: 1,
    rows: 1,
  },
  {
    id: 'coffee',
    asset: coffeeMachineAsset,
    left: 40.7,
    top: 42.3,
    width: 21.6,
    cols: 10,
    rows: 10,
  },
  {
    id: 'sofa-shadow',
    asset: sofaShadowAsset,
    left: 52.3,
    top: 20,
    width: 20,
    cols: 1,
    rows: 1,
  },
  {
    id: 'sofa',
    asset: sofaAsset,
    left: 52.3,
    top: 20,
    width: 20,
    cols: 1,
    rows: 1,
  },
  {
    id: 'bug',
    asset: errorBugAsset,
    left: 71.8,
    top: 18.2,
    width: 13.75,
    cols: 10,
    rows: 11,
  },
];

function pickGuestAsset(agentId) {
  const value = String(agentId || 'guest');
  const hash = [...value].reduce((accumulator, character) => accumulator + character.charCodeAt(0), 0);
  return GUEST_ROLE_ASSETS[hash % GUEST_ROLE_ASSETS.length];
}

function getPrimarySprite(occupant) {
  switch (occupant.businessState) {
    case 'writing':
    case 'researching':
    case 'executing':
    case 'thinking':
    case 'streaming':
    case 'gaming':
      return {
        asset: starWorkingAsset,
        cols: 8,
        rows: 5,
        variant: 'working',
      };
    case 'error':
      return {
        asset: errorBugAsset,
        cols: 10,
        rows: 11,
        variant: 'alert',
      };
    default:
      return {
        asset: starIdleAsset,
        cols: 8,
        rows: 6,
        variant: 'idle',
      };
  }
}

function getOccupantSprite(occupant) {
  if (occupant.isPrimary) {
    return getPrimarySprite(occupant);
  }

  return {
    asset: pickGuestAsset(occupant.agentId),
    cols: 2,
    rows: 1,
    variant: 'guest',
  };
}

function OfficeDecorLayer({ layer }) {
  return (
    <div
      className={`office-room__prop office-room__prop--${layer.id}`}
      style={{
        left: `${layer.left}%`,
        top: `${layer.top}%`,
        width: `${layer.width}%`,
        backgroundImage: `url(${layer.asset})`,
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
  const sprite = getOccupantSprite(occupant);

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
              style={{ backgroundImage: `url(${officeBgAsset})` }}
              aria-hidden="true"
            />
            <div className="office-room__scene-vignette" aria-hidden="true" />
            {DECORATIVE_LAYERS.map((layer) => (
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
