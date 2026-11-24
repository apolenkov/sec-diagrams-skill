# sec-diagrams

Навык для Claude Code и Codex проверяет сетевые схемы draw.io уровней L1, L2 и L3.
CLI сверяет нумерацию связей, подписи, легенду и правила межсетевого экрана (МЭ) из YAML.
В комплекте есть пример схемы сбора телеметрии. Команда `pack` собирает материалы в папке
`<копия>-обзор`. В ней лежат `Обзор__Служба__N.pdf`, `записка.txt` и исходники в `схемы/`.
Например, лист приема телеметрии получает имя `Прием телеметрии__L3-1.drawio`.

Нужны Node.js 24+ и npm. Для экспорта также нужен draw.io Desktop. Если CLI его не находит,
задайте в `SD_DRAWIO` путь к исполняемому файлу.

## Claude Code

```sh
claude plugin marketplace add apolenkov/sec-diagrams-skill
claude plugin install sec-diagrams@sec-tools
```

Перезагрузите плагины командой `/reload-plugins` и вызовите `/sec-diagrams:sec-diagrams`.
При установке из GitHub Claude Code устанавливает зависимости в кеш плагина по корневому lock-файлу.
[Загрузка плагинов Claude Code](https://code.claude.com/docs/en/plugins/loading#nodejs-package-dependencies)

## Codex

```sh
codex plugin marketplace add https://github.com/apolenkov/sec-diagrams-skill
codex plugin add sec-diagrams@sec-tools --json
```

Подставьте каталог из поля `installedPath` в `npm ci --omit=dev --prefix "<installedPath>"`.
В новой сессии вызовите `$sec-diagrams`.

## Установка отдельного навыка

```sh
git clone https://github.com/apolenkov/sec-diagrams-skill
cd sec-diagrams-skill
sh scripts/install.sh
```

В Windows запустите `.\scripts\install.ps1` из корня клона. Установщик копирует навык
в `~/.agents/skills/sec-diagrams` и ставит зависимости. Для Claude Code он создает ссылку
в `~/.claude/skills`, если каталоги навыков различаются.

## Проверка примера

Для отдельного навыка задайте `CLI` как в примере. Для плагина используйте
`<каталог плагина>/skills/sec-diagrams/tools/cli.ts`.

```sh
CLI="$HOME/.agents/skills/sec-diagrams/tools/cli.ts"
node "$CLI" init ./sample
node "$CLI" rules ./sample/poc.yaml
node "$CLI" check ./sample
node "$CLI" letter ./sample
```

Последняя команда создаст черновик письма. Заполните его и вызовите `letter` еще раз для проверки.
Порядок работы с обезличенными и итоговыми схемами есть в [инструкции навыка](skills/sec-diagrams/SKILL.md).

## Лицензия

Код и шаблоны проекта распространяются на условиях [MIT](LICENSE). Список зависимостей есть
в [THIRD-PARTY.md](THIRD-PARTY.md).

### Лицензия mupdf

Пользователь устанавливает MuPDF.js вручную для `pdf` и `pack`. Остальные команды работают после
обычной установки навыка. MuPDF.js поставляется отдельно по лицензии AGPL-3.0-or-later.

```sh
npm install --prefix ~/.sec-diagrams mupdf@1.28.6
```

Чтобы выбрать другой каталог, используйте его в `--prefix` и `SEC_DIAGRAMS_HOME`.
При заданном `SEC_DIAGRAMS_HOME` движок загружается из `node_modules` этого каталога.
ZIP и плагин под MIT можно распространять без MuPDF.js. При распространении сборки, включающей
интегрированный MuPDF.js, применяются условия его лицензии, включая предоставление
соответствующего исходного кода, если сборка распространяется на условиях AGPL.
[GNU AGPL](https://www.gnu.org/licenses/agpl-3.0.html), [Лицензирование Artifex](https://artifex.com/licensing)

## Разработка

```sh
npm ci
npm run typecheck
npm test
claude plugin validate . --strict
npm run skill:zip
```

Для тестов PDF установите движок в корень клона командой `npm install --no-save mupdf@1.28.6`.
ZIP отдельного навыка появляется в `dist/sec-diagrams.zip`. Скрипт берет файлы навыка из индекса Git.
