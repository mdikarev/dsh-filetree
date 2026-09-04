# Glossary

## How to use
<!-- Explain how canonical terms should be applied. -->

## Terms
### Панель дерева
Шторка-панель шириной 300px слева от контента, открываемая вкладкой-ручкой; показывает дерево каталогов текущего воркспейса (src/Panel.tsx, src/Tree.tsx).

### ToggleTab (вкладка-ручка)
Вертикальная вкладка 24×64px у правого края сайдбара; `▶` открывает панель, `◀` закрывает (src/ToggleTab.tsx).

### Док-панель предпросмотра
Плавающая панель справа поверх чата с содержимым текстового файла; перетаскивается за шапку, ресайзится, позиция и размер хранятся по воркспейсу (src/Panel.tsx).

### Git-бейдж
Пилюля на строке дерева со статусом файла/папки: `M` modified, `A` added, `D` deleted, `?` untracked, `I` ignored; для папок — `•`.

### git-changed (SSE-событие)
Событие, которое сервер шлёт при изменении git-метаданных воркспейса (`.git/index`, `.git/HEAD`, refs): клиент перечитывает наблюдаемые каталоги, чтобы обновить git-бейджи без ручного ↻.

### Кэш git-статуса
Per-handler серверный кэш снапшота git status --ignored по корню воркспейса: переиспользование в пределах TTL (2 с), dirty-инвалидация событиями (git-changed и fs-события воркспейса), один in-flight прогон на root, LRU 8 (src/git-status-cache.ts, fs-api/fs-events).

### Heartbeat (SSE event: ping)
Периодический (раз в 10 с) служебный SSE-блок, который сервер шлёт живому соединению events; клиентский watchdog сбрасывает по нему таймер бездействия (src/fs-events.ts, SSE_HEARTBEAT_MS).

### Inactivity-watchdog
Клиентский таймер (30 с) в координаторе живого обновления: любая активность (open/changed/git-changed/ping) его сбрасывает; тишина дольше порога трактуется как сбой и переводит на reconnect + polling fallback с баннером (src/live-refresh.ts, LIVE_REFRESH_INACTIVITY_MS).

### Локализация (l10n)
Локальная схема UI-строк плагина: типобезопасные словари en (по умолчанию) и ru; язык из localStorage fm-locale либо ru-subtag navigator.language, переключение на лету (src/l10n.ts, src/use-l10n.ts).

### Тултип полного имени
Всплывающая подсказка с полным именем, показываемая при наведении на строку дерева, чьё имя обрезано многоточием; рендерится на body, появляется через ~400 мс (src/tooltip.ts).

### Композер (поле ввода чата)
Поле ввода DeepSeek Harness Web GUI — карточка с data-атрибутом `data-composer-card`; контролируется per-session input machine, доступной плагинам через сервис `conversation` (`ctx.conversation.input.shell(sessionId)`). Drag-and-drop строк дерева вставляет `@`-упоминание пути именно сюда (src/drag-drop.ts).

### Capability-токен (cap)
Случайный 256-битный (32 байта hex) токен, выдаваемый `GET /filemanager-fs/cap` (header-гейт) на workspace-hint; TTL 8 ч, ротация на каждом issue. Авторизует `GET /filemanager-fs/raw` — единственный эндпоинт без header, т.к. plain `<img>` не может слать заголовки (src/capabilities.ts).

### Raw-URL (/filemanager-fs/raw)
URL изображения с query `hint/path/cap`: `/filemanager-fs/raw?hint=<enc>&path=<enc>&cap=<enc>[&v=<n>]`. Билдер — `buildRawFileUrl` (src/raw-url.ts); `v` форсирует перезагрузку после «Обновить» на confirmation banner.

### Preview kind
Классификация файла при клике в дереве: `image` | `markdown` | `json` | `text` (src/preview-kind.ts, `classifyPreviewKind`). image-расширения: png/jpg/jpeg/gif/webp/avif/svg (без учёта регистра).

### JSON-режим (jsonMode)
Режим показа `.json` в доке: `raw` (исходный текст) или `pretty` (форматированный с отступом 2 + подсветка); по умолчанию `pretty`, хранится per-workspace в localStorage (src/store.ts), решения — `formatJson` (src/json-view.ts).

### Контекстное меню строки
Меню на строке дерева (правый клик или Menu/Shift+F10): `role="menu"`/`menuitem`, пока с одной командой «Удалить…»; каркас переиспользуем для будущих команд (src/ContextMenu.tsx).

### Диалог подтверждения удаления
Инлайн `alertdialog` с полным путём, предупреждением о незакоммиченных изменениях и кнопками «Отмена»/«Удалить»; фокус по умолчанию на «Отмена», Esc закрывает диалог, а не док предпросмотра (src/ConfirmDeleteDialog.tsx).

### uncommitted-предупреждение
Флаг `uncommitted` из `GET /filemanager-fs/delete-info`: удаляемый файл (или любой существующий потомок папки) имеет git-статус modified/added/untracked (ignored не считаются) — при удалении эти изменения будут потеряны.

## Naming conventions
<!-- Record project-wide naming rules. -->

## Related canon
<!-- Point to related canon sections. -->