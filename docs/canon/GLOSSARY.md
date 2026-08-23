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

## Naming conventions
<!-- Record project-wide naming rules. -->

## Related canon
<!-- Point to related canon sections. -->