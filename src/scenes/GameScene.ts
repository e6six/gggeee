import Phaser from 'phaser';
import { gameplayStart } from '../yandex/sdk';
import { t } from '../i18n';

/**
 * ЗАГЛУШКА этапа 0: силуэт раскладки TriPeaks (3 пика), колода и сброс.
 * Настоящее ядро пасьянса (генератор гарантированно проходимых раскладок,
 * правила ±1, закрытые карты, замки) — этап 1, см. docs/gdd.md и docs/roadmap.md.
 */
export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  create(data: { sdkAvailable?: boolean }): void {
    const { width, height } = this.scale;

    this.add
      .text(width / 2, 56, t('title'), {
        fontFamily: 'Arial, sans-serif',
        fontSize: '34px',
        color: '#f5e9c9',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 92, t('subtitle'), {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: '#b9d3a8',
      })
      .setOrigin(0.5);

    this.drawPeaks(width / 2, height * 0.42);
    this.drawStockAndWaste(width / 2, height * 0.78);

    const start = this.add
      .text(width / 2, height * 0.9, t('tapToStart'), {
        fontFamily: 'Arial, sans-serif',
        fontSize: '20px',
        color: '#10251c',
        backgroundColor: '#f0c94a',
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    start.on('pointerdown', () => {
      gameplayStart();
      start.setText('▶');
      this.time.delayedCall(600, () => start.setText(t('tapToStart')));
    });

    if (!data.sdkAvailable) {
      this.add
        .text(width / 2, height - 18, t('mockNote'), {
          fontFamily: 'Arial, sans-serif',
          fontSize: '12px',
          color: '#7fa383',
        })
        .setOrigin(0.5);
    }
  }

  /** Силуэт трёх пиков TriPeaks: ряды перекрывающихся карт. */
  private drawPeaks(cx: number, cy: number): void {
    const g = this.add.graphics();
    const cardW = 46;
    const cardH = 64;
    const gap = 6;
    // Три пика по 3 карты + общий нижний ряд из 10 карт (схематично).
    const peakXs = [cx - (cardW + gap) * 3, cx, cx + (cardW + gap) * 3];
    for (const px of peakXs) {
      for (let row = 0; row < 3; row++) {
        const count = row + 1;
        for (let i = 0; i < count; i++) {
          const x = px + (i - (count - 1) / 2) * (cardW + gap);
          const y = cy - 60 + row * 34;
          g.fillStyle(0xf7f1de, 1);
          g.lineStyle(2, 0x2c4a38, 1);
          g.fillRoundedRect(x - cardW / 2, y - cardH / 2, cardW, cardH, 6);
          g.strokeRoundedRect(x - cardW / 2, y - cardH / 2, cardW, cardH, 6);
        }
      }
    }
    for (let i = 0; i < 10; i++) {
      const x = cx + (i - 4.5) * (cardW + gap);
      const y = cy + 70;
      g.fillStyle(0xf7f1de, 1);
      g.lineStyle(2, 0x2c4a38, 1);
      g.fillRoundedRect(x - cardW / 2, y - cardH / 2, cardW, cardH, 6);
      g.strokeRoundedRect(x - cardW / 2, y - cardH / 2, cardW, cardH, 6);
    }
  }

  private drawStockAndWaste(cx: number, cy: number): void {
    const g = this.add.graphics();
    const cardW = 46;
    const cardH = 64;
    // Рубашка колоды.
    g.fillStyle(0x8f2f2f, 1);
    g.lineStyle(2, 0xf5e9c9, 1);
    g.fillRoundedRect(cx - 90 - cardW / 2, cy - cardH / 2, cardW, cardH, 6);
    g.strokeRoundedRect(cx - 90 - cardW / 2, cy - cardH / 2, cardW, cardH, 6);
    // Открытая карта сброса.
    g.fillStyle(0xf7f1de, 1);
    g.lineStyle(2, 0x2c4a38, 1);
    g.fillRoundedRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH, 6);
    g.strokeRoundedRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH, 6);
    this.add
      .text(cx, cy, 'K', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '24px',
        color: '#20301f',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
  }
}
