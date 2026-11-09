# Выпуск новых версий BPMN Forge

Рабочая инструкция для сопровождающего и ИИ-агента. Канал поставки — [GitHub Releases](https://github.com/DatKorso/bpmnforge/releases). Публикация в npm registry и GitHub CI пока не настроены; проверки выполняются локально. Команды ниже — шаблон следующего выпуска, а не поручение выпустить новую версию сейчас.

## 1. Выбрать версию и подготовить публичную ветку

Выпускайте из чистого checkout публичного репозитория. Если разработка идёт в отдельном приватном каталоге, переносите в публичную копию только проверенные файлы: её Git-история должна продолжать очищенную `main`. Локальные GSD-архивы, реальные процессы и резервные копии остаются вне публикации. Повторять `git-filter-repo` для обычного следующего релиза не требуется; при переносе другой истории нужно снова проверить все достижимые объекты и refs.

К началу подготовки изменения функциональности уже должны быть закоммичены и перенесены в публичную `main`. Сначала завершите другие незакоммиченные задачи. В примерах используется существующий HTTPS remote проекта.

```sh
cd "/путь/к/публичной/копии/bpmnforge"
git status --short
git remote -v
git switch main
git pull --ff-only
git fetch origin --tags
gh auth status

RELEASE_REPO="DatKorso/bpmnforge"
RELEASE_VERSION="0.1.1"
RELEASE_TAG="v$RELEASE_VERSION"
RELEASE_BASE_URL="https://github.com/$RELEASE_REPO"
git tag --list "$RELEASE_TAG"
git ls-remote --tags origin "refs/tags/$RELEASE_TAG"
```

`origin` должен вести в `DatKorso/bpmnforge`. Рабочее дерево должно быть чистым; выбранные тег и номер версии ещё не должны использоваться. Все блоки выполняются последовательно в одной shell-сессии; замените пример `0.1.1` выбранной версией.

Согласно [SemVer](https://semver.org/lang/ru/), опубликованное содержимое версии не изменяют, а API до `1.0.0` ещё не считается стабильным. Для текущей ветки `0.x` принимаем правило проекта: патч для совместимых исправлений; минорная версия для новых возможностей или изменений совместимости, с явным описанием миграции. Предварительный выпуск можно назвать `0.2.0-rc.1`. После `1.0.0` несовместимое изменение публичного API требует новой мажорной версии.

Совместимость оценивается по JSON-формату, CLI и кодам завершения, диагностике, экспортируемым функциям, стабильным ID и поддерживаемому BPMN-профилю. Версия JSON-документа (`version: 1`) независима от версии npm-пакета: не меняйте её при обычном выпуске.

## 2. Согласовать метаданные, документацию и ожидания тестов

```sh
npm version "$RELEASE_VERSION" --no-git-tag-version
```

Команда обновляет версию пакета и lockfile без автоматического Git-тега. Затем обновите:

- `CHANGELOG.md`: изменения для пользователя, исправления, несовместимости и миграцию, известные ограничения.
- `README.md`: номер версии, clone tag, имя архива, URL скачивания и ожидаемый результат `version`.
- `docs/USER-GUIDE.md`: указанную версию и изменения поведения; при необходимости — руководство LLM.
- `package.json`: соответствие `engines`, bin/exports, repository/homepage/bugs фактическому выпуску.
- `tests/package.test.ts` и `tests/tracer.e2e.test.ts`: сейчас в них явно ожидается `0.1.0`; при смене версии обновите ожидания либо сначала переведите их на чтение версии пакета.

Не делайте глобальную замену номера в `package-lock.json`: такой же номер может относиться к независимой библиотеке. Не обновляйте все зависимости ради релиза; необходимые изменения lockfile проверяйте отдельно. Неподтверждённую совместимость с Windows и новые возможности в release notes не заявляйте.

## 3. Проверить кандидат и зафиксировать коммит

На каждой версии действующей матрицы Node.js выполните следующие команды. Сейчас это Node.js 24 и 26; переключайте runtime установленным менеджером и записывайте фактические версии Node/npm. При изменении `engines` пересмотрите матрицу.

```sh
node --version
npm --version
npm ci
npx playwright install chromium
npx playwright --version
npm test
npm audit
npm pack --dry-run
```

`npm test` включает сборку, TypeScript, unit, полный e2e и настоящую установку `.tgz` в пустой проект. Число тестов может расти: записывайте фактический результат, а не требуйте всегда ровно 95. Основная браузерная проверка использует Chromium Playwright; `BPMNFORGE_BROWSER_CHANNEL=chrome` — дополнительный вариант для установленного Chrome.

Проверки должны охватывать `file://` без HTTP(S)-запросов на 1440×900 и 1920×1080: этапы, описание, клавиатуру, панораму, масштаб, сетку, вызов общего процесса. Также проверяются согласованность XML/геометрии, детерминизм, безопасное содержимое/URL, диагностики с ID и сохранность прежних результатов при ошибке. Уведомления библиотек и MIT самого проекта должны быть доступны, логотип bpmn.io — полностью видимым.

Разберите ошибки и известные уязвимости до выпуска; не подменяйте это автоматическим `npm audit fix --force`. После исправления повторите затронутые проверки. Если визуальную проверку не выполняли, укажите это в отчёте.

После успешных проверок просмотрите diff и закоммитьте подготовку версии. Ниже перечислены текущие файлы с версиями; добавьте другие намеренно изменённые публичные файлы поимённо.

```sh
git diff --check
git diff --stat
git add package.json package-lock.json README.md CHANGELOG.md docs/USER-GUIDE.md tests/package.test.ts tests/tracer.e2e.test.ts
git commit -m "chore(release): prepare $RELEASE_TAG"
git status --short
RELEASE_COMMIT="$(git rev-parse HEAD)"
```

Последний `status` должен быть пустым. Дальше проверяется и выпускается именно `RELEASE_COMMIT`. Изменение исходников после этого шага создаёт нового кандидата и требует пересборки/повторной проверки.

## 4. Собрать окончательный архив из фиксированного коммита

Сборка выполняется в отдельном checkout; пакет, логи и release notes сохраняются снаружи Git-дерева. Временный каталог из `mktemp` имеет уникальное имя, чтобы не перезаписать другой выпуск.

```sh
RELEASE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bpmnforge-release.XXXXXX")"
git worktree add --detach "$RELEASE_DIR/source" "$RELEASE_COMMIT"
(
  cd "$RELEASE_DIR/source"
  test "$(node -p 'require("./package.json").version')" = "$RELEASE_VERSION"
  npm ci
  npm pack --pack-destination "$RELEASE_DIR" --json > "$RELEASE_DIR/pack.json"
)
RELEASE_ARCHIVE="$RELEASE_DIR/bpmnforge-$RELEASE_VERSION.tgz"
tar -tzf "$RELEASE_ARCHIVE"
(
  cd "$RELEASE_DIR"
  shasum -a 256 "bpmnforge-$RELEASE_VERSION.tgz" > SHA256SUMS.txt
)
```

`prepack` сам собирает CLI/viewer и уведомления библиотек. Проверьте `pack.json` и список tar: должны присутствовать bin, compiled ESM, schema, viewer, LICENSE, THIRD-PARTY-NOTICES, README, руководства и CHANGELOG. В архив не входят `.planning`, исходные/реальные процессы, `node_modules`, `.DS_Store`, тесты или локальные отчёты. Автоматическая проверка лицензий должна завершиться без ошибок.

Окончательный `.tgz` собирается один раз для выбранного коммита. Проверяйте, хешируйте и загружайте этот же файл. После любой пересборки заново проверьте пакет и запишите новый SHA-256; ранее полученный результат установки уже не подтверждает другой архив.

## 5. Проверить именно этот пакет в отдельном проекте

Используйте настоящий `npm install`, без symlink зависимостей из рабочего проекта. Имя каталога с пробелами и кириллицей проверяет поддержку таких путей.

```sh
RELEASE_CONSUMER="$RELEASE_DIR/Проект потребитель"
mkdir -p "$RELEASE_CONSUMER"
cp "$RELEASE_DIR/source/tests/fixtures/minimal.json" "$RELEASE_CONSUMER/process.bpmnforge.json"
(
  cd "$RELEASE_CONSUMER"
  printf '%s\n' '{"name":"bpmnforge-release-check","version":"1.0.0","private":true}' > package.json
  npm install "$RELEASE_ARCHIVE"
  test "$(npx --no-install bpmnforge version)" = "$RELEASE_VERSION"
  npx --no-install bpmnforge validate process.bpmnforge.json --json
  npx --no-install bpmnforge build process.bpmnforge.json
)
```

Повторите smoke-проверку CLI на обеих версиях Node. Откройте созданный HTML автономно на двух размерах экрана; сопоставьте встроенный XML с `.bpmn`. Отдельно выполните минимальный JSON и команды из README — технический fixture не проверяет точность пользовательской инструкции.

## 6. Создать тег и draft-релиз

Подготовьте `$RELEASE_DIR/release-notes.md`: краткое назначение, пользовательские изменения, установка, требования Node, совместимость/миграция, ограничения и фактически пройденные проверки. Не включайте приватные пути, внутренние материалы и непроверенные обещания.

```sh
git tag -a "$RELEASE_TAG" "$RELEASE_COMMIT" -m "BPMN Forge $RELEASE_VERSION"
git push --atomic origin refs/heads/main:refs/heads/main "refs/tags/$RELEASE_TAG:refs/tags/$RELEASE_TAG"
gh release create "$RELEASE_TAG" "$RELEASE_ARCHIVE" "$RELEASE_DIR/SHA256SUMS.txt" \
  --repo "$RELEASE_REPO" --verify-tag --draft \
  --title "BPMN Forge $RELEASE_VERSION" --notes-file "$RELEASE_DIR/release-notes.md"
gh release view "$RELEASE_TAG" --repo "$RELEASE_REPO" --json tagName,isDraft,assets
```

`--verify-tag` исключает случайное создание тега GitHub от другого коммита. Если push отклонён из-за изменений `main`, согласуйте ветку и кандидата без force push. Проверьте, что draft содержит оба файла, нужные версии/имена, правильный текст и checksum. [GitHub рекомендует](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases#best-practices-for-publishing-immutable-releases) сначала прикрепить все assets к draft, затем публиковать: это также подходит для включённой неизменности релизов.

Для обычного выпуска:

```sh
gh release edit "$RELEASE_TAG" --repo "$RELEASE_REPO" --draft=false --latest
```

Для `-rc.N`/другого prerelease создавайте draft с `--prerelease`, а публикуйте с `--draft=false --prerelease --latest=false`. Такой выпуск не должен заменять обычный latest.

## 7. Проверить опубликованный результат

```sh
RELEASE_DOWNLOAD="$RELEASE_DIR/download"
mkdir -p "$RELEASE_DOWNLOAD"
(
  cd "$RELEASE_DOWNLOAD"
  curl --fail --location --output "bpmnforge-$RELEASE_VERSION.tgz" \
    "$RELEASE_BASE_URL/releases/download/$RELEASE_TAG/bpmnforge-$RELEASE_VERSION.tgz"
  curl --fail --location --output SHA256SUMS.txt \
    "$RELEASE_BASE_URL/releases/download/$RELEASE_TAG/SHA256SUMS.txt"
  shasum -a 256 -c SHA256SUMS.txt
)
cmp "$RELEASE_ARCHIVE" "$RELEASE_DOWNLOAD/bpmnforge-$RELEASE_VERSION.tgz"
git ls-remote --heads --tags origin
gh release view "$RELEASE_TAG" --repo "$RELEASE_REPO" --json url,tagName,isDraft,isPrerelease,assets
```

Повторите установку из шага 5 в новом пустом проекте, передав **скачанный** архив. После этого проверьте опубликованный тег из свежего clone: `npm ci`, сборку/тесты и README. Сверьте remote main/tag с выбранными коммитами, статус latest/prerelease, доступность скачивания без авторизации и отсутствие приватных материалов в новых коммитах и assets.

Для пользовательской инструкции применяйте `curl` → `npm install ./архив.tgz`: [npm 12 по умолчанию отключает установку удалённых URL](https://docs.npmjs.com/cli/v12/using-npm/config/#allow-remote), поэтому прямой `npm install https://…tgz` может дать `EALLOWREMOTE`. Не меняйте глобальную конфигурацию npm ради инструкции.

SHA-256 подтверждает совпадение байтов с выбранным checksum. При включённых immutable releases с аттестацией GitHub можно дополнительно использовать `gh release verify "$RELEASE_TAG" --repo "$RELEASE_REPO"` и `gh release verify-asset "$RELEASE_TAG" "$RELEASE_DOWNLOAD/bpmnforge-$RELEASE_VERSION.tgz" --repo "$RELEASE_REPO"`; наличие аттестации нужно проверить, а не предполагать.

Сохраните вне публичного пакета отчёт: версия и commit/tag SHA, Node/npm/Playwright/браузер/ОС, результаты тестов/audit, состав архива, SHA-256, URL релиза и результат проверки скачанного пакета. Только после проверки удаляйте временные checkout/проекты; сохраните архив и доказательства проверки.

## 8. Ошибка, прерывание или исправление после публикации

| Ситуация | Действие |
| --- | --- |
| Сбой до отправки тега | Исправить кандидат, повторить затронутые проверки, пересобрать и заново проверить окончательный архив |
| Тег уже отправлен, есть только draft | Сверить тег/commit, готовые assets и checksum; продолжить существующий draft вместо слепого повторения create |
| Загружен неверный пакет или найден дефект в опубликованном коде | Выпустить следующую версию с исправлением и новой контрольной суммой |
| Ошибка только в веб-инструкции/тексте release notes | Исправить main README и release notes; записать, что тег и архив сохранены. Если исправление должно войти в поставляемые файлы, выпустить новую версию |
| Следующий выпуск задержан | Предыдущий исправный релиз остаётся доступным; опубликовать описание проблемы и ссылку на исправление при необходимости |

После публикации не перемещайте/не переиспользуйте тег, не заменяйте `.tgz` или checksum под тем же номером и не используйте `upload --clobber` для опубликованного пакета. Исправление сборки — новая версия. При возобновлении работы сначала прочитайте фактическое состояние GitHub через `gh release view` и `git ls-remote`; не делайте повторный create/push на основании старого локального отчёта.

## Источники и границы

- [SemVer](https://semver.org/lang/ru/) — смысл версий и неизменность опубликованного содержимого.
- [npm version](https://docs.npmjs.com/cli/v11/commands/npm-version/) и [npm pack](https://docs.npmjs.com/cli/v11/commands/npm-pack/) — обновление версии и упаковка.
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases), [gh release create](https://cli.github.com/manual/gh_release_create), [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases) — теги, draft, assets и аттестации.

Инструкция не включает настройку GitHub Actions, публикацию в npm registry, новые бизнес-примеры или заявление о поддержке Windows. Эти изменения требуют собственного объёма работ и проверки.
