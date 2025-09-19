// ci check
(function(){
  try{
    if (window.top !== window) { return; }             // do not run in iframes
    if (window.__VERTER_SINGLE_INSTANCE__) {           // prevent duplicate instances
      console.debug("[Verter] duplicate instance blocked");
      return;
    }
    window.__VERTER_SINGLE_INSTANCE__ = true;
  }catch(e){}
'use strict';

  const CFG = {
    minPayoutToTrade: 90,
    preArmingEnabled: true,
    preArming: {
      prepareAbortOnGateFail: true,
      t_prepare_ms: 2800,
      t_rebind_ms: 1800,
      t_candidate_ms: 1200,
      t_gate_ms: 800,
      t_health_ms: 250,
      debounce_ms: 50
    }
  };

// === Firebase CloudStats configuration ===
const firebaseConfig = {
  apiKey: "AIzaSyC1KqNekr6GGtsBEHvvU_3Ou1TmHVQPOX4",
  authDomain: "tradebot-71c75.firebaseapp.com",
  projectId: "tradebot-71c75",
  appId: "1:12759618797:web:8a0ef77e64d56197814334"
};

const recaptchaKey = "6LdPEs4rAAAAAFWk1leiOkAhJRog6Jv6sw1lrhB";

let firebaseBootstrapPromise = null;
let firebaseDbInstance = null;
let firebaseAuthWatcherSet = false;

// === CloudStats module inline copy (kept in sync with src/cloudstats_s1.js) ===
(function(global){
  'use strict';

  var DEFAULTS = {
    T_min: 30,
    ewmaMin: 0.52,
    weights: { w1: 0.5, w2: 0.3, w3: 0.1, w4: 0.1, Tcap: 200 },
    alpha: 0.2,
    readCooldownMs: 30000,
    writeCooldownMs: 5000,
    cacheTtlMs: 180000
  };

  var CLOUD_LOCAL_KEY = 'cloudstats_s1_cache';
  var CLOUD_QUEUE_KEY = 'cloudstats_s1_queue';

  var firebaseApp = null;
  var firestoreDb = null;
  var firebaseAuth = null;
  var firebaseAppCheck = null;

  var initPromise = null;
  var cachePerf = {};
  var readThrottles = {};
  var writeThrottleUntil = 0;
  var writeQueue = [];
  var processingQueue = false;
  var lastInitCfg = null;

  function now(){ return Date.now(); }

  function clone(obj){
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)){ return obj.slice(); }
    var out = {};
    for (var k in obj){ if (obj.hasOwnProperty(k)) out[k] = clone(obj[k]); }
    return out;
  }

  function getLocalStorage(){
    try{ if (typeof window !== 'undefined' && window.localStorage) return window.localStorage; }catch(_){ }
    return null;
  }

  function loadQueueFromStorage(){
    var ls = getLocalStorage();
    if (!ls) return;
    try{
      var raw = ls.getItem(CLOUD_QUEUE_KEY);
      if (!raw) return;
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) writeQueue = arr.concat(writeQueue);
    }catch(_){ }
  }

  function persistQueue(){
    var ls = getLocalStorage();
    if (!ls) return;
    try{
      if (!writeQueue.length){ ls.removeItem(CLOUD_QUEUE_KEY); return; }
      ls.setItem(CLOUD_QUEUE_KEY, JSON.stringify(writeQueue.slice(0, 30)));
    }catch(_){ }
  }

  function savePerfToCache(key, perf){
    cachePerf[key] = { ts: now(), data: clone(perf) };
    var ls = getLocalStorage();
    if (!ls) return;
    try{
      var data = ls.getItem(CLOUD_LOCAL_KEY);
      var store = data ? JSON.parse(data) : {};
      store[key] = { ts: cachePerf[key].ts, data: cachePerf[key].data };
      ls.setItem(CLOUD_LOCAL_KEY, JSON.stringify(store));
    }catch(_){ }
  }

  function loadCache(){
    var ls = getLocalStorage();
    if (!ls) return;
    try{
      var raw = ls.getItem(CLOUD_LOCAL_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      for (var key in parsed){
        if (parsed.hasOwnProperty(key)){
          cachePerf[key] = parsed[key];
        }
      }
    }catch(_){ }
  }

  function waitFirebaseReady(){
    return new Promise(function(resolve, reject){
      var checks = 0;
      (function verify(){
        checks++;
        try{
          if (global.firebase && global.firebase.app && global.firebase.app.App){ resolve(); return; }
        }catch(_){ }
        if (checks > 60){ reject(new Error('Firebase compat SDK missing')); return; }
        setTimeout(verify, 250);
      })();
    });
  }

  function withRetry(fn){
    var attempt = 0;
    function exec(){
      attempt++;
      return fn().catch(function(err){
        var delay = Math.min(30000, Math.pow(2, attempt - 1) * 1000);
        if (delay >= 30000 && attempt > 6){ throw err; }
        return new Promise(function(resolve){
          setTimeout(function(){ resolve(exec()); }, delay);
        });
      });
    }
    return exec();
  }

  function ensureInit(){
    if (initPromise) return initPromise;
    return Promise.reject(new Error('CloudStats.init not called'));
  }

  function buildPerfKey(asset, tf){
    var a = String(asset || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
    var t = String(tf || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '_');
    if (!a) a = 'UNKNOWN';
    if (!t) t = 'TF';
    return 's1__' + a + '__' + t;
  }

  function computeEwma(prev, outcome, alpha){
    if (!isFinite(prev)) prev = 0.5;
    if (!isFinite(outcome)) outcome = 0.5;
    if (!isFinite(alpha) || alpha <= 0 || alpha >= 1) alpha = DEFAULTS.alpha;
    return prev + alpha * (outcome - prev);
  }

  function normalizePerf(doc){
    if (!doc) return null;
    var perf = clone(doc);
    if (perf && perf.updatedAt && perf.updatedAt.toMillis){
      perf.updatedAt = perf.updatedAt.toMillis();
    } else if (perf && perf.updatedAt && perf.updatedAt.seconds){
      perf.updatedAt = perf.updatedAt.seconds * 1000;
    }
    if (!perf.signals) perf.signals = {};
    return perf;
  }

  function pushQueue(entry){
    writeQueue.push(entry);
    if (writeQueue.length > 60) writeQueue = writeQueue.slice(-60);
    persistQueue();
    processQueue();
  }

  function processQueue(){
    if (processingQueue) return;
    if (!writeQueue.length) return;
    if (now() < writeThrottleUntil) return;
    processingQueue = true;
    ensureInit().then(function(){ return runQueueEntry(); }).catch(function(err){
      processingQueue = false;
      writeThrottleUntil = now() + DEFAULTS.writeCooldownMs;
      console.warn('[CLOUD ERROR] queue error', err && err.message ? err.message : err);
    });
  }

  function runQueueEntry(){
    if (!writeQueue.length){ processingQueue = false; persistQueue(); return Promise.resolve(); }
    var entry = writeQueue[0];
    return withRetry(function(){ return applyWrite(entry); }).then(function(){
      writeQueue.shift();
      persistQueue();
      writeThrottleUntil = now() + DEFAULTS.writeCooldownMs;
      processingQueue = false;
      if (writeQueue.length){ setTimeout(processQueue, DEFAULTS.writeCooldownMs); }
    }).catch(function(err){
      processingQueue = false;
      console.warn('[CLOUD ERROR] write failed', err && err.message ? err.message : err);
      writeThrottleUntil = now() + DEFAULTS.writeCooldownMs;
    });
  }

  function applyWrite(entry){
    if (!firestoreDb) return Promise.reject(new Error('Firestore not ready'));
    var trade = entry.trade || {};
    var perfKey = buildPerfKey(trade.asset, trade.timeframe);
    var perfRef = firestoreDb.collection('signals_perf').doc(perfKey);
    var tradeDate = new Date(trade.tsClose || trade.tsOpen || now());
    var y = tradeDate.getUTCFullYear();
    var m = tradeDate.getUTCMonth() + 1;
    var d = tradeDate.getUTCDate();
    var bucket = String(y) + String(m < 10 ? '0' + m : m) + String(d < 10 ? '0' + d : d);
    var tradeRef = firestoreDb.collection('trade_logs').doc(bucket).collection('items').doc();

    return firestoreDb.runTransaction(function(tx){
      return tx.get(perfRef).then(function(doc){
        var data = doc.exists ? doc.data() : { schema: 's1', trades: 0, wins: 0, losses: 0, ewma: 0.5, avgROI: 0, signals: {} };
        var signalKey = trade.signalKey || 'unknown';
        if (!data.signals) data.signals = {};
        if (!data.signals[signalKey]){
          data.signals[signalKey] = { trades: 0, wins: 0, losses: 0, ewma: 0.5, avgROI: 0, lastTs: 0 };
        }
        var sig = data.signals[signalKey];
        var result = String(trade.result || '').toLowerCase();
        var win = result === 'win' || result === 'won';
        var loss = result === 'loss' || result === 'lost';
        var roi = 0;
        if (isFinite(trade.pnl) && isFinite(trade.bet) && trade.bet !== 0){
          roi = trade.pnl / Math.abs(trade.bet);
        }
        data.trades = (data.trades || 0) + 1;
        data.wins = (data.wins || 0) + (win ? 1 : 0);
        data.losses = (data.losses || 0) + (loss ? 1 : 0);
        data.ewma = computeEwma(data.ewma, win ? 1 : (loss ? 0 : 0.5), entry.alpha || DEFAULTS.alpha);
        data.avgROI = data.avgROI == null ? roi : ((data.avgROI * (data.trades - 1) + roi) / data.trades);
        data.asset = trade.asset;
        data.timeframe = trade.timeframe;
        data.updatedAt = new Date(now());
        data.schema = 's1';

        sig.trades = (sig.trades || 0) + 1;
        sig.wins = (sig.wins || 0) + (win ? 1 : 0);
        sig.losses = (sig.losses || 0) + (loss ? 1 : 0);
        sig.ewma = computeEwma(sig.ewma, win ? 1 : (loss ? 0 : 0.5), entry.alpha || DEFAULTS.alpha);
        sig.avgROI = sig.avgROI == null ? roi : ((sig.avgROI * (sig.trades - 1) + roi) / sig.trades);
        sig.lastTs = trade.tsClose || trade.tsOpen || now();

        var payload = clone(data);
        var signalsClone = clone(data.signals);
        payload.signals = signalsClone;

        tx.set(perfRef, payload, { merge: true });
        tx.set(tradeRef, clone(trade));

        savePerfToCache(perfKey, payload);
      });
    });
  }

  function projectScore(sig, weights){
    if (!sig) return 0;
    var w = weights || DEFAULTS.weights;
    var trades = sig.trades || 0;
    var wins = sig.wins || 0;
    var losses = sig.losses || 0;
    var wr = trades > 0 ? wins / trades : 0.5;
    var ewma = isFinite(sig.ewma) ? sig.ewma : wr;
    var roi = isFinite(sig.avgROI) ? sig.avgROI : 0;
    var cappedTrades = Math.min(trades, w.Tcap || DEFAULTS.weights.Tcap || 200);
    var tradeRatio = (w.Tcap ? (cappedTrades / w.Tcap) : (trades / 200));
    if (!isFinite(tradeRatio)) tradeRatio = 0;
    var stability = trades > 0 ? 1 - (Math.abs(wins - losses) / trades) : 0.5;
    var score = (ewma * (w.w1 || 0)) + (wr * (w.w2 || 0)) + (roi * (w.w3 || 0)) + (tradeRatio * (w.w4 || 0));
    score += stability * 0.05;
    return score;
  }

  var CloudStats = {
    init: function(cfg){
      if (initPromise) return initPromise;
      loadCache();
      loadQueueFromStorage();
      lastInitCfg = cfg || {};
      initPromise = waitFirebaseReady().then(function(){
        var firebase = global.firebase;
        if (!firebase) throw new Error('Firebase SDK missing');
        var baseCfg = clone(cfg || {});
        if (baseCfg && baseCfg.recaptchaKey) delete baseCfg.recaptchaKey;
        if (firebase.apps && firebase.apps.length && firebase.apps[0]){
          firebaseApp = firebase.apps[0];
        } else {
          firebaseApp = firebase.initializeApp(baseCfg);
        }
        firestoreDb = firebase.firestore();
        firebaseAuth = firebase.auth();
        firebaseAppCheck = firebase.appCheck ? firebase.appCheck() : null;

        if (firebaseAppCheck && cfg && cfg.recaptchaKey){
          try{
            firebaseAppCheck.activate(cfg.recaptchaKey, true);
          }catch(err){
            console.warn('[CLOUD ERROR] AppCheck activate skipped', err && err.message ? err.message : err);
          }
        }

        if (firebaseAuth && firebaseAuth.currentUser && firebaseAuth.currentUser.isAnonymous){
          return firebaseAuth.currentUser;
        }
        if (!firebaseAuth) return null;
        return firebaseAuth.signInAnonymously().catch(function(err){
          console.warn('[CLOUD ERROR] Anonymous auth init failed', err && err.message ? err.message : err);
          throw err;
        });
      }).then(function(){
        processQueue();
        return true;
      }).catch(function(err){
        console.warn('[CLOUD ERROR] init failed', err && err.message ? err.message : err);
        throw err;
      });
      return initPromise;
    },

    readPerf: function(asset, tf){
      return ensureInit().then(function(){
        var key = buildPerfKey(asset, tf);
        var c = cachePerf[key];
        var nowTs = now();
        if (c && (nowTs - c.ts) < DEFAULTS.cacheTtlMs){
          return clone(c.data);
        }
        var lastRead = readThrottles[key] || 0;
        if ((nowTs - lastRead) < DEFAULTS.readCooldownMs && c){
          return clone(c.data);
        }
        readThrottles[key] = nowTs;
        return withRetry(function(){
          return firestoreDb.collection('signals_perf').doc(key).get().then(function(snap){
            if (!snap.exists){
              if (c) return clone(c.data);
              return null;
            }
            var doc = normalizePerf(snap.data());
            savePerfToCache(key, doc);
            return clone(doc);
          });
        }).catch(function(err){
          console.warn('[CLOUD ERROR] read failed', err && err.message ? err.message : err);
          if (c) return clone(c.data);
          return null;
        });
      });
    },

    updateAfterTrade: function(trade){
      return ensureInit().then(function(){
        pushQueue({ trade: clone(trade), alpha: DEFAULTS.alpha, enqueuedAt: now() });
      });
    },

    rankSignals: function(perf, weights, limit){
      if (!perf || !perf.signals) return [];
      var list = [];
      var w = weights || DEFAULTS.weights;
      var lim = typeof limit === 'number' && limit > 0 ? limit : 5;
      for (var key in perf.signals){
        if (!perf.signals.hasOwnProperty(key)) continue;
        var sig = perf.signals[key];
        var score = projectScore(sig, w);
        list.push({ key: key, score: score, stats: clone(sig) });
      }
      list.sort(function(a, b){ return b.score - a.score; });
      if (list.length > lim) list = list.slice(0, lim);
      return list;
    },

    shouldTrade: function(key, perf, policy){
      var cfg = policy || {};
      var T_min = isFinite(cfg.T_min) ? cfg.T_min : DEFAULTS.T_min;
      var ewmaMin = isFinite(cfg.ewmaMin) ? cfg.ewmaMin : DEFAULTS.ewmaMin;
      if (!perf || !perf.signals) return false;
      var sig = perf.signals[key];
      if (!sig) return false;
      if ((sig.trades || 0) < T_min) return false;
      var ewma = isFinite(sig.ewma) ? sig.ewma : 0.5;
      if (ewma < ewmaMin) return false;
      return true;
    },

    defaults: clone(DEFAULTS),

    _state: function(){
      return {
        queueLength: writeQueue.length,
        cacheKeys: Object.keys(cachePerf || {}),
        lastConfig: clone(lastInitCfg)
      };
    }
  };

  if (typeof module !== 'undefined' && module.exports){ module.exports = CloudStats; }
  global.CloudStats = CloudStats;

})(typeof window !== 'undefined' ? window : this);

const appversion = "Verter ver. 5.11.1";

// === CHS PROTOCOL: flags + compact console + build tag ===
var BOT_BUILD = "5.11.1 Pre-Arming v1.0 PCS";
var QUIET_CONSOLE = true; // only errors by default
try{ console.log("[BUILD]", BOT_BUILD, { CHS:true, ts:1757974218 }); }catch(_){
}


// Martingale warm-up trades before stepping (0 = off)
const MG_WARMUP_TRADES = 0;


/* ====== CloudStats integration flags ====== */
const enableCloud = true;
const cloudReadOnly = false;
const CLOUD_REFRESH_MINUTES = 3;
const CLOUD_MAX_TRADE_PER_HOUR = 6;
const CLOUD_EXPLORE_RATE = 0.15;

function loadCloudConfig(){
  var overrides = null;
  try{
    if (window.__VERTER_FIREBASE_CONFIG__) overrides = window.__VERTER_FIREBASE_CONFIG__;
  }catch(_){ }
  if (!overrides){
    try{
      var raw = localStorage.getItem('verter_cloud_config');
      if (raw) overrides = JSON.parse(raw);
    }catch(_){ overrides = null; }
  }
  var cfg = shallowAssign({}, firebaseConfig);
  if (overrides) cfg = shallowAssign(cfg, overrides);
  cfg.recaptchaKey = recaptchaKey;
  return cfg;
}

var botState = {
  cloud: {
    enabled: enableCloud,
    readOnly: cloudReadOnly,
    lambdaStages: [0.8, 0.6, 0.4, 0.2, 0.0],
    lambdaIndex: 0,
    lambda: 0.8,
    mode: 'COLD',
    lastMode: 'COLD',
    lastFetch: 0,
    nextFetch: 0,
    perf: null,
    topSignals: [],
    trades: 0,
    wins: 0,
    losses: 0,
    ewmaLive: 0.5,
    lossStreak: 0,
    cloudAge: null,
    tradesHour: {},
    exploreToggle: 0,
    driftTriggered: false,
    lastAssetKey: null,
    recentResults: [],
    recoveryStreak: 0,
    policy: { T_min: 30, ewmaMin: 0.52 },
    weights: { w1: 0.5, w2: 0.3, w3: 0.1, w4: 0.1, Tcap: 200 }
  }
};


/* ====== SAFE KEYS BLIND CONFIGURATION ====== */
var SAFE_KEYS_BLIND = {
  STEP_DELAY_MS: 55,
  BATCH_PAUSE_MS: 100,
  USE_SHIFT_FOR_RESET: true,
  RESET_SHIFT_A_BLOCKS: 15,
  SHIFT_A_BLOCK_SIZE: 8,
  RESET_A_TAIL_TICKS: 25,
  WATCHDOG_MS: 12000,
  THROTTLE_MS: 500
};

var safeBlind = (function(){
  'use strict';
  var defaults = {
    STEP_DELAY_MS: 55,
    BATCH_PAUSE_MS: 100,
    USE_SHIFT_FOR_RESET: true,
    RESET_SHIFT_A_BLOCKS: 15,
    SHIFT_A_BLOCK_SIZE: 8,
    RESET_A_TAIL_TICKS: 25,
    WATCHDOG_MS: 12000,
    THROTTLE_MS: 500
  };

  function assignDefaults(cfg){
    var merged = {};
    var key;
    for (key in defaults){
      if (defaults.hasOwnProperty(key)) merged[key] = defaults[key];
    }
    if (!cfg) return merged;
    for (key in cfg){
      if (cfg.hasOwnProperty(key)) merged[key] = cfg[key];
    }
    return merged;
  }

  var config = assignDefaults(typeof SAFE_KEYS_BLIND !== 'undefined' ? SAFE_KEYS_BLIND : null);

  var state = {
    status: 'IDLE',
    step: 0,
    pressCount: 0,
    amount: null,
    preparedAt: 0,
    isPreparing: false,
    throttleUntil: 0,
    step0PressCount: null
  };

  var indicatorUpdater = null;
  var watchdogTimer = null;

  function now(){ return Date.now(); }

  function log(){
    try{ console.log.apply(console, arguments); }catch(_){ }
  }

  function warn(){
    try{ console.warn.apply(console, arguments); }catch(_){ }
  }

  function pressKey(letter, opts){
    if (!letter) return;
    var options = opts || {};
    var key = String(letter).toUpperCase();
    if (!key) return;
    var code = key.charCodeAt(0);
    var eventInit = {
      key: key,
      code: 'Key' + key,
      keyCode: code,
      which: code,
      shiftKey: !!options.shift,
      bubbles: true,
      cancelable: true
    };
    try{
      document.dispatchEvent(new KeyboardEvent('keydown', eventInit));
      document.dispatchEvent(new KeyboardEvent('keyup', eventInit));
    }catch(e){}
  }

  function updateIndicator(){
    if (typeof indicatorUpdater === 'function'){
      try{ indicatorUpdater(getState()); }catch(_){ }
    }
  }

  function getState(){
    return {
      status: state.status,
      step: state.step,
      pressCount: state.pressCount,
      amount: state.amount,
      preparedAt: state.preparedAt,
      throttleUntil: state.throttleUntil,
      isPreparing: state.isPreparing
    };
  }

  function setStatus(status, meta){
    state.status = status;
    if (meta){
      if (meta.step !== undefined) state.step = meta.step;
      if (meta.pressCount !== undefined) state.pressCount = meta.pressCount;
      if (meta.amount !== undefined) state.amount = meta.amount;
      if (meta.preparedAt !== undefined) state.preparedAt = meta.preparedAt;
    }
    updateIndicator();
  }

  function clearWatchdog(){
    if (watchdogTimer){
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function startWatchdog(){
    clearWatchdog();
    watchdogTimer = setTimeout(function(){
      watchdogTimer = null;
      state.isPreparing = false;
      setStatus('ABORT', {});
      warn('[BET][ABORT]', 'reason=watchdog');
    }, config.WATCHDOG_MS);
  }

  function pressRepeated(key, times, opts, delay, done){
    var total = Math.max(0, times|0);
    var stepDelay = typeof delay === 'number' ? delay : config.STEP_DELAY_MS;
    if (typeof done !== 'function') done = function(){};
    if (!total){
      return setTimeout(done, stepDelay);
    }
    var index = 0;
    function tick(){
      pressKey(key, opts);
      index++;
      if (index >= total){
        setTimeout(done, stepDelay);
      } else {
        setTimeout(tick, stepDelay);
      }
    }
    tick();
  }

  function performReset(onDone){
    if (typeof onDone !== 'function') onDone = function(){};
    var blocks = config.USE_SHIFT_FOR_RESET ? config.RESET_SHIFT_A_BLOCKS : 0;
    var blockIndex = 0;

    function runTail(){
      pressRepeated('A', config.RESET_A_TAIL_TICKS, {}, config.STEP_DELAY_MS, function(){
        onDone(blocks);
      });
    }

    function runNextBlock(){
      if (!blocks || blockIndex >= blocks){
        return runTail();
      }
      pressRepeated('A', config.SHIFT_A_BLOCK_SIZE, { shift: true }, config.STEP_DELAY_MS, function(){
        blockIndex++;
        if (blockIndex < blocks){
          setTimeout(runNextBlock, config.BATCH_PAUSE_MS);
        } else {
          setTimeout(runTail, config.BATCH_PAUSE_MS);
        }
      });
    }

    if (blocks){
      runNextBlock();
    } else {
      runTail();
    }
  }

  function performSet(pressCount, onDone){
    pressRepeated('D', pressCount, {}, config.STEP_DELAY_MS, function(){
      if (typeof onDone === 'function') onDone();
    });
  }

  function finishSuccess(step){
    clearWatchdog();
    state.isPreparing = false;
    var preparedAt = now();
    setStatus('ARMED', { step: step, preparedAt: preparedAt, amount: state.amount, pressCount: state.pressCount });
    var amt = state.amount;
    log('[ARMED]', 'step=' + step, 'calc=$' + (typeof amt === 'number' ? amt.toFixed(2) : '—'));
  }

  function begin(step, pressCount, meta){
    if (typeof pressCount !== 'number' || pressCount < 0){
      warn('[BET][PREP_SKIP]', 'reason=invalid-press', 'step=' + step, 'pressCount=' + pressCount);
      return false;
    }
    var ts = now();
    if (state.isPreparing){
      warn('[BET][PREP_SKIP]', 'reason=busy', 'activeStep=' + state.step);
      return false;
    }
    if (state.throttleUntil && ts < state.throttleUntil){
      warn('[BET][PREP_SKIP]', 'reason=throttle', 'wait=' + (state.throttleUntil - ts));
      return false;
    }
    if (step === 0) state.step0PressCount = pressCount;
    state.isPreparing = true;
    state.step = step;
    state.pressCount = pressCount;
    if (meta && typeof meta.amount === 'number') state.amount = meta.amount;
    setStatus('PREPARING', { step: step, pressCount: pressCount, amount: state.amount });
    log('[BET][PREP_START]', 'step=' + step, 'pressCount=' + pressCount);
    state.throttleUntil = ts + config.THROTTLE_MS;
    startWatchdog();
    performReset(function(blocksUsed){
      log('[BET][RESET]', 'blocks=' + (blocksUsed || 0), 'tail=' + config.RESET_A_TAIL_TICKS);
      performSet(pressCount, function(){
        log('[BET][SET]', 'D×' + pressCount);
        finishSuccess(step);
      });
    });
    return true;
  }

  function prepare(step, pressCount, meta){
    return begin(step, pressCount, meta || {});
  }

  function prepareStep0(pressCount, meta){
    var effective = pressCount;
    if (typeof effective !== 'number'){
      if (typeof state.step0PressCount === 'number') effective = state.step0PressCount;
      else effective = 0;
    }
    return begin(0, effective, meta || {});
  }

  function click(side){
    if (!side) return;
    var dir = String(side).toLowerCase();
    if (dir === 'buy'){
      try{ buy(); }catch(_){ }
    } else if (dir === 'sell'){
      try{ sell(); }catch(_){ }
    } else {
      return;
    }
    log('[TRADE][CLICK]', 'side=' + dir.toUpperCase());
    setStatus('IDLE', {});
    state.amount = null;
  }

  return {
    prepare: prepare,
    prepareStep0: prepareStep0,
    click: click,
    getState: getState,
    setIndicatorUpdater: function(fn){
      indicatorUpdater = fn;
      updateIndicator();
    }
  };
})();

function updateArmedIndicator(state){
  if (!armedIndicatorDiv){ return; }
  if (!state) state = {};
  var valueEl = armedIndicatorDiv.querySelector('#armed-status-value');
  var labelEl = armedIndicatorDiv.querySelector('#armed-status-label');
  if (labelEl){ labelEl.textContent = 'ARMED'; }
  var status = state.status || 'IDLE';
  var bg = '#2a2a2a';
  var text = 'IDLE';
  if (status === 'ARMED'){
    var amt = (typeof state.amount === 'number') ? state.amount : null;
    var sec = state.preparedAt ? Math.max(0, Math.floor((Date.now() - state.preparedAt)/1000)) : 0;
    var stepInfo = (typeof state.step === 'number') ? ('step ' + state.step + ' • ') : '';
    text = stepInfo + '$' + (amt != null ? amt.toFixed(2) : '—') + ' • ' + sec + 's ago';
    bg = '#1f6f2d';
  } else if (status === 'PREPARING'){
    var prepStep = (typeof state.step === 'number') ? ('step ' + state.step + ' • ') : '';
    text = prepStep + 'Preparing…';
    bg = '#1d4b9b';
  } else if (status === 'ABORT'){
    text = 'Abort';
    bg = '#9a1f1f';
  } else {
    text = status;
    bg = '#444';
  }
  armedIndicatorDiv.style.background = bg;
  if (valueEl){ valueEl.textContent = text; }
}

try{ safeBlind.setIndicatorUpdater(updateArmedIndicator); }catch(e){}

/* ====== CONFIG / LIMITS / ARRAYS ====== */
const reverse = false;
const mode = 'DEMO';
const cyclesToPlayDefault = 21;
let cyclesToPlay = cyclesToPlayDefault;
const limitWin1  = 500;
const limitLoss1 = -800;
const limitWin2  = 1000;
const limitLoss2 = -2000;
const limitWin3  = 2000;
const limitLoss3 = -4000;

let limitWin = limitWin1;
let limitLoss = limitLoss1;

const candleInterval = 60000;
const minTimeBetweenTrades = 5000;
const signalCheckInterval = 1000;

const redColor   = '#B90000';
const greenColor = '#009500';

const betArray1 = [
    {step: 0, value: 10,  pressCount: 9},
    {step: 1, value: 30,  pressCount: 13},
    {step: 2, value: 80,  pressCount: 20},
    {step: 3, value: 200, pressCount: 24},
    {step: 4, value: 450, pressCount: 111}
];
const betArray2 = [
    {step: 0, value: 30,  pressCount: 13},
    {step: 1, value: 80,  pressCount: 20},
    {step: 2, value: 200, pressCount: 24},
    {step: 3, value: 400, pressCount: 27},
    {step: 4, value: 900, pressCount: 33}
];
const betArray3 = [
    {step: 0, value: 80,   pressCount: 20},
    {step: 1, value: 200,  pressCount: 24},
    {step: 2, value: 400,  pressCount: 27},
    {step: 3, value: 900,  pressCount: 33},
    {step: 4, value: 1800, pressCount: 42}
];

let activeBetArrayName = 'betArray1';

function logActiveBetArray(name){
  activeBetArrayName = name;
  try{ console.log("[DEBUG] Active bet array:", name); }catch(_){ }
}

let betArray = betArray1;
logActiveBetArray("betArray1");

/* ====== STATE ====== */
let priceBuffer = [];
let candlePrices = [];
let lastCandleTime = Date.now();
let time = Date.now();
let startTime = humanTime(time);
let maxStepInCycle = 0;
let cyclesStats = [];
let tradingAllowed = true;
let isTradeOpen = false;
let enteringTrade = false;
let currentBetStep = 0;
let betHistory = [];
let priceHistory = [];
let currentBalance;
let currentProfit = 0;
let totalWager = 0;
let globalPrice;
let lastTradeTime = 0;
let lastSignalCheck = 0;
let signalSensitivity = 3;
let autoTradingEnabled = true;

/* ====== NEW: Signal Stats (QWEN-like) ====== */
// структура для учёта точности по каждому сигналу
const _signalList = [
  'ema_bullish','ema_bearish',
  'rsi_oversold','rsi_overbought',
  'macd_bull','macd_bear',
  'bb_lower_touch','bb_upper_touch',
  'stoch_oversold','stoch_overbought',
  'roc_up','roc_down',
  'ao_up','ao_down',
  'psar_up','psar_down',
  'trend_up','trend_down',
  'pa_bullish','pa_bearish',
  'sr_support','sr_resistance',
  'mtf_buy','mtf_sell'
];
let signalAccuracy = {};
let signalWeights  = {};
(function initSignals(){
  _signalList.forEach(name=>{
    if (!signalAccuracy[name]) signalAccuracy[name] = {hits:0,total:0};
    if (!signalWeights[name])  signalWeights[name]  = 2; // базовый вес
  });
})();
// снимок активных сигналов, сработавших в момент принятия решения
window.activeSignalsSnapshot  = [];
window.activeSignalsThisTrade = null;

/* ====== Cloud Stats helpers ====== */
var cloudSdkLoading = null;
var cloudInitPromise = null;
var cloudRefreshTimer = null;

function shallowAssign(target){
  var out = target || {};
  for (var i = 1; i < arguments.length; i++){
    var src = arguments[i];
    if (!src) continue;
    for (var k in src){
      if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    }
  }
  return out;
}

function loadScriptOnce(url){
  return new Promise(function(resolve, reject){
    try{
      var attr = 'data-cloudsrc';
      var existing = document.querySelector('script[' + attr + '="' + url + '"]');
      if (existing){
        if (existing.getAttribute('data-loaded') === '1'){ resolve(); return; }
        existing.addEventListener('load', function(){ existing.setAttribute('data-loaded', '1'); resolve(); });
        existing.addEventListener('error', function(){ reject(new Error('Failed to load ' + url)); });
        return;
      }
      var script = document.createElement('script');
      script.type = 'text/javascript';
      script.async = true;
      script.setAttribute(attr, url);
      script.addEventListener('load', function(){ script.setAttribute('data-loaded', '1'); resolve(); });
      script.addEventListener('error', function(){ reject(new Error('Failed to load ' + url)); });
      script.src = url;
      (document.head || document.documentElement || document.body).appendChild(script);
    }catch(e){ reject(e); }
  });
}

function loadFirebaseCompat(){
  if (cloudSdkLoading) return cloudSdkLoading;
  var urls = [
    'https://www.gstatic.com/firebasejs/9.22.2/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.2/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore-compat.js',
    'https://www.gstatic.com/firebasejs/9.22.2/firebase-app-check-compat.js'
  ];
  cloudSdkLoading = urls.reduce(function(prev, url){
    return prev.then(function(){ return loadScriptOnce(url); });
  }, Promise.resolve());
  return cloudSdkLoading;
}

function bootstrapFirebaseCore(){
  if (firebaseBootstrapPromise) return firebaseBootstrapPromise;
  firebaseBootstrapPromise = loadFirebaseCompat().then(function(){
    var firebase = window.firebase;
    if (!firebase) throw new Error('Firebase SDK missing');

    if (!firebase.apps || !firebase.apps.length){
      firebase.initializeApp(firebaseConfig); // 1) Firebase SDK
    }

    try {
      if (firebase.appCheck){
        var appCheckInstance = firebase.appCheck();
        if (appCheckInstance && typeof appCheckInstance.activate === 'function'){
          appCheckInstance.activate(recaptchaKey, true); // 2) App Check (reCAPTCHA v3)
        }
      }
    } catch (err){
      console.warn('[CLOUD ERROR] Firebase AppCheck activate failed', err && err.message ? err.message : err);
    }

    var auth = null;
    try {
      auth = firebase.auth();
      if (auth && !firebaseAuthWatcherSet){
        firebaseAuthWatcherSet = true;
        auth.onAuthStateChanged(function(u){ // 3) Anonymous Auth
          if (!u){
            auth.signInAnonymously().catch(function(err){
              console.warn('[CLOUD ERROR] Anonymous auth failed', err && err.message ? err.message : err);
            });
          }
        }, function(err){
          console.warn('[CLOUD ERROR] Auth state listener error', err && err.message ? err.message : err);
        });
        if (!auth.currentUser){
          auth.signInAnonymously().catch(function(err){
            console.warn('[CLOUD ERROR] Anonymous auth bootstrap failed', err && err.message ? err.message : err);
          });
        }
      }
    } catch (err){
      console.warn('[CLOUD ERROR] Firebase auth init failed', err && err.message ? err.message : err);
    }

    try {
      const db = firebase.firestore(); // 4) Firestore
      firebaseDbInstance = db;
      try{ window.__VERTER_FIRESTORE__ = db; }catch(_){ }
    } catch (err){
      console.warn('[CLOUD ERROR] Firestore init failed', err && err.message ? err.message : err);
      throw err;
    }

    try{ window.__VERTER_FIREBASE__ = firebase; }catch(_){ }
    return { firebase: firebase, db: firebaseDbInstance };
  }).catch(function(err){
    console.warn('[CLOUD ERROR] Firebase bootstrap failed', err && err.message ? err.message : err);
    firebaseBootstrapPromise = null;
    throw err;
  });
  return firebaseBootstrapPromise;
}

function ensureCloudReady(){
  if (!enableCloud){ return Promise.reject(new Error('Cloud disabled')); }
  if (cloudInitPromise) return cloudInitPromise;
  var cfg = loadCloudConfig();
  if (!cfg){ return Promise.reject(new Error('Cloud config missing')); }
  var normalized = shallowAssign({}, cfg);
  if (!normalized.projectId && normalized.project_id) normalized.projectId = normalized.project_id;
  if (!normalized.apiKey && normalized.api_key) normalized.apiKey = normalized.api_key;
  cloudInitPromise = bootstrapFirebaseCore()
    .then(function(){ return CloudStats.init(normalized); })
    .then(function(){
      if (CloudStats && CloudStats.defaults && CloudStats.defaults.weights){
        botState.cloud.weights = shallowAssign({}, CloudStats.defaults.weights);
        botState.cloud.policy = shallowAssign({}, { T_min: CloudStats.defaults.T_min, ewmaMin: CloudStats.defaults.ewmaMin });
      }
      return true;
    }).catch(function(err){
      console.warn('[CLOUD ERROR] init error', err && err.message ? err.message : err);
      botState.cloud.enabled = false;
      throw err;
    });
  return cloudInitPromise;
}

function cloudEffectiveLambda(){
  var c = botState.cloud;
  var idx = c.lambdaIndex;
  if (idx < 0) idx = 0;
  if (idx >= c.lambdaStages.length) idx = c.lambdaStages.length - 1;
  var base = c.lambdaStages[idx];
  if (c.mode === 'COLD') return 0;
  if (c.mode === 'WARMUP') return Math.min(base, 0.3);
  return base;
}

function updateCloudLambda(){
  botState.cloud.lambda = cloudEffectiveLambda();
}

function currentHourKey(){
  var d = new Date();
  return d.getUTCFullYear() + '-' + (d.getUTCMonth()+1) + '-' + d.getUTCDate() + '-' + d.getUTCHours();
}

function cloudRecordTradeOpen(){
  var c = botState.cloud;
  var key = currentHourKey();
  if (!c.tradesHour[key]) c.tradesHour[key] = 0;
  c.tradesHour[key] += 1;
  var keys = Object.keys(c.tradesHour);
  if (keys.length > 24){
    keys.sort();
    while (keys.length > 24){
      var drop = keys.shift();
      delete c.tradesHour[drop];
    }
  }
}

function cloudTradesThisHour(){
  var key = currentHourKey();
  return botState.cloud.tradesHour[key] || 0;
}

function shouldThrottleByTraining(){
  var c = botState.cloud;
  if (c.mode === 'HOT' && !c.driftTriggered) return false;
  return cloudTradesThisHour() >= CLOUD_MAX_TRADE_PER_HOUR;
}

function normalizeAssetName(name){
  return String(name || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function getCurrentAssetKey(){
  var asset = normalizeAssetName(symbolName || '');
  var tf = String(currentTF || 'M1').toUpperCase();
  if (!asset) return null;
  return asset + '__' + tf;
}

function normalizeTimeframeName(tf){
  return String(tf || 'M1').toUpperCase();
}

function cloudDirectionLabel(dir){
  var val = String(dir || '').toUpperCase();
  if (val === 'BUY' || val === 'CALL' || val === 'UP') return 'BUY';
  if (val === 'SELL' || val === 'PUT' || val === 'DOWN') return 'SELL';
  return 'FLAT';
}

function toIsoStringSafe(ts){
  try{
    if (!ts) return new Date().toISOString();
    var d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  }catch(_){
    return new Date().toISOString();
  }
}

function updateCloudMode(perf){
  var c = botState.cloud;
  var prevMode = c.mode;
  var trades = perf && isFinite(perf.trades) ? perf.trades : 0;
  var hasEligible = false;
  if (perf && perf.signals){
    for (var key in perf.signals){
      if (!Object.prototype.hasOwnProperty.call(perf.signals, key)) continue;
      if (CloudStats.shouldTrade(key, perf, c.policy)){
        hasEligible = true;
        break;
      }
    }
  }
  var mode = 'COLD';
  if (perf){
    mode = (trades >= 50 && hasEligible) ? 'HOT' : 'WARMUP';
  } else {
    c.driftTriggered = false;
  }
  if (c.driftTriggered) mode = 'DRIFT';
  c.lastMode = prevMode;
  c.mode = mode;
  updateCloudLambda();
  if (prevMode !== mode){
    try{
      console.log('[CLOUD] mode=' + mode + ' trades=' + trades + (perf && perf.ewma != null ? ' ewma=' + (perf.ewma*100).toFixed(1) + '%' : ''));
    }catch(_){ }
  }
}

function updateCloudUi(){
  try{
    var badge = document.getElementById('cloud-status-badge');
    var lambdaEl = document.getElementById('cloud-lambda');
    var topEl = document.getElementById('cloud-top');
    var updEl = document.getElementById('cloud-updated');
    var tradesEl = document.getElementById('cloud-trades');
    if (badge){
      badge.textContent = 'Cloud: ' + botState.cloud.mode;
      var color = '#9e9e9e';
      if (botState.cloud.mode === 'HOT') color = '#00e676';
      else if (botState.cloud.mode === 'WARMUP') color = '#ffeb3b';
      else if (botState.cloud.mode === 'DRIFT') color = '#ff9800';
      else color = '#ff5252';
      badge.style.background = color;
    }
    if (lambdaEl){ lambdaEl.textContent = 'λ=' + botState.cloud.lambda.toFixed(2); }
    if (tradesEl){ tradesEl.textContent = 'Trades: ' + (botState.cloud.trades || 0); }
    if (updEl){
      if (botState.cloud.cloudAge != null){
        var hrs = botState.cloud.cloudAge;
        updEl.textContent = 'Age: ' + hrs.toFixed(1) + 'h';
      }else{
        updEl.textContent = 'Age: —';
      }
    }
    if (topEl){
      var top = botState.cloud.topSignals || [];
      if (!top.length){
        topEl.innerHTML = '<div>Нет данных</div>';
      }else{
        var html = top.map(function(item, idx){
          var stats = item.stats || {};
          var trades = stats.trades || 0;
          var wr = trades ? (stats.wins || 0) / trades : 0;
          var ewma = stats.ewma != null ? stats.ewma : wr;
          return '<div style="display:flex;justify-content:space-between;gap:6px;">'
            + '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (idx+1) + '. ' + item.key + '</span>'
            + '<span style="white-space:nowrap;">EWMA ' + (ewma*100).toFixed(1) + '% • ' + (stats.wins||0) + '/' + trades + '</span>'
            + '</div>';
        }).join('');
        topEl.innerHTML = html;
      }
    }
  }catch(_){ }
}

function updateCloudState(perf){
  botState.cloud.perf = perf;
  botState.cloud.topSignals = perf ? CloudStats.rankSignals(perf, botState.cloud.weights, 5) : [];
  botState.cloud.trades = perf && isFinite(perf.trades) ? perf.trades : 0;
  botState.cloud.wins = perf && isFinite(perf.wins) ? perf.wins : 0;
  botState.cloud.losses = perf && isFinite(perf.losses) ? perf.losses : 0;
  if (perf && perf.updatedAt){
    botState.cloud.cloudAge = (Date.now() - perf.updatedAt) / 3600000;
  }else{
    botState.cloud.cloudAge = null;
  }
  updateCloudMode(perf);
  updateCloudUi();
}

function refreshCloudPerf(force){
  if (!enableCloud || !botState.cloud.enabled) return;
  ensureCloudReady().then(function(){
    var assetKey = getCurrentAssetKey();
    var nowTs = Date.now();
    if (!assetKey){
      updateCloudState(null);
      return;
    }
    if (!force && nowTs < botState.cloud.nextFetch && assetKey === botState.cloud.lastAssetKey){ return; }
    botState.cloud.lastAssetKey = assetKey;
    botState.cloud.lastFetch = nowTs;
    botState.cloud.nextFetch = nowTs + CLOUD_REFRESH_MINUTES * 60000;
    var asset = symbolName || '';
    var tf = currentTF || 'M1';
    CloudStats.readPerf(asset, tf).then(function(perf){
      updateCloudState(perf);
    }).catch(function(err){
      console.warn('[CLOUD ERROR] readPerf failed', err && err.message ? err.message : err);
      updateCloudState(null);
    });
  }).catch(function(err){
    console.warn('[CLOUD ERROR] ensure ready failed', err && err.message ? err.message : err);
    updateCloudState(null);
  });
}

function scheduleCloudRefresh(immediate){
  if (!enableCloud || !botState.cloud.enabled) return;
  ensureCloudReady().then(function(){
    if (immediate) refreshCloudPerf(true);
    if (!cloudRefreshTimer){
      cloudRefreshTimer = setInterval(function(){ refreshCloudPerf(false); }, CLOUD_REFRESH_MINUTES * 60000);
    }
  }).catch(function(err){
    console.warn('[CLOUD ERROR] schedule failed', err && err.message ? err.message : err);
    updateCloudState(null);
  });
}

function recordCloudLiveResult(result){
  var c = botState.cloud;
  var alpha = (CloudStats && CloudStats.defaults && CloudStats.defaults.alpha) || 0.2;
  var outcome = 0.5;
  if (result === 'won') outcome = 1;
  else if (result === 'lost') outcome = 0;
  c.ewmaLive = c.ewmaLive + alpha * (outcome - c.ewmaLive);
  if (result === 'lost') c.lossStreak++; else c.lossStreak = 0;
  c.recentResults.push(outcome);
  if (c.recentResults.length > 50) c.recentResults.shift();
  if (result === 'won' && c.ewmaLive >= 0.54){ c.recoveryStreak += 1; }
  else if (result === 'won'){ c.recoveryStreak = Math.max(1, c.recoveryStreak); }
  else c.recoveryStreak = 0;
  evaluateCloudDrift();
  updateCloudUi();
}

function evaluateCloudDrift(){
  var c = botState.cloud;
  var perf = c.perf;
  var ewmaCloud = (perf && isFinite(perf.ewma)) ? perf.ewma : 0.5;
  var triggers = 0;
  if (c.ewmaLive < 0.48) triggers++;
  if ((c.ewmaLive - ewmaCloud) < -0.06) triggers++;
  if (c.lossStreak >= 3) triggers++;
  if (c.cloudAge != null && c.cloudAge > 48) triggers++;
  if (triggers > 0){
    if (c.lambdaIndex < c.lambdaStages.length - 1) c.lambdaIndex++;
    c.driftTriggered = true;
  } else if (c.driftTriggered && c.recoveryStreak >= 3){
    c.lambdaIndex = Math.max(0, c.lambdaIndex - 1);
    if (c.lambdaIndex === 0) c.driftTriggered = false;
  }
  updateCloudMode(perf);
}

function cloudGuardStep(step){
  if (!enableCloud) return step;
  var c = botState.cloud;
  if (c.mode === 'HOT' && !c.driftTriggered) return step;
  return Math.min(step, 1);
}

function estimateCloudScore(stats){
  if (!stats) return 0;
  var w = botState.cloud.weights || { w1:0.5, w2:0.3, w3:0.1, w4:0.1, Tcap:200 };
  var trades = stats.trades || 0;
  var wins = stats.wins || 0;
  var wr = trades ? wins / trades : 0.5;
  var ewma = (stats.ewma != null) ? stats.ewma : wr;
  var roi = stats.avgROI || 0;
  var cap = w.Tcap || 200;
  var tradeRatio = cap ? Math.min(trades, cap) / cap : 0;
  if (!isFinite(tradeRatio)) tradeRatio = 0;
  return (ewma * (w.w1 || 0)) + (wr * (w.w2 || 0)) + (roi * (w.w3 || 0)) + (tradeRatio * (w.w4 || 0));
}

function signalBias(key){
  var k = String(key || '').toLowerCase();
  if (!k) return 0;
  if (k.indexOf('bull') >= 0 || k.indexOf('buy') >= 0 || k.indexOf('call') >= 0 || /_up$/.test(k) || /upper_break/.test(k) || k.indexOf('support')>=0) return 1;
  if (k.indexOf('bear') >= 0 || k.indexOf('sell') >= 0 || k.indexOf('put') >= 0 || /_down$/.test(k) || /lower_break/.test(k) || k.indexOf('resistance')>=0) return -1;
  if (k.indexOf('oversold') >= 0) return 1;
  if (k.indexOf('overbought') >= 0) return -1;
  return 0;
}

function directionValue(dir){
  if (dir === 'buy') return 1;
  if (dir === 'sell') return -1;
  return 0;
}

function valueToDirection(val, fallback){
  if (val > 0.25) return 'buy';
  if (val < -0.25) return 'sell';
  return fallback || 'flat';
}

function maybeInitCloud(){
  if (!enableCloud) return;
  try{
    scheduleCloudRefresh(true);
  }catch(_){ }
}

/* ====== DOM references (set later in addUI) ====== */
let profitDiv, signalDiv, timeDiv, wonDiv, wagerDiv, tradingSymbolDiv, cyclesHistoryDiv, totalProfitDiv, tradeDirectionDiv, maxStepDiv, profitPercentDivAdvisor, armedIndicatorDiv;
let lossStreakDiv, pauseUntilDiv; // NEW for pause UI

/* ====== Platform DOM ====== */
const percentProfitDiv = document.getElementsByClassName("value__val-start")[0];
const balanceDiv = mode === 'REAL' ? document.getElementsByClassName("js-hd js-balance-real-USD")[0] : document.getElementsByClassName("js-hd js-balance-demo")[0];
const symbolDiv = document.getElementsByClassName("current-symbol")[0];
let symbolName = symbolDiv.textContent.replace("/", " ");
const betTimeDiv = document.getElementsByClassName("value__val")[0];
let betTime = betTimeDiv.textContent;

let priceString = balanceDiv.innerHTML.replace(/,/g, '');
let startBalance = parseFloat(priceString);
let prevBalance = startBalance;

const targetElem = document.getElementsByClassName("tooltip-text");
const textToSearch = "Winnings amount you receive";
let targetElement2;
for (let i = 0; i < targetElem.length; i++) {
  let textContent = targetElem[i].textContent || targetElem[i].innerText;
  if (textContent.includes(textToSearch)) targetElement2 = targetElem[i];
}
const text = targetElement2.innerHTML;
let startPrice = parseFloat(text.match(/\d+.\d+(?=\ a)/g)[0]);
priceHistory.push(startPrice);

let lastMin = startPrice;
let lastMax = startPrice;

/* ====== Cycle chips ====== */
const winCycle = document.createElement("div");
winCycle.className = 'cycle-chip';
winCycle.style.backgroundColor = greenColor;
winCycle.style.color = '#fff';
winCycle.style.display = 'flex';
winCycle.style.flexDirection = 'column';
winCycle.style.alignItems = 'center';
winCycle.style.justifyContent = 'center';
winCycle.style.padding = '2px 4px';
winCycle.style.margin = '0';
winCycle.style.borderRadius = '4px';
winCycle.style.minWidth = '48px';
winCycle.style.height = '40px';
winCycle.style.fontSize = '11px';
winCycle.style.lineHeight = '1.1';
winCycle.style.flex = '0 0 auto';

const loseCycle = document.createElement("div");
loseCycle.className = 'cycle-chip';
loseCycle.style.backgroundColor = redColor;
loseCycle.style.color = '#fff';
loseCycle.style.display = 'flex';
loseCycle.style.flexDirection = 'column';
loseCycle.style.alignItems = 'center';
loseCycle.style.justifyContent = 'center';
loseCycle.style.padding = '2px 4px';
loseCycle.style.margin = '0';
loseCycle.style.borderRadius = '4px';
loseCycle.style.minWidth = '48px';
loseCycle.style.height = '40px';
loseCycle.style.fontSize = '11px';
loseCycle.style.lineHeight = '1.1';
loseCycle.style.flex = '0 0 auto';

/* ====== Keyboard emulation ====== */
const buyButton = document.getElementsByClassName("btn btn-call")[0];
const betInput  = document.getElementsByClassName("call-put-block__in")[0].querySelector("input");

function buy()        { document.dispatchEvent(new KeyboardEvent('keyup', {keyCode: 87, shiftKey: true})); } // W
function sell()       { document.dispatchEvent(new KeyboardEvent('keyup', {keyCode: 83, shiftKey: true})); } // S
function decreaseBet(){ document.dispatchEvent(new KeyboardEvent('keyup', {keyCode: 65, shiftKey: true})); } // A
function increaseBet(){ document.dispatchEvent(new KeyboardEvent('keyup', {keyCode: 68, shiftKey: true})); } // D

/* ====== Helpers / Formatting ====== */
let totalTrades = 0;
let winTrades = 0;

function fmt(n, p = 5){ if (typeof n !== 'number' || isNaN(n)) return String(n); return (Math.round(n*Math.pow(10,p))/Math.pow(10,p)).toFixed(p); }
function fmt2(n,p=2){ if (typeof n !== 'number' || isNaN(n)) return String(n); return (Math.round(n*Math.pow(10,p))/Math.pow(10,p)).toFixed(p); }
function cur(n){ return (n < 0 ? '-' : '') + '$' + Math.abs(Number(n)).toFixed(2); }
function pct(n){ return Number(n).toFixed(2) + '%'; }
function humanTime(t){ let d=new Date(t); let h=String(d.getHours()).padStart(2,'0'), m=String(d.getMinutes()).padStart(2,'0'), s=String(d.getSeconds()).padStart(2,'0'); return `${h}:${m}:${s}`; }
function ts(ms){ return humanTime(ms || Date.now()); }

/* ====== Pause after loss streak (NEW) ====== */
let pauseEnabled = true;    // master switch
let pauseAfterLosses = 3;   // N losses to pause
let pauseMinutes = 5;      // pause duration
let pauseUntil = 0;         // timestamp until pause
let consecutiveLosses = 0;  // current streak

function isPaused(){ return pauseEnabled && Date.now() < pauseUntil; }
function msLeft(){ return Math.max(0, pauseUntil - Date.now()); }

function schedulePause(minutes){
  pauseUntil = Date.now() + minutes * 60 * 1000;
  consecutiveLosses = 0;
  console.log("%c⏸️ [PAUSE] Торговля приостановлена на %d мин (до %s).","color:gold;font-weight:bold;", minutes, humanTime(pauseUntil));
  if (pauseUntilDiv) pauseUntilDiv.textContent = humanTime(pauseUntil);
  if (tradeDirectionDiv){
    tradeDirectionDiv.style.background = '#777';
    tradeDirectionDiv.textContent = `PAUSED (${minutes}m)`;
  }
}
function clearPause(){
  pauseUntil = 0;
  console.log("%c▶️ [PAUSE] Торговля возобновлена вручную.","color:limegreen;font-weight:bold;");
  if (pauseUntilDiv) pauseUntilDiv.textContent = '—';
}

/* ====== Logging ====== */
// Candle (grouped, blue)
function logCandleClose(c){
  try{
    const dir = c.close>c.open ? 'UP' : (c.close<c.open ? 'DOWN' : 'DOJI');
    const body = c.close - c.open;
    const range = c.high - c.low;

    console.groupCollapsed("%c🔵 [CANDLE] %s  |  M1  |  dir:%s","color:dodgerblue;font-weight:bold;", ts(c.tClose), dir);
    console.log("%cO:%s  H:%s  L:%s  C:%s  V:%s","color:dodgerblue;", fmt(c.open), fmt(c.high), fmt(c.low), fmt(c.close), String(c.volume));
    console.log("%cbody:%s  range:%s","color:dodgerblue;", fmt(body), fmt(range));
    console.groupEnd();
  }catch(e){ console.warn('[BOT:CANDLE] log error:', e); }
}
// Trade open (neutral)
function logTradeOpen(tr){
  try{
    const payout = parseInt((percentProfitDiv && percentProfitDiv.innerHTML) || '0',10);
    console.log(
      "%c📥 [TRADE-OPEN] %s | %s | step:%d | bet:%s | payout:%d%% | score B:%s S:%s diff:%s/%s | EMA9:%s EMA21:%s | RSI14:%s | price:%s",
      "color:#e0e0e0;", tr.time, tr.betDirection.toUpperCase(), tr.step, cur(tr.betValue), payout,
      tr.bullishScore, tr.bearishScore, tr.scoreDiff, tr.threshold,
      fmt(tr.shortEMA), fmt(tr.longEMA), fmt2(tr.rsi), fmt(tr.openPrice)
    );
  }catch(e){ console.warn('[BOT:TRADE-OPEN] log error:', e); }
}
// Trade result (colored)
function logTradeResult(last){
  try{
    totalTrades = betHistory.length;
    const wins = betHistory.filter(b => b.won === 'won').length;
    winTrades = wins;
    const winRate = totalTrades ? (wins/totalTrades)*100 : 0;

    const cycProfit  = typeof currentProfit  === 'number' ? currentProfit  : 0;
    const balanceNow = typeof currentBalance === 'number' ? currentBalance : NaN;

    let color="#fff", mark="ℹ️";
    if (last.won === "won")      { color="limegreen"; mark="✅"; }
    else if (last.won === "lost"){ color="crimson";   mark="❌"; }
    else if (last.won === "returned"){ color="gold";  mark="↔️"; }

    console.log(
      "%c%s [TRADE-RESULT] %s | %s | P/L:%s | step:%d bet:%s dir:%s | balance:%s cycleProfit:%s | winRate:%s (%d/%d)",
      `color:${color};font-weight:bold;`,
      mark, ts(), String(last.won).toUpperCase(), cur(last.profit), last.step, cur(last.betValue),
      String(last.betDirection || '').toUpperCase(),
      isNaN(balanceNow)?'N/A':cur(balanceNow), cur(cycProfit), pct(winRate), wins, totalTrades
    );
  }catch(e){ console.warn('[BOT:TRADE-RESULT] log error:', e); }
}

/* ====== Indicators (same as 3.9) ====== */
function updateMinMax(){ if (globalPrice > lastMax) lastMax = globalPrice; if (globalPrice < lastMin) lastMin = globalPrice; }

function calculateEMA(prices, period){
  if (prices.length < period) return prices[prices.length - 1];
  const m = 2/(period+1);
  let ema = prices.slice(0, period).reduce((s,p)=>s+p,0)/period;
  for (let i=period;i<prices.length;i++) ema = (prices[i]*m)+(ema*(1-m));
  return ema;
}
function calculateRSI(prices, period=14){
  if (prices.length < period+1) return 50;
  let gains=0, losses=0;
  for (let i=1;i<=period;i++){ const ch=prices[i]-prices[i-1]; if (ch>0) gains+=ch; else losses+=Math.abs(ch); }
  let avgGain=gains/period, avgLoss=losses/period;
  for (let i=period+1;i<prices.length;i++){
    const ch=prices[i]-prices[i-1]; const g=ch>0?ch:0, l=ch<0?Math.abs(ch):0;
    avgGain=((avgGain*(period-1))+g)/period; avgLoss=((avgLoss*(period-1))+l)/period;
  }
  if (avgLoss===0) return 100;
  const rs=avgGain/avgLoss; return 100-(100/(1+rs));
}
function calculateMACD(prices, fast=12, slow=26, signal=9){
  if (prices.length < slow+signal) return {macd:0, signal:0, histogram:0};
  const fastEMA = calculateEMA(prices, fast);
  const slowEMA = calculateEMA(prices, slow);
  const macd = fastEMA - slowEMA;
  window.macdHistory = window.macdHistory || [];
  window.macdHistory.push(macd);
  if (window.macdHistory.length > signal) window.macdHistory.shift();
  const sig = calculateEMA(window.macdHistory, signal);
  return { macd, signal:sig, histogram:macd - sig };
}
function calculateBollingerBands(prices, period=20, mult=2){
  if (prices.length < period) return {upper:prices[prices.length-1], middle:prices[prices.length-1], lower:prices[prices.length-1]};
  const recent=prices.slice(-period);
  const mid = recent.reduce((s,p)=>s+p,0)/period;
  const variance = recent.reduce((s,p)=>s+Math.pow(p-mid,2),0)/period;
  const std = Math.sqrt(variance);
  return {upper: mid + mult*std, middle: mid, lower: mid - mult*std};
}
function calculateStochastic(prices, period=14){
  if (prices.length < period) return {k:50, d:50};
  const recent = prices.slice(-period);
  const cur = recent[recent.length-1], low=Math.min(...recent), high=Math.max(...recent);
  const k = high===low ? 50 : ((cur-low)/(high-low))*100;
  return {k, d:k};
}
function calculateROC(prices, period=12){ if (prices.length<period+1) return 0; const cur=prices[prices.length-1], past=prices[prices.length-1-period]; return ((cur-past)/past)*100; }
function calculateAwesomeOscillator(prices){ if (prices.length<34) return 0; const sma5=prices.slice(-5).reduce((s,p)=>s+p,0)/5; const sma34=prices.slice(-34).reduce((s,p)=>s+p,0)/34; return sma5 - sma34; }
function calculateParabolicSAR(prices, acc=0.02, max=0.2){
  if (prices.length < 2) return {sar: prices[0], isUpTrend: true};
  let sar=prices[0], ep=prices[1], af=acc, isUpTrend=prices[1]>prices[0];
  for (let i=2;i<prices.length;i++){
    const prevSar = sar;
    if (isUpTrend){
      sar = prevSar + af*(ep - prevSar);
      if (prices[i] > ep){ ep=prices[i]; af=Math.min(af+acc,max); }
      if (prices[i] < sar){ isUpTrend=false; sar=ep; ep=prices[i]; af=acc; }
    } else {
      sar = prevSar + af*(ep - prevSar);
      if (prices[i] < ep){ ep=prices[i]; af=Math.min(af+acc,max); }
      if (prices[i] > sar){ isUpTrend=true; sar=ep; ep=prices[i]; af=acc; }
    }
  }
  return {sar, isUpTrend};
}
function detectTrend(prices, period=10){
  if (prices.length<period) return 'flat';
  const recent=prices.slice(-period);
  let hh=0,ll=0; for (let i=1;i<recent.length;i++){ if (recent[i]>recent[i-1]) hh++; if (recent[i]<recent[i-1]) ll++; }
  const r = hh/(hh+ll);
  if (r>0.7) return 'strong_up'; if (r>0.6) return 'up'; if (r<0.3) return 'strong_down'; if (r<0.4) return 'down'; return 'flat';
}
function analyzePriceAction(prices){
  if (prices.length<10) return {pattern:'insufficient_data', isConsolidating:false};
  const recent=prices.slice(-10); const cur=recent[recent.length-1], prev=recent[recent.length-2];
  const high=Math.max(...recent), low=Math.min(...recent), range=high-low;
  const avg=recent.reduce((s,p)=>s+p,0)/recent.length;
  const isConsolidating = range < (avg*0.001);
  let pattern='neutral';
  if (cur>prev && cur>avg) pattern = cur>high*0.99 ? 'bullish_breakout':'bullish_continuation';
  else if (cur<prev && cur<avg) pattern = cur<low*1.01 ? 'bearish_breakdown':'bearish_continuation';
  const momentum = (cur - recent[0])/recent[0]*100;
  if (momentum>0.05 && recent.slice(0,5).every(p=>p<avg)) pattern='bullish_reversal';
  else if (momentum<-0.05 && recent.slice(0,5).every(p=>p>avg)) pattern='bearish_reversal';
  return {pattern, isConsolidating};
}
function findFractals(prices, period=5){
  if (prices.length<period*2+1) return {bullish:false, bearish:false};
  const c = prices.length - period - 1, cp=prices[c];
  let bull=true; for (let i=c-period;i<=c+period;i++){ if (i!==c && prices[i]<=cp){ bull=false; break; } }
  let bear=true; for (let i=c-period;i<=c+period;i++){ if (i!==c && prices[i]>=cp){ bear=false; break; } }
  return {bullish:bull, bearish:bear};
}
function findSupportResistance(prices){
  if (prices.length<20) return {nearSupport:false, nearResistance:false};
  const cur=prices[prices.length-1], recent=prices.slice(-20);
  const highs=[], lows=[];
  for (let i=2;i<recent.length-2;i++){
    if (recent[i]>recent[i-1]&&recent[i]>recent[i+1]&&recent[i]>recent[i-2]&&recent[i]>recent[i+2]) highs.push(recent[i]);
    if (recent[i]<recent[i-1]&&recent[i]<recent[i+1]&&recent[i]<recent[i-2]&&recent[i]<recent[i+2]) lows.push(recent[i]);
  }
  const th = cur*0.0005;
  const nearSupport = lows.some(v=>Math.abs(cur-v)<th && cur>v);
  const nearResistance = highs.some(v=>Math.abs(cur-v)<th && cur<v);
  return {nearSupport, nearResistance};
}



/* ====== Candle Engine + Chart ====== */
let candlesM1 = [];
let currentCandle = null;
let lastSeconds = new Date().getSeconds();


// === bridge exports (chart/candle engine) + hard reset ===
(function(){
  try{
    function __hardResetChart(){
      // clear data buffers
      try{ candlesM1.length = 0; }catch(e){}
      try{ priceHistory.length = 0; }catch(e){}
      try{ priceBuffer.length = 0; }catch(e){}
      try{ candlePrices.length = 0; }catch(e){}
      try{ currentCandle = null; }catch(e){}
      try{ lastCandleTime = Date.now(); }catch(e){}
      try{ lastSeconds = new Date().getSeconds(); }catch(e){}
      try{ lastMin = globalPrice || startPrice; }catch(e){}
      try{ lastMax = globalPrice || startPrice; }catch(e){}

      // viewport defaults
      try{
        currentTF = 'M1';
        zoom = 60;
        scrollPos = 0;
        liveMode = true;
      }catch(e){}

      // reset UI controls
      try{ const z=document.getElementById('zoom-slider'); if(z) z.value=60; }catch(e){}
      try{ const ss=document.getElementById('scroll-slider'); if(ss){ ss.max=0; ss.value=0; } }catch(e){}
      try{ const live=document.getElementById('live-btn'); if(live){} }catch(e){}

      try{ chartCanvas = document.getElementById('chart-canvas'); }catch(e){}
      try{ if (typeof renderChart==='function') renderChart(); }catch(e){}
    }
    window.__hardResetChart = __hardResetChart;
  }catch(e){ console.warn('[bridge] __hardResetChart inject failed', e); }
})();    
function initChart(){
  try{ console.log('[SYNC WAIT] Preparing first M1 candle...'); }catch(e){}

  const now = Date.now();
  currentCandle = {tOpen:now,tClose:0,open:globalPrice||startPrice,high:globalPrice||startPrice,low:globalPrice||startPrice,close:globalPrice||startPrice,volume:0};
  candlesM1.push(currentCandle);
}

function updateCandles(currentTime, currentPrice){
  if (!currentCandle) return;
  const now = (currentTime instanceof Date)? currentTime : new Date(currentTime);
  const currentSeconds = now.getSeconds();

  // close -> new candle
  if (currentSeconds===0 && lastSeconds!==0){
    try{ console.log('[SYNC] First/next M1 candle opens at ' + now.toLocaleTimeString()); }catch(e){}

    currentCandle.tClose = now.getTime();
    currentCandle.close  = currentPrice;
    logCandleClose(currentCandle);

    const newCandle = {tOpen:now.getTime(), tClose:0, open:currentPrice, high:currentPrice, low:currentPrice, close:currentPrice, volume:0};
    candlesM1.push(newCandle);
    currentCandle = newCandle;
    if (candlesM1.length>240) candlesM1.shift();
  }

  // update running candle
  if (currentPrice !== currentCandle.close){
    if (currentPrice>currentCandle.high) currentCandle.high=currentPrice;
    if (currentPrice<currentCandle.low)  currentCandle.low=currentPrice;
    currentCandle.close=currentPrice; currentCandle.volume++;
  }
  lastSeconds = currentSeconds;
}

function buildM5FromM1(m1){
  let m5=[]; for (let i=0;i<m1.length;i+=5){
    const g=m1.slice(i,i+5); if (g.length<1) break;
    m5.push({ tOpen:g[0].tOpen, tClose:g[g.length-1].tClose||Date.now(), open:g[0].open, high:Math.max(...g.map(c=>c.high)), low:Math.min(...g.map(c=>c.low)), close:g[g.length-1].close, volume:g.reduce((s,c)=>s+c.volume,0) });
  } return m5;
}

// Chart
let chartCanvas, currentTF='M1', zoom=60, scrollPos=0, liveMode=true;

function renderChart(){
  try{
    const ctx = chartCanvas.getContext('2d');
    const W = chartCanvas.width, H = chartCanvas.height;
    ctx.clearRect(0,0,W,H);

    let candles = currentTF==='M1' ? candlesM1 : buildM5FromM1(candlesM1);
    const total=candles.length; if (total<1) return;
    if (liveMode) scrollPos=0;

    const visibleCount = zoom;
    let startIndex = total - visibleCount - scrollPos; if (startIndex<0) startIndex=0;
    let endIndex = Math.min(startIndex + visibleCount, total);
    const v = candles.slice(startIndex, endIndex);

    const minLow = Math.min(...v.map(c=>c.low));
    const maxHigh= Math.max(...v.map(c=>c.high));
    let range = maxHigh - minLow, pad=range*0.05;
    const min=minLow-pad, max=maxHigh+pad; range = max-min;

    const cw = W/visibleCount, bw = cw*0.8; let x=0;
    for (const c of v){
      const oy=((max-c.open)/range)*H, cy=((max-c.close)/range)*H, hy=((max-c.high)/range)*H, ly=((max-c.low)/range)*H;
      ctx.beginPath(); ctx.moveTo(x+cw/2,hy); ctx.lineTo(x+cw/2,ly); ctx.strokeStyle='#888'; ctx.stroke();
      ctx.fillStyle = c.close>=c.open ? '#2ecc71' : '#e74c3c';
      const top=Math.min(oy,cy), bot=Math.max(oy,cy);
      ctx.fillRect(x+(cw-bw)/2, top, bw, bot-top);
      x += cw;
    }
    for (let i=1;i<5;i++){ let y=i*H/5; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.strokeStyle='#888'; ctx.setLineDash([5,5]); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle='#fff'; ctx.font='12px Arial'; ctx.fillText(`Баров: ${v.length}/${total}`, 10, 20);

    const ss=document.getElementById('scroll-slider');
    if (ss){ ss.max=Math.max(0,total-zoom); ss.value=scrollPos; }
  }catch(e){ console.error('Chart render error:', e); }
}

/* ====== Indicators calculation + UI glue ====== */
/* === Integrated OHLC+MTF helpers (strict) === */
function calculateStochasticOHLC(candles, period=14){
  if (!candles || candles.length < period) return {k:50, d:50};
  const seg = candles.slice(-period);
  const hh = Math.max(...seg.map(c=>c.high));
  const ll = Math.min(...seg.map(c=>c.low));
  const close = seg[seg.length-1].close;
  const k = (hh===ll) ? 50 : ((close - ll) / (hh - ll)) * 100;
  return {k, d:k};
}
function calculateAwesomeOscillatorOHLC(candles){
  if (!candles || candles.length < 34) return 0;
  const tp = candles.map(c => (c.high + c.low) / 2);
  const sma = (arr, n) => arr.slice(-n).reduce((s,v)=>s+v,0)/n;
  return sma(tp,5) - sma(tp,34);
}
function calculateParabolicSAR_OHLC(candles, acc=0.02, max=0.2){
  if (!candles || candles.length < 2) return {sar:((candles && candles[0]) ? candles[0].close : 0)||0, isUpTrend:true};
  let isUp = candles[1].close > candles[0].close;
  let ep = isUp ? candles[1].high : candles[1].low;
  let sar = isUp ? candles[0].low  : candles[0].high;
  let af = acc;
  for (let i=2;i<candles.length;i++){
    sar = sar + af*(ep - sar);
    if (isUp){
      if (candles[i].low < sar){ isUp=false; sar=ep; ep=candles[i].low; af=acc; }
      if (candles[i].high > ep){ ep=candles[i].high; af = Math.min(max, af+acc); }
    } else {
      if (candles[i].high > sar){ isUp=true; sar=ep; ep=candles[i].high; af=acc; }
      if (candles[i].low  < ep){ ep=candles[i].low;  af = Math.min(max, af+acc); }
    }
  }
  return {sar, isUpTrend:isUp};
}
function analyzePriceActionOHLC(candles){
  if (!candles || candles.length < 2) return {pattern:'insufficient_data', isConsolidating:false};
  const a = candles[candles.length-2], b = candles[candles.length-1];
  const rangeA = a.high - a.low, rangeB = b.high - b.low;
  const isConsolidating = rangeB < ((rangeA + rangeB)/2) * 0.15;
  const bull = (b.close>b.open)&&(a.close<a.open)&&(b.close>a.open)&&(b.open<a.close);
  const bear = (b.close<b.open)&&(a.close>a.open)&&(b.close<a.open)&&(b.open>a.close);
  const inside = b.high<=a.high && b.low>=a.low;
  let pattern='neutral';
  if (bull) pattern='bullish_engulfing';
  else if (bear) pattern='bearish_engulfing';
  else if (inside) pattern='inside_bar';
  return {pattern, isConsolidating};
}
function findFractalsOHLC(candles, period=2){
  if (!candles || candles.length < period*2+1) return {bullish:false, bearish:false};
  const i = candles.length - period - 1;
  const mid = candles[i];
  let bull=true, bear=true;
  for (let k=i-period;k<=i+period;k++){
    if (k===i) continue;
    if (candles[k].high >= mid.high) bull=false;
    if (candles[k].low  <= mid.low)  bear=false;
  }
  return {bullish:bull, bearish:bear};
}
function findSupportResistanceOHLC(candles, lookback=20, tol=0.0005){
  if (!candles || candles.length<lookback) return {nearSupport:false, nearResistance:false};
  const seg = candles.slice(-lookback);
  const cur = seg[seg.length-1].close;
  const highs=[], lows=[];
  for (let i=2;i<seg.length-2;i++){
    if (seg[i].high>seg[i-1].high&&seg[i].high>seg[i+1].high&&seg[i].high>seg[i-2].high&&seg[i].high>seg[i+2].high) highs.push(seg[i].high);
    if (seg[i].low <seg[i-1].low &&seg[i].low <seg[i+1].low &&seg[i].low <seg[i-2].low &&seg[i].low <seg[i+2].low ) lows.push(seg[i].low);
  }
  const nearSupport = lows.some(v=>Math.abs(cur-v) < cur*tol && cur>v);
  const nearResistance = highs.some(v=>Math.abs(cur-v) < cur*tol && cur<v);
  return {nearSupport, nearResistance};
}
function buildMTF(candlesM1, factor){
  if (!candlesM1 || candlesM1.length===0) return [];
  const out=[];
  for (let i=0;i<candlesM1.length;i+=factor){
    const g = candlesM1.slice(i, i+factor);
    if (!g.length) break;
    out.push({
      tOpen: ((g[0].tOpen )!=null ? (g[0].tOpen ) : (((g[0].time )!=null ? (g[0].time ) : (((g[0].ts )!=null ? (g[0].ts ) : (0)))))),
      tClose: ((g[g.length-1].tClose )!=null ? (g[g.length-1].tClose ) : (((g[g.length-1].time )!=null ? (g[g.length-1].time ) : (((g[g.length-1].ts )!=null ? (g[g.length-1].ts ) : (Date.now())))))),
      open:  g[0].open,
      high:  Math.max(...g.map(c=>c.high)),
      low:   Math.min(...g.map(c=>c.low)),
      close: g[g.length-1].close,
      volume:g.reduce((s,c)=>s+(c.volume||0),0)
    });
  }
  return out;
}
function detectTrendBySlope(data, lookback=10, eps=1e-12){
  if (!data || data.length<lookback) return 'flat';
  const arr = data.slice(-lookback);
  const half = Math.floor(arr.length/2);
  const a = arr.slice(0, half).reduce((s,v)=>s+v,0)/Math.max(1,half);
  const b = arr.slice(half).reduce((s,v)=>s+v,0)/Math.max(1,arr.length-half);
  const slope = (b-a)/(Math.abs(a)+eps);
  if (slope >  0.0015) return 'strong_up';
  if (slope >  0.0003) return 'up';
  if (slope < -0.0015) return 'strong_down';
  if (slope < -0.0003) return 'down';
  return 'flat';
}
function getMultiTimeframeSignal(){
  try{
    const m1  = Array.isArray(candlesM1) ? candlesM1 : [];
    const m5  = buildMTF(m1, 5);
    const m15 = buildMTF(m1, 15);
    if (m1.length < 20 || m5.length < 10 || m15.length < 5) return 'insufficient_data';
    const closes = arr => arr.map(c=>c.close);
    const t1  = detectTrendBySlope(closes(m1),  10);
    const t5  = detectTrendBySlope(closes(m5),   8);
    const t15 = detectTrendBySlope(closes(m15),  5);
    const bulls=[t1,t5,t15].filter(t=>t==='up'||t==='strong_up').length;
    const bears=[t1,t5,t15].filter(t=>t==='down'||t==='strong_down').length;
    return bulls>=2 ? 'buy' : (bears>=2 ? 'sell' : 'flat');
  }catch(e){
    console.warn('[getMultiTimeframeSignal] error', e);
    return 'flat';
  }
}

function calculateIndicators(){
  const currentTime = Date.now();
  if (globalPrice && globalPrice !== priceHistory[priceHistory.length-1]){
    priceBuffer.push({time:currentTime, price:globalPrice});
    if (priceBuffer.length>500) priceBuffer.shift();
  }

  if (currentTime - lastCandleTime >= candleInterval){
    if (priceBuffer.length>0){
      const points = priceBuffer.filter(p=>p.time>=lastCandleTime && p.time<currentTime);
      if (points.length>0){
        const prices = points.map(p=>p.price);
        const close = prices[prices.length-1];
        candlePrices.push(close);
        if (candlePrices.length>50) candlePrices.shift();
      }
    }
    lastCandleTime = currentTime;
  }

  const data = candlesM1.map(function(c){return c.close;});
  if (data.length<20){
    window.currentSignal='flat';
    if (signalDiv) signalDiv.innerHTML='Insufficient Data';
    updateIndicatorDisplay(true);
    // сбрасываем снимок активных сигналов
    window.activeSignalsSnapshot = [];
    return;
  }

  const shortEMA = calculateEMA(data,9);
  const longEMA  = calculateEMA(data,21);
  const rsiValue = calculateRSI(data,14);
  const macdData = calculateMACD(data);
  const bb       = calculateBollingerBands(data);
  const stoch    = calculateStochasticOHLC(candlesM1);
  const rocValue = calculateROC(data,12);
  const ao       = calculateAwesomeOscillatorOHLC(candlesM1);
  const psar     = calculateParabolicSAR_OHLC(candlesM1);
  const trend    = detectTrend(data);
  const fractals = findFractalsOHLC(candlesM1);
  const pa       = analyzePriceActionOHLC(candlesM1);
  const sr       = findSupportResistanceOHLC(candlesM1);
  const mtf      = getMultiTimeframeSignal();

  const currentPrice = data[data.length-1];
  let bullishScore=0, bearishScore=0;

  // NEW: накапливаем имена "активных" сигналов по тем же условиям, где добавляются очки
  const activeSignals = [];

  const emaDiff = shortEMA - longEMA, emaTh=0.0001;
  if (emaDiff>emaTh){ 
    const w = signalWeights['ema_bullish'] || 2;
    bullishScore += 2 * w; 
    activeSignals.push('ema_bullish'); 
  }
  else if (emaDiff<-emaTh){ 
    const w = signalWeights['ema_bearish'] || 2;
    bearishScore += 2 * w; 
    activeSignals.push('ema_bearish'); 
  }

  if (rsiValue<30){ 
    const w = signalWeights['rsi_oversold'] || 2;
    bullishScore += 2 * w; 
    activeSignals.push('rsi_oversold'); 
  }
  else if (rsiValue>70){ 
    const w = signalWeights['rsi_overbought'] || 2;
    bearishScore += 2 * w; 
    activeSignals.push('rsi_overbought'); 
  }
  else if (rsiValue<40){ 
    const w = signalWeights['rsi_oversold'] || 2;
    bullishScore += 1 * w; 
    activeSignals.push('rsi_oversold'); 
  }
  else if (rsiValue>60){ 
    const w = signalWeights['rsi_overbought'] || 2;
    bearishScore += 1 * w; 
    activeSignals.push('rsi_overbought'); 
  }

  if (macdData.macd>macdData.signal && macdData.histogram>0){ 
    const w = signalWeights['macd_bull'] || 2;
    bullishScore += 2 * w; 
    activeSignals.push('macd_bull'); 
  }
  else if (macdData.macd<macdData.signal && macdData.histogram<0){ 
    const w = signalWeights['macd_bear'] || 2;
    bearishScore += 2 * w; 
    activeSignals.push('macd_bear'); 
  }

  if (currentPrice < bb.lower){ 
    const w = signalWeights['bb_lower_touch'] || 2;
    bullishScore += 1 * w; 
    activeSignals.push('bb_lower_touch'); 
  }
  else if (currentPrice > bb.upper){ 
    const w = signalWeights['bb_upper_touch'] || 2;
    bearishScore += 1 * w; 
    activeSignals.push('bb_upper_touch'); 
  }

  if (stoch.k<20 && stoch.d<20){ 
    const w = signalWeights['stoch_oversold'] || 2;
    bullishScore += 1 * w; 
    activeSignals.push('stoch_oversold'); 
  }
  else if (stoch.k>80 && stoch.d>80){ 
    const w = signalWeights['stoch_overbought'] || 2;
    bearishScore += 1 * w; 
    activeSignals.push('stoch_overbought'); 
  }

  if (rocValue>1){ 
    const w = signalWeights['roc_up'] || 2;
    bullishScore += 1 * w; 
    activeSignals.push('roc_up'); 
  }
  else if (rocValue<-1){ 
    const w = signalWeights['roc_down'] || 2;
    bearishScore += 1 * w; 
    activeSignals.push('roc_down'); 
  }

  if (ao>0){ 
    const w = signalWeights['ao_up'] || 2;
    bullishScore += 1 * w; 
    activeSignals.push('ao_up'); 
  }
  else { 
    const w = signalWeights['ao_down'] || 2;
    bearishScore += 1 * w; 
    activeSignals.push('ao_down'); 
  }

  if (psar.isUpTrend){ 
    const w = signalWeights['psar_up'] || 2;
    bullishScore += 1 * w; 
    activeSignals.push('psar_up'); 
  }
  else { 
    const w = signalWeights['psar_down'] || 2;
    bearishScore += 1 * w; 
    activeSignals.push('psar_down'); 
  }

  if (trend==='strong_up'){ 
    const w = signalWeights['trend_up'] || 2;
    bullishScore += 2 * w; 
    activeSignals.push('trend_up'); 
  }
  else if (trend==='up'){ 
    const w = signalWeights['trend_up'] || 2;
    bullishScore += 1 * w; 
    activeSignals.push('trend_up'); 
  }
  else if (trend==='strong_down'){ 
    const w = signalWeights['trend_down'] || 2;
    bearishScore += 2 * w; 
    activeSignals.push('trend_down'); 
  }
  else if (trend==='down'){ 
    const w = signalWeights['trend_down'] || 2;
    bearishScore += 1 * w; 
    activeSignals.push('trend_down'); 
  }

  if (pa.pattern.includes('bullish')){ 
    const w = signalWeights['pa_bullish'] || 2;
    bullishScore += 1 * w; 
    activeSignals.push('pa_bullish'); 
  }
  else if (pa.pattern.includes('bearish')){ 
    const w = signalWeights['pa_bearish'] || 2;
    bearishScore += 1 * w; 
    activeSignals.push('pa_bearish'); 
  }

  if (sr.nearSupport){ 
    const w = signalWeights['sr_support'] || 2;
    bullishScore += 1 * w; 
    activeSignals.push('sr_support'); 
  }
  else if (sr.nearResistance){ 
    const w = signalWeights['sr_resistance'] || 2;
    bearishScore += 1 * w; 
    activeSignals.push('sr_resistance'); 
  }

  if (mtf==='buy'){ 
    const w = signalWeights['mtf_buy'] || 2;
    bullishScore += 3 * w; 
    activeSignals.push('mtf_buy'); 
  }
  else if (mtf==='sell'){ 
    const w = signalWeights['mtf_sell'] || 2;
    bearishScore += 3 * w; 
    activeSignals.push('mtf_sell'); 
  }

  let signal='flat';
  const scoreDiff = Math.abs(bullishScore - bearishScore);
  const minScoreThreshold=5;
  if (bullishScore>bearishScore && bullishScore>=minScoreThreshold && scoreDiff>=3) signal='buy';
  else if (bearishScore>bullishScore && bearishScore>=minScoreThreshold && scoreDiff>=3) signal='sell';
  if (pa.isConsolidating) signal='flat';

  if (signalDiv){
    signalDiv.innerHTML = `${signal.toUpperCase()} (B:${bullishScore} vs S:${bearishScore})`;
    signalDiv.style.backgroundColor = signal==='buy'?greenColor:(signal==='sell'?redColor:'#333');
  }

  window.currentSignal=signal;
  window.currentShortEMA=shortEMA;
  window.currentLongEMA=longEMA;
  window.currentRSI=rsiValue;
  window.bullishScore=bullishScore;
  window.bearishScore=bearishScore;

  // сохраняем снимок активных сигналов для возможного входа
  window.activeSignalsSnapshot = Array.from(new Set(activeSignals));

  updateIndicatorDisplay(false, { shortEMA, longEMA, emaDifference:emaDiff, rsiValue, macdData, bollingerBands:bb, stochastic:stoch, rocValue, awesomeOsc:ao, parabolicSAR:psar, trend, priceAction:pa, mtfSignal:mtf, candlePrices, currentTime });
}
/* ====== UI Panels ====== */
function addSensitivityControl(){
  const c = document.getElementById('sensitivity-control'); if (!c) return;
  c.innerHTML = `
    <div style="margin-bottom:6px;">
      <label for="sensitivity-slider">Signal Sensitivity: <span id="sensitivity-value">${signalSensitivity}</span></label>
      <input type="range" id="sensitivity-slider" min="1" max="10" value="${signalSensitivity}" style="width:150px;">
    </div>
    <div style="margin-bottom:6px;">
      <label for="auto-trading-toggle">Auto Trading:</label>
      <input type="checkbox" id="auto-trading-toggle" ${autoTradingEnabled ? 'checked' : ''}>
    </div>
  `;
  document.getElementById('sensitivity-slider').addEventListener('input', e=>{ signalSensitivity=parseInt(e.target.value); document.getElementById('sensitivity-value').textContent=signalSensitivity; });
  document.getElementById('auto-trading-toggle').addEventListener('change', e=>{ autoTradingEnabled=e.target.checked; });
}

function renderPauseFooter(){
  const footer = document.getElementById('trading-footer'); if (!footer) return;
  footer.innerHTML = `
    <div class="footer-title">Pause</div>
    <div class="pause-controls">
      <label>
        <input type="checkbox" id="pause-enabled" ${pauseEnabled ? 'checked' : ''}>
        Enabled
      </label>
      <label>
        after <input type="number" id="pause-losses" min="1" max="10" value="${pauseAfterLosses}"> losses
      </label>
      <label>
        for <input type="number" id="pause-minutes" min="1" max="240" value="${pauseMinutes}"> min
      </label>
      <button id="pause-resume-btn">Reset</button>
    </div>
  `;

  const enabledEl = document.getElementById('pause-enabled');
  const lossesEl = document.getElementById('pause-losses');
  const minutesEl = document.getElementById('pause-minutes');
  const resetBtn = document.getElementById('pause-resume-btn');

  if (enabledEl){
    enabledEl.addEventListener('change', e=>{ pauseEnabled = e.target.checked; if (!pauseEnabled) clearPause(); });
  }
  if (lossesEl){
    lossesEl.addEventListener('change', e=>{
      pauseAfterLosses = Math.max(1, parseInt(e.target.value || '3', 10));
      e.target.value = pauseAfterLosses;
    });
  }
  if (minutesEl){
    minutesEl.addEventListener('change', e=>{
      pauseMinutes = Math.max(1, parseInt(e.target.value || '15', 10));
      e.target.value = pauseMinutes;
    });
  }
  if (resetBtn){
    resetBtn.addEventListener('click', ()=>{ clearPause(); });
  }
}

function createIndicatorPanels(){
  const container = document.getElementById('indicators-container'); if (!container) return;
  const pricePanel = document.createElement('div');
  pricePanel.id='price-indicators'; pricePanel.className='indicator-panel';
  pricePanel.innerHTML = `
    <div class="indicator-row"><span class="indicator-label">EMA:</span><span id="ema-value" class="indicator-value">N/A</span></div>
    <div class="indicator-row"><span class="indicator-label">MACD:</span><span id="macd-value" class="indicator-value">N/A</span></div>
  `;
  const momentumPanel = document.createElement('div');
  momentumPanel.id='momentum-trend'; momentumPanel.className='indicator-panel';
  momentumPanel.innerHTML = `
    <div class="indicator-row"><span class="indicator-label">ROC:</span><span id="roc-value" class="indicator-value">N/A</span></div>
    <div class="indicator-row"><span class="indicator-label">SAR:</span><span id="sar-value" class="indicator-value">N/A</span></div>
  `;
  const patternPanel = document.createElement('div');
  patternPanel.id='pattern-analysis'; patternPanel.className='indicator-panel';
  patternPanel.innerHTML = `
    <div class="indicator-row"><span class="indicator-label">Pattern:</span><span id="pattern-value" class="indicator-value">neutral</span></div>
  `;
  const candlePanel = document.createElement('div');
  candlePanel.id='candle-data'; candlePanel.className='indicator-panel';
  candlePanel.innerHTML = `
    <div class="indicator-row"><span class="indicator-label">Candles:</span><span id="candle-count" class="indicator-value">0 (1m)</span></div>
    <div class="indicator-row"><span class="indicator-label">Next Candle:</span><span id="next-candle" class="indicator-value">60s</span></div>
  `;
  container.appendChild(pricePanel); container.appendChild(momentumPanel);
  container.appendChild(patternPanel); container.appendChild(candlePanel);
}
function updateIndicatorDisplay(insufficient, ind){
  if (insufficient){
    document.getElementById('ema-value').innerHTML='N/A';
    document.getElementById('macd-value').innerHTML='N/A';
    document.getElementById('roc-value').innerHTML='N/A';
    document.getElementById('sar-value').innerHTML='N/A';
    document.getElementById('pattern-value').innerHTML='Waiting for data...';
    document.getElementById('candle-count').innerHTML='0 (1m)';
    return;
  }
  const { shortEMA, longEMA, emaDifference, macdData, rocValue, parabolicSAR, priceAction, currentTime } = ind;
  const emaEl=document.getElementById('ema-value');
  emaEl.innerHTML = `${shortEMA.toFixed(5)} / ${longEMA.toFixed(5)}`;
  emaEl.style.color = emaDifference>0?greenColor:(emaDifference<0?redColor:'#fff');

  const macdEl=document.getElementById('macd-value');
  macdEl.innerHTML = macdData.histogram.toFixed(5);
  macdEl.style.color = macdData.histogram>0?greenColor:(macdData.histogram<0?redColor:'#fff');

  const rocEl=document.getElementById('roc-value');
  rocEl.innerHTML = rocValue.toFixed(4)+'%';
  rocEl.style.color = rocValue>0?greenColor:(rocValue<0?redColor:'#fff');

  const sarEl=document.getElementById('sar-value');
  sarEl.innerHTML = parabolicSAR.isUpTrend?'UP':'DOWN';
  sarEl.style.color = parabolicSAR.isUpTrend?greenColor:redColor;

  const patEl=document.getElementById('pattern-value');
  patEl.innerHTML = priceAction.pattern;
  patEl.style.color = priceAction.pattern.includes('bullish')?greenColor:(priceAction.pattern.includes('bearish')?redColor:'#fff');

  document.getElementById('candle-count').innerHTML = `${candlesM1.length} (1m)`;
  const left = candleInterval - (currentTime - lastCandleTime);
  document.getElementById('next-candle').innerHTML = `${Math.round(left/1000)}s`;
}

/* ====== Draggable root + Trading Panels ====== */
function enableDrag(el, handle){
  let isDown=false, startX=0,startY=0, startLeft=0,startTop=0;
  const dragTarget = handle||el; dragTarget.style.cursor='move';
  function onMouseDown(e){
    isDown=true; el.style.bottom='';
    const r=el.getBoundingClientRect(); startLeft=r.left; startTop=r.top; startX=e.clientX; startY=e.clientY;
    document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp); e.preventDefault();
  }
  function onMouseMove(e){
    if (!isDown) return; const dx=e.clientX-startX, dy=e.clientY-startY;
    el.style.left=Math.max(0,startLeft+dx)+'px'; el.style.top=Math.max(0,startTop+dy)+'px'; el.style.right='';
  }
  function onMouseUp(){ isDown=false; document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); }
  dragTarget.addEventListener('mousedown', onMouseDown);
}

function addUI(){
  const TRADING_WIDTH_PX = 320; // ← измените тут, если нужна другая фиксированная ширина

  const newDiv = document.createElement("div");
  newDiv.classList.add('bot-root');
  newDiv.style.position = "fixed";
  newDiv.style.left = "20px";
  newDiv.style.bottom = "20px";
  newDiv.style.width = "auto";
  newDiv.style.maxWidth = "95vw";
  newDiv.style.maxHeight = "85vh";
  newDiv.style.background = "rgba(0,0,0,0.85)";
  newDiv.style.padding = "8px";
  newDiv.style.borderRadius = "10px";
  newDiv.style.boxShadow = "0 8px 24px rgba(0,0,0,0.5)";
  newDiv.style.fontFamily = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
  newDiv.style.color = "#ddd";
  newDiv.style.display = "flex";
  newDiv.style.flexDirection = "column";
  newDiv.style.gap = "6px";
  newDiv.style.alignItems = "stretch";
  newDiv.style.zIndex = "100500";

  const dragHandle = document.createElement('div');
  dragHandle.style.position = 'absolute';
  dragHandle.style.top = '-8px';
  dragHandle.style.left = '10px';
  dragHandle.style.width = '120px';
  dragHandle.style.height = '8px';
  dragHandle.style.borderRadius = '999px';
  dragHandle.style.background = 'rgba(255,255,255,0.25)';
  dragHandle.title = 'Перетащить панель';
  dragHandle.style.cursor = 'move';
  newDiv.style.paddingTop = '18px';
  newDiv.appendChild(dragHandle);

  const style = document.createElement('style');
  style.textContent = `
    .bot-root{
      display:flex;
      flex-direction:column;
      gap:6px;
      align-items:stretch;
    }
    .bot-main-row{
      display:flex;
      align-items:stretch;
      gap:6px;
      width:100%;
    }
    .right-col{
      display:flex;
      flex-direction:column;
      gap:6px;
      flex:1;
      min-width:400px;
    }
    .cards-row{
      display:flex;
      gap:6px;
      align-items:stretch;
      width:100%;
      flex-wrap:nowrap;
    }
    .cycles-strip{
      background:#0f0f10;
      border-radius:6px;
      padding:6px;
      margin-top:6px;
      display:flex;
      flex-direction:column;
    }
    .cycles-title{
      font-size:12px;
      opacity:0.7;
      text-transform:uppercase;
      margin-bottom:4px;
    }
    .cycles-history{
      height:48px;
      display:flex;
      gap:2px;
      overflow-x:auto;
      overflow-y:hidden;
      align-items:center;
    }
    .panel-footer{
      background-color:#0f0f10;
      border-radius:6px;
      padding:6px;
      font-size:11px;
      color:#dcdcdc;
      display:flex;
      flex-direction:column;
      gap:4px;
      margin-top:auto;
    }
    .panel-footer .footer-title{
      font-weight:600;
      color:#bdbdbd;
      font-size:11px;
      text-transform:uppercase;
      letter-spacing:0.04em;
    }
    .pause-controls{
      display:flex;
      gap:8px;
      align-items:center;
      flex-wrap:wrap;
      font-size:11px;
    }
    .pause-controls label{
      display:flex;
      align-items:center;
      gap:4px;
      white-space:nowrap;
    }
    .pause-controls input[type="number"]{
      width:52px;
      padding:2px 4px;
      font-size:11px;
    }
    .pause-controls button{
      padding:2px 6px;
      font-size:11px;
    }
    /* Карточки панелей */
    .bot-trading-panel{
      display:flex;
      flex-direction:column;
      background-color:#0b0b0c;
      border-radius:6px;
      padding:6px;
      min-width:200px;
      max-height:70vh;
      overflow:auto;
      color:#fff;
    }
    .panel-header{
      font-size:13px;font-weight:bold;color:#bdbdbd;
      margin-bottom:2px;border-bottom:1px solid #2a2a2a;padding-bottom:2px;
      display:flex;justify-content:space-between;align-items:center;gap:6px;
    }
    .panel-header .version{font-size:11px;color:#7a7a7a;font-weight:normal;}
    .cloud-badge{
      padding:2px 6px;
      border-radius:4px;
      background:#9e9e9e;
      color:#000;
      font-size:11px;
      font-weight:600;
      text-transform:uppercase;
      letter-spacing:0.04em;
    }

    /* Сетка и строки в Trading */
    .info-grid{
      display:grid;
      grid-template-columns:auto 1fr; /* компактная метка + эластичное значение */
      gap:2px 6px;
      min-width:0;
    }
    .info-item{
      display:flex;
      justify-content:space-between;
      padding:0;
      border-bottom:1px dotted #2a2a2a;
      font-size:12px;
      min-width:0; /* важно для усечения текста */
      gap:6px;
    }
    .info-label{color:#9aa0a6; white-space:nowrap;}
    .info-value{
      font-weight:500;color:#fff;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      min-width:0; /* разрешает сжиматься внутри flex/grid */
    }

    /* Нижние строки (Signal/Direction) на всю ширину — тоже с усечением */
    .info-item.full-width{
      display:flex;justify-content:space-between;gap:8px;
      border-top:1px solid #2a2a2a;border-bottom:none;margin-top:4px;padding-top:4px;
      font-size:12px;
      min-width:0;
    }
    .info-item.full-width .info-value{
      display:block;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
      min-width:0;
    }

    /* История циклов */
    .cycles-history{
      height:48px;
      display:flex;
      flex-wrap:nowrap;
      gap:2px;
      overflow-x:auto;
      overflow-y:hidden;
      font-size:11px;
      align-items:stretch;
    }
    .cycle-chip{
      display:flex;
      flex-direction:column;
      justify-content:center;
      align-items:center;
      padding:2px 4px;
      border-radius:4px;
      min-width:48px;
      flex:0 0 auto;
      font-size:11px;
      line-height:1.1;
    }
    .cycle-chip .max-cycle{
      font-size:9px;
      opacity:0.75;
    }

    /* Индикаторы */
    .indicator-panel{background-color:#0f0f10;border-radius:4px;padding:2px;margin-bottom:2px;}
    .indicator-row{display:flex;justify-content:space-between;font-size:11px;margin-bottom:0;}
    .indicator-row .indicator-value{
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;
    }

    /* Кнопки и инпуты */
    .bot-trading-panel button{
      background:#121214;color:#fff;border:1px solid #2e2e2e;border-radius:4px;
      padding:2px 6px;font-size:11px;cursor:pointer;
    }
    .bot-trading-panel button:hover{ background:#1a1a1d; border-color:#3a3a3a; }
    .bot-trading-panel input[type="number"],
    .bot-trading-panel input[type="text"]{
      background:#0e0e10;color:#fff;border:1px solid #2a2a2a;border-radius:4px;padding:2px 4px;outline:none;
      min-width:0;
    }
    .bot-trading-panel input[type="checkbox"]{ accent-color:#fff;background:#0e0e10;border:1px solid #2a2a2a; }
    label{ color:#e5e5e5; }

    /* Слайдеры */
    .bot-trading-panel input[type="range"]{
      accent-color:#fff;background:#111;border-radius:2px;width:110px;height:3px;cursor:pointer;
    }

    .armed-indicator{
      font-size:11px;
      padding:4px 6px;
      border-radius:4px;
      background:#2a2a2a;
      color:#f0f0f0;
      display:flex;
      justify-content:space-between;
      gap:6px;
      align-items:center;
      line-height:1.2;
      min-width:0;
    }
    .armed-indicator span{ min-width:0; }

    /* Управляющие кнопки графика */
    #tf-m1,#tf-m5,#live-btn{ padding:2px 6px; margin-right:4px; font-size:11px; }

    /* ВАЖНО: фиксируем ширину Trading и запрещаем рост/сжатие */
    .fixed-trading{
      flex: 0 0 ${TRADING_WIDTH_PX}px !important;
      width: ${TRADING_WIDTH_PX}px !important;
      max-width: ${TRADING_WIDTH_PX}px !important;
      min-width: ${TRADING_WIDTH_PX}px !important;
      overflow:hidden; /* на всякий случай — внутри и так усечение */
    }
  `;
  document.head.appendChild(style);

  const contentRow = document.createElement('div');
  contentRow.className = 'bot-main-row';

  /* Trading */
  const tradingPanel = document.createElement('div');
  tradingPanel.className = 'bot-trading-panel fixed-trading';
  tradingPanel.innerHTML = `
    <div class="panel-header">
      <span>Trading</span><span class="version">${appversion}</span><span id="time" class="info-value">0:00</span>
    </div>

    <div class="info-grid">
      <div class="info-item full-width"><span class="info-label">Trading Symbol:</span><span class="info-value" id="trading-symbol">${symbolName}</span></div>
      <div class="info-item"><span class="info-label">Start Balance:</span><span class="info-value">${startBalance}</span></div>
      <div class="info-item"><span class="info-label">Start Time:</span><span class="info-value">${startTime}</span></div>
      <div class="info-item"><span class="info-label">Mode:</span><span class="info-value">${mode}</span></div>
      <div class="info-item"><span class="info-label">Reverse:</span><span class="info-value">${reverse}</span></div>
      <div class="info-item"><span class="info-label">Cycle Profit:</span><span class="info-value" id="profit">$0</span></div>
      <div class="info-item"><span class="info-label">Win Rate:</span><span class="info-value" id="won-percent">0%</span></div>
      <div class="info-item"><span class="info-label">Current Wager:</span><span class="info-value" id="wager">$0</span></div>
      <div class="info-item"><span class="info-label">Profit %:</span><span class="info-value" id="profit-percent">0%</span></div>
      <div class="info-item"><span class="info-label">Max Step:</span><span class="info-value" id="max-step">0</span></div>
      <div class="info-item"><span class="info-label">Total Profit:</span><span class="info-value" id="total-profit">$0</span></div>
      <div class="info-item"><span class="info-label">Loss streak:</span><span class="info-value" id="loss-streak">0</span></div>
      <div class="info-item"><span class="info-label">Pause until:</span><span class="info-value" id="pause-until">—</span></div>
    </div>

    <div class="info-item full-width"><span class="info-label">Signal:</span><span class="info-value" id="signal">none</span></div>
    <div class="info-item full-width"><span class="info-label">Direction:</span><span class="info-value" id="trade-dir">flat</span></div>
    <div class="panel-footer trading-footer" id="trading-footer"></div>
  `;

  const tradingFooter = tradingPanel.querySelector('#trading-footer');
  const armedBox = document.createElement('div');
  armedBox.className = 'armed-indicator';
  armedBox.innerHTML = '<span id="armed-status-label">ARMED</span><span id="armed-status-value">IDLE</span>';
  if (tradingFooter){ tradingFooter.appendChild(armedBox); }
  armedIndicatorDiv = armedBox;
  try{ updateArmedIndicator(safeBlind.getState()); }catch(e){}

  /* Top Signals */
  const topPanel = document.createElement('div');
  topPanel.className = 'bot-trading-panel';
  topPanel.style.flex = "1";
  topPanel.innerHTML = `
    <div class="panel-header"><span>Top Signals</span></div>
    <div id="signal-top" style="font-size:12px;line-height:1.25;"></div>
  `;

  /* Signals Accuracy */
  const accPanel = document.createElement('div');
  accPanel.className = 'bot-trading-panel';
  accPanel.style.flex = "0.7";
  accPanel.innerHTML = `
    <div class="panel-header"><span>Signals Accuracy</span></div>
    <div id="signal-accuracy" style="font-size:12px;line-height:1.25;"></div>
  `;

  /* Cloud Signals */
  const cloudPanel = document.createElement('div');
  cloudPanel.className = 'bot-trading-panel';
  cloudPanel.style.flex = "1";
  cloudPanel.innerHTML = `
    <div class="panel-header"><span>Cloud Signals</span><span id="cloud-status-badge" class="cloud-badge">Cloud: COLD</span></div>
    <div style="font-size:12px;line-height:1.25;display:flex;flex-direction:column;gap:4px;">
      <div style="display:flex;justify-content:space-between;gap:6px;">
        <span id="cloud-lambda">λ=0.00</span>
        <span id="cloud-updated">Age: —</span>
      </div>
      <div id="cloud-trades">Trades: 0</div>
      <div id="cloud-top" style="display:flex;flex-direction:column;gap:2px;"></div>
    </div>
  `;

  /* Technical */
  const techPanel = document.createElement('div');
  techPanel.className = 'bot-trading-panel';
  techPanel.style.flex = "1.7";
  techPanel.innerHTML = `
    <div class="panel-header"><span>Technical</span></div>
    <div id="indicators-container"></div>
    <div id="sensitivity-control"></div>
  `;

  /* Candle Chart + Cycles */
  const chartContainer = document.createElement('div');
  chartContainer.className = 'bot-trading-panel';
  chartContainer.style.minWidth = '400px';
  chartContainer.innerHTML = `
    <div class="panel-header"><span>Candle Chart</span></div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;margin-bottom:4px;">
      <div><button id="tf-m1">M1</button><button id="tf-m5">M5</button></div>
      <div>Zoom: <input type="range" id="zoom-slider" min="20" max="240" value="60"></div>
      <div>Scroll: <input type="range" id="scroll-slider" min="0" max="0" value="0"></div>
      <button id="live-btn">Live</button>
    </div>
    <div style="background:#0c0c0d;border-radius:4px;"><canvas id="chart-canvas" width="400" height="130"></canvas></div>
  `;

  /* Сборка */
  const rightCol = document.createElement('div');
  rightCol.className = 'right-col';

  const cardsRow = document.createElement('div');
  cardsRow.className = 'cards-row';
  cardsRow.appendChild(topPanel);
  cardsRow.appendChild(accPanel);
  cardsRow.appendChild(cloudPanel);
  cardsRow.appendChild(techPanel);
  cardsRow.appendChild(chartContainer);

  const cyclesStrip = document.createElement('div');
  cyclesStrip.className = 'cycles-strip';
  cyclesStrip.innerHTML = `
    <div class="cycles-title">Cycles History</div>
    <div class="cycles-history" id="cycles-history"></div>
  `;

  rightCol.appendChild(cardsRow);
  rightCol.appendChild(cyclesStrip);

  contentRow.appendChild(tradingPanel);
  contentRow.appendChild(rightCol);
  newDiv.appendChild(contentRow);

  document.body.appendChild(newDiv);
  enableDrag(newDiv, dragHandle);

  // DOM refs
  profitDiv = document.getElementById("profit");
  profitPercentDivAdvisor = document.getElementById("profit-percent");
  signalDiv = document.getElementById("signal");
  tradingSymbolDiv = document.getElementById("trading-symbol");
  tradeDirectionDiv = document.getElementById("trade-dir");
  timeDiv = document.getElementById("time");
  wonDiv = document.getElementById("won-percent");
  wagerDiv = document.getElementById("wager");
  maxStepDiv = document.getElementById("max-step");
  totalProfitDiv = document.getElementById("total-profit");
  cyclesHistoryDiv = document.getElementById("cycles-history");
  lossStreakDiv = document.getElementById("loss-streak");
  pauseUntilDiv  = document.getElementById("pause-until");
  chartCanvas = document.getElementById('chart-canvas');

  updateCloudUi();

  // controls
  document.getElementById('tf-m1').addEventListener('click', ()=>{ currentTF='M1'; renderChart(); });
  document.getElementById('tf-m5').addEventListener('click', ()=>{ currentTF='M5'; renderChart(); });
  document.getElementById('zoom-slider').addEventListener('input', e=>{ zoom=parseInt(e.target.value); liveMode=false; renderChart(); });
  document.getElementById('scroll-slider').addEventListener('input', e=>{ scrollPos=parseInt(e.target.value); liveMode=false; renderChart(); });
  document.getElementById('live-btn').addEventListener('click', ()=>{ liveMode=true; scrollPos=0; document.getElementById('scroll-slider').value=0; renderChart(); });

  // компактные контролы и индикаторные панели
  addSensitivityControl();
  renderPauseFooter();
  createIndicatorPanels();

  // авто-обновление списков (Top/Accuracy) — без изменений
  setInterval(()=>{
    const shortSig = (name) => name
      .replace(/oversold/g,'os').replace(/overbought/g,'ob')
      .replace(/bullish/g,'bull').replace(/bearish/g,'bear')
      .replace(/support/g,'sup').replace(/resistance/g,'res');
    try{
      const accBox = document.getElementById('signal-accuracy');
      if (accBox){
        const items = Object.entries(signalAccuracy)
          .sort((a,b)=> (b[1].total||0) - (a[1].total||0))
          .slice(0,12)
          .map(([name,val])=>{
            const total = val.total||0, hits=val.hits||0;
            const acc = total ? (hits/total*100) : 0;
            const color = acc>60?'#00e676':(acc<40?'#ff5252':'#ffeb3b');
            return `<div style="display:flex;justify-content:space-between;gap:6px;min-width:0;">
              <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">${shortSig(name)}</span>
              <span style="color:${color};white-space:nowrap;">${acc.toFixed(1)}% (${hits}/${total})</span>
            </div>`;
          }).join('');
        accBox.innerHTML = items || '<div>Недостаточно данных</div>';
      }
      const topBox = document.getElementById('signal-top');
      if (topBox){
        const rows = Object.entries(signalAccuracy).map(([name,val])=>{
          const total = val.total||0, hits=val.hits||0;
          const acc = total ? (hits/total) : 0;
          const w = signalWeights[name]||2;
          return {name,acc,w,total,hits};
        }).filter(x=>x.total>=5)
          .sort((a,b)=> (b.acc - a.acc) || (b.w - a.w))
          .slice(0,8)
          .map((x,i)=>`<div style="display:flex;justify-content:space-between;gap:6px;min-width:0;">
            <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">${i+1}. ${shortSig(x.name)}</span>
            <span style="white-space:nowrap;">Acc: ${(x.acc*100).toFixed(1)}% • ${x.hits}/${x.total} • W:${x.w.toFixed(2)}</span>
          </div>`).join('');
        topBox.innerHTML = rows || '<div>Недостаточно данных</div>';
      }
    }catch(e){}
  }, 5000);
}


/* ===================== BEGIN: RESULT HANDLER (MG STEP FIX) ===================== */
/**
 * recordTradeResult — нормализует статус, корректно двигает шаг МГ,
 * поддерживает автопаузу и обновляет базовые UI/логи.
 * ВАЖНО: имя функции сохранено — замещает старую реализацию.
 * @param {string} rawStatus - "WON" | "LOST" | "RETURN" | "CANCEL" | ...
 * @param {number} pnl       - P/L по сделке
 * @param {object} meta      - доп. поля (betAtOpen, betValue, betDirection и т.д.)
 */
function recordTradeResult(rawStatus, pnl = 0, meta = {}) {
  try {
    const st = String(rawStatus || '').trim().toLowerCase(); // "won"|"lost"|...
    // ensure locals exist (use existing variables from IIFE scope)
    if (typeof currentBetStep !== 'number' || currentBetStep < 0) currentBetStep = 0;
    if (typeof consecutiveLosses !== 'number' || consecutiveLosses < 0) consecutiveLosses = 0;
    if (typeof tradingAllowed === 'undefined') tradingAllowed = true;

    // UI refs are taken from existing variables if present
    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = String(txt); };
    const fmtMoney = (v) => { try { return (Number(v).toFixed(2)); } catch(e){ return String(v); } };

    const prevStep = currentBetStep;
    let linkedTrade = null;
    try{
      if (Array.isArray(betHistory) && betHistory.length){
        const candidate = betHistory[betHistory.length - 1];
        if (candidate && candidate.tsOpen){ linkedTrade = candidate; }
      }
    }catch(_){ }

    // === лог результата для наглядности ===
    try {
      const last = {
        won: (st==='won' ? 'won' : (st==='lost' ? 'lost' : (st==='return' || st==='returned' || st==='draw' ? 'returned' : st))),
        profit: pnl,
        step: prevStep,
        betValue: meta && meta.betValue !== undefined ? meta.betValue : (meta && meta.betAtOpen !== undefined ? meta.betAtOpen : 0),
        betDirection: meta && meta.betDirection ? meta.betDirection : (window && window.lastTradeDirection || 'flat')
      };
      logTradeResult && logTradeResult(last);
      // фиксируем в истории (нормализовано к нижнему регистру)
      if (Array.isArray(betHistory) && !linkedTrade) {
        betHistory.push(last);
      }
    } catch(e) {}

    // === логика шага МГ ===
    if (st === 'won') {
      currentBetStep = 0;
      consecutiveLosses = 0;
    } else if (st === 'lost') {
      const maxIdx = (Array.isArray(betArray) ? betArray.length : 1) - 1;
      currentBetStep = Math.min(prevStep + 1, Math.max(0, maxIdx));
      consecutiveLosses += 1;

      // авто-пауза после N подряд проигрышей
      const N = Number.isFinite(pauseAfterLosses) ? pauseAfterLosses : 3;
      const M = Number.isFinite(pauseMinutes) ? pauseMinutes : 5;
      if (N > 0 && consecutiveLosses >= N) {
        // schedulePause defined earlier in file
        if (typeof schedulePause === 'function') schedulePause(M);
        consecutiveLosses = 0; // начать новую серию
      }
    } else {
      // return/cancel/draw — шаг не меняем
    }

    // === обновление UI (если элементы существуют) ===
    setText('loss-streak', consecutiveLosses);
    setText('mg-step', currentBetStep);
    setText('bet-step', currentBetStep);

    // контрольный лог
    console.log(
      '%c[MG]%c result=%s prevStep=%d → nextStep=%d',
      'color:#ffcc66;font-weight:600', 'color:inherit',
      st, prevStep, currentBetStep
    );
    try{
      console.log(`[RESULT] ${st} step:${prevStep}→${currentBetStep}  profit:${fmtMoney(pnl)}`);
    }catch(_){ }

    // уведомление для внутренних подписчиков
    try {
      window.dispatchEvent(new CustomEvent('mg-updated', {
        detail: { status: st, prevStep, nextStep: currentBetStep, lossStreak: consecutiveLosses }
      }));
    } catch(e){}

    if (linkedTrade){
      linkedTrade.won = st === 'won' ? 'won' : (st === 'lost' ? 'lost' : st);
      linkedTrade.profit = pnl;
      linkedTrade.tsClose = Date.now();
      linkedTrade.result = linkedTrade.won;
    }

    if (enableCloud && botState.cloud.enabled){
      const resultKey = st === 'won' ? 'win' : (st === 'lost' ? 'loss' : (st === 'returned' || st === 'return' ? 'return' : st));
      const tradeRecord = {
        tsOpen: (linkedTrade && linkedTrade.tsOpen) || meta.tsOpen || Date.now(),
        tsClose: meta.tsClose || Date.now(),
        asset: (linkedTrade && linkedTrade.asset) || meta.asset || symbolName,
        timeframe: (linkedTrade && linkedTrade.timeframe) || meta.timeframe || currentTF,
        signalKey: (linkedTrade && linkedTrade.signalKeys && linkedTrade.signalKeys[0]) || meta.signalKey || ((Array.isArray(window.activeSignalsThisTrade) && window.activeSignalsThisTrade[0]) || 'unknown'),
        entryDir: (linkedTrade && linkedTrade.betDirection) || meta.betDirection || (meta.direction || 'flat'),
        step: (linkedTrade && typeof linkedTrade.step === 'number') ? linkedTrade.step : prevStep,
        bet: (meta.betValue != null ? meta.betValue : ((linkedTrade && linkedTrade.betValue) || 0)),
        payout: meta.payout != null ? meta.payout : ((linkedTrade && linkedTrade.payout) || null),
        result: resultKey,
        pnl: pnl,
        priceEntry: (linkedTrade && linkedTrade.openPrice) || meta.priceEntry || null,
        priceExit: meta.priceExit != null ? meta.priceExit : null,
        botVersion: appversion,
        schema: 's1',
        lambda: botState.cloud.lambda,
        cloudMode: botState.cloud.mode,
        ewmaLive: botState.cloud.ewmaLive,
        ewmaCloud: botState.cloud.perf && botState.cloud.perf.ewma != null ? botState.cloud.perf.ewma : null
      };
      if (linkedTrade && Array.isArray(linkedTrade.signalKeys)) tradeRecord.signalKeys = linkedTrade.signalKeys.slice(0, 10);
      tradeRecord.asset = normalizeAssetName(tradeRecord.asset || symbolName);
      if (!tradeRecord.asset) tradeRecord.asset = 'UNKNOWN';
      tradeRecord.timeframe = normalizeTimeframeName(tradeRecord.timeframe || currentTF);
      tradeRecord.signalKey = String(tradeRecord.signalKey || 'unknown').trim() || 'unknown';
      var derivedDir = tradeRecord.entryDir;
      if (!derivedDir && tradeRecord.bet >= 0){ derivedDir = linkedTrade && linkedTrade.betDirection; }
      tradeRecord.entryDir = cloudDirectionLabel(derivedDir);
      tradeRecord.step = Number.isFinite(tradeRecord.step) ? tradeRecord.step : 0;
      var betVal = Number(tradeRecord.bet);
      tradeRecord.bet = isFinite(betVal) ? Math.abs(betVal) : 0;
      var pnlVal = Number(tradeRecord.pnl);
      tradeRecord.pnl = isFinite(pnlVal) ? pnlVal : 0;
      if (tradeRecord.payout != null){
        var payoutRaw = tradeRecord.payout;
        if (typeof payoutRaw === 'string'){ payoutRaw = payoutRaw.replace(/[^0-9.\-]/g, ''); }
        var payoutVal = Number(payoutRaw);
        if (!isFinite(payoutVal)) payoutVal = null;
        else if (payoutVal > 1.5) payoutVal = payoutVal / 100;
        tradeRecord.payout = payoutVal;
      } else {
        tradeRecord.payout = null;
      }
      if (tradeRecord.priceEntry != null){
        var pe = Number(tradeRecord.priceEntry);
        tradeRecord.priceEntry = isFinite(pe) ? pe : null;
      }
      if (tradeRecord.priceExit != null){
        var px = Number(tradeRecord.priceExit);
        tradeRecord.priceExit = isFinite(px) ? px : null;
      }
      tradeRecord.result = resultKey === 'win' ? 'WIN' : (resultKey === 'loss' ? 'LOSS' : 'DRAW');
      tradeRecord.tsOpen = toIsoStringSafe(tradeRecord.tsOpen);
      tradeRecord.tsClose = toIsoStringSafe(tradeRecord.tsClose);

      try{ recordCloudLiveResult(st === 'lost' ? 'lost' : (st === 'won' ? 'won' : 'returned')); }catch(_){ }

      if (!cloudReadOnly && CloudStats && typeof CloudStats.updateAfterTrade === 'function'){
        CloudStats.updateAfterTrade(tradeRecord).catch(function(err){
          console.warn('[CLOUD ERROR] updateAfterTrade failed', err && err.message ? err.message : err);
        });
      }
    }
    try{ if (PreArmingController && typeof PreArmingController.onResult === 'function'){ PreArmingController.onResult(); } }catch(_){ }
  } catch (err) {
    console.error('[recordTradeResult:MG-FIX] error:', err);
  }
}
/* ====================== END: RESULT HANDLER (MG STEP FIX) ====================== */

/* ====== Price poll + Trade logic ====== */
function queryPrice(){
  time = Date.now();
  if (timeDiv) timeDiv.innerHTML = humanTime(time);

  // --- refresh pause countdown on UI ---
  if (isPaused()){
    if (pauseUntilDiv) pauseUntilDiv.textContent = humanTime(pauseUntil);
    tradeDirectionDiv.style.background = '#777';
    const left = Math.ceil(msLeft()/1000);
    tradeDirectionDiv.innerHTML = `PAUSED (${left}s)`;
  } else if (pauseUntil>0 && !isPaused()){
    clearPause();
  }

  const text = targetElement2.innerHTML;
  const match = text.match(/\d+.\d+(?=\ a)/g);
  if (match && match[0]){
    globalPrice = parseFloat(match[0]);
    if (globalPrice !== priceHistory[priceHistory.length-1]){
      priceHistory.push(globalPrice);
      if (priceHistory.length>500) priceHistory.shift();
      updateMinMax();
      updateCandles(time, globalPrice);
    }
    calculateIndicators();
  }

  var newSymbolName = symbolDiv.textContent.replace("/", " ");
  if (symbolName !== newSymbolName){
    symbolName = newSymbolName;
    if (tradingSymbolDiv) tradingSymbolDiv.innerHTML = symbolName;
    try{ if (PreArmingController && typeof PreArmingController.cancelPreArm === 'function'){ PreArmingController.cancelPreArm('symbol_change'); } }catch(_){ }
    try{ prepareArmedForStep(currentBetStep, 'symbol-change'); }catch(e){}
  }

  priceString = balanceDiv.innerHTML.replace(/,/g,'');
  currentBalance = parseFloat(priceString);
  currentProfit = Math.round((currentBalance - startBalance)*100)/100;

  if (profitDiv) {
    profitDiv.innerHTML = currentProfit;
    profitDiv.style.background = currentProfit<0 ? redColor : (currentProfit>0 ? greenColor : 'inherit');
  }

  if (time - lastSignalCheck >= signalCheckInterval){
    lastSignalCheck = time;
    if (time - lastTradeTime >= minTimeBetweenTrades){
      tradeLogic();
    }
  }
}

function getBetValue(step){
  for (let i=0;i<betArray.length;i++) if (step===betArray[i].step) return betArray[i].value;
  return 1;
}

function getPressCount(step){
  for (let i=0;i<betArray.length;i++) if (step===betArray[i].step) return betArray[i].pressCount;
  return 0;
}

function prepareBetSize(step, direction, reason){
  try{
    prepareArmedForStep(step, reason || ('prearm-' + (direction || 'na')));
    return true;
  }catch(e){
    console.warn('[PREP][ERROR]', e && e.message ? e.message : String(e));
    return false;
  }
}

function executeBet(direction){
  const blindState = safeBlind.getState();
  const amount = blindState && typeof blindState.amount === 'number' ? blindState.amount : getBetValue(currentBetStep);
  const code = direction === 'sell' ? 'S' : 'W';
  console.log(`[EXEC] ${code} size=$${isFinite(amount) ? amount.toFixed(2) : '—'}`);
  safeBlind.click(direction);
  return { amount };
}

function prepareArmedForStep(step, reason){
  const target = getBetValue(step);
  const pressCount = getPressCount(step);
  const cycleIndex = cyclesStats.length + 1;
  let summary = '[BET][NEXT] calc=$' + target.toFixed(2) + ' | step=' + step + ' | array=' + activeBetArrayName + ' | cycle=' + cycleIndex;
  if (reason){ summary += ' | reason=' + reason; }
  console.log(summary);
  let started = false;
  try{
    if (step === 0){
      started = safeBlind.prepareStep0(pressCount, { amount: target });
    } else {
      started = safeBlind.prepare(step, pressCount, { amount: target });
    }
  }catch(e){
    console.warn('[BET][PREP_FAIL]', e && e.message ? e.message : String(e));
  }
  if (!started){
    setTimeout(function(){ prepareArmedForStep(step, reason ? reason + '-retry' : 'retry'); }, 600);
  }
}

function smartBet(step, direction, onDone){
  if (typeof onDone !== 'function') onDone = function(){};

  const currentProfitPercent = parseInt(percentProfitDiv.innerHTML);
  profitPercentDivAdvisor.innerHTML = currentProfitPercent;

  if (currentProfitPercent < 90){
    profitPercentDivAdvisor.style.background = redColor;
    profitPercentDivAdvisor.style.color = "#fff";
    profitPercentDivAdvisor.innerHTML = 'win % is low! ABORT!!! => ' + currentProfitPercent;
    onDone(false, { reason: 'low-profit-percent' });
    return false;
  }

  const blindState = safeBlind.getState();
  if (!blindState || blindState.status !== 'ARMED'){
    const status = blindState && blindState.status ? blindState.status : 'unknown';
    console.warn('[ABORT] reason=blind-status', status);
    onDone(false, { reason: 'blind-'+status.toLowerCase() });
    return false;
  }
  if (typeof blindState.step === 'number' && blindState.step !== step){
    console.warn('[ABORT] reason=step-mismatch', blindState.step, step);
    onDone(false, { reason: 'step-mismatch' });
    try{ prepareArmedForStep(step, 'step-mismatch'); }catch(e){}
    return false;
  }

  const targetValue = getBetValue(step);

  profitPercentDivAdvisor.style.background = 'inherit';
  profitPercentDivAdvisor.style.color = '#fff';
  try{
    const execMeta = executeBet(direction);
    onDone(true, { amount: targetValue, direction: direction, execMeta });
    return true;
  }catch(e){
    console.warn('[ABORT] reason=blind-click', e && e.message ? e.message : e);
    onDone(false, { reason: 'blind-click-error', error: e });
    return false;
  }
}

function resetCycle(winStatus){
  if (profitDiv) profitDiv.style.background='inherit';
  maxStepInCycle=0; currentBetStep=0;
  if (cyclesToPlay>0){
    cyclesStats.push(currentProfit); startBalance=currentBalance; cyclesToPlay--;
    let totalProfit = cyclesStats.reduce((s,p)=>s+p,0); totalProfit = Math.round(totalProfit*100)/100;
    totalProfitDiv.innerHTML = totalProfit;
    totalProfitDiv.style.background = totalProfit<0?redColor:(totalProfit>0?greenColor:'inherit');
  }
  try{ prepareArmedForStep(currentBetStep, 'cycle-reset'); }catch(e){}
}

const PreArmingController = (function(){
  const STATES = {
    IDLE: 'IDLE',
    PREPARE_SIZE: 'PREPARE_SIZE',
    ARMED: 'ARMED',
    WAIT_SIGNAL: 'WAIT_SIGNAL',
    EXECUTE: 'EXECUTE',
    RESULT: 'RESULT',
    CANCEL: 'CANCEL'
  };

  let stage = STATES.IDLE;
  let ctx;
  let schedulerTimer = null;
  const tasks = [];
  let lastCancelReason = null;

  function now(){ return Date.now(); }

  function resetContext(){
    ctx = {
      step: null,
      pressCount: 0,
      amount: 0,
      direction: 'flat',
      allow: false,
      payout: NaN,
      EV: null,
      sys: 'NONE',
      diff: null,
      thr: null,
      t0: 0,
      startedAt: 0,
      candidateTs: 0,
      candidateLogged: false,
      gateLogged: false,
      onExecute: null,
      payload: null
    };
  }

  resetContext();

  function setStage(next){ stage = next; }

  function clearScheduler(){
    tasks.length = 0;
    if (schedulerTimer){
      clearTimeout(schedulerTimer);
      schedulerTimer = null;
    }
  }

  function pump(){
    if (schedulerTimer) return;
    const runner = function(){
      schedulerTimer = null;
      const ts = now();
      while (tasks.length && tasks[0].at <= ts){
        const task = tasks.shift();
        try{ task.fn(); }catch(err){ console.warn('[PreArm] task error', task.tag, err); }
      }
      if (tasks.length){
        const delay = Math.max(10, tasks[0].at - now());
        schedulerTimer = setTimeout(runner, delay);
      }
    };
    runner();
  }

  function schedule(tag, at, fn){
    const ts = Math.max(now(), at);
    tasks.push({ tag, at: ts, fn });
    tasks.sort((a,b)=>a.at - b.at);
    pump();
  }

  function computeT0(){
    try{
      const chs = window.__CHS;
      if (chs && chs.lastM1CloseTs){
        const predicted = chs.lastM1CloseTs + 60000;
        if (predicted > now()) return predicted;
      }
    }catch(_){ }
    return now() + 3000;
  }

  function formatNum(val){
    if (val == null) return '—';
    if (typeof val === 'number' && isFinite(val)){
      if (Math.abs(val) >= 100) return val.toFixed(0);
      if (Math.abs(val) >= 10) return val.toFixed(1);
      return val.toFixed(2);
    }
    return String(val);
  }

  function rebindDom(){
    let ok = true;
    try{
      const tooltipList = document.getElementsByClassName('tooltip-text') || [];
      const text = 'Winnings amount you receive';
      let rebound = null;
      for (let i=0;i<tooltipList.length;i++){
        const el = tooltipList[i];
        const txt = (el.textContent || el.innerText || '');
        if (txt && txt.indexOf(text) !== -1){ rebound = el; break; }
      }
      if (rebound){ targetElement2 = rebound; } else { ok = false; }
    }catch(e){ ok = false; }
    try{
      const canvas = document.getElementById('chart-canvas');
      if (canvas){ chartCanvas = canvas; } else { ok = false; }
    }catch(e){ ok = false; }
    try{ if (typeof updateTradingSymbolUI === 'function') updateTradingSymbolUI(); }catch(_){ }
    try{ if (typeof updateWarmupUI === 'function') updateWarmupUI(); }catch(_){ }
    return ok && !!targetElement2 && !!chartCanvas;
  }

  function healthCheck(meta){
    const snapshot = meta || ctx;
    const ts = now();
    if (isTradeOpen){ return { ok:false, reason:'trade-open' }; }
    if (typeof isPaused === 'function' && isPaused()){ return { ok:false, reason:'paused' }; }
    if (ts - lastTradeTime < minTimeBetweenTrades){ return { ok:false, reason:'min-delay' }; }
    if (snapshot && snapshot.allow === false){ return { ok:false, reason:'allow' }; }
    let payout = snapshot && snapshot.payout;
    if (!isFinite(payout)){
      try{ payout = getPayoutPercent(); }catch(_){ }
    }
    if (!isFinite(payout)){ return { ok:false, reason:'payout-na' }; }
    if (payout < CFG.minPayoutToTrade){ return { ok:false, reason:'payout-low', payout }; }
    const autoState = (window.__autoSwitch && window.__autoSwitch.state) || {};
    if (autoState.switchInProgress){ return { ok:false, reason:'switching' }; }
    if (!autoState.warmupReady){ return { ok:false, reason:'warmup' }; }
    if (ts < (autoState.cooldownUntil || 0)){ return { ok:false, reason:'cooldown' }; }
    if (typeof isReady === 'function'){
      try{ if (!isReady()){ return { ok:false, reason:'chs-warmup' }; } }catch(_){ }
    }
    if (!targetElement2){ return { ok:false, reason:'dom-price' }; }
    if (!balanceDiv){ return { ok:false, reason:'dom-balance' }; }
    if (!chartCanvas){ return { ok:false, reason:'dom-chart' }; }
    return { ok:true, payout, allow: snapshot ? snapshot.allow : undefined, EV: snapshot ? snapshot.EV : undefined, sys: snapshot ? snapshot.sys : undefined };
  }

  function cancel(reason){
    const stageName = stage;
    clearScheduler();
    resetContext();
    lastCancelReason = reason || null;
    setStage(STATES.CANCEL);
    if (reason){ console.warn(`[CANCEL] reason=${reason} stage=${stageName}`); }
  }

  function runPrepare(){
    setStage(STATES.PREPARE_SIZE);
    const gate = healthCheck();
    if (!gate.ok && CFG.preArming.prepareAbortOnGateFail){
      cancel(gate.reason || 'gate');
      return;
    }
    prepareBetSize(ctx.step, ctx.direction, 'prearm');
  }

  function runRebind(){
    if (!rebindDom()){
      cancel('rebind');
      return;
    }
    const gate = healthCheck();
    if (!gate.ok){
      cancel(gate.reason || 'gate');
    }
  }

  function runCandidate(){
    setStage(STATES.ARMED);
    ctx.candidateTs = now();
    if (!ctx.direction || ctx.direction === 'flat'){
      cancel('no-direction');
      return;
    }
    if (!ctx.candidateLogged){
      console.log(`[ARMED] dir=${ctx.direction} diff=${formatNum(ctx.diff)} thr=${formatNum(ctx.thr)}`);
      ctx.candidateLogged = true;
    }
  }

  function runGate(){
    setStage(STATES.WAIT_SIGNAL);
    const gate = healthCheck();
    if (!gate.ok){
      cancel(gate.reason || 'gate');
      return;
    }
    if (!ctx.gateLogged){
      const payout = isFinite(gate.payout) ? gate.payout.toFixed(1) + '%' : 'unknown';
      const ev = ctx.EV != null && isFinite(ctx.EV) ? ctx.EV.toFixed(4) : 'unknown';
      const allow = gate.allow === undefined ? (ctx.allow ? 'true' : 'false') : String(gate.allow);
      const sys = gate.sys || ctx.sys || 'NONE';
      console.log(`[GATE] payout=${payout} EV=${ev} allow=${allow} (sys=${sys})`);
      ctx.gateLogged = true;
    }
    if (typeof shouldTradeNow === 'function'){
      try{ if (!shouldTradeNow()){ cancel('minute-limit'); } }catch(_){ }
    }
  }

  function runHealth(){
    const gate = healthCheck();
    if (!gate.ok){
      cancel(gate.reason || 'health');
      return;
    }
    if (typeof shouldTradeNow === 'function'){
      try{ if (!shouldTradeNow()){ cancel('minute-limit'); } }catch(_){ }
    }
  }

  function runExecute(){
    const gate = healthCheck();
    if (!gate.ok){
      cancel(gate.reason || 'execute');
      return;
    }
    if (typeof shouldTradeNow === 'function'){
      try{ if (!shouldTradeNow()){ cancel('minute-limit'); return; } }catch(_){ }
    }
    if (typeof ctx.onExecute !== 'function'){
      cancel('no-executor');
      return;
    }
    setStage(STATES.EXECUTE);
    try{
      ctx.onExecute();
      if (typeof markTradeDecision === 'function'){
        try{ markTradeDecision(); }catch(_){ }
      }
    }catch(err){
      console.warn('[PreArm][EXEC] error', err);
      cancel('exec-error');
    }
  }

  function startPreArm(step){
    resetContext();
    ctx.step = step;
    ctx.pressCount = getPressCount(step);
    ctx.amount = getBetValue(step);
    ctx.startedAt = now();
    ctx.t0 = computeT0();
    lastCancelReason = null;
    setStage(STATES.PREPARE_SIZE);
    console.log(`[PREP] step=${step} pressCount=${ctx.pressCount}`);
    schedule('prepare', ctx.t0 - CFG.preArming.t_prepare_ms, runPrepare);
    schedule('rebind', ctx.t0 - CFG.preArming.t_rebind_ms, runRebind);
    schedule('candidate', ctx.t0 - CFG.preArming.t_candidate_ms, runCandidate);
    schedule('gate', ctx.t0 - CFG.preArming.t_gate_ms, runGate);
    schedule('health', ctx.t0 - CFG.preArming.t_health_ms, runHealth);
    schedule('execute', ctx.t0, runExecute);
    return true;
  }

  function ensure(meta){
    if (!CFG.preArmingEnabled){
      if (stage !== STATES.IDLE){ cancel('prearm-disabled'); }
      return false;
    }
    if (!meta){ return false; }
    ctx.direction = meta.direction || ctx.direction;
    ctx.allow = !!meta.allow;
    ctx.payout = meta.payout != null ? meta.payout : ctx.payout;
    ctx.EV = meta.EV != null ? meta.EV : ctx.EV;
    ctx.sys = meta.sys || ctx.sys;
    ctx.diff = meta.diff != null ? meta.diff : ctx.diff;
    ctx.thr = meta.thr != null ? meta.thr : ctx.thr;
    ctx.onExecute = meta.onExecute || ctx.onExecute;
    ctx.payload = meta.payload || ctx.payload;

    if (stage === STATES.IDLE || stage === STATES.CANCEL){
      if (ctx.direction === 'flat' || !ctx.allow){ return false; }
      return startPreArm(meta.step);
    }

    if (meta.step != null && ctx.step != null && meta.step !== ctx.step){
      cancel('step-change');
      if (ctx.direction !== 'flat' && ctx.allow){
        return startPreArm(meta.step);
      }
      return false;
    }

    if (ctx.direction === 'flat' || !ctx.allow){
      cancel(ctx.direction === 'flat' ? 'direction-flat' : 'allow-false');
      return false;
    }

    return true;
  }

  function execOrder(dir){
    if (dir && dir !== ctx.direction){ ctx.direction = dir; }
    runExecute();
  }

  function cancelPreArm(reason){ cancel(reason || 'manual'); }

  function onResult(){
    setStage(STATES.RESULT);
    clearScheduler();
    resetContext();
    lastCancelReason = null;
    setStage(STATES.IDLE);
  }

  function state(){ return stage; }

  function stats(){
    const base = { state: stage };
    if (ctx){
      base.step = ctx.step;
      base.direction = ctx.direction;
      base.allow = ctx.allow;
      base.payout = ctx.payout;
      base.EV = ctx.EV;
      base.t0 = ctx.t0;
    }
    if (lastCancelReason){ base.lastCancelReason = lastCancelReason; }
    return base;
  }

  const api = {
    consider: ensure,
    startPreArm,
    cancelPreArm,
    execOrder,
    healthCheck,
    rebindDom,
    onResult,
    state,
    stats
  };

  try{
    window.__preArm = Object.assign(window.__preArm || {}, api);
  }catch(_){ }

  return api;
})();

let pendingTradeMeta = null;

function buildTradeSnapshot(meta){
  const direction = meta && meta.direction ? meta.direction : 'flat';
  const step = meta && typeof meta.step === 'number' ? meta.step : currentBetStep;
  const signals = Array.isArray(window.activeSignalsSnapshot) ? window.activeSignalsSnapshot.slice(0) : [];
  const trade = {
    time: (meta && meta.hTime) ? meta.hTime : humanTime(time),
    betTime: betTimeDiv.textContent,
    openPrice: globalPrice,
    step,
    betValue: getBetValue(step),
    betDirection: direction,
    shortEMA: window.currentShortEMA,
    longEMA: window.currentLongEMA,
    emaDiff: (((window.currentShortEMA)!=null ? (window.currentShortEMA) : (0))) - (((window.currentLongEMA)!=null ? (window.currentLongEMA) : (0))),
    rsi: window.currentRSI,
    bullishScore: meta && meta.bullishScore != null ? meta.bullishScore : (window.bullishScore || 0),
    bearishScore: meta && meta.bearishScore != null ? meta.bearishScore : (window.bearishScore || 0),
    scoreDiff: meta && meta.diff != null ? meta.diff : Math.abs((window.bullishScore||0) - (window.bearishScore||0)),
    threshold: meta && meta.thr != null ? meta.thr : (11 - signalSensitivity),
    signalKeys: signals,
    tsOpen: Date.now(),
    asset: symbolName,
    timeframe: currentTF,
    cloudMode: botState.cloud.mode,
    cloudLambda: botState.cloud.lambda,
    cloudSignals: signals.slice(0)
  };
  try{ trade.payout = typeof getPayoutPercent === 'function' ? getPayoutPercent() : undefined; }catch(_){ }
  return trade;
}

function executePlannedTrade(meta){
  if (!meta) return false;
  if (cyclesToPlay <= 0) return false;
  if (!autoTradingEnabled) return false;
  if (meta.direction === 'flat') return false;
  if (isTradeOpen) return false;
  if (enteringTrade) return false;

  const tradeCard = buildTradeSnapshot(meta);
  const step = meta.step != null ? meta.step : currentBetStep;
  const direction = meta.direction;

  enteringTrade = true;
  smartBet(step, direction, function(placed, info){
    enteringTrade = false;
    if (!placed){
      try{ if (PreArmingController && typeof PreArmingController.cancelPreArm === 'function'){ PreArmingController.cancelPreArm('exec-abort'); } }catch(_){ }
      return;
    }
    isTradeOpen = true;
    lastTradeTime = time;
    window.lastTradeDirection = direction;
    if (info && info.execMeta && info.execMeta.amount != null){
      try{ tradeCard.betValue = info.execMeta.amount; }catch(_){ }
    }
    if (enableCloud){ cloudRecordTradeOpen(); }
    if (typeof logTradeOpen === 'function') logTradeOpen(tradeCard);
    betHistory.push(tradeCard);
    totalWager += tradeCard.betValue;
    wagerDiv.innerHTML = totalWager;
    maxStepInCycle = Math.max(maxStepInCycle, tradeCard.step);
    maxStepDiv.innerHTML = maxStepInCycle;
    window.activeSignalsThisTrade = tradeCard.signalKeys.slice(0);
    pendingTradeMeta = null;
  });
  return true;
}

function tradeLogic(){
  let tradeDirection;
  let hTime = humanTime(time);

  // предыдущий шаг/результат
  let prevBetStep = 0, lastStatus = 'won';
  if (betHistory.length > 0){
    prevBetStep = betHistory[betHistory.length - 1].step;
    if (betHistory[betHistory.length - 1].won) lastStatus = betHistory[betHistory.length - 1].won;
  }

  // шаг МГ
  if (lastStatus === 'won') currentBetStep = 0;
  else if (lastStatus === 'lost') currentBetStep = Math.min(prevBetStep + 1, betArray.length - 1);
  else currentBetStep = prevBetStep;
  if (typeof MG_WARMUP_TRADES === "number" && betHistory.length < MG_WARMUP_TRADES) { currentBetStep = 0; }
  currentBetStep = cloudGuardStep(currentBetStep);

  // оценки/сигнал
  const bullishScore = window.bullishScore || 0;
  const bearishScore = window.bearishScore || 0;
  const scoreDifference = Math.abs(bullishScore - bearishScore);
  const adjustedThreshold = 11 - signalSensitivity;

  if (bullishScore > bearishScore && scoreDifference >= adjustedThreshold){
    tradeDirection = !reverse ? 'buy' : 'sell';
    tradeDirectionDiv.style.background = greenColor;
  } else if (bearishScore > bullishScore && scoreDifference >= adjustedThreshold){
    tradeDirection = !reverse ? 'sell' : 'buy';
    tradeDirectionDiv.style.background = redColor;
  } else {
    tradeDirection = 'flat';
    tradeDirectionDiv.style.background = '#555555';
  }
  tradeDirectionDiv.innerHTML = `${tradeDirection} (${scoreDifference}/${adjustedThreshold})`;

  // === Cloud influence ===
  if (enableCloud && botState.cloud.enabled && botState.cloud.perf){
    const lambda = botState.cloud.lambda;
    const perf = botState.cloud.perf;
    const active = Array.isArray(window.activeSignalsSnapshot) ? window.activeSignalsSnapshot : [];
    let cloudBias = 0;
    let weightSum = 0;
    for (let i = 0; i < active.length; i++){
      const sig = active[i];
      const stats = perf.signals ? perf.signals[sig] : null;
      if (!stats) continue;
      if (!CloudStats.shouldTrade(sig, perf, botState.cloud.policy)) continue;
      const bias = signalBias(sig);
      if (!bias) continue;
      const score = estimateCloudScore(stats);
      cloudBias += bias * score;
      weightSum += Math.abs(score);
    }
    const cloudValue = weightSum ? (cloudBias / weightSum) : 0;
    const localValue = directionValue(tradeDirection);
    const combinedValue = (1 - lambda) * localValue + lambda * cloudValue;
    let finalDirection = valueToDirection(combinedValue, tradeDirection);
    if (finalDirection === 'flat' && botState.cloud.mode === 'HOT' && Math.abs(cloudValue) > 0.1){
      if (Math.random() < CLOUD_EXPLORE_RATE && !shouldThrottleByTraining()){
        finalDirection = cloudValue >= 0 ? 'buy' : 'sell';
      }
    }
    tradeDirection = finalDirection;
    tradeDirectionDiv.innerHTML = `${tradeDirection} (${scoreDifference}/${adjustedThreshold}) λ=${lambda.toFixed(2)}`;
  }

  if (shouldThrottleByTraining()){
    tradeDirection = 'flat';
    tradeDirectionDiv.style.background = '#555555';
    tradeDirectionDiv.innerHTML = `TRAINING (${botState.cloud.mode})`;
  }
  let gateAllow = false;
  let gateSys = 'NONE';
  let gatePayout = NaN;
  let gateEV = null;
/* [PORTFOLIO GATE v2 SAFE] — trend/mean-reversion switch + EV gate + one-per-minute aggregation */
(function(){
  try{
    const act = Array.isArray(window.activeSignalsSnapshot) ? window.activeSignalsSnapshot : [];
    const trendKeys = act.filter(s => /^(ema_|macd_|ao_|psar_|trend_|mtf_)/.test(s));
    const mrKeys    = act.filter(s => /^(bb_(lower|upper)_touch|rsi_|stoch_|pa_|sr_)/.test(s));

    // Determine system
    let sys = 'NONE';
    if (trendKeys.length > mrKeys.length) sys = 'T';
    else if (mrKeys.length > trendKeys.length) sys = 'M';

    // Stricter allow
    let allow = false;
    if (sys === 'T') allow = (trendKeys.length >= 2 && mrKeys.length === 0);
    else if (sys === 'M') allow = (mrKeys.length >= 2 && trendKeys.length === 0);

    // Quality estimate
    let p_est = null;
    try{
      if (typeof signalAccuracy !== 'undefined'){
        const keys = (sys==='T' ? trendKeys : (sys==='M' ? mrKeys : act));
        const stats = keys.map(k => signalAccuracy[k]).filter(Boolean);
        if (stats.length){
          const wrs = stats.map(s => ((s.hits||0)+1)/((s.total||0)+2));
          p_est = wrs.reduce((a,b)=>a+b,0) / wrs.length;
        }
      }
    }catch(_){}

    let payout = NaN;
    try{ payout = (typeof getPayoutPercent==='function') ? getPayoutPercent() : NaN; }catch(_){}
    const r = isFinite(payout) ? payout/100 : null;
    const EV = (p_est!=null && r!=null) ? (p_est*r - (1-p_est)) : null;

    if (EV != null && EV < 0){ allow = false; }

    gateAllow = allow;
    gateSys = sys;
    gatePayout = payout;
    gateEV = EV;

    if (!allow){
      tradeDirection = 'flat';
      try{
        if (tradeDirectionDiv){
          tradeDirectionDiv.style.background = '#555555';
          tradeDirectionDiv.innerHTML = tradeDirection + " (" + scoreDifference + "/" + adjustedThreshold + ")";
        }
      }catch(_){}
    }

    // Minute aggregator — single global state
    const PX = window.__verterPX || (window.__verterPX = {
      bucket:new Map(), sum:new Map(), lastMin:-1,
      addOpen:function(){ const m=this.curMin(); const S=this.getSum(m); S.opens=(S.opens||0)+1; },
      addResult:function(won){ const m=this.curMin(); const S=this.getSum(m); if(won===true) S.wins=(S.wins||0)+1; else if(won===false) S.losses=(S.losses||0)+1; },
      curMin:function(){ return (typeof time!=='undefined') ? Math.floor(time/60000) : Math.floor(Date.now()/60000); },
      getSum:function(m){ let S=this.sum.get(m); if(!S){ S={}; this.sum.set(m,S); } return S; }
    });

    function pxKey(sys, allow){
      const m = PX.curMin();
      return m + "|" + sys + "|" + (allow ? "A" : "S");
    }
    function num(x){
      if (x==null) return NaN;
      if (typeof x==='number') return x;
      const s = String(x).replace('%','');
      const v = parseFloat(s);
      return isFinite(v) ? v : NaN;
    }
    function pxPush(type, payload){
      const k = pxKey(sys, allow);
      const it = PX.bucket.get(k) || {count:0, last:{}};
      it.count++; it.last = Object.assign({}, it.last, (function(o){ o[type]=payload; return o; })({}));
      PX.bucket.set(k, it);

      const m = PX.curMin();
      const S = PX.getSum(m);
      S.decisions = (S.decisions||0) + (type==='P' ? 1 : 0);
      S.allow = (S.allow||0) + (allow? (type==='P'?1:0) : 0);
      if (type==='P'){
        if (sys==='T') S.sysT = (S.sysT||0) + 1; else if (sys==='M') S.sysM = (S.sysM||0) + 1; else S.sysN = (S.sysN||0) + 1;
        S.diffSum = (S.diffSum||0) + (Number.isFinite(scoreDifference)?scoreDifference:0);
        S.thrSum  = (S.thrSum||0) + (Number.isFinite(adjustedThreshold)?adjustedThreshold:0);
        S.diffCnt = (S.diffCnt||0) + 1;
      }else if (type==='E'){
        const evn = num(payload.EV);
        const pay = num(payload.payout);
        const pest= num(payload.p_est);
        if (isFinite(evn)){ S.evSum=(S.evSum||0)+evn; S.evCnt=(S.evCnt||0)+1; S.evMin = Math.min((S.evMin==null? evn:S.evMin), evn); S.evMax = Math.max((S.evMax==null? evn:S.evMax), evn); }
        if (isFinite(pay)){ S.paySum=(S.paySum||0)+pay; S.payCnt=(S.payCnt||0)+1; }
        if (isFinite(pest)){ S.pSum=(S.pSum||0)+pest; S.pCnt=(S.pCnt||0)+1; }
      }
    }

    // push current
    pxPush('P', {sys:sys, trend:trendKeys.length, mr:mrKeys.length, dir:tradeDirection,
                 diff:scoreDifference, thr:adjustedThreshold, allow:allow});
    pxPush('E', {payout: isFinite(payout)?(payout+'%'):'unknown',
                 p_est:(p_est!=null? (p_est*100).toFixed(1)+'%':'unknown'),
                 EV:(EV!=null?EV.toFixed(4):'unknown'), decision: allow?'allow':'skip'});

    // flush only when minute changes
    const curMin = PX.curMin();
    if (PX.lastMin !== curMin){
      PX.lastMin = curMin;
      const rows = [];
      const pref = (curMin-1) + "|";
      for (const kv of PX.bucket.entries()){
        const k = kv[0], v = kv[1];
        if (k.indexOf(pref) !== 0) continue;
        const parts = k.split('|');
        const last = v.last;
        rows.push({
          minute: parts[0], sys: parts[1], allow: (parts[2]==='A'),
          count: v.count,
          dir: (last.P?last.P.dir:undefined), diff: (last.P?last.P.diff:undefined), thr: (last.P?last.P.thr:undefined),
          payout: (last.E?last.E.payout:undefined), p_est: (last.E?last.E.p_est:undefined), EV: (last.E?last.E.EV:undefined),
          decision: (last.E?last.E.decision:undefined)
        });
      }
      const S = PX.sum.get(curMin-1) || {};
      const allowRate = (S.decisions? (S.allow||0)/S.decisions : NaN);
      const avgEV  = (S.evCnt? S.evSum/S.evCnt : NaN);
      const avgPay = (S.payCnt? S.paySum/S.payCnt : NaN);
      const avgP   = (S.pCnt? S.pSum/S.pCnt : NaN);
      const avgDiff= (S.diffCnt? S.diffSum/S.diffCnt : NaN);
      const avgThr = (S.diffCnt? S.thrSum/S.diffCnt : NaN);
      const wr     = ((S.wins||0)+(S.losses||0) > 0) ? (S.wins||0)/((S.wins||0)+(S.losses||0)) : NaN;

      var hdr = "[PX Σ] min=" + (curMin-1)
        + " decisions=" + (S.decisions||0)
        + " allow=" + (isFinite(allowRate)? (allowRate*100).toFixed(1)+'%':'—')
        + " sysT/M/N=" + (S.sysT||0) + "/" + (S.sysM||0) + "/" + (S.sysN||0)
        + " opens=" + (S.opens||0)
        + " wins/losses=" + (S.wins||0) + "/" + (S.losses||0)
        + " wr=" + (isFinite(wr)? (wr*100).toFixed(1)+'%':'—')
        + " avgEV=" + (isFinite(avgEV)? avgEV.toFixed(4):'—')
        + " avgPay=" + (isFinite(avgPay)? avgPay.toFixed(1)+'%':'—')
        + " avgP=" + (isFinite(avgP)? avgP.toFixed(1)+'%':'—')
        + " diff/thr≈" + (isFinite(avgDiff)? avgDiff.toFixed(1):'—') + "/" + (isFinite(avgThr)? avgThr.toFixed(1):'—');

      console.groupCollapsed(hdr);
      try{ console.table(rows); }catch(_){ console.log('[PX Σ rows]', rows); }
      console.groupEnd();

      // cleanup
      const keepPref = curMin + "|";
      for (const k of Array.from(PX.bucket.keys())){ if (k.indexOf(keepPref)!==0) PX.bucket.delete(k); }
      for (const m of Array.from(PX.sum.keys())){ if (m < curMin) PX.sum.delete(m); }
    }

    // hook opens/results once (idempotent with retry)
    (function bindPXHooks(){
      if (window.__verterPX_hooksBound) return;
      let tries = 0;
      const t = setInterval(function(){
        tries++;
        try{
          if (!window.__verterPX_openHook && typeof window.logTradeOpen === 'function'){
            const __o = window.logTradeOpen;
            window.logTradeOpen = function(){ try{ PX.addOpen(); }catch(_){ } return __o.apply(this, arguments); };
            window.__verterPX_openHook = true;
          }
          if (!window.__verterPX_resHook && typeof window.recordTradeResult === 'function'){
            const __r = window.recordTradeResult;
            window.recordTradeResult = function(res){ try{ PX.addResult(res && res.won===true); }catch(_){ } return __r.apply(this, arguments); };
            window.__verterPX_resHook = true;
          }
        }catch(_){}
        if ((window.__verterPX_openHook && window.__verterPX_resHook) || tries > 120){
          window.__verterPX_hooksBound = true;
          clearInterval(t);
        }
      }, 1000);
    })();

  }catch(e){ console.warn('[PORTFOLIO] gate error', e); }
})();


  // ─────────────────────────────────────────
  // ПРОВЕРКА ПАУЗЫ
  // ─────────────────────────────────────────
  if (typeof isPaused === 'function' && isPaused()){
    const left = Math.ceil(msLeft()/1000);
    tradeDirectionDiv.style.background = '#777';
    tradeDirectionDiv.innerHTML = `PAUSED (${left}s)`;
    if (pauseUntilDiv) pauseUntilDiv.textContent = humanTime(pauseUntil);
    return;
  }

  // лимиты/профили (как было у тебя)
  if (currentProfit > limitWin){
    limitWin = limitWin1;
    limitLoss = limitLoss1;
    betArray = betArray1;
    logActiveBetArray("betArray1");
    const chip = winCycle.cloneNode();
    chip.innerHTML = currentProfit + '<div class="max-cycle">' + maxStepInCycle + '</div>';
    cyclesHistoryDiv.appendChild(chip);
    resetCycle('win');
    return;
  } else if (currentProfit - getBetValue(currentBetStep) < limitLoss){
    if (limitWin === limitWin1){
      limitWin = limitWin2;
      limitLoss = limitLoss2;
      betArray = betArray2;
      logActiveBetArray("betArray2");
    }
    else if (limitWin === limitWin2){
      limitWin = limitWin3;
      limitLoss = limitLoss3;
      betArray = betArray3;
      logActiveBetArray("betArray3");
    }
    else {
      limitWin = limitWin1;
      limitLoss = limitLoss1;
      betArray = betArray1;
      logActiveBetArray("betArray1");
    }
    const chip = loseCycle.cloneNode();
    chip.innerHTML = currentProfit + '<div class="max-cycle">' + maxStepInCycle + '</div>';
    cyclesHistoryDiv.appendChild(chip);
    resetCycle('lose');
    return;
  }

  // ВХОД В СДЕЛКУ
  const autoReady = cyclesToPlay > 0 && autoTradingEnabled;
  const tradeMeta = {
    step: currentBetStep,
    direction: tradeDirection,
    allow: gateAllow,
    payout: gatePayout,
    EV: gateEV,
    sys: gateSys,
    diff: scoreDifference,
    thr: adjustedThreshold,
    bullishScore,
    bearishScore,
    hTime,
    betTime
  };
  pendingTradeMeta = tradeMeta;

  if (CFG.preArmingEnabled){
    const metaForPreArm = Object.assign({}, tradeMeta, {
      allow: gateAllow && autoReady,
      direction: autoReady ? tradeDirection : 'flat',
      onExecute: function(){ executePlannedTrade(pendingTradeMeta); }
    });
    try{ PreArmingController.consider(metaForPreArm); }catch(e){ }
  } else {
    if (autoReady && gateAllow && tradeDirection !== 'flat'){
      executePlannedTrade(tradeMeta);
    }
  }

  // обновление win%
  let winCounter = 0;
  for (let i = 0; i < betHistory.length; i++) if (betHistory[i].won === 'won') winCounter++;
  const winPercent = betHistory.length > 0 ? Math.round(winCounter / betHistory.length * 100 * 100) / 100 : 0;
  wonDiv.innerHTML = winPercent;
}
/* ====== Deals observer (results + pause trigger + NEW signal stats) ====== */
function _hasClass(el,cls){ if(!el) return false; if(el.classList) return el.classList.contains(cls); const c=' '+(el.className||'')+' '; return c.indexOf(' '+cls+' ')>-1; }
function _parseProfit(text){ const m=(text||'').replace(/[^\d.-]/g,''); const n=parseFloat(m); return isNaN(n)?0:n; }

let targetDiv = document.getElementsByClassName("scrollbar-container deals-list ps")[0] || document.querySelector(".scrollbar-container.deals-list.ps");

const observer = new MutationObserver(muts=>{
  muts.forEach(m=>{
    if (m.type!=='childList' || !m.addedNodes || m.addedNodes.length===0) return;
    const newDeal = m.addedNodes[0];
    try{
      const row=(newDeal && newDeal.childNodes && newDeal.childNodes[0]);
      const col=(row && row.children && row.children[0]);
      const right=(col && col.children && col.children[1]);
      const centerDiv=(right && right.children && right.children[1]);
      const lastDiv=(right && right.children && right.children[2]);

      const centerUp=_hasClass(centerDiv,'price-up');
      const lastUp=_hasClass(lastDiv,'price-up');

      let tradeStatus;
      if (centerUp && lastUp) tradeStatus='won';
      else if (centerUp && !lastUp) tradeStatus='returned';
      else tradeStatus='lost';

      const betProfit = _parseProfit((lastDiv && lastDiv.textContent));

      if (betHistory.length>0){
        const last = betHistory[betHistory.length-1];
        last.won=tradeStatus; last.profit=betProfit;
        logTradeResult(last);

        // NEW: обновление статистики по активным сигналам этой сделки
        try{
          const signals = Array.isArray(last.signalKeys) && last.signalKeys.length ? last.signalKeys
                         : (Array.isArray(window.activeSignalsThisTrade) ? window.activeSignalsThisTrade : []);
          if (signals && signals.length){
            signals.forEach(sig=>{
              if (!signalAccuracy[sig]) signalAccuracy[sig] = {hits:0,total:0};
              signalAccuracy[sig].total++;
              if (tradeStatus==='won') signalAccuracy[sig].hits++;
            });
          }
          // пересчёт весов на основе точности (формула как в QWEN-идеологии; clamp 0.5..4.0)
          Object.keys(signalAccuracy).forEach(sig=>{
            const {hits=0,total=0} = signalAccuracy[sig] || {};
            if (total>0){
              const accuracy = hits/total;                // 0..1
              const base = signalWeights[sig] || 2;       // базовый вес
              const newW = base * (1 + 1.5*(accuracy-0.5));
              signalWeights[sig] = Math.max(0.5, Math.min(4.0, newW));
            }
          });
          // для чистоты: сбрасываем фиксацию активных сигналов сделки
          window.activeSignalsThisTrade = null;

          // отладочный лог (не шумный)
          // console.log('[SignalStats] updated:', JSON.stringify({signalAccuracy, signalWeights}));
        }catch(e){ console.warn('[SignalStats] update failed:', e); }
      }

      // streak
      if (tradeStatus==='lost') consecutiveLosses++; else consecutiveLosses=0;
      if (lossStreakDiv) lossStreakDiv.textContent = String(consecutiveLosses);

      // auto pause
      if (pauseEnabled && consecutiveLosses >= pauseAfterLosses){
        schedulePause(pauseMinutes);
      }

      isTradeOpen=false;
      if (tradeStatus==='won') currentBetStep=0;
      else if (tradeStatus==='lost') currentBetStep=Math.min(currentBetStep+1, betArray.length-1);
      try{ prepareArmedForStep(currentBetStep, 'result-'+tradeStatus); }catch(e){}
      betTime = betTimeDiv.textContent;

    }catch(e){ console.warn('[DealsObserver] parse error:', e); }
  });
});
const config={attributes:false, childList:true, characterData:false};

function _attachDealsObserver(){
  if (!targetDiv){
    const t=setInterval(()=>{
      targetDiv = document.getElementsByClassName("scrollbar-container deals-list ps")[0] || document.querySelector(".scrollbar-container.deals-list.ps");
      if (targetDiv){ clearInterval(t); observer.observe(targetDiv, config); }
    },500);
    return;
  }
  observer.observe(targetDiv, config);
}


// expose rebind helper for external patch
try{
  window.__rebindDealsObserver = function(){
    try{ observer.disconnect(); }catch(e){}
    try{ targetDiv = null; }catch(e){}
    try{ _attachDealsObserver(); }catch(e){}
  };
}catch(e){ console.warn('[bridge] __rebindDealsObserver inject failed', e); }
/* ====== Bootstrap ====== */
addUI();
initChart();
setInterval(renderChart, 1000);
setInterval(queryPrice, 100);
_attachDealsObserver();
try{ prepareArmedForStep(currentBetStep, 'startup'); }catch(e){}
maybeInitCloud();

})();



// === [PATCH v2] Favorites Auto Switch + Context Hard Reset ===
(function(){
  if (window.__FAV_AUTOSWITCH_PATCH_V2__) return;
  window.__FAV_AUTOSWITCH_PATCH_V2__ = true;

  const AS_CFG = {
    minPayoutToTrade: 90,
    payoutDebounceChecks: 3,
    assetSwitchCooldownMs: 5000,
    dataWarmupTicks: 8,
    minuteBoundarySync: false, // do not wait :00 on switch
    autoSwitchEnabled: true
  };

  const ST = {
    belowCount: 0,
    switchInProgress: false,
    cooldownUntil: 0,
    warmupReady: true,
    lastSeenSymbol: null
  };

  try{
    window.__autoSwitch = Object.assign(window.__autoSwitch || {}, { state: ST, config: AS_CFG });
  }catch(_){ }

  function now(){ return Date.now(); }
  function getElByClassOne(cls){
    const list = document.getElementsByClassName(cls);
    return list && list[0] || null;
  }
  function readSymbolName(){
    const el = getElByClassOne("current-symbol") || getElByClassOne("asset-name");
    return el ? (el.textContent||'').replace('/',' ').trim() : null;
  }
  function updateTradingSymbolUI(){
    try{
      const name = readSymbolName();
      if (name){
        const el = document.getElementById('trading-symbol');
        if (el) el.textContent = name;
      }
    }catch(e){}
  }
  function getPayoutPercent(){
    let el = null;
    try{ el = (typeof percentProfitDiv!=='undefined' && percentProfitDiv) ? percentProfitDiv : null; }catch(e){}
    if (!el) el = getElByClassOne("value__val-start") || getElByClassOne("trade-profit");
    if (!el) return NaN;
    const txt = (el.textContent || el.innerText || "").replace(",", ".").trim();
    const m = txt.match(/(\d{1,3})(?:\.\d+)?\s*%/);
    if (m) return parseInt(m[1],10);
    const m2 = txt.match(/[+]?(\d{1,3})/);
    return m2 ? parseInt(m2[1],10) : NaN;
  }
  function emulateKey(key, opts={}){
    const evInit = {
      key, code: key==='Tab'?'Tab':'Key'+key.toUpperCase(),
      keyCode: key==='Tab'?9:key.toUpperCase().charCodeAt(0),
      which: key==='Tab'?9:key.toUpperCase().charCodeAt(0),
      bubbles: true, cancelable: true,
      altKey:!!opts.alt, ctrlKey:!!opts.ctrl, shiftKey:!!opts.shift, metaKey:!!opts.meta
    };
    document.dispatchEvent(new KeyboardEvent("keydown", evInit));
    document.dispatchEvent(new KeyboardEvent("keyup", evInit));
  }
  function shouldSwitchAsset(){
    if (!AS_CFG.autoSwitchEnabled) return false;
    const p = getPayoutPercent(); if (!isFinite(p)) return false;
    if (p < AS_CFG.minPayoutToTrade) ST.belowCount++; else ST.belowCount = 0;
    return ST.belowCount >= AS_CFG.payoutDebounceChecks;
  }
  function refreshDomRefs(){ updateTradingSymbolUI(); }
  function resetAssetContext(){
    try{
      if (typeof window.__hardResetChart === 'function') window.__hardResetChart();
      if (typeof window.__rebindDealsObserver === 'function') window.__rebindDealsObserver();
      console.log("🧹 [ASSET] Context reset (hard reset via bridge)");
    }catch(e){ console.warn('[PATCH] resetAssetContext failed', e); }
  }
  function waitForFreshTicks(done){
    const timeoutAt = now() + 30000; // 30s safety
    const baseLen = (window.priceHistory && window.priceHistory.length) || 0;
    (function loop(){
      const len = (window.priceHistory && window.priceHistory.length) || 0;
      const okTicks = (len - baseLen) >= AS_CFG.dataWarmupTicks;
      if (okTicks || now() > timeoutAt){
        done && done(); return;
      }
      setTimeout(loop, 250);
    })();
  }
  function switchToNextFavorite(){
    if (ST.switchInProgress) return;
    try{ if (PreArmingController && typeof PreArmingController.cancelPreArm === 'function'){ PreArmingController.cancelPreArm('asset_switch'); } }catch(_){ }
    ST.switchInProgress = true;
    ST.warmupReady = false;
    ST.cooldownUntil = now() + AS_CFG.assetSwitchCooldownMs;
    console.log("🟡 [ASSET] Low payout — requesting switch via Shift+Tab");
    emulateKey("Shift",{shift:true}); emulateKey("Tab",{shift:true});
    setTimeout(()=>{
      refreshDomRefs();
      resetAssetContext();
      waitForFreshTicks(()=>{
        ST.switchInProgress = false;
        ST.warmupReady = true;
        ST.belowCount = 0;
        try{ if (PreArmingController && typeof PreArmingController.rebindDom === 'function'){ PreArmingController.rebindDom(); } }catch(_){ }
        console.log("⏱️ [ASSET] Warmup ready");
      });
    }, 500);
  }

  // Gate tradeLogic during switching only if exposed
  try{
    if (typeof window.tradeLogic === "function"){
      const __orig = window.tradeLogic;
      window.tradeLogic = function(){
        if (ST.switchInProgress) return;
        if (now() < ST.cooldownUntil) return;
        if (!ST.warmupReady) return;
        return __orig.apply(this, arguments);
      };
    }
  }catch(e){}

  // Watchdog
  setInterval(()=>{
    const name = readSymbolName();
    if (name && name !== ST.lastSeenSymbol){ ST.lastSeenSymbol = name; updateTradingSymbolUI(); }
    if (ST.switchInProgress) return;
    if (now() < ST.cooldownUntil) return;
    if (shouldSwitchAsset()) switchToNextFavorite();
  }, 800);

  // Minimal UI
  try{
    const at = document.getElementById("auto-trading-toggle");
    if (at && !document.getElementById("auto-switch-toggle")){
      const wrap = document.createElement("span");
      wrap.style.marginLeft="8px"; wrap.style.display="inline-flex"; wrap.style.alignItems="center"; wrap.style.gap="6px";
      wrap.innerHTML = '<label style="font-size:12px;cursor:pointer;user-select:none;"><input id="auto-switch-toggle" type="checkbox" checked style="vertical-align:middle;margin-right:4px;">Auto-switch</label><button id="next-fav-btn" style="font-size:12px; padding:2px 6px; border-radius:6px; cursor:pointer;">Next favorite</button>';
      at.parentElement && at.parentElement.appendChild(wrap);
      const chk = document.getElementById("auto-switch-toggle");
      const btn = document.getElementById("next-fav-btn");
      chk.checked = true;
      chk.addEventListener("change", ()=>{});
      btn.addEventListener("click", ()=> switchToNextFavorite());
    }
  }catch(e){}

  console.log("✅ [PATCH v2] Favorites Auto Switch + Hard Reset loaded");
})();


// === CHS MODULE (Stages 2..6) ===
(function(){
  try{
    var CHS = (window.__CHS = window.__CHS || { m1: [], m5: [], lastM1CloseTs: 0, lastDecisionMinute: -1, lastM5Ts: null });
    function last(a){ return a && a.length ? a[a.length-1] : null; }
    function now(){ return Date.now(); }

    function isReady(){
      try{
        var n = CHS.m1.length;
        window.__warmup = window.__warmup || {ready:false, progress:{}};
        window.__warmup.ready = (n>=50);
        window.__warmup.progress = {
          EMA50: Math.min(n,50)+"/50", EMA25: Math.min(n,25)+"/25", EMA10: Math.min(n,10)+"/10", EMA5: Math.min(n,5)+"/5 ",
          RSI14: Math.min(n,14)+"/14", BB20: Math.min(n,20)+"/20", ATR14: Math.min(n,14)+"/14", MACD: Math.min(n,26)+"/26"
        };
        return window.__warmup.ready;
      }catch(e){ return true; }
    } window.isReady = isReady;
    function updateWarmupUI(){
      try{
        var el = document.getElementById('warmup-status'); var p = document.getElementById('verter-info-panel')||document.body;
        if(!el){ el=document.createElement('div'); el.id='warmup-status'; el.style.cssText='font:12px/1.3 monospace;opacity:.75;margin-top:4px'; p&&p.appendChild(el); }
        var P = window.__warmup.progress||{};
        el.textContent='[Warm-up] '+(window.__warmup.ready?'Ready':'Collecting')+' — EMA50 '+(P.EMA50||'?')+' · RSI14 '+(P.RSI14||'?')+' · BB20 '+(P.BB20||'?')+' · MACD '+(P.MACD||'?');
      }catch(_){}
    } window.updateWarmupUI = updateWarmupUI;

    function floor5min(ts){ var d=new Date(ts); d.setSeconds(0,0); var m=d.getMinutes(); d.setMinutes(m-(m%5)); return +d; }
    function onM1Close(c){
      try{
        if(!c) return;
        var t=c.time||c.t||now(), o=c.open||c.o||c.close, h=c.high||c.h||c.close, l=c.low||c.l||c.close, cl=c.close||c.c;
        CHS.m1.push({time:t,open:o,high:h,low:l,close:cl}); if(CHS.m1.length>240) CHS.m1.shift();
        CHS.lastM1CloseTs=t;
        if (CHS.m1.length>=5){
          var bin=floor5min(t);
          if (CHS.lastM5Ts!==bin){
            var pack=CHS.m1.slice(-5), O=pack[0].open, C=pack[4].close, H=-1e100, L=1e100;
            for(var i=0;i<5;i++){ if (pack[i].high>H) H=pack[i].high; if (pack[i].low<L) L=pack[i].low; }
            CHS.m5.push({time:bin,open:O,high:H,low:L,close:C}); if (CHS.m5.length>120) CHS.m5.shift(); CHS.lastM5Ts=bin;
            if(!QUIET_CONSOLE) try{ console.log('[M5-CLOSE]', new Date(bin).toLocaleTimeString(), {O:O,H:H,L:L,C:C}); }catch(_){}
          }
        }
        isReady(); updateWarmupUI();
      }catch(_){}
    } window.onM1Close=onM1Close;

    function ema(x,p){ var k=2/(p+1), e=null, out=[], i,j,s; for(i=0;i<x.length;i++){ if(e===null){ if(i+1>=p){ s=0; for(j=i+1-p;j<=i;j++) s+=x[j]; e=s/p; } else { out.push(null); continue; } } e=(x[i]-e)*k+e; out.push(e);} return out; }
    function getRegimeM5(){
      try{
        if (CHS.m5.length<50) return 'Unknown';
        var cls=[]; for (var i=0;i<CHS.m5.length;i++) cls.push(CHS.m5[i].close);
        var e5=ema(cls,5), e10=ema(cls,10), e25=ema(cls,25), e50=ema(cls,50);
        var L=function(a){return a[a.length-1];};
        if (L(e5)>L(e10) && L(e10)>L(e25) && L(e25)>L(e50)) return 'TrendUp';
        if (L(e5)<L(e10) && L(e10)<L(e25) && L(e25)<L(e50)) return 'TrendDown';
        return 'Mixed';
      }catch(_){ return 'Unknown'; }
    } window.getRegimeM5=getRegimeM5;

    function shouldTradeNow(){
      try{ var within=(Date.now()-(CHS.lastM1CloseTs||0))<=2500; if(!within) return false;
           var m=Math.floor((CHS.lastM1CloseTs||Date.now())/60000); if(m===CHS.lastDecisionMinute) return false; return true; }catch(_){ return true; } }
    function markTradeDecision(){ try{ CHS.lastDecisionMinute=Math.floor((CHS.lastM1CloseTs||Date.now())/60000); }catch(_){ } }
    window.shouldTradeNow=shouldTradeNow; window.markTradeDecision=markTradeDecision;

    function detectPatternsM1(){
      try{
        var n=CHS.m1.length; if(n<3) return []; var a=CHS.m1[n-3], b=CHS.m1[n-2], c=CHS.m1[n-1]; var out=[];
        var body=function(x){return Math.abs(x.close-x.open);} ;
        if (body(c)>body(b) && c.open<=b.close && c.close>=b.open) out.push('pattern_engulfing_bull');
        if (body(c)>body(b) && c.open>=b.close && c.close<=b.open) out.push('pattern_engulfing_bear');
        var H=c.high,L=c.low,O=c.open,C=c.close, up=H-Math.max(O,C), dn=Math.min(O,C)-L, bd=Math.abs(C-O)+1e-9;
        if (up>=2*bd) out.push('pattern_pinbar_bear'); if (dn>=2*bd) out.push('pattern_pinbar_bull');
        var inBar=(b.high<=a.high && b.low>=a.low); if(inBar && c.close>a.high) out.push('pattern_inside_breakout_bull'); if(inBar && c.close<a.low) out.push('pattern_inside_breakout_bear');
        return out;
      }catch(_){ return []; }
    } window.detectPatternsM1=detectPatternsM1;

    function preTradeCounsel(direction){
      try{
        var regime=getRegimeM5(), pats=detectPatternsM1(), allow=true, reason='ok';
        if (regime==='TrendUp' && direction==='sell'){ var bear=(pats.indexOf('pattern_engulfing_bear')>=0)||(pats.indexOf('pattern_pinbar_bear')>=0)||(pats.indexOf('pattern_inside_breakout_bear')>=0); if(!bear){ allow=false; reason='veto: TrendUp vs sell'; } }
        if (regime==='TrendDown' && direction==='buy'){ var bull=(pats.indexOf('pattern_engulfing_bull')>=0)||(pats.indexOf('pattern_pinbar_bull')>=0)||(pats.indexOf('pattern_inside_breakout_bull')>=0); if(!bull){ allow=false; reason='veto: TrendDown vs buy'; } }
        return {allow:allow, reason:reason, regime:regime, patterns:pats};
      }catch(e){ return {allow:true, reason:'err', regime:'Unknown', patterns:[]}; }
    } window.preTradeCounsel=preTradeCounsel;

    (function hookLogClose(){ try{ var o=window.logCandleClose; if(typeof o==='function'){ window.logCandleClose=function(c){ try{ onM1Close(c);}catch(_){ } return o.apply(this, arguments); }; } }catch(_){ } })();
    (function hookOrder(){ try{ var o=window.smartBet||window.placeOrder||window.openOrder; if(typeof o!=='function') return;
      function w(){ try{ if(!isReady()) return; if(!shouldTradeNow()) return;
        var dir=(typeof direction!=='undefined')? String(direction):(window.currentDirection||'flat'); var c=preTradeCounsel(dir);
        if(!c.allow){ if(!QUIET_CONSOLE) try{ console.warn('[VETO]', c.reason, c.regime, c.patterns); }catch(_){ } return; }
        markTradeDecision(); }catch(_){ } return o.apply(this, arguments); }
      if(window.smartBet) window.smartBet=w; else if(window.placeOrder) window.placeOrder=w; else if(window.openOrder) window.openOrder=w;
    }catch(_){ } })();
    (function hookResult(){ try{ var o=window.recordTradeResult; if(typeof o!=='function') return;
      window.recordTradeResult=function(result, price, time){ var r=o.apply(this, arguments); try{ if(String(result).toLowerCase().indexOf('loss')>=0 && window.state && window.state.mg){ var mg=window.state.mg;
        if(typeof mg.step!=='number'||mg.step<0) mg.step=0; var max=(mg.betArray&&mg.betArray.length)?(mg.betArray.length-1):mg.step; mg.step=Math.min(mg.step, max); } }catch(_){ } return r; };
    }catch(_){ } })();

  }catch(e){ try{ if(!QUIET_CONSOLE) console.error('[CHS module error]', e); }catch(_){ } }
})();
