// Verter ver. 5.14.0 – 2024-05-24
// PCS-8 Preflight: https://github.com/dreamteamufa/verter/blob/main/PCS_report.txt
(function(){
  'use strict';

  if (window.top !== window) return;
  if (window.__VERTER_ACTIVE__) {
    console.warn('[Verter] duplicate instance prevented');
    return;
  }
  window.__VERTER_ACTIVE__ = true;

  const APP_VERSION = 'Verter ver. 5.14.0 (Zoom Controls, 2024-05-24)';
  const BUILD_TAG = 'PCS-8';

  const PAPER_HORIZON = 1;
  const TOP_K = 5;
  const MIN_TRADES = 6;
  const MIN_PROFIT = 80;
  const minTimeBetweenTrades = 3000;
  const signalCheckInterval = 250;

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

  const fmt = (n, p = 5) => (Number.isFinite(n) ? n.toFixed(p) : '—');
  const fmt2 = (n, p = 2) => (Number.isFinite(n) ? n.toFixed(p) : '—');
  const fmtPct = n => (Number.isFinite(n) ? n.toFixed(1) + '%' : '—');
  const fmtMoney = n => (Number.isFinite(n) ? (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2) : '$0.00');
  const humanTime = ts => {
    const d = new Date(ts);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(v => String(v).padStart(2, '0')).join(':');
  };

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

  function openOrder(direction, offset){
    const code = direction === 'buy' ? KEY_CODES.BUY : (direction === 'sell' ? KEY_CODES.SELL : null);
    if (code == null) return;
    setTimeout(() => emitShiftKey(code), Math.max(0, offset|0));
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
    autoTrading: true,
    betArray: betArray1,
    currentBetStep: 0,
    betHistory: [],
    lastTradeTime: 0,
    lastSignalCheck: 0,
    isTradeOpen: false,
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
    warmup: false,
    pendingLogs: [],
    cycles: []
  };

  const watchers = {
    tradeTimer: null,
    signalTimer: null,
    chartTimer: null
  };

  const ui = {
    root: null,
    signalBox: null,
    directionBox: null,
    timeBox: null,
    profitBox: null,
    winRateBox: null,
    wagerBox: null,
    totalProfitBox: null,
    maxStepBox: null,
    lossStreakBox: null,
    pauseBox: null,
    pauseButton: null,
    topList: null,
    accuracyList: null,
    chartCanvas: null,
    chartCtx: null,
    chartZoomSlider: null,
    chartZoomValue: null,
    cyclesBox: null,
    tradingSymbol: null
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
    if (ui.pauseBox) ui.pauseBox.textContent = humanTime(state.pauseUntil);
    if (ui.directionBox){
      ui.directionBox.style.background = colors.gray;
      ui.directionBox.textContent = `PAUSED (${state.pauseMinutes}m)`;
    }
  }

  function clearPause(){
    state.pauseUntil = 0;
    if (ui.pauseBox) ui.pauseBox.textContent = '—';
  }

  function buildUI(){
    const existing = document.getElementById('verter-root');
    if (existing){ existing.remove(); }

    const style = document.createElement('style');
    style.id = 'verter-style';
    style.textContent = `
      #verter-root{position:fixed;top:20px;right:20px;width:1160px;color:#fff;font-family:'Inter',sans-serif;z-index:20000;}
      #verter-root *{box-sizing:border-box;}
      .verter-panel{background:#111113;border:1px solid #262629;border-radius:8px;padding:12px;margin-bottom:8px;}
      .verter-grid{display:flex;gap:8px;align-items:flex-start;}
      .verter-column{display:flex;flex-direction:column;gap:8px;}
      .verter-section{background:#161618;border:1px solid #2a2a2d;border-radius:6px;padding:10px;}
      .verter-section h3{margin:0 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:#9ea0a8;}
      .verter-info{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;font-size:12px;}
      .verter-info div{display:flex;justify-content:space-between;gap:8px;}
      .verter-info span{white-space:nowrap;}
      .verter-wide{width:360px;}
      .verter-top{width:360px;}
      .verter-chart{width:600px;height:300px;}
      #verter-chart{width:100%;height:100%;background:#101014;border-radius:6px;}
      .verter-chart-controls{display:flex;align-items:center;gap:8px;font-size:11px;margin-bottom:8px;color:#9ea0a8;}
      .verter-chart-controls label{font-weight:600;text-transform:uppercase;letter-spacing:0.08em;}
      .verter-chart-controls input[type="range"]{flex:1;}
      .verter-signal-list{max-height:260px;overflow:hidden;font-size:11px;display:flex;flex-direction:column;gap:4px;}
      .verter-signal-row{display:flex;justify-content:space-between;align-items:center;padding:3px 6px;background:#1d1d21;border-radius:4px;}
      .verter-signal-row strong{font-weight:600;}
      .verter-cycles{display:flex;flex-wrap:wrap;gap:4px;max-height:80px;overflow:hidden;}
      .verter-cycle{padding:3px 6px;border-radius:4px;font-size:11px;background:#1f1f23;}
      .verter-flex{display:flex;gap:8px;}
      .verter-pause{display:flex;justify-content:space-between;align-items:center;font-size:12px;}
      .verter-btn{background:#1f1f23;color:#fff;border:1px solid #303035;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;}
      .verter-btn:hover{background:#2a2a30;}
    `;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'verter-root';
    // стартовая позиция (как было): снизу по центру
    Object.assign(root.style,{position:'fixed',left:'50%',top:'',bottom:'8px',transform:'translateX(-50%)',maxWidth:'calc(100% - 24px)',zIndex:2147483647});

    // включить перетаскивание
    root.style.cursor = 'move';
    root.addEventListener('pointerdown', e => {
      if (e.button!==0) return;
      const r = root.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      root.setPointerCapture(e.pointerId);
      root.style.transform=''; root.style.bottom='';
      const move = ev => { root.style.left=(ev.clientX-dx)+'px'; root.style.top=(ev.clientY-dy)+'px'; };
      const up = () => { root.releasePointerCapture(e.pointerId); root.removeEventListener('pointermove',move); root.removeEventListener('pointerup',up); };
      root.addEventListener('pointermove',move); root.addEventListener('pointerup',up);
    });

    const tradingSection = document.createElement('div');
    tradingSection.className = 'verter-section verter-wide';
    tradingSection.innerHTML = `
      <h3>Trading</h3>
      <div class="verter-info">
        <div><span>Version</span><span>${APP_VERSION}</span></div>
        <div><span>Mode</span><span>${mode}</span></div>
        <div><span>Symbol</span><span id="verter-symbol">${state.symbol}</span></div>
        <div><span>Start Balance</span><span>${fmtMoney(state.startBalance)}</span></div>
        <div><span>Current Profit</span><span id="verter-profit">$0.00</span></div>
        <div><span>Total Profit</span><span id="verter-total">$0.00</span></div>
        <div><span>Win Rate</span><span id="verter-winrate">0%</span></div>
        <div><span>Current Wager</span><span id="verter-wager">$0.00</span></div>
        <div><span>Loss Streak</span><span id="verter-losses">0</span></div>
        <div><span>Max Step</span><span id="verter-step">0</span></div>
        <div><span>Pause Until</span><span id="verter-pause">—</span></div>
        <div><span>Bet Time</span><span id="verter-time">--:--:--</span></div>
      </div>
      <div class="verter-info" style="margin-top:6px;grid-template-columns:1fr;">
        <div><span>Signal</span><span id="verter-signal">—</span></div>
        <div><span>Direction</span><span id="verter-direction">flat</span></div>
      </div>
    `;

    const signalsSection = document.createElement('div');
    signalsSection.className = 'verter-section verter-top';
    signalsSection.innerHTML = `
      <h3>Signals Accuracy</h3>
      <div id="verter-accuracy" class="verter-signal-list"></div>
    `;

    const topSection = document.createElement('div');
    topSection.className = 'verter-section verter-top';
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

    const cyclesSection = document.createElement('div');
    cyclesSection.className = 'verter-section verter-wide';
    cyclesSection.innerHTML = `
      <h3>Cycles History</h3>
      <div id="verter-cycles" class="verter-cycles"></div>
    `;

    const pauseSection = document.createElement('div');
    pauseSection.className = 'verter-section verter-wide';
    pauseSection.innerHTML = `
      <div class="verter-pause">
        <span>Auto-pause after loss streak</span>
        <button id="verter-pause-reset" class="verter-btn">Pause Reset</button>
      </div>
    `;

    const leftColumn = document.createElement('div');
    leftColumn.className = 'verter-column';
    leftColumn.append(tradingSection, cyclesSection, pauseSection);

    const rightColumnTop = document.createElement('div');
    rightColumnTop.className = 'verter-flex';
    rightColumnTop.append(signalsSection, topSection);

    const rightColumn = document.createElement('div');
    rightColumn.className = 'verter-column';
    rightColumn.append(rightColumnTop, chartSection);

    const grid = document.createElement('div');
    grid.className = 'verter-grid';
    grid.append(leftColumn, rightColumn);

    root.appendChild(grid);
    document.body.appendChild(root);

    ui.root = root;
    ui.signalBox = root.querySelector('#verter-signal');
    ui.directionBox = root.querySelector('#verter-direction');
    ui.timeBox = root.querySelector('#verter-time');
    ui.profitBox = root.querySelector('#verter-profit');
    ui.winRateBox = root.querySelector('#verter-winrate');
    ui.wagerBox = root.querySelector('#verter-wager');
    ui.totalProfitBox = root.querySelector('#verter-total');
    ui.maxStepBox = root.querySelector('#verter-step');
    ui.lossStreakBox = root.querySelector('#verter-losses');
    ui.pauseBox = root.querySelector('#verter-pause');
    ui.pauseButton = root.querySelector('#verter-pause-reset');
    ui.topList = root.querySelector('#verter-top');
    ui.accuracyList = root.querySelector('#verter-accuracy');
    ui.chartCanvas = root.querySelector('#verter-chart');
    ui.chartCtx = ui.chartCanvas ? ui.chartCanvas.getContext('2d') : null;
    ui.chartZoomSlider = root.querySelector('#verter-chart-zoom');
    ui.chartZoomValue = root.querySelector('#verter-chart-zoom-value');
    ui.cyclesBox = root.querySelector('#verter-cycles');
    ui.tradingSymbol = root.querySelector('#verter-symbol');

    ui.pauseButton.addEventListener('click', () => {
      clearPause();
      console.log('[Verter] pause reset manually');
    });

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

    updateChartZoomDisplay();

    setDirection('flat');
  }

  function updateTradingInfo(){
    setText(ui.timeBox, betTimeDiv.textContent || '--:--:--');
    setText(ui.tradingSymbol, (symbolDiv.textContent || '').replace('/', ' ').trim());
    setText(ui.profitBox, fmtMoney(state.currentProfit));
    setText(ui.totalProfitBox, fmtMoney(state.totalProfit));
    const winCount = state.betHistory.filter(t => t.result === 'won').length;
    const rate = state.betHistory.length ? (winCount / state.betHistory.length) * 100 : 0;
    setText(ui.winRateBox, rate.toFixed(1) + '%');
    setText(ui.wagerBox, fmtMoney(state.currentWager));
    setText(ui.maxStepBox, String(state.maxStep || 0));
    setText(ui.lossStreakBox, String(state.lossStreak));
    setText(ui.pauseBox, state.pauseUntil ? humanTime(state.pauseUntil) : '—');
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
      const color = item.result === 'won' ? colors.green : colors.red;
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
      state.minuteGate = true;
      state.minuteSignalsPending = true;
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

  function applyMartingale(result){
    if (result === 'won'){
      state.currentBetStep = 0;
      state.lossStreak = 0;
    } else if (result === 'lost'){
      state.currentBetStep = Math.min(state.currentBetStep + 1, state.betArray.length - 1);
      state.lossStreak += 1;
      if (state.lossStreak >= state.pauseLossThreshold){
        schedulePause();
      }
    }
    if (!state.maxStep || state.currentBetStep > state.maxStep){
      state.maxStep = state.currentBetStep;
    }
  }

  function placeTrade(direction){
    const now = Date.now();
    if (state.isTradeOpen) return false;
    if (now - state.lastTradeTime < minTimeBetweenTrades) return false;
    const payout = parseInt(percentProfitDiv.textContent || percentProfitDiv.innerText || '0', 10);
    if (!Number.isFinite(payout) || payout < MIN_PROFIT){
      console.log('[Verter] payout below minimum, skip trade');
      setDirection('flat', 'payout');
      return false;
    }
    if (isPaused()){
      console.log('[Verter] trading paused');
      setDirection('flat', 'pause');
      return false;
    }

    const stepIndex = Math.min(state.currentBetStep, state.betArray.length - 1);
    const stepCfg = state.betArray[stepIndex];
    const betValue = getBetValue(stepIndex);
    const pressCount = stepCfg.pressCount;
    const prepDelay = prepareBetAmount(pressCount);
    openOrder(direction, prepDelay + KEY_PRESS_DELAY);

    const trade = {
      time: humanTime(now),
      direction,
      step: state.currentBetStep,
      amount: betValue,
      signals: state.minuteSignals.map(s => s.key)
    };
    state.betHistory.push(trade);
    state.lastTradeTime = now;
    state.isTradeOpen = true;
    state.currentWager += betValue;
    setDirection(direction, 'opened');
    updateTradingInfo();
    console.log('[Verter] trade opened', trade);
    return true;
  }

  function tradeLogic(){
    if (!state.minuteGate) return;
    if (!state.autoTrading) {
      setDirection('flat', 'manual-off');
      state.minuteGate = false;
      return;
    }
    if (state.minuteSignalsPending){
      console.log('[Verter] minute signals not ready, skip');
      state.minuteGate = false;
      return;
    }

    const snapshot = state.latestSignals;
    const allowedKeys = new Set(state.topSignals.map(s => s.key));
    const active = snapshot.filter(sig => allowedKeys.has(sig.key));

    if (!active.length){
      console.log('[Verter] no eligible top signals this minute');
      setDirection('flat', 'no-top');
      state.minuteGate = false;
      return;
    }

    let buys = 0;
    let sells = 0;
    active.forEach(sig => {
      if (sig.direction === 'buy') buys += 1;
      if (sig.direction === 'sell') sells += 1;
    });

    let direction = 'flat';
    if (buys > sells) direction = 'buy';
    if (sells > buys) direction = 'sell';

    if (direction === 'flat'){
      console.log('[Verter] conflicting signals, skip trade');
      setDirection('flat', 'conflict');
      state.minuteGate = false;
      return;
    }

    setDirection(direction, 'minute');
    const placed = placeTrade(direction);
    if (!placed){
      console.log('[Verter] trade not placed at minute boundary');
      setDirection('flat', 'not-placed');
    }
    state.minuteGate = false;
  }

  function syncProfit(){
    const balance = parseFloat((balanceDiv.textContent || '0').replace(/,/g, '')) || 0;
    const profit = balance - state.startBalance;
    state.currentProfit = profit;
    state.totalProfit = profit;
  }

  function onTradeResult(result){
    state.isTradeOpen = false;
    if (!result) return;
    const last = state.betHistory[state.betHistory.length - 1];
    if (!last) return;
    last.result = result.won ? 'won' : 'lost';
    syncProfit();
    applyMartingale(last.result);
    if (last.result === 'lost' && state.pauseLossThreshold && state.lossStreak >= state.pauseLossThreshold){
      schedulePause();
    }
    setDirection('flat', last.result);
    state.cycles.push({ result: last.result, profit: state.currentProfit, step: last.step });
    if (state.cycles.length > 24) state.cycles.shift();
    renderCycles();
    updateTradingInfo();
  }

  function observeTradeResults(){
    const original = window.recordTradeResult;
    window.recordTradeResult = function(res){
      try { onTradeResult(res); } catch (err) { console.error(err); }
      if (typeof original === 'function') return original.apply(this, arguments);
    };
  }

  function manualAssetReset(){
    state.betHistory = [];
    state.currentBetStep = 0;
    state.lossStreak = 0;
    state.maxStep = 0;
    state.currentWager = 0;
    state.pauseUntil = 0;
    state.minuteGate = false;
    state.minuteSignals = [];
    state.minuteSignalsPending = true;
    state.latestSignals = [];
    state.topSignals = [];
    state.virtualStats[state.symbol] = Object.create(null);
    state.cycles = [];
    updateTradingInfo();
    renderAccuracy();
    renderTopSignals();
    renderCycles();
    setDirection('flat', 'reset');
    setText(ui.signalBox, '—');
    console.log('[Verter] asset reset');
  }

  function observeSymbolChanges(){
    const observer = new MutationObserver(() => {
      const symbol = (symbolDiv.textContent || '').replace('/', ' ').trim();
      if (symbol !== state.symbol){
        state.symbol = symbol;
        manualAssetReset();
        setText(ui.tradingSymbol, symbol);
      }
    });
    observer.observe(symbolDiv, { childList: true, subtree: true });
  }

  function setupTimers(){
    watchers.signalTimer = setInterval(() => {
      const now = Date.now();
      if (now - state.lastSignalCheck >= signalCheckInterval){
        state.lastSignalCheck = now;
        updatePrice();
        evaluateSignals();
        tradeLogic();
        updateTradingInfo();
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
    updateTradingInfo();
    renderAccuracy();
    renderTopSignals();
    renderChart();
    renderCycles();
  }

  boot();
})();
