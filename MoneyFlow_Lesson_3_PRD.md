# MoneyFlow — PRD третьего урока

Продолжение PRD второго урока. Исполнитель — Claude Code (Opus) в bb: проект lesson0, папка ~/Desktop/lesson1, главный тред «боевой». Исходный код — состояние после урока 2 на GitHub: `dankovstudio/moneyflow_openai`, коммит `168d631` (именно эту версию видели зрители). Агент обязан осмотреть реальные файлы перед правками и не угадывать структуру.

## 1. Результат урока

MoneyFlow работает в интернете, а не на ноутбуке:

- **Hetzner + Dokploy** (`docker compose`): сайт, API, SQLite и Telegram-бот. Адрес — **https://moneyflow.lifestyle**, вход по паролю.
- **Vercel**: MoneyFlow MCP, тот же самый (`list_expenses`, `spending_summary`), но публичный. Своих данных у него нет, он читает их с Hetzner.
- **Claude web** (claude.ai) подключает MCP как custom connector и отвечает на вопросы о тратах.

Финальная демонстрация: трата в Telegram → видна на https://moneyflow.lifestyle → Claude web в браузере называет её и сумму. Ноутбук ведущего при этом можно закрыть.

Объяснение для зрителей: «Сервер — компьютер, который всегда включён. Dokploy — панель, которая забирает код с GitHub, собирает его в Docker и запускает. Домен — понятное имя вместо IP. Vercel хорош для того, что ничего не хранит и просто отвечает на запросы, — поэтому туда идёт MCP; а база и бот живут на сервере». Не объяснять устройство Docker, Traefik и DNS глубже одного предложения.

## 2. Исходное состояние и границы

- Код урока 2: Vite + React, Express 5 на `127.0.0.1:8787` (хост и порт зашиты в `server/index.ts`), `node:sqlite` в `data/moneyflow.sqlite` (путь зашит в `server/env.ts`), бот — long polling `npm run bot`, MCP на `/mcp` только для localhost. Секреты читаются `readEnv()` из `.env`, при его отсутствии — из переменных окружения.
- Демо-данные — сентябрь 2026. Урок записывается в октябре 2026: сайт открывается на текущем (пустом) месяце, демо-итоги — в сентябре.
- На сервере база создаётся с нуля (seed урока 1); локальная база не переносится.
- Один экземпляр бота: перед запуском бота на сервере локальный `npm run bot` остановлен, иначе Telegram отвечает 409.
- Вне урока: CI/CD кроме автодеплоя по push, Kubernetes, отдельная СУБД, мониторинг, автоматические бэкапы (упомянуть устно), OAuth, несколько пользователей.

### Принятые решения (обязательны)

- **Код и репозиторий:** продолжаем `dankovstudio/moneyflow_openai` (публичный). Коммит после каждой принятой фазы; push в `main` делает «боевой» после приёмки фазы. Секреты в репозиторий не попадают.
- **Домен** `moneyflow.lifestyle`, DNS у Namecheap (Advanced DNS), без Cloudflare. Записи A: `@` → IP сервера (приложение), `dokploy` → IP сервера (панель). HTTPS — Let's Encrypt через Traefik внутри Dokploy.
- **Сервер:** Hetzner Cloud, **Ubuntu 24.04** (не 26.04), x86, не меньше 2 vCPU / 4 GB RAM (минимум Dokploy — 2 GB), SSH-ключ ведущего `~/.ssh/id_ed25519.pub` добавлен при создании. Hetzner Cloud Firewall: входящие **только 22, 80, 443**. Порт 3000 наружу **никогда не открывать**: на репетиции бот захватил свежую панель Dokploy через открытый 3000 (зарегистрировал админа за секунды после установки, добавил свой SSH-ключ, поставил майнер). Регистрация админа — только через SSH-туннель `ssh -L 3300:localhost:3000 root@<IP>` → http://localhost:3300 (локальный 3000 у ведущего занят другим проектом). Firewall в консоли Hetzner, а не только `ufw`: Docker обходит `ufw` для опубликованных портов.
- **Защита сайта:** Basic Auth на весь сайт и `/api`, если задан `APP_PASSWORD` (логин `moneyflow`). Без `APP_PASSWORD` (локально) всё работает как раньше. `/api/health` открыт для проверки живости.
- **MCP на Vercel:** отдельная папка `mcp-vercel/` в том же репозитории, Vercel-проект с Root Directory `mcp-vercel`. Данные — через read-only эндпоинты Hetzner с сервисным токеном. Claude web подключается без входа («No sign-in»), секрет — в пути URL. Это осознанный компромисс урока: инструменты только читают, данные вымышленные; OAuth — следующий шаг, проговорить устно.
- **Секреты деплоя** (API-токены Dokploy и Vercel) ведущий кладёт через bb-скилл `secrets` в `~/.moneyflow-deploy.env` вне репозитория. Агент не печатает значения. Все токены, показанные на записи, отзываются после урока.

## 3. Технические решения (не выбирать заново)

| Что | Значение |
|---|---|
| Образ | один `Dockerfile` для `app` и `bot`: `node:22-bookworm-slim`, `npm ci`, `npm run build` (фронт в `dist/`), запуск через `tsx` как локально |
| Compose | `docker-compose.yml` в корне: сервис `app` (сайт + `/api` + `/internal`, порт 8787 внутри сети, наружу через домен Dokploy) и сервис `bot` (тот же образ, `npm run bot`); оба `restart: unless-stopped` |
| Данные | том `${DATA_DIR:-./data}:/app/data`; в Dokploy `DATA_DIR=../files/moneyflow-data` (рекомендация Dokploy: `../files` переживает передеплой) |
| Конфиг через env | `HOST` (по умолчанию `127.0.0.1`, в контейнере `0.0.0.0`), `PORT` (8787), `DB_PATH` (по умолчанию `data/moneyflow.sqlite`) |
| Сайт в продакшене | Express отдаёт `dist/` и SPA-fallback, если `dist/` есть; локальная разработка через Vite (`npm run dev`) не меняется |
| Секреты на сервере | переменные окружения сервиса в Dokploy: `COINGECKO_DEMO_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_ID`, `APP_PASSWORD`, `MCP_READ_TOKEN`, `DATA_DIR` |
| Read API для MCP | `GET /internal/mcp/expenses?month=YYYY-MM&limit=N` и `GET /internal/mcp/summary?month=YYYY-MM`; заголовок `Authorization: Bearer <MCP_READ_TOKEN>`; без токена или с неверным — 401; если `MCP_READ_TOKEN` не задан — 404. Ответ — JSON того же вида, что `listExpenses`/`spendingSummary` из `server/service.ts`; ошибки месяца — 400 `{ error: { code, message } }` |
| Локальный `/mcp` | остаётся как в уроке 2 (только localhost) |
| MCP на Vercel | `mcp-vercel/`: TypeScript, `mcp-handler@1.1.0` + `@modelcontextprotocol/sdk@1.26.0` (точно: `mcp-handler` 2.x требует другой пакет) + `zod`, Streamable HTTP, stateless; инструменты и описания — как в уроке 2; данные — `fetch` к `MONEYFLOW_API_URL` с `MCP_READ_TOKEN`. Регион функций `fra1` (рядом с Hetzner) |
| URL MCP | `https://<проект>.vercel.app/<MCP_PATH_SECRET>/mcp`; неверный секрет — 404. Env Vercel: `MONEYFLOW_API_URL=https://moneyflow.lifestyle`, `MCP_READ_TOKEN`, `MCP_PATH_SECRET` |
| Vercel | Hobby (бесплатно). Всё делает «боевой» через Vercel CLI с токеном ведущего: проект `moneyflow-mcp`, env, production-деплой из `mcp-vercel/`. Ведущий только показывает результат в интерфейсе. Автодеплоя по push нет — для урока не нужен |

## 4. Ход урока и треды

Урок — 60–75 минут, **три шага строго по очереди**. Следующий шаг начинается только после ручной проверки предыдущего; параллельно ничего не запускаем.

| Шаг | Что | Время |
|---|---|---|
| 1 | Сервер: покупка, DNS, настройка, Dokploy, вход в панель | ~20 мин |
| 2 | Docker Compose локально → деплой в Dokploy через API → домен и HTTPS | ~25 мин |
| 3 | MCP на Vercel: read API на backend, адаптация MCP, деплой, Claude web | ~25 мин |

Треды в bb (проект lesson0, папка ~/Desktop/lesson1):

- **«боевой»** — project manager: запускает по одному саб-треду на шаг через `bb thread spawn`, отвечает ведущему, проверяет результат, коммитит, пушит и деплоит через API (Dokploy, Vercel). Крупный код сам не пишет.
- **«server»** (шаг 1) — SSH на сервер, порядок и установка Dokploy. Репозиторий не трогает.
- **«docker»** (шаг 2) — env-конфиг, раздача `dist/`, Basic Auth, `Dockerfile`, `docker-compose.yml`, `.dockerignore`; проверка `docker compose up` на Mac.
- **«mcp-vercel»** (шаг 3) — read API `/internal/mcp/*` в `server/` и папка `mcp-vercel/`; проверка связки локально.

Если контракта из раздела 3 не хватает, саб-тред останавливается и пишет «боевому».

**Правило поэтапной работы:** после каждого шага Claude останавливается, даёт ведущему ручную проверку с реальными URL, командами, ожидаемыми цифрами и 2–4 типичными сбоями, и ждёт команды.

## 5. Фаза 0 — до урока

Готово: аккаунты Hetzner и Vercel, домен `moneyflow.lifestyle`, Docker на Mac, этот PRD. Проведена репетиция всего урока с откатом (сервер удалён, DNS-записи, Vercel-проект и коннектор Claude web удалены, ветка репетиции на GitHub удалена), записан runbook с промптами саб-тредов.

## 6. Шаг 1 — сервер и Dokploy (~20 мин)

**Ведущий на камере:** покупает сервер в Hetzner (**Ubuntu 24.04** — на 26.04 официальный скрипт Dokploy падает на версии Docker), добавляет SSH-ключ и Firewall (только 22, 80, 443), называет IP; в Namecheap добавляет A-записи `@` и `dokploy`, удалив парковочные.

**Саб-тред «server»:** по SSH (`root@<IP>`): обновления, вход только по ключу, fail2ban, автообновления безопасности, swap 2 GB, Dokploy официальным скриптом. Пока он работает (~10 мин), ведущий объясняет, что такое сервер, SSH, DNS и Dokploy.

**Ведущий:** сразу после установки — SSH-туннель (его открывает «боевой») → http://localhost:3300 → регистрация админа → Settings → Web Server → домен `dokploy.moneyflow.lifestyle`, Let's Encrypt → вход по https → Settings → Profile → API/CLI Keys → ключ через `secrets`.

**Проверка:** https://dokploy.moneyflow.lifestyle с замком; `ssh` по паролю отклоняется; `nc -z <IP> 3000` — закрыт; в `/root/.ssh/authorized_keys` только ключ ведущего.

## 7. Шаг 2 — Docker Compose и деплой в Dokploy (~25 мин)

**Саб-тред «docker»:** изменения из раздела 3 (кроме read API). Проверка на Mac: `docker compose up --build app`, `http://localhost:8787` просит пароль, сентябрь: income £5,050.00, expenses £2,598.39, net £2,451.61, баланс пяти счетов £5,751.61; Tesco £12.50 → expenses £2,610.89; `down` + `up` — Tesco на месте; `npm run dev` работает как раньше.

**Ведущий:** открывает сайт из Docker на Mac, вводит пароль, видит те же цифры. Останавливает локальный бот, если запущен.

**«боевой»:** коммит и push в `main` (`git push origin lesson3:main`); через API Dokploy — проект `moneyflow`, Compose из публичного Git-репозитория, переменные окружения, домен `moneyflow.lifestyle` → `app:8787` с HTTPS, деплой, логи сборки. Ведущий параллельно показывает то же самое в интерфейсе Dokploy.

**Проверка:** https://moneyflow.lifestyle — замок, пароль, сентябрь с демо-итогами; трата с сайта; `/start` и `12.50 Tesco bot / NatWest / Groceries` в Telegram — бот отвечает с сервера; Redeploy в Dokploy — данные на месте. Сбои: DNS (`dig +short moneyflow.lifestyle`), сертификат не выпущен (порт 80, логи Traefik), 409 у бота (локальный бот не остановлен), 401 (пароль).

## 8. Шаг 3 — MCP на Vercel и Claude web (~25 мин)

**Объяснение:** на Vercel нет нашей базы — MCP будет спрашивать данные у сервера по защищённому адресу с токеном.

**Саб-тред «mcp-vercel»:** read API `/internal/mcp/*` в `server/` (раздел 3) и папка `mcp-vercel/`; проверка связки локально (backend + функция MCP): `initialize`, ровно два инструмента, итог сентября совпадает с сайтом, неверный токен/секрет отклоняются.

**«боевой»:** коммит и push в `main`; `MCP_READ_TOKEN` в env Dokploy и Redeploy. **Ведущий:** создаёт токен Vercel и кладёт через `secrets`. **«боевой»:** через Vercel CLI — проект `moneyflow-mcp`, env (`MONEYFLOW_API_URL`, `MCP_READ_TOKEN`, `MCP_PATH_SECRET`), production-деплой, проверка curl-ом, выдаёт ведущему URL MCP. Ведущий показывает проект, env и деплой в интерфейсе Vercel.

**Ведущий в Claude web:** Customize → Connectors → Add custom connector → URL MCP → No sign-in → Add; в новом чате включить коннектор и спросить:

> Используй MoneyFlow. Проанализируй мои расходы за <месяц, в который писали боту>: три самые большие категории, общая сумма, есть ли «Tesco bot». Назови вызванные инструменты.

**Финал:** новая трата в Telegram → F5 на сайте → тот же вопрос в Claude web видит её.

## 9. Критерии готовности

- https://moneyflow.lifestyle открывается с HTTPS и паролем, цифры сентября совпадают с уроком 2.
- Сайт, бот и MCP показывают одни и те же данные; передеплой и перезапуск сервера их не теряют.
- Бот работает с сервера при выключенном ноутбуке.
- Claude web через коннектор отвечает о тратах; без секрета в URL MCP недоступен, read API без токена — 401.
- В репозитории нет секретов; `npm run dev` локально работает как в уроке 2.

## 10. Официальные справки

- Dokploy: https://docs.dokploy.com/docs/core/docker-compose, домены — https://docs.dokploy.com/docs/core/docker-compose/domains
- Vercel MCP: https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel
- Claude custom connectors: https://claude.com/docs/connectors/custom/remote-mcp
- Hetzner Cloud: https://docs.hetzner.com/cloud/
