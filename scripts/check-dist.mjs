// Проверка сборки на критичные требования Яндекс Игр к архиву:
//  - index.html в корне dist/
//  - суммарный размер ≤ 100 МБ в распакованном виде
//  - нет пробелов и кириллицы в именах файлов
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = new URL('../dist', import.meta.url).pathname;
const LIMIT = 100 * 1024 * 1024;
const BAD_NAME = /[\s\u0400-\u04FF]/;

let total = 0;
let bad = [];
let hasIndex = false;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const rel = relative(DIST, path);
    if (BAD_NAME.test(name)) bad.push(rel);
    if (statSync(path).isDirectory()) walk(path);
    else {
      total += statSync(path).size;
      if (rel === 'index.html') hasIndex = true;
    }
  }
}

walk(DIST);

console.log(`dist/: ${(total / 1024 / 1024).toFixed(2)} MB (лимит 100 MB)`);
if (!hasIndex) {
  console.error('ОШИБКА: нет dist/index.html в корне сборки');
  process.exit(1);
}
if (total > LIMIT) {
  console.error('ОШИБКА: превышен лимит 100 МБ');
  process.exit(1);
}
if (bad.length) {
  console.error('ОШИБКА: пробелы/кириллица в именах файлов:\n' + bad.join('\n'));
  process.exit(1);
}
console.log('OK: index.html в корне, размер и имена файлов в норме');
