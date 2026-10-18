import Phaser from 'phaser';
import { gameReady, gameplayStart, gameplayStop, loadSave, storeSave } from '../yandex/sdk';
import {
  coinsForWin,
  createRng,
  generateGame,
  makeBoosterCards,
  isOpen as coreIsOpen,
  isPlayable as coreIsPlayable,
  isUnlocked,
  obstaclesForLevel,
  removedCount,
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
  daily: { lastClaim: string | null; streak: number };
}

const DEFAULT_PROGRESS: Progress = {
  level: 1,
  totalStars: 0,
  coins: 0,
  boosters: { undo: 3, plus5: 2, wild: 1 },
  daily: { lastClaim: null, streak: 0 },
};

const GAME_SAVE_KEY = 'solitaire-journey.game.v1';

interface GameSnapshot {
  currentLevel: number;
  tableau: TableauCard[];
  stock: CardData[];
  waste: CardData;
  score: number;
  streak: number;
  bestStreak: number;
  movesMade: boolean;
}

type BoosterKind = 'undo' | 'plus5' | 'wild';

interface MoveSnapshot {
  removedIndex: number | null;
  iceHits?: number;
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
  badge: Phaser.GameObjects.Text;
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
  private bgArt!: Phaser.GameObjects.Image;

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
  private mapCycle = 1;
  private mapPrev!: Phaser.GameObjects.Text;
  private mapNext!: Phaser.GameObjects.Text;
  private mapCycleText!: Phaser.GameObjects.Text;
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
  // DEV: тестовый переход к уровню. УБРАТЬ перед отправкой на модерацию (этап 5)!
  private testLevel = 1;
  private testLevelText!: Phaser.GameObjects.Text;
  private testLabel!: Phaser.GameObjects.Text;
  private resetButton!: Phaser.GameObjects.Text;
  private closeSettingsButton!: Phaser.GameObjects.Text;
  private soundOn = true;
  private testControls: Phaser.GameObjects.Text[] = [];

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
    this.bgArt = this.add.image(0, 0, REGIONS[0].bgKey).setDepth(-9);
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
    this.buildDaily();
    this.layout();
    this.scale.on('resize', () => this.layout());

    this.newGame();
    // Ассеты загружены (preload завершён), поле построено — игра готова.
    gameReady();
    void loadSave<Progress>(structuredClone(DEFAULT_PROGRESS)).then((saved) => {
      const merged: Progress = {
        ...structuredClone(DEFAULT_PROGRESS),
        ...saved,
        boosters: { ...DEFAULT_PROGRESS.boosters, ...(saved.boosters ?? {}) },
        daily: { ...DEFAULT_PROGRESS.daily, ...(saved.daily ?? {}) },
      };
      this.progress = merged;
      this.currentLevel = merged.level;
      if (!this.restoreGame()) {
        if (merged.level > 1 || merged.totalStars > 0 || merged.coins > 0) this.newGame();
        else this.paintBoosters();
      }
      this.maybeShowDaily();
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
        backgroundColor: '#10251cd9',
        padding: { x: 12, y: 5 },
      })
      .setOrigin(0.5, 0);
    this.scoreText = this.add
      .text(0, 140, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '15px',
        color: '#dcebd2',
        backgroundColor: '#10251cb8',
        padding: { x: 10, y: 4 },
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
      const badge = this.add
        .text(0, 0, '', { fontFamily: 'Arial, sans-serif', fontSize: '26px' })
        .setOrigin(0.5)
        .setVisible(false);
      const back = this.add.image(0, 0, this.backKey).setVisible(false);
      const container = this.add.container(0, 0, [bg, label, suit, back, badge]);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => this.onCardTap(i));
      back.setInteractive({ useHandCursor: true });
      back.on('pointerdown', () => this.onCardTap(i));
      this.views.push({ container, bg, back, badge, label, suit });
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
      .text(0, 0, 'Колода', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: '#e8f0e4',
        backgroundColor: '#10251cd9',
        padding: { x: 8, y: 3 },
      })
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
      .text(0, 0, 'Сброс', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: '#e8f0e4',
        backgroundColor: '#10251cd9',
        padding: { x: 8, y: 3 },
      })
      .setOrigin(0.5)
      .setName('wasteTitle');
    this.wasteView = this.add.container(0, 0, [wasteBg, this.wasteLabel, this.wasteSuit, wasteTitle]);

    this.hintText = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#e8f0e4',
        backgroundColor: '#10251cd9',
        align: 'center',
        padding: { x: 12, y: 7 },
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

  // --- Ежедневный бонус ----------------------------------------------------------

  private dailyPanel!: Phaser.GameObjects.Container;
  private pendingDaily: { coins: number; kind: BoosterKind; streak: number } | null = null;

  private buildDaily(): void {
    const overlay = this.add.rectangle(0, 0, 10, 10, 0x000000, 0.6).setOrigin(0).setName('dailyOverlay');
    const box = this.add.rectangle(0, 0, 10, 10, 0xf7f1de).setStrokeStyle(4, 0xd9b64a).setName('dailyBox');
    const title = this.add
      .text(0, 0, '🎁 Ежедневный бонус', { fontFamily: 'Arial, sans-serif', fontSize: '26px', color: '#20301f', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setName('dailyTitle');
    const text = this.add
      .text(0, 0, '', { fontFamily: 'Arial, sans-serif', fontSize: '19px', color: '#20301f', align: 'center', lineSpacing: 10 })
      .setOrigin(0.5)
      .setName('dailyText');
    const claim = this.add
      .text(0, 0, 'Забрать', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#10251c',
        backgroundColor: '#f0c94a',
        fontStyle: 'bold',
        padding: { x: 26, y: 13 },
      })
      .setOrigin(0.5)
      .setName('dailyClaim')
      .setInteractive({ useHandCursor: true });
    claim.on('pointerdown', () => this.claimDaily());
    this.dailyPanel = this.add.container(0, 0, [overlay, box, title, text, claim]).setDepth(70).setVisible(false);
  }

  private todayStr(offsetDays = 0): string {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  private maybeShowDaily(): void {
    const today = this.todayStr();
    if (this.progress.daily.lastClaim === today) return;
    const streak = this.progress.daily.lastClaim === this.todayStr(-1) ? this.progress.daily.streak + 1 : 1;
    const kinds: BoosterKind[] = ['undo', 'plus5', 'wild'];
    this.pendingDaily = {
      coins: 25 + Math.min(streak, 7) * 5,
      kind: kinds[(streak - 1) % kinds.length],
      streak,
    };
    const W = this.scale.width;
    const H = this.scale.height;
    const boxW = Math.min(480, W - 40);
    const boxH = 340;
    const cx = W / 2;
    const cy = H / 2;
    const overlay = this.dailyPanel.getByName('dailyOverlay') as Phaser.GameObjects.Rectangle;
    overlay.setPosition(0, 0).setSize(W, H).setDisplaySize(W, H);
    (this.dailyPanel.getByName('dailyBox') as Phaser.GameObjects.Rectangle)
      .setPosition(cx, cy)
      .setSize(boxW, boxH)
      .setDisplaySize(boxW, boxH);
    (this.dailyPanel.getByName('dailyTitle') as Phaser.GameObjects.Text).setPosition(cx, cy - boxH / 2 + 52);
    const boosterNames: Record<BoosterKind, string> = { undo: '↩ Отмена хода', plus5: '＋5 карт', wild: '★ Дикая карта' };
    (this.dailyPanel.getByName('dailyText') as Phaser.GameObjects.Text)
      .setText(`День ${streak} подряд!\n\n+${this.pendingDaily.coins} 🪙\n+1 бустер: ${boosterNames[this.pendingDaily.kind]}`)
      .setPosition(cx, cy - 10);
    (this.dailyPanel.getByName('dailyClaim') as Phaser.GameObjects.Text).setPosition(cx, cy + boxH / 2 - 58);
    this.dailyPanel.setVisible(true);
  }

  private claimDaily(): void {
    if (!this.pendingDaily) return;
    this.progress.coins += this.pendingDaily.coins;
    this.progress.boosters[this.pendingDaily.kind] += 1;
    this.progress.daily = { lastClaim: this.todayStr(), streak: this.pendingDaily.streak };
    this.pendingDaily = null;
    void storeSave(this.progress);
    this.dailyPanel.setVisible(false);
    this.paintBoosters();
    this.updateMeta();
    this.setHint('Бонус получен! Возвращайтесь завтра за следующим.');
  }

  // --- Сохранение незаконченной партии (локально на устройстве) -------------------

  private persistGame(): void {
    if (this.gameOver || this.cards.length !== 28) return;
    const snap: GameSnapshot = {
      currentLevel: this.currentLevel,
      tableau: this.cards,
      stock: this.stock,
      waste: this.waste,
      score: this.score,
      streak: this.streak,
      bestStreak: this.bestStreak,
      movesMade: this.movesMade,
    };
    try {
      localStorage.setItem(GAME_SAVE_KEY, JSON.stringify(snap));
    } catch {
      /* localStorage недоступен — играем без автосейва партии */
    }
  }

  private clearGameSave(): void {
    try {
      localStorage.removeItem(GAME_SAVE_KEY);
    } catch {
      /* noop */
    }
  }

  private restoreGame(): boolean {
    try {
      const raw = localStorage.getItem(GAME_SAVE_KEY);
      if (!raw) return false;
      const snap = JSON.parse(raw) as GameSnapshot;
      if (!snap.tableau || snap.tableau.length !== 28) return false;
      this.currentLevel = snap.currentLevel;
      this.cards = snap.tableau;
      this.stock = snap.stock;
      this.waste = snap.waste;
      this.score = snap.score;
      this.streak = snap.streak;
      this.bestStreak = snap.bestStreak;
      this.movesMade = snap.movesMade;
      this.wasOpen = new Array(28).fill(false);
      this.history = [];
      this.wildActive = false;
      this.gameOver = null;
      this.cameras.main.setBackgroundColor(regionForLevel(this.currentLevel).region.bg);
      this.applyBackground();
      this.refresh();
      this.updateMeta();
      this.setHint('Партия восстановлена. Тапните по подсвеченной карте на ±1 от сброса.');
      return true;
    } catch {
      return false;
    }
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
    if (snap.removedIndex !== null) {
      this.cards[snap.removedIndex].removed = false;
      if (snap.iceHits !== undefined) this.cards[snap.removedIndex].iceHits = snap.iceHits;
    }
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
    this.persistGame();
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
    this.persistGame();
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

    // DEV-блок: степпер уровня и кнопка «Играть»
    this.testLabel = this.add
      .text(0, 0, '🔧 Тест: перейти к уровню (убрать перед релизом)', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: '#f0c94a',
      })
      .setOrigin(0.5);
    const stepStyle = {
      fontFamily: 'Arial, sans-serif',
      fontSize: '19px',
      color: '#10251c',
      backgroundColor: '#8fae94',
      fontStyle: 'bold',
      padding: { x: 14, y: 9 },
    } as const;
    const minus = this.add.text(0, 0, '◀', stepStyle).setOrigin(0.5).setInteractive({ useHandCursor: true });
    minus.on('pointerdown', () => {
      this.testLevel = Math.max(1, this.testLevel - 1);
      this.paintTestLevel();
    });
    const plus = this.add.text(0, 0, '▶', stepStyle).setOrigin(0.5).setInteractive({ useHandCursor: true });
    plus.on('pointerdown', () => {
      this.testLevel = Math.min(99, this.testLevel + 1);
      this.paintTestLevel();
    });
    this.testLevelText = this.add
      .text(0, 0, '', { fontFamily: 'Arial, sans-serif', fontSize: '19px', color: '#f5e9c9', fontStyle: 'bold' })
      .setOrigin(0.5);
    const play = this.add
      .text(0, 0, 'Играть', { ...stepStyle, backgroundColor: '#f0c94a' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    play.on('pointerdown', () => {
      this.currentLevel = this.testLevel;
      this.clearGameSave();
      this.toggleSettings(false);
      this.newGame();
    });
    this.testControls = [minus, plus, play];
    children.push(
      this.restartButton,
      this.soundButton,
      this.resetButton,
      this.testLabel,
      minus,
      this.testLevelText,
      plus,
      play,
      this.closeSettingsButton,
    );
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

  private paintTestLevel(): void {
    const { region } = regionForLevel(this.testLevel);
    this.testLevelText.setText(`Уровень ${this.testLevel} · ${region.name}`);
  }

  private toggleSettings(open: boolean): void {
    if (open) {
      this.testLevel = this.currentLevel;
      this.paintTestLevel();
      this.layoutSettings();
    }
    this.settingsPanel.setVisible(open);
  }

  private layoutSettings(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const boxW = Math.min(560, W - 48);
    const boxH = Math.min(760, this.scale.height - 32);
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
    this.restartButton.setPosition(cx, cy + 8);
    this.soundButton.setPosition(cx, cy + 68);
    this.resetButton.setPosition(cx, cy + 128);
    this.testLabel.setPosition(cx, cy + 178);
    this.testControls[0]?.setPosition(cx - 190, cy + 218);
    this.testLevelText.setPosition(cx - 40, cy + 218);
    this.testControls[1]?.setPosition(cx + 96, cy + 218);
    this.testControls[2]?.setPosition(cx + 178, cy + 218);
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
    const arrowStyle = {
      fontFamily: 'Arial, sans-serif',
      fontSize: '22px',
      color: '#10251c',
      backgroundColor: '#f0c94a',
      fontStyle: 'bold',
      padding: { x: 14, y: 8 },
    } as const;
    this.mapPrev = this.add.text(0, 0, '◀', arrowStyle).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.mapPrev.on('pointerdown', () => {
      this.mapCycle = Math.max(1, this.mapCycle - 1);
      this.rebuildMap();
    });
    this.mapNext = this.add.text(0, 0, '▶', arrowStyle).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.mapNext.on('pointerdown', () => {
      const maxCycle = regionForLevel(this.progress.level).cycle;
      this.mapCycle = Math.min(maxCycle, this.mapCycle + 1);
      this.rebuildMap();
    });
    this.mapCycleText = this.add
      .text(0, 0, '', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '15px',
        color: '#f5e9c9',
        backgroundColor: '#10251c',
        fontStyle: 'bold',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5);
    this.mapPanel = this.add
      .container(0, 0, [
        this.mapOverlay,
        this.mapImage,
        this.mapBox,
        this.mapTitle,
        this.mapPrev,
        this.mapNext,
        this.mapCycleText,
        this.mapContent,
        this.mapClose,
      ])
      .setDepth(50)
      .setVisible(false);
  }

  private toggleMap(open: boolean): void {
    if (open) {
      this.mapCycle = regionForLevel(this.currentLevel).cycle;
      this.rebuildMap();
    }
    this.mapPanel.setVisible(open);
  }

  /**
   * Маршрут по островам картинки карты (40 узлов, 4 локации × 10):
   * Пустыня (запад) → Пагода (юго-восток) → Башня (северо-восток) → Горы (северо-запад).
   * Координаты — доли от рамки карты, кластеры лежат на своих островах.
   */
  private routePoints(): { fx: number; fy: number }[] {
    const clusters: { fx: number; fy: number }[][] = [
      // Пустыня с пирамидами
      [
        { fx: 0.15, fy: 0.84 }, { fx: 0.25, fy: 0.88 }, { fx: 0.34, fy: 0.82 },
        { fx: 0.38, fy: 0.72 }, { fx: 0.28, fy: 0.68 }, { fx: 0.18, fy: 0.72 },
        { fx: 0.13, fy: 0.62 }, { fx: 0.22, fy: 0.57 }, { fx: 0.32, fy: 0.6 },
        { fx: 0.42, fy: 0.5 },
      ],
      // Пагода у осенней горы
      [
        { fx: 0.58, fy: 0.82 }, { fx: 0.68, fy: 0.86 }, { fx: 0.78, fy: 0.8 },
        { fx: 0.86, fy: 0.72 }, { fx: 0.76, fy: 0.68 }, { fx: 0.66, fy: 0.72 },
        { fx: 0.6, fy: 0.62 }, { fx: 0.7, fy: 0.57 }, { fx: 0.8, fy: 0.6 },
        { fx: 0.88, fy: 0.5 },
      ],
      // Башня над водопадом
      [
        { fx: 0.86, fy: 0.44 }, { fx: 0.76, fy: 0.4 }, { fx: 0.66, fy: 0.44 },
        { fx: 0.58, fy: 0.36 }, { fx: 0.68, fy: 0.31 }, { fx: 0.78, fy: 0.34 },
        { fx: 0.87, fy: 0.27 }, { fx: 0.78, fy: 0.2 }, { fx: 0.68, fy: 0.24 },
        { fx: 0.58, fy: 0.16 },
      ],
      // Зелёные горы и озеро
      [
        { fx: 0.38, fy: 0.18 }, { fx: 0.3, fy: 0.13 }, { fx: 0.22, fy: 0.18 },
        { fx: 0.13, fy: 0.12 }, { fx: 0.16, fy: 0.24 }, { fx: 0.25, fy: 0.29 },
        { fx: 0.34, fy: 0.24 }, { fx: 0.38, fy: 0.33 }, { fx: 0.28, fy: 0.37 },
        { fx: 0.18, fy: 0.33 },
      ],
    ];
    return clusters.flat();
  }

  private rebuildMap(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    // Карта — почти на весь экран, в пропорциях картинки 720×1080.
    let boxH = H - 32;
    let boxW = (boxH * 2) / 3;
    if (boxW > W - 20) {
      boxW = W - 20;
      boxH = boxW * 1.5;
    }
    const k = boxW / 640; // масштаб узлов/шрифтов под размер карты
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
    const cycleBase = (this.mapCycle - 1) * 40;
    this.mapPrev.setPosition(left + 44, top + 34);
    this.mapNext.setPosition(left + boxW - 44, top + 34);
    this.mapCycleText.setText(`Круг ${this.mapCycle} · уровни ${cycleBase + 1}–${cycleBase + 40}`);
    this.mapCycleText.setPosition(cx, top + 72);
    const maxCycle = regionForLevel(this.progress.level).cycle;
    this.mapPrev.setAlpha(this.mapCycle > 1 ? 1 : 0.35);
    this.mapNext.setAlpha(this.mapCycle < maxCycle ? 1 : 0.35);

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

    // Подписи локаций — у своих островов, а не у строк маршрута.
    const labelPos = [
      { fx: 0.22, fy: 0.475 },
      { fx: 0.72, fy: 0.54 },
      { fx: 0.72, fy: 0.475 },
      { fx: 0.13, fy: 0.415 },
    ];
    REGIONS.forEach((region, r) => {
      const pt = { x: left + labelPos[r].fx * boxW, y: top + labelPos[r].fy * boxH };
      const label = this.add
        .text(pt.x, pt.y - 40 * k, region.name, {
          fontFamily: 'Arial, sans-serif',
          fontSize: `${Math.round(15 * k)}px`,
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
      const radius = (frontier ? 17 : 14) * k;
      const circle = this.add
        .circle(0, 0, radius, completed ? 0xf0a500 : frontier ? 0x57a773 : 0x93a696)
        .setStrokeStyle(playing ? 4 : 2, playing ? 0xf0c94a : 0xffffff);
      const text = this.add
        .text(0, 0, completed ? '★' : String(lvl), {
          fontFamily: 'Arial, sans-serif',
          fontSize: completed ? `${Math.round(15 * k)}px` : `${Math.round(13 * k)}px`,
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
        const pin = this.add.text(pt.x, pt.y - 34 * k, '📍', { fontSize: `${Math.round(26 * k)}px` }).setOrigin(0.5);
        this.mapContent.add(pin);
        this.tweens.add({ targets: pin, y: pt.y - 44 * k, duration: 550, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
      if (frontier && !playing) {
        this.tweens.add({ targets: node, scale: 1.18, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      }
    });

    // Легенда — в правой части экрана: если рядом с картой есть место
    // (широкий экран), уезжает вправо от карты; на узком — в правый низ карты.
    const legend = this.add
      .text(0, 0, 'Золото — ваш путь · 📍 — вы здесь\nТап по открытому узлу — играть', {
        fontFamily: 'Arial, sans-serif',
        fontSize: `${Math.round(13 * k)}px`,
        color: '#f5e9c9',
        backgroundColor: '#10251c',
        align: 'right',
        padding: { x: 12, y: 7 },
      })
      .setOrigin(1, 0.5);
    if (left > 260) legend.setPosition(W - 16, cy);
    else legend.setPosition(left + boxW - 14, top + boxH - 150);
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

  /**
   * Фон региона в два слоя, чтобы картинка не обрезалась ни в каком окне:
   * нижний — cover-подложка на весь экран (заполняет края, приглушена),
   * верхний — вся картинка целиком (contain, декор по краям не теряется).
   */
  private applyBackground(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const key = regionForLevel(this.currentLevel).region.bgKey;
    for (const img of [this.bgImage, this.bgArt]) {
      if (img.texture.key !== key) img.setTexture(key);
    }
    const tex = this.bgImage.texture.getSourceImage() as HTMLImageElement;
    const cover = Math.max(W / tex.width, H / tex.height);
    this.bgImage.setPosition(W / 2, H / 2).setDisplaySize(tex.width * cover, tex.height * cover);
    this.bgImage.setAlpha(0.35);
    const contain = Math.min(W / tex.width, H / tex.height);
    this.bgArt.setPosition(W / 2, H / 2).setDisplaySize(tex.width * contain, tex.height * contain);
    this.bgArt.setAlpha(0.6);
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
      v.badge.setPosition(this.cardW / 2 - 15, -this.cardH / 2 + 15);
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
    const game = generateGame(createRng(seed), obstaclesForLevel(this.currentLevel));
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
    const card = this.cards[i];
    // Лёд: подходящая замороженная карта сначала трескается, уходит со второго раза.
    if (!card.removed && card.obstacle === 'ice' && (card.iceHits ?? 0) > 0 && this.isPlayable(i)) {
      card.iceHits = (card.iceHits ?? 0) - 1;
      this.refresh();
      this.persistGame();
      this.setHint('❄ Лёд треснул! Сыграйте эту карту ещё раз, чтобы снять.');
      return;
    }
    const wildPlay = this.wildActive && !this.cards[i].removed && this.isOpen(i) && isUnlocked(this.cards, i);
    if (!this.isPlayable(i) && !wildPlay) {
      if (!card.removed && this.isOpen(i) && !isUnlocked(this.cards, i)) {
        const left = (card.lockThreshold ?? 0) - removedCount(this.cards);
        this.setHint(`🔒 Замок: откроется ещё через ${left} снятых карт.`);
      } else if (!this.cards[i].removed && !this.isOpen(i)) this.setHint('Эта карта закрыта: сначала снимите карты поверх неё.');
      else if (!this.cards[i].removed) this.setHint('Не подходит: нужна карта на 1 выше или ниже сброса (после K идёт A).');
      return;
    }
    if (!this.movesMade) {
      this.movesMade = true;
      gameplayStart();
    }
    this.pushHistory({ removedIndex: i, drawn: null, iceHits: this.cards[i].iceHits });
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
    this.persistGame();
    const left = this.cards.filter((c) => !c.removed).length;
    if (left === 0) {
      gameplayStop();
      this.gameOver = 'win';
      this.clearGameSave();
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
      this.clearGameSave();
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
      const unlocked = isUnlocked(this.cards, i);
      if (open && unlocked) {
        const frozen = card.obstacle === 'ice' && (card.iceHits ?? 0) > 0;
        view.back.setVisible(false);
        view.label.setVisible(true);
        view.suit.setVisible(true);
        view.badge.setVisible(frozen);
        view.badge.setText('❄');
        view.badge.setFontSize(22).setColor('#0b6fa4');
        view.badge.setPosition(this.cardW / 2 - 15, -this.cardH / 2 + 15);
        view.bg
          .setFillStyle(frozen ? 0xa8d8f0 : 0xf7f1de)
          .setStrokeStyle(playable ? 4 : 2, frozen ? 0x3d9bdc : playable ? 0xf0c94a : 0x2c4a38);
        view.label.setText(RANKS[card.rank]).setColor(this.suitColor(card.suit));
        view.suit.setText(SUITS[card.suit]).setColor(this.suitColor(card.suit));
      } else if (open && !unlocked) {
        // Замок: лицо видно, но карта серая и неиграбельна до порога.
        view.back.setVisible(false);
        view.label.setVisible(true);
        view.suit.setVisible(true);
        view.badge.setVisible(true);
        view.badge.setText('🔒');
        view.badge.setFontSize(24).setColor('#20301f');
        view.badge.setPosition(this.cardW / 2 - 15, -this.cardH / 2 + 15);
        view.bg.setFillStyle(0xb9c0bb).setStrokeStyle(2, 0x5a6a60);
        view.label.setText(RANKS[card.rank]).setColor('#5a6a60');
        view.suit.setText(SUITS[card.suit]).setColor('#5a6a60');
      } else {
        this.applyBack(view.back);
        view.back.setVisible(true);
        view.label.setVisible(false);
        view.suit.setVisible(false);
        // Закрытый замок — крупный значок по центру рубашки, чтобы его видели сразу.
        view.badge.setVisible(card.obstacle === 'lock');
        view.badge.setText(card.obstacle === 'lock' ? '🔒' : '');
        view.badge.setFontSize(32).setColor('#ffffff');
        view.badge.setPosition(0, 0);
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
