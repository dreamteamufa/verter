(function(){
  'use strict';

  if (window.top !== window) return;
  if (window.__VERTER_ACTIVE__) {
    console.warn('[Verter] duplicate instance prevented');
    return;
  }
  window.__VERTER_ACTIVE__ = true;

  const APP_VERSION = 'Verter 6.0 (PCS-8 Integrated, 2025-09-26)';
  const BUILD_TAG = 'PCS-8';

  const PAPER_HORIZON = 1;
  const TOP_K = 5;
  const MIN_TRADES = 6;
  const MIN_PROFIT = 80;
  const signalCheckInterval = 250;
  const MINUTE_WINDOW_MS = 1200;
  const MINUTE_BOUNDARY_MODE = 'off';

  const candleInterval = 60000;
  const MAX_CANDLES = 240;

  const betArray1 = [
    { step: 0, value: 10, pressCount: 9 },
    { step: 1, value: 30, pressCount: 13 },
    { step: 2, value: 80, pressCount: 20 },
    { step: 3, value: 200, pressCount: 24 },
    { step: 4, value: 400, pressCount: 27 }
  ];
  const betArray2 = [
    { step: 0, value: 30, pressCount: 13 },
    { step: 1, value: 80, pressCount: 20 },
    { step: 2, value: 200, pressCount: 24 },
    { step: 3, value: 400, pressCount: 27 },
    { step: 4, value: 900, pressCount: 33 }
  ];

  const colors = {
    green: '#07b372',
    red: '#f45f5f',
    gray: '#3c3c3f'
  };

  const KEY_CODES = { BUY: 87, SELL: 83, DOWN: 65, UP: 68 };
  const KEY_PRESS_DELAY = 24;
  const RESET_PRESS_COUNT = 30;
  const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
  const LOG_THROTTLE_MS = 2000;

  function resolveLogLevel(raw){
    const key = String(raw || '').toLowerCase();
    return LOG_LEVELS.hasOwnProperty(key) ? LOG_LEVELS[key] : LOG_LEVELS.info;
  }

  function detectLogLevel(){
    let raw = 'info';
    try {
      if (typeof window !== 'undefined' && window.VERTER_LOG_LEVEL){
        raw = window.VERTER_LOG_LEVEL;
      } else if (typeof localStorage !== 'undefined'){
        const stored = localStorage.getItem('VERTER_LOG_LEVEL');
        if (stored) raw = stored;
      }
    } catch (err){}
    return resolveLogLevel(raw);
  }

  const logState = {
    level: detectLogLevel(),
    lastMessages: Object.create(null)
  };

  function logMessage(level, label, payload, throttleKey){
    const levelValue = LOG_LEVELS[level];
    if (levelValue == null || levelValue < logState.level) return;
    const now = Date.now();
    let key = throttleKey || label;
    if (!throttleKey && payload){
      key += ':' + String(payload);
    }
    const last = logState.lastMessages[key];
    if (last && now - last < LOG_THROTTLE_MS) return;
    logState.lastMessages[key] = now;
    const prefix = label ? '[Verter][' + label + ']' : '[Verter]';
    const line = payload !== undefined && typeof payload === 'string' ? prefix + ' ' + payload : prefix;
    if (payload !== undefined && typeof payload !== 'string'){
      if (level === 'debug'){ console.debug(prefix, payload); }
      else if (level === 'info'){ console.log(prefix, payload); }
      else if (level === 'warn'){ console.warn(prefix, payload); }
      else { console.error(prefix, payload); }
      return;
    }
    if (level === 'debug'){ console.debug(line); }
    else if (level === 'info'){ console.log(line); }
    else if (level === 'warn'){ console.warn(line); }
    else { console.error(line); }
  }

  function logInfo(label, payload, throttleKey){
    logMessage('info', label, payload, throttleKey);
  }

  function logM1CloseEvent(message){
    logInfo(message.label, message.text, 'M1');
  }

  function logTradeResultEvent(text){
    logInfo('TRADE', text);
  }

  function logNextBetCalcEvent(text){
    logInfo('NEXT', text);
  }

  const fmt = (n, p = 5) => (Number.isFinite(n) ? n.toFixed(p) : '—');
  const fmt2 = (n, p = 2) => (Number.isFinite(n) ? n.toFixed(p) : '—');
  const fmtPct = n => (Number.isFinite(n) ? n.toFixed(1) + '%' : '—');
  const fmtMoney = n => (Number.isFinite(n) ? (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2) : '$0.00');
  const humanTime = ts => {
    const d = new Date(ts);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(v => String(v).padStart(2, '0')).join(':');
  };

  function formatSigned(value, suffix){
    if (!Number.isFinite(value)) return '—';
    const sign = value > 0 ? '+' : (value < 0 ? '-' : '');
    const abs = Math.abs(Math.round(value));
    return sign + abs + (suffix || '');
  }

  function formatSignedFixed(value){
    if (!Number.isFinite(value)) return '0';
    const sign = value > 0 ? '+' : (value < 0 ? '-' : '');
    return sign + Math.abs(value).toFixed(2);
  }

  function formatPercent(value){
    if (!Number.isFinite(value)) return '0%';
    return Math.round(value) + '%';
  }

  function formatAmount(value){
    if (!Number.isFinite(value)) return '0';
    return value % 1 === 0 ? String(value) : value.toFixed(2);
  }

  function normalizeSymbolLabel(raw){
    if (!raw) return '';
    const text = String(raw).replace(/\u00a0/g, ' ').trim();
    if (!text) return '';
    const compact = text.replace(/\s*\/\s*/g, '/');
    if (compact.includes('/')){
      return compact.split('/').map(part => part.trim().toUpperCase()).join(' ');
    }
    return compact.replace(/\s+/g, ' ').toUpperCase();
  }

  function makeSymbolKey(raw){
    const label = normalizeSymbolLabel(raw);
    return label ? label.replace(/[^A-Z0-9]/g, '') : '';
  }

  function textContainsSymbol(text, symbol){
    if (!text || !symbol) return false;
    const normalizedText = String(text).toUpperCase();
    const normalizedSymbol = normalizeSymbolLabel(symbol);
    if (!normalizedSymbol) return false;
    const withSpace = normalizedSymbol;
    const withSlash = normalizedSymbol.replace(/\s+/g, '/');
    const compact = normalizedSymbol.replace(/\s+/g, '');
    return normalizedText.includes(withSpace)
      || normalizedText.includes(withSlash)
      || normalizedText.includes(compact);
  }

  function parseMoneyValue(raw){
    if (raw == null) return NaN;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
    const normalized = String(raw).replace(/[^0-9+\-,.]/g, '').replace(/,/g, '');
    if (!normalized) return NaN;
    const value = parseFloat(normalized);
    return Number.isFinite(value) ? value : NaN;
  }

  function extractMoneyCandidates(text){
    if (!text) return [];
    const source = String(text).replace(/\u00a0/g, ' ');
    const regex = /[-+]?[$€£]?\s*\d+(?:[\s,]\d{3})*(?:\.\d+)?/g;
    const matches = [];
    let match;
    while ((match = regex.exec(source))){
      matches.push(match[0]);
    }
    return matches;
  }

  function findAmountInText(text, target){
    const matches = extractMoneyCandidates(text);
    if (!matches.length) return NaN;
    if (Number.isFinite(target)){
      const tolerance = 0.01;
      for (const token of matches){
        const value = parseMoneyValue(token);
        if (Number.isFinite(value) && Math.abs(value - target) <= tolerance){
          return value;
        }
      }
    }
    for (const token of matches){
      const value = parseMoneyValue(token);
      if (Number.isFinite(value)) return value;
    }
    return NaN;
  }

  function findPnLInText(text){
    const matches = extractMoneyCandidates(text);
    if (!matches.length) return NaN;
    for (let i = matches.length - 1; i >= 0; i -= 1){
      const token = matches[i];
      if (/[+$€£-]/.test(token)){
        const value = parseMoneyValue(token);
        if (Number.isFinite(value)) return value;
      }
    }
    const fallback = parseMoneyValue(matches[matches.length - 1]);
    return Number.isFinite(fallback) ? fallback : NaN;
  }

  function textContainsAmount(text, amount){
    if (!text || !Number.isFinite(amount)) return false;
    const normalizedText = String(text).replace(/\u00a0/g, ' ').replace(/\s+/g, '');
    const fixed2 = amount.toFixed(2);
    const fixed0 = amount % 1 === 0 ? amount.toFixed(0) : fixed2;
    const candidates = [
      '$' + fixed2,
      '$' + fixed2.replace('.', ','),
      '$ ' + fixed2,
      '$' + fixed0,
      '$' + fixed0.replace('.', ','),
      '$ ' + fixed0,
      fixed2,
      fixed2.replace('.', ','),
      fixed0,
      fixed0.replace('.', ',')
    ].map(token => token.replace(/\s+/g, ''));
    return candidates.some(token => token && normalizedText.indexOf(token) !== -1);
  }

  function approxEqual(a, b, tolerance){
    if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
    const limit = Number.isFinite(tolerance) ? tolerance : 0.01;
    return Math.abs(a - b) <= limit;
  }

  function normalizeResultKind(raw){
    if (raw == null) return null;
    const value = String(raw).toLowerCase();
    if (!value) return null;
    if (/(return|refund|tie|draw|equal|push|back)/.test(value)) return 'returned';
    if (/(price-up|arrow-up|trend-up|win|won|success|profit|positive|gain)/.test(value)) return 'win';
    if (/(price-down|arrow-down|trend-down|lose|loss|lost|fail|negative)/.test(value)) return 'loss';
    return null;
  }

  function classifyResultFromPnL(pnl){
    if (!Number.isFinite(pnl)) return null;
    if (pnl > 0.009) return 'win';
    if (pnl < -0.009) return 'loss';
    return 'returned';
  }

  function formatDecisionReason(raw){
    if (!raw) return 'IDLE';
    if (raw === 'minute-strict') return 'STRICT';
    if (raw.indexOf('minute-') === 0) return 'WINDOW';
    const map = {
      auto: 'AUTO',
      init: 'INIT',
      waiting: 'WAIT',
      blocked: 'BLOCKED',
      'manual-off': 'MANUAL',
      'signals-pending': 'PENDING',
      'trade-open': 'OPEN',
      'not-placed': 'BLOCKED',
      'result:won': 'RESULT_WIN',
      'result:lost': 'RESULT_LOSS'
    };
    return map[raw] || raw.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  }

  function applySignClass(node, value){
    if (!node) return;
    node.classList.remove('positive', 'negative');
    if (!Number.isFinite(value) || value === 0) return;
    node.classList.add(value > 0 ? 'positive' : 'negative');
  }

  function parseBetTimeMs(){
    const raw = (betTimeDiv.textContent || betTimeDiv.innerText || '').trim();
    if (!raw) return NaN;
    const parts = raw.split(':');
    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    if (parts.length === 3){
      hours = parseInt(parts[0], 10);
      minutes = parseInt(parts[1], 10);
      seconds = parseInt(parts[2], 10);
    } else if (parts.length === 2){
      minutes = parseInt(parts[0], 10);
      seconds = parseInt(parts[1], 10);
    } else {
      const digits = raw.match(/\d+/g);
      if (!digits || !digits.length) return NaN;
      if (digits.length === 1){
        seconds = parseInt(digits[0], 10);
      } else {
        minutes = parseInt(digits[0], 10);
        seconds = parseInt(digits[1], 10);
      }
    }
    hours = Number.isFinite(hours) ? hours : 0;
    minutes = Number.isFinite(minutes) ? minutes : 0;
    seconds = Number.isFinite(seconds) ? seconds : 0;
    return ((hours * 60 + minutes) * 60 + seconds) * 1000;
  }

  function setDirection(direction, note){
    if (!ui.directionBox) return;
    let bg = colors.gray;
    if (direction === 'buy') bg = colors.green;
    if (direction === 'sell') bg = colors.red;
    ui.directionBox.style.background = bg;
    ui.directionBox.style.padding = '2px 6px';
    ui.directionBox.style.borderRadius = '4px';
    const text = note ? `${direction} (${note})` : direction;
    ui.directionBox.textContent = text;
  }

  function emitShiftKey(code){
    const opts = { keyCode: code, which: code, shiftKey: true, bubbles: true };
    try {
      document.dispatchEvent(new KeyboardEvent('keydown', opts));
      document.dispatchEvent(new KeyboardEvent('keyup', opts));
    } catch (err) {
      console.warn('[Verter] key emit failed', err);
    }
  }

  function queueShiftKey(code, count, offset){
    const total = Math.max(0, count|0);
    let t = offset;
    for (let i = 0; i < total; i++){
      setTimeout(() => emitShiftKey(code), t);
      t += KEY_PRESS_DELAY;
    }
    return t;
  }

  function prepareBetAmount(pressCount){
    const resetEnd = queueShiftKey(KEY_CODES.DOWN, RESET_PRESS_COUNT, 0);
    const adjustEnd = queueShiftKey(KEY_CODES.UP, Math.max(0, pressCount|0), resetEnd + KEY_PRESS_DELAY);
    return adjustEnd + KEY_PRESS_DELAY;
  }

  function findBetInput(){
    if (state.betInput && document.contains(state.betInput)) return state.betInput;
    const selectors = [
      '.call-put-block__in input',
      '.deal__sum input',
      '.deal__amount input',
      'input[name="deal-sum"]',
      'input[data-name="amount"]',
      '.trade__input input',
      '.deal-input input'
    ];
    for (let i = 0; i < selectors.length; i += 1){
      try {
        const node = document.querySelector(selectors[i]);
        if (node){
          state.betInput = node;
          return node;
        }
      } catch (_err){}
    }
    state.betInput = null;
    return null;
  }

  function readBetInputValue(){
    const input = findBetInput();
    if (!input) return NaN;
    let raw = '';
    if (typeof input.value === 'string'){ raw = input.value; }
    if (!raw && typeof input.getAttribute === 'function'){ raw = input.getAttribute('value') || ''; }
    if (!raw && input.dataset && input.dataset.value){ raw = input.dataset.value; }
    return parseMoneyValue(raw);
  }

  function findOrderButton(direction){
    const selectorSets = {
      buy: [
        '.btn.btn-call',
        '.deal-buttons__btn--up',
        'button[data-action="buy"]',
        'button[data-type="call"]',
        '.deal__button--call',
        '.trade__button--up'
      ],
      sell: [
        '.btn.btn-put',
        '.deal-buttons__btn--down',
        'button[data-action="sell"]',
        'button[data-type="put"]',
        '.deal__button--put',
        '.trade__button--down'
      ]
    };
    const list = direction === 'sell' ? selectorSets.sell : selectorSets.buy;
    for (let i = 0; i < list.length; i += 1){
      try {
        const node = document.querySelector(list[i]);
        if (node) return node;
      } catch (_err){}
    }
    return null;
  }

  function schedulePrepare(reason){
    state.lastPrepareReason = reason || state.lastPrepareReason || 'startup';
    if (state.prepareTimer){
      clearTimeout(state.prepareTimer);
      state.prepareTimer = null;
    }
    state.prepareTimer = setTimeout(() => runPrepare(state.lastPrepareReason), 0);
  }

  function runPrepare(reason){
    if (state.prepareLock){
      return;
    }
    const next = state.nextBet || { step: 0, amount: 0, array: state.betArraySelector };
    const expected = Number.isFinite(next.amount) ? next.amount : 0;
    const input = findBetInput();
    state.prepareLock = true;
    if (!input){
      logInfo('PREPARE', `amount=${formatAmount(expected)} status=fail`);
      state.prepareLock = false;
      state.prepareTimer = setTimeout(() => runPrepare(reason), 1500);
      return;
    }
    const entry = state.betArray.find(item => item.step === next.step) || state.betArray[0] || { pressCount: 0 };
    const finishAt = prepareBetAmount(entry.pressCount || 0);
    const verifyDelay = Math.max(0, finishAt + 120);
    setTimeout(() => {
      const actual = readBetInputValue();
      const ok = Number.isFinite(actual) && Number.isFinite(next.amount) && approxEqual(actual, next.amount, 0.01);
      logInfo('PREPARE', `amount=${formatAmount(next.amount)} status=${ok ? 'ok' : 'fail'}`);
      state.prepareLock = false;
      state.prepareTimer = null;
      if (!ok){
        state.prepareTimer = setTimeout(() => runPrepare(reason), 1300);
      }
    }, verifyDelay);
  }

  function clamp(value, min, max){
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function updateChartZoomDisplay(){
    if (ui.chartZoomSlider){ ui.chartZoomSlider.value = String(state.chartOptions.zoom); }
    if (ui.chartZoomValue){ ui.chartZoomValue.textContent = String(state.chartOptions.zoom); }
  }

  function setChartZoom(value){
    const zoom = clamp(Math.round(value), 10, 300);
    if (state.chartOptions.zoom === zoom){
      updateChartZoomDisplay();
      return;
    }
    state.chartOptions.zoom = zoom;
    updateChartZoomDisplay();
    renderChart();
  }

  const mode = (document.querySelector('.balance .js-hd.js-balance-real-USD') ? 'REAL' : 'DEMO');
  const balanceDiv = mode === 'REAL'
    ? document.querySelector('.js-hd.js-balance-real-USD')
    : document.querySelector('.js-hd.js-balance-demo');
  const percentProfitDiv = document.querySelector('.value__val-start');
  const betTimeDiv = document.querySelector('.value__val');
  const symbolDiv = document.querySelector('.current-symbol');
  const tooltipNodes = Array.from(document.getElementsByClassName('tooltip-text'));
  const priceTooltip = tooltipNodes.find(node => /Winnings amount you receive/i.test(node.textContent || ''));

  if (!balanceDiv || !percentProfitDiv || !betTimeDiv || !symbolDiv || !priceTooltip){
    console.error('[Verter] required platform elements were not found');
    return;
  }

  const state = {
    betArray: betArray1,
    currentBetStep: 0,
    betHistory: [],
    betInput: null,
    lastTradeTime: 0,
    lastSignalCheck: 0,
    isTradeOpen: false,
    openTrade: null,
    open: null,
    currentWager: 0,
    currentProfit: 0,
    totalProfit: 0,
    lossStreak: 0,
    maxStep: 0,
    minuteGate: false,
    minuteSignalsPending: true,
    minuteSignals: [],
    latestSignals: [],
    topSignals: [],
    virtualStats: Object.create(null),
    symbol: (symbolDiv.textContent || '').replace('/', ' ').trim(),
    startBalance: parseFloat((balanceDiv.textContent || '0').replace(/,/g, '')) || 0,
    priceHistory: [],
    candles: [],
    currentCandle: null,
    lastSeconds: -1,
    chart: null,
    chartOptions: { zoom: 80, scroll: 0, live: true },
    pauseUntil: 0,
    pauseLossThreshold: 3,
    pauseMinutes: 5,
    betArraySelector: 'A',
    cycleProfit: 0,
    nextBet: { step: 0, amount: betArray1[0].value, array: 'A' },
    minuteBoundaryMode: MINUTE_BOUNDARY_MODE,
    minuteTimer: {
      lastMsLeft: null,
      lastTick: 0,
      cycleMs: 60000,
      activeCycleId: 0,
      tradeCycleId: -1,
      lastBoundary: 0,
      lastDrift: 0,
      windowActivatedAt: 0,
      windowConsumed: false,
      windowSource: 'post',
      targetCycleId: 0
    },
    lastDecision: { direction: 'flat', reason: 'init', trigger: null, at: 0 },
    cycles: [],
    signalCache: Object.create(null),
    pendingTrade: null,
    lastTopHit: null,
    lastOrderDecision: { decision: 'skip', reason: 'init', at: 0 },
    lastResult: { result: null, pnl: 0, at: 0 },
    prepareTimer: null,
    prepareLock: false,
    lastPrepareReason: 'startup',
    lastSnapMinute: null
  };

  const watchers = {
    tradeTimer: null,
    signalTimer: null,
    chartTimer: null
  };

  const closedDealsWatcher = {
    observer: null,
    containers: new Set(),
    scanTimer: null
  };

  const ui = {
    root: null,
    signalBox: null,
    directionBox: null,
    winRateBox: null,
    wagerBox: null,
    totalProfitBox: null,
    cycleProfitBox: null,
    maxStepBox: null,
    lossStreakBox: null,
    topList: null,
    accuracyList: null,
    chartCanvas: null,
    chartCtx: null,
    chartZoomSlider: null,
    chartZoomValue: null,
    cyclesBox: null,
    tradingSymbol: null,
    pauseButton: null
  };

  const SIGNAL_LABELS = {
    ema_bullish: 'EMA Bullish',
    ema_bearish: 'EMA Bearish',
    rsi_oversold: 'RSI Oversold',
    rsi_overbought: 'RSI Overbought',
    macd_bull: 'MACD Bull',
    macd_bear: 'MACD Bear',
    stoch_buy: 'Stochastic Buy',
    stoch_sell: 'Stochastic Sell',
    trend_up: 'Trend Up',
    trend_down: 'Trend Down',
    sr_support: 'Near Support',
    sr_resistance: 'Near Resistance',
    pa_bull: 'Price Action Bull',
    pa_bear: 'Price Action Bear',
    mtf_buy: 'MTF Buy',
    mtf_sell: 'MTF Sell'
  };

  function labelForSignal(key){
    return SIGNAL_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function shortLabelForSignal(key){
    const label = labelForSignal(key);
    if (!label) return String(key || '').toUpperCase();
    const parts = label.split(/\s+/).filter(Boolean);
    if (!parts.length) return String(key || '').toUpperCase();
    if (parts.length === 1) return parts[0].toUpperCase();
    const first = parts[0];
    if (first.length <= 6) return first.toUpperCase();
    return first.slice(0, 5).toUpperCase();
  }

  function setText(node, text){ if (node) node.textContent = text; }
  function setHtml(node, html){ if (node) node.innerHTML = html; }

  function ensureStat(symbol, key){
    if (!state.virtualStats[symbol]) state.virtualStats[symbol] = Object.create(null);
    if (!state.virtualStats[symbol][key]) state.virtualStats[symbol][key] = { wins: 0, losses: 0, n: 0, wr: 0 };
    return state.virtualStats[symbol][key];
  }

  function resetVirtualStats(symbol){
    if (symbol && state.virtualStats[symbol]){
      Object.keys(state.virtualStats[symbol]).forEach(k => {
        state.virtualStats[symbol][k] = { wins: 0, losses: 0, n: 0, wr: 0 };
      });
    }
  }

  function isPaused(){
    return Date.now() < state.pauseUntil;
  }

  function schedulePause(){
    state.pauseUntil = Date.now() + state.pauseMinutes * 60000;
    if (ui.directionBox){
      ui.directionBox.style.background = colors.gray;
      ui.directionBox.textContent = `PAUSED (${state.pauseMinutes}m)`;
    }
  }

  function clearPause(){
    state.pauseUntil = 0;
  }

  function updateMinuteBoundary(now){
    const msLeft = parseBetTimeMs();
    if (!Number.isFinite(msLeft)) return;
    const timer = state.minuteTimer;
    const prevLeft = timer.lastMsLeft;
    const resetTolerance = 1000;

    if (prevLeft != null && msLeft > prevLeft + resetTolerance){
      const consumed = timer.windowConsumed;
      timer.activeCycleId += 1;
      timer.lastBoundary = now;
      timer.lastDrift = Number.isFinite(prevLeft) ? prevLeft : 0;
      timer.windowSource = 'post';
      timer.windowConsumed = false;
      timer.targetCycleId = timer.activeCycleId;
      state.minuteSignalsPending = true;
      state.signalCache = Object.create(null);
      state.pendingTrade = null;

      if (state.minuteBoundaryMode === 'off'){
        state.minuteGate = true;
      } else if (state.minuteBoundaryMode === 'strict'){
        timer.windowSource = 'strict';
        if (timer.tradeCycleId !== timer.targetCycleId){
          state.minuteGate = true;
          timer.windowActivatedAt = now;
        } else {
          state.minuteGate = false;
        }
      } else if (state.minuteBoundaryMode === 'window'){
        if (!consumed && timer.tradeCycleId !== timer.targetCycleId){
          state.minuteGate = true;
          timer.windowActivatedAt = now;
        } else {
          state.minuteGate = false;
        }
      }
    }

    timer.lastMsLeft = msLeft;
    timer.lastTick = now;
    if (msLeft > timer.cycleMs) timer.cycleMs = msLeft;

    if (state.minuteBoundaryMode === 'off'){
      state.minuteGate = true;
      timer.targetCycleId = timer.activeCycleId + 1;
      return;
    }

    if (state.minuteBoundaryMode === 'window'){
      const targetCycleId = timer.activeCycleId + 1;
      if (msLeft <= MINUTE_WINDOW_MS){
        if (!timer.windowConsumed && timer.tradeCycleId !== targetCycleId){
          state.minuteGate = true;
          timer.windowActivatedAt = now;
          timer.windowSource = 'pre';
          timer.targetCycleId = targetCycleId;
        }
      }

      if (state.minuteGate && now - timer.windowActivatedAt > MINUTE_WINDOW_MS){
        state.minuteGate = false;
      }
    } else if (state.minuteBoundaryMode === 'strict'){
      timer.windowSource = 'strict';
      if (state.minuteGate && now - timer.windowActivatedAt > 200){
        state.minuteGate = false;
      }
    }
  }

  function buildUI(){
    const existing = document.getElementById('verter-root');
    if (existing){ existing.remove(); }

    const style = document.createElement('style');
    style.id = 'verter-style';
    style.textContent = `
      #verter-root{position:fixed;left:50%;bottom:8px;transform:translateX(-50%);max-width:calc(100% - 24px);color:#fff;font-family:'Inter',sans-serif;z-index:2147483647;}
      #verter-root *{box-sizing:border-box;}
      .verter-container{display:flex;flex-direction:column;gap:8px;}
      .verter-section{background:#161618;border:1px solid #2a2a2d;border-radius:6px;padding:10px;}
      .verter-section h3{margin:0 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:#9ea0a8;}
      .verter-top-row{display:flex;flex-wrap:wrap;gap:8px;align-items:stretch;}
      .verter-bottom-row{display:flex;flex-wrap:wrap;gap:8px;}
      .verter-trading{flex:0 0 360px;min-width:360px;max-width:360px;}
      .verter-accuracy{flex:0 0 220px;min-width:220px;}
      .verter-chart{flex:1 0 420px;min-width:420px;height:300px;}
      .verter-top-signals{flex:1 1 220px;min-width:220px;}
      .verter-chart canvas{width:100%;height:100%;background:#101014;border-radius:6px;}
      .verter-chart-controls{display:flex;align-items:center;gap:8px;font-size:11px;margin-bottom:8px;color:#9ea0a8;}
      .verter-chart-controls label{font-weight:600;text-transform:uppercase;letter-spacing:0.08em;}
      .verter-chart-controls input[type="range"]{flex:1;}
      .verter-info-table{display:grid;grid-template-columns:1fr auto;gap:4px 12px;font-size:12px;}
      .verter-info-label{opacity:0.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
      .verter-info-value{text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums;}
      .verter-info-value.positive{color:${colors.green};}
      .verter-info-value.negative{color:${colors.red};}
      .verter-info-table.verter-mini{margin-top:6px;}
      .verter-signal-list{max-height:260px;overflow:hidden;font-size:11px;display:flex;flex-direction:column;gap:4px;}
      .verter-signal-row{display:flex;justify-content:space-between;align-items:center;padding:3px 6px;background:#1d1d21;border-radius:4px;}
      .verter-signal-row strong{font-weight:600;}
      .verter-cycles-section{flex:1 1 560px;min-width:360px;}
      .verter-cycles{display:flex;flex-wrap:wrap;gap:4px;max-height:80px;overflow:hidden;}
      .verter-cycle{padding:3px 6px;border-radius:4px;font-size:11px;background:#1f1f23;}
      .verter-pause-section{flex:0 0 320px;min-width:260px;}
      .verter-pause{display:flex;justify-content:space-between;align-items:center;font-size:12px;}
      .verter-btn{background:#1f1f23;color:#fff;border:1px solid #303035;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;}
      .verter-btn:hover{background:#2a2a30;}
    `;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'verter-root';
    Object.assign(root.style,{position:'fixed',left:'50%',top:'',bottom:'8px',transform:'translateX(-50%)',maxWidth:'calc(100% - 24px)',zIndex:2147483647});
    root.style.cursor = 'move';
    root.addEventListener('pointerdown', e => {
      if (e.button!==0) return;
      const r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      root.setPointerCapture(e.pointerId);
      root.style.transform='';
      root.style.bottom='';
      const move = ev => {
        root.style.left = (ev.clientX - dx) + 'px';
        root.style.top = (ev.clientY - dy) + 'px';
      };
      const up = () => { root.releasePointerCapture(e.pointerId); root.removeEventListener('pointermove',move); root.removeEventListener('pointerup',up); };
      root.addEventListener('pointermove',move); root.addEventListener('pointerup',up);
    });

    const container = document.createElement('div');
    container.className = 'verter-container';

    const topRow = document.createElement('div');
    topRow.className = 'verter-top-row';

    const tradingSection = document.createElement('div');
    tradingSection.className = 'verter-section verter-trading';
    const tradingTitle = document.createElement('h3');
    tradingTitle.textContent = 'Trading · ' + state.symbol;
    const tradingTable = document.createElement('div');
    tradingTable.className = 'verter-info-table';

    function addTradingRow(id, label, value){
      const labelNode = document.createElement('span');
      labelNode.className = 'verter-info-label';
      labelNode.textContent = label;
      const valueNode = document.createElement('span');
      valueNode.className = 'verter-info-value';
      valueNode.id = id;
      valueNode.textContent = value;
      tradingTable.appendChild(labelNode);
      tradingTable.appendChild(valueNode);
      return valueNode;
    }

    ui.tradingSymbol = tradingTitle;
    ui.wagerBox = addTradingRow('verter-wager', 'Current Wager', fmtMoney(0));
    ui.cycleProfitBox = addTradingRow('verter-cycle', 'Cycle Profit', fmtMoney(0));
    ui.totalProfitBox = addTradingRow('verter-total', 'Total Profit', fmtMoney(0));
    ui.winRateBox = addTradingRow('verter-winrate', 'Win Rate %', '0%');
    ui.lossStreakBox = addTradingRow('verter-losses', 'Loss Streak', '0');
    ui.maxStepBox = addTradingRow('verter-step', 'Max Step', '0');

    const signalTable = document.createElement('div');
    signalTable.className = 'verter-info-table verter-mini';
    const signalLabel = document.createElement('span');
    signalLabel.className = 'verter-info-label';
    signalLabel.textContent = 'Signal';
    const signalValue = document.createElement('span');
    signalValue.className = 'verter-info-value';
    signalValue.id = 'verter-signal';
    signalValue.textContent = '—';
    const directionLabel = document.createElement('span');
    directionLabel.className = 'verter-info-label';
    directionLabel.textContent = 'Direction';
    const directionValue = document.createElement('span');
    directionValue.className = 'verter-info-value';
    directionValue.id = 'verter-direction';
    directionValue.textContent = 'flat';
    signalTable.appendChild(signalLabel);
    signalTable.appendChild(signalValue);
    signalTable.appendChild(directionLabel);
    signalTable.appendChild(directionValue);

    tradingSection.append(tradingTitle, tradingTable, signalTable);

    const accuracySection = document.createElement('div');
    accuracySection.className = 'verter-section verter-accuracy';
    accuracySection.innerHTML = `
      <h3>Signals Accuracy</h3>
      <div id="verter-accuracy" class="verter-signal-list"></div>
    `;

    const topSection = document.createElement('div');
    topSection.className = 'verter-section verter-top-signals';
    topSection.innerHTML = `
      <h3>Top Signals</h3>
      <div id="verter-top" class="verter-signal-list"></div>
    `;

    const chartSection = document.createElement('div');
    chartSection.className = 'verter-section verter-chart';
    chartSection.innerHTML = `
      <h3>Candle Chart</h3>
      <div class="verter-chart-controls">
        <label for="verter-chart-zoom">Zoom</label>
        <input id="verter-chart-zoom" type="range" min="10" max="300" step="1" value="${state.chartOptions.zoom}">
        <span id="verter-chart-zoom-value">${state.chartOptions.zoom}</span>
      </div>
      <canvas id="verter-chart" width="600" height="280"></canvas>
    `;

    topRow.append(tradingSection, accuracySection, chartSection, topSection);

    const bottomRow = document.createElement('div');
    bottomRow.className = 'verter-bottom-row';

    const cyclesSection = document.createElement('div');
    cyclesSection.className = 'verter-section verter-cycles-section';
    cyclesSection.innerHTML = `
      <h3>Cycles History</h3>
      <div id="verter-cycles" class="verter-cycles"></div>
    `;

    const pauseSection = document.createElement('div');
    pauseSection.className = 'verter-section verter-pause-section';
    pauseSection.innerHTML = `
      <div class="verter-pause">
        <span>Auto-pause after loss streak</span>
        <button id="verter-pause-reset" class="verter-btn">Pause Reset</button>
      </div>
    `;

    bottomRow.append(cyclesSection, pauseSection);
    container.append(topRow, bottomRow);
    root.appendChild(container);
    document.body.appendChild(root);

    ui.root = root;
    ui.signalBox = root.querySelector('#verter-signal');
    ui.directionBox = root.querySelector('#verter-direction');
    ui.winRateBox = root.querySelector('#verter-winrate');
    ui.wagerBox = root.querySelector('#verter-wager');
    ui.totalProfitBox = root.querySelector('#verter-total');
    ui.maxStepBox = root.querySelector('#verter-step');
    ui.lossStreakBox = root.querySelector('#verter-losses');
    ui.pauseButton = root.querySelector('#verter-pause-reset');
    ui.topList = root.querySelector('#verter-top');
    ui.accuracyList = root.querySelector('#verter-accuracy');
    ui.chartCanvas = root.querySelector('#verter-chart');
    ui.chartCtx = ui.chartCanvas ? ui.chartCanvas.getContext('2d') : null;
    ui.chartZoomSlider = root.querySelector('#verter-chart-zoom');
    ui.chartZoomValue = root.querySelector('#verter-chart-zoom-value');
    ui.cyclesBox = root.querySelector('#verter-cycles');

    if (ui.pauseButton){
      ui.pauseButton.addEventListener('click', () => {
        clearPause();
        state.lastOrderDecision = { decision: 'skip', reason: 'pause_reset', at: Date.now() };
        logInfo('ORDER', 'decision=skip reason=pause_reset');
      });
    }

    if (ui.chartZoomSlider){
      ui.chartZoomSlider.addEventListener('input', ev => {
        const next = parseInt(ev.target.value, 10);
        if (!Number.isFinite(next)) return;
        setChartZoom(next);
      });
    }

    if (ui.chartCanvas){
      const wheelHandler = ev => {
        ev.preventDefault();
        const delta = ev.deltaY < 0 ? -5 : 5;
        setChartZoom(state.chartOptions.zoom + delta);
      };
      try {
        ui.chartCanvas.addEventListener('wheel', wheelHandler, { passive: false });
      } catch (err){
        ui.chartCanvas.addEventListener('wheel', wheelHandler);
      }
    }

    renderBadges();
    updateChartZoomDisplay();

    setDirection('flat');
  }

  function updateTradingInfo(){
    const symbolText = (symbolDiv.textContent || '').replace('/', ' ').trim();
    const winCount = state.betHistory.filter(t => t.result === 'won').length;
    const tradeCount = state.betHistory.length;
    const rate = tradeCount ? (winCount / tradeCount) * 100 : 0;

    if (ui.tradingSymbol) ui.tradingSymbol.textContent = 'Trading · ' + symbolText;
    if (ui.wagerBox){
      ui.wagerBox.textContent = fmtMoney(state.currentWager);
      applySignClass(ui.wagerBox, state.currentWager);
    }
    if (ui.cycleProfitBox){
      ui.cycleProfitBox.textContent = fmtMoney(state.cycleProfit);
      applySignClass(ui.cycleProfitBox, state.cycleProfit);
    }
    if (ui.totalProfitBox){
      ui.totalProfitBox.textContent = fmtMoney(state.totalProfit);
      applySignClass(ui.totalProfitBox, state.totalProfit);
    }
    if (ui.winRateBox) ui.winRateBox.textContent = rate.toFixed(1) + '%';
    if (ui.lossStreakBox) ui.lossStreakBox.textContent = String(state.lossStreak);
    if (ui.maxStepBox) ui.maxStepBox.textContent = String(state.maxStep || 0);
  }

  function renderSignals(list, data){
    if (!list) return;
    if (!data.length){
      list.innerHTML = '<div style="opacity:0.6;">No data</div>';
      return;
    }
    list.innerHTML = data.map(item => {
      return `<div class="verter-signal-row"><strong>${item.label}</strong><span>${item.value}</span></div>`;
    }).join('');
  }

  function handleTopSignalHit(signal, timestamp){
    const ts = Number.isFinite(timestamp) ? timestamp : Date.now();
    const topIndex = state.topSignals.findIndex(item => item.key === signal.key);
    if (topIndex === -1) return;
    const topItem = state.topSignals[topIndex] || {};
    const score = Number.isFinite(topItem.wr) ? Math.round(topItem.wr * 100 - 50) : 0;
    state.pendingTrade = {
      key: signal.key,
      direction: signal.direction,
      rank: topIndex + 1,
      score,
      at: ts
    };
    state.lastTopHit = {
      key: signal.key,
      direction: signal.direction,
      at: ts
    };
    const logMessage = `key=${signal.key} dir=${String(signal.direction).toUpperCase()} rank=${topIndex + 1}`;
    logInfo('QUEUE', logMessage);
  }

  function renderAccuracy(){
    const stats = state.virtualStats[state.symbol] || {};
    const rows = Object.keys(stats)
      .map(key => ({
        key,
        wr: stats[key].wr,
        wins: stats[key].wins,
        losses: stats[key].losses,
        n: stats[key].n
      }))
      .sort((a, b) => b.wr - a.wr || b.n - a.n)
      .map(item => ({
        label: `${labelForSignal(item.key)} (${item.n})`,
        value: fmtPct(item.wr * 100)
      }));
    renderSignals(ui.accuracyList, rows);
  }

  function renderTopSignals(){
    const rows = state.topSignals.map(sig => ({
      label: `${labelForSignal(sig.key)} (${sig.n})`,
      value: fmtPct(sig.wr * 100)
    }));
    renderSignals(ui.topList, rows);
  }

  function renderCycles(){
    if (!ui.cyclesBox) return;
    if (!state.cycles.length){
      ui.cyclesBox.innerHTML = '<div style="opacity:0.6;">No trades yet</div>';
      return;
    }
    ui.cyclesBox.innerHTML = state.cycles.slice(-20).map(item => {
      const color = item.result === 'won'
        ? colors.green
        : (item.result === 'lost' ? colors.red : colors.gray);
      return `<div class="verter-cycle" style="background:${color}1a;border:1px solid ${color};">${item.result.toUpperCase()} · ${fmtMoney(item.profit)} · step ${item.step}</div>`;
    }).join('');
  }

  function renderChart(){
    const canvas = ui.chartCanvas;
    const ctx = ui.chartCtx;
    if (!canvas || !ctx) return;
    const candles = state.candles;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!candles.length) return;
    const visible = Math.min(state.chartOptions.zoom, candles.length);
    const slice = candles.slice(-visible);
    const min = Math.min(...slice.map(c => c.low));
    const max = Math.max(...slice.map(c => c.high));
    const range = max - min || 1;
    const width = W / slice.length;
    slice.forEach((candle, idx) => {
      const x = idx * width;
      const highY = H - ((candle.high - min) / range) * H;
      const lowY = H - ((candle.low - min) / range) * H;
      const openY = H - ((candle.open - min) / range) * H;
      const closeY = H - ((candle.close - min) / range) * H;
      ctx.beginPath();
      ctx.strokeStyle = '#555';
      ctx.moveTo(x + width / 2, highY);
      ctx.lineTo(x + width / 2, lowY);
      ctx.stroke();
      ctx.fillStyle = candle.close >= candle.open ? colors.green : colors.red;
      const top = Math.min(openY, closeY);
      const height = Math.max(1, Math.abs(closeY - openY));
      ctx.fillRect(x + 2, top, Math.max(3, width - 4), height);
    });
  }

  function parsePrice(){
    const match = priceTooltip.innerHTML.match(/\d+\.\d+/);
    return match ? parseFloat(match[0]) : NaN;
  }

  function updatePrice(){
    const price = parsePrice();
    if (!Number.isFinite(price)) return;

    const now = Date.now();
    state.priceHistory.push(price);
    if (state.priceHistory.length > 600) state.priceHistory.shift();
    updateCandles(now, price);
  }

  function updateCandles(now, price){
    if (!state.currentCandle){
      state.currentCandle = {
        tOpen: now,
        tClose: now,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0
      };
      state.candles.push(state.currentCandle);
    }

    const currentSeconds = new Date(now).getSeconds();
    const prevSeconds = state.lastSeconds;

    if (currentSeconds === 0 && prevSeconds !== 0){
      state.currentCandle.tClose = now;
      state.currentCandle.close = price;
      handleMinuteClose(state.currentCandle);
      const newCandle = {
        tOpen: now,
        tClose: now,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0
      };
      state.currentCandle = newCandle;
      state.candles.push(newCandle);
      if (state.candles.length > MAX_CANDLES) state.candles.shift();
    } else {
      state.currentCandle.tClose = now;
      state.currentCandle.close = price;
    }

    if (price > state.currentCandle.high) state.currentCandle.high = price;
    if (price < state.currentCandle.low) state.currentCandle.low = price;
    state.currentCandle.volume += 1;

    state.lastSeconds = currentSeconds;
  }

  function handleMinuteClose(candle){
    const symbol = state.symbol;
    const list = state.candles;
    if (!list.length) return;
    const idx = list.length - 1;
    const horizon = Math.max(1, PAPER_HORIZON);
    const fromIdx = Math.max(0, idx - (horizon - 1));
    const openPrice = list[fromIdx].open;
    const closePrice = list[idx].close;
    const delta = closePrice - openPrice;
    const resultDirection = delta > 0 ? 'buy' : (delta < 0 ? 'sell' : 'flat');

    const payout = parseInt(percentProfitDiv.textContent || percentProfitDiv.innerText || '0', 10);
    const topNames = state.topSignals.slice(0, 3).map(sig => shortLabelForSignal(sig.key));
    const decisionPlaced = state.lastDecision && state.lastDecision.direction && state.lastDecision.direction !== 'flat';
    const triggerTag = state.lastDecision && state.lastDecision.trigger ? shortLabelForSignal(state.lastDecision.trigger) : null;
    const includeBoundaryFields = state.minuteBoundaryMode === 'window' || state.minuteBoundaryMode === 'strict';
    const boundaryReason = includeBoundaryFields
      ? formatDecisionReason(state.minuteBoundaryMode === 'strict' ? 'minute-strict' : 'minute-window')
      : null;
    const driftLabel = includeBoundaryFields
      ? formatSigned(Number.isFinite(state.minuteTimer.lastDrift) ? state.minuteTimer.lastDrift : 0, 'ms')
      : null;
    const label = 'M1 ' + humanTime(candle.tClose || Date.now());
    const messageParts = [
      `${symbol}`,
      `o=${fmt2(candle.open, 5)}`,
      `h=${fmt2(candle.high, 5)}`,
      `l=${fmt2(candle.low, 5)}`,
      `c=${fmt2(candle.close, 5)}`,
      `payout=${Number.isFinite(payout) ? payout : '—'}`,
      `top=[${topNames.join(',')}]`
    ];
    if (triggerTag) messageParts.push(`via=${triggerTag}`);
    messageParts.push(`decision=${decisionPlaced ? 'place' : 'hold'}`);
    if (includeBoundaryFields){
      messageParts.push(`reason=${boundaryReason}`);
      messageParts.push(`drift_ms=${driftLabel}`);
    }
    logM1CloseEvent({ label, text: messageParts.join(' ') });

    if (resultDirection === 'flat'){ return; }

    state.minuteSignals.forEach(sig => {
      const stat = ensureStat(symbol, sig.key);
      if (sig.direction === resultDirection){
        stat.wins += 1;
      } else {
        stat.losses += 1;
      }
      stat.n += 1;
      stat.wr = stat.n ? stat.wins / stat.n : 0;
    });

    recomputeTopSignals();
    renderAccuracy();
    renderTopSignals();
    renderChart();
  }

  function recomputeTopSignals(){
    const stats = state.virtualStats[state.symbol] || {};
    const rows = Object.keys(stats)
      .map(key => ({
        key,
        wins: stats[key].wins,
        losses: stats[key].losses,
        n: stats[key].n,
        wr: stats[key].wr
      }))
      .filter(item => item.n >= MIN_TRADES)
      .sort((a, b) => b.wr - a.wr || b.n - a.n)
      .slice(0, TOP_K);
    state.topSignals = rows;
  }

  function ema(values, period){
    const k = 2 / (period + 1);
    let emaPrev = values[0];
    const out = [];
    values.forEach((price, idx) => {
      if (idx === 0){
        emaPrev = price;
      } else {
        emaPrev = price * k + emaPrev * (1 - k);
      }
      out.push(emaPrev);
    });
    return out;
  }

  function sma(values, period){
    const out = [];
    for (let i = 0; i < values.length; i++){
      const start = Math.max(0, i - period + 1);
      const slice = values.slice(start, i + 1);
      const avg = slice.reduce((sum, val) => sum + val, 0) / slice.length;
      out.push(avg);
    }
    return out;
  }

  function rsi(values, period){
    if (values.length <= period) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i++){
      const diff = values[i] - values[i - 1];
      if (diff >= 0) gains += diff; else losses -= diff;
    }
    gains /= period;
    losses /= period;
    for (let i = period + 1; i < values.length; i++){
      const diff = values[i] - values[i - 1];
      if (diff >= 0){
        gains = (gains * (period - 1) + diff) / period;
        losses = (losses * (period - 1)) / period;
      } else {
        gains = (gains * (period - 1)) / period;
        losses = (losses * (period - 1) - diff) / period;
      }
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
  }

  function macd(values){
    const ema12 = ema(values, 12);
    const ema26 = ema(values, 26);
    return values.map((_, idx) => ema12[idx] - ema26[idx]);
  }

  function stochastic(candles, period = 14){
    if (candles.length < period) return { k: 50, d: 50 };
    const slice = candles.slice(-period);
    const highs = slice.map(c => c.high);
    const lows = slice.map(c => c.low);
    const closes = slice.map(c => c.close);
    const highest = Math.max(...highs);
    const lowest = Math.min(...lows);
    const current = closes[closes.length - 1];
    const k = highest === lowest ? 50 : ((current - lowest) / (highest - lowest)) * 100;
    return { k, d: k };
  }

  function priceAction(candles){
    if (candles.length < 2) return 'neutral';
    const prev = candles[candles.length - 2];
    const last = candles[candles.length - 1];
    const bullish = last.close > last.open && prev.close < prev.open && last.close > prev.open;
    const bearish = last.close < last.open && prev.close > prev.open && last.close < prev.open;
    if (bullish) return 'bull';
    if (bearish) return 'bear';
    return 'neutral';
  }

  function trend(candles){
    if (candles.length < 10) return 'flat';
    const closes = candles.map(c => c.close);
    const ma = sma(closes, 10);
    const last = closes[closes.length - 1];
    const avg = ma[ma.length - 1];
    if (last > avg * 1.0005) return 'up';
    if (last < avg * 0.9995) return 'down';
    return 'flat';
  }

  function supportResistance(candles, lookback = 20){
    if (candles.length < lookback) return { support: false, resistance: false };
    const slice = candles.slice(-lookback);
    const last = slice[slice.length - 1].close;
    const highs = slice.map(c => c.high);
    const lows = slice.map(c => c.low);
    const max = Math.max(...highs);
    const min = Math.min(...lows);
    const tol = (max - min) * 0.1;
    return {
      support: Math.abs(last - min) < tol,
      resistance: Math.abs(last - max) < tol
    };
  }

  function multiTimeframe(candles){
    if (candles.length < 25) return 'flat';
    const closes = candles.map(c => c.close);
    const m1 = closes.slice(-15);
    const m5 = closes.slice(-25).filter((_, idx) => idx % 5 === 0);
    const emaShort = ema(m1, Math.min(5, m1.length));
    const emaLong = ema(m5, Math.min(5, m5.length));
    const lastShort = emaShort[emaShort.length - 1];
    const lastLong = emaLong[emaLong.length - 1];
    if (lastShort > lastLong) return 'buy';
    if (lastShort < lastLong) return 'sell';
    return 'flat';
  }

  function evaluateSignals(){
    if (!state.candles.length) return;
    const candles = state.candles.slice(-80);
    const closes = candles.map(c => c.close);
    if (closes.length < 20) return;

    const emaFast = ema(closes, 9);
    const emaSlow = ema(closes, 21);
    const emaDiff = emaFast[emaFast.length - 1] - emaSlow[emaSlow.length - 1];
    const rsiValue = rsi(closes, 14);
    const macdValues = macd(closes);
    const macdLast = macdValues[macdValues.length - 1];
    const stochValue = stochastic(candles);
    const pa = priceAction(candles);
    const trendDir = trend(candles);
    const sr = supportResistance(candles);
    const mtf = multiTimeframe(candles);

    const snapshot = [];
    if (emaDiff > 0){ snapshot.push({ key: 'ema_bullish', direction: 'buy' }); }
    if (emaDiff < 0){ snapshot.push({ key: 'ema_bearish', direction: 'sell' }); }
    if (rsiValue < 30){ snapshot.push({ key: 'rsi_oversold', direction: 'buy' }); }
    if (rsiValue > 70){ snapshot.push({ key: 'rsi_overbought', direction: 'sell' }); }
    if (macdLast > 0){ snapshot.push({ key: 'macd_bull', direction: 'buy' }); }
    if (macdLast < 0){ snapshot.push({ key: 'macd_bear', direction: 'sell' }); }
    if (stochValue.k < 20){ snapshot.push({ key: 'stoch_buy', direction: 'buy' }); }
    if (stochValue.k > 80){ snapshot.push({ key: 'stoch_sell', direction: 'sell' }); }
    if (trendDir === 'up'){ snapshot.push({ key: 'trend_up', direction: 'buy' }); }
    if (trendDir === 'down'){ snapshot.push({ key: 'trend_down', direction: 'sell' }); }
    if (sr.support){ snapshot.push({ key: 'sr_support', direction: 'buy' }); }
    if (sr.resistance){ snapshot.push({ key: 'sr_resistance', direction: 'sell' }); }
    if (pa === 'bull'){ snapshot.push({ key: 'pa_bull', direction: 'buy' }); }
    if (pa === 'bear'){ snapshot.push({ key: 'pa_bear', direction: 'sell' }); }
    if (mtf === 'buy'){ snapshot.push({ key: 'mtf_buy', direction: 'buy' }); }
    if (mtf === 'sell'){ snapshot.push({ key: 'mtf_sell', direction: 'sell' }); }

    const nowTs = Date.now();
    const cache = state.signalCache;
    const activeKeys = Object.create(null);
    snapshot.forEach(sig => {
      activeKeys[sig.key] = true;
      const prev = cache[sig.key];
      const changed = !prev || prev.direction !== sig.direction;
      if (changed){
        handleTopSignalHit(sig, nowTs);
      }
      cache[sig.key] = { direction: sig.direction, at: nowTs };
    });
    Object.keys(cache).forEach(key => {
      if (!activeKeys[key]) delete cache[key];
    });

    state.latestSignals = snapshot;
    setText(ui.signalBox, snapshot.length ? snapshot.map(s => labelForSignal(s.key)).join(', ') : '—');

    if (state.minuteSignalsPending){
      state.minuteSignals = snapshot.map(item => ({ key: item.key, direction: item.direction }));
      state.minuteSignalsPending = false;
    }
  }

  function getBetValue(step){
    const arr = state.betArray;
    const found = arr.find(item => item.step === step);
    return found ? found.value : arr[0].value;
  }

  function recordNextBet(reason, prevStep, nextStep){
    const amount = getBetValue(nextStep);
    const arrName = state.betArraySelector;
    state.nextBet = { step: nextStep, amount, array: arrName };
    state.lastPrepareReason = reason;
    const message = `reason=${reason} step=${prevStep}→${nextStep} amt=${formatAmount(amount)} arr=${arrName}`;
    logNextBetCalcEvent(message);
  }

  function applyMartingale(result){
    const prevStep = state.currentBetStep;
    if (result === 'won'){
      state.currentBetStep = 0;
      state.lossStreak = 0;
    } else if (result === 'lost'){
      state.currentBetStep = Math.min(state.currentBetStep + 1, state.betArray.length - 1);
      state.lossStreak += 1;
      if (state.lossStreak >= state.pauseLossThreshold){
        schedulePause();
      }
    } else if (result === 'returned'){
      state.lossStreak = 0;
    }
    if (!state.maxStep || state.currentBetStep > state.maxStep){
      state.maxStep = state.currentBetStep;
    }
    recordNextBet(result === 'won' ? 'after_win' : (result === 'lost' ? 'after_loss' : 'returned'), prevStep, state.currentBetStep);
  }

  function placeTrade(direction, timestamp, meta){
    const now = Number.isFinite(timestamp) ? timestamp : Date.now();
    if (state.isTradeOpen){
      return { placed: false, reason: 'open' };
    }
    const expectedAmount = state.nextBet && Number.isFinite(state.nextBet.amount) ? state.nextBet.amount : NaN;
    const actualAmount = readBetInputValue();
    if (!Number.isFinite(expectedAmount) || !Number.isFinite(actualAmount) || !approxEqual(actualAmount, expectedAmount, 0.01)){
      return { placed: false, reason: 'prepared_mismatch' };
    }
    const payout = parseInt(percentProfitDiv.textContent || percentProfitDiv.innerText || '0', 10);
    if (!Number.isFinite(payout) || payout < MIN_PROFIT){
      return { placed: false, reason: 'minProfit' };
    }
    if (isPaused()){
      return { placed: false, reason: 'pause' };
    }
    const button = findOrderButton(direction);
    if (!button){
      return { placed: false, reason: 'selector' };
    }
    try {
      button.click();
    } catch (_err){
      return { placed: false, reason: 'selector' };
    }

    const nextStep = state.nextBet ? state.nextBet.step : state.currentBetStep;
    const trade = {
      time: humanTime(now),
      openedAt: now,
      direction,
      step: nextStep,
      amount: expectedAmount,
      symbol: state.symbol,
      pnl: 0,
      result: null,
      closedAt: null,
      signals: state.minuteSignals.map(s => s.key),
      trigger: meta && meta.key ? meta.key : null,
      triggerRank: meta && meta.rank ? meta.rank : null,
      triggerScore: meta && Number.isFinite(meta.score) ? meta.score : null,
      cycle: state.minuteTimer.activeCycleId
    };
    state.betHistory.push(trade);
    state.lastTradeTime = now;
    state.isTradeOpen = true;
    state.openTrade = {
      symbol: trade.symbol,
      symbolKey: makeSymbolKey(trade.symbol),
      amount: trade.amount,
      step: trade.step,
      direction: trade.direction,
      openedAt: trade.openedAt,
      index: state.betHistory.length - 1
    };
    state.open = {
      symbol: trade.symbol,
      dir: trade.direction,
      amount: trade.amount,
      openedAt: trade.openedAt
    };
    state.currentWager = trade.amount;
    state.minuteTimer.windowConsumed = true;
    state.minuteTimer.tradeCycleId = state.minuteTimer.activeCycleId;
    state.lastDecision = { direction, reason: 'signal', trigger: trade.trigger, at: now };
    setDirection(direction, meta && meta.key ? shortLabelForSignal(meta.key) : 'opened');
    updateTradingInfo();
    return { placed: true, reason: null };
  }

  function tradeLogic(now){
    const candidate = state.pendingTrade;
    if (!candidate) return;

    state.pendingTrade = null;
    const result = placeTrade(candidate.direction, now, candidate);
    if (result.placed){
      logInfo('ORDER', `decision=place dir=${candidate.direction} key=${candidate.key}`);
      state.lastOrderDecision = { decision: 'place', reason: 'ok', at: now };
    } else {
      const reason = result.reason || 'unknown';
      logInfo('ORDER', `decision=skip reason=${reason} dir=${candidate.direction} key=${candidate.key}`);
      state.lastOrderDecision = { decision: 'skip', reason, at: now };
      if (reason === 'prepared_mismatch'){
        schedulePrepare(state.lastPrepareReason || 'startup');
      }
      state.lastDecision = { direction: 'flat', reason, trigger: candidate.key, at: now };
      if (reason !== 'open') setDirection('flat', reason);
    }
  }

  function logMinuteSnapshot(now){
    const date = new Date(now);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const key = hh + ':' + mm;
    if (state.lastSnapMinute === key) return;
    state.lastSnapMinute = key;

    const payoutRaw = parseInt(percentProfitDiv.textContent || percentProfitDiv.innerText || '0', 10);
    const payoutText = Number.isFinite(payoutRaw) ? payoutRaw : '—';
    const topKeys = state.topSignals.slice(0, TOP_K).map(sig => sig.key).join(',');
    const topText = topKeys || '—';
    const lastHitDir = state.lastTopHit && state.lastTopHit.direction
      ? String(state.lastTopHit.direction).toUpperCase()
      : null;
    const lastHit = state.lastTopHit
      ? `${state.lastTopHit.key}@${humanTime(state.lastTopHit.at)}(+${lastHitDir || '—'})`
      : '—';
    const pendingDir = state.pendingTrade && state.pendingTrade.direction
      ? state.pendingTrade.direction.toUpperCase()
      : '—';
    const pendingAgeSeconds = state.pendingTrade ? Math.max(0, Math.round((now - state.pendingTrade.at) / 1000)) : null;
    const pendingAgeText = pendingAgeSeconds == null ? '—' : pendingAgeSeconds + 's';
    const next = state.nextBet || { step: 0, amount: 0, array: state.betArraySelector };
    const order = state.lastOrderDecision || { decision: 'skip', reason: 'init' };
    const orderText = order.decision === 'place'
      ? 'place'
      : `skip(reason=${order.reason || 'none'})`;
    const lastRes = state.lastResult || {};
    const resultLabel = lastRes.result === 'won'
      ? 'win'
      : (lastRes.result === 'lost' ? 'loss' : (lastRes.result === 'returned' ? 'returned' : '—'));
    const resultPnl = Number.isFinite(lastRes.pnl) ? formatSignedFixed(lastRes.pnl) : formatSignedFixed(0);
    const resultAgeMinutes = lastRes.at ? ((now - lastRes.at) / 60000) : NaN;
    const resultAgeText = Number.isFinite(resultAgeMinutes) ? resultAgeMinutes.toFixed(1) : '—';
    const candle = state.candles.length ? state.candles[state.candles.length - 1] : state.currentCandle;
    const candleOpen = candle ? fmt(candle.open) : '—';
    const candleHigh = candle ? fmt(candle.high) : '—';
    const candleLow = candle ? fmt(candle.low) : '—';
    const candleClose = candle ? fmt(candle.close) : '—';

    const lines = [
      `sym=${state.symbol || '—'} pay=${payoutText} thr=${MIN_PROFIT}`,
      `top=[${topText}] lastTopHit=${lastHit}`,
      `pending=${pendingDir} age=${pendingAgeText} isOpen=${state.isTradeOpen}`,
      `next(step=${next.step} amt=${formatAmount(next.amount)} arr=${next.array})`,
      `order=${orderText}`,
      `lastResult=${resultLabel} pnl=${resultPnl} t=${resultAgeText}m`,
      `m1:o=${candleOpen} h=${candleHigh} l=${candleLow} c=${candleClose}`
    ];
    logInfo('SNAP ' + key, lines.join('\n'));
  }

  function syncProfit(){
    const balance = parseFloat((balanceDiv.textContent || '0').replace(/,/g, '')) || 0;
    const profit = balance - state.startBalance;
    state.currentProfit = profit;
    state.totalProfit = profit;
  }

  function normalizeTradeResultPayload(result, fallbackTrade){
    if (result == null) return null;
    const normalized = {
      displayResult: null,
      stateResult: null,
      pnl: NaN,
      amount: NaN,
      symbol: null,
      closedAt: Date.now(),
      source: null
    };

    if (typeof result === 'object'){
      normalized.source = result.source || null;
      const amountCandidates = [
        result.amount,
        result.sum,
        result.investment,
        result.volume,
        result.value,
        result.bet
      ];
      for (const candidate of amountCandidates){
        const value = parseMoneyValue(candidate);
        if (Number.isFinite(value)){
          normalized.amount = value;
          break;
        }
      }

      const pnlCandidates = [
        result.pnl,
        result.profit,
        result.payout,
        result.delta,
        result.pl
      ];
      for (const candidate of pnlCandidates){
        const value = parseMoneyValue(candidate);
        if (Number.isFinite(value)){
          normalized.pnl = value;
          break;
        }
      }

      if (!Number.isFinite(normalized.pnl) && result.meta){
        const metaCandidates = [
          result.meta.pnl,
          result.meta.profit,
          result.meta.payout
        ];
        for (const candidate of metaCandidates){
          const value = parseMoneyValue(candidate);
          if (Number.isFinite(value)){
            normalized.pnl = value;
            break;
          }
        }
      }

      if (Number.isFinite(result.closedAt)){
        normalized.closedAt = result.closedAt;
      } else if (Number.isFinite(result.closed)){
        normalized.closedAt = result.closed;
      } else if (Number.isFinite(result.time)){
        normalized.closedAt = result.time;
      }

      const symbolCandidates = [
        result.symbol,
        result.asset,
        result.pair,
        result.underlying
      ];
      for (const candidate of symbolCandidates){
        if (candidate){
          const label = normalizeSymbolLabel(candidate);
          if (label){
            normalized.symbol = label;
            break;
          }
        }
      }

      const statusCandidates = [
        result.displayResult,
        result.result,
        result.status,
        result.state,
        result.outcome,
        result.type,
        result.winStatus
      ];
      for (const candidate of statusCandidates){
        const mapped = normalizeResultKind(candidate);
        if (mapped){
          normalized.displayResult = mapped;
          break;
        }
      }

      if (!normalized.displayResult && typeof result.won === 'boolean'){
        normalized.displayResult = result.won ? 'win' : 'loss';
      }
      if (!normalized.displayResult && typeof result.success === 'boolean'){
        normalized.displayResult = result.success ? 'win' : 'loss';
      }
    } else if (typeof result === 'string'){
      normalized.displayResult = normalizeResultKind(result);
      if (!normalized.displayResult){
        const parsed = parseMoneyValue(result);
        if (Number.isFinite(parsed)){
          normalized.pnl = parsed;
          normalized.displayResult = classifyResultFromPnL(parsed);
        }
      }
    } else if (typeof result === 'number'){
      normalized.pnl = result;
      normalized.displayResult = classifyResultFromPnL(result);
    } else if (typeof result === 'boolean'){
      normalized.displayResult = result ? 'win' : 'loss';
    }

    if (!normalized.displayResult && Number.isFinite(normalized.pnl)){
      normalized.displayResult = classifyResultFromPnL(normalized.pnl);
    }
    if (!normalized.displayResult && fallbackTrade && Number.isFinite(fallbackTrade.pnl)){
      normalized.displayResult = classifyResultFromPnL(fallbackTrade.pnl);
    }
    if (!normalized.displayResult) normalized.displayResult = 'loss';

    normalized.stateResult = normalized.displayResult === 'win'
      ? 'won'
      : (normalized.displayResult === 'loss' ? 'lost' : 'returned');

    return normalized;
  }

  function onTradeResult(result){
    state.isTradeOpen = false;
    state.openTrade = null;
    state.open = null;
    const last = state.betHistory[state.betHistory.length - 1];
    if (!last) return;
    if (result == null) return;

    if (!last.symbol) last.symbol = state.symbol;

    const normalized = normalizeTradeResultPayload(result, last);
    if (!normalized) return;

    if (Number.isFinite(normalized.amount)) last.amount = normalized.amount;
    if (normalized.symbol) last.symbol = normalized.symbol;

    const prevTotal = state.totalProfit;
    syncProfit();
    let pnl = Number.isFinite(normalized.pnl) ? normalized.pnl : state.totalProfit - prevTotal;
    if (!Number.isFinite(pnl)) pnl = 0;

    last.pnl = pnl;
    last.result = normalized.stateResult;
    last.closedAt = Number.isFinite(normalized.closedAt) ? normalized.closedAt : Date.now();

    state.currentWager = 0;
    state.cycleProfit += pnl;
    if (last.result === 'won') state.cycleProfit = 0;
    applyMartingale(last.result);
    setDirection('flat', last.result);
    state.cycles.push({ result: last.result, profit: state.currentProfit, step: last.step });
    if (state.cycles.length > 24) state.cycles.shift();
    const now = Date.now();
    state.lastDecision = { direction: last.direction || 'flat', reason: 'result:' + last.result, at: now };
    const tradeSymbol = last.symbol || state.symbol;
    const displayResult = normalized.displayResult || (last.result === 'won' ? 'win' : (last.result === 'lost' ? 'loss' : 'returned'));
    const message = `result=${displayResult} symbol=${tradeSymbol} dir=${last.direction} step=${last.step} amt=${formatAmount(last.amount)} pnl=${formatSignedFixed(pnl)}`;
    logTradeResultEvent(message);
    state.lastResult = { result: last.result, pnl, at: now };
    const prepareReason = last.result === 'won' ? 'after_win' : (last.result === 'lost' ? 'after_loss' : 'returned');
    schedulePrepare(prepareReason);
    renderCycles();
    updateTradingInfo();
  }

  const CLOSED_DEAL_CONTAINER_QUERIES = [
    '.trades__list--closed',
    '.trades-list--closed',
    '.closed-deals__list',
    '.history__list--closed',
    '[data-tab="closed"] .trades-list',
    '[data-tab="closed"] .deals-list',
    '.deals-list[data-tab="closed"]',
    '.deals-list[data-type="closed"]'
  ];

  const CLOSED_DEAL_PARENT_QUERIES = [
    '[data-tab="closed"]',
    '.tabs__content--closed',
    '.tabs-content--closed',
    '.trades__tab--closed',
    '.history__tab--closed',
    '.closed-deals',
    '.section--closed'
  ];

  const CLOSED_DEAL_ROW_QUERIES = [
    '[data-deal-id]',
    '[data-transaction-id]',
    '[data-order-id]',
    '.trades-list__row',
    '.trades__row',
    '.deal-entry',
    '.deal-item',
    '.deal-card',
    '.closed-deal',
    '.history__row',
    '.table__row',
    'li',
    'tr'
  ];

  const CLOSED_DEAL_SYMBOL_DATA_KEYS = ['symbol', 'asset', 'assetName', 'pair', 'underlying'];
  const CLOSED_DEAL_SYMBOL_SELECTORS = [
    '[data-symbol]',
    '[data-asset]',
    '[data-asset-name]',
    '[data-underlying]',
    '.deal-asset',
    '.deal__asset',
    '.trades-list__asset',
    '.trades__asset',
    '.trades__symbol',
    '.symbol',
    '.asset-name',
    '.asset'
  ];

  const CLOSED_DEAL_AMOUNT_DATA_KEYS = ['amount', 'investment', 'invest', 'sum', 'stake', 'value', 'bet', 'dealAmount'];
  const CLOSED_DEAL_AMOUNT_SELECTORS = [
    '[data-amount]',
    '[data-investment]',
    '[data-invest]',
    '[data-sum]',
    '[data-stake]',
    '[data-value]',
    '.deal-amount',
    '.deal__amount',
    '.trades-list__amount',
    '.trades__amount',
    '.amount',
    '.value'
  ];

  const CLOSED_DEAL_PNL_DATA_KEYS = ['pnl', 'profit', 'result', 'outcome', 'pl', 'payout'];
  const CLOSED_DEAL_PNL_SELECTORS = [
    '[data-pnl]',
    '[data-profit]',
    '[data-result]',
    '.deal-profit',
    '.deal__profit',
    '.trades-list__profit',
    '.trades__result',
    '.profit',
    '.result'
  ];

  function ensureClosedDealsObserver(){
    if (!closedDealsWatcher.observer){
      closedDealsWatcher.observer = new MutationObserver(handleClosedDealsMutation);
    }
    scanClosedDealsContainers();
    if (closedDealsWatcher.scanTimer){
      clearInterval(closedDealsWatcher.scanTimer);
    }
    closedDealsWatcher.scanTimer = setInterval(scanClosedDealsContainers, 2000);
  }

  function scanClosedDealsContainers(){
    const found = new Set();
    CLOSED_DEAL_CONTAINER_QUERIES.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(node => {
          if (qualifiesClosedDealsContainer(node)) found.add(node);
        });
      } catch (_err){}
    });
    try {
      document.querySelectorAll('.deals-list').forEach(node => {
        if (qualifiesClosedDealsContainer(node)) found.add(node);
      });
    } catch (_err){}
    found.forEach(attachClosedDealsContainer);
  }

  function attachClosedDealsContainer(node){
    if (!node || closedDealsWatcher.containers.has(node)) return;
    try {
      closedDealsWatcher.observer.observe(node, { childList: true, subtree: true });
      closedDealsWatcher.containers.add(node);
    } catch (err){
      console.warn('[Verter] closed deals observer attach failed', err);
    }
  }

  function qualifiesClosedDealsContainer(node){
    if (!node || node.nodeType !== 1) return false;
    if (closedDealsWatcher.containers.has(node)) return true;
    const dataset = node.dataset || {};
    if (dataset.tab === 'closed' || dataset.type === 'closed' || dataset.state === 'closed' || dataset.list === 'closed'){
      return true;
    }
    try {
      if (node.matches && node.matches('.trades__list--closed, .trades-list--closed, .closed-deals__list, .history__list--closed')){
        return true;
      }
    } catch (_err){}
    const className = (node.className || '').toString().toLowerCase();
    if (className && className.includes('closed') && (className.includes('deal') || className.includes('trade'))){
      return true;
    }
    for (const selector of CLOSED_DEAL_PARENT_QUERIES){
      try {
        if (node.closest && node.closest(selector)) return true;
      } catch (_err){}
    }
    return false;
  }

  function handleClosedDealsMutation(mutations){
    if (!state.isTradeOpen || !state.openTrade) return;
    const containers = new Set();
    mutations.forEach(mutation => {
      if (mutation.type !== 'childList') return;
      const targetContainer = findClosedDealsContainer(mutation.target);
      if (targetContainer) containers.add(targetContainer);
      mutation.addedNodes && mutation.addedNodes.forEach(node => {
        const candidate = findClosedDealsContainer(node);
        if (candidate) containers.add(candidate);
      });
    });
    containers.forEach(container => processClosedDealsContainer(container));
  }

  function findClosedDealsContainer(node){
    if (!node || node.nodeType !== 1) return null;
    if (closedDealsWatcher.containers.has(node)) return node;
    for (const container of closedDealsWatcher.containers){
      if (container.contains(node)) return container;
    }
    for (const selector of CLOSED_DEAL_CONTAINER_QUERIES){
      try {
        const match = node.closest(selector);
        if (match) return match;
      } catch (_err){}
    }
    if (node.classList && node.classList.contains('deals-list') && qualifiesClosedDealsContainer(node)){
      return node;
    }
    return null;
  }

  function processClosedDealsContainer(container){
    const row = findLastClosedDealRow(container);
    if (!row) return;
    const info = parseClosedDealRow(row, state.openTrade);
    if (!info) return;
    evaluateClosedDeal(info);
  }

  function isMeaningfulDealRow(node){
    if (!node || node.nodeType !== 1) return false;
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return false;
    if (/no (deals|trades)/i.test(text) && text.length < 64) return false;
    return true;
  }

  function findLastClosedDealRow(container){
    if (!container || container.nodeType !== 1) return null;
    let node = container.lastElementChild;
    while (node && node.nodeType === 1 && !isMeaningfulDealRow(node)){
      node = node.previousElementSibling;
    }
    if (node && isMeaningfulDealRow(node)) return node;
    for (const selector of CLOSED_DEAL_ROW_QUERIES){
      try {
        const rows = container.querySelectorAll(selector);
        for (let i = rows.length - 1; i >= 0; i -= 1){
          if (isMeaningfulDealRow(rows[i])) return rows[i];
        }
      } catch (_err){}
    }
    return null;
  }

  function parseClosedDealRow(row, openTrade){
    if (!row || row.nodeType !== 1) return null;
    const text = (row.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (!text) return null;
    const info = {
      node: row,
      text,
      symbol: null,
      symbolKey: '',
      amount: NaN,
      pnl: NaN,
      result: null
    };

    const symbol = readSymbolFromRow(row);
    if (symbol){
      info.symbol = symbol;
      info.symbolKey = makeSymbolKey(symbol);
    } else if (openTrade && openTrade.symbol && textContainsSymbol(text, openTrade.symbol)){
      info.symbol = openTrade.symbol;
      info.symbolKey = openTrade.symbolKey || makeSymbolKey(openTrade.symbol);
    }

    const amount = readAmountFromRow(row, text, openTrade);
    if (Number.isFinite(amount)) info.amount = amount;

    const pnl = readPnLFromRow(row, text);
    if (Number.isFinite(pnl)) info.pnl = pnl;

    const result = detectResultFromRow(row);
    if (result) info.result = result;
    if (!info.result){
      const derived = classifyResultFromPnL(info.pnl);
      if (derived) info.result = derived;
    }

    return info;
  }

  function readSymbolFromRow(row){
    const elements = [row].concat(Array.from(row.querySelectorAll('*')));
    for (const element of elements){
      const dataset = element.dataset || {};
      for (const key of CLOSED_DEAL_SYMBOL_DATA_KEYS){
        if (dataset[key]){
          const label = normalizeSymbolLabel(dataset[key]);
          if (label) return label;
        }
      }
      for (const key of CLOSED_DEAL_SYMBOL_DATA_KEYS){
        const attrName = 'data-' + key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
        if (element.hasAttribute && element.hasAttribute(attrName)){
          const label = normalizeSymbolLabel(element.getAttribute(attrName));
          if (label) return label;
        }
      }
    }
    for (const selector of CLOSED_DEAL_SYMBOL_SELECTORS){
      try {
        const el = row.querySelector(selector);
        if (el){
          const label = normalizeSymbolLabel(el.textContent || el.innerText || (el.getAttribute && el.getAttribute('data-symbol')));
          if (label) return label;
        }
      } catch (_err){}
    }
    const text = (row.textContent || '').toUpperCase();
    let match = text.match(/([A-Z]{2,6}\s*\/\s*[A-Z]{2,6})/);
    if (match) return normalizeSymbolLabel(match[1]);
    match = text.match(/([A-Z]{2,6}\s+[A-Z]{2,6})/);
    if (match) return normalizeSymbolLabel(match[1]);
    return null;
  }

  function readAmountFromRow(row, text, openTrade){
    const elements = [row].concat(Array.from(row.querySelectorAll('*')));
    for (const element of elements){
      const dataset = element.dataset || {};
      for (const key of CLOSED_DEAL_AMOUNT_DATA_KEYS){
        if (dataset[key] != null){
          const value = parseMoneyValue(dataset[key]);
          if (Number.isFinite(value)) return value;
        }
      }
      for (const key of CLOSED_DEAL_AMOUNT_DATA_KEYS){
        const attrName = 'data-' + key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
        if (element.hasAttribute && element.hasAttribute(attrName)){
          const value = parseMoneyValue(element.getAttribute(attrName));
          if (Number.isFinite(value)) return value;
        }
      }
    }
    for (const selector of CLOSED_DEAL_AMOUNT_SELECTORS){
      try {
        const el = row.querySelector(selector);
        if (el){
          const value = parseMoneyValue(el.textContent || el.innerText || (el.getAttribute && el.getAttribute('data-value')));
          if (Number.isFinite(value)) return value;
        }
      } catch (_err){}
    }
    const target = openTrade ? openTrade.amount : NaN;
    const fallback = findAmountInText(text, target);
    return Number.isFinite(fallback) ? fallback : NaN;
  }

  function readPnLFromRow(row, text){
    const elements = [row].concat(Array.from(row.querySelectorAll('*')));
    const datasetKeys = CLOSED_DEAL_PNL_DATA_KEYS.concat(['status', 'state', 'outcome']);
    for (const element of elements){
      const dataset = element.dataset || {};
      for (const key of datasetKeys){
        if (dataset[key] != null){
          const value = parseMoneyValue(dataset[key]);
          if (Number.isFinite(value)) return value;
        }
      }
      for (const key of datasetKeys){
        const attrName = 'data-' + key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
        if (element.hasAttribute && element.hasAttribute(attrName)){
          const value = parseMoneyValue(element.getAttribute(attrName));
          if (Number.isFinite(value)) return value;
        }
      }
    }
    for (const selector of CLOSED_DEAL_PNL_SELECTORS){
      try {
        const el = row.querySelector(selector);
        if (el){
          const value = parseMoneyValue(el.textContent || el.innerText || (el.getAttribute && el.getAttribute('data-value')));
          if (Number.isFinite(value)) return value;
        }
      } catch (_err){}
    }
    const fallback = findPnLInText(text);
    return Number.isFinite(fallback) ? fallback : NaN;
  }

  function detectResultFromRow(row){
    const elements = [row].concat(Array.from(row.querySelectorAll('*')));
    const datasetKeys = ['result', 'status', 'state', 'outcome', 'type', 'winStatus'];
    for (const element of elements){
      const dataset = element.dataset || {};
      for (const key of datasetKeys){
        if (dataset[key] != null){
          const mapped = normalizeResultKind(dataset[key]);
          if (mapped) return mapped;
        }
      }
      for (const key of datasetKeys){
        const attrName = 'data-' + key.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
        if (element.hasAttribute && element.hasAttribute(attrName)){
          const mapped = normalizeResultKind(element.getAttribute(attrName));
          if (mapped) return mapped;
        }
      }
    }
    let classBuffer = '';
    elements.forEach(element => {
      if (!element) return;
      if (typeof element.className === 'string'){
        classBuffer += ' ' + element.className;
      } else if (element.classList && element.classList.length){
        classBuffer += ' ' + Array.from(element.classList).join(' ');
      } else if (element.className && typeof element.className.baseVal === 'string'){
        classBuffer += ' ' + element.className.baseVal;
      }
    });
    const mappedFromClass = normalizeResultKind(classBuffer);
    if (mappedFromClass) return mappedFromClass;
    const text = (row.textContent || '').trim();
    const mappedFromText = normalizeResultKind(text);
    return mappedFromText || null;
  }

  function evaluateClosedDeal(info){
    if (!state.isTradeOpen || !state.openTrade) return;
    const open = state.openTrade;
    const now = Date.now();
    if (Number.isFinite(open.openedAt) && now - open.openedAt > 90000) return;

    if (info.symbolKey && open.symbolKey && info.symbolKey !== open.symbolKey) return;
    if (!info.symbol && open.symbol && info.text && !textContainsSymbol(info.text, open.symbol)) return;

    let amountMatches = false;
    if (Number.isFinite(info.amount)){
      amountMatches = approxEqual(info.amount, open.amount, 0.02);
    } else if (info.text){
      amountMatches = textContainsAmount(info.text, open.amount);
    }
    if (!amountMatches) return;

    const resultKind = info.result || classifyResultFromPnL(info.pnl);
    if (!resultKind) return;

    const payload = {
      source: 'observer',
      symbol: info.symbol || open.symbol,
      amount: Number.isFinite(info.amount) ? info.amount : open.amount,
      pnl: Number.isFinite(info.pnl) ? info.pnl : NaN,
      result: resultKind,
      closedAt: now
    };
    onTradeResult(payload);
  }

  function observeTradeResults(){
    const original = window.recordTradeResult;
    window.recordTradeResult = function(res){
      try { onTradeResult(res); } catch (err) { console.error(err); }
      if (typeof original === 'function') return original.apply(this, arguments);
    };
    ensureClosedDealsObserver();
  }

  function manualAssetReset(){
    const prevStep = state.currentBetStep;
    state.betHistory = [];
    state.currentBetStep = 0;
    state.lossStreak = 0;
    state.maxStep = 0;
    state.isTradeOpen = false;
    state.openTrade = null;
    state.open = null;
    state.currentWager = 0;
    state.currentProfit = 0;
    state.totalProfit = 0;
    state.cycleProfit = 0;
    state.pauseUntil = 0;
    state.minuteGate = false;
    state.minuteSignals = [];
    state.minuteSignalsPending = true;
    state.latestSignals = [];
    state.topSignals = [];
    state.virtualStats[state.symbol] = Object.create(null);
    state.cycles = [];
    state.lastTopHit = null;
    state.minuteTimer.tradeCycleId = -1;
    state.minuteTimer.windowConsumed = false;
    state.minuteTimer.targetCycleId = state.minuteTimer.activeCycleId;
    state.signalCache = Object.create(null);
    state.pendingTrade = null;
    state.lastOrderDecision = { decision: 'skip', reason: 'reset', at: Date.now() };
    state.lastResult = { result: null, pnl: 0, at: 0 };
    state.betInput = null;
    updateTradingInfo();
    renderAccuracy();
    renderTopSignals();
    renderCycles();
    setDirection('flat', 'reset');
    setText(ui.signalBox, '—');
    state.lastDecision = { direction: 'flat', reason: 'reset', at: Date.now() };
    recordNextBet('startup', prevStep, state.currentBetStep);
    schedulePrepare('startup');
  }

  function observeSymbolChanges(){
    const observer = new MutationObserver(() => {
      const symbol = (symbolDiv.textContent || '').replace('/', ' ').trim();
      if (symbol !== state.symbol){
        state.symbol = symbol;
        manualAssetReset();
        if (ui.tradingSymbol) ui.tradingSymbol.textContent = 'Trading · ' + symbol;
      }
    });
    observer.observe(symbolDiv, { childList: true, subtree: true });
  }

  function setupTimers(){
    watchers.signalTimer = setInterval(() => {
      const now = Date.now();
      if (now - state.lastSignalCheck >= signalCheckInterval){
        state.lastSignalCheck = now;
        updateMinuteBoundary(now);
        updatePrice();
        evaluateSignals();
        tradeLogic(now);
        updateTradingInfo();
        logMinuteSnapshot(now);
      }
    }, signalCheckInterval);

    watchers.chartTimer = setInterval(renderChart, 2000);
  }

  window.VERTER = Object.assign(window.VERTER || {}, {
    version: APP_VERSION,
    build: BUILD_TAG,
    manualAssetReset
  });

  function boot(){
    buildUI();
    observeTradeResults();
    observeSymbolChanges();
    setupTimers();
    recordNextBet('startup', state.currentBetStep, state.currentBetStep);
    schedulePrepare('startup');
    updateTradingInfo();
    renderAccuracy();
    renderTopSignals();
    renderChart();
    renderCycles();
  }

  boot();
})();
