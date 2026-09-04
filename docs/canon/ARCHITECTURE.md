# Architecture

## Summary
Плагин состоит из серверной части (FS API) и клиентской части (UI-компоненты). FS API предоставляет `/filemanager-fs/root`, `/filemanager-fs/list`, `/filemanager-fs/read` для чтения текстовых файлов (до 5 МБ) и SSE-endpoint `/filemanager-fs/events` для живого обновления раскрытых каталогов.
Клиент реализует дерево файлов, док-панель предпросмотра справа от панели дерева и автообновление дерева через SSE с polling fallback.
Живое обновление усилено: серверный кэш git-статуса (TTL + инвалидация), SSE-heartbeat и клиентский inactivity-watchdog (зависшее соединение деградирует в polling с баннером). UI локализован (en по умолчанию, ru сохраняется) и имеет базовую доступность (роли дерева, клавиатура, Esc-закрытие предпросмотра) и тултип полного имени для обрезанных строк.
Предпросмотр охватывает изображения (raster png/jpeg/gif/webp/avif и svg) и форматированный JSON; локальные изображения внутри Markdown рендерятся инлайн. Обслуживание изображений: `GET /filemanager-fs/cap` (header-гейт, выдаёт per-workspace capability-токен) и `GET /filemanager-fs/raw` — единственный эндпоинт без header, авторизуется capability-токеном (plain `<img>` не может слать header).

## System context
- DSH Web shell: предоставляет слоты и контекст воркспейсов/сессий
- Рабочая директория воркспейса: границы доступа определены хинтом и проверкой "внутри корня"

## Building blocks
- FS API (src/fs-api.ts): обработчик HTTP `createHandler(defaultRoot, options?)` с экшенами `root`, `list`, `read`, `events` (SSE), `cap` и `raw`. Опция `gitStatusCache` (тип `GitStatusCache = SnapshotCache<GitEntry>`) позволяет впрыснуть кэш в тестах; по умолчанию создаётся per-handler кэш с коллектором `runGitStatus`. Опция `capabilities` (тип `CapabilityIssuer`) впрыскивает issuer в тестах; по умолчанию per-handler `createCapabilityIssuer()`. В `list` git-карта берётся через `gitCache.get(root)` (см. кэш ниже), `debugCollectStatuses` остаётся без кэша. Header-гейт `x-dsh-filemanager: 1` применяется ко всем экшенам, кроме `raw` (см. Public interfaces).
- События файловой системы (src/fs-events.ts): SSE-endpoint `GET /filemanager-fs/events` — парсинг и валидация `paths`, жизненный цикл `fs.watch` (watcher-ы создаются только после валидации всех путей и освобождаются при disconnect/ошибке соединения),
   нормализация событий в `{ type: "changed", path, kind }` с фильтрацией содержимого `.git`; отдельные watcher-ы на git-метаданные (каталог `.git/` и `.git/refs/heads`, если есть)
   эмитят событие `{ type: "git-changed" }` при изменении `index`/`HEAD`/refs. Сигнатура: `createEventsHandler(defaultRoot, gitCache?, opts?: { heartbeatMs? })` — опциональный gitCache
   инвалидирует кэш git-статуса (см. ниже) на git-метаданные и нормализованные fs-события воркспейса; сервер шлёт heartbeat-блок `event: ping` каждые `SSE_HEARTBEAT_MS` (10 с, инъекция через `opts.heartbeatMs`), интервал гасится в dispose.
- Кэш git-статуса (src/git-status-cache.ts): generic per-root snapshot cache (`createGitStatusCache<V>({ collect, ttlMs?, maxRoots?, now? })`, `SnapshotCache<V>` с `get/invalidate/stats`); дефолты `DEFAULT_TTL_MS` = 2000 мс и `DEFAULT_MAX_ROOTS` = 8. `get(root)` переиспользует свежий (!dirty и TTL) снапшот, иначе — один общий in-flight прогон; `invalidate` только ставит dirty-флаг; сбой коллектора даёт пустой снапшот с dirty (листинг не падает); LRU-эвикция по lastAccess.
- Capability-токены (src/capabilities.ts): `createCapabilityIssuer({ now?, randomToken?, ttlMs? })` → `{ issueFor(hint): string, isValid(hint, token): boolean }`; токен — 32 случайных байта hex на hint, TTL `DEFAULT_CAP_TTL_MS` = 8 ч, ротация при каждом `issueFor`, сравнение constant-time (`timingSafeEqual`).
- Типы изображений (src/image-types.ts): `detectImageType(header)` по magic-байтам (png/jpeg/gif/webp/avif, до 32 байт) → `{ kind: "raster", mime }`; `looksLikeSvg(sample)` — текстовый пробник первых 4 КБ (svg) → `{ kind: "svg", mime: "image/svg+xml" }`; лимиты `MAX_IMAGE_BYTES` = 20 МБ (raster) и `MAX_SVG_BYTES` = 2 МБ.
- API клиент (src/api.ts): функции `fetchRoot`, `fetchList`, `fetchFile` и новая `buildEventsUrl(hint, paths)` — URL-encoding hint и JSON-массива `paths`.
- Координация живого обновления (src/live-refresh.ts): чистые хелперы `parentDirectory`, `affectedExpandedDirectories`, trailing-edge debounce (250 мс) с объединением по пути, безопасный `parseSseChange` и `createLiveRefreshCoordinator` (один SSE-транспорт, reconnect с backoff, targeted invalidation, polling fallback).
   Inactivity-watchdog: `LIVE_REFRESH_INACTIVITY_MS` = 30 с (опция `inactivityMs`); активность (open/changed/git-changed/ping) сбрасывает таймер, тишина дольше порога запускает error-путь (closeSource + reconnect + polling + onError). `setHint` останавливает poller и переподключает SSE; события устаревшего источника отбрасываются по epoch.
- SSE-клиент (src/sse-client.ts): fetch-based SSE-транспорт для `events`-эндпоинта — нативный EventSource не может отправить обязательный security-header `x-dsh-filemanager: 1` и потому всегда получал 403, поэтому клиент стримит тот же фрейминг через `fetch` и зеркалирует минимальную поверхность EventSource (`open`, именованные события, `error`, `close()` через AbortController); reconnect и backoff остаются у координатора.
- Polling fallback (src/live-polling.ts): стабильные снапшоты раскрытых каталогов (имена/тип/размер/mtime), детекция изменений и опрос раз в 5 секунд через тот же `refreshDirs`.
- UI (клиент):
  - ToggleTab (src/ToggleTab.tsx): вертикальная вкладка-ручка 24×64px у правого края сайдбара, по вертикали на 1/3 высоты окна; иконка `▶` (закрыта) / `◀` (открыта); семантика кнопки: `role="button"`, `tabIndex 0`, `aria-expanded`, Enter/Space как клик; надписи из локализации (см. i18n); клик открывает/закрывает панель; позиция отслеживает ширину сайдбара (ResizeObserver), при открытой панели вкладка сдвигается к её правому краю.
  - Panel (src/Panel.tsx): шторка-док 300px слева от контента (z-index 99, слот shell.overlay); шапка с именем корня (или локализованным «Файлы»/Files) и кнопками ↻ (обновить) и ✕ (закрыть); состояния: загрузка, ошибка («Повторить»/Retry), нет воркспейса, готово (дерево);
    владеет жизненным циклом координатора живого обновления: один coordinator на открытую панель, смена hint уходит через `coordinator.setHint` (зависимые колбэки стабильны, `listDir` читает актуальный hint через ref; `store.setWorkspace` синхронно нотифицирует expanded-подписчиков, чтобы setHint никогда не наблюдал каталоги старого воркспейса); polling fallback со статус-баннером; confirmation banner для изменённого на диске preview.
    Окно предпросмотра — диалог: `role="dialog"` + `aria-label` с именем файла, закрывается по Escape.
  - Tree (src/Tree.tsx): дерево каталогов; папки первыми, затем по алфавиту без учёта регистра; ленивая загрузка детей при раскрытии; состояние раскрытия хранится по воркспейсу; клик по файлу открывает предпросмотр;
    раскрытые каталоги регистрируют reloader для targeted invalidation (`refreshPaths`), при размонтировании узла (например, после удаления каталога) reloader вычищается из реестра.
    Доступность (L1): контейнер `role="tree"` + `aria-label` (имя корня), строки `role="treeitem"` с `aria-level` и `aria-expanded` у папок, клавиатура (стрелки/Home/End через чистый `treeNavStep` из src/tree-nav.ts, Enter/Space — действие, ArrowRight/Left — раскрытие/сворачивание папки).
  - Тултип полного имени (src/tooltip.ts): при наведении на строку с обрезанным именем (scrollWidth > clientWidth) через ~400 мс у курсора показывается тематический тултип с полным именем; рендерится на `body` (панель transform/clip режет fixed-потомков), flip у краёв экрана (`computeTooltipPlacement`), скрывается на leave/click/drag/scroll.
  - Локализация (src/l10n.ts + src/use-l10n.ts): типобезопасные словари en (источник истины, default) и ru (`Record<L10nKey, string>`); `detectLocale(navigatorLanguage, stored)` — localStorage `fm-locale` → ru-subtag → en; store с `setLocale`/`subscribeLocale`/`getLocale` и `attachBrowserLocaleSync` (initBrowserLocale + синхронизация между вкладками); UI-копия берётся через хук `useL10n().t`. По умолчанию в Node — en (детерминизм), браузерная локаль применяется при attach.
  - Tree (src/Tree.tsx): дерево каталогов; папки первыми, затем по алфавиту без учёта регистра; ленивая загрузка детей при раскрытии; состояние раскрытия хранится по воркспейсу; клик по файлу открывает предпросмотр;
    раскрытые каталоги регистрируют reloader для targeted invalidation (`refreshPaths`), при размонтировании узла (например, после удаления каталога) reloader вычищается из реестра.
  - Док-панель предпросмотра (см. Key flows) с перетаскиванием за шапку, ресайзом и прокруткой; клиентская подсветка highlight.js для TypeScript, JavaScript, Python, Go, C#, Rust и JSON. Для Markdown-файлов она также предоставляет переключатель режимов «Исходник»/«Предпросмотр» и клиентский безопасный renderer. Открытие маршрутизируется по preview-kind (src/preview-kind.ts, `classifyPreviewKind(name)` → `image`/`markdown`/`json`/`text`):
  - image-вьюер (src/ImageView.tsx + чистый zoom-редуктор src/image-view.ts): fit + зум кнопками тулбара и двойным кликом (100%/fit, clamp 0.1–8×); колесо мыши не перехватывается (зум колесом отсутствует — нативное поведение страницы сохраняется); размеры в тулбаре, «открыть оригинал» (raw-URL в новой вкладке), шахматная подложка через DSH-токены;
  - capability-кэш (src/caps.ts, `capCache.getCap/invalidate`, мемоизация по hint) и сборка raw-URL (src/raw-url.ts, `buildRawFileUrl(hint, path, cap, version?)`);
  - JSON pretty (src/json-view.ts: `isJsonFile`, `formatJson(content, mode, truncated)` → `{ text, note: "parse" | "too-large" | null }`; `jsonMode` ("raw"|"pretty", default "pretty") хранится per-workspace в store);
  - markdown-изображения: `renderMarkdown` принимает опциональный `resourceUrl`-билдер; `rawMarkdownImageUrl(hint, markdownPath, resource, cap)` — тот же path-validation, что у `workspaceResourceUrl`; `fetchCap` (src/preview-api.ts) → GET /filemanager-fs/cap.
  - Drag-drop вставка пути (src/drag-drop.ts): строки дерева перетаскиваемы (кастомный MIME `application/x-dsh-filemanager` с payload `{ path, kind }` и fallback `text/plain`); document-level слушатели `dragover`/`drop` (capture) перехватывают дроп только когда payload содержит кастомный MIME и цель внутри композера (`[data-composer-card]`); вставка через `conversation.input.shell(sessionId).setDraft(next, editRange)` с восстановлением каретки.

## Key flows
### Предпросмотр файла (текстового)
1. Пользователь кликает по файлу в дереве — вызывается `onOpenFile(fullPath)`.
2. Клиент выполняет `GET /filemanager-fs/read?hint=<workspace>&path=<rel>`.
3. Сервер проверяет, что путь внутри воркспейса, файл существует и считается текстовым (см. Failure modes).
4. Сервер читает до 5 МБ содержимого, возвращает JSON: `{ name, path, content, truncated }`.
5. Клиент показывает док-панель справа: шапка (имя файла, ✕) служит и ручкой перетаскивания; тело — текст в моноширинном шрифте; для поддерживаемых языков клиент применяет highlight.js, определяя язык по расширению/имени файла и первой строке/shebang. Панель поддерживает ресайз, прокрутку и перетаскивание за шапку по экрану.
6. Для неизвестного языка, ошибки highlight.js, усечённого содержимого (`truncated`) или файла сверх поддерживаемого лимита клиент оставляет содержимое обычным моноширинным текстом; ошибка чтения по-прежнему показывается как ошибка предпросмотра.

### Markdown preview
1. Имя файла с расширением `.md` без учёта регистра включает переключатель «Исходник»/«Предпросмотр»; для остальных файлов DOM и поведение предпросмотра не меняются.
2. Режим «Исходник» является режимом по умолчанию и использует существующий моноширинный вывод; выбранный режим сохраняется в `localStorage` с областью действия текущего workspace и восстанавливается при открытии другого Markdown-файла.
3. Режим «Предпросмотр» рендерит уже загруженный текст на клиенте через специализированный безопасный Markdown renderer. HTML не исполняется, а `javascript:`, `data:` и другие опасные URL-схемы запрещаются.
4. Относительные ссылки и изображения разрешаются относительно директории Markdown-файла только внутри корня текущего workspace. Безопасные локальные относительные изображения рендерятся инлайн: renderer получает `resourceUrl`-билдер (cap + `/filemanager-fs/raw`), а src проходит ту же path-валидацию (`resolveWorkspaceResource`), что и ссылки; упавшее изображение скрывается capture-обработчиком ошибок контейнера (`onErrorCapture`) без падения документа. Внешние текстовые ссылки разрешены и открываются в новой вкладке; внешние изображения не загружаются. Ресурс вне корня или с опасной схемой блокируется и не ломает документ.
5. При `truncated: true` доступное начало рендерится, а поверх содержимого показывается заметное предупреждение о частичном просмотре. Усечение не является ошибкой. Ошибка renderer-а показывается в панели, но пользователь может вернуться к исходному тексту.

### Предпросмотр изображения
1. Пользователь кликает по файлу с image-расширением (png/jpg/jpeg/gif/webp/avif/svg, без учёта регистра) — `classifyPreviewKind` возвращает `image`, и `fetchFile` (`/read`) не вызывается.
2. Клиент берёт capability-токен текущего workspace: `capCache.getCap(hint)` → `GET /filemanager-fs/cap?hint=` (header-гейт; результат мемоизируется, `invalidate` при смене workspace или ошибке).
3. Клиент открывает ту же док-панель и рендерит `<img src="/filemanager-fs/raw?hint=&path=&cap=">` (buildRawFileUrl, опционально `v` для принудительной перезагрузки). Сервер валидирует cap, containment (realpath + isInside), определяет тип по magic-байтам/`looksLikeSvg` и стримит файл с `content-type`/`content-length`/`no-store`/`nosniff`; для svg добавляется `content-security-policy: sandbox`.
4. Вьюер: изображение вписывается по размеру панели; кнопки тулбара меняют масштаб (clamp 0.1–8×, шаг 1.25), двойной клик переключает 100%/fit; колесо мыши не перехватывается (зум колесом не предусмотрен — скролл и нативный Ctrl+колесо страницы сохраняются); после загрузки показываются натуральные размеры; «открыть оригинал» открывает raw-URL в новой вкладке. Ошибка загрузки показывает сообщение с кнопкой повтора (смена `v`).
5. Confirmation banner «Файл изменён на диске» работает и для изображений: «Обновить» увеличивает `v` (новый URL → перезагрузка, сервер отдаёт свежие байты, no-store).
6. Смена workspace с открытым изображением: cap старого hint инвалидируется, запрашивается новый, `v` увеличивается — изображение старого воркспейса не показывается.
7. Не-изображение на /raw (415), невалидный/протухший cap (403), выход за корень (403/404) и превышение лимита (413) показываются как локализованная ошибка предпросмотра.

### Форматированный JSON (pretty)
1. Для файлов `.json` (без учёта регистра) `classifyPreviewKind` возвращает `json`; контент читается через `/read` как текст (до 5 МБ, `truncated`).
2. Режим по умолчанию — `pretty`: `formatJson` парсит и переформатирует с отступом 2 (затем подсветка highlight.js языка json), если файл не усечён и длина ≤ 1 МБ (`JSON_PRETTY_MAX_CHARS`). Невалидный JSON → raw-текст + пометка «parse»; слишком большой/усечённый → raw-текст (пометка «too-large» только для лимита, усечение объясняет общий баннер).
3. В шапке дока переключатель Raw/Formatted (группа с `aria-label`, кнопки с `aria-pressed`); выбор `jsonMode` сохраняется per-workspace (localStorage, как `previewMode`).

### Живое обновление дерева (SSE и polling fallback)
1. Открытая панель создаёт SSE-подписку `GET /filemanager-fs/events?hint=<workspace>&paths=<url-encoded JSON array>`. `paths` — относительные posix-пути раскрытых каталогов из store; корень workspace (пустая строка `""`) всегда включается в подписку, поэтому верхнеуровневые create/delete/rename обновляют корневой список. Наблюдаются только эти каталоги, не весь workspace.
2. Сервер требует header `x-dsh-filemanager: 1` и строгий hint: `hint` обязателен и должен быть валидным каталогом, иначе подписка отклоняется (400) — fallback на default root для events отсутствует (в отличие от root/list/read). Затем валидируется каждый путь (`realpath` + `isInside` + каталог, не `.git`) до создания любого watcher.
   Любой некорректный путь отклоняет всю подписку (400/403/404) без единого watcher-а — fallback на подмножество валидных путей не выполняется.
   Сервер также шлёт heartbeat-блок `event: ping` каждые 10 с (`SSE_HEARTBEAT_MS`), пока соединение живо.
   Сервер также шлёт heartbeat-блок `event: ping` каждые 10 с (`SSE_HEARTBEAT_MS`), пока соединение живо.
3. Серверный `fs.watch` регистрируется на каждый провалидированный каталог. Сырые события нормализуются в `{ "type": "changed", "path": "<отн. posix-путь>", "kind": "rename" | "change" }` и отправляются блоками `event: changed` + `data: <json>`;
   события за пределами workspace и содержимое `.git` как `changed` не доставляются. Дополнительно сервер наблюдает git-метаданные корня (каталог `.git/` и `.git/refs/heads`, если они есть) и при изменении `index`/`HEAD`/refs отправляет блок `event: git-changed` + `data: { "type": "git-changed" }`; git-changed и нормализованные fs-события инвалидируют per-handler кэш git-статуса (следующий листинг пересчитает). Все watcher-ы соединения (рабочие каталоги и git-метаданные) освобождаются при закрытии/ошибке SSE-ответа (disconnect).
4. Координатор клиента держит ровно один SSE-транспорт (fetch-based клиент из `src/sse-client.ts`, зеркалирующий поверхность EventSource; нативный EventSource не может отправить обязательный header `x-dsh-filemanager: 1`), ключевой по hint и набору раскрытых путей; смена workspace или набора путей закрывает старое соединение до создания нового; события из устаревшего (старого workspace / перезапущенного) источника отбрасываются по epoch; смена hint обрабатывается на том же coordinator через `setHint` без пересоздания. Активность (open/changed/git-changed/ping) сбрасывает inactivity-watchdog (30 с); тишина дольше порога трактуется как сбой: источник закрывается, включаются reconnect с backoff и polling fallback.
5. События попадают в trailing-edge debounce 250 мс с объединением по пути (повторное событие заменяет kind). После окна батч направляется в targeted invalidation: `fetchList` повторно вызывается только для затронутых раскрытых каталогов (для root-уровневых изменений — корень);
   изменения внутри закрытых каталогов фоновых запросов не вызывают. Раскрытие узлов, состояние предпросмотра и режим Markdown сохраняются. Событие `git-changed` (git-операции: commit/stage/checkout) не попадает в файловый debounce: клиент с тем же trailing-edge окном 250 мс перечитывает ВСЕ наблюдаемые каталоги (корень + раскрытые), чтобы обновить git-бейджи; confirmation banner для preview при этом не триггерится.
6. Если текущий preview-файл затронут событием, содержимое не перезагружается молча: в панели показывается confirmation banner «Файл изменён на диске» с кнопками «Обновить» и «Оставить текущую версию».
   «Обновить» повторяет `fetchFile` и скрывает баннер только после успешной загрузки; «Оставить текущую версию» скрывает баннер до следующего события для этого файла. Для Markdown сохраняется выбранный режим «Исходник»/«Предпросмотр».
7. При ошибке SSE-соединения (событие `error`) клиент закрывает источник, переподключается с экспоненциальным backoff (база 500 мс, кап 10 с) и включает polling fallback: перечисление раскрытых каталогов и корня раз в 5 секунд, сравнение снапшотов (имена/тип/размер/mtime) и инвалидация только изменившихся каталогов через тот же `refreshDirs`;
   успешный reconnect останавливает polling, панель показывает статус «Автообновление: опрос каталогов (SSE недоступен)».
8. При закрытии панели, смене workspace или остановке координатора закрываются SSE-соединение, watcher-ы (через disconnect), debounce и polling-таймеры; дубликаты подписок не создаются, ручной ↻ продолжает работать.

### Панель дерева: открытие, работа, внешний вид
1. Клик по вкладке-ручке (`▶`) открывает панель; шторка 300px выезжает слева поверх контента, вкладка становится `◀` и сдвигается к правому краю панели.
2. Панель загружает корень воркспейса (`/filemanager-fs/root`) и список (`/filemanager-fs/list`); при смене воркспейса перезагружается.
3. Строки дерева: шеврон (`▸`/`▾`) и эмодзи-папка (`📁`/`📂`) для каталогов, CSS-иконка файла с цветом по типу (code/data/doc/image/special/default), имя, git-бейдж (`M`/`A`/`D`/`?`/`I`, для папок `•`), спиннер при загрузке.
4. Раскрытие папки лениво загружает детей; раскрытые пути сохраняются в localStorage по воркспейсу.
5. Клик по файлу открывает предпросмотр (см. выше); пустая папка показывает «Пустая папка»; ошибки загрузки показываются в состоянии панели.
6. Кнопка ↻ перезагружает корень; ✕ или вкладка `◀` закрывают панель.

Внешний вид: панель 300px с градиентным фоном, правой границей и тенью; тема из DSH-токенов (авто светлая/тёмная); токены подсветки highlight.js также используют DSH-токены в светлой и тёмной темах; строки 13px со скруглением и hover-подсветкой для каталогов; ignored-строки приглушены.

Ограничение подсветки: highlight.js относит распространённые ключевые слова, включая `if`/`export`/`const`, к общему классу `hljs-keyword`, поэтому они намеренно используют один акцентный цвет; более тонкое семантическое различение категорий ключевых слов не входит в текущую реализацию.

### Вставка пути в поле ввода (drag-and-drop)
1. Пользователь перетаскивает строку дерева (файл или папку) в область поля ввода чата. `dragstart` кладёт в `dataTransfer` кастомный тип `application/x-dsh-filemanager` (JSON `{ path, kind }` — относительный posix-путь и вид) и `text/plain` (текст упоминания) как fallback.
2. Document-level слушатели (capture) видят `dragover`/`drop`. Они действуют только если `dataTransfer.types` содержит кастомный MIME и цель события находится внутри карточки композера (`closest('[data-composer-card]')`); иначе событие не трогается — дроп OS-файлов остаётся у image drop zone ui-attachment (реагирует только на `Files`).
3. `dragover` вызывает `preventDefault()` и `dropEffect = 'copy'` (разрешает дроп); карточка получает класс-подсветку.
4. `drop` вызывает `preventDefault()`: читается payload, определяется текущая сессия (`ctx.sessions`), резолвится шелл ввода `ctx.conversation.input.shell(sessionId)`, снимается снапшот состояния (draft, draftRev, phase). Каретка берётся из `textarea.selectionStart/End` (браузер ставит её в точку дропа до события `drop`).
5. Строится упоминание: файл — `@path`, папка — `@path/`, пробелы — `@"path"`; путь с управляющими символами или кавычками не вставляется.
6. Вставка идёт через единственный путь записи машины: `setDraft(draft.slice(0, start) + mention + draft.slice(end), { start, end, insertedLength: mention.length })`; каретка восстанавливается в `start + mention.length` (как в родном paste-хендлере композера). Дроп при фазе `submitting`/`adjudicating` или отсутствии сессии/шелла игнорируется.

## Public interfaces
### GET /filemanager-fs/read
Query:
- `hint`: строка (путь воркспейса)
- `path`: относительный путь к файлу

Response (200):
`{ name: string, path: string, content: string, truncated?: boolean }`

Ошибки:
- 403 `{ error: "path escapes workspace" }`
- 404 `{ error: "not found" }`
- 400 `{ error: "not a file" }` или `{ error: "unsupported content type" }`
- 500 `{ error: string }`

### GET /filemanager-fs/cap
Выдача capability-токена для workspace (используется `/raw`; plain `<img>` не может слать header, поэтому токен передаётся query-параметром).

Query:
- `hint`: строка (путь воркспейса)

Header: `x-dsh-filemanager: 1` обязателен.

Response (200): `{ "cap": string }` — 32 случайных байта hex; токен per-hint, TTL `DEFAULT_CAP_TTL_MS` = 8 ч, каждый новый запрос ротирует предыдущий (валиден только последний).

Ошибки:
- 403 `{ error: "missing x-dsh-filemanager header" }`
- 500 `{ error: string }`

### GET /filemanager-fs/raw
Стриминг байтов изображения. Единственный эндпоинт, НЕ требующий header `x-dsh-filemanager` — вместо него обязателен валидный capability-токен для этого hint.

Query:
- `hint`: строка (путь воркспейса)
- `path`: относительный путь к файлу-изображению
- `cap`: capability-токен (из `/cap`)

Response (200): тело файла; заголовки `content-type` (по magic-байтам: png/jpeg/gif/webp/avif; svg — по текстовому пробнику с mime `image/svg+xml`), `content-length`, `cache-control: no-store`, `x-content-type-options: nosniff`; для svg дополнительно `content-security-policy: sandbox` (нейтрализует скрипты при открытии svg top-level в origin dsh).

Ошибки:
- 403 `{ error: "invalid or expired capability" }` | `{ error: "path escapes workspace" }`
- 404 `{ error: "not found" }`
- 400 `{ error: "not a file" }`
- 415 `{ error: "unsupported content type" }` (не изображение)
- 413 `{ error: "image too large" }` (raster > 20 МБ, svg > 2 МБ)
- 500 `{ error: string }`

### GET /filemanager-fs/events
SSE-подписка на изменения раскрытых каталогов (живое обновление дерева).

Query:
- `hint`: строка (путь воркспейса); обязателен и должен быть валидным каталогом — несуществующий путь или файл отклоняет подписку (400), fallback на default root отсутствует
- `paths`: URL-encoded JSON-массив относительных posix-путей раскрытых каталогов; корень workspace — пустая строка `""` (всегда включается клиентом); отсутствующий или пустой параметр означает «не наблюдать ничего»

Header: `x-dsh-filemanager: 1` обязателен.

Response (200): `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`; каждый normalized event — блок `event: changed` + `data: { "type": "changed", "path": "<отн. posix-путь>", "kind": "rename" | "change" }`; периодически (по умолчанию раз в 10 с) сервер шлёт блок `event: ping` + `data: {}` — heartbeat для клиентского watchdog (старые клиенты игнорируют неизвестное событие).
Путь внутри `.git` или за пределами workspace не отправляется. При изменении git-метаданных (`index`/`HEAD`/refs) отправляется блок `event: git-changed` + `data: { "type": "git-changed" }` — клиент перечитывает наблюдаемые каталоги для обновления git-бейджей (и сервер инвалидирует кэш git-статуса).
При disconnect все watcher-ы соединения (рабочие каталоги и git-метаданные) и heartbeat-интервал освобождаются.

Ошибки:
- 403 `{ error: "missing x-dsh-filemanager header" }`
- 400 `{ error: "hint is required" | "invalid hint: ..." | "invalid hint (not a directory): ..." }`
- 400 `{ error: "paths must be a JSON array" | "paths entries must be strings" | "backslash path is not allowed: ..." | "path contains a NUL byte" | "absolute path is not allowed: ..." | "traversal path is not allowed: ..." | "not a directory: ..." }`
- 403 `{ error: "path escapes workspace: ..." }`
- 404 `{ error: "path does not exist: ..." }`
- 500 `{ error: string }`

### Клиентский API
- `fetchFile(hint, path): Promise<{ name, path, content, truncated?: boolean }>`
- `fetchCap(hint): Promise<string>` — GET /filemanager-fs/cap (header-гейт) → cap
- `capCache` (src/caps.ts): `getCap(hint)`, `invalidate(hint)` — мемоизация по hint, сброс при смене workspace/ошибке
- `buildRawFileUrl(hint, path, cap, version?): string` — `/filemanager-fs/raw?hint=<enc>&path=<enc>&cap=<enc>[&v=<n>]`
- `classifyPreviewKind(name): "image" | "markdown" | "json" | "text"` (src/preview-kind.ts)
- `rawMarkdownImageUrl(hint, markdownPath, resource, cap): string | null` (src/markdown-preview.ts) — md-относительная картинка → raw-URL после той же path-валидации, что у `workspaceResourceUrl`
- `buildEventsUrl(hint, paths): string` — `/filemanager-fs/events?hint=<enc>&paths=<enc JSON-array>` (`encodeURIComponent`: пробелы как `%20`, плюсы как `%2B`)
- `createSseEventSource(url): LiveEventSource` — fetch-based SSE-клиент (src/sse-client.ts): отправляет header `x-dsh-filemanager: 1` и зеркалирует поверхность EventSource (`open`, именованные события, `error`, `close()` через AbortController)
- `buildDragMention(path, kind): string | undefined` — текст упоминания для переноса: `@path` (файл), `@path/` (папка), `@"path"` (пробелы); `undefined` для путей с управляющими символами/кавычками
- Drag payload (перенос из дерева): MIME `application/x-dsh-filemanager` → JSON `{ "path": "<отн. posix-путь>", "kind": "file" | "dir" | "symlink-file" | "symlink-dir" }`; fallback `text/plain` — текст упоминания

## Usage examples
- `curl -H "x-dsh-filemanager: 1"   \
  "http://localhost/filemanager-fs/read?hint=/path/to/ws&path=README.md"`

Ожидаемый ответ:
`{ "name": "README.md", "path": "README.md", "content": "...", "truncated": false }`

- `curl -N -H "x-dsh-filemanager: 1" \
  "http://localhost/filemanager-fs/events?hint=/path/to/ws&paths=%5B%22src%22,%22%22%5D"`

Ожидаемый SSE-поток (при изменении `src/Panel.tsx`):

```
event: changed
data: { "type": "changed", "path": "src/Panel.tsx", "kind": "change" }
```

## Operational runbooks
- Заголовок безопасности: `x-dsh-filemanager: 1` обязателен для всех запросов, кроме `/raw` (там авторизация capability-токеном)
- Capability-токены: выдаются `/cap` (header-гейт), TTL 8 ч, ротация на каждом issue; `/raw` валидирует cap до обращения к файловой системе
- Изображения (`/raw`): magic-byte content-type, лимиты 20 МБ raster / 2 МБ svg, `no-store`/`nosniff`, svg — `content-security-policy: sandbox`
- Ограничение чтения: 5 МБ; `truncated: true` если файл больше
- Кодировка: UTF-8; при некорректной кодировке — ошибка
- Живое обновление: debounce 250 мс; polling fallback — раз в 5 секунд; reconnect backoff — 500 мс с удвоением, кап 10 с; git-бейджи: событие `git-changed` при изменении git-метаданных (`index`/`HEAD`/refs), клиент перечитывает наблюдаемые каталоги
- Серверный кэш git-статуса: TTL 2 с + dirty-инвалидация (git-changed и fs-события), один in-flight прогон на root, LRU 8; heartbeat `event: ping` каждые 10 с; клиентский inactivity-watchdog 30 с (тишина → error-путь с polling и баннером)
- Watcher-ы освобождаются при disconnect/ошибке SSE-соединения (активных watcher-ов после закрытия — 0)

## Failure modes / error handling
- Путь выходит за корень воркспейса — 403
- Файл не найден — 404
- Запрошен каталог вместо файла — 400
- Бинарный/не-текстовый файл — 400 "unsupported content type"
- Файл превышает 5 МБ — возвращается усеченный контент и `truncated: true`; подсветка отключается и показывается обычный моноширинный текст
- `/raw`: невалидный/протухший/чужой-hint capability — 403 до обращения к ФС; не изображение — 415; сверх лимита (20 МБ raster / 2 МБ svg) — 413; выход за корень — 403/404
- SVG, открытый как документ (новая вкладка) — `content-security-policy: sandbox` изолирует origin и отключает скрипты
- Невалидный JSON или файл больше лимита pretty — показывается raw-текст с локализованной пометкой (`parse`/`too-large`); усечённый файл объясняет общий баннер
- Локальная md-картинка не загрузилась (404/403/415) — capture-обработчик скрывает только упавший `<img>`; документ продолжает рендериться
- Язык не распознан, highlight.js сообщает об ошибке или файл превышает поддерживаемый лимит — подсветка отключается без потери исходного текста
- Markdown renderer завершился ошибкой — панель сообщает об ошибке и сохраняет возможность вернуться к исходному тексту
- Markdown-ссылка или изображение выходит за корень workspace, использует опасную схему или изображение внешнее — ресурс блокируется без раскрытия содержимого и без падения всего документа
- Markdown-содержимое усечено — рендерится доступное начало и показывается предупреждение о частичном просмотре
- Некорректный `paths`-JSON, абсолютный/traversal/backslash путь, путь за пределами workspace, несуществующий путь или файл вместо каталога — подписка `events` отклоняется (400/403/404), watcher-ы не создаются (нет fallback на подмножество путей);
  клиент показывает статус недоступности автообновления и переходит к polling fallback
- Отсутствует или неверный `x-dsh-filemanager` — 403, SSE не создаётся
- В корне нет `.git` или `.git` является файлом (linked worktree/submodule) — git-метаданные не наблюдаются, событие `git-changed` не отправляется; это не ошибка соединения, обычные `changed`-события продолжают работать
- Каталог удалён во время watcher operation — событие обрабатывается без падения; узел исчезает после invalidation родителя, его reloader вычищается из реестра инвалидации
- Ошибка watcher-а или SSE — клиент закрывает источник, переподключается с backoff и включает polling раскрытых каталогов раз в 5 секунд; успешный reconnect останавливает polling
- «Зависшее» соединение (нет open/error и нет событий/пингов дольше 30 с) — inactivity-watchdog трактует тишину как сбой: источник закрывается, включаются reconnect с backoff и polling fallback с баннером
- Сбой сбора git-статуса — кэш возвращает пустой снапшот и помечает root dirty (следующий листинг пересчитает); сам листинг не падает
- Смена workspace — старые SSE, watcher-ы, debounce и polling останавливаются; создаётся контур нового workspace
- Несколько быстрых событий — объединяются debounce-окном по пути и дают один refresh
- Ошибка `fetchList` при invalidation — сохраняется последнее состояние узла и используется существующая ошибка загрузки
- Дроп с чужими типами данных или мимо композера — событие не перехватывается (image drop zone и браузерные обработчики работают как обычно)
- Дроп при занятом композере (фаза `submitting`/`adjudicating`), отсутствии сессии или шелла ввода — вставка игнорируется
- Путь с управляющими символами или кавычками — упоминание не строится, вставка пропускается
- Путь содержит пробелы — вставляется quoted-форма `@"path"`, чтобы `@`-токен оставался корректным по грамматике

## Success criteria
- Эндпоинт `read` возвращает ожидаемую форму JSON
- Клиентская док-панель корректно открывается/закрывается, перетаскивается за шапку, поддерживает ресайз и скролл
- Для больших файлов контент усечен, признак установлен, а предпросмотр остаётся обычным моноширинным текстом
- Для `.md` без учёта регистра виден переключатель; режимы «Исходник» и «Предпросмотр» работают, выбор сохраняется отдельно по workspace, а для остальных расширений интерфейс не меняется
- Markdown безопасно отображает заголовки, списки, ссылки, таблицы и fenced code blocks; HTML и опасные URL-схемы экранируются или блокируются, внешние изображения не загружаются, workspace-relative ресурсы не выходят за корень
- Ошибка renderer-а оставляет доступным исходный текст, а `truncated: true` даёт предупреждение и рендерит доступное начало
- Поддерживаемые TypeScript, JavaScript, Python, Go, C# и Rust подсвечиваются на клиенте highlight.js; язык определяется по расширению/имени файла или shebang, а неизвестные языки, ошибки подсветки и файлы сверх лимита безопасно деградируют до обычного текста
- Вкладка-ручка открывает/закрывает панель дерева; дерево сортирует папки первыми, лениво раскрывает их и сохраняет раскрытие по воркспейсу
- Раскрытый каталог отражает создание/удаление/rename на диске после debounce (~250 мс); закрытые каталоги не опрашиваются и не инвалидируются
- Изменённый на диске preview-файл не перезагружается молча: показывается confirmation banner с «Обновить»/«Оставить текущую версию»; «Обновить» срабатывает только после успешной загрузки
- Соединение восстанавливается после сбоя (reconnect с backoff), polling fallback работает и останавливается при восстановлении SSE, ручной ↻ продолжает работать
- Git-бейджи обновляются автоматически после git-операций (commit/stage/checkout): сервер шлёт `git-changed` при изменении `index`/`HEAD`/refs, клиент перечитывает раскрытые каталоги; для воркспейса без `.git` событие просто не отправляется
- При disconnect/закрытии панели watcher-ы, SSE-соединение и таймеры освобождаются (дубликаты подписок не возникают)
- Несколько листингов в пределах окна кэша (или после git-события) делят один прогон git-статуса; правка файла без git-метаданных обновляет бейдж через инвалидацию кэша
- Зависший SSE (нет событий дольше 30 с) деградирует в polling со статус-баннером; heartbeat-пинги идут каждые 10 с, пока соединение живо
- UI-копия локализована (en по умолчанию, ru для ru-браузеров, оверрайд `fm-locale`); дерево доступно с клавиатуры (роли, стрелки/Home/End, Enter/Space, ArrowLeft/Right на папках), превью — диалог с закрытием по Escape; обрезанные имена показывают полный тултип при наведении
- Перетаскивание строки дерева в поле ввода вставляет упоминание пути в позицию каретки; `@`-упоминание соответствует грамматике DSH (модель трактует его как явно упомянутый файл); папки получают завершающий `/`
- Клик по изображению (png/jpg/jpeg/gif/webp/avif/svg) открывает док: картинка вписана, зум кнопками/Ctrl+колесом, двойной клик 100%/fit, размеры в тулбаре, «открыть оригинал» работает; svg-ответ несёт CSP sandbox
- Безопасные локальные относительные изображения внутри Markdown рендерятся инлайн; внешние по-прежнему блокируются; упавшее локальное изображение скрывается без падения документа
- JSON `.json` по умолчанию показывается форматированным (валидный, < 1 МБ) с подсветкой; невалидный/слишком большой — raw + пометка; выбор Raw/Formatted сохраняется per-workspace
- `/cap` выдаёт токен только с header; `/raw` отдаёт байты только по валидному cap (403 иначе), с magic-byte content-type, no-store/nosniff и лимитами 20 МБ/2 МБ

## Related canon
- См. Overview — назначение и границы

## Boundaries & non-responsibilities
- Нет редактирования файлов, только чтение и предпросмотр
- Изображения (png/jpeg/gif/webp/avif/svg) предпросматриваются в доке без редактирования и без тумбнейлов в дереве; PDF, видео и прочие бинарные форматы не покрываются
- Любые операции за пределами корня воркспейса запрещены
- Нет наблюдения всего workspace: watcher-ы создаются только на раскрытые каталоги (и корень `""`); нет двусторонних WebSocket-команд и молчаливого (без подтверждения) обновления preview


## Tech & constraints
- Лимит чтения: до 5 МБ на файл; признак `truncated` при усечении
- Изображения: `/raw` — единственный эндпоинт без header (capability-токен вместо него); лимиты `MAX_IMAGE_BYTES` 20 МБ / `MAX_SVG_BYTES` 2 МБ; svg — `content-security-policy: sandbox`; JSON pretty — `JSON_PRETTY_MAX_CHARS` = 1 000 000
- Кодировка: UTF-8; несовместимые кодировки считаются ошибкой
- Заголовок безопасности: `x-dsh-filemanager: 1` обязателен для всех запросов, кроме `/raw`
- Проверка пути: `isInside(root, target)` и `realpath` для защиты от выходов за корень
- UI: док-панель справа с возможностью ресайза, прокруткой и перетаскиванием за шапку; моноширинный шрифт для текста
- Позиция и размер панели предпросмотра запоминаются в localStorage в рамках воркспейса (ключ по hint, как для развёрнутых папок); при открытии файла панель восстанавливает сохранённое расположение, иначе — правый край
- Живое обновление: серверный `fs.watch` на раскрытые каталоги, доставка SSE (`event: changed`), debounce 250 мс, targeted invalidation, reconnect с backoff (500 мс → кап 10 с), polling fallback раз в 5 секунд (снапшоты имён/типа/размера/mtime)
- Кэш git-статуса: `DEFAULT_TTL_MS` 2000 мс, `DEFAULT_MAX_ROOTS` 8, dirty-инвалидация событиями; heartbeat: `SSE_HEARTBEAT_MS` 10000 мс; watchdog: `LIVE_REFRESH_INACTIVITY_MS` 30000 мс
- UI: локализация en/ru (`fm-locale`), доступность L1 (роли дерева/aria, клавиатура, dialog+Esc, focus-visible), тултип полного имени у обрезанных строк
- События вне workspace и из `.git` не отправляются; пути нормализуются в относительные posix-пути; корень workspace в подписке — пустая строка `""`
- Drag-and-drop: кастомный MIME `application/x-dsh-filemanager`, target-детекция по `[data-composer-card]`, вставка через `conversation.input.shell(sessionId).setDraft` с editRange; текст упоминания — грамматика `@`-токенов (`@path`, `@path/`, `@"path"`)