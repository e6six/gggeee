import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';

// Дизайн-разрешение: портрет 720×1280 (мобильные), Scale.FIT растягивает
// поле на десктопе. Управление — один тап/клик, одной рукой (см. docs/gdd.md).
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#10251c',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 720,
    height: 1120,
  },
  render: {
    antialias: true,
    pixelArt: false,
  },
  scene: [BootScene, GameScene],
};

const game = new Phaser.Game(config);

// Требование платформы: звук ставится на паузу при потере фокуса.
game.events.on(Phaser.Core.Events.BLUR, () => {
  game.sound.pauseAll();
});
game.events.on(Phaser.Core.Events.FOCUS, () => {
  game.sound.resumeAll();
});

export default game;
