/** Регионы путешествия: по 10 уровней, цикл из 3 регионов повторяется. */

export interface Region {
  name: string;
  backKey: string;
  bg: string;
  bgKey: string;
  bgFile: string;
}

export const REGIONS: Region[] = [
  { name: 'Средиземноморье', backKey: 'back-travel', bg: '#0f3527', bgKey: 'bg-mediterranean', bgFile: 'assets/bg/bg-mediterranean.jpg' },
  { name: 'Япония', backKey: 'back-sakura', bg: '#16283f', bgKey: 'bg-japan', bgFile: 'assets/bg/bg-japan.jpg' },
  { name: 'Старая Европа', backKey: 'back-bordeaux', bg: '#331d27', bgKey: 'bg-europe', bgFile: 'assets/bg/bg-europe.jpg' },
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
