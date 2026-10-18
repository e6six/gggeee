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

/** Сгенерированные рубашки (docs/art/prompts.md), выбор — в настройках (⚙). */
const CARD_BACKS = [
  { key: 'back-bordeaux', file: 'assets/cards/back-bordeaux.png', name: 'Бордо' },
  { key: 'back-travel', file: 'assets/cards/back-travel.png', name: 'Солнце' },
  { key: 'back-sakura', file: 'assets/cards/back-sakura.png', name: 'Сакура' },
] as const;

interface CardView {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Rectangle;
  back: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  suit: Phaser.GameObjects.Text;
}

/**
 * TriPeaks с адаптивной вёрсткой: размеры карт и позиции считаются
 * от фактического размера холста (Scale.EXPAND), поле занимает всю
 * доступную площадь. HUD — верхняя панель, рубашки — в настройках.
 */
export class GameScene extends Phaser.Scene {
  private cards: TableauCard[] = [];
  private views: CardView[] = [];
  private stock: CardData[] = [];
  private waste!: CardData;
  private movesMade = false;
  private wasOpen: boolean[] = new Array(28).fill(false);

  private progress: Progress = { level: 1, totalStars: 0, coins: 0 };
  private score = 0;
  private streak = 0;
  private bestStreak = 0;
  private gameOver: 'win' | 'lose' | null = null;

  // Адаптивные размеры карт (пересчитываются в layout()).
  private cardW = 62;
  private cardH = 100;

  private backKey: string = CARD_BACKS[0].key;
  private stockBack!: Phaser.GameObjects.Image;
  private stockBg!: Phaser.GameObjects.Rectangle;
  private wasteBg!: Phaser.GameObjects.Rectangle;
  private boardTop = 218;
  private stockView!: Phaser.GameObjects.Container;
  private wasteView!: Phaser.GameObjects.Container;
  private stockLabel!: Phaser.GameObjects.Text;
  private wasteLabel!: Phaser.GameObjects.Text;
  private wasteSuit!: Phaser.GameObjects.Text;

  // HUD и оформление
  private deco!: Phaser.GameObjects.Graphics;
  private hudBg!: Phaser.GameObjects.Graphics;
  private titleText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private walletText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private restartButton!: Phaser.GameObjects.Text;
  private gearButton!: Phaser.GameObjects.Text;

  // Настройки
  private settingsPanel!: Phaser.GameObjects.Container;
  private settingsOverlay!: Phaser.GameObjects.Rectangle;
  private settingsBox!: Phaser.GameObjects.Rectangle;
  private settingsTitle!: Phaser.GameObjects.Text;
  private settingsBackLabel!: Phaser.GameObjects.Text;
  private backButtons: Phaser.GameObjects.Text[] = [];
  private backPreviews: Phaser.GameObjects.Image[] = [];
  private soundButton!: Phaser.GameObjects.Text;
  private resetButton!: Phaser.GameObjects.Text;
  private closeSettingsButton!: Phaser.GameObjects.Text;
  private soundOn = true;

  constructor() {
    super('GameScene');
  }

  preload(): void {
    for (const b of CARD_BACKS) this.load.image(b.key, b.file);
  }

  create(): void {
    this.backKey = localStorage.getItem('solitaire-journey.cardBack') ?? CARD_BACKS[0].key;
    if (!CARD_BACKS.some((b) => b.key === this.backKey)) this.backKey = CARD_BACKS[0].key;
    this.soundOn = localStorage.getItem('solitaire-journey.sound') !== 'off';

    this.deco = this.add.graphics();
    this.hudBg = this.add.graphics();
    this.buildHud();
    this.buildBoard();
    this.buildStockAndWaste();
    this.buildButtons();
    this.buildSettings();
    this.layout();
    this.scale.on('resize', () => this.layout());

    this.newGame();
    void loadSave<Progress>({ level: 1, totalStars: 0, coins: 0 }).then((saved) => {
      if (saved.level > 1 || saved.totalStars > 0 || saved.coins > 0) {
        this.progress = saved;
        this.newGame();
      }
    });
  }

  // --- HUD -------------------------------------------------------------------

  private buildHud(): void {
    this.titleText = this.add
      .text(0, 26, 'Пасьянс-путешествие', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '27px',
        color: '#f5e9c9',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);
    this.levelText = this.add
      .text(0, 62, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: '#10251c',
        backgroundColor: '#f0c94a',
        fontStyle: 'bold',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0, 0);
    this.walletText = this.add
      .text(0, 68, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: '#f5e9c9',
      })
      .setOrigin(0.5, 0);
    this.gearButton = this.add
      .text(0, 58, '⚙', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
        color: '#10251c',
        backgroundColor: '#8fae94',
        padding: { x: 12, y: 7 },
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(20);
    this.gearButton.on('pointerdown', () => this.toggleSettings(true));

    this.statusText = this.add
      .text(0, 112, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '17px',
        color: '#f0c94a',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);
    this.scoreText = this.add
      .text(0, 136, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '15px',
        color: '#b9d3a8',
      })
      .setOrigin(0.5, 0);
  }

  private updateMeta(): void {
    this.levelText.setText(`Уровень ${this.progress.level}`);
    this.walletText.setText(`⭐ ${this.progress.totalStars}    🪙 ${this.progress.coins}`);
    this.scoreText.setText(`Счёт: ${this.score} · Серия: ${this.streak} · Лучшая: ${this.bestStreak}`);
  }

  // --- Поле ------------------------------------------------------------------

  private boardPositions(): { x: number; y: number }[] {
    const W = this.scale.width;
    const H = this.scale.height;
    const pitchX = this.cardW + 7;
    const pitchY = this.cardH + 14;
    const left = W / 2 - 4.5 * pitchX;
    const top = this.boardTop;
    const rowX: number[][] = [
      [1.5, 4.5, 7.5],
      [1, 2, 4, 5, 7, 8],
      [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    ];
    const pos: { x: number; y: number }[] = [];
    for (let row = 0; row < 4; row++) {
      for (const k of rowX[row]) pos.push({ x: left + k * pitchX, y: top + row * pitchY });
    }
    return pos;
  }

  private buildBoard(): void {
    for (let i = 0; i < 28; i++) {
      const bg = this.add
        .rectangle(0, 0, this.cardW, this.cardH, 0xf7f1de)
        .setStrokeStyle(2, 0x2c4a38)
        .setOrigin(0.5);
      const label = this.add
        .text(0, 0, '', { fontFamily: 'Arial, sans-serif', fontStyle: 'bold', color: '#20301f' })
        .setOrigin(0, 0);
      const suit = this.add
        .text(0, 10, '', { fontFamily: 'Arial, sans-serif', color: '#20301f' })
        .setOrigin(0.5);
      const back = this.add.image(0, 0, this.backKey).setVisible(false);
      const container = this.add.container(0, 0, [bg, label, suit, back]);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => this.onCardTap(i));
      back.setInteractive({ useHandCursor: true });
      back.on('pointerdown', () => this.onCardTap(i));
      this.views.push({ container, bg, back, label, suit });
    }
  }

  private buildStockAndWaste(): void {
    this.stockBg = this.add.rectangle(0, 0, this.cardW, this.cardH, 0x8f2f2f).setStrokeStyle(2, 0xf5e9c9);
    const stockBg = this.stockBg;
    this.stockBack = this.add.image(0, 0, this.backKey);
    this.stockLabel = this.add
      .text(0, 0, '', { fontFamily: 'Arial, sans-serif', fontSize: '20px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0.5);
    const stockTitle = this.add
      .text(0, 0, 'Колода', { fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#b9d3a8' })
      .setOrigin(0.5)
      .setName('stockTitle');
    this.stockView = this.add.container(0, 0, [stockBg, this.stockBack, this.stockLabel, stockTitle]);
    this.stockBack.setInteractive({ useHandCursor: true });
    this.stockBack.on('pointerdown', () => this.onStockTap());
    stockBg.setInteractive({ useHandCursor: true });
    stockBg.on('pointerdown', () => this.onStockTap());

    this.wasteBg = this.add.rectangle(0, 0, this.cardW, this.cardH, 0xf7f1de).setStrokeStyle(3, 0xf0c94a);
    const wasteBg = this.wasteBg;
    this.wasteLabel = this.add
      .text(0, 0, '', { fontFamily: 'Arial, sans-serif', fontStyle: 'bold', color: '#20301f' })
      .setOrigin(0, 0);
    this.wasteSuit = this.add
      .text(0, 10, '', { fontFamily: 'Arial, sans-serif', color: '#20301f' })
      .setOrigin(0.5);
    const wasteTitle = this.add
      .text(0, 0, 'Сброс', { fontFamily: 'Arial, sans-serif', fontSize: '14px', color: '#b9d3a8' })
      .setOrigin(0.5)
      .setName('wasteTitle');
    this.wasteView = this.add.container(0, 0, [wasteBg, this.wasteLabel, this.wasteSuit, wasteTitle]);

    this.hintText = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#b9d3a8',
        align: 'center',
        wordWrap: { width: 640 },
      })
      .setOrigin(0.5, 0);
  }

  private buildButtons(): void {
    this.restartButton = this.add
      .text(0, 0, '↻ Новая игра', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#10251c',
        backgroundColor: '#f0c94a',
        fontStyle: 'bold',
        padding: { x: 22, y: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.restartButton.on('pointerdown', () => this.onRestart());
  }

  // --- Настройки ---------------------------------------------------------------

  private buildSettings(): void {
    this.settingsOverlay = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.65).setOrigin(0);
    this.settingsBox = this.add.rectangle(0, 0, 10, 10, 0x16382a).setStrokeStyle(2, 0xf0c94a);
    this.settingsTitle = this.add
      .text(0, 0, 'Настройки', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '26px',
        color: '#f5e9c9',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.settingsBackLabel = this.add
      .text(0, 0, 'Рубашка карт', { fontFamily: 'Arial, sans-serif', fontSize: '18px', color: '#b9d3a8' })
      .setOrigin(0.5);

    const children: Phaser.GameObjects.GameObject[] = [
      this.settingsOverlay,
      this.settingsBox,
      this.settingsTitle,
      this.settingsBackLabel,
    ];

    CARD_BACKS.forEach((b, idx) => {
      const preview = this.add.image(0, 0, b.key);
      preview.setInteractive({ useHandCursor: true });
      preview.on('pointerdown', () => this.chooseBack(idx));
      const btn = this.add
        .text(0, 0, b.name, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '17px',
          color: '#10251c',
          backgroundColor: '#8fae94',
          padding: { x: 14, y: 8 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => this.chooseBack(idx));
      this.backPreviews.push(preview);
      this.backButtons.push(btn);
      children.push(preview, btn);
    });

    this.soundButton = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '18px',
        color: '#10251c',
        backgroundColor: '#8fae94',
        padding: { x: 16, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.soundButton.on('pointerdown', () => {
      this.soundOn = !this.soundOn;
      localStorage.setItem('solitaire-journey.sound', this.soundOn ? 'on' : 'off');
      this.game.sound.mute = !this.soundOn;
      this.paintSettings();
    });

    this.resetButton = this.add
      .text(0, 0, 'Сбросить прогресс', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#f5e9c9',
        backgroundColor: '#8f2f2f',
        padding: { x: 16, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.resetButton.on('pointerdown', () => {
      this.progress = { level: 1, totalStars: 0, coins: 0 };
      void storeSave(this.progress);
      this.newGame();
      this.toggleSettings(false);
    });

    this.closeSettingsButton = this.add
      .text(0, 0, '✕ Закрыть', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '19px',
        color: '#10251c',
        backgroundColor: '#f0c94a',
        fontStyle: 'bold',
        padding: { x: 20, y: 11 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.closeSettingsButton.on('pointerdown', () => this.toggleSettings(false));

    children.push(this.restartButton, this.soundButton, this.resetButton, this.closeSettingsButton);
    this.settingsPanel = this.add.container(0, 0, children).setDepth(50).setVisible(false);
    this.paintSettings();
  }

  private chooseBack(idx: number): void {
    this.backKey = CARD_BACKS[idx].key;
    localStorage.setItem('solitaire-journey.cardBack', this.backKey);
    for (const v of this.views) this.applyBack(v.back);
    this.applyBack(this.stockBack);
    this.paintSettings();
    this.refresh();
  }

  private paintSettings(): void {
    this.backButtons.forEach((btn, idx) => {
      const active = CARD_BACKS[idx].key === this.backKey;
      btn.setBackgroundColor(active ? '#f0c94a' : '#8fae94');
      btn.setFontStyle(active ? 'bold' : 'normal');
    });
    this.backPreviews.forEach((img, idx) => {
      const active = CARD_BACKS[idx].key === this.backKey;
      img.setAlpha(active ? 1 : 0.55);
      img.setDisplaySize(active ? 74 : 62, active ? 108 : 92);
    });
    this.soundButton.setText(this.soundOn ? '🔊 Звук: включён' : '🔇 Звук: выключен');
  }

  private toggleSettings(open: boolean): void {
    if (open) this.layoutSettings();
    this.settingsPanel.setVisible(open);
  }

  private layoutSettings(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const boxW = Math.min(560, W - 48);
    const boxH = 640;
    const cx = W / 2;
    const cy = H / 2;
    this.settingsOverlay.setPosition(0, 0).setSize(W, H).setDisplaySize(W, H);
    this.settingsBox.setPosition(cx, cy).setSize(boxW, boxH).setDisplaySize(boxW, boxH);
    this.settingsTitle.setPosition(cx, cy - boxH / 2 + 44);
    this.settingsBackLabel.setPosition(cx, cy - boxH / 2 + 92);
    CARD_BACKS.forEach((_, idx) => {
      const x = cx + (idx - 1) * (boxW / 3);
      this.backPreviews[idx].setPosition(x, cy - boxH / 2 + 178);
      this.backButtons[idx].setPosition(x, cy - boxH / 2 + 252);
    });
    this.restartButton.setPosition(cx, cy + 18);
    this.soundButton.setPosition(cx, cy + 84);
    this.resetButton.setPosition(cx, cy + 148);
    this.closeSettingsButton.setPosition(cx, cy + boxH / 2 - 52);
    this.paintSettings();
  }

  /** Смена рубашки: setTexture + повторный setDisplaySize (фикс «взрыва» текстур). */
  private applyBack(img: Phaser.GameObjects.Image): void {
    if (img.texture.key !== this.backKey) img.setTexture(this.backKey);
    img.setDisplaySize(this.cardW, this.cardH);
  }

  // --- Адаптивная вёрстка ------------------------------------------------------

  private layout(): void {
    const W = this.scale.width;
    const H = this.scale.height;

    // Карты: по ширине поля, но не крупнее разумного и не мельче читаемого.
    this.cardW = Phaser.Math.Clamp(Math.floor((W - 36 - 9 * 7) / 10), 46, 92);
    this.cardH = Math.round(this.cardW * 1.55);
    const pitchY = this.cardH + 14;
    // Статус (y~114) и счёт (y~140) должны остаться над полем при любом размере карт.
    this.boardTop = 176 + this.cardH / 2;
    const boardTop = this.boardTop;
    const boardBottom = boardTop + 3 * pitchY + this.cardH / 2;

    // HUD-панель сверху
    this.hudBg.clear();
    this.hudBg.fillStyle(0x0b1d15, 0.92);
    this.hudBg.fillRect(0, 0, W, 104);
    this.hudBg.lineStyle(2, 0xf0c94a, 0.8);
    this.hudBg.lineBetween(0, 104, W, 104);
    this.titleText.setPosition(W / 2, 22);
    this.levelText.setPosition(16, 60);
    this.walletText.setPosition(W / 2, 66);
    this.gearButton.setPosition(W - 16, 56);
    this.statusText.setPosition(W / 2, 114);
    this.scoreText.setPosition(W / 2, 140);

    // Рамка стола вокруг поля
    this.deco.clear();
    this.deco.lineStyle(2, 0x2c4a38, 0.9);
    this.deco.strokeRoundedRect(10, boardTop - this.cardH / 2 - 14, W - 20, boardBottom - boardTop + this.cardH / 2 + 28, 18);
    this.deco.lineStyle(1, 0xf0c94a, 0.3);
    this.deco.strokeRoundedRect(18, boardTop - this.cardH / 2 - 6, W - 36, boardBottom - boardTop + this.cardH / 2 + 12, 14);

    // Карты поля
    const pos = this.boardPositions();
    for (let i = 0; i < 28; i++) {
      const v = this.views[i];
      v.container.setPosition(pos[i].x, pos[i].y);
      v.bg.setSize(this.cardW, this.cardH).setDisplaySize(this.cardW, this.cardH);
      v.label.setPosition(-this.cardW / 2 + 7, -this.cardH / 2 + 5);
      v.label.setFontSize(Math.round(this.cardW * 0.34));
      v.suit.setPosition(0, Math.round(this.cardH * 0.12));
      v.suit.setFontSize(Math.round(this.cardW * 0.5));
      this.applyBack(v.back);
    }

    // Колода и сброс: крупнее полевых, по центру под полем
    this.stockBg.setSize(this.cardW, this.cardH).setDisplaySize(this.cardW, this.cardH);
    this.wasteBg.setSize(this.cardW, this.cardH).setDisplaySize(this.cardW, this.cardH);
    this.stockLabel.setStroke('#10251c', 5);
    // Колода/сброс увеличены (scale 1.18): отступ считаем от визуальной
    // половины карты, иначе верх колоды залезает на нижний ряд поля.
    const stockHalf = (this.cardH * 1.18) / 2;
    const stockY = boardBottom + 42 + stockHalf;
    this.stockView.setPosition(W / 2 - 78, stockY).setScale(1.18);
    this.wasteView.setPosition(W / 2 + 78, stockY).setScale(1.18);
    const stockTitle = this.stockView.getByName('stockTitle') as Phaser.GameObjects.Text;
    stockTitle.setPosition(0, this.cardH / 2 + 20);
    const wasteTitle = this.wasteView.getByName('wasteTitle') as Phaser.GameObjects.Text;
    wasteTitle.setPosition(0, this.cardH / 2 + 20);
    this.wasteLabel.setPosition(-this.cardW / 2 + 7, -this.cardH / 2 + 5);
    this.wasteLabel.setFontSize(Math.round(this.cardW * 0.34));
    this.wasteSuit.setPosition(0, Math.round(this.cardH * 0.12));
    this.wasteSuit.setFontSize(Math.round(this.cardW * 0.5));
    this.applyBack(this.stockBack);

    this.hintText.setPosition(W / 2, stockY + stockHalf + 34).setWordWrapWidth(Math.min(680, W - 40));

    if (this.settingsPanel?.visible) this.layoutSettings();
    if (this.cards.length === 28) this.refresh();
  }

  // --- Игра --------------------------------------------------------------------

  private onRestart(): void {
    if (this.gameOver === 'win') this.progress.level += 1;
    this.toggleSettings(false);
    this.newGame();
  }

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

  private isOpen(i: number): boolean {
    return coreIsOpen(this.cards, i);
  }

  private isPlayable(i: number): boolean {
    return coreIsPlayable(this.cards, i, this.waste);
  }

  private onCardTap(i: number): void {
    if (this.gameOver) return;
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
    if (this.gameOver || this.stock.length === 0) return;
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
      void storeSave(this.progress);
      this.restartButton.setText('▶ Следующий уровень');
      this.setStatus(`🎉 Победа! ${'⭐'.repeat(stars)} +${coins} 🪙`);
      this.setHint(`Уровень ${this.progress.level} пройден. Лучшая серия: ${this.bestStreak}. Следующий уровень — в настройках ⚙.`);
      this.updateMeta();
      return;
    }
    const anyMove = this.cards.some((_, i) => this.isPlayable(i));
    if (!anyMove && this.stock.length === 0) {
      gameplayStop();
      this.gameOver = 'lose';
      this.restartButton.setText('↻ Ещё раз');
      this.setStatus('Колода пуста и ходов нет — в этот раз не вышло');
      this.setHint('«Ещё раз» — в настройках ⚙. Подсказка: не тратьте колоду, пока есть подсвеченные ходы.');
      return;
    }
    this.setHint(
      anyMove ? 'Есть ход: подсвеченные карты подходят к сбросу.' : 'Ходов нет — берите карту из колоды.',
    );
  }

  // --- Отрисовка состояния -------------------------------------------------------

  private suitColor(suit: number): string {
    return suit === 1 || suit === 2 ? '#b03030' : '#20301f';
  }

  private refresh(): void {
    for (let i = 0; i < 28; i++) {
      const card = this.cards[i];
      const view = this.views[i];
      if (!card || !view) continue;
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
      } else {
        this.applyBack(view.back);
        view.back.setVisible(true);
        view.label.setVisible(false);
        view.suit.setVisible(false);
      }
    }

    this.stockLabel.setText(this.stock.length > 0 ? String(this.stock.length) : '—');
    this.stockView.setAlpha(this.stock.length > 0 ? 1 : 0.45);
    this.wasteLabel.setText(RANKS[this.waste.rank]).setColor(this.suitColor(this.waste.suit));
    this.wasteSuit.setText(SUITS[this.waste.suit]).setColor(this.suitColor(this.waste.suit));

    const left = this.cards.filter((c) => !c.removed).length;
    if (left > 0 && !this.gameOver) this.setStatus(`Осталось снять: ${left} · в колоде: ${this.stock.length}`);
    this.updateMeta();
  }

  private setStatus(text: string): void {
    this.statusText.setText(text);
  }

  private setHint(text: string): void {
    this.hintText.setText(text);
  }
}
