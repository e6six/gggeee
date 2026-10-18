import { defineConfig } from 'vite';

// Сборка для Яндекс Игр: архив загружается на платформу, index.html должен
// лежать в корне архива (= корне dist/), а пути к ассетам — относительные.
export default defineConfig({
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Разрешаем проксируемые хосты превью/дев-окружения.
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'es2022',
    sourcemap: false,
    // Требование платформы: ≤100 МБ в распакованном виде — следим за размером
    // на этапе CI (см. scripts/check-dist.mjs), Phaser 4 весит ~500 КБ.
  },
});
