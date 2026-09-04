# Future Plan: Image preview support

## Intent
Добавить поддержку предпросмотра изображений (png/jpg/webp/gif/svg) во всплывающем окне плагина файлового менеджера.

## In scope
- Рендер изображений в модальном окне с заголовком и кнопкой закрытия
- Определение типа содержимого на сервере; безопасная передача (URL/Blob)
- Ограничения размера и деградация при слишком больших изображениях

## Out of scope
- Редактирование изображений
- Конвертация форматов
- Предпросмотр произвольных бинарных файлов (pdf, видео)

## Absorbs into
- Living canon: Architecture (Public interfaces, Key flows), Overview (Scope)

## Open questions
- Где хранить/как передавать изображение: прямой URL или data URL? (предпочтительно прямой URL внутри воркспейса)
- Ограничения по памяти и ресайз стратегии для больших изображений

---

Status: absorbed (2026-09-04) — реализовано циклом «image preview + JSON pretty view» (spec docs/superpowers/specs/2026-09-04-image-json-preview-design.md). Решения: транспорт — capability-URL (`/cap` + `/raw`), а не data-URL; standalone-просмотр — в существующей док-панели (fit + зум), локальные относительные изображения рендерятся внутри Markdown. Открытые вопросы закрыты в ARCHITECTURE (Public interfaces /cap,/raw; Key flows).
Depends: текстовый предпросмотр реализован
Unblocks: визуальные ревью изменений в репозитории
