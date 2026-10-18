import Phaser from 'phaser';
import { gameplayStart, gameplayStop, loadSave, storeSave } from '../yandex/sdk';
import {
  coinsForWin,
  createRng,
  generateGame,
  makeBoosterCards,
  isOpen as coreIsOpen,
  isPlayable as coreIsPlayable,
  starsForStockLeft,
  type CardData,
  type TableauCard,
} from '../game/tripeaks';
import { REGIONS, regionForLevel } from '../game/regions';

interface Progress {
  level: number;
  totalStars: number;
  coins: number;
  boosters: { undo: number; plus5: number; wild: number };
}

const DEFAULT_PROGRESS: Progress = {
  level: 1,
  totalStars: 0,
  coins: 0,
  boosters: { undo: 3, plus5: 2, wild: 1 },
};

type BoosterKind = 'undo' | 'plus5' | 'wild';

interface MoveSnapshot {
  removedIndex: number | null;
  drawn: CardData | null;
  prevWaste: CardData;
  score: number;
  streak: number;
  bestStreak: number;
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

  private progress: Progress = structuredClone(DEFAULT_PROGRESS);
  /** Текущий играемый уровень (progress.level — граница открытого). */
  private currentLevel = 1;
  private history: MoveSnapshot[] = [];
  private wildActive = false;
  private boosterButtons = new Map<BoosterKind, Phaser.GameObjects.Text>();
  private score = 0;
  private streak = 0;
  private bestStreak = 0;
  private gameOver: 'win' | 'lose' | null = null;

  private bgImage!: Phaser.GameObjects.Image;

  // Экран победы «открытка региона»
  private winPanel!: Phaser.GameObjects.Container;
  private winOverlay!: Phaser.GameObjects.Rectangle;
  private winBox!: Phaser.GameObjects.Rectangle;
  private winArt!: Phaser.GameObjects.Image;
  private winTitle!: Phaser.GameObjects.Text;
  private winLevel!: Phaser.GameObjects.Text;
  private winStars: Phaser.GameObjects.Text[] = [];
  private winStats!: Phaser.GameObjects.Text;
  private winStamp!: Phaser.GameObjects.Text;
  private winNext!: Phaser.GameObjects.Text;
  private winReplay!: Phaser.GameObjects.Text;
  private winMap!: Phaser.GameObjects.Text;

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
  private fieldActionButton!: Phaser.GameObjects.Text;
  private boardCenterY = 500;
  private gearButton!: Phaser.GameObjects.Text;
  private mapButton!: Phaser.GameObjects.Text;
  private mapPanel!: Phaser.GameObjects.Container;
  private mapOverlay!: Phaser.GameObjects.Rectangle;
  private mapBox!: Phaser.GameObjects.Rectangle;
  private mapTitle!: Phaser.GameObjects.Text;
  private mapClose!: Phaser.GameObjects.Text;
  private mapContent!: Phaser.GameObjects.Container;
  private mapImage!: Phaser.GameObjects.Image;

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
    for (const r of REGIONS) this.load.image(r.bgKey, r.bgFile);
    this.load.image('map-world', 'assets/bg/map-world.jpg');
    this.load.image('postcard-win', 'assets/bg/postcard-win.jpg');
  }

  create(): void {
    this.backKey = localStorage.getItem('solitaire-journey.cardBack') ?? CARD_BACKS[0].key;
    if (!CARD_BACKS.some((b) => b.key === this.backKey)) this.backKey = CARD_BACKS[0].key;
    this.soundOn = localStorage.getItem('solitaire-journey.sound') !== 'off';

    this.bgImage = this.add.image(0, 0, REGIONS[0].bgKey).setDepth(-10);
    this.deco = this.add.graphics();
    this.hudBg = this.add.graphics();
    this.buildHud();
    this.buildBoard();
    this.buildStockAndWaste();
    this.buildButtons();
    this.buildFieldAction();
    this.buildBoosters();
    this.buildSettings();
    this.buildMap();
    this.buildWinScreen();
    this.layout();
    this.scale.on('resize', () => this.layout());

    this.newGame();
    void loadSave<Progress>(structuredClone(DEFAULT_PROGRESS)).then((saved) => {
      const merged: Progress = {
        ...structuredClone(DEFAULT_PROGRESS),
        ...saved,
        boosters: { ...DEFAULT_PROGRESS.boosters, ...(saved.boosters ?? {}) },
      };
      this.progress = merged;
      this.currentLevel = merged.level;
      if (merged.level > 1 || merged.totalStars > 0 || merged.coins > 0) this.newGame();
      else this.paintBoosters();
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
    this.mapButton = this.add
      .text(0, 58, '🗺 Карта', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '17px',
        color: '#10251c',
        backgroundColor: '#8fae94',
        fontStyle: 'bold',
        padding: { x: 12, y: 9 },
      })
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true })
      .setDepth(20);
    this.mapButton.on('pointerdown', () => this.toggleMap(true));

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
    const { region, indexInRegion } = regionForLevel(this.currentLevel);
    this.levelText.setText(`Ур. ${this.currentLevel} · ${region.name} ${indexInRegion}/10`);
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

  // --- Бустеры -----------------------------------------------------------------

  private buildFieldAction(): void {
    this.fieldActionButton = this.add
      .text(0, 0, '▶ Следующий уровень', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
        color: '#10251c',
        backgroundColor: '#f0c94a',
        fontStyle: 'bold',
        padding: { x: 30, y: 16 },
      })
      .setOrigin(0.5)
      .setDepth(30)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });
    this.fieldActionButton.on('pointerdown', () => {
      if (this.gameOver === 'win') {
        this.currentLevel += 1;
        this.newGame();
      }
    });
  }

  private buildBoosters(): void {
    const defs: { kind: BoosterKind; label: string }[] = [
      { kind: 'undo', label: '↩ Отмена' },
      { kind: 'plus5', label: '＋5 карт' },
      { kind: 'wild', label: '★ Дикая' },
    ];
    for (const d of defs) {
      const btn = this.add
        .text(0, 0, d.label, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '17px',
          color: '#10251c',
          backgroundColor: '#8fae94',
          padding: { x: 14, y: 10 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => this.useBooster(d.kind));
      this.boosterButtons.set(d.kind, btn);
    }
    this.paintBoosters();
  }

  private paintBoosters(): void {
    const labels: Record<BoosterKind, string> = {
      undo: `↩ Отмена · ${this.progress.boosters.undo}`,
      plus5: `＋5 карт · ${this.progress.boosters.plus5}`,
      wild: `★ Дикая · ${this.progress.boosters.wild}`,
    };
    for (const [kind, btn] of this.boosterButtons) {
      btn.setText(labels[kind]);
      const count = this.progress.boosters[kind];
      const armed = kind === 'wild' && this.wildActive;
      btn.setBackgroundColor(armed ? '#f0c94a' : count > 0 ? '#8fae94' : '#5d7263');
      btn.setAlpha(count > 0 || armed ? 1 : 0.75);
      btn.setFontStyle(armed ? 'bold' : 'normal');
    }
  }

  /** Списывает бустер или покупает за 40 монет. false — ни того, ни другого. */
  private takeBooster(kind: BoosterKind): boolean {
    if (this.progress.boosters[kind] > 0) {
      this.progress.boosters[kind] -= 1;
      return true;
    }
    if (this.progress.coins >= 40) {
      this.progress.coins -= 40;
      this.setHint('Бустер куплен за 40 🪙.');
      return true;
    }
    this.setHint('Бустеры кончились. Нужно 40 🪙 на покупку — монеты дают победы.');
    return false;
  }

  private useBooster(kind: BoosterKind): void {
    if (kind === 'undo') this.useUndo();
    else if (kind === 'plus5') this.usePlus5();
    else this.useWild();
  }

  private useUndo(): void {
    if (this.gameOver === 'win') {
      this.setHint('Партия уже выиграна — отмена недоступна.');
      return;
    }
    const snap = this.history[this.history.length - 1];
    if (!snap) {
      this.setHint('Отменять пока нечего: ходов ещё не было.');
      return;
    }
    if (!this.takeBooster('undo')) return;
    this.history.pop();
    if (snap.removedIndex !== null) this.cards[snap.removedIndex].removed = false;
    if (snap.drawn) this.stock.push(snap.drawn);
    this.waste = snap.prevWaste;
    this.score = snap.score;
    this.streak = snap.streak;
    this.bestStreak = snap.bestStreak;
    if (this.gameOver === 'lose') {
      this.gameOver = null;
      this.restartButton.setText('↻ Новая игра');
    }
    void storeSave(this.progress);
    this.paintBoosters();
    this.refresh();
    this.setHint('Ход отменён.');
  }

  private usePlus5(): void {
    if (this.gameOver) return;
    if (!this.takeBooster('plus5')) return;
    const cards = makeBoosterCards(createRng((Date.now() & 0xffffff) >>> 0), 5);
    this.stock.push(...[...cards].reverse());
    void storeSave(this.progress);
    this.paintBoosters();
    this.refresh();
    this.setHint('В колоду добавлено 5 карт цепочкой ±1.');
  }

  private useWild(): void {
    if (this.gameOver) return;
    if (this.wildActive) {
      this.wildActive = false;
      this.paintBoosters();
      this.refresh();
      this.setHint('Дикая карта отменена (бустер не потрачен).');
      return;
    }
    if (this.progress.boosters.wild <= 0 && this.progress.coins < 40) {
      this.setHint('Диких карт нет. Нужно 40 🪙 на покупку.');
      return;
    }
    this.wildActive = true;
    this.paintBoosters();
    this.refresh();
    this.setHint('Дикая карта активна: тапните ЛЮБУЮ открытую карту. Списание — при использовании.');
  }

  private pushHistory(snap: Omit<MoveSnapshot, 'prevWaste' | 'score' | 'streak' | 'bestStreak'>): void {
    this.history.push({
      ...snap,
      prevWaste: this.waste,
      score: this.score,
      streak: this.streak,
      bestStreak: this.bestStreak,
    });
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
      this.progress = structuredClone(DEFAULT_PROGRESS);
      this.currentLevel = 1;
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

  // --- Карта путешествия --------------------------------------------------------

  private buildMap(): void {
    this.mapOverlay = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.65).setOrigin(0);
    this.mapBox = this.add.rectangle(0, 0, 10, 10, 0x16382a).setStrokeStyle(2, 0xf0c94a);
    this.mapTitle = this.add
      .text(0, 0, '🗺 Путешествие', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '26px',
        color: '#f5e9c9',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.mapImage = this.add.image(0, 0, 'map-world');
    this.mapContent = this.add.container(0, 0, []);
    this.mapClose = this.add
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
    this.mapClose.on('pointerdown', () => this.toggleMap(false));
    this.mapPanel = this.add
      .container(0, 0, [this.mapOverlay, this.mapImage, this.mapBox, this.mapTitle, this.mapContent, this.mapClose])
      .setDepth(50)
      .setVisible(false);
  }

  private toggleMap(open: boolean): void {
    if (open) this.rebuildMap();
    this.mapPanel.setVisible(open);
  }

  /** Узлы маршрута: змейка 6×5 снизу вверх по карте (доли от рамки карты). */
  private routePoints(): { fx: number; fy: number }[] {
    const pts: { fx: number; fy: number }[] = [];
    for (let row = 0; row < 6; row++) {
      const fy = 0.88 - row * 0.148;
      const xs = [0.16, 0.33, 0.5, 0.67, 0.84];
      if (row % 2 === 1) xs.reverse();
      for (const fx of xs) pts.push({ fx, fy });
    }
    return pts;
  }

  private rebuildMap(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const boxW = Math.min(640, W - 24);
    const boxH = Math.min(760, H - 90);
    const cx = W / 2;
    const cy = H / 2;
    const top = cy - boxH / 2;
    const left = cx - boxW / 2;
    this.mapOverlay.setPosition(0, 0).setSize(W, H).setDisplaySize(W, H);
    this.mapBox.setPosition(cx, cy).setSize(boxW, boxH).setDisplaySize(boxW, boxH);
    this.mapBox.setFillStyle(0x000000, 0);
    this.mapImage.setPosition(cx, cy).setDisplaySize(boxW, boxH).setAlpha(1);
    this.mapTitle.setPosition(cx, top + 34);
    this.mapTitle.setBackgroundColor('#10251c').setPadding(14, 8, 14, 8);
    this.mapClose.setPosition(cx, top + boxH - 36);
    this.mapContent.removeAll(true);

    const pts = this.routePoints().map((pt) => ({
      x: left + pt.fx * boxW,
      y: top + pt.fy * boxH,
    }));
    const cycleBase = Math.floor((this.currentLevel - 1) / 30) * 30;

    // Линия пути: пройденное — золото, впереди — пунктир.
    const route = this.add.graphics();
    for (let i = 0; i < pts.length - 1; i++) {
      const segLevel = cycleBase + i + 1;
      const a = pts[i];
      const b = pts[i + 1];
      if (segLevel < this.progress.level) {
        route.lineStyle(6, 0xf0a500, 0.95);
        route.lineBetween(a.x, a.y, b.x, b.y);
      } else {
        const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
        const steps = Math.max(2, Math.floor(dist / 16));
        route.fillStyle(0xffffff, 0.85);
        for (let k = 1; k < steps; k++) {
          route.fillCircle(a.x + ((b.x - a.x) * k) / steps, a.y + ((b.y - a.y) * k) / steps, 3);
        }
      }
    }
    this.mapContent.add(route);

    // Подписи регионов у их первых узлов.
    REGIONS.forEach((region, r) => {
      const pt = pts[r * 10];
      const label = this.add
        .text(pt.x, pt.y - 40, region.name, {
          fontFamily: 'Arial, sans-serif',
          fontSize: '15px',
          color: '#f5e9c9',
          backgroundColor: '#10251c',
          fontStyle: 'bold',
          padding: { x: 10, y: 5 },
        })
        .setOrigin(0.5);
      this.mapContent.add(label);
    });

    // Узлы уровней и маркер игрока.
    pts.forEach((pt, i) => {
      const lvl = cycleBase + i + 1;
      const completed = lvl < this.progress.level;
      const frontier = lvl === this.progress.level;
      const playing = lvl === this.currentLevel;
      const radius = frontier ? 17 : 14;
      const circle = this.add
        .circle(0, 0, radius, completed ? 0xf0a500 : frontier ? 0x57a773 : 0x93a696)
        .setStrokeStyle(playing ? 4 : 2, playing ? 0xf0c94a : 0xffffff);
      const text = this.add
        .text(0, 0, completed ? '★' : String(lvl), {
          fontFamily: 'Arial, sans-serif',
          fontSize: completed ? '15px' : '13px',
          color: completed || frontier ? '#10251c' : '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      const node = this.add.container(pt.x, pt.y, [circle, text]);
      if (lvl <= this.progress.level) {
        circle.setInteractive({ useHandCursor: true });
        circle.on('pointerdown', () => {
          this.currentLevel = lvl;
          this.toggleMap(false);
          this.newGame();
        });
      } else {
        node.setAlpha(0.75);
      }
      this.mapContent.add(node);
      if (playing) {
        const pin = this.add.text(pt.x, pt.y - 34, '📍', { fontSize: '26px' }).setOrigin(0.5);
        this.mapContent.add(pin);
        this.tweens.add({ targets: pin, y: pt.y - 44, duration: 550, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      if (frontier && !playing) {
        this.tweens.add({ targets: node, scale: 1.18, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    });

    const legend = this.add
      .text(cx, top + boxH - 74, 'Золотая линия — ваш путь · 📍 — вы здесь · тап по узлу — играть', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: '#f5e9c9',
        backgroundColor: '#10251c',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5);
    this.mapContent.add(legend);
  }

  // --- Экран победы: открытка региона -------------------------------------------

  private buildWinScreen(): void {
    this.winOverlay = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.6).setOrigin(0);
    this.winBox = this.add.rectangle(0, 0, 10, 10, 0xf7f1de).setStrokeStyle(4, 0xd9b64a);
    this.winArt = this.add.image(0, 0, 'postcard-win');
    this.winTitle = this.add
      .text(0, 0, '🎉 Победа!', { fontFamily: 'Arial, sans-serif', fontSize: '32px', color: '#20301f', fontStyle: 'bold' })
      .setOrigin(0.5);
    this.winLevel = this.add
      .text(0, 0, '', { fontFamily: 'Arial, sans-serif', fontSize: '19px', color: '#5a4632' })
      .setOrigin(0.5);
    this.winStars = [0, 1, 2].map(() =>
      this.add
        .text(0, 0, '★', { fontFamily: 'Arial, sans-serif', fontSize: '64px', color: '#d9d9d9' })
        .setOrigin(0.5),
    );
    this.winStats = this.add
      .text(0, 0, '', { fontFamily: 'Arial, sans-serif', fontSize: '18px', color: '#20301f', align: 'center', lineSpacing: 8 })
      .setOrigin(0.5);
    this.winStamp = this.add
      .text(0, 0, 'ПОЛУЧЕНО ⭐', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#8f2f2f',
        fontStyle: 'bold',
        backgroundColor: '#f7f1de',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5)
      .setAngle(-14);
    const btnStyle = {
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      color: '#10251c',
      fontStyle: 'bold',
      padding: { x: 18, y: 12 },
    } as const;
    this.winNext = this.add
      .text(0, 0, '▶ Дальше', { ...btnStyle, backgroundColor: '#f0c94a' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.winNext.on('pointerdown', () => {
      this.currentLevel += 1;
      this.newGame();
    });
    this.winReplay = this.add
      .text(0, 0, '↻ Заново', { ...btnStyle, backgroundColor: '#8fae94' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.winReplay.on('pointerdown', () => this.newGame());
    this.winMap = this.add
      .text(0, 0, '🗺 Карта', { ...btnStyle, backgroundColor: '#8fae94' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.winMap.on('pointerdown', () => {
      this.winPanel.setVisible(false);
      this.toggleMap(true);
    });
    this.winPanel = this.add
      .container(0, 0, [
        this.winOverlay,
        this.winBox,
        this.winArt,
        this.winTitle,
        this.winLevel,
        ...this.winStars,
        this.winStats,
        this.winStamp,
        this.winNext,
        this.winReplay,
        this.winMap,
      ])
      .setDepth(60)
      .setVisible(false);
  }

  private showWin(stars: number, coins: number): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const { region } = regionForLevel(this.currentLevel);
    const aspect = 720 / 1290;
    let boxW = Math.min(520, W - 32);
    let boxH = boxW / aspect;
    if (boxH > H - 80) {
      boxH = H - 80;
      boxW = boxH * aspect;
    }
    const cx = W / 2;
    const cy = H / 2;
    const top = cy - boxH / 2;
    this.winOverlay.setPosition(0, 0).setSize(W, H).setDisplaySize(W, H);
    this.winBox.setVisible(false);
    this.winArt.setTexture('postcard-win');
    this.winArt.setCrop(0, 0, 720, 1290);
    this.winArt.setPosition(cx, cy).setDisplaySize(boxW, boxH);
    this.winTitle.setText('🎉 Победа!');
    this.winTitle.setColor('#7a3b00');
    this.winTitle.setPosition(cx, top + boxH * 0.545);
    this.winLevel.setText(`Уровень ${this.currentLevel} · ${region.name}`);
    this.winLevel.setPosition(cx, top + boxH * 0.6);
    this.winStars.forEach((star, i) => {
      star.setPosition(cx + (i - 1) * 84, top + boxH * 0.675);
      star.setColor(i < stars ? '#f0a500' : '#d8cfb2');
      star.setScale(0);
      this.tweens.add({ targets: star, scale: 1, duration: 350, delay: 250 + i * 280, ease: 'Back.easeOut' });
    });
    this.winStats.setText(
      `Счёт: ${this.score}\nЛучшая серия: ${this.bestStreak}\nНаграда: +${coins} 🪙 и +1 бустер`,
    );
    this.winStats.setPosition(cx, top + boxH * 0.775);
    this.winStamp.setPosition(cx + boxW / 2 - 66, top + boxH * 0.505);
    this.winNext.setPosition(cx - boxW * 0.29, top + boxH * 0.915);
    this.winReplay.setPosition(cx, top + boxH * 0.915);
    this.winMap.setPosition(cx + boxW * 0.29, top + boxH * 0.915);
    this.winPanel.setVisible(true);
  }

  /** Смена рубашки: setTexture + повторный setDisplaySize (фикс «взрыва» текстур). */
  private applyBack(img: Phaser.GameObjects.Image): void {
    if (img.texture.key !== this.backKey) img.setTexture(this.backKey);
    img.setDisplaySize(this.cardW, this.cardH);
  }

  // --- Адаптивная вёрстка ------------------------------------------------------

  private applyBackground(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const key = regionForLevel(this.currentLevel).region.bgKey;
    if (this.bgImage.texture.key !== key) this.bgImage.setTexture(key);
    const tex = this.bgImage.texture.getSourceImage() as HTMLImageElement;
    const scale = Math.max(W / tex.width, H / tex.height);
    this.bgImage.setPosition(W / 2, H / 2).setDisplaySize(tex.width * scale, tex.height * scale);
    this.bgImage.setAlpha(0.55);
  }

  private layout(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    this.applyBackground();

    // Карты: по ширине поля, но не крупнее разумного и не мельче читаемого.
    this.cardW = Phaser.Math.Clamp(Math.floor((W - 36 - 9 * 7) / 10), 46, 92);
    this.cardH = Math.round(this.cardW * 1.55);
    const pitchY = this.cardH + 14;
    // Статус (y~114) и счёт (y~140) должны остаться над полем при любом размере карт.
    this.boardTop = 176 + this.cardH / 2;
    const boardTop = this.boardTop;
    const boardBottom = boardTop + 3 * pitchY + this.cardH / 2;
    this.boardCenterY = boardTop + 1.5 * pitchY;
    if (this.fieldActionButton) this.fieldActionButton.setPosition(W / 2, this.boardCenterY);

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
    this.mapButton.setPosition(W - 84, 56);
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
    {
      const kinds: BoosterKind[] = ['undo', 'plus5', 'wild'];
      kinds.forEach((kind, idx) => {
        this.boosterButtons.get(kind)?.setPosition(W / 2 + (idx - 1) * 190, stockY + stockHalf + 92);
      });
    }

    if (this.settingsPanel?.visible) this.layoutSettings();
    if (this.cards.length === 28) this.refresh();
  }

  // --- Игра --------------------------------------------------------------------

  private onRestart(): void {
    if (this.gameOver === 'win') this.currentLevel += 1;
    this.toggleSettings(false);
    this.newGame();
  }

  private newGame(): void {
    const seed = (Date.now() ^ (this.currentLevel * 7919)) >>> 0;
    this.cameras.main.setBackgroundColor(regionForLevel(this.currentLevel).region.bg);
    this.applyBackground();
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
    this.history = [];
    this.wildActive = false;
    this.restartButton.setText('↻ Новая игра');
    this.fieldActionButton.setVisible(false);
    if (this.winPanel) this.winPanel.setVisible(false);
    this.paintBoosters();
    this.refresh();
    this.updateMeta();
    const { region, indexInRegion } = regionForLevel(this.currentLevel);
    this.setHint(
      indexInRegion === 1 && this.currentLevel > 1
        ? `Новый регион: ${region.name}! Тапните по подсвеченной карте на ±1 от сброса.`
        : 'Тапните по подсвеченной карте на ±1 от сброса.\nНет хода — тапните по колоде.',
    );
  }

  private isOpen(i: number): boolean {
    return coreIsOpen(this.cards, i);
  }

  private isPlayable(i: number): boolean {
    return coreIsPlayable(this.cards, i, this.waste);
  }

  private onCardTap(i: number): void {
    if (this.gameOver) return;
    const wildPlay = this.wildActive && !this.cards[i].removed && this.isOpen(i);
    if (!this.isPlayable(i) && !wildPlay) {
      if (!this.cards[i].removed && !this.isOpen(i)) this.setHint('Эта карта закрыта: сначала снимите карты поверх неё.');
      else if (!this.cards[i].removed) this.setHint('Не подходит: нужна карта на 1 выше или ниже сброса (после K идёт A).');
      return;
    }
    if (!this.movesMade) {
      this.movesMade = true;
      gameplayStart();
    }
    this.pushHistory({ removedIndex: i, drawn: null });
    if (wildPlay) {
      if (!this.takeBooster('wild')) {
        this.history.pop();
        return;
      }
      this.wildActive = false;
      this.paintBoosters();
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
    const drawn = this.stock.pop()!;
    this.pushHistory({ removedIndex: null, drawn });
    this.waste = drawn;
    this.streak = 0;
    this.afterMove();
  }

  private afterMove(): void {
    this.refresh();
    const left = this.cards.filter((c) => !c.removed).length;
    if (left === 0) {
      gameplayStop();
      this.gameOver = 'win';
      if (this.currentLevel >= this.progress.level) this.progress.level = this.currentLevel + 1;
      const stars = starsForStockLeft(this.stock.length);
      const coins = coinsForWin(this.stock.length, this.bestStreak);
      this.progress.totalStars += stars;
      this.progress.coins += coins;
      const kinds: BoosterKind[] = ['undo', 'plus5', 'wild'];
      this.progress.boosters[kinds[Math.floor(Math.random() * kinds.length)]] += 1;
      void storeSave(this.progress);
      this.paintBoosters();
      this.restartButton.setText('▶ Следующий уровень');
      this.showWin(stars, coins);
      this.setStatus(`🎉 Победа! ${'⭐'.repeat(stars)} +${coins} 🪙 +1 бустер`);
      this.setHint(`Уровень ${this.currentLevel} пройден. Лучшая серия: ${this.bestStreak}.`);
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
      const playable = this.isPlayable(i) || (this.wildActive && open);
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
