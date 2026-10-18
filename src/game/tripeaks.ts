/**
 * Чистое ядро TriPeaks без Phaser: модель, генератор, правила.
 * Покрыто тестами (tripeaks.test.ts) — генератор обязан давать
 * гарантированно проходимые партии.
 */

export interface CardData {
  rank: number; // 0..12 (A..K)
  suit: number; // 0..3
}

export type Obstacle = 'ice' | 'lock';

export interface TableauCard extends CardData {
  removed: boolean;
  blockers: number[];
  obstacle?: Obstacle;
  /** Для льда: сколько раз карту надо сыграть, прежде чем она уйдёт. */
  iceHits?: number;
  /** Для замка: откроется после стольких снятых карт. */
  lockThreshold?: number;
}

export type SolutionAction =
  | { type: 'remove'; index: number }
  | { type: 'draw' };

export interface GeneratedGame {
  tableau: TableauCard[];
  /** Колода: брать через pop() (верх колоды — конец массива). */
  stock: CardData[];
  waste: CardData;
  /** Задуманное решение: тесты «проигрывают» его и обязаны выиграть. */
  solution: SolutionAction[];
}

/** Детерминированный RNG (mulberry32) — одинаковый seed = одинаковая партия. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Кто кого перекрывает: индексы 0-2 вершины, 3-8 ряд 1, 9-17 ряд 2, 18-27 низ. */
export function blockersFor(index: number): number[] {
  if (index <= 2) {
    const a = 3 + index * 2;
    return [a, a + 1];
  }
  if (index <= 8) {
    const j = index - 3;
    const base = 9 + Math.floor(j / 2) * 3;
    return j % 2 === 0 ? [base, base + 1] : [base + 1, base + 2];
  }
  if (index <= 17) {
    const k = index - 9;
    return [18 + k, 18 + k + 1];
  }
  return [];
}

export function isOpen(tableau: TableauCard[], index: number): boolean {
  return tableau[index].blockers.every((b) => tableau[b].removed);
}

/** Правило ±1 по кругу: после K (12) идёт A (0) и наоборот. */
export function rankMatches(cardRank: number, wasteRank: number): boolean {
  const d = Math.abs(cardRank - wasteRank);
  return d === 1 || d === 12;
}

export function removedCount(tableau: TableauCard[]): number {
  return tableau.filter((c) => c.removed).length;
}

export function isUnlocked(tableau: TableauCard[], index: number): boolean {
  const card = tableau[index];
  if (card.obstacle !== 'lock') return true;
  return removedCount(tableau) >= (card.lockThreshold ?? 0);
}

export function isPlayable(tableau: TableauCard[], index: number, waste: CardData): boolean {
  return (
    !tableau[index].removed &&
    isOpen(tableau, index) &&
    isUnlocked(tableau, index) &&
    rankMatches(tableau[index].rank, waste.rank)
  );
}

/** Препятствия по уровню внутри 30-уровневого цикла регионов. */
export function obstaclesForLevel(level: number): { ice: number; locks: number } {
  const inCycle = ((level - 1) % 30) + 1;
  if (inCycle <= 10) return { ice: 0, locks: 0 };
  if (inCycle <= 20) return { ice: Math.min(3 + Math.floor((inCycle - 11) / 3), 5), locks: 0 };
  return { ice: 4, locks: inCycle >= 25 ? 3 : 2 };
}

function shuffled<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Генератор гарантированно проходимой партии.
 *
 * Строится цепочка из 52 рангов, где каждый следующий — ±1 от предыдущего.
 * Шаг 0 — стартовый сброс; дальше по цепочке вперемешку назначаются снятия
 * раскладки (в геометрически допустимом порядке снизу вверх) и доборы из
 * колоды. Порядок действий запоминается в `solution`: следуя ему, игрок
 * всегда может выиграть — это проверяют тесты на 1000 сидах.
 */
export function generateGame(
  rng: () => number,
  obstacles: { ice: number; locks: number } = { ice: 0, locks: 0 },
): GeneratedGame {
  const chain: number[] = [Math.floor(rng() * 13)];
  for (let i = 1; i < 52; i++) {
    const step = rng() < 0.5 ? -1 : 1;
    chain.push((chain[i - 1] + step + 13) % 13);
  }
  const suits = shuffled(
    Array.from({ length: 52 }, (_, i) => i % 4),
    rng,
  );
  const make = (i: number): CardData => ({ rank: chain[i], suit: suits[i] });

  const removalOrder = [
    ...shuffled([18, 19, 20, 21, 22, 23, 24, 25, 26, 27], rng),
    ...shuffled([9, 10, 11, 12, 13, 14, 15, 16, 17], rng),
    ...shuffled([3, 4, 5, 6, 7, 8], rng),
    ...shuffled([0, 1, 2], rng),
  ];

  const waste = make(0);
  const tableau = new Array<TableauCard>(28);
  const stockDrawOrder: CardData[] = [];
  const solution: SolutionAction[] = [];
  let chainIdx = 1;
  let removalIdx = 0;

  for (let a = 0; a < 28 + 23; a++) {
    const allRemoved = removalIdx >= 28;
    const stockFull = stockDrawOrder.length >= 23;
    const doRemove = !allRemoved && (stockFull || rng() < 0.62);
    if (doRemove) {
      const index = removalOrder[removalIdx++];
      const card = make(chainIdx++);
      tableau[index] = { ...card, removed: false, blockers: blockersFor(index) };
      solution.push({ type: 'remove', index });
    } else {
      stockDrawOrder.push(make(chainIdx++));
      solution.push({ type: 'draw' });
    }
  }

  // Препятствия: лёд — на карты вне пиков, замки — только на вершины
  // (они снимаются последними, порог 15 снятий к тому моменту пройден).
  if (obstacles.ice > 0) {
    const candidates = shuffled(
      Array.from({ length: 19 }, (_, i) => 9 + i),
      rng,
    );
    for (const idx of candidates.slice(0, obstacles.ice)) {
      tableau[idx].obstacle = 'ice';
      tableau[idx].iceHits = 1;
    }
  }
  if (obstacles.locks > 0) {
    const peaks = shuffled([0, 1, 2], rng);
    for (const idx of peaks.slice(0, obstacles.locks)) {
      tableau[idx].obstacle = 'lock';
      tableau[idx].lockThreshold = 15;
    }
  }

  // pop() должен отдавать карты в порядке задуманных доборов.
  const stock = [...stockDrawOrder].reverse();
  return { tableau, stock, waste, solution };
}

/** Проиграть решение (для тестов и будущих подсказок). true = победа. */
export function replaySolution(game: GeneratedGame): boolean {
  const tableau = game.tableau.map((c) => ({ ...c }));
  const stock = [...game.stock];
  let waste = game.waste;
  for (const action of game.solution) {
    if (action.type === 'draw') {
      const card = stock.pop();
      if (!card) return false;
      waste = card;
    } else {
      const card = tableau[action.index];
      // Замок к моменту снятия вершин открыт по построению (порог 15 < 25).
      while (card.obstacle === 'ice' && (card.iceHits ?? 0) > 0) {
        if (!isPlayable(tableau, action.index, waste)) return false;
        card.iceHits = (card.iceHits ?? 0) - 1;
      }
      if (!isPlayable(tableau, action.index, waste)) return false;
      tableau[action.index].removed = true;
      waste = tableau[action.index];
    }
  }
  return tableau.every((c) => c.removed);
}

/** Звёзды за уровень по остатку колоды: щедрый запас = играл эффективно. */
export function starsForStockLeft(stockLeft: number): 1 | 2 | 3 {
  if (stockLeft >= 10) return 3;
  if (stockLeft >= 5) return 2;
  return 1;
}

export function coinsForWin(stockLeft: number, bestStreak: number): number {
  return 20 + stockLeft * 2 + bestStreak * 3;
}

/** Карты бустера «+5»: цепочка ±1 друг за другом, в порядке добора. */
export function makeBoosterCards(rng: () => number, count = 5): CardData[] {
  const cards: CardData[] = [];
  let rank = Math.floor(rng() * 13);
  for (let i = 0; i < count; i++) {
    cards.push({ rank, suit: Math.floor(rng() * 4) });
    rank = (rank + (rng() < 0.5 ? -1 : 1) + 13) % 13;
  }
  return cards;
}
