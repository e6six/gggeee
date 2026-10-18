import Phaser from 'phaser';
import { gameplayStart, gameplayStop, loadSave, storeSave } from '../yandex/sdk';
import {
  coinsForWin,
  createRng,
  generateGame,
  isOpen as coreIsOpen,
  isPlayable as coreIsPlayable,
  starsForStockLeft,
  type CardData,
  type TableauCard,
} from '../game/tripeaks';

interface Progress {
  level: number;
  totalStars: number;
  coins: number;
}

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const CARD_W = 62;
const CARD_H = 100;

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
  private cards: TableauCard[] = [];
  private views: CardView[] = [];
  private stock: CardData[] = [];
  private waste!: CardData;
  private movesMade = false;
  private wasOpen: boolean[] = new Array(28).fill(false);

  // Мета (этап 3, первая версия): уровни, звёзды, монеты, счёт и серия.
  private progress: Progress = { level: 1, totalStars: 0, coins: 0 };
  private score = 0;
  private streak = 0;
  private bestStreak = 0;
  private gameOver: 'win' | 'lose' | null = null;
  private metaText!: Phaser.GameObjects.Text;
  private restartButton!: Phaser.GameObjects.Text;

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
    deco.strokeRoundedRect(14, 152, width - 28, 452, 18);
    deco.lineStyle(1, 0xf0c94a, 0.35);
    deco.strokeRoundedRect(22, 160, width - 44, 436, 14);
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

    this.metaText = this.add
      .text(width / 2, 138, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#f5e9c9',
      })
      .setOrigin(0.5);

    this.buildBoard();
    this.buildStockAndWaste();
    this.buildButtons();
    this.newGame();
    void loadSave<Progress>({ level: 1, totalStars: 0, coins: 0 }).then((saved) => {
      if (saved.level > 1 || saved.totalStars > 0 || saved.coins > 0) {
        this.progress = saved;
        this.newGame();
      }
    });
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
    this.restartButton = this.add
      .text(360, 975, '↻ Новая игра', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#10251c',
        backgroundColor: '#f0c94a',
        padding: { x: 20, y: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.restartButton.on('pointerdown', () => this.onRestart());
  }

  private onRestart(): void {
    if (this.gameOver === 'win') this.progress.level += 1;
    this.newGame();
  }

  // --- Генерация гарантированно проходимой партии --------------------------

  private newGame(): void {
    const seed = (Date.now() ^ (this.progress.level * 7919)) >>> 0;
    const game = generateGame(createRng(seed));
    this.cards = game.tableau;
    this.stock = game.stock;
    this.waste = game.waste;
    this.movesMade = false;
    this.wasOpen = new Array(28).fill(false);
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.gameOver = null;
    this.restartButton.setText('↻ Новая игра');
    this.refresh();
    this.updateMeta();
    this.setHint('Тапните по подсвеченной карте на ±1 от сброса.\nНет хода — тапните по колоде.');
  }

  private updateMeta(): void {
    this.metaText.setText(
      `Уровень ${this.progress.level}  ·  ⭐ ${this.progress.totalStars}  ·  🪙 ${this.progress.coins}  ·  Счёт: ${this.score}  ·  Серия: ${this.streak}`,
    );
  }

  private async saveProgress(): Promise<void> {
    await storeSave(this.progress);
  }

  // --- Игровые действия ------------------------------------------------------

  private isOpen(i: number): boolean {
    return coreIsOpen(this.cards, i);
  }

  private isPlayable(i: number): boolean {
    return coreIsPlayable(this.cards, i, this.waste);
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
    this.streak += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.score += 100 + (this.streak - 1) * 20;
    this.afterMove();
  }

  private onStockTap(): void {
    if (this.stock.length === 0) return;
    if (!this.movesMade) {
      this.movesMade = true;
      gameplayStart();
    }
    this.waste = this.stock.pop()!;
    this.streak = 0;
    this.afterMove();
  }

  private afterMove(): void {
    this.refresh();
    const left = this.cards.filter((c) => !c.removed).length;
    if (left === 0) {
      gameplayStop();
      this.gameOver = 'win';
      const stars = starsForStockLeft(this.stock.length);
      const coins = coinsForWin(this.stock.length, this.bestStreak);
      this.progress.totalStars += stars;
      this.progress.coins += coins;
      void this.saveProgress();
      this.restartButton.setText('▶ Следующий уровень');
      this.setStatus(`🎉 Победа! ${'⭐'.repeat(stars)} +${coins} 🪙`);
      this.setHint(`Уровень ${this.progress.level} пройден. Лучшая серия: ${this.bestStreak}. Дальше — кнопка ниже.`);
      this.updateMeta();
      return;
    }
    const anyMove = this.cards.some((_, i) => this.isPlayable(i));
    if (!anyMove && this.stock.length === 0) {
      gameplayStop();
      this.gameOver = 'lose';
      this.restartButton.setText('↻ Ещё раз');
      this.setStatus('Колода пуста и ходов нет — в этот раз не вышло');
      this.setHint('Нажмите «Ещё раз». Подсказка: не тратьте колоду, пока есть подсвеченные ходы.');
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
      if (open && !this.wasOpen[i] && this.movesMade) {
        view.container.setScale(0.15, 1);
        this.tweens.add({ targets: view.container, scaleX: 1, duration: 180, ease: 'Quad.easeOut' });
      }
      this.wasOpen[i] = open;
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
      // масштаб не трогаем: на контейнере может играть флип-анимация открытия
    }

    this.stockLabel.setText(this.stock.length > 0 ? String(this.stock.length) : '—');
    this.stockView.setAlpha(this.stock.length > 0 ? 1 : 0.45);
    this.wasteLabel.setText(RANKS[this.waste.rank]).setColor(this.suitColor(this.waste.suit));
    this.wasteSuit.setText(SUITS[this.waste.suit]).setColor(this.suitColor(this.waste.suit));

    const left = this.cards.filter((c) => !c.removed).length;
    if (left > 0) this.setStatus(`Осталось снять: ${left} · в колоде: ${this.stock.length}`);
    if (this.metaText) this.updateMeta();
  }

  private setStatus(text: string): void {
    this.statusText.setText(text);
  }

  private setHint(text: string): void {
    this.hintText.setText(text);
  }
}
