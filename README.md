# BPMN Forge 0.1.0

Генератор автономных BPMN-схем для работы с ИИ-агентами.

BPMN Forge превращает структурированный JSON процесса в интерактивный HTML и файл BPMN 2.0 с общей геометрией и стабильными ID. Готовый HTML содержит данные, стили и viewer: откройте его через `file://`, сервер и сеть не нужны. CLI не исполняет бизнес-процесс.

Нужен **Node.js 24+** и npm. Локальная проверка выпуска охватывает Node.js 24 и 26 на macOS. Поддержка Windows пока не проверена.

## Первый запуск из GitHub

Скопируйте URL публичного репозитория BPMN Forge из GitHub вместо `REPOSITORY_URL`. Публикация репозитория и npm-пакета выполняется отдельно; это инструкция для подготовленного тега.

```sh
git clone --branch v0.1.0 --single-branch REPOSITORY_URL bpmnforge
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

Соберите архив из проверенной версии:

```sh
npm pack
cd "/путь/Мой проект"
npm install "/путь/bpmnforge/bpmnforge-0.1.0.tgz"
npx --no-install bpmnforge version
npx --no-install bpmnforge validate "описание процесса.bpmnforge.json" --json
npx --no-install bpmnforge build "описание процесса.bpmnforge.json"
```

Установка зависимостей требует сети или заполненного npm-кеша. После установки генерация и просмотр автономны. Пакет из GitHub сначала собирают командами выше; установка исходного Git URL без сборки не является поддерживаемым способом поставки.

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
