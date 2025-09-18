CloudStats_s1 (schema "s1")
===========================

Назначение
----------
Модуль `cloudstats_s1.js` интегрирует бота Verter SAFE c Firebase Firestore
для накопления статистики по сигналам и использованию облачного рейтинга
при выборе сделок. Реализация поддерживает анонимную аутентификацию,
App Check (reCAPTCHA v3) и локальные фолбэки в `localStorage`.

Структура данных
----------------
- Коллекция `signals_perf`
  - Документ: `s1__{ASSET}__{TF}` (символ и таймфрейм в верхнем регистре,
    неалфавитные символы заменены на `_`).
  - Поля верхнего уровня:
    - `schema`: строка (`"s1"`).
    - `asset`, `timeframe`: исходные значения.
    - `trades`, `wins`, `losses`: агрегаты по активу и таймфрейму.
    - `ewma`: экспоненциальное среднее по win-rate (α = 0.2).
    - `avgROI`: средний ROI (PnL/бет).
    - `updatedAt`: timestamp обновления.
    - `signals`: map `{signalKey: {...}}` со статистикой по каждому сигналу:
      - `trades`, `wins`, `losses`, `ewma`, `avgROI`, `lastTs`.
- Коллекция `trade_logs`
  - Документы `/{yyyymmdd}/items/{autoId}` с неизменяемой записью сделки.

Алгоритмы
---------
- **Чтение**: `CloudStats.readPerf(asset, tf)` использует локальный кэш и
  анти-флуд (не чаще 1 раза в 30 секунд на документ). При ошибке возвращает
  сохранённые данные из `localStorage`.
- **Запись**: `CloudStats.updateAfterTrade(trade)` ставит запись в очередь,
  применяет экспоненциальный backoff (1→2→4… до 30с) и выполняет
  транзакцию Firestore: лог сделки + обновление агрегата.
- **Рейтинг**: `CloudStats.rankSignals(perf, weights)` ранжирует сигналы
  по весам `{w1,w2,w3,w4,Tcap}` (по умолчанию `0.5/0.3/0.1/0.1`, `Tcap=200`).
- **Фильтр допуска**: `CloudStats.shouldTrade(key, perf, policy)` применяет
  пороги `T_min` (минимум 30 сделок) и `ewmaMin` (0.52).

Интеграция в Verter SAFE
------------------------
- Флаги по умолчанию: `enableCloud=true`, `cloudReadOnly=false`.
- `loadCloudConfig()` читает конфигурацию Firebase из
  `window.__VERTER_FIREBASE_CONFIG__` или `localStorage('verter_cloud_config')`.
- При старте загружается compat SDK Firebase (`app`, `auth`, `firestore`,
  `app-check`) и вызывается `CloudStats.init`.
- Режимы облака:
  - `HOT`: используется облачный рейтинг (λ по ступеням 0.8→0.0).
  - `WARMUP`: данных мало — торгуем по локальным правилам (λ ≤ 0.3).
  - `COLD`: документа нет — облако отключено.
  - `DRIFT`: обнаружен дрейф рынка, λ понижается до полного отката.
- Guardrails: при `WARMUP/COLD/DRIFT` шаг MG ограничен `≤ 1`,
  действует лимит `≤ 6` сделок/час и облако переводится в read-only режим.
- Explore-mode: при `HOT` 15% решений позволяют протестировать новые сигналы.
- `recordTradeResult` формирует запись сделки со схемой `s1` и отправляет
  её в Firestore (если не включён read-only). Результаты попадают в
  журнал `trade_logs` и агрегат `signals_perf`.
- UI дополнен панелью «Cloud Signals» (статус, λ, top-5 сигналов).

Настройки
---------
- `CLOUD_REFRESH_MINUTES = 3` — период обновления рейтинга.
- `CLOUD_MAX_TRADE_PER_HOUR = 6` — лимит сделок при обучении.
- `CLOUD_EXPLORE_RATE = 0.15` — доля exploratory сделок в `HOT`.
- Порог дрейфа: `ewma_live < 0.50`, `ewma_live - ewma_cloud < -0.06`,
  `loss_streak ≥ 3`, `cloudAge > 48h`. При восстановлении
  (`ewma_live ≥ 0.54` несколько сделок) λ повышается обратно.

Правила безопасности
--------------------
- App Check reCAPTCHA v3 активируется при наличии `cfg.recaptchaKey`.
- Анонимная авторизация обязательна (`firebase.auth().signInAnonymously`).
- Удаления документов Firestore не выполняются — журнал неизменяемый.

Примечания
----------
- В офлайн-режиме статистика и очередь записей сохраняются в `localStorage`.
- Модуль CloudStats доступен глобально (`window.CloudStats`).
- Перед использованием необходимо заполнить конфиг Firebase (apiKey,
  projectId, appId и т.д.) и ключ App Check.
