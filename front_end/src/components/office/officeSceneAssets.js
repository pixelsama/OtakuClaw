import officeBgAsset from '../../assets/office/star-office/office_bg.webp';
import deskAsset from '../../assets/office/star-office/desk-v3.webp';
import sofaAsset from '../../assets/office/star-office/sofa-idle-v3.png';
import sofaShadowAsset from '../../assets/office/star-office/sofa-shadow-v1.png';
import coffeeMachineAsset from '../../assets/office/star-office/coffee-machine-v3-grid.webp';
import plantsAsset from '../../assets/office/star-office/plants-spritesheet.webp';
import postersAsset from '../../assets/office/star-office/posters-spritesheet.webp';
import serverRoomAsset from '../../assets/office/star-office/serverroom-spritesheet.webp';
import flowersAsset from '../../assets/office/star-office/flowers-bloom-v2.webp';
import starIdleAsset from '../../assets/office/star-office/star-idle-v5.png';
import starWorkingAsset from '../../assets/office/star-office/star-working-spritesheet-grid.webp';
import errorBugAsset from '../../assets/office/star-office/error-bug-spritesheet-grid.webp';
import catsAsset from '../../assets/office/star-office/cats-spritesheet.webp';
import guestRole1Asset from '../../assets/office/star-office/guest_role_1.png';
import guestRole2Asset from '../../assets/office/star-office/guest_role_2.png';
import guestRole3Asset from '../../assets/office/star-office/guest_role_3.png';
import guestRole4Asset from '../../assets/office/star-office/guest_role_4.png';
import guestRole5Asset from '../../assets/office/star-office/guest_role_5.png';
import guestRole6Asset from '../../assets/office/star-office/guest_role_6.png';

export const OFFICE_SCENE_ASSET_REGISTRY = {
  starOfficeBackdrop: { key: 'starOfficeBackdrop', url: officeBgAsset, cols: 1, rows: 1 },
  desk: { key: 'desk', url: deskAsset, cols: 1, rows: 1 },
  coffeeMachine: { key: 'coffeeMachine', url: coffeeMachineAsset, cols: 12, rows: 8 },
  plants: { key: 'plants', url: plantsAsset, cols: 4, rows: 4 },
  posters: { key: 'posters', url: postersAsset, cols: 4, rows: 8 },
  serverRoom: { key: 'serverRoom', url: serverRoomAsset, cols: 40, rows: 1 },
  flowers: { key: 'flowers', url: flowersAsset, cols: 4, rows: 4 },
  sofaShadow: { key: 'sofaShadow', url: sofaShadowAsset, cols: 1, rows: 1 },
  sofa: { key: 'sofa', url: sofaAsset, cols: 1, rows: 1 },
  cats: { key: 'cats', url: catsAsset, cols: 4, rows: 4 },
  errorBug: { key: 'errorBug', url: errorBugAsset, cols: 10, rows: 11 },
  starIdle: { key: 'starIdle', url: starIdleAsset, cols: 8, rows: 6 },
  starWorking: { key: 'starWorking', url: starWorkingAsset, cols: 8, rows: 5 },
  guestRole1: { key: 'guestRole1', url: guestRole1Asset, cols: 2, rows: 1 },
  guestRole2: { key: 'guestRole2', url: guestRole2Asset, cols: 2, rows: 1 },
  guestRole3: { key: 'guestRole3', url: guestRole3Asset, cols: 2, rows: 1 },
  guestRole4: { key: 'guestRole4', url: guestRole4Asset, cols: 2, rows: 1 },
  guestRole5: { key: 'guestRole5', url: guestRole5Asset, cols: 2, rows: 1 },
  guestRole6: { key: 'guestRole6', url: guestRole6Asset, cols: 2, rows: 1 },
};

const GUEST_ROLE_KEYS = ['guestRole1', 'guestRole2', 'guestRole3', 'guestRole4', 'guestRole5', 'guestRole6'];

export function resolveOfficeSceneAsset(assetKey) {
  if (!assetKey || !OFFICE_SCENE_ASSET_REGISTRY[assetKey]) {
    return null;
  }

  return { ...OFFICE_SCENE_ASSET_REGISTRY[assetKey] };
}

function pickGuestRoleAssetKey(agentId) {
  const value = String(agentId || 'guest');
  const hash = [...value].reduce((accumulator, character) => accumulator + character.charCodeAt(0), 0);
  return GUEST_ROLE_KEYS[hash % GUEST_ROLE_KEYS.length];
}

export function resolveOfficeOccupantSprite(occupant) {
  if (occupant?.isPrimary) {
    switch (occupant.businessState) {
      case 'writing':
      case 'researching':
      case 'executing':
      case 'thinking':
      case 'streaming':
      case 'gaming':
        return {
          ...resolveOfficeSceneAsset('starWorking'),
          variant: 'working',
        };
      case 'error':
        return {
          ...resolveOfficeSceneAsset('errorBug'),
          variant: 'alert',
        };
      default:
        return {
          ...resolveOfficeSceneAsset('starIdle'),
          variant: 'idle',
        };
    }
  }

  return {
    ...resolveOfficeSceneAsset(pickGuestRoleAssetKey(occupant?.agentId)),
    variant: 'guest',
  };
}
