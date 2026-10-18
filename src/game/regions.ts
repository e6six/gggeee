/** Регионы путешествия: по 10 уровней, цикл из 3 регионов повторяется. */

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
  { name: 'Средиземноморье', backKey: 'back-travel', bg: '#0f3527', bgKey: 'bg-mediterranean', bgFile: 'assets/bg/bg-mediterranean.jpg', artCrop: { x: 0, y: 740, w: 720, h: 340 } },
  { name: 'Япония', backKey: 'back-sakura', bg: '#16283f', bgKey: 'bg-japan', bgFile: 'assets/bg/bg-japan.jpg', artCrop: { x: 0, y: 0, w: 720, h: 390 } },
  { name: 'Старая Европа', backKey: 'back-bordeaux', bg: '#331d27', bgKey: 'bg-europe', bgFile: 'assets/bg/bg-europe.jpg', artCrop: { x: 0, y: 730, w: 720, h: 350 } },
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
