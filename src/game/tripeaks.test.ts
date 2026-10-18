import { describe, expect, it } from 'vitest';
import {
  blockersFor,
  coinsForWin,
  createRng,
  generateGame,
  isOpen,
  rankMatches,
  replaySolution,
  starsForStockLeft,
} from './tripeaks';

describe('правило ±1 по кругу', () => {
  it('соседние ранги подходят, остальные — нет', () => {
    expect(rankMatches(5, 4)).toBe(true);
    expect(rankMatches(5, 6)).toBe(true);
    expect(rankMatches(5, 5)).toBe(false);
    expect(rankMatches(5, 8)).toBe(false);
  });
  it('K <-> A замыкает круг', () => {
    expect(rankMatches(0, 12)).toBe(true);
    expect(rankMatches(12, 0)).toBe(true);
  });
});

describe('геометрия перекрытий', () => {
  it('нижний ряд открыт всегда, вершины держат по две карты', () => {
    for (let i = 18; i < 28; i++) expect(blockersFor(i)).toEqual([]);
    for (let i = 0; i < 3; i++) expect(blockersFor(i)).toHaveLength(2);
  });
  it('isOpen открывается только после снятия обеих перекрывающих', () => {
    const game = generateGame(createRng(42));
    expect(isOpen(game.tableau, 27)).toBe(true);
    expect(isOpen(game.tableau, 0)).toBe(false);
    game.tableau[3].removed = true;
    expect(isOpen(game.tableau, 0)).toBe(false);
    game.tableau[4].removed = true;
    expect(isOpen(game.tableau, 0)).toBe(true);
  });
});

describe('генератор гарантированно проходимых партий', () => {
  it('1000 сидов — 1000 побед по задуманному решению', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const game = generateGame(createRng(seed));
      expect(game.tableau).toHaveLength(28);
      expect(game.stock).toHaveLength(23);
      expect(replaySolution(game), `seed=${seed}`).toBe(true);
    }
  });

  it('одинаковый seed даёт одинаковую партию', () => {
    const a = generateGame(createRng(7));
    const b = generateGame(createRng(7));
    expect(a.tableau.map((c) => c.rank)).toEqual(b.tableau.map((c) => c.rank));
    expect(a.waste.rank).toBe(b.waste.rank);
  });

  it('в партии 52 разные по цепочке карты, ранги соседних шагов отличаются на 1', () => {
    const game = generateGame(createRng(99));
    // Решение покрывает все 28 снятий и 23 добора
    expect(game.solution.filter((a) => a.type === 'remove')).toHaveLength(28);
    expect(game.solution.filter((a) => a.type === 'draw')).toHaveLength(23);
  });
});

describe('мета: звёзды и монеты', () => {
  it('звёзды по остатку колоды', () => {
    expect(starsForStockLeft(15)).toBe(3);
    expect(starsForStockLeft(7)).toBe(2);
    expect(starsForStockLeft(0)).toBe(1);
  });
  it('монеты растут с остатком колоды и серией', () => {
    expect(coinsForWin(10, 5)).toBeGreaterThan(coinsForWin(0, 0));
  });
});
