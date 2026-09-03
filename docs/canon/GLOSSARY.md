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

## Naming conventions
<!-- Record project-wide naming rules. -->

## Related canon
<!-- Point to related canon sections. -->