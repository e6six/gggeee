import Phaser from 'phaser';
import { detectLang, gameReady, initSdk, isSdkAvailable } from '../yandex/sdk';
import { setLang } from '../i18n';

/**
 * Загрузка: инициализирует SDK, определяет язык, затем сообщает платформе
 * LoadingAPI.ready() и переходит в игровую сцену.
 * Этап 2: сюда встанет Preload ассетов (карты, фоны, иконки).
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    void this.boot();
  }

  private async boot(): Promise<void> {
    await initSdk();
    setLang(detectLang());

    // Ассетов пока нет — игра сразу готова принимать ввод.
    gameReady();

    this.scene.start('GameScene', { sdkAvailable: isSdkAvailable() });
  }
}
