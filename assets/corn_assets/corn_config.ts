export const CORN_ATLAS_IMAGE = 'corn_atlas.png' as const;
export const CORN_ATLAS_DATA = 'corn_atlas.json' as const;

export const CORN_FRAMES = {
  stages: [
    'corn_stage_01',
    'corn_stage_02',
    'corn_stage_03',
    'corn_stage_04',
    'corn_stage_05',
  ],

  leaves: {
    healthy: [
      'corn_leaf_healthy_01',
      'corn_leaf_healthy_02',
      'corn_leaf_healthy_03',
    ],
    yellow: [
      'corn_leaf_yellow_01',
      'corn_leaf_yellow_02',
      'corn_leaf_yellow_03',
    ],
    dry: [
      'corn_leaf_dry_01',
      'corn_leaf_dry_02',
      'corn_leaf_dry_03',
    ],
    curled: [
      'corn_leaf_curled_01',
      'corn_leaf_curled_02',
    ],
  },

  stems: {
    stripped: [
      'corn_stem_stripped_01',
      'corn_stem_stripped_02',
    ],
    withered: [
      'corn_stem_withered_01',
      'corn_stem_withered_02',
    ],
  },
} as const;

export type CornStageFrame = typeof CORN_FRAMES.stages[number];

export type CornLeafFrame =
  | typeof CORN_FRAMES.leaves.healthy[number]
  | typeof CORN_FRAMES.leaves.yellow[number]
  | typeof CORN_FRAMES.leaves.dry[number]
  | typeof CORN_FRAMES.leaves.curled[number];

export type CornStemFrame =
  | typeof CORN_FRAMES.stems.stripped[number]
  | typeof CORN_FRAMES.stems.withered[number];

export type CornFrame =
  | CornStageFrame
  | CornLeafFrame
  | CornStemFrame;

export type CornAttachmentSide =
  | 'left'
  | 'right'
  | 'center';

export interface CornAttachmentPoint {
  /**
   * Normalized coordinates inside the selected frame.
   * Convert to pixels with x * sprite.width and y * sprite.height.
   */
  readonly x: number;
  readonly y: number;

  /** Initial rotation in radians. */
  readonly rotation: number;

  readonly side: CornAttachmentSide;
}

export interface CornStageVisualConfig {
  readonly frame: CornStageFrame;
  readonly root: Readonly<{
    x: number;
    y: number;
  }>;
  readonly leaves: readonly CornAttachmentPoint[];
  readonly fruits: readonly CornAttachmentPoint[];
  readonly flowers: readonly CornAttachmentPoint[];
}

/**
 * Initial normalized mounting points for the supplied corn artwork.
 * Fine-tune these values after the final in-game display scale is fixed.
 */
export const CORN_STAGE_CONFIG: readonly CornStageVisualConfig[] = [
  {
    frame: 'corn_stage_01',
    root: { x: 0.50, y: 0.98 },
    leaves: [
      { x: 0.45, y: 0.64, rotation: -0.52, side: 'left' },
      { x: 0.55, y: 0.62, rotation: 0.48, side: 'right' },
    ],
    fruits: [],
    flowers: [],
  },

  {
    frame: 'corn_stage_02',
    root: { x: 0.50, y: 0.98 },
    leaves: [
      { x: 0.48, y: 0.80, rotation: -0.58, side: 'left' },
      { x: 0.53, y: 0.69, rotation: 0.52, side: 'right' },
      { x: 0.46, y: 0.57, rotation: -0.48, side: 'left' },
      { x: 0.54, y: 0.43, rotation: 0.42, side: 'right' },
      { x: 0.50, y: 0.25, rotation: -0.05, side: 'center' },
    ],
    fruits: [],
    flowers: [],
  },

  {
    frame: 'corn_stage_03',
    root: { x: 0.50, y: 0.98 },
    leaves: [
      { x: 0.47, y: 0.84, rotation: -0.62, side: 'left' },
      { x: 0.54, y: 0.76, rotation: 0.56, side: 'right' },
      { x: 0.46, y: 0.66, rotation: -0.55, side: 'left' },
      { x: 0.55, y: 0.56, rotation: 0.49, side: 'right' },
      { x: 0.46, y: 0.45, rotation: -0.47, side: 'left' },
      { x: 0.54, y: 0.34, rotation: 0.40, side: 'right' },
      { x: 0.50, y: 0.20, rotation: -0.03, side: 'center' },
    ],
    fruits: [],
    flowers: [],
  },

  {
    frame: 'corn_stage_04',
    root: { x: 0.50, y: 0.98 },
    leaves: [
      { x: 0.47, y: 0.84, rotation: -0.63, side: 'left' },
      { x: 0.54, y: 0.75, rotation: 0.58, side: 'right' },
      { x: 0.46, y: 0.65, rotation: -0.57, side: 'left' },
      { x: 0.55, y: 0.54, rotation: 0.51, side: 'right' },
      { x: 0.46, y: 0.43, rotation: -0.49, side: 'left' },
      { x: 0.54, y: 0.31, rotation: 0.42, side: 'right' },
    ],
    fruits: [],
    flowers: [
      { x: 0.50, y: 0.05, rotation: 0.00, side: 'center' },
    ],
  },

  {
    frame: 'corn_stage_05',
    root: { x: 0.50, y: 0.98 },
    leaves: [
      { x: 0.47, y: 0.85, rotation: -0.64, side: 'left' },
      { x: 0.54, y: 0.77, rotation: 0.58, side: 'right' },
      { x: 0.46, y: 0.66, rotation: -0.56, side: 'left' },
      { x: 0.55, y: 0.56, rotation: 0.52, side: 'right' },
      { x: 0.46, y: 0.43, rotation: -0.48, side: 'left' },
      { x: 0.54, y: 0.31, rotation: 0.41, side: 'right' },
    ],
    fruits: [
      { x: 0.37, y: 0.49, rotation: -0.18, side: 'left' },
      { x: 0.66, y: 0.42, rotation: 0.16, side: 'right' },
    ],
    flowers: [
      { x: 0.50, y: 0.05, rotation: 0.00, side: 'center' },
    ],
  },
] as const;

export interface CornAgingVariant {
  readonly healthyLeafChance: number;
  readonly yellowLeafChance: number;
  readonly dryLeafChance: number;
  readonly curledLeafChance: number;
  readonly missingLeafChance: number;
}

/**
 * Suggested visual mix for an aging value from 0 to 1.
 * The values are probabilities, not hard stage boundaries.
 */
export function getCornAgingVariant(
  aging: number,
): CornAgingVariant {
  const value = Math.max(0, Math.min(1, aging));

  return {
    healthyLeafChance: Math.max(0, 1 - value * 1.25),
    yellowLeafChance: Math.min(0.65, value * 0.90),
    dryLeafChance: Math.max(0, (value - 0.35) * 1.15),
    curledLeafChance: Math.max(0, (value - 0.50) * 0.85),
    missingLeafChance: Math.max(0, (value - 0.62) * 0.70),
  };
}
