import Phaser from 'phaser';
import { gameplayStart, gameplayStop } from '../yandex/sdk';

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const CARD_W = 62;
const CARD_H = 100;

interface CardModel {
  rank: number; // 0..12
  suit: number; // 0..3
  removed: boolean;
  blockers: number[]; // индексы карт, которые должны уйти, чтобы эта открылась
}

interface CardView {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  back: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  suit: Phaser.GameObjects.Text;
}

/** Сгенерированные рубашки (docs/art/prompts.md), выбор — кнопками под полем. */
const CARD_BACKS = [
  { key: 'back-bordeaux', file: 'assets/cards/back-bordeaux.png', name: 'Бордо' },
  { key: 'back-travel', file: 'assets/cards/back-travel.png', name: 'Солнце' },
  { key: 'back-sakura', file: 'assets/cards/back-sakura.png', name: 'Сакура' },
] as const;

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

  private stockBack!: Phaser.GameObjects.Image;
  private backKey: string = CARD_BACKS[0].key;
  private backButtons: Phaser.GameObjects.Text[] = [];
  private stockView!: Phaser.GameObjects.Container;
  private stockLabel!: Phaser.GameObjects.Text;
  private wasteLabel!: Phaser.GameObjects.Text;
  private wasteSuit!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;

  constructor() {
    super('GameScene');
  }

  preload(): void {
    for (const b of CARD_BACKS) this.load.image(b.key, b.file);
  }

  create(): void {
    const { width } = this.scale;
    this.backKey = localStorage.getItem('solitaire-journey.cardBack') ?? CARD_BACKS[0].key;
    if (!CARD_BACKS.some((b) => b.key === this.backKey)) this.backKey = CARD_BACKS[0].key;

    // Декоративная рамка стола: поле не должно «висеть» в пустоте.
    const deco = this.add.graphics();
    deco.lineStyle(2, 0x2c4a38, 0.9);
    deco.strokeRoundedRect(14, 145, width - 28, 460, 18);
    deco.lineStyle(1, 0xf0c94a, 0.35);
    deco.strokeRoundedRect(22, 153, width - 44, 444, 14);
    deco.fillStyle(0xf0c94a, 0.08);
    deco.fillCircle(70, 200, 46);
    deco.fillCircle(width - 70, 200, 46);
    deco.fillCircle(70, 560, 46);
    deco.fillCircle(width - 70, 560, 46);

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

  /**
   * Раскладка БЕЗ перекрытий: карты 62×100, шаг 69px по горизонтали
   * (зазор 7px) и 122px по вертикали (зазор 22px). Верхняя карта стоит
   * ровно между двумя нижними — зависимость видна по геометрии пика,
   * а закрытость показывает рубашка, а не перекрытие.
   */
  private positions(): { x: number; y: number }[] {
    const pos: { x: number; y: number }[] = [];
    const rowsY = [205, 317, 429, 541];
    const centers: number[][] = [
      [145, 351, 558],
      [110, 179, 317, 386, 524, 593],
      [76, 145, 214, 283, 351, 420, 489, 558, 627],
      Array.from({ length: 10 }, (_, i) => 41 + i * 69),
    ];
    for (let row = 0; row < 4; row++) {
      for (const x of centers[row]) pos.push({ x, y: rowsY[row] });
    }
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
          fontSize: '22px',
          fontStyle: 'bold',
          color: '#20301f',
        })
        .setOrigin(0, 0);
      const suit = this.add
        .text(0, 8, '', { fontFamily: 'Arial, sans-serif', fontSize: '34px', color: '#20301f' })
        .setOrigin(0.5);
      const back = this.add
        .image(0, 0, this.backKey)
        .setDisplaySize(CARD_W, CARD_H)
        .setVisible(false);
      const container = this.add.container(pos[i].x, pos[i].y, [bg, label, suit, back]);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => this.onCardTap(i));
      back.setInteractive({ useHandCursor: true });
      back.on('pointerdown', () => this.onCardTap(i));
      this.views.push({ container, bg, back, label, suit });
    }
  }

  private buildStockAndWaste(): void {
    const y = 745;
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
    this.stockBack = this.add.image(0, 0, this.backKey).setDisplaySize(CARD_W, CARD_H);
    this.stockView = this.add.container(290, y, [stockBg, this.stockBack, this.stockLabel, stockTitle]).setScale(1.2);
    this.stockBack.setInteractive({ useHandCursor: true });
    this.stockBack.on('pointerdown', () => this.onStockTap());
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
      .text(0, 8, '', { fontFamily: 'Arial, sans-serif', fontSize: '34px', color: '#20301f' })
      .setOrigin(0.5);
    const wasteTitle = this.add
      .text(0, CARD_H / 2 + 18, 'Сброс', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: '#b9d3a8',
      })
      .setOrigin(0.5);
    this.add.container(410, y, [wasteBg, this.wasteLabel, this.wasteSuit, wasteTitle]).setScale(1.2);

    this.hintText = this.add
      .text(360, 885, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#b9d3a8',
        align: 'center',
        wordWrap: { width: 640 },
      })
      .setOrigin(0.5);
  }

  private buildBackSelector(): void {
    this.add
      .text(360, 1040, 'Рубашка карт:', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '15px',
        color: '#b9d3a8',
      })
      .setOrigin(0.5);
    CARD_BACKS.forEach((b, idx) => {
      const btn = this.add
        .text(165 + idx * 195, 1078, b.name, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '17px',
          color: '#10251c',
          backgroundColor: '#8fae94',
          padding: { x: 16, y: 9 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => {
        this.backKey = b.key;
        localStorage.setItem('solitaire-journey.cardBack', b.key);
        this.refresh();
        this.paintBackButtons();
      });
      this.backButtons.push(btn);
    });
    this.paintBackButtons();
  }

  /** Смена рубашки: setTexture + повторный setDisplaySize (фикс «взрыва» текстур). */
  private applyBack(img: Phaser.GameObjects.Image): void {
    if (img.texture.key !== this.backKey) img.setTexture(this.backKey);
    img.setDisplaySize(CARD_W, CARD_H);
  }

  private paintBackButtons(): void {
    this.backButtons.forEach((btn, idx) => {
      const active = CARD_BACKS[idx].key === this.backKey;
      btn.setBackgroundColor(active ? '#f0c94a' : '#8fae94');
      btn.setFontStyle(active ? 'bold' : 'normal');
    });
    for (const v of this.views) this.applyBack(v.back);
    if (this.stockBack) this.applyBack(this.stockBack);
  }

  private buildButtons(): void {
    this.buildBackSelector();
    const restart = this.add
      .text(360, 975, '↻ Новая игра', {
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
        view.back.setVisible(false);
        view.label.setVisible(true);
        view.suit.setVisible(true);
        view.bg.setFillStyle(0xf7f1de).setStrokeStyle(playable ? 4 : 2, playable ? 0xf0c94a : 0x2c4a38);
        view.label.setText(RANKS[card.rank]).setColor(this.suitColor(card.suit));
        view.suit.setText(SUITS[card.suit]).setColor(this.suitColor(card.suit));
        view.container.setAlpha(1);
      } else {
        this.applyBack(view.back);
        view.back.setVisible(true);
        view.label.setVisible(false);
        view.suit.setVisible(false);
        view.container.setAlpha(1);
      }
      view.container.setScale(1);
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
