import officeBgAsset from '../../assets/office/star-office/office_bg.webp';
import deskAsset from '../../assets/office/star-office/desk-v3.webp';
import sofaAsset from '../../assets/office/star-office/sofa-idle-v3.png';
import sofaShadowAsset from '../../assets/office/star-office/sofa-shadow-v1.png';
import coffeeMachineAsset from '../../assets/office/star-office/coffee-machine-v3-grid.webp';
import coffeeMachineShadowAsset from '../../assets/office/star-office/coffee-machine-shadow-v1.png';
import plantsAsset from '../../assets/office/star-office/plants-spritesheet.webp';
import postersAsset from '../../assets/office/star-office/posters-spritesheet.webp';
import serverRoomAsset from '../../assets/office/star-office/serverroom-spritesheet.webp';
import flowersAsset from '../../assets/office/star-office/flowers-bloom-v2.webp';
import syncAnimationAsset from '../../assets/office/star-office/sync-animation-v3-grid.webp';
import memoBoardAsset from '../../assets/office/star-office/memo-bg.webp';
import starIdleAsset from '../../assets/office/star-office/star-idle-v5.png';
import starWorkingAsset from '../../assets/office/star-office/star-working-spritesheet-grid.webp';
import errorBugAsset from '../../assets/office/star-office/error-bug-spritesheet-grid.webp';
import catsAsset from '../../assets/office/star-office/cats-spritesheet.webp';
import guestAnim1Asset from '../../assets/office/star-office/guest_anim_1.webp';
import guestAnim2Asset from '../../assets/office/star-office/guest_anim_2.webp';
import guestAnim3Asset from '../../assets/office/star-office/guest_anim_3.webp';
import guestAnim4Asset from '../../assets/office/star-office/guest_anim_4.webp';
import guestAnim5Asset from '../../assets/office/star-office/guest_anim_5.webp';
import guestAnim6Asset from '../../assets/office/star-office/guest_anim_6.webp';
import guestRole1Asset from '../../assets/office/star-office/guest_role_1.png';
import guestRole2Asset from '../../assets/office/star-office/guest_role_2.png';
import guestRole3Asset from '../../assets/office/star-office/guest_role_3.png';
import guestRole4Asset from '../../assets/office/star-office/guest_role_4.png';
import guestRole5Asset from '../../assets/office/star-office/guest_role_5.png';
import guestRole6Asset from '../../assets/office/star-office/guest_role_6.png';

export const OFFICE_SCENE_ASSET_REGISTRY = {
  starOfficeBackdrop: { key: 'starOfficeBackdrop', url: officeBgAsset, cols: 1, rows: 1 },
  desk: { key: 'desk', url: deskAsset, cols: 1, rows: 1 },
  coffeeMachineShadow: { key: 'coffeeMachineShadow', url: coffeeMachineShadowAsset, cols: 1, rows: 1 },
  coffeeMachine: { key: 'coffeeMachine', url: coffeeMachineAsset, cols: 12, rows: 8 },
  plants: { key: 'plants', url: plantsAsset, cols: 4, rows: 4 },
  posters: { key: 'posters', url: postersAsset, cols: 4, rows: 8 },
  serverRoom: { key: 'serverRoom', url: serverRoomAsset, cols: 40, rows: 1 },
  flowers: { key: 'flowers', url: flowersAsset, cols: 4, rows: 4 },
  syncAnimation: { key: 'syncAnimation', url: syncAnimationAsset, cols: 7, rows: 7 },
  memoBoard: { key: 'memoBoard', url: memoBoardAsset, cols: 1, rows: 1 },
  sofaShadow: { key: 'sofaShadow', url: sofaShadowAsset, cols: 1, rows: 1 },
  sofa: { key: 'sofa', url: sofaAsset, cols: 1, rows: 1 },
  cats: { key: 'cats', url: catsAsset, cols: 4, rows: 4 },
  errorBug: { key: 'errorBug', url: errorBugAsset, cols: 10, rows: 11 },
  starIdle: { key: 'starIdle', url: starIdleAsset, cols: 8, rows: 6 },
  starWorking: { key: 'starWorking', url: starWorkingAsset, cols: 8, rows: 5 },
  guestAnim1: { key: 'guestAnim1', url: guestAnim1Asset, cols: 4, rows: 2 },
  guestAnim2: { key: 'guestAnim2', url: guestAnim2Asset, cols: 4, rows: 2 },
  guestAnim3: { key: 'guestAnim3', url: guestAnim3Asset, cols: 4, rows: 2 },
  guestAnim4: { key: 'guestAnim4', url: guestAnim4Asset, cols: 4, rows: 2 },
  guestAnim5: { key: 'guestAnim5', url: guestAnim5Asset, cols: 4, rows: 2 },
  guestAnim6: { key: 'guestAnim6', url: guestAnim6Asset, cols: 4, rows: 2 },
  guestRole1: { key: 'guestRole1', url: guestRole1Asset, cols: 2, rows: 1 },
  guestRole2: { key: 'guestRole2', url: guestRole2Asset, cols: 2, rows: 1 },
  guestRole3: { key: 'guestRole3', url: guestRole3Asset, cols: 2, rows: 1 },
  guestRole4: { key: 'guestRole4', url: guestRole4Asset, cols: 2, rows: 1 },
  guestRole5: { key: 'guestRole5', url: guestRole5Asset, cols: 2, rows: 1 },
  guestRole6: { key: 'guestRole6', url: guestRole6Asset, cols: 2, rows: 1 },
};

const GUEST_ANIM_KEYS = ['guestAnim1', 'guestAnim2', 'guestAnim3', 'guestAnim4', 'guestAnim5', 'guestAnim6'];
const GUEST_ROLE_KEYS = ['guestRole1', 'guestRole2', 'guestRole3', 'guestRole4', 'guestRole5', 'guestRole6'];
const GUEST_ANIMATION = Object.freeze({
  fromFrame: 0,
  toFrame: 7,
  fps: 8,
});

function normalizeCharacterStateEntry(stateEntry = {}) {
  const source = stateEntry && typeof stateEntry === 'object' ? stateEntry : {};
  const assetKey = typeof source.assetKey === 'string' && source.assetKey.trim()
    ? source.assetKey.trim()
    : typeof source.key === 'string' && source.key.trim()
      ? source.key.trim()
      : '';
  if (!assetKey) {
    return null;
  }

  const normalizedState = {
    assetKey,
  };
  if (Number.isFinite(source.frameIndex)) {
    normalizedState.frameIndex = source.frameIndex;
  }
  if (source.animation && typeof source.animation === 'object' && !Array.isArray(source.animation)) {
    normalizedState.animation = { ...source.animation };
  }
  if (source.overrides && typeof source.overrides === 'object' && !Array.isArray(source.overrides)) {
    normalizedState.overrides = { ...source.overrides };
  }

  return normalizedState;
}

function normalizeCharacterProfile(profile = {}, fallbackCharacterId = '') {
  const source = profile && typeof profile === 'object' ? profile : {};
  const characterId = typeof source.characterId === 'string' && source.characterId.trim()
    ? source.characterId.trim()
    : typeof source.id === 'string' && source.id.trim()
      ? source.id.trim()
      : typeof fallbackCharacterId === 'string' && fallbackCharacterId.trim()
        ? fallbackCharacterId.trim()
        : '';
  if (!characterId) {
    return null;
  }

  const rawStates = source.states && typeof source.states === 'object' && !Array.isArray(source.states)
    ? source.states
    : source.stateSprites && typeof source.stateSprites === 'object' && !Array.isArray(source.stateSprites)
      ? source.stateSprites
      : {};

  return {
    characterId,
    label: typeof source.label === 'string' && source.label.trim()
      ? source.label.trim()
      : typeof source.name === 'string' && source.name.trim()
        ? source.name.trim()
        : characterId,
    states: Object.fromEntries(
      Object.entries(rawStates)
        .map(([state, entry]) => [
          typeof state === 'string' ? state.trim().toLowerCase() : '',
          normalizeCharacterStateEntry(entry),
        ])
        .filter(([state, entry]) => Boolean(state) && Boolean(entry)),
    ),
    anchors: source.anchors && typeof source.anchors === 'object' && !Array.isArray(source.anchors)
      ? { ...source.anchors }
      : {},
  };
}

function resolveProfileState(profile = null, businessState = '') {
  if (!profile || typeof profile !== 'object') {
    return {
      stateKey: 'idle',
      stateEntry: null,
    };
  }

  const normalizedBusinessState = typeof businessState === 'string' ? businessState.trim().toLowerCase() : '';
  const stateKey = normalizedBusinessState && profile.states[normalizedBusinessState]
    ? normalizedBusinessState
    : 'idle';
  return {
    stateKey,
    stateEntry: profile.states[stateKey] || profile.states.idle || null,
  };
}

export const BUILTIN_CHARACTER_PROFILES = Object.freeze({
  star: Object.freeze({
    characterId: 'star',
    label: 'Star',
    states: Object.freeze({
      idle: Object.freeze({ assetKey: 'starIdle' }),
      writing: Object.freeze({ assetKey: 'starWorking' }),
      researching: Object.freeze({ assetKey: 'starWorking' }),
      executing: Object.freeze({ assetKey: 'starWorking' }),
      thinking: Object.freeze({ assetKey: 'starWorking' }),
      streaming: Object.freeze({ assetKey: 'starWorking' }),
      gaming: Object.freeze({ assetKey: 'starWorking' }),
      error: Object.freeze({ assetKey: 'errorBug' }),
    }),
    anchors: Object.freeze({}),
  }),
});

function normalizeSceneAssetEntry(asset = {}, fallbackKey = '') {
  const source = asset && typeof asset === 'object' ? asset : {};
  const key = typeof source.key === 'string' && source.key.trim()
    ? source.key.trim()
    : typeof source.assetKey === 'string' && source.assetKey.trim()
      ? source.assetKey.trim()
      : typeof fallbackKey === 'string' && fallbackKey.trim()
        ? fallbackKey.trim()
        : '';
  if (!key) {
    return null;
  }

  const assetUrl = typeof source.assetUrl === 'string' && source.assetUrl.trim()
    ? source.assetUrl.trim()
    : typeof source.url === 'string' && source.url.trim()
      ? source.url.trim()
      : '';

  return {
    ...source,
    key,
    assetKey: key,
    assetUrl,
    url: assetUrl,
    asset: assetUrl,
    cols: Number.isFinite(source.cols) ? source.cols : 1,
    rows: Number.isFinite(source.rows) ? source.rows : 1,
  };
}

export function resolveOfficeSceneAsset(assetKey, assetRegistry = OFFICE_SCENE_ASSET_REGISTRY) {
  const registry = assetRegistry && typeof assetRegistry === 'object' ? assetRegistry : OFFICE_SCENE_ASSET_REGISTRY;
  if (!assetKey || !registry[assetKey]) {
    return null;
  }

  const asset = normalizeSceneAssetEntry(registry[assetKey], assetKey);
  if (!asset) {
    return null;
  }

  return {
    ...asset,
    assetUrl: asset.assetUrl || asset.url,
    asset: asset.asset || asset.assetUrl || asset.url,
  };
}

function pickHashedAssetKey(keys = [], agentId) {
  if (!Array.isArray(keys) || keys.length === 0) {
    return '';
  }

  const value = String(agentId || 'guest');
  const hash = [...value].reduce((accumulator, character) => accumulator + character.charCodeAt(0), 0);
  return keys[hash % keys.length];
}

function pickGuestAnimAssetKey(agentId) {
  return pickHashedAssetKey(GUEST_ANIM_KEYS, agentId);
}

function pickGuestRoleAssetKey(agentId) {
  return pickHashedAssetKey(GUEST_ROLE_KEYS, agentId);
}

function resolveGuestFallbackSprite(agentId, assetRegistry = OFFICE_SCENE_ASSET_REGISTRY) {
  return resolveOfficeSceneAsset(pickGuestRoleAssetKey(agentId), assetRegistry) || resolveOfficeSceneAsset('starIdle', assetRegistry);
}

function resolveCharacterSpriteFromProfile(occupant, profile, assetRegistry = OFFICE_SCENE_ASSET_REGISTRY) {
  const baseProfile = normalizeCharacterProfile(profile, occupant?.pixelRoom?.characterId || '');
  if (!baseProfile) {
    return null;
  }

  const overrideSource = occupant?.pixelRoom?.overrides && typeof occupant.pixelRoom.overrides === 'object'
    && !Array.isArray(occupant.pixelRoom.overrides)
    ? occupant.pixelRoom.overrides
    : {};
  const overrideStatesSource = overrideSource.states && typeof overrideSource.states === 'object' && !Array.isArray(overrideSource.states)
    ? overrideSource.states
    : overrideSource.stateSprites && typeof overrideSource.stateSprites === 'object' && !Array.isArray(overrideSource.stateSprites)
      ? overrideSource.stateSprites
      : {};
  const overrideStates = Object.fromEntries(
    Object.entries(overrideStatesSource)
      .map(([state, entry]) => [
        typeof state === 'string' ? state.trim().toLowerCase() : '',
        normalizeCharacterStateEntry(entry),
      ])
      .filter(([state, entry]) => Boolean(state) && Boolean(entry)),
  );
  const resolvedProfile = {
    ...baseProfile,
    ...(typeof overrideSource.label === 'string' && overrideSource.label.trim()
      ? { label: overrideSource.label.trim() }
      : {}),
    states: {
      ...baseProfile.states,
      ...overrideStates,
    },
    anchors: {
      ...baseProfile.anchors,
      ...(overrideSource.anchors && typeof overrideSource.anchors === 'object' && !Array.isArray(overrideSource.anchors)
        ? overrideSource.anchors
        : {}),
    },
  };
  const { stateKey, stateEntry } = resolveProfileState(resolvedProfile, occupant?.businessState);
  const asset = stateEntry?.assetKey ? resolveOfficeSceneAsset(stateEntry.assetKey, assetRegistry) : null;
  if (!asset) {
    return null;
  }

  return {
    ...asset,
    variant: 'character-profile',
    characterId: resolvedProfile.characterId,
    characterState: stateKey,
    characterLabel: resolvedProfile.label,
  };
}

function resolveOccupantCharacterSprite(occupant, assetRegistry = OFFICE_SCENE_ASSET_REGISTRY) {
  const characterId = typeof occupant?.pixelRoom?.characterId === 'string'
    ? occupant.pixelRoom.characterId.trim()
    : '';
  if (!characterId) {
    return null;
  }

  const activePackProfile = normalizeCharacterProfile(
    assetRegistry?.__pixelPackManifest?.characters?.[characterId],
    characterId,
  );
  const builtInProfile = normalizeCharacterProfile(BUILTIN_CHARACTER_PROFILES[characterId], characterId);
  const activePackSprite = resolveCharacterSpriteFromProfile(occupant, activePackProfile, assetRegistry);
  if (activePackSprite) {
    return activePackSprite;
  }

  return resolveCharacterSpriteFromProfile(occupant, builtInProfile, assetRegistry);
}

export function resolveOfficeOccupantSprite(occupant, assetRegistry = OFFICE_SCENE_ASSET_REGISTRY) {
  const characterSprite = resolveOccupantCharacterSprite(occupant, assetRegistry);
  if (characterSprite) {
    return characterSprite;
  }

  if (occupant?.isPrimary) {
    switch (occupant.businessState) {
      case 'writing':
      case 'researching':
      case 'executing':
      case 'thinking':
      case 'streaming':
      case 'gaming':
        return {
          ...resolveOfficeSceneAsset('starWorking', assetRegistry),
          variant: 'working',
        };
      case 'error':
        return {
          ...resolveOfficeSceneAsset('errorBug', assetRegistry),
          variant: 'alert',
        };
      default:
        return {
          ...resolveOfficeSceneAsset('starIdle', assetRegistry),
          variant: 'idle',
        };
    }
  }

  const guestAnimated = resolveOfficeSceneAsset(pickGuestAnimAssetKey(occupant?.agentId), assetRegistry);
  if (guestAnimated) {
    return {
      ...guestAnimated,
      variant: 'guest-animated',
      animation: GUEST_ANIMATION,
    };
  }

  return {
    ...resolveGuestFallbackSprite(occupant?.agentId, assetRegistry),
    variant: 'guest',
  };
}
