import Phaser from 'phaser';
import { gameplayStart, gameplayStop } from '../yandex/sdk';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const CARD_W = 58;
const CARD_H = 80;

interface CardModel {
  rank: number; // 0..12
  suit: number; // 0..3
  removed: boolean;
  blockers: number[]; // индексы карт, которые должны уйти, чтобы эта открылась
}

interface CardView {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  suit: Phaser.GameObjects.Text;
}

/**
 * ИГРАБЕЛЬНЫЙ ПРОТОТИП TriPeaks (не финальное ядро этапа 1).
 *
 * Правила: снимайте открытую карту, если её ранг на ±1 отличается от карты
 * сброса (после K идёт A и наоборот). Нет хода — берите карту из колоды.
 * Победа: все 28 карт раскладки сняты. Поражение: колода пуста и ходов нет.
 *
 * Генератор гарантированной проходимости: строится цепочка из 52 карт,
 * где каждая следующая — ±1 к предыдущей. Первая карта — стартовый сброс,
 * дальше по цепочке вперемешку назначаются карты раскладки (в допустимом
 * порядке снятия снизу вверх) и карты колоды. Поэтому решение существует
 * по построению. Финальный генератор этапа 1 вынесет это в отдельный модуль
 * с юнит-тестами.
 */
export class GameScene extends Phaser.Scene {
  private cards: CardModel[] = [];
  private views: CardView[] = [];
  private stock: CardModel[] = [];
  private waste!: CardModel;
  private movesMade = false;

  private stockView!: Phaser.GameObjects.Container;
  private stockLabel!: Phaser.GameObjects.Text;
  private wasteLabel!: Phaser.GameObjects.Text;
  private wasteSuit!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;

  constructor() {
    super('GameScene');
  }

  create(): void {
    const { width } = this.scale;

    this.add
      .text(width / 2, 44, 'Пасьянс-путешествие', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '32px',
        color: '#f5e9c9',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 78, 'Прототип TriPeaks · снимайте карты на ±1 от сброса', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '15px',
        color: '#b9d3a8',
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(width / 2, 112, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '17px',
        color: '#f0c94a',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.buildBoard();
    this.buildStockAndWaste();
    this.buildButtons();
    this.newGame();
  }

  // --- Построение поля -----------------------------------------------------

  /** Координаты 28 карт: 3 пика (3+6+9) и нижний ряд из 10. */
  private positions(): { x: number; y: number }[] {
    const pos: { x: number; y: number }[] = [];
    const peaks = [168, 360, 552];
    for (const px of peaks) pos.push({ x: px, y: 205 }); // ряд 0: вершины
    for (const px of peaks) {
      pos.push({ x: px - 42, y: 272 }, { x: px + 42, y: 272 }); // ряд 1
    }
    for (const px of peaks) {
      pos.push({ x: px - 84, y: 339 }, { x: px, y: 339 }, { x: px + 84, y: 339 }); // ряд 2
    }
    for (let i = 0; i < 10; i++) pos.push({ x: 66 + i * 65, y: 412 }); // ряд 3
    return pos;
  }

  /** Кто кого перекрывает: карта открывается, когда ушли обе перекрывающие. */
  private blockersFor(index: number): number[] {
    // Индексы: 0-2 вершины, 3-8 ряд1, 9-17 ряд2, 18-27 нижний ряд.
    if (index <= 2) {
      const a = 3 + index * 2;
      return [a, a + 1];
    }
    if (index <= 8) {
      const j = index - 3; // 0..5
      const peak = Math.floor(j / 2);
      const base = 9 + peak * 3;
      return j % 2 === 0 ? [base, base + 1] : [base + 1, base + 2];
    }
    if (index <= 17) {
      const k = index - 9; // 0..8
      return [18 + k, 18 + k + 1];
    }
    return [];
  }

  private buildBoard(): void {
    const pos = this.positions();
    for (let i = 0; i < 28; i++) {
      const bg = this.add
        .rectangle(0, 0, CARD_W, CARD_H, 0xf7f1de)
        .setStrokeStyle(2, 0x2c4a38)
        .setOrigin(0.5);
      const label = this.add
        .text(-CARD_W / 2 + 7, -CARD_H / 2 + 4, '', {
          fontFamily: 'Arial, sans-serif',
          fontSize: '20px',
          fontStyle: 'bold',
          color: '#20301f',
        })
        .setOrigin(0, 0);
      const suit = this.add
        .text(0, 8, '', { fontFamily: 'Arial, sans-serif', fontSize: '30px', color: '#20301f' })
        .setOrigin(0.5);
      const container = this.add
        .container(pos[i].x, pos[i].y, [bg, label, suit])
        .setSize(CARD_W, CARD_H)
        .setInteractive({ useHandCursor: true });
      container.on('pointerdown', () => this.onCardTap(i));
      this.views.push({ container, bg, label, suit });
    }
  }

  private buildStockAndWaste(): void {
    const y = 610;
    // Колода (рубашка).
    const stockBg = this.add.rectangle(0, 0, CARD_W, CARD_H, 0x8f2f2f).setStrokeStyle(2, 0xf5e9c9);
    this.stockLabel = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#f5e9c9',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const stockTitle = this.add
      .text(0, CARD_H / 2 + 18, 'Колода', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: '#b9d3a8',
      })
      .setOrigin(0.5);
    this.stockView = this.add.container(230, y, [stockBg, this.stockLabel, stockTitle]);
    stockBg.setInteractive({ useHandCursor: true });
    stockBg.on('pointerdown', () => this.onStockTap());

    // Сброс.
    const wasteBg = this.add.rectangle(0, 0, CARD_W, CARD_H, 0xf7f1de).setStrokeStyle(2, 0xf0c94a);
    this.wasteLabel = this.add
      .text(-CARD_W / 2 + 7, -CARD_H / 2 + 4, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        fontStyle: 'bold',
        color: '#20301f',
      })
      .setOrigin(0, 0);
    this.wasteSuit = this.add
      .text(0, 8, '', { fontFamily: 'Arial, sans-serif', fontSize: '30px', color: '#20301f' })
      .setOrigin(0.5);
    const wasteTitle = this.add
      .text(0, CARD_H / 2 + 18, 'Сброс', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: '#b9d3a8',
      })
      .setOrigin(0.5);
    this.add.container(360, y, [wasteBg, this.wasteLabel, this.wasteSuit, wasteTitle]);

    this.hintText = this.add
      .text(360, 740, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#b9d3a8',
        align: 'center',
        wordWrap: { width: 640 },
      })
      .setOrigin(0.5);
  }

  private buildButtons(): void {
    const restart = this.add
      .text(360, 830, '↻ Новая игра', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#10251c',
        backgroundColor: '#f0c94a',
        padding: { x: 20, y: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    restart.on('pointerdown', () => this.newGame());
  }

  // --- Генерация гарантированно проходимой партии --------------------------

  private newGame(): void {
    // Цепочка рангов: каждый следующий ±1 (по кругу A<->K).
    const chain: number[] = [Phaser.Math.Between(0, 12)];
    for (let i = 1; i < 52; i++) {
      const step = Phaser.Math.RND.pick([-1, 1]);
      chain.push((chain[i - 1] + step + 13) % 13);
    }
    // Масти — просто перетасованная колода по кругу, на механику не влияют.
    const suits = Phaser.Utils.Array.Shuffle([...Array(52)].map((_, i) => i % 4));
    const make = (i: number): CardModel => ({
      rank: chain[i],
      suit: suits[i],
      removed: false,
      blockers: [],
    });

    // Порядок снятия раскладки, допустимый геометрией: снизу вверх.
    const removalOrder = [
      ...Phaser.Utils.Array.Shuffle([18, 19, 20, 21, 22, 23, 24, 25, 26, 27]),
      ...Phaser.Utils.Array.Shuffle([9, 10, 11, 12, 13, 14, 15, 16, 17]),
      ...Phaser.Utils.Array.Shuffle([3, 4, 5, 6, 7, 8]),
      ...Phaser.Utils.Array.Shuffle([0, 1, 2]),
    ];

    // Раскладываем цепочку: шаг 0 — стартовый сброс; дальше вперемешку
    // снятия раскладки и доборы из колоды по намеченному решению.
    this.waste = make(0);
    this.cards = new Array<CardModel>(28);
    this.stock = [];
    let chainIdx = 1;
    let removalIdx = 0;
    const totalActions = 28 + 23; // 28 снятий + 23 добора (1 карта ушла в стартовый сброс)
    for (let a = 0; a < totalActions; a++) {
      const mustRemove = removalIdx >= 28;
      const mustDraw = this.stock.length >= 23;
      const doRemove = !mustDraw && (mustRemove || Phaser.Math.RND.frac() < 0.62);
      if (doRemove) {
        const idx = removalOrder[removalIdx++];
        this.cards[idx] = make(chainIdx++);
      } else {
        this.stock.push(make(chainIdx++));
      }
    }
    // stock.pop() берёт с конца — а решение шло от начала; разворачиваем.
    this.stock.reverse();
    for (let i = 0; i < 28; i++) this.cards[i].blockers = this.blockersFor(i);

    this.movesMade = false;
    this.refresh();
    this.setStatus('');
    this.setHint('Тапните по подсвеченной карте на ±1 от сброса.\nНет хода — тапните по колоде.');
  }

  // --- Игровые действия ------------------------------------------------------

  private isOpen(i: number): boolean {
    return this.cards[i].blockers.every((b) => this.cards[b].removed);
  }

  private isPlayable(i: number): boolean {
    if (this.cards[i].removed || !this.isOpen(i)) return false;
    const d = Math.abs(this.cards[i].rank - this.waste.rank);
    return d === 1 || d === 12;
  }

  private onCardTap(i: number): void {
    if (!this.isPlayable(i)) {
      if (!this.cards[i].removed && !this.isOpen(i)) this.setHint('Эта карта закрыта: сначала снимите карты поверх неё.');
      else if (!this.cards[i].removed) this.setHint('Не подходит: нужна карта на 1 выше или ниже сброса (после K идёт A).');
      return;
    }
    if (!this.movesMade) {
      this.movesMade = true;
      gameplayStart();
    }
    this.cards[i].removed = true;
    this.waste = this.cards[i];
    this.afterMove();
  }

  private onStockTap(): void {
    if (this.stock.length === 0) return;
    if (!this.movesMade) {
      this.movesMade = true;
      gameplayStart();
    }
    this.waste = this.stock.pop()!;
    this.afterMove();
  }

  private afterMove(): void {
    this.refresh();
    const left = this.cards.filter((c) => !c.removed).length;
    if (left === 0) {
      gameplayStop();
      this.setStatus('🎉 Победа! Раскладка разобрана');
      this.setHint('Нажмите «Новая игра» — генератор соберёт следующую проходимую раскладку.');
      return;
    }
    const anyMove = this.cards.some((_, i) => this.isPlayable(i));
    if (!anyMove && this.stock.length === 0) {
      gameplayStop();
      this.setStatus('Колода пуста и ходов нет — в этот раз не вышло');
      this.setHint('Нажмите «Новая игра». Подсказка: не тратьте колоду, пока есть подсвеченные ходы.');
      return;
    }
    this.setHint(
      anyMove
        ? 'Есть ход: подсвеченные карты подходят к сбросу.'
        : 'Ходов нет — берите карту из колоды.',
    );
  }

  // --- Отрисовка -------------------------------------------------------------

  private suitColor(suit: number): string {
    return suit === 1 || suit === 2 ? '#b03030' : '#20301f';
  }

  private refresh(): void {
    for (let i = 0; i < 28; i++) {
      const card = this.cards[i];
      const view = this.views[i];
      view.container.setVisible(!card.removed);
      if (card.removed) continue;
      const open = this.isOpen(i);
      const playable = this.isPlayable(i);
      if (open) {
        view.bg.setFillStyle(0xf7f1de).setStrokeStyle(playable ? 4 : 2, playable ? 0xf0c94a : 0x2c4a38);
        view.label.setText(RANKS[card.rank]).setColor(this.suitColor(card.suit));
        view.suit.setText(SUITS[card.suit]).setColor(this.suitColor(card.suit));
        view.container.setAlpha(1);
      } else {
        view.bg.setFillStyle(0x8f2f2f).setStrokeStyle(2, 0xf5e9c9);
        view.label.setText('');
        view.suit.setText('✦').setColor('#f0c94a');
        view.container.setAlpha(0.96);
      }
      view.container.setScale(playable ? 1.06 : 1);
    }

    this.stockLabel.setText(this.stock.length > 0 ? String(this.stock.length) : '—');
    this.stockView.setAlpha(this.stock.length > 0 ? 1 : 0.45);
    this.wasteLabel.setText(RANKS[this.waste.rank]).setColor(this.suitColor(this.waste.suit));
    this.wasteSuit.setText(SUITS[this.waste.suit]).setColor(this.suitColor(this.waste.suit));

    const left = this.cards.filter((c) => !c.removed).length;
    if (left > 0) this.setStatus(`Осталось снять карт: ${left} · в колоде: ${this.stock.length}`);
  }

  private setStatus(text: string): void {
    this.statusText.setText(text);
  }

  private setHint(text: string): void {
    this.hintText.setText(text);
  }
}
