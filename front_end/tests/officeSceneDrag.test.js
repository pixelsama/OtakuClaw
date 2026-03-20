import { describe, expect, it } from 'vitest';
import { calculateDraggedFurniturePosition } from '../src/components/office/officeSceneDrag.js';

describe('calculateDraggedFurniturePosition', () => {
  it('converts pointer movement into bounded percentage coordinates', () => {
    expect(
      calculateDraggedFurniturePosition({
        stageRect: {
          left: 10,
          top: 20,
          width: 1000,
          height: 500,
        },
        layerRect: {
          width: 200,
          height: 100,
        },
        pointerClientX: 460,
        pointerClientY: 210,
        pointerOffsetX: 40,
        pointerOffsetY: 20,
      }),
    ).toEqual({
      left: 41,
      top: 34,
    });
  });

  it('clamps dragged furniture inside the stage bounds', () => {
    expect(
      calculateDraggedFurniturePosition({
        stageRect: {
          left: 100,
          top: 200,
          width: 800,
          height: 400,
        },
        layerRect: {
          width: 240,
          height: 120,
        },
        pointerClientX: 40,
        pointerClientY: 1000,
        pointerOffsetX: 30,
        pointerOffsetY: 15,
      }),
    ).toEqual({
      left: 0,
      top: 70,
    });
  });
});
