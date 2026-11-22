# 3. Развёртывание с нуля

← [Сервисы](02-services.md) · [Оглавление](README.md) · Далее: [Карта кода →](04-code-map.md)

## Инструменты (macOS)
```bash
brew install node gh
```
- Node.js — сборка (Vite). Проверено на Node 22–26.
- `gh` — GitHub из терминала. Вход: `gh auth login` (код с экрана вводится на https://github.com/login/device). Для публикации нужен доступ `workflow`: `gh auth refresh -s workflow`.

## Получить код и запустить
```bash
gh repo clone qazaxam/semya && cd semya
npm install
npm run dev      # локальный просмотр
npm run build    # сборка в dist/
```
⚠️ **Вход локально не работает**: matrix.org принимает только публичный `https`-адрес приложения (`localhost` отклоняется при регистрации клиента). Проверять вход — на опубликованном сайте.

## Публикация сайта
Просто `git push` в `main`. GitHub Actions ([`pages.yml`](../.github/workflows/pages.yml)) соберёт и выложит сайт за 1–2 минуты. В настройках репозитория должно стоять: Settings → Pages → Source: **GitHub Actions**.

## Иконки
Логотип — [`public/icons/icon.svg`](../public/icons/icon.svg) (шаңырақ, свой рисунок). После правки: `npm run icons` — создаст PNG (скруглённые для Android, квадратные для iPhone и обложки радио).

## Matrix (вручную, через Element X)
1. Зарегистрировать аккаунты на https://account.matrix.org (`yurt01`, `yurt02`, …).
2. Под `yurt01` создать **пространство «Семья»**, внутри — комнаты **«Стена»** и **«Общий чат»** (названия должны совпадать с [`src/config.js`](../src/config.js)). Доступ к комнатам: «участники пространства».
3. Включить «Восстановление» (Recovery) и сохранить ключ.
4. Пригласить родных в пространство. «Юрт» сам вступает в комнаты пространства.

## Рассыльщик уведомлений
Код: [`push-gateway/worker.js`](../push-gateway/worker.js), настройки: [`push-gateway/wrangler.toml`](../push-gateway/wrangler.toml).
```bash
cd push-gateway
npx wrangler login        # вход в Cloudflare в браузере
npx wrangler deploy       # выложить/обновить
```
Если поддомена `*.workers.dev` ещё нет — Cloudflare спросит его при первом `deploy` (у нас: `qazaxam`).

**Новая пара VAPID-ключей** (если потерян закрытый):
```bash
node -e 'const c=require("crypto").webcrypto;(async()=>{const k=await c.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign","verify"]);console.log(Buffer.from(await c.subtle.exportKey("raw",k.publicKey)).toString("base64url"));require("fs").writeFileSync("/tmp/vapid.jwk",JSON.stringify(await c.subtle.exportKey("jwk",k.privateKey)))})()'
```
Напечатанное — открытый ключ → в `VAPID_PUBLIC` ([`src/config.js`](../src/config.js)). Закрытый — в Cloudflare и удалить файл:
```bash
npx wrangler secret put VAPID_JWK < /tmp/vapid.jwk && rm /tmp/vapid.jwk
```
Проверка: `https://yurt-push.qazaxam.workers.dev/` отвечает «рассыльщик уведомлений работает».

## Правила работы
Небольшие шаги → `npm run build` без ошибок → коммит → push. Объяснения коротко и по-русски (см. [`CLAUDE.md`](../CLAUDE.md)).
