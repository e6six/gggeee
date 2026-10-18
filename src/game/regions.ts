/** Локации путешествия: по 10 уровней, круг из 4 локаций повторяется.
 * Названия и порядок — по островам на картинке карты (map-world.jpg):
 * пустыня с пирамидами → пагода → башня у водопада → зелёные горы. */

export interface Region {
  name: string;
  backKey: string;
  bg: string;
  bgKey: string;
  bgFile: string;
  /** Живописный фрагмент фона для «открытки победы» (у фонов пустой центр). */
  artCrop: { x: number; y: number; w: number; h: number };
}

export const REGIONS: Region[] = [
  {
    name: 'Пустыня с пирамидами',
    backKey: 'back-bordeaux',
    bg: '#3d2c17',
    bgKey: 'bg-desert',
    bgFile: 'assets/bg/bg-desert.jpg',
    artCrop: { x: 0, y: 730, w: 720, h: 350 },
  },
  {
    name: 'Пагода у осенней горы',
    backKey: 'back-sakura',
    bg: '#16283f',
    bgKey: 'bg-japan',
    bgFile: 'assets/bg/bg-japan.jpg',
    artCrop: { x: 0, y: 0, w: 720, h: 390 },
  },
  {
    name: 'Башня над водопадом',
    backKey: 'back-travel',
    bg: '#0f3527',
    bgKey: 'bg-mediterranean',
    bgFile: 'assets/bg/bg-mediterranean.jpg',
    artCrop: { x: 0, y: 740, w: 720, h: 340 },
  },
  {
    name: 'Зелёные горы и озеро',
    backKey: 'back-travel',
    bg: '#24401e',
    bgKey: 'bg-europe',
    bgFile: 'assets/bg/bg-europe.jpg',
    artCrop: { x: 0, y: 730, w: 720, h: 350 },
  },
];

export const LEVELS_PER_REGION = 10;

export function regionForLevel(level: number): {
  region: Region;
  regionIndex: number;
  cycle: number;
  indexInRegion: number;
} {
  const zero = Math.max(0, level - 1);
  const regionIndex = Math.floor((zero % (REGIONS.length * LEVELS_PER_REGION)) / LEVELS_PER_REGION);
  return {
    region: REGIONS[regionIndex],
    regionIndex,
    cycle: Math.floor(zero / (REGIONS.length * LEVELS_PER_REGION)) + 1,
    indexInRegion: (zero % LEVELS_PER_REGION) + 1,
  };
}
