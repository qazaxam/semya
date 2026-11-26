# 2. Внешние сервисы и аккаунты

← [Обзор](01-overview.md) · [Оглавление](README.md) · Далее: [Развёртывание →](03-setup.md)

## Список
| Сервис | Адрес | Зачем | Аккаунт / доступ |
|---|---|---|---|
| **GitHub** (код) | https://github.com/qazaxam/semya | Публичный репозиторий | Аккаунт владельца `qazaxam`; на Mac вход через `gh auth login` |
| **GitHub Pages** (сайт) | https://qazaxam.github.io/semya/ | Хостинг сайта | Settings → Pages → Source: **GitHub Actions**. Публикует [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) |
| **matrix.org** (сервер) | API: https://matrix-client.matrix.org | Сообщения, медиа, синхронизация | Аккаунты семьи `@yurtNN:matrix.org` |
| **account.matrix.org** | https://account.matrix.org | Регистрация, вход, смена пароля (MAS, OIDC) | Те же аккаунты |
| **Cloudflare Workers** | https://yurt-push.qazaxam.workers.dev | Рассыльщик уведомлений (Matrix push gateway → Web Push) | Аккаунт Cloudflare владельца (бесплатный план), поддомен `qazaxam.workers.dev`; на Mac вход через `npx wrangler login` |
| **Apple / Google push** | web.push.apple.com, fcm.googleapis.com | Доставка уведомлений на телефон | Не нужен — работает через подписку браузера |
| **Радиостанции** | см. [`src/config.js`](../src/config.js) → `STATIONS` | Радио в приложении | Публичные потоки, только https |
| **radio-browser.info** | https://www.radio-browser.info | Где искали адреса потоков станций | Не нужен |
| **Element X / FluffyChat** | приложения в App Store | Администрирование: создать «Семью», комнаты, ключ восстановления | Те же аккаунты Matrix |

## Проверено из Казахстана (ноябрь 2026)
- Работают: `matrix-client.matrix.org`, `account.matrix.org`, `*.github.io`, `*.workers.dev`.
- **Не открываются:** сайт matrix.org, app.element.io, app.cinny.in. Нам это не мешает — оболочка ходит прямо в API.

## Где лежат ключи и секреты
| Что | Где | В репозитории? |
|---|---|---|
| Токены входа пользователя | localStorage браузера (`yurt.session`) | ❌ никогда |
| Ключи шифрования переписки | IndexedDB браузера (Rust-crypto) + резервная копия на matrix.org под ключом восстановления | ❌ |
| Ключ восстановления (Recovery key) | У каждого пользователя лично (выдаёт Element X) | ❌ |
| VAPID **закрытый** ключ рассыльщика | Секрет Cloudflare `VAPID_JWK` | ❌ |
| VAPID **открытый** ключ | [`src/config.js`](../src/config.js) → `VAPID_PUBLIC` | ✅ (он и должен быть публичным) |
| Регистрация OAuth-клиента на matrix.org | Создаётся автоматически при первом входе (dynamic client registration), `client_id` в localStorage | ❌ |

Если закрытый VAPID-ключ потерян — создать новую пару (см. [03-setup.md](03-setup.md#рассыльщик-уведомлений)), обновить `VAPID_PUBLIC`, опубликовать. Подписки телефонов обновятся при следующем запуске приложения.

## Схема логинов
`yurt01`, `yurt02`, … — сначала буквы, две цифры с нулём (правильная сортировка, хватит на 99 человек). Логин в Matrix **сменить нельзя**, а отображаемое имя («Папа», «Апа») можно менять в любой момент: ☰ → Настройки → «Моё имя».
