# Юрт — семейная сеть

Веб-оболочка для Matrix (matrix.org) в ретро-стиле. Своего сервера нет, всё бесплатно.

## Где что менять
- `src/config.js`: название, имя пространства и комнаты «Стена»
- `src/style.css`: все цвета в начале файла (`:root`)
- `public/icons/icon.svg`: логотип; после правки запустить `npm run icons`

## Команды
- `npm install`: установить зависимости (один раз)
- `npm run dev`: локальный просмотр (вход работает только на GitHub Pages)
- `npm run build`: сборка

## Публикация
Каждый `git push` в ветку `main` автоматически публикует сайт на GitHub Pages
(Settings → Pages → Source: **GitHub Actions**).
