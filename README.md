# BPMN Forge 0.1.0

Генератор автономных BPMN-схем для работы с ИИ-агентами.

BPMN Forge превращает структурированный JSON процесса в интерактивный HTML и файл BPMN 2.0 с общей геометрией и стабильными ID. Готовый HTML содержит данные, стили и viewer: откройте его через `file://`, сервер и сеть не нужны. CLI не исполняет бизнес-процесс.

Нужен **Node.js 24+** и npm. Локальная проверка выпуска охватывает Node.js 24 и 26 на macOS. Поддержка Windows пока не проверена.

## Первый запуск из GitHub

Исходники и [релиз v0.1.0](https://github.com/DatKorso/bpmnforge/releases/tag/v0.1.0) доступны на GitHub. Установка из исходников:

```sh
git clone --branch v0.1.0 --single-branch https://github.com/DatKorso/bpmnforge.git bpmnforge
cd bpmnforge
npm ci
npm run build
node bin/bpmnforge.mjs version
```

Ожидаемая версия — `0.1.0`. Сохраните следующий полностью вымышленный технический процесс в `process.bpmnforge.json`:

```json
{
  "version": 1,
  "id": "Demo",
  "name": "Тестовый сигнал",
  "stages": [{ "id": "Stage", "name": "Тест" }],
  "processes": [{ "id": "Process", "name": "Тестовый процесс" }],
  "pools": [{ "id": "Pool", "name": "Тестовый участник", "process": "Process" }],
  "lanes": [],
  "nodes": [
    { "id": "Start", "name": "Начало", "type": "start", "process": "Process", "stage": "Stage" },
    { "id": "Task", "name": "Проверить сигнал", "description": "Вымышленный шаг для проверки генератора.", "type": "task", "process": "Process", "stage": "Stage" },
    { "id": "End", "name": "Конец", "type": "end", "process": "Process", "stage": "Stage" }
  ],
  "flows": [
    { "id": "First", "type": "sequence", "source": "Start", "target": "Task" },
    { "id": "Last", "type": "sequence", "source": "Task", "target": "End" }
  ]
}
```

```sh
node bin/bpmnforge.mjs validate process.bpmnforge.json --json
node bin/bpmnforge.mjs build process.bpmnforge.json
```

Рядом появятся `process.bpmnforge.html` и `process.bpmnforge.bpmn`. Откройте HTML двойным щелчком в Chromium-совместимом браузере. Выберите этап сверху и блок на схеме: описание и соседние шаги появятся справа.

## Установка в другой проект

Установите готовый пакет из GitHub Release:

```sh
cd "/путь/Мой проект"
curl --fail --location --output bpmnforge-0.1.0.tgz https://github.com/DatKorso/bpmnforge/releases/download/v0.1.0/bpmnforge-0.1.0.tgz
npm install ./bpmnforge-0.1.0.tgz
npx --no-install bpmnforge version
npx --no-install bpmnforge validate "описание процесса.bpmnforge.json" --json
npx --no-install bpmnforge build "описание процесса.bpmnforge.json"
```

Для локальной сборки архива выполните `npm pack` в клонированном репозитории, затем установите полученный `.tgz` через `npm install "/путь/bpmnforge/bpmnforge-0.1.0.tgz"`. Контрольная сумма опубликованного архива находится в `SHA256SUMS.txt` рядом с ним на странице релиза.

Скачивание перед установкой совместимо с npm 12, где установка пакета прямо по удалённому URL по умолчанию отключена (`EALLOWREMOTE`).

Пакет распространяется через GitHub Releases; в реестре npm этот выпуск не публиковался. Установка зависимостей требует сети или заполненного npm-кеша. После установки генерация и просмотр автономны. Пакет из GitHub сначала собирают командами выше; установка исходного Git URL без сборки не является поддерживаемым способом поставки.

## Документация и проверка

- [Руководство пользователя](docs/USER-GUIDE.md): CLI, имена файлов, ссылки, навигация, BPMN-профиль и раскладка.
- [Руководство для LLM](docs/LLM-GUIDE.md): подготовка JSON и цикл исправлений по диагностике.
- [JSON Schema](schema/bpmnforge.schema.json) — точная структура формата версии 1.
- [Изменения 0.1.0](CHANGELOG.md) и [локальная проверка выпуска](docs/RELEASING.md).

```sh
npm ci
npx playwright install chromium
npm test
npm audit
```

`npm test` собирает проект, проверяет TypeScript и запускает `test:unit`, полный `test:e2e` и `test:package`. Последний устанавливает настоящий `.tgz` в пустой проект. Для отдельного набора сначала выполните `npm run build`. По умолчанию браузерные тесты используют Chromium из Playwright; установленный Chrome можно выбрать через `BPMNFORGE_BROWSER_CHANNEL=chrome npm run test:e2e`.

В репозитории есть только синтетические технические fixtures. Отдельные бизнес-примеры и GitHub CI запланированы на будущее.

## Лицензии

Собственный код BPMN Forge распространяется по [MIT](LICENSE). Лицензии встроенных компонентов продолжают действовать: `assets/THIRD-PARTY-NOTICES.txt` создаётся при сборке, входит в пакет и в HTML под раскрываемым пунктом «Лицензии компонентов viewer». У `bpmn-js` есть отдельное условие о полностью видимом логотипе bpmn.io; оно сохраняется в viewer и уведомлениях. npm также устанавливает лицензии зависимостей CLI вместе с соответствующими пакетами.
