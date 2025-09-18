// cloudstats_s1.js — Firestore integration for Verter SAFE bot
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
      console.warn('[CLOUD] queue error', err && err.message ? err.message : err);
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
      console.warn('[CLOUD] write failed', err && err.message ? err.message : err);
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
        if (firebase.apps && firebase.apps.length && firebase.apps[0]){
          firebaseApp = firebase.apps[0];
        } else {
          firebaseApp = firebase.initializeApp(cfg);
        }
        firestoreDb = firebase.firestore();
        firebaseAuth = firebase.auth();
        firebaseAppCheck = firebase.appCheck ? firebase.appCheck() : null;

        if (firebaseAppCheck && cfg && cfg.recaptchaKey){
          firebaseAppCheck.activate(cfg.recaptchaKey, true);
        }

        if (firebaseAuth && firebaseAuth.currentUser && firebaseAuth.currentUser.isAnonymous){
          return firebaseAuth.currentUser;
        }
        if (!firebaseAuth) return null;
        return firebaseAuth.signInAnonymously();
      }).then(function(){
        processQueue();
        return true;
      }).catch(function(err){
        console.warn('[CLOUD] init failed', err && err.message ? err.message : err);
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
          console.warn('[CLOUD] read failed', err && err.message ? err.message : err);
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
