(() => {
const appversion = "Verter ver. 2";
const reverse = false; // Change to true for reverse mode

const config = {
    limits: {
        limitWin1: 50,
        limitLoss1: -50,
        limitWin2: 100,
        limitLoss2: -100,
        limitWin3: 150,
        limitLoss3: -150
    },
    timing: {
        minTimeBetweenTrades: 5000,
        signalCheckInterval: 1000
    },
    virtualTrading: {
        tradeDurationMs: 60 * 1000,
        retentionMs: 60 * 60 * 1000
    },
    colors: {
        green: '#009500',
        red: '#B90000'
    },
    debug: {
        enabled: false
    }
};

const MartingaleEngine = {
    getStep(state) {
        return Number.isInteger(state.currentBetStep) ? state.currentBetStep : 0;
    },
    nextStep(prevStep, outcome, lastIndex) {
        if (outcome === 'won') return 0;
        if (outcome === 'returned') return prevStep;
        const s = prevStep + 1;
        return s > lastIndex ? lastIndex : s;
    },
    getBetSpec(betArray, step) {
        const idx = Math.max(0, Math.min(step, betArray.length - 1));
        const spec = betArray[idx] || { value: 1, pressCount: 0 };
        return { step: idx, value: spec.value, pressCount: spec.pressCount };
    }
};

function logDebug(...args) {
    if (config.debug.enabled) {
        console.log(...args);
    }
}

function logBotActivity() {
    if (typeof state === 'undefined' || !state.activityStats) {
        return;
    }

    const now = Date.now();
    const { lastLogTime } = state.activityStats;

    if (lastLogTime === null) {
        state.activityStats.lastLogTime = now;
        return;
    }

    if (now - lastLogTime < 60000) {
        return;
    }

    const step = MartingaleEngine.getStep(state);
    const arrayLabel = state.betArrayLabel || 'N/A';
    const lastOutcome = state.lastOutcome || 'none';
    const pnl = Number.isFinite(state.currentProfit) ? state.currentProfit.toFixed(2) : '0.00';
    const mismatchCount = Number.isFinite(state.amountMismatchCount) ? state.amountMismatchCount : 0;

    console.log(`[Bot Activity] Step=${step} ActiveArray=${arrayLabel} LastOutcome=${lastOutcome} CyclePnL=${pnl} AmountMismatchCount=${mismatchCount}`);

    state.activityStats.realTrades = 0;
    state.activityStats.virtualTrades = 0;
    state.activityStats.virtualWins = 0;
    state.activityStats.virtualLosses = 0;
    state.activityStats.virtualDraws = 0;
    state.activityStats.lastLogTime = now;
}

function getPriceDecimalPlaces(price, fallback = 5) {
    if (!Number.isFinite(price)) {
        return fallback;
    }

    const decimalPart = price.toString().split('.')[1];
    if (!decimalPart) {
        return fallback;
    }

    return Math.min(fallback, decimalPart.length);
}

function formatPriceDelta(delta, referencePrice) {
    if (!Number.isFinite(delta)) {
        return 'N/A';
    }

    const decimals = getPriceDecimalPlaces(referencePrice);
    const formatted = delta.toFixed(decimals);
    return delta > 0 ? `+${formatted}` : formatted;
}

function logDetailedStatus() {
    const lastRealTrade = state.betHistory.length ? state.betHistory[state.betHistory.length - 1] : null;
    const lastVirtualTrade = state.virtualTrades.length ? state.virtualTrades[state.virtualTrades.length - 1] : null;

    if (!lastRealTrade && !lastVirtualTrade) {
        console.log('[Detailed] No real trades yet; No virtual trades yet.');
        return;
    }

    const realPart = lastRealTrade
        ? `Last real: step=${lastRealTrade.step}, value=${lastRealTrade.betValue}, result=${lastRealTrade.won || 'pending'}, profit=${
            typeof lastRealTrade.profit === 'number' ? lastRealTrade.profit.toFixed(2) : 'N/A'
        }`
        : 'No real trades yet.';

    const virtualPart = lastVirtualTrade
        ? `Last virtual: signal=${lastVirtualTrade.signal}, result=${lastVirtualTrade.outcome}, delta=${formatPriceDelta(lastVirtualTrade.priceDelta, lastVirtualTrade.entryPrice)}`
        : 'No virtual trades yet.';

    console.log(`[Detailed] ${realPart}; ${virtualPart}`);
}

function getFirstElementByClass(className) {
    const elements = document.getElementsByClassName(className);
    return elements.length ? elements[0] : null;
}

function getTextContent(element) {
    return element ? element.textContent.trim() : '';
}

function extractNumericValue(text) {
    if (!text) {
        return 0;
    }

    const sanitized = text.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
    const value = parseFloat(sanitized);
    return Number.isNaN(value) ? 0 : value;
}

function getSymbolName(element = getFirstElementByClass('current-symbol')) {
    const text = getTextContent(element);
    return text ? text.replace('/', ' ') : '';
}

function getBetTimeElement() {
    return getFirstElementByClass('value__val');
}

function getBetInputElement() {
    const container = getFirstElementByClass('call-put-block__in');
    return container ? container.querySelector('input') : null;
}

function getBalanceElement(currentMode) {
    const targetClass = currentMode === 'REAL' ? 'js-hd js-balance-real-USD' : 'js-hd js-balance-demo';
    return getFirstElementByClass(targetClass);
}

function getBalanceValue(element) {
    if (!element) {
        return 0;
    }

    const sourceText = element.textContent || element.innerHTML || '';
    return extractNumericValue(sourceText);
}

function getTooltipElements() {
    return Array.from(document.getElementsByClassName('tooltip-text'));
}

const TradeControls = {
    buy() {
        document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 87, shiftKey: true }));
    },
    sell() {
        document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 83, shiftKey: true }));
    },
    decreaseBet() {
        document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 65, shiftKey: true }));
    },
    increaseBet() {
        document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 68, shiftKey: true }));
    }
};

function normalizeToBase() {
    for (let i = 0; i < 35; i++) {
        TradeControls.decreaseBet();
    }
}

function applyPressCount(n) {
    for (let i = 0; i < n; i++) {
        TradeControls.increaseBet();
    }
}

function getCurrentBetInputValue() {
    const el = getBetInputElement();
    if (!el) {
        return NaN;
    }

    const v = parseFloat(String(el.value).replace(/[^0-9.]/g, ''));
    return Number.isFinite(v) ? v : NaN;
}

const webhookUrl = 'https://script.google.com/macros/s/AKfycbzNXxnYo6Dg31LIZmo3bqLHIjox-EjIu2M9sX8Lli3-JlHREKGwxwc1ly7EgenJ-Ayw/exec'; //M2

const Indicators = {
    calculateEMA(prices, period) {
        if (!Array.isArray(prices) || prices.length === 0) {
            return null;
        }

        if (!period || prices.length < period) {
            const lastPrice = prices[prices.length - 1];
            return lastPrice !== undefined ? lastPrice : null;
        }

        const multiplier = 2 / (period + 1);
        let ema = prices[0];

        for (let i = 1; i < prices.length; i++) {
            ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
        }

        return ema;
    },

    calculateSMA(prices, period) {
        if (!Array.isArray(prices) || prices.length === 0) {
            return null;
        }

        if (!period || prices.length < period) {
            const lastPrice = prices[prices.length - 1];
            return lastPrice !== undefined ? lastPrice : null;
        }

        const recentPrices = prices.slice(-period);
        return recentPrices.reduce((sum, price) => sum + price, 0) / period;
    },

    calculateRSI(prices, period = 14) {
        if (!Array.isArray(prices) || prices.length < period + 1) {
            return 50;
        }

        let gains = 0;
        let losses = 0;

        for (let i = 1; i <= period; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0) {
                gains += change;
            } else {
                losses += Math.abs(change);
            }
        }

        let avgGain = gains / period;
        let avgLoss = losses / period;

        for (let i = period + 1; i < prices.length; i++) {
            const change = prices[i] - prices[i - 1];
            const gain = change > 0 ? change : 0;
            const loss = change < 0 ? Math.abs(change) : 0;

            avgGain = ((avgGain * (period - 1)) + gain) / period;
            avgLoss = ((avgLoss * (period - 1)) + loss) / period;
        }

        if (avgLoss === 0) return 100;

        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    },

    calculateROC(prices, period = 12) {
        if (!Array.isArray(prices) || prices.length === 0) {
            return null;
        }

        if (prices.length < period + 1) {
            return 0;
        }

        const currentPrice = prices[prices.length - 1];
        const pastPrice = prices[prices.length - 1 - period];

        if (pastPrice === 0) {
            return 0;
        }

        return ((currentPrice - pastPrice) / pastPrice) * 100;
    },

    calculateVolatility(prices, period = 10) {
        if (!Array.isArray(prices) || prices.length === 0) {
            return null;
        }

        if (prices.length < period) {
            return null;
        }

        const recent = prices.slice(-period);
        const mean = recent.reduce((sum, price) => sum + price, 0) / recent.length;

        const variance = recent.reduce((sum, price) => {
            return sum + Math.pow(price - mean, 2);
        }, 0) / recent.length;

        const stdDev = Math.sqrt(variance);

        return mean === 0 ? 0 : stdDev / mean;
    }
};

let humanTime = (time) => {
    let h = (new Date(time).getHours()).toString();
    if (h < 10){
        h = '0'+h;
    }
    let m = (new Date(time).getMinutes()).toString();
    if (m < 10){
        m = '0'+m;
    }
    let s = (new Date(time).getSeconds()).toString();
    if (s < 10){
        s = '0'+s;
    }
    let humanTime = h +':'+ m+':'+ s;
    return humanTime;
}

const initialTimestamp = Date.now();
const initialHumanTime = humanTime(initialTimestamp);

const state = {
    priceBuffer: [],
    candlePrices: [],
    candleInterval: 60000,
    lastCandleTime: initialTimestamp,
    time: initialTimestamp,
    hTime: initialHumanTime,
    startTime: initialHumanTime,
    startTimestamp: initialTimestamp,
    maxStepInCycle: 0,
    cyclesToPlay: 30,
    cyclesStats: [],
    limitWin: config.limits.limitWin1,
    limitLoss: config.limits.limitLoss1,
    isTradeOpen: false,
    currentBetStep: 0,
    betArray: null,
    betArrayLabel: 'A1',
    lastOutcome: 'none',
    cycleLimitActive: false,
    betHistory: [],
    priceHistory: [],
    currentBalance: undefined,
    currentProfit: 0,
    profitDiv: null,
    signalDiv: null,
    profitPercentDivAdvisor: null,
    timeDiv: null,
    wonDiv: null,
    wagerDiv: null,
    tradingSymbolDiv: null,
    totalWager: 0,
    historyDiv: null,
    cyclesHistoryDiv: null,
    totalProfitDiv: null,
    historyBetDiv: null,
    trendDiv: null,
    globalTrendDiv: null,
    tradeDirectionDiv: null,
    globalPrice: undefined,
    firstTradeBlock: false,
    targetElement2: null,
    graphContainer: null,
    balanceDiv: null,
    lastPrice: undefined,
    symbolName: '',
    betTime: '',
    priceString: '',
    startBalance: 0,
    prevBalance: 0,
    text: '',
    startPrice: 0,
    lastMin: 0,
    lastMax: 0,
    betInput: null,
    betDivContent: '',
    betValue: 0,
    amountMismatchCount: 0,
    maxStepDiv: null,
    lastTradeTime: 0,
    minTimeBetweenTrades: config.timing.minTimeBetweenTrades,
    lastSignalCheck: 0,
    signalCheckInterval: config.timing.signalCheckInterval,
    priceHistory5m: [],
    priceHistory15m: [],
    lastUpdate5m: 0,
    lastUpdate15m: 0,
    signalSensitivity: 3,
    autoTradingEnabled: true,
    virtualTrades: [],
    activeVirtualTrades: {},
    virtualStatsDiv: null,
    activityStats: {
        realTrades: 0,
        virtualTrades: 0,
        virtualWins: 0,
        virtualLosses: 0,
        virtualDraws: 0,
        lastLogTime: null
    }
};

setInterval(logBotActivity, 1000);
setInterval(logDetailedStatus, 60000);

const panelMap = {
    profit: 'profitDiv',
    signal: 'signalDiv',
    profitPercent: 'profitPercentDivAdvisor',
    time: 'timeDiv',
    won: 'wonDiv',
    wager: 'wagerDiv',
    tradingSymbol: 'tradingSymbolDiv',
    totalProfit: 'totalProfitDiv',
    tradeDirection: 'tradeDirectionDiv',
    maxStep: 'maxStepDiv'
};

function updatePanel(field, value, options = {}) {
    const elementKey = panelMap[field];
    if (!elementKey) {
        return;
    }

    const element = state[elementKey];
    if (!element) {
        return;
    }

    const { useTextContent = false, color, background, backgroundColor } = options;

    if (value !== undefined) {
        if (useTextContent) {
            element.textContent = value;
        } else {
            element.innerHTML = value;
        }
    }

    if (color !== undefined) {
        element.style.color = color;
    }

    if (background !== undefined) {
        element.style.background = background;
    }

    if (backgroundColor !== undefined) {
        element.style.backgroundColor = backgroundColor;
    }

    if (options.resetColor) {
        element.style.color = '';
    }

    if (options.resetBackground) {
        element.style.background = '';
        element.style.backgroundColor = '';
    }
}

function startVirtualTrade(signal, direction, price) {
    if (!signal || signal === 'flat') {
        return;
    }

    if (state.activeVirtualTrades[signal]) {
        return;
    }

    const entryPrice = typeof price === 'number' ? price : state.globalPrice;
    if (entryPrice === undefined) {
        return;
    }

    const trade = {
        signal,
        direction,
        entryPrice,
        startTime: Date.now(),
        timeoutId: null
    };

    trade.timeoutId = setTimeout(() => {
        closeVirtualTrade(signal);
    }, config.virtualTrading.tradeDurationMs);

    state.activeVirtualTrades[signal] = trade;

    if (state.activityStats) {
        state.activityStats.virtualTrades += 1;
    }

    console.log("[Virtual Start]", signal, direction, entryPrice, new Date(trade.startTime).toLocaleTimeString());
}

function closeVirtualTrade(signal) {
    const trade = state.activeVirtualTrades[signal];
    if (!trade) {
        return;
    }

    if (trade.timeoutId) {
        clearTimeout(trade.timeoutId);
    }

    const closeTime = Date.now();
    const exitPrice = state.globalPrice !== undefined ? state.globalPrice : trade.entryPrice;
    let outcome = 'draw';
    let priceDelta = 0;

    if (trade.direction === 'buy') {
        priceDelta = exitPrice - trade.entryPrice;
        if (priceDelta > 0) outcome = 'win';
        else if (priceDelta < 0) outcome = 'loss';
    } else if (trade.direction === 'sell') {
        priceDelta = trade.entryPrice - exitPrice;
        if (priceDelta > 0) outcome = 'win';
        else if (priceDelta < 0) outcome = 'loss';
    }

    const deltaLabel = formatPriceDelta(priceDelta, trade.entryPrice);
    console.log("[Virtual End]", signal, outcome, trade.entryPrice, exitPrice, deltaLabel, new Date(closeTime).toLocaleTimeString());

    if (state.activityStats) {
        if (outcome === 'win') {
            state.activityStats.virtualWins += 1;
        } else if (outcome === 'loss') {
            state.activityStats.virtualLosses += 1;
        } else {
            state.activityStats.virtualDraws += 1;
        }
    }

    state.virtualTrades.push({
        signal: trade.signal,
        direction: trade.direction,
        entryPrice: trade.entryPrice,
        exitPrice,
        startTime: trade.startTime,
        closeTime,
        outcome,
        priceDelta,
        durationMs: closeTime - trade.startTime
    });

    delete state.activeVirtualTrades[signal];
    updateVirtualTradeStats();
}

function cleanupOldVirtualTrades() {
    const cutoff = Date.now() - config.virtualTrading.retentionMs;
    const filteredTrades = state.virtualTrades.filter(trade => {
        const referenceTime = trade.closeTime || trade.startTime;
        return referenceTime >= cutoff;
    });

    state.virtualTrades = filteredTrades;
    return filteredTrades;
}

function getVirtualStats(trades = state.virtualTrades) {
    if (!Array.isArray(trades) || trades.length === 0) {
        return [];
    }

    const statsMap = new Map();

    trades.forEach(trade => {
        const key = trade.signal || 'unknown';
        if (!statsMap.has(key)) {
            statsMap.set(key, {
                signal: key,
                total: 0,
                wins: 0,
                losses: 0,
                draws: 0,
                totalDelta: 0,
                lastCloseTime: 0
            });
        }

        const entry = statsMap.get(key);
        entry.total += 1;
        entry.totalDelta += trade.priceDelta;
        entry.lastCloseTime = Math.max(entry.lastCloseTime, trade.closeTime || trade.startTime);

        if (trade.outcome === 'win') {
            entry.wins += 1;
        } else if (trade.outcome === 'loss') {
            entry.losses += 1;
        } else {
            entry.draws += 1;
        }
    });

    return Array.from(statsMap.values()).map(entry => {
        const winRate = entry.total ? (entry.wins / entry.total) * 100 : 0;
        const avgDelta = entry.total ? entry.totalDelta / entry.total : 0;
        return {
            signal: entry.signal,
            total: entry.total,
            wins: entry.wins,
            losses: entry.losses,
            draws: entry.draws,
            totalDelta: entry.totalDelta,
            lastCloseTime: entry.lastCloseTime,
            winRate,
            avgDelta
        };
    }).sort((a, b) => {
        if (b.winRate === a.winRate) {
            return b.total - a.total;
        }
        return b.winRate - a.winRate;
    });
}

function updateVirtualTradeStats() {
    if (!state.virtualStatsDiv) {
        return;
    }

    const recentTrades = cleanupOldVirtualTrades();
    const stats = getVirtualStats(recentTrades);
    if (!stats.length) {
        state.virtualStatsDiv.textContent = 'No virtual trades yet.';
        return;
    }

    let rowsHtml = stats.map(entry => {
        const winRate = entry.winRate.toFixed(1);
        const avgDelta = entry.avgDelta >= 0 ? `+${entry.avgDelta.toFixed(5)}` : entry.avgDelta.toFixed(5);
        const lastTime = new Date(entry.lastCloseTime).toLocaleTimeString();
        return `
            <tr>
                <td>${entry.signal}</td>
                <td>${entry.total}</td>
                <td>${entry.wins}</td>
                <td>${entry.losses}</td>
                <td>${entry.draws}</td>
                <td>${winRate}%</td>
                <td>${avgDelta}</td>
                <td>${lastTime}</td>
            </tr>
        `;
    }).join('');

    state.virtualStatsDiv.innerHTML = `
        <div style="color: #fff; font-weight: bold; margin-bottom: 6px;">Virtual Trade Stats (60m)</div>
        <table style="width: 100%; border-collapse: collapse; color: #fff; font-size: 12px;">
            <thead>
                <tr style="text-align: left;">
                    <th style="padding: 2px 4px; border-bottom: 1px solid rgba(255,255,255,0.2);">Signal</th>
                    <th style="padding: 2px 4px; border-bottom: 1px solid rgba(255,255,255,0.2);">Trades</th>
                    <th style="padding: 2px 4px; border-bottom: 1px solid rgba(255,255,255,0.2);">Wins</th>
                    <th style="padding: 2px 4px; border-bottom: 1px solid rgba(255,255,255,0.2);">Losses</th>
                    <th style="padding: 2px 4px; border-bottom: 1px solid rgba(255,255,255,0.2);">Draws</th>
                    <th style="padding: 2px 4px; border-bottom: 1px solid rgba(255,255,255,0.2);">Win %</th>
                    <th style="padding: 2px 4px; border-bottom: 1px solid rgba(255,255,255,0.2);">Avg Δ</th>
                    <th style="padding: 2px 4px; border-bottom: 1px solid rgba(255,255,255,0.2);">Last</th>
                </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
        </table>
    `;
}

const mode = 'DEMO';

const debugEnabled = config.debug.enabled;


const targetDiv = getFirstElementByClass("scrollbar-container deals-list ps");
let observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {

        let newDeal = mutation.addedNodes[0];


        function hasClass(element, className) {
            return (' ' + element.className + ' ').indexOf(' ' + className+ ' ') > -1;
        }

        let centerUp;
        let centerDiv = newDeal.childNodes[0].children[0].children[1].children[1];
        if (hasClass(centerDiv, 'price-up')){
            centerUp = true;
        } else {
            centerUp = false;
        }

        let lastUp;
        let lastDiv = newDeal.childNodes[0].children[0].children[1].children[2];
        if (hasClass(lastDiv, 'price-up')){
            lastUp = true;
        } else {
            lastUp = false;
        }

        let betProfit = parseFloat(lastDiv.textContent.replace(/[^\d.-]/g, ''));

        let tradeStatus;
        if (centerUp && lastUp){
            tradeStatus = 'won';
        } else if (centerUp && !lastUp) {
            tradeStatus = 'returned';
        } else if (!centerUp && !lastUp) {
            tradeStatus = 'lost';
        }
        if (state.betHistory.length > 0) {
            state.betHistory[state.betHistory.length - 1].won = tradeStatus;
            state.betHistory[state.betHistory.length - 1].profit = betProfit;
        }

        const prevStep = MartingaleEngine.getStep(state);
        const tradeRecord = state.betHistory.length > 0 ? state.betHistory[state.betHistory.length - 1] : null;
        const tradeStep = tradeRecord ? tradeRecord.step : prevStep;

        // Mark that the trade is now closed
        state.isTradeOpen = false;

        state.symbolName = getSymbolName(symbolDiv);
        updatePanel('tradingSymbol', state.symbolName);
        state.betTime = getTextContent(betTimeDiv);
        let timeParts = state.betTime.split(':');
        let seconds = parseInt(timeParts[0]) * 3600 + parseInt(timeParts[1]) * 60 + parseInt(timeParts[2]);

        let totalBalance = state.prevBalance + betProfit;

        const liveBalance = getBalanceValue(state.balanceDiv);
        if (Number.isFinite(liveBalance)) {
            state.currentBalance = liveBalance;
            state.currentProfit = Math.round((state.currentBalance - state.startBalance) * 100) / 100;
            totalBalance = state.currentBalance;
        } else {
            state.currentBalance = totalBalance;
            state.currentProfit = Math.round((state.currentBalance - state.startBalance) * 100) / 100;
        }
        state.prevBalance = totalBalance;

        const cycleLimitTriggered = evaluateCycleLimits();
        const lastIdx = Array.isArray(state.betArray) && state.betArray.length > 0 ? state.betArray.length - 1 : 0;
        const nextStep = MartingaleEngine.nextStep(prevStep, tradeStatus, lastIdx);

        if (cycleLimitTriggered) {
            state.currentBetStep = 0; // переключение массива по текущей логике выполняется внутри evaluateCycleLimits
        } else {
            state.currentBetStep = nextStep;
        }

        state.lastOutcome = tradeStatus;

        console.log(`[Real Close] step=${tradeStep} outcome=${tradeStatus} pnl=${betProfit}`);

        logTradeToGoogleSheets(
            appversion,
            state.symbolName,
            state.betHistory[state.betHistory.length - 1].time,
            seconds,
            state.betHistory[state.betHistory.length - 1].openPrice,
            state.globalPrice,
            state.betHistory[state.betHistory.length - 1].betValue,
            tradeStatus,
            betProfit,
            totalBalance
        );


    });
});
const observerConfig = { attributes: false, childList: true, characterData: false };
observer.observe(targetDiv, observerConfig);
 
const betArray1 = [
    {step: 0, value: 1, pressCount: 0},
    {step: 1, value: 3, pressCount: 2},
    {step: 2, value: 8, pressCount: 7},
    {step: 3, value: 20, pressCount: 11},
    {step: 4, value: 40, pressCount: 15},
    {step: 5, value: 90, pressCount: 21},
    {step: 6, value: 200, pressCount: 24},
    {step: 7, value: 400, pressCount: 27 },
    {step: 8, value: 900, pressCount: 33 }
];

const betArray2 = [
    {step: 0, value: 1, pressCount: 0},
    {step: 1, value: 3, pressCount: 2},
    {step: 2, value: 8, pressCount: 7},
    {step: 3, value: 20, pressCount: 11},
    {step: 4, value: 40, pressCount: 15},
    {step: 5, value: 90, pressCount: 21},
    {step: 6, value: 200, pressCount: 24},
    {step: 7, value: 400, pressCount: 27 },
    {step: 8, value: 900, pressCount: 33 }
];

const betArray3 = [
    {step: 0, value: 1, pressCount: 0},
    {step: 1, value: 3, pressCount: 2},
    {step: 2, value: 8, pressCount: 7},
    {step: 3, value: 20, pressCount: 11},
    {step: 4, value: 40, pressCount: 15},
    {step: 5, value: 90, pressCount: 21},
    {step: 6, value: 200, pressCount: 24},
    {step: 7, value: 400, pressCount: 27 },
    {step: 8, value: 900, pressCount: 33 }
];

state.betArray = betArray1;
state.betArrayLabel = 'A1';
state.betHistory = [];
state.priceHistory = [];
state.currentBalance = undefined;
state.currentProfit = 0;
state.profitDiv = undefined;
state.signalDiv = undefined;
state.profitPercentDivAdvisor = undefined;
state.timeDiv = undefined;
state.wonDiv = undefined;
state.wagerDiv = undefined;
state.tradingSymbolDiv = undefined;
state.totalWager = 0;
state.historyDiv = undefined;
state.cyclesHistoryDiv = undefined;
state.totalProfitDiv = undefined;
state.historyBetDiv = undefined;
state.trendDiv = undefined;
state.globalTrendDiv = undefined;
state.tradeDirectionDiv = undefined;
state.globalPrice = undefined;
state.firstTradeBlock = false;
state.targetElement2 = undefined;
state.graphContainer = undefined;
state.balanceDiv = undefined;
state.lastPrice = undefined;

const percentProfitDiv = getFirstElementByClass("value__val-start");
state.balanceDiv = getBalanceElement(mode);

const symbolDiv = getFirstElementByClass("current-symbol");
state.symbolName = getSymbolName(symbolDiv);

const betTimeDiv = getBetTimeElement();
state.betTime = getTextContent(betTimeDiv);

state.startBalance = getBalanceValue(state.balanceDiv);
state.prevBalance = state.startBalance;
state.priceString = state.startBalance.toString();
logDebug('Start Balance:', state.startBalance);

const redColor = config.colors.red;
const greenColor = config.colors.green;

const winCycle = document.createElement("div");
winCycle.style.backgroundColor = greenColor;
winCycle.style.padding = "5px";
winCycle.style.margin = "15px 10px 0 0";
winCycle.style.display = "inline-block";
winCycle.style.borderRadius = "3px";

const loseCycle = document.createElement("div");
loseCycle.style.backgroundColor = redColor;
loseCycle.style.padding = "5px";
loseCycle.style.margin = "15px 10px 0 0";
loseCycle.style.display = "inline-block";
loseCycle.style.borderRadius = "3px";

const targetElem = getTooltipElements();
const textToSearch = "Winnings amount you receive";
for (let i = 0; i < targetElem.length; i++){
    const tooltip = targetElem[i];
    const textContent = tooltip.textContent || tooltip.innerText || '';
    if (textContent.includes(textToSearch)){
        state.targetElement2 = tooltip;
    }
}
const buyButton = getFirstElementByClass("btn btn-call");
state.text = state.targetElement2.innerHTML;
state.startPrice = parseFloat(state.text.match(/\d+.\d+(?=\ a)/g)[0]);
state.priceHistory.push(state.startPrice);
logDebug('Start Price:', state.startPrice);

state.lastMin = state.startPrice;
state.lastMax = state.startPrice;

state.betInput = getBetInputElement();
state.betDivContent = state.betInput ? state.betInput.value : '';
state.betValue = parseFloat(state.betDivContent);

let updateMinMax = () => {
    if (state.globalPrice > state.lastMax) {
        state.lastMax = state.globalPrice;
    }
    if (state.globalPrice < state.lastMin) {
        state.lastMin = state.globalPrice;
    }
}

let queryPrice = () => {
    state.time = Date.now();
    state.hTime = humanTime(state.time);
    updatePanel('time', state.hTime);
    updateVirtualTradeStats();

    // Get the current price
    state.text = state.targetElement2.innerHTML;
    let priceMatch = state.text.match(/\d+.\d+(?=\ a)/g);

    if (priceMatch && priceMatch[0]) {
        state.globalPrice = parseFloat(priceMatch[0]);

        // Only add to price history if it's a new price
        if (state.globalPrice !== state.priceHistory[state.priceHistory.length - 1]) {
            state.priceHistory.push(state.globalPrice);

            // Keep priceHistory at a reasonable size (last 500 data points)
            if (state.priceHistory.length > 500) {
                state.priceHistory.shift();
            }

            // Update last price
            state.lastPrice = state.globalPrice;

            // Update min/max
            updateMinMax();
        }

        // Calculate indicators with the updated price history
        calculateIndicators();
    }

    // Update balance and profit
    state.currentBalance = getBalanceValue(state.balanceDiv);
    state.priceString = state.currentBalance.toString();
    state.currentProfit = state.currentBalance - state.startBalance;
    state.currentProfit = Math.round(state.currentProfit * 100) / 100;

    const profitBackground = state.currentProfit < 0 ? redColor : state.currentProfit > 0 ? greenColor : 'inherit';
    updatePanel('profit', state.currentProfit, { background: profitBackground });

    // Only check for trading signals at specified intervals
    // This prevents excessive trading while maintaining up-to-date indicators
    if (state.time - state.lastSignalCheck >= state.signalCheckInterval) {
        state.lastSignalCheck = state.time;

        // Only consider trading if enough time has passed since last trade
        if (state.time - state.lastTradeTime >= state.minTimeBetweenTrades) {
            tradeLogic();
        }
    }
}

// Add Higher Highs/Lower Lows detection
function detectTrend(prices, period = 10) {
    if (prices.length < period) return 'flat';
    
    const recentPrices = prices.slice(-period);
    let higherHighs = 0;
    let lowerLows = 0;
    
    for (let i = 1; i < recentPrices.length; i++) {
        if (recentPrices[i] > recentPrices[i-1]) higherHighs++;
        if (recentPrices[i] < recentPrices[i-1]) lowerLows++;
    }
    
    const ratio = higherHighs / (higherHighs + lowerLows);
    if (ratio > 0.7) return 'strong_up';
    if (ratio > 0.6) return 'up';
    if (ratio < 0.3) return 'strong_down';
    if (ratio < 0.4) return 'down';
    return 'flat';
}

// Add Fractal detection (key reversal points)
function findFractals(prices, period = 5) {
    if (prices.length < period * 2 + 1) return { bullish: false, bearish: false };
    
    const center = prices.length - period - 1;
    const centerPrice = prices[center];
    
    // Bullish fractal (low point)
    let isBullishFractal = true;
    for (let i = center - period; i <= center + period; i++) {
        if (i !== center && prices[i] <= centerPrice) {
            isBullishFractal = false;
            break;
        }
    }
    
    // Bearish fractal (high point)
    let isBearishFractal = true;
    for (let i = center - period; i <= center + period; i++) {
        if (i !== center && prices[i] >= centerPrice) {
            isBearishFractal = false;
            break;
        }
    }
    
    return { 
        bullish: isBullishFractal, 
        bearish: isBearishFractal,
        price: centerPrice 
    };
}


// Add Awesome Oscillator (price-based momentum)
function calculateAwesomeOscillator(prices) {
    if (prices.length < 34) return 0;
    
    // Calculate 5-period and 34-period simple moving averages
    const sma5 = Indicators.calculateSMA(prices, 5);
    const sma34 = Indicators.calculateSMA(prices, 34);
    
    return sma5 - sma34;
}


// Add Parabolic SAR
function calculateParabolicSAR(prices, acceleration = 0.02, maximum = 0.2) {
    if (prices.length < 2) return prices[prices.length - 1];
    
    // Simplified SAR calculation
    let sar = prices[0];
    let ep = prices[1]; // Extreme point
    let af = acceleration; // Acceleration factor
    let isUpTrend = prices[1] > prices[0];
    
    for (let i = 2; i < prices.length; i++) {
        const prevSar = sar;
        
        if (isUpTrend) {
            sar = prevSar + af * (ep - prevSar);
            
            if (prices[i] > ep) {
                ep = prices[i];
                af = Math.min(af + acceleration, maximum);
            }
            
            if (prices[i] < sar) {
                isUpTrend = false;
                sar = ep;
                ep = prices[i];
                af = acceleration;
            }
        } else {
            sar = prevSar + af * (ep - prevSar);
            
            if (prices[i] < ep) {
                ep = prices[i];
                af = Math.min(af + acceleration, maximum);
            }
            
            if (prices[i] > sar) {
                isUpTrend = true;
                sar = ep;
                ep = prices[i];
                af = acceleration;
            }
        }
    }
    
    return { sar, isUpTrend };
}

// Add multiple timeframe support
function updateMultiTimeframe(currentPrice, currentTime) {
    // 5-minute timeframe
    if (currentTime - state.lastUpdate5m >= 300000) { // 5 minutes
        state.priceHistory5m.push(currentPrice);
        if (state.priceHistory5m.length > 50) state.priceHistory5m.shift();
        state.lastUpdate5m = currentTime;
    }

    // 15-minute timeframe
    if (currentTime - state.lastUpdate15m >= 900000) { // 15 minutes
        state.priceHistory15m.push(currentPrice);
        if (state.priceHistory15m.length > 30) state.priceHistory15m.shift();
        state.lastUpdate15m = currentTime;
    }
}

function getMultiTimeframeSignal() {
    if (state.priceHistory5m.length < 10 || state.priceHistory15m.length < 5) {
        return 'insufficient_data';
    }

    // Get signals from different timeframes
    const trend1m = detectTrend(state.priceHistory, 10);
    const trend5m = detectTrend(state.priceHistory5m, 8);
    const trend15m = detectTrend(state.priceHistory15m, 5);
    
    // Align signals
    const bullishTimeframes = [trend1m, trend5m, trend15m].filter(t => 
        t === 'up' || t === 'strong_up').length;
    const bearishTimeframes = [trend1m, trend5m, trend15m].filter(t => 
        t === 'down' || t === 'strong_down').length;
    
    if (bullishTimeframes >= 2) return 'buy';
    if (bearishTimeframes >= 2) return 'sell';
    return 'flat';
}

function prepareIndicatorData() {
    const currentTime = Date.now();

    if (state.globalPrice && state.globalPrice !== state.priceHistory[state.priceHistory.length - 1]) {
        state.priceBuffer.push({
            time: currentTime,
            price: state.globalPrice
        });

        if (state.priceBuffer.length > 500) {
            state.priceBuffer.shift();
        }
    }

    if (state.globalPrice) {
        updateMultiTimeframe(state.globalPrice, currentTime);
    }

    if (currentTime - state.lastCandleTime >= state.candleInterval) {
        if (state.priceBuffer.length > 0) {
            const candlePricePoints = state.priceBuffer.filter(
                point => point.time >= state.lastCandleTime && point.time < currentTime
            );

            if (candlePricePoints.length > 0) {
                const open = candlePricePoints[0].price;
                const high = Math.max(...candlePricePoints.map(p => p.price));
                const low = Math.min(...candlePricePoints.map(p => p.price));
                const close = candlePricePoints[candlePricePoints.length - 1].price;

                state.candlePrices.push(close);

                logDebug(`New 1m candle formed: Open=${open}, High=${high}, Low=${low}, Close=${close}`);

                if (state.candlePrices.length > 50) {
                    state.candlePrices.shift();
                }
            }
        }

        state.lastCandleTime = currentTime;
    }

    const dataForIndicators = state.priceHistory.length >= 20 ? state.priceHistory : [];

    return { dataForIndicators, currentTime };
}

function checkIndicatorDataAvailability(dataForIndicators) {
    if (dataForIndicators.length < 20) {
        window.currentSignal = 'flat';
        updatePanel('signal', 'Insufficient Data');
        updateIndicatorDisplay(true);
        return false;
    }

    return true;
}

function computeIndicators(dataForIndicators) {
    const shortEMA = Indicators.calculateEMA(dataForIndicators, 9);
    const longEMA = Indicators.calculateEMA(dataForIndicators, 21);
    const rsiValue = Indicators.calculateRSI(dataForIndicators, 14);
    const macdData = calculateMACD(dataForIndicators);
    const bollingerBands = calculateBollingerBands(dataForIndicators);
    const stochastic = calculateStochastic(dataForIndicators);
    const rocValue = Indicators.calculateROC(dataForIndicators, 12);
    const awesomeOsc = calculateAwesomeOscillator(dataForIndicators);
    const parabolicSAR = calculateParabolicSAR(dataForIndicators);
    const priceAction = analyzePriceAction(dataForIndicators);
    const supportResistance = findSupportResistance(dataForIndicators);
    const trend = detectTrend(dataForIndicators);
    const fractals = findFractals(dataForIndicators);
    const mtfSignal = getMultiTimeframeSignal();
    const currentPrice = dataForIndicators[dataForIndicators.length - 1];
    const emaDifference = shortEMA - longEMA;

    return {
        shortEMA,
        longEMA,
        emaDifference,
        rsiValue,
        macdData,
        bollingerBands,
        stochastic,
        rocValue,
        awesomeOsc,
        parabolicSAR,
        priceAction,
        supportResistance,
        trend,
        fractals,
        mtfSignal,
        currentPrice
    };
}

function scoreIndicators(values) {
    const {
        shortEMA,
        longEMA,
        emaDifference,
        rsiValue,
        macdData,
        bollingerBands,
        stochastic,
        rocValue,
        awesomeOsc,
        parabolicSAR,
        trend,
        priceAction,
        supportResistance,
        mtfSignal,
        currentPrice
    } = values;

    let bullishScore = 0;
    let bearishScore = 0;

    const emaThreshold = 0.0001;
    if (emaDifference > emaThreshold) bullishScore += 2;
    else if (emaDifference < -emaThreshold) bearishScore += 2;

    if (rsiValue < 30) bullishScore += 2;
    else if (rsiValue > 70) bearishScore += 2;
    else if (rsiValue < 40) bullishScore += 1;
    else if (rsiValue > 60) bearishScore += 1;

    if (macdData.macd > macdData.signal && macdData.histogram > 0) bullishScore += 2;
    else if (macdData.macd < macdData.signal && macdData.histogram < 0) bearishScore += 2;

    if (currentPrice < bollingerBands.lower) bullishScore += 1;
    else if (currentPrice > bollingerBands.upper) bearishScore += 1;

    if (stochastic.k < 20 && stochastic.d < 20) bullishScore += 1;
    else if (stochastic.k > 80 && stochastic.d > 80) bearishScore += 1;

    if (rocValue > 1) bullishScore += 1;
    else if (rocValue < -1) bearishScore += 1;

    if (awesomeOsc > 0) bullishScore += 1;
    else if (awesomeOsc < 0) bearishScore += 1;

    if (parabolicSAR.isUpTrend) bullishScore += 1;
    else if (!parabolicSAR.isUpTrend) bearishScore += 1;

    if (trend === 'strong_up') bullishScore += 2;
    else if (trend === 'up') bullishScore += 1;
    else if (trend === 'strong_down') bearishScore += 2;
    else if (trend === 'down') bearishScore += 1;

    if (priceAction.pattern.includes('bullish')) {
        bullishScore += 1;
    } else if (priceAction.pattern.includes('bearish')) {
        bearishScore += 1;
    }

    if (supportResistance.nearSupport) bullishScore += 1;
    else if (supportResistance.nearResistance) bearishScore += 1;

    if (mtfSignal === 'buy') bullishScore += 3;
    else if (mtfSignal === 'sell') bearishScore += 3;

    let signal = 'flat';
    const scoreDifference = Math.abs(bullishScore - bearishScore);
    const minScoreThreshold = 5;

    if (bullishScore > bearishScore && bullishScore >= minScoreThreshold && scoreDifference >= 3) {
        signal = 'buy';
    } else if (bearishScore > bullishScore && bearishScore >= minScoreThreshold && scoreDifference >= 3) {
        signal = 'sell';
    }

    if (priceAction.isConsolidating) {
        signal = 'flat';
    }

    return { bullishScore, bearishScore, signal, scoreDifference };
}

function updateIndicatorUI(scores, values, context) {
    const { bullishScore, bearishScore, signal } = scores;
    const {
        shortEMA,
        longEMA,
        emaDifference,
        rsiValue,
        macdData,
        bollingerBands,
        stochastic,
        rocValue,
        awesomeOsc,
        parabolicSAR,
        trend,
        priceAction,
        mtfSignal
    } = values;

    updatePanel('signal', `${signal.toUpperCase()} (B:${bullishScore} vs S:${bearishScore})`, {
        backgroundColor: signal === 'buy' ? greenColor : (signal === 'sell' ? redColor : '#333')
    });

    window.currentSignal = signal;
    if (window.currentSignal === 'buy' || window.currentSignal === 'sell') {
        startVirtualTrade(window.currentSignal, window.currentSignal, state.globalPrice);
    }
    window.currentShortEMA = shortEMA;
    window.currentLongEMA = longEMA;
    window.currentRSI = rsiValue;
    window.emaDifference = emaDifference;
    window.bullishScore = bullishScore;
    window.bearishScore = bearishScore;
    window.currentMACD = macdData;
    window.currentBB = bollingerBands;
    window.currentStoch = stochastic;
    window.currentTrend = trend;
    window.currentPriceAction = priceAction;

    updateIndicatorDisplay(false, {
        shortEMA,
        longEMA,
        emaDifference,
        rsiValue,
        macdData,
        bollingerBands,
        stochastic,
        rocValue,
        awesomeOsc,
        parabolicSAR,
        trend,
        priceAction,
        mtfSignal,
        candlePrices: state.candlePrices,
        currentTime: context.currentTime
    });

    logDebug(`Signal: ${signal}, Bullish Score: ${bullishScore}, Bearish Score: ${bearishScore}, Trend: ${trend}, Pattern: ${priceAction.pattern}`);
}

// Modify calculateIndicators to include these new indicators
function calculateIndicators() {
    const { dataForIndicators, currentTime } = prepareIndicatorData();

    if (!checkIndicatorDataAvailability(dataForIndicators)) {
        return;
    }

    const indicatorValues = computeIndicators(dataForIndicators);
    const scores = scoreIndicators(indicatorValues);
    updateIndicatorUI(scores, indicatorValues, { currentTime });
}

// Add the missing helper functions for price action analysis
function analyzePriceAction(prices) {
    if (prices.length < 10) return { pattern: 'insufficient_data', isConsolidating: false };
    
    const recent = prices.slice(-10);
    const current = recent[recent.length - 1];
    const previous = recent[recent.length - 2];
    const high = Math.max(...recent);
    const low = Math.min(...recent);
    const range = high - low;
    const avgPrice = recent.reduce((sum, p) => sum + p, 0) / recent.length;
    
    // Check for consolidation (low volatility)
    const isConsolidating = range < (avgPrice * 0.001); // Less than 0.1% range
    
    // Pattern detection
    let pattern = 'neutral';
    
    // Bullish patterns
    if (current > previous && current > avgPrice) {
        if (current > high * 0.99) pattern = 'bullish_breakout';
        else pattern = 'bullish_continuation';
    } else if (current < previous && current > low * 1.01) {
        pattern = 'bullish_bounce';
    }
    
    // Bearish patterns
    if (current < previous && current < avgPrice) {
        if (current < low * 1.01) pattern = 'bearish_breakdown';
        else pattern = 'bearish_continuation';
    } else if (current > previous && current < high * 0.99) {
        pattern = 'bearish_rejection';
    }
    
    // Reversal patterns
    const momentum = (current - recent[0]) / recent[0] * 100;
    if (momentum > 0.05 && recent.slice(0, 5).every(p => p < avgPrice)) {
        pattern = 'bullish_reversal';
    } else if (momentum < -0.05 && recent.slice(0, 5).every(p => p > avgPrice)) {
        pattern = 'bearish_reversal';
    }
    
    return { pattern, isConsolidating };
}

function findSupportResistance(prices) {
    if (prices.length < 20) return { nearSupport: false, nearResistance: false };
    
    const current = prices[prices.length - 1];
    const recent = prices.slice(-20);
    
    // Find potential support and resistance levels
    const highs = [];
    const lows = [];
    
    for (let i = 2; i < recent.length - 2; i++) {
        // Local high
        if (recent[i] > recent[i-1] && recent[i] > recent[i+1] && 
            recent[i] > recent[i-2] && recent[i] > recent[i+2]) {
            highs.push(recent[i]);
        }
        // Local low
        if (recent[i] < recent[i-1] && recent[i] < recent[i+1] && 
            recent[i] < recent[i-2] && recent[i] < recent[i+2]) {
            lows.push(recent[i]);
        }
    }
    
    const threshold = current * 0.0005; // 0.05% threshold
    
    const nearSupport = lows.some(low => Math.abs(current - low) < threshold && current > low);
    const nearResistance = highs.some(high => Math.abs(current - high) < threshold && current < high);
    
    return { nearSupport, nearResistance };
}

// Helper function to calculate price momentum
function calculatePriceMomentum(prices) {
    if (prices.length < 5) {
        return { direction: 'flat', strength: 'weak' };
    }
    
    const recent = prices.slice(-5);
    const currentPrice = recent[recent.length - 1];
    const startPrice = recent[0];
    
    // Calculate momentum
    const totalChange = currentPrice - startPrice;
    const percentChange = (totalChange / startPrice) * 100;
    
    // Determine direction
    let direction = 'flat';
    if (percentChange > 0.01) direction = 'up';
    else if (percentChange < -0.01) direction = 'down';
    
    // Determine strength
    let strength = 'weak';
    const absChange = Math.abs(percentChange);
    if (absChange > 0.05) strength = 'strong';
    else if (absChange > 0.02) strength = 'moderate';
    
    // Calculate acceleration (rate of change of momentum)
    const midPrice = recent[Math.floor(recent.length / 2)];
    const firstHalfChange = midPrice - startPrice;
    const secondHalfChange = currentPrice - midPrice;
    const acceleration = secondHalfChange - firstHalfChange;
    
    return {
        direction,
        strength,
        percentChange,
        acceleration,
        isAccelerating: Math.abs(acceleration) > Math.abs(totalChange) * 0.1
    };
}

// Update the debug function to include candle information
function debugTradeStatus() {
    if (!debugEnabled) {
        return;
    }

    const time = Date.now();
    const timeSinceLastTrade = time - state.lastTradeTime;
    const timeSinceLastSignalCheck = time - state.lastSignalCheck;

    logDebug(`Debug Trade Status:
    - Current Signal: ${window.currentSignal || 'undefined'}
    - EMA Signal: ${window.emaSignal || 'undefined'}
    - RSI Signal: ${window.rsiSignal || 'undefined'}
    - Stochastic Signal: ${window.stochSignal || 'undefined'}
    - Time since last trade: ${timeSinceLastTrade}ms (min required: ${state.minTimeBetweenTrades}ms)
    - Time since last signal check: ${timeSinceLastSignalCheck}ms (check interval: ${state.signalCheckInterval}ms)
    - EMA Difference: ${window.emaDifference ? window.emaDifference.toFixed(5) : 'undefined'}
    - RSI Value: ${window.currentRSI ? window.currentRSI.toFixed(2) : 'undefined'}
    - Stochastic Values: %K=${window.stochK ? window.stochK.toFixed(2) : 'undefined'}, %D=${window.stochD ? window.stochD.toFixed(2) : 'undefined'}
    - Candle Progress: ${window.candleProgress || 0}% (${Math.round(window.timeUntilNextCandle/1000) || 0}s until next candle)
    - Candle Count: ${state.candlePrices.length}
    - Cycles to Play: ${state.cyclesToPlay}
    - Current Profit: ${state.currentProfit}
    - Current Profit %: ${currentProfitPercent || 'undefined'}
    `);
}

function createTradeContext() {
    const time = Date.now();

    return {
        time,
        hTime: humanTime(time),
        globalTrend: 'flat',
        priceTrend: 'flat'
    };
}

function getIndicatorScores() {
    const bullishScore = window.bullishScore || 0;
    const bearishScore = window.bearishScore || 0;
    const scoreDifference = Math.abs(bullishScore - bearishScore);
    const adjustedThreshold = 11 - state.signalSensitivity;

    return {
        signal: window.currentSignal || 'flat',
        bullishScore,
        bearishScore,
        scoreDifference,
        adjustedThreshold
    };
}

function determineTradeDirection(scores) {
    const { bullishScore, bearishScore, scoreDifference, adjustedThreshold } = scores;
    let tradeDirection;
    let tradeDirectionBackground;

    if (bullishScore > bearishScore && scoreDifference >= adjustedThreshold) {
        tradeDirection = !reverse ? 'buy' : 'sell';
        tradeDirectionBackground = greenColor;
    } else if (bearishScore > bullishScore && scoreDifference >= adjustedThreshold) {
        tradeDirection = !reverse ? 'sell' : 'buy';
        tradeDirectionBackground = redColor;
    } else {
        tradeDirection = 'flat';
        tradeDirectionBackground = '#555555';
    }

    return { tradeDirection, tradeDirectionBackground };
}

function updateTradeDirectionPanel(tradeDecision, scores) {
    updatePanel('tradeDirection', `${tradeDecision.tradeDirection} (${scores.scoreDifference}/${scores.adjustedThreshold})`, {
        background: tradeDecision.tradeDirectionBackground
    });
}

function evaluateCycleLimits() {
    let triggered = false;

    if (state.currentProfit > state.limitWin) {
        state.limitWin = config.limits.limitWin1;
        state.limitLoss = config.limits.limitLoss1;
        state.betArray = betArray1;
        state.betArrayLabel = 'A1';
        let newDiv = winCycle.cloneNode();
        newDiv.style.height = '30px';
        newDiv.innerHTML = state.currentProfit;
        newDiv.innerHTML += '<div class="max-cycle">' + state.maxStepInCycle + '</div>';
        state.cyclesHistoryDiv.appendChild(newDiv);
        resetCycle('win');
        triggered = true;
    } else if (state.currentProfit - state.betValue < state.limitLoss) {
        if (state.limitWin === config.limits.limitWin1) {
            state.limitWin = config.limits.limitWin2;
            state.limitLoss = config.limits.limitLoss2;
            state.betArray = betArray2;
            state.betArrayLabel = 'A2';
        } else if (state.limitWin === config.limits.limitWin2) {
            state.limitWin = config.limits.limitWin3;
            state.limitLoss = config.limits.limitLoss3;
            state.betArray = betArray3;
            state.betArrayLabel = 'A3';
        } else {
            state.limitWin = config.limits.limitWin1;
            state.limitLoss = config.limits.limitLoss1;
            state.betArray = betArray1;
            state.betArrayLabel = 'A1';
        }
        let newDiv = loseCycle.cloneNode();
        newDiv.style.height = '30px';
        newDiv.innerHTML = state.currentProfit;
        newDiv.innerHTML += '<div class="max-cycle">' + state.maxStepInCycle + '</div>';
        state.cyclesHistoryDiv.appendChild(newDiv);
        resetCycle('lose');
        triggered = true;
    }

    state.cycleLimitActive = triggered;
    return triggered;
}

function handleProfitLimits() {
    if (state.cycleLimitActive) {
        state.cycleLimitActive = false;
        return true;
    }

    return false;
}

function checkEntryConditions(tradeDirection) {
    return state.cyclesToPlay > 0 && tradeDirection !== 'flat' && state.autoTradingEnabled;
}

function executeTrade(tradeDirection, currentBetStep, scores, context) {
    if (!state.isTradeOpen) {
        smartBet(currentBetStep, tradeDirection);
        state.isTradeOpen = true;
    }

    state.lastTradeTime = context.time;

    let betValue = getBetValue(currentBetStep);
    if (Number.isFinite(state.betValue) && state.betValue > 0) {
        betValue = state.betValue;
    }
    const tradeRecord = {
        time: context.hTime,
        betTime: state.betTime,
        openPrice: state.globalPrice,
        step: currentBetStep,
        betValue,
        betDirection: tradeDirection,
        globalTrend: context.globalTrend,
        priceTrend: context.priceTrend,
        shortEMA: window.currentShortEMA,
        longEMA: window.currentLongEMA,
        emaDiff: window.currentShortEMA - window.currentLongEMA,
        rsi: window.currentRSI,
        bullishScore: scores.bullishScore,
        bearishScore: scores.bearishScore,
        scoreDiff: scores.scoreDifference,
        threshold: scores.adjustedThreshold
    };

    state.betHistory.push(tradeRecord);
    state.totalWager += betValue;
    updatePanel('wager', state.totalWager);

    state.maxStepInCycle = Math.max(state.maxStepInCycle, tradeRecord.step);
    updatePanel('maxStep', state.maxStepInCycle);

    logDebug(`Trade executed: ${tradeDirection} at step ${currentBetStep}, Score diff: ${scores.scoreDifference}/${scores.adjustedThreshold}`);
}

function updateWinPercentage() {
    let winCounter = 0;
    for (let i = 0; i < state.betHistory.length; i++) {
        if (state.betHistory[i].won === 'won') {
            winCounter++;
        }
    }

    let winPercent = Math.round(winCounter / state.betHistory.length * 100 * 100) / 100;
    updatePanel('won', winPercent);
}

/// Modify the tradeLogic function to use the sensitivity parameter
function tradeLogic() {
    const context = createTradeContext();
    debugTradeStatus();

    const currentBetStep = MartingaleEngine.getStep(state);
    const scores = getIndicatorScores();
    const tradeDecision = determineTradeDirection(scores);

    updateTradeDirectionPanel(tradeDecision, scores);

    if (handleProfitLimits()) {
        return;
    }

    if (checkEntryConditions(tradeDecision.tradeDirection)) {
        executeTrade(tradeDecision.tradeDirection, currentBetStep, scores, context);
    }

    updateWinPercentage();
}

let smartBet = (step, tradeDirection) => {

    const currentProfitPercent = parseInt(percentProfitDiv.innerHTML);
    updatePanel('profitPercent', currentProfitPercent, { resetBackground: true, resetColor: true });

    if (currentProfitPercent < 90){
        logDebug(`%c BET IS NOT RECOMMENDED. Aborting mission! `, `background: ${redColor}; color: #ffffff`);
        updatePanel('profitPercent', `win % is low! ABORT!!! => ${currentProfitPercent}`, {
            background: redColor,
            color: '#ffffff'
        });
        return;
    }

    if (tradeDirection === 'null'){
        logDebug('trade dir is NULL');
    }

    const { pressCount, value } = MartingaleEngine.getBetSpec(state.betArray || [], step);

    normalizeToBase();
    applyPressCount(pressCount);

    const initialActual = getCurrentBetInputValue();
    if (Number.isFinite(initialActual) && initialActual !== value) {
        if (initialActual > value) {
            let attempts = 200;
            while (attempts-- > 0) {
                const current = getCurrentBetInputValue();
                if (!Number.isFinite(current) || current <= value) {
                    break;
                }
                TradeControls.decreaseBet();
            }
        } else {
            let attempts = 200;
            while (attempts-- > 0) {
                const current = getCurrentBetInputValue();
                if (!Number.isFinite(current) || current >= value) {
                    break;
                }
                TradeControls.increaseBet();
            }
        }
    }

    const finalAmount = getCurrentBetInputValue();
    if (!Number.isFinite(finalAmount) || finalAmount !== value) {
        state.amountMismatchCount = (state.amountMismatchCount || 0) + 1;
    }

    state.betValue = Number.isFinite(finalAmount) ? finalAmount : value;

    console.log(`[Real Open] step=${step} press=${pressCount} amount=${Number.isFinite(finalAmount) ? finalAmount : 'NaN'} dir=${tradeDirection}`);

    setTimeout(function() {
        if (tradeDirection == 'buy'){
            TradeControls.buy();
        } else {
            TradeControls.sell();
        }
        if (state.activityStats) {
            state.activityStats.realTrades += 1;
        }
    }, 100);
}
let getBetValue = (betStep) => {
    const spec = MartingaleEngine.getBetSpec(state.betArray || [], betStep);
    return spec.value;
}
let takeRight = (arr, n = 1) => arr.slice(-n);
Array.prototype.max = function() {
    return Math.max.apply(null, this);
};  
Array.prototype.min = function() {
    return Math.min.apply(null, this);
};
let resetCycle = (winStatus) => {

    let time = Date.now();
    let hTime = humanTime(time);

    // Пример: логирование сделки

    logDebug('%c RESET CYCLE! ' + hTime, 'background: #9326FF; color: #ffffff');

    updatePanel('profit', undefined, { background: 'inherit' });

    state.maxStepInCycle = 0;

    if (state.cyclesToPlay > 0) {
        state.cyclesStats.push(state.currentProfit);
        state.startBalance = state.currentBalance;
        state.cyclesToPlay--;
        let totalProfit = 0;
        for (let i = 0; i < state.cyclesStats.length; i++) {
            totalProfit += state.cyclesStats[i];
        }

        totalProfit = Math.round(totalProfit * 100) / 100;
        const totalProfitBackground = totalProfit < 0 ? redColor : totalProfit > 0 ? greenColor : 'inherit';
        updatePanel('totalProfit', totalProfit, { background: totalProfitBackground });
        state.firstTradeBlock = false;
    } else {
        logDebug('%c ----- ALL CYCLES ENDED! ----- ' + hTime + ' ------', 'background: #9326FF; color: #ffffff');
    }
}
function updateHeaderPanel() {
    // Get references to elements we need to update
    const symbolElement = document.getElementById('trading-symbol');
    const balanceElement = document.getElementById('balance');
    const modeElement = document.getElementById('trading-mode');
    const timeElement = document.getElementById('time');
    
    if (!symbolElement || !balanceElement || !modeElement) return;
    
    // Update trading symbol with additional market data if available
    if (window.globalPrice) {
        const priceChangeColor = window.priceDirection === 'up' ? '#00c800' : 
                                window.priceDirection === 'down' ? '#ff3a3a' : '#ffffff';
        
        // Format the price with appropriate decimal places based on value
        const formattedPrice = window.globalPrice < 1 ? 
            window.globalPrice.toFixed(5) : 
            window.globalPrice.toFixed(2);
        
        symbolElement.innerHTML = `${state.symbolName} <span style="color: ${priceChangeColor}; font-weight: bold;">${formattedPrice}</span>`;
    }
    
    // Update balance with current account value
    if (window.currentBalance) {
        // Format balance with commas for thousands and fixed to 2 decimal places
        const formattedBalance = parseFloat(window.currentBalance).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        
        // Add color based on profit/loss compared to starting balance
        const balanceColor = window.currentBalance > state.startBalance ? '#00c800' :
                            window.currentBalance < state.startBalance ? '#ff3a3a' : '#ffffff';
        
        balanceElement.innerHTML = `${formattedBalance}`;
        balanceElement.style.color = balanceColor;
    }
    
    // Update mode with additional information
    if (modeElement) {
        const sessionDuration = Math.floor((Date.now() - state.startTimestamp) / 60000); // in minutes
        modeElement.innerHTML = `${mode} <span style="font-size: 11px; opacity: 0.8;">(${sessionDuration} min)</span>`;
    }
    
    // Update time display
    if (timeElement) {
        const currentTime = new Date();
        const hours = currentTime.getHours().toString().padStart(2, '0');
        const minutes = currentTime.getMinutes().toString().padStart(2, '0');
        const seconds = currentTime.getSeconds().toString().padStart(2, '0');
        timeElement.innerHTML = `${hours}:${minutes}:${seconds}`;
    }
    
    // Update sensitivity indicator if it exists
    const sensitivityValue = document.getElementById('sensitivity-value');
    if (sensitivityValue) {
        // Color code based on sensitivity level
        let sensitivityColor = '#ffffff';
        if (state.signalSensitivity <= 3) {
            sensitivityColor = '#ff3a3a'; // Red for aggressive
        } else if (state.signalSensitivity <= 6) {
            sensitivityColor = '#ffa500'; // Orange for moderate
        } else {
            sensitivityColor = '#00c800'; // Green for conservative
        }
        sensitivityValue.style.color = sensitivityColor;
    }
    
    // Update auto-trading status indicator if it exists
    const autoTradingToggle = document.getElementById('auto-trading-toggle');
    if (autoTradingToggle) {
        const autoTradingLabel = autoTradingToggle.parentElement.querySelector('label');
        if (autoTradingLabel) {
            autoTradingLabel.style.color = state.autoTradingEnabled ? '#00c800' : '#ff3a3a';
        }
    }
    
    // Update market volatility indicator if available
    if (window.marketVolatility !== undefined) {
        const volatilityElement = document.getElementById('market-volatility');
        if (volatilityElement) {
            const volatility = window.marketVolatility * 100;
            let volatilityColor = '#ffffff';
            
            if (volatility > 0.5) {
                volatilityColor = '#ff3a3a'; // High volatility
            } else if (volatility > 0.2) {
                volatilityColor = '#ffa500'; // Medium volatility
            } else {
                volatilityColor = '#00c800'; // Low volatility
            }
            
            volatilityElement.innerHTML = `${volatility.toFixed(2)}%`;
            volatilityElement.style.color = volatilityColor;
        }
    }
    
    // Update support/resistance levels if available
    if (window.supportResistance) {
        const supportElement = document.getElementById('support-level');
        const resistanceElement = document.getElementById('resistance-level');
        
        if (supportElement && window.supportResistance.support) {
            const formattedSupport = window.supportResistance.support < 1 ? 
                window.supportResistance.support.toFixed(5) : 
                window.supportResistance.support.toFixed(2);
            supportElement.innerHTML = formattedSupport;
        }
        
        if (resistanceElement && window.supportResistance.resistance) {
            const formattedResistance = window.supportResistance.resistance < 1 ? 
                window.supportResistance.resistance.toFixed(5) : 
                window.supportResistance.resistance.toFixed(2);
            resistanceElement.innerHTML = formattedResistance;
        }
    }
}

// Call this function periodically to update the header panel
// You can add this to your existing setInterval or create a new one
setInterval(updateHeaderPanel, 1000); // Update every second
function addUI() {
    // create a new div element
    const newDiv = document.createElement("div");
    newDiv.style.width = "480px";
    newDiv.style.position = "absolute";
    newDiv.style.top = "130px";
    newDiv.style.left = "110px";
    newDiv.style.zIndex = "100500";
    newDiv.style.background = "rgba(0, 0, 0, 0.8)"; // Slightly darker background
    newDiv.style.padding = "20px";
    newDiv.style.borderRadius = "10px";
    newDiv.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.5)"; // Add shadow for depth
    newDiv.style.fontFamily = "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif"; // Better font
    newDiv.style.color = "#ddd"; // Lighter text color for better contrast
    newDiv.style.maxHeight = "85vh";
    newDiv.style.overflowY = "auto";
    newDiv.style.scrollbarWidth = "thin";
    newDiv.style.scrollbarColor = "#444 #222";

    state.historyBetDiv = document.createElement("div");
    state.historyBetDiv.style.width = "10px";
    state.historyBetDiv.style.height = "10px";
    state.historyBetDiv.style.padding = "2px";
    state.historyBetDiv.style.display = "inline-block";
    state.historyBetDiv.classList.add("history-bet");
  
    // Add CSS for the UI
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        .bot-trading-panel {
            margin-bottom: 15px;
            background-color: rgba(40, 40, 40, 0.7);
            border-radius: 6px;
            padding: 12px;
        }
        
        .panel-header {
            font-size: 14px;
            font-weight: bold;
            color: #aaa;
            margin-bottom: 10px;
            border-bottom: 1px solid #444;
            padding-bottom: 5px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .panel-header .version {
            font-size: 11px;
            color: #666;
            font-weight: normal;
        }
        
        .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
        }
        
        .info-item {
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            border-bottom: 1px dotted #333;
        }
        
        .info-label {
            color: #888;
            font-size: 12px;
        }
        
        .info-value {
            font-weight: 500;
            color: #ddd;
            font-size: 12px;
        }
        
        .profit-positive {
            color: #00b300;
        }
        
        .profit-negative {
            color: #ff4d4d;
        }
        
        .signal-buy {
            color: #00b300;
            font-weight: bold;
        }
        
        .signal-sell {
            color: #ff4d4d;
            font-weight: bold;
        }
        
        .signal-flat {
            color: #aaa;
        }
        
        .full-width {
            grid-column: 1 / span 2;
        }
        
        .cycles-history {
            margin-top: 10px;
            padding: 8px;
            background-color: rgba(30, 30, 30, 0.7);
            border-radius: 4px;
            max-height: 80px;
            overflow-y: auto;
            font-size: 12px;
        }
    `;
    document.head.appendChild(styleElement);
    
    // Add the version info
    const headerPanel = document.createElement('div');
    headerPanel.className = 'bot-trading-panel';
    headerPanel.innerHTML = `
        <div class="panel-header">
            <span>Trading Bot</span>
            <span class="version">${appversion}</span>
        </div>
        <div class="info-grid">
            <div class="info-item full-width">
                <span class="info-label">Trading Symbol:</span>
            <span class="info-value" id="trading-symbol">${state.symbolName}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Start Balance:</span>
                <span class="info-value">${state.startBalance}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Start Time:</span>
                <span class="info-value">${state.startTime}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Mode:</span>
                <span class="info-value">${mode}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Reverse:</span>
                <span class="info-value">${reverse}</span>
            </div>
        </div>
    `;
    
    // Add the trading status panel
    const statusPanel = document.createElement('div');
    statusPanel.className = 'bot-trading-panel';
    statusPanel.innerHTML = `
        <div class="panel-header">
            <span>Trading Status</span>
            <span id="time" class="info-value">0:00</span>
        </div>
        <div class="info-grid">
            <div class="info-item">
                <span class="info-label">Signal:</span>
                <span class="info-value" id="signal">none</span>
            </div>
            <div class="info-item">
                <span class="info-label">Direction:</span>
                <span class="info-value" id="trade-dir">flat</span>
            </div>
            <div class="info-item">
                <span class="info-label">Cycle Profit:</span>
                <span class="info-value" id="profit">$0</span>
            </div>
            <div class="info-item">
                <span class="info-label">Win Rate:</span>
                <span class="info-value" id="won-percent">0%</span>
            </div>
            <div class="info-item">
                <span class="info-label">Current Wager:</span>
                <span class="info-value" id="wager">$0</span>
            </div>
            <div class="info-item">
                <span class="info-label">Profit %:</span>
                <span class="info-value" id="profit-percent">0%</span>
            </div>
            <div class="info-item">
                <span class="info-label">Max Step:</span>
                <span class="info-value" id="max-step">0</span>
            </div>
            <div class="info-item">
                <span class="info-label">Total Profit:</span>
                <span class="info-value" id="total-profit">$0</span>
            </div>
        </div>
    `;

    const parentPanel = statusPanel;
    state.virtualStatsDiv = document.createElement('div');
    state.virtualStatsDiv.style.marginTop = '10px';
    state.virtualStatsDiv.style.fontSize = '12px';
    parentPanel.appendChild(state.virtualStatsDiv);
    
    // Add the cycles history panel
    const cyclesPanel = document.createElement('div');
    cyclesPanel.className = 'bot-trading-panel';
    cyclesPanel.innerHTML = `
        <div class="panel-header">
            <span>Cycles History</span>
        </div>
        <div class="cycles-history" id="cycles-history"></div>
    `;
    
    // Add the graphs panel
    const graphsPanel = document.createElement('div');
    graphsPanel.className = 'bot-trading-panel';
    graphsPanel.innerHTML = `
        <div class="panel-header">
            <span>Technical Analysis</span>
        </div>
        <div id="graphs"></div>
    `;
    
    // Append all panels to the main div
    newDiv.appendChild(headerPanel);
    newDiv.appendChild(statusPanel);
    newDiv.appendChild(cyclesPanel);
    newDiv.appendChild(graphsPanel);
    
    // Add the newly created element to the DOM
    document.body.appendChild(newDiv);

    // Get references to all the elements we need to update
    state.profitDiv = document.getElementById("profit");
    state.profitPercentDivAdvisor = document.getElementById("profit-percent");
    state.historyDiv = document.getElementById("history-box");
    state.signalDiv = document.getElementById("signal");
    state.tradingSymbolDiv = document.getElementById("trading-symbol");
    state.trendDiv = document.getElementById("price-trend");
    state.globalTrendDiv = document.getElementById("global-trend");
    state.tradeDirectionDiv = document.getElementById("trade-dir");
    state.timeDiv = document.getElementById("time");
    state.wonDiv = document.getElementById("won-percent");
    state.wagerDiv = document.getElementById("wager");
    state.maxStepDiv = document.getElementById("max-step");
    state.totalProfitDiv = document.getElementById("total-profit");
    state.cyclesHistoryDiv = document.getElementById("cycles-history");
    state.graphContainer = document.getElementById("graphs");

    updateVirtualTradeStats();

    // After creating all UI elements, add the sensitivity control
    setTimeout(() => {
        addSensitivityControl();
    }, 500);
}
function updateIndicatorDisplay(insufficientData, indicators) {
    // Create or update the indicator display container
    let indicatorDisplay = document.getElementById('indicator-display');
    if (!indicatorDisplay) {
        indicatorDisplay = document.createElement('div');
        indicatorDisplay.id = 'indicator-display';
        indicatorDisplay.style.marginTop = '10px';
        indicatorDisplay.style.padding = '10px';
        indicatorDisplay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        indicatorDisplay.style.borderRadius = '5px';
        document.getElementById('graphs').appendChild(indicatorDisplay);
    }
    
    // If we don't have enough data, show a message
    if (insufficientData) {
        indicatorDisplay.innerHTML = '<div style="color: #ffaa00;">Collecting data for indicators...</div>';
        return;
    }
    
    // Format the indicators for display
    const {
        shortEMA, longEMA, emaDifference, rsiValue, macdData, 
        bollingerBands, stochastic, rocValue, awesomeOsc, 
        parabolicSAR, trend, priceAction, mtfSignal
    } = indicators;
    
    // Color coding based on indicator values
    const emaColor = emaDifference > 0 ? greenColor : (emaDifference < 0 ? redColor : 'white');
    const rsiColor = rsiValue < 30 ? greenColor : (rsiValue > 70 ? redColor : 'white');
    const macdColor = macdData.histogram > 0 ? greenColor : (macdData.histogram < 0 ? redColor : 'white');
    const stochColor = stochastic.k < 20 ? greenColor : (stochastic.k > 80 ? redColor : 'white');
    const rocColor = rocValue > 0 ? greenColor : (rocValue < 0 ? redColor : 'white');
    const aoColor = awesomeOsc > 0 ? greenColor : (awesomeOsc < 0 ? redColor : 'white');
    const trendColor = trend.includes('up') ? greenColor : (trend.includes('down') ? redColor : 'white');
    const patternColor = priceAction.pattern.includes('bullish') ? greenColor : 
                         (priceAction.pattern.includes('bearish') ? redColor : 'white');
    const mtfColor = mtfSignal === 'buy' ? greenColor : (mtfSignal === 'sell' ? redColor : 'white');
    
    // Create HTML for indicator display
    indicatorDisplay.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; color: white;">
            <div>
                <div><strong>EMA:</strong> <span style="color: ${emaColor}">Short: ${shortEMA.toFixed(5)}, Long: ${longEMA.toFixed(5)}</span></div>
                <div><strong>Diff:</strong> <span style="color: ${emaColor}">${emaDifference.toFixed(5)}</span></div>
                <div><strong>RSI:</strong> <span style="color: ${rsiColor}">${rsiValue.toFixed(2)}</span></div>
                <div><strong>MACD:</strong> <span style="color: ${macdColor}">${macdData.macd.toFixed(5)} / ${macdData.signal.toFixed(5)}</span></div>
                <div><strong>BB:</strong> <span>${bollingerBands.upper.toFixed(5)} / ${bollingerBands.middle.toFixed(5)} / ${bollingerBands.lower.toFixed(5)}</span></div>
            </div>
            <div>
                <div><strong>Stoch:</strong> <span style="color: ${stochColor}">K: ${stochastic.k.toFixed(2)}, D: ${stochastic.d.toFixed(2)}</span></div>
                <div><strong>ROC:</strong> <span style="color: ${rocColor}">${rocValue.toFixed(2)}</span></div>
                <div><strong>AO:</strong> <span style="color: ${aoColor}">${awesomeOsc.toFixed(5)}</span></div>
                <div><strong>Trend:</strong> <span style="color: ${trendColor}">${trend}</span></div>
                <div><strong>Pattern:</strong> <span style="color: ${patternColor}">${priceAction.pattern}</span></div>
                <div><strong>MTF:</strong> <span style="color: ${mtfColor}">${mtfSignal}</span></div>
            </div>
        </div>
    `;
}

// Add this function to update the header panel with more information
function updateHeaderPanel() {
    const symbolElement = document.getElementById('trading-symbol');
    const balanceElement = document.getElementById('balance');
    const modeElement = document.getElementById('trading-mode');
    const timeElement = document.getElementById('time');
    
    if (!symbolElement || !balanceElement || !modeElement) return;
    
    // Update trading symbol with additional market data if available
    if (window.globalPrice) {
        const priceChangeColor = window.priceDirection === 'up' ? '#00c800' : 
                                window.priceDirection === 'down' ? '#ff3a3a' : '#ffffff';
        
        // Format the price with appropriate decimal places based on value
        const formattedPrice = window.globalPrice < 1 ? 
            window.globalPrice.toFixed(5) : 
            window.globalPrice.toFixed(2);
        
        symbolElement.innerHTML = `${state.symbolName} <span style="color: ${priceChangeColor}; font-weight: bold;">${formattedPrice}</span>`;
    }
    
    // Update balance with current account value
    if (window.currentBalance) {
        const formattedBalance = window.currentBalance.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        balanceElement.innerHTML = formattedBalance;
    }
    
    // Update time display
    if (timeElement) {
        const now = new Date();
        timeElement.innerHTML = now.toLocaleTimeString();
    }
    
    // Update support/resistance levels if available
    const supportElement = document.getElementById('support-level');
    const resistanceElement = document.getElementById('resistance-level');
    
    if (supportElement && resistanceElement && window.supportResistance) {
        if (window.supportResistance.support) {
            const formattedSupport = window.supportResistance.support < 1 ? 
                window.supportResistance.support.toFixed(5) : 
                window.supportResistance.support.toFixed(2);
            supportElement.innerHTML = formattedSupport;
        }
        
        if (window.supportResistance.resistance) {
            const formattedResistance = window.supportResistance.resistance < 1 ? 
                window.supportResistance.resistance.toFixed(5) : 
                window.supportResistance.resistance.toFixed(2);
            resistanceElement.innerHTML = formattedResistance;
        }
    }
}
addUI();
setInterval(queryPrice, 100);

// Add a UI control for sensitivity
function addSensitivityControl() {
    const controlDiv = document.createElement('div');
    controlDiv.style.marginTop = '15px';
    controlDiv.style.marginBottom = '15px';
    controlDiv.innerHTML = `
        <div style="margin-bottom: 10px;">
            <label for="sensitivity-slider">Signal Sensitivity: <span id="sensitivity-value">${state.signalSensitivity}</span></label>
            <input type="range" id="sensitivity-slider" min="1" max="10" value="${state.signalSensitivity}" style="width: 200px;">
        </div>
        <div>
            <label for="auto-trading-toggle">Auto Trading: </label>
            <input type="checkbox" id="auto-trading-toggle" ${state.autoTradingEnabled ? 'checked' : ''}>
        </div>
    `;
    
    // Insert before the graphs div
    const graphsDiv = document.getElementById('graphs');
    graphsDiv.parentNode.insertBefore(controlDiv, graphsDiv);
    
    // Add event listeners
    document.getElementById('sensitivity-slider').addEventListener('input', function(e) {
        state.signalSensitivity = parseInt(e.target.value);
        document.getElementById('sensitivity-value').textContent = state.signalSensitivity;
        logDebug(`Signal sensitivity set to: ${state.signalSensitivity}`);
    });

    document.getElementById('auto-trading-toggle').addEventListener('change', function(e) {
        state.autoTradingEnabled = e.target.checked;
        logDebug(`Auto trading ${state.autoTradingEnabled ? 'enabled' : 'disabled'}`);
    });
}

let averageInArray = array => array.reduce((a, b) => a + b) / array.length;

function visualizeCloseValues(arr1, arr2, maxTransform = 100) {
    let samples = Math.min(20, arr1.length, arr2.length);
    
    let min = arr1[arr1.length - 1];
    let max = arr1[arr1.length - 1];
    for (let i = 1; i <= samples; i++) {
        min = Math.min(min, arr1[arr1.length - i], arr2[arr1.length - i]);
        max = Math.max(max, arr1[arr1.length - i], arr2[arr1.length - i]);
    }
    
    let transformCount = Math.min(maxTransform, arr1.length, arr2.length);
    let outArr1 = new Array(transformCount);
    let outArr2 = new Array(transformCount);
    for (let i = 1; i <= transformCount; i++) {
        outArr1[transformCount - i] = (arr1[transformCount - i] - min) / (max - min);
        outArr2[transformCount - i] = (arr2[transformCount - i] - min) / (max - min);
    }

    return {
        arr1: outArr1,
        arr2: outArr2,
    };
}
function updateIndicatorDisplay(insufficientData, indicators) {
    // Create or update the indicator panels
    if (!document.getElementById('price-indicators')) {
        createIndicatorPanels();
    }
    
    if (insufficientData) {
        document.getElementById('ema-value').innerHTML = 'N/A';
        document.getElementById('macd-value').innerHTML = 'N/A';
        document.getElementById('roc-value').innerHTML = 'N/A';
        document.getElementById('sar-value').innerHTML = 'N/A';
        document.getElementById('pattern-value').innerHTML = 'Waiting for data...';
        document.getElementById('candle-count').innerHTML = '0 (1m)';
        return;
    }
    
    const {
        shortEMA,
        longEMA,
        emaDifference,
        rsiValue,
        macdData,
        rocValue,
        parabolicSAR,
        priceAction,
        candlePrices,
        currentTime
    } = indicators;
    
    // Update EMA display
    const emaElement = document.getElementById('ema-value');
    if (emaElement) {
        emaElement.innerHTML = `${shortEMA.toFixed(5)} / ${longEMA.toFixed(5)}`;
        emaElement.style.color = emaDifference > 0 ? '#00c800' : emaDifference < 0 ? '#ff3a3a' : '#ffffff';
    }
    
    // Update MACD display
    const macdElement = document.getElementById('macd-value');
    if (macdElement && macdData) {
        macdElement.innerHTML = macdData.histogram ? macdData.histogram.toFixed(5) : 'N/A';
        macdElement.style.color = macdData.histogram > 0 ? '#00c800' : macdData.histogram < 0 ? '#ff3a3a' : '#ffffff';
    }
    
    // Update ROC display
    const rocElement = document.getElementById('roc-value');
    if (rocElement) {
        rocElement.innerHTML = rocValue ? rocValue.toFixed(4) + '%' : 'N/A';
        rocElement.style.color = rocValue > 0 ? '#00c800' : rocValue < 0 ? '#ff3a3a' : '#ffffff';
    }
    
    // Update SAR display
    const sarElement = document.getElementById('sar-value');
    if (sarElement && parabolicSAR) {
        sarElement.innerHTML = parabolicSAR.isUpTrend ? 'UP' : 'DOWN';
        sarElement.style.color = parabolicSAR.isUpTrend ? '#00c800' : '#ff3a3a';
    }
    
    // Update Pattern display
    const patternElement = document.getElementById('pattern-value');
    if (patternElement && priceAction) {
        patternElement.innerHTML = priceAction.pattern || 'neutral';
        if (priceAction.pattern.includes('bullish')) {
            patternElement.style.color = '#00c800';
        } else if (priceAction.pattern.includes('bearish')) {
            patternElement.style.color = '#ff3a3a';
        } else {
            patternElement.style.color = '#ffffff';
        }
    }
    
    // Update candle count
    const candleCountElement = document.getElementById('candle-count');
    if (candleCountElement) {
        candleCountElement.innerHTML = `${candlePrices.length} (1m)`;
    }

    // Update next candle timer
    const nextCandleElement = document.getElementById('next-candle');
    if (nextCandleElement) {
        const timeUntilNextCandle = state.candleInterval - (currentTime - state.lastCandleTime);
        nextCandleElement.innerHTML = `${Math.round(timeUntilNextCandle/1000)}s`;
    }
}

function createIndicatorPanels() {
    const container = document.getElementById('graphs') || document.body;
    
    // Create Price Indicators Panel
    const pricePanel = document.createElement('div');
    pricePanel.id = 'price-indicators';
    pricePanel.className = 'indicator-panel';
    pricePanel.innerHTML = `
        <h3>Price Indicators</h3>
        <div class="indicator-row">
            <span class="indicator-label">EMA:</span>
            <span id="ema-value" class="indicator-value">N/A</span>
        </div>
        <div class="indicator-row">
            <span class="indicator-label">MACD:</span>
            <span id="macd-value" class="indicator-value">N/A</span>
        </div>
    `;
    
    // Create Momentum & Trend Panel
    const momentumPanel = document.createElement('div');
    momentumPanel.id = 'momentum-trend';
    momentumPanel.className = 'indicator-panel';
    momentumPanel.innerHTML = `
        <h3>Momentum & Trend</h3>
        <div class="indicator-row">
            <span class="indicator-label">ROC:</span>
            <span id="roc-value" class="indicator-value">N/A</span>
        </div>
        <div class="indicator-row">
            <span class="indicator-label">SAR:</span>
            <span id="sar-value" class="indicator-value">N/A</span>
        </div>
    `;
    
    // Create Pattern & Analysis Panel
    const patternPanel = document.createElement('div');
    patternPanel.id = 'pattern-analysis';
    patternPanel.className = 'indicator-panel';
    patternPanel.innerHTML = `
        <h3>Pattern & Analysis</h3>
        <div class="indicator-row">
            <span class="indicator-label">Pattern:</span>
            <span id="pattern-value" class="indicator-value">neutral</span>
        </div>
    `;
    
    // Create Candle Data Panel
    const candlePanel = document.createElement('div');
    candlePanel.id = 'candle-data';
    candlePanel.className = 'indicator-panel';
    candlePanel.innerHTML = `
        <h3>Candle Data</h3>
        <div class="indicator-row">
            <span class="indicator-label">Candles:</span>
            <span id="candle-count" class="indicator-value">0 (1m)</span>
        </div>
        <div class="indicator-row">
            <span class="indicator-label">Next Candle:</span>
            <span id="next-candle" class="indicator-value">60s</span>
        </div>
    `;
    
    // Add CSS for the panels
    const style = document.createElement('style');
    style.textContent = `
        .indicator-panel {
            background-color: rgba(30, 30, 30, 0.8);
            border-radius: 5px;
            padding: 5px;
        }
        .indicator-panel h3 {
            margin-top: 0;
            margin-bottom: 10px;
            font-size: 14px;
            color: #aaa;
        }
        .indicator-row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
        }
        .indicator-label {
            color: #aaa;
        }
        .indicator-value {
            font-weight: bold;
        }
    `;
    
    document.head.appendChild(style);
    
    // Append all panels to the container
    container.appendChild(pricePanel);
    container.appendChild(momentumPanel);
    container.appendChild(patternPanel);
    container.appendChild(candlePanel);
}

var styles = `
    .sqz-bar { 
        width: 6px;
        background-color: #ccc;
        display: inline-block;
        margin: 10px 20px 0 40px;
        position: absolute;
        bottom: 80px;
    }
    .sqz-dot { 
        width: 6px;
        height: 6px;
        background-color: #ccc;
        display: inline-block;
        margin: 10px 20px 0 40px;
        position: absolute;
        bottom: 80px;
    }
    .max-cycle {
        text-align: center;
        position: relative;
        bottom: 1px;
        font-size: 12px;
        background: #3b3b3b;
        padding: 2px 5px;
        border-radius: 3px;
    }
    .mesa-bar {
        width: 360px;
        height: 2px;
        background-color: #ccc;
        display: inline-block;
        margin: 10px 20px;
        position: absolute;
        bottom: 80px;
    }
    #mama-bar {
        background-color: #7344A6;
    }
    #fama-bar {
        background-color: #E1A971;
    }
    span {
        padding: 5px 10px;
        display: inline-block;
        border-radius: 3px;
    }

`

var styleSheet = document.createElement("style");
styleSheet.textContent = styles;
document.head.appendChild(styleSheet);

function logTradeToGoogleSheets(appversion, symbolName, openTime, betTime, openPrice, closePrice, betAmount, betStatus, betProfit) {

    const data = { appversion, reverse, symbolName, openTime, betTime, openPrice, closePrice, betAmount, betStatus, betProfit };
  
    fetch(webhookUrl, {
    method: 'POST',
    mode: 'no-cors', // This will bypass CORS, but with limitations
    body: JSON.stringify(data),
    headers: {
        'Content-Type': 'application/json'
    }
    })
    .then(res => res.text())
    .then(response => {
    })
    .catch(err => {
    console.error('Error logging trade:', err);
    });
  }

// Add a function to detect support and resistance levels
function detectSupportResistance(prices, lookback = 50, threshold = 0.0005) {
    if (prices.length < lookback) {
        return { support: 0, resistance: 0 };
    }
    
    const recentPrices = prices.slice(-lookback);
    const currentPrice = prices[prices.length - 1];
    
    // Find local minima and maxima
    const localMinima = [];
    const localMaxima = [];
    
    for (let i = 1; i < recentPrices.length - 1; i++) {
        if (recentPrices[i] < recentPrices[i-1] && recentPrices[i] < recentPrices[i+1]) {
            localMinima.push(recentPrices[i]);
        }
        if (recentPrices[i] > recentPrices[i-1] && recentPrices[i] > recentPrices[i+1]) {
            localMaxima.push(recentPrices[i]);
        }
    }
    
    // Find closest support and resistance
    let closestSupport = 0;
    let closestResistance = Infinity;
    
    for (const min of localMinima) {
        if (min < currentPrice && min > closestSupport) {
            closestSupport = min;
        }
    }
    
    for (const max of localMaxima) {
        if (max > currentPrice && max < closestResistance) {
            closestResistance = max;
        }
    }
    
    // If no support/resistance found, use simple percentage
    if (closestSupport === 0) {
        closestSupport = currentPrice * (1 - threshold);
    }
    
    if (closestResistance === Infinity) {
        closestResistance = currentPrice * (1 + threshold);
    }
    
    return { support: closestSupport, resistance: closestResistance };
}

// Add a function to detect price momentum
function calculateMomentum(prices, period = 10) {
    if (prices.length < period + 1) {
        return 0;
    }
    
    // Calculate momentum as the rate of change
    const currentPrice = prices[prices.length - 1];
    const pastPrice = prices[prices.length - 1 - period];
    
    return ((currentPrice - pastPrice) / pastPrice) * 100;
}

// Add a function to detect divergence between price and RSI
function detectDivergence(prices, rsiValues, lookbackPeriod = 5) {
    if (prices.length < lookbackPeriod || rsiValues.length < lookbackPeriod) {
        return 'none';
    }
    
    const recentPrices = prices.slice(-lookbackPeriod);
    const recentRSI = rsiValues.slice(-lookbackPeriod);
    
    const priceDirection = recentPrices[recentPrices.length - 1] > recentPrices[0] ? 'up' : 'down';
    const rsiDirection = recentRSI[recentRSI.length - 1] > recentRSI[0] ? 'up' : 'down';
    
    if (priceDirection === 'up' && rsiDirection === 'down') {
        return 'bearish'; // Price up, RSI down - bearish divergence
    } else if (priceDirection === 'down' && rsiDirection === 'up') {
        return 'bullish'; // Price down, RSI up - bullish divergence
    }
    
    return 'none';
}

// Add a function to calculate Bollinger Bands
// Add this function to calculate Bollinger Bands
function calculateBollingerBands(prices, period = 20, stdDevMultiplier = 2) {
    if (prices.length < period) {
        return { upper: 0, middle: 0, lower: 0 };
    }
    
    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((sum, price) => sum + price, 0) / period;
    
    // Calculate standard deviation
    const variance = recentPrices.reduce((sum, price) => {
        return sum + Math.pow(price - sma, 2);
    }, 0) / period;
    
    const stdDev = Math.sqrt(variance);
    
    return {
        upper: sma + (stdDevMultiplier * stdDev),
        middle: sma,
        lower: sma - (stdDevMultiplier * stdDev)
    };
}

// Add this function to calculate MACD
function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (prices.length < slowPeriod + signalPeriod) {
        return { macd: 0, signal: 0, histogram: 0 };
    }
    
    // Calculate EMAs
    const fastEMA = Indicators.calculateEMA(prices, fastPeriod);
    const slowEMA = Indicators.calculateEMA(prices, slowPeriod);
    
    // Calculate MACD line
    const macdLine = fastEMA - slowEMA;
    
    // Calculate signal line (EMA of MACD line)
    // For simplicity, we'll use the current MACD value
    // In a full implementation, you'd calculate EMA of MACD values
    const signalLine = macdLine * 0.9; // Simplified for this example
    
    // Calculate histogram
    const histogram = macdLine - signalLine;
    
    return {
        macd: macdLine,
        signal: signalLine,
        histogram: histogram
    };
}

// Add a function to calculate Stochastic Oscillator
function calculateStochastic(prices, period = 14, smoothK = 3, smoothD = 3) {
    if (prices.length < period) {
        return {
            k: 50,
            d: 50,
            k_prev: 50
        };
    }
    
    // Get the recent prices for calculation
    const recentPrices = prices.slice(-period);
    const currentPrice = prices[prices.length - 1];
    
    // Find highest high and lowest low in the period
    const highestHigh = Math.max(...recentPrices);
    const lowestLow = Math.min(...recentPrices);
    
    // Calculate %K
    let rawK;
    if (highestHigh === lowestLow) {
        rawK = 50; // Avoid division by zero
    } else {
        rawK = ((currentPrice - lowestLow) / (highestHigh - lowestLow)) * 100;
    }
    
    // For simplicity, we'll use the raw %K as smoothed %K
    // In a full implementation, you'd smooth this over smoothK periods
    const k = rawK;
    
    // Calculate %D as SMA of %K
    // For simplicity, we'll use current %K value
    // In a full implementation, you'd average %K values over smoothD periods
    const d = k;
    
    // Store previous K value for crossover detection
    const k_prev = window.previousStochK || k;
    window.previousStochK = k;
    
    return {
        k: k,
        d: d,
        k_prev: k_prev
    };
}

})();

