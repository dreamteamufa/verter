const appversion = "Verter ver. 2.0";
const reverse = false; // Change to true for reverse mode
// const webhookUrl = 'https://script.google.com/macros/s/AKfycbyz--BcEvGJq05MN5m9a6uGiUUhYe8WrpxOKMWE6qstfj15j9L8ahnK7DaVWaSbPAPG/exec'; //A1
const webhookUrl = 'https://script.google.com/macros/s/AKfycbzNXxnYo6Dg31LIZmo3bqLHIjox-EjIu2M9sX8Lli3-JlHREKGwxwc1ly7EgenJ-Ayw/exec'; //M2
// const webhookUrl = 'https://script.google.com/macros/s/AKfycbyg_EJGKWqDAVhQDam8UKOt9wD7T8PXoBevnwcShqMo7cWLysV-tPfPyrchZIm52r-a/exec'; //O3

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

// Fix the candle formation and indicator calculation

// Initialize the lastCandleTime when the script starts
let priceBuffer = [];
let candlePrices = [];
let candleInterval = 60000; // 1 minute in milliseconds
let lastCandleTime = Date.now();

let time = Date.now();
let hTime = humanTime(time);
let startTime = hTime;

let maxStepInCycle = 0;

// const mode = 'REAL';
const mode = 'DEMO';

let cyclesToPlay = 30;
let cyclesStats = [];

let tradingAllowed = true;

const limitWin1 = 50;
const limitLoss1 = -50;
 
const limitWin2 = 100;
const limitLoss2 = -100;
 
const limitWin3 = 150;
const limitLoss3 = -150;
 
let limitWin = limitWin1;
let limitLoss = limitLoss1;

// Add these variables near the top of your file with other global variables
let isTradeOpen = false; // Track if a trade is currently open
let currentBetStep = 0; // Track the current step in the bet array


// create an observer instance
let targetDiv = document.getElementsByClassName("scrollbar-container deals-list ps")[0];
let observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {

        let newDeal = mutation.addedNodes[0];

        // console.log('mutation: ',mutation,' NewDeal: ',newDeal);

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
        if (betHistory.length > 0) {
            betHistory[betHistory.length - 1].won = tradeStatus;
            betHistory[betHistory.length - 1].profit = betProfit;
        }

        // Mark that the trade is now closed
        isTradeOpen = false;

        // Update bet step based on trade outcome
        if (tradeStatus === 'won') {
            // Reset to first step on win
            currentBetStep = 0;
        } else if (tradeStatus === 'lost') {
            // Increase bet step on loss, but don't exceed array length
            currentBetStep = Math.min(currentBetStep + 1, betArray.length - 1);
        }
        // For 'returned' status, keep the same bet step

        symbolName = symbolDiv.textContent.replace("/", " ");
        tradingSymbolDiv.innerHTML = symbolName;
        betTime = betTimeDiv.textContent;
        let timeParts = betTime.split(':');
        let seconds = parseInt(timeParts[0]) * 3600 + parseInt(timeParts[1]) * 60 + parseInt(timeParts[2]);

        let totalBalance = prevBalance + betProfit;

        // logTradeToGoogleSheets(appversion, symbolName, openTime, betTime, openPrice, closePrice, betAmount, betStatus, betProfit);
        logTradeToGoogleSheets(
            appversion,
            symbolName,
            betHistory[betHistory.length - 1].time,
            seconds,
            betHistory[betHistory.length - 1].openPrice,
            globalPrice,
            betHistory[betHistory.length - 1].betValue,
            tradeStatus,
            betProfit,
            totalBalance
        );

        // console.log('Bet status: ',tradeStatus);

    });
});
// configuration of the observer:
let config = { attributes: false, childList: true, characterData: false };
// pass in the target node, as well as the observer options
observer.observe(targetDiv, config);
// later, you can stop observing
// observer.disconnect();
 
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

let betArray = betArray1;
let betHistory = [];
let priceHistory = [];
let currentBalance;
let currentProfit = 0;
let profitDiv;
let signalDiv;
let profitPercentDivAdvisor;
let timeDiv;
let wonDiv;
let wagerDiv;
let tradingSymbolDiv;
let totalWager = 0;
let historyDiv;
let cyclesDiv;
let cyclesHistoryDiv;
let totalProfitDiv;
let historyBetDiv;
let sqzDiv;
let trendDiv;
let globalTrendDiv;
let tradeDirectionDiv;
let globalPrice;
let updateStartPrice = false;
let firstTradeBlock = false;
let targetElement2;
let graphContainer;
let mamaBar;
let famaBar;
let balanceDiv;
let lastPrice;

const percentProfitDiv = document.getElementsByClassName("value__val-start")[0];
if (mode == 'REAL'){
    balanceDiv = document.getElementsByClassName("js-hd js-balance-real-USD")[0];
} else {
    balanceDiv = document.getElementsByClassName("js-hd js-balance-demo")[0];
}

const symbolDiv = document.getElementsByClassName("current-symbol")[0];
let symbolName = symbolDiv.textContent.replace("/", " ");

const betTimeDiv = document.getElementsByClassName("value__val")[0];
let betTime = betTimeDiv.textContent;

let priceString = balanceDiv.innerHTML;
priceString = priceString.split(',').join('');

let startBalance = parseFloat(priceString);
let prevBalance = startBalance;
console.log('Start Balance: ',startBalance);

const redColor = '#B90000';
const greenColor = '#009500';

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

const targetElem = document.getElementsByClassName("tooltip-text");
const textToSearch = "Winnings amount you receive";
for (i = 0; i< targetElem.length;i++){
    let textContent = targetElem[i].textContent || targetElem[i].innerText;
    if (textContent.includes(textToSearch)){
        targetElement2 = document.getElementsByClassName("tooltip-text")[i];
    }
}
const buyButton = document.getElementsByClassName("btn btn-call")[0];
let text = targetElement2.innerHTML;
let startPrice = parseFloat(text.match(/\d+.\d+(?=\ a)/g)[0]);
priceHistory.push(startPrice);
console.log('Start Price: ',startPrice);

let lastMin = startPrice;
let lastMax = startPrice;
let multiplyFactorMesa = 100 / startPrice;
let multiplyFactorSqzMom = 50 / startPrice;

let betInput = document.getElementsByClassName("call-put-block__in")[0].querySelector("input");
let betDivContent = document.getElementsByClassName("call-put-block__in")[0].querySelector("input").value;
let betValue = parseFloat(betDivContent);

let maxStepDiv;

let buy = () => document.dispatchEvent(new KeyboardEvent('keyup', {keyCode: 87, shiftKey: true}));
let sell = () => document.dispatchEvent(new KeyboardEvent('keyup', {keyCode: 83, shiftKey: true}));
let decreaseBet = () => document.dispatchEvent(new KeyboardEvent('keyup', {keyCode: 65, shiftKey: true}));
let increaseBet = () => document.dispatchEvent(new KeyboardEvent('keyup', {keyCode: 68, shiftKey: true}));
let setValue = v => document.getElementsByClassName("call-put-block__in")[0].querySelector("input").value = v; // todo: after that press ENTER event?

let updateMinMax = () => {
    if (globalPrice > lastMax) {
        lastMax = globalPrice;
    }
    if (globalPrice < lastMin) {
        lastMin = globalPrice;
    }
}

let lastTradeTime = 0;
let minTimeBetweenTrades = 5000; // 5 seconds minimum between trades
let lastSignalCheck = 0;
let signalCheckInterval = 1000; // Check for trading signals every 1 second

let queryPrice = () => {
    time = Date.now();
    hTime = humanTime(time);
    timeDiv.innerHTML = hTime;
    
    // Get the current price
    text = targetElement2.innerHTML;
    let priceMatch = text.match(/\d+.\d+(?=\ a)/g);
    
    if (priceMatch && priceMatch[0]) {
        globalPrice = parseFloat(priceMatch[0]);
        
        // Only add to price history if it's a new price
        if (globalPrice !== priceHistory[priceHistory.length - 1]) {
            priceHistory.push(globalPrice);
            
            // Keep priceHistory at a reasonable size (last 500 data points)
            if (priceHistory.length > 500) {
                priceHistory.shift();
            }
            
            // Update last price
            lastPrice = globalPrice;
            
            // Update min/max
            updateMinMax();
        }
        
        // Calculate indicators with the updated price history
        calculateIndicators();
    }
    
    // Update balance and profit
    priceString = balanceDiv.innerHTML;
    priceString = priceString.split(',').join('');
    currentBalance = parseFloat(priceString);
    currentProfit = currentBalance - startBalance;
    currentProfit = Math.round(currentProfit * 100) / 100;
    
    profitDiv.innerHTML = currentProfit;
    
    if (currentProfit < 0) {
        profitDiv.style.background = redColor;
    } else if (currentProfit > 0) {
        profitDiv.style.background = greenColor;
    } else {
        profitDiv.style.background = 'inherit';
    }
    
    // Only check for trading signals at specified intervals
    // This prevents excessive trading while maintaining up-to-date indicators
    if (time - lastSignalCheck >= signalCheckInterval) {
        lastSignalCheck = time;
        
        // Only consider trading if enough time has passed since last trade
        if (time - lastTradeTime >= minTimeBetweenTrades) {
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

// Add Rate of Change (ROC)
function calculateROC(prices, period = 12) {
    if (prices.length < period + 1) return 0;
    
    const currentPrice = prices[prices.length - 1];
    const pastPrice = prices[prices.length - 1 - period];
    
    return ((currentPrice - pastPrice) / pastPrice) * 100;
}

// Add Awesome Oscillator (price-based momentum)
function calculateAwesomeOscillator(prices) {
    if (prices.length < 34) return 0;
    
    // Calculate 5-period and 34-period simple moving averages
    const sma5 = calculateSMA(prices, 5);
    const sma34 = calculateSMA(prices, 34);
    
    return sma5 - sma34;
}

// Add Simple Moving Average helper
function calculateSMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];
    
    const recentPrices = prices.slice(-period);
    return recentPrices.reduce((sum, price) => sum + price, 0) / period;
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
let priceHistory5m = [];
let priceHistory15m = [];
let lastUpdate5m = 0;
let lastUpdate15m = 0;

function updateMultiTimeframe(currentPrice, currentTime) {
    // 5-minute timeframe
    if (currentTime - lastUpdate5m >= 300000) { // 5 minutes
        priceHistory5m.push(currentPrice);
        if (priceHistory5m.length > 50) priceHistory5m.shift();
        lastUpdate5m = currentTime;
    }
    
    // 15-minute timeframe
    if (currentTime - lastUpdate15m >= 900000) { // 15 minutes
        priceHistory15m.push(currentPrice);
        if (priceHistory15m.length > 30) priceHistory15m.shift();
        lastUpdate15m = currentTime;
    }
}

function getMultiTimeframeSignal() {
    if (priceHistory5m.length < 10 || priceHistory15m.length < 5) {
        return 'insufficient_data';
    }
    
    // Get signals from different timeframes
    const trend1m = detectTrend(priceHistory, 10);
    const trend5m = detectTrend(priceHistory5m, 8);
    const trend15m = detectTrend(priceHistory15m, 5);
    
    // Align signals
    const bullishTimeframes = [trend1m, trend5m, trend15m].filter(t => 
        t === 'up' || t === 'strong_up').length;
    const bearishTimeframes = [trend1m, trend5m, trend15m].filter(t => 
        t === 'down' || t === 'strong_down').length;
    
    if (bullishTimeframes >= 2) return 'buy';
    if (bearishTimeframes >= 2) return 'sell';
    return 'flat';
}

// Modify calculateIndicators to include these new indicators
function calculateIndicators() {
    const currentTime = Date.now();
    
    // Add price to buffer with timestamp
    if (globalPrice && globalPrice !== priceHistory[priceHistory.length - 1]) {
        priceBuffer.push({
            time: currentTime,
            price: globalPrice
        });
        
        // Keep buffer at a reasonable size
        if (priceBuffer.length > 500) {
            priceBuffer.shift();
        }
    }
    
    // Update multi-timeframe data
    if (globalPrice) {
        updateMultiTimeframe(globalPrice, currentTime);
    }
    
    // Check if we need to create a new candle
    if (currentTime - lastCandleTime >= candleInterval) {
        // If we have price data since the last candle
        if (priceBuffer.length > 0) {
            // Extract prices that belong to the completed candle
            const candlePricePoints = priceBuffer.filter(
                point => point.time >= lastCandleTime && point.time < currentTime
            );
            
            if (candlePricePoints.length > 0) {
                // Create a new candle using OHLC
                const open = candlePricePoints[0].price;
                const high = Math.max(...candlePricePoints.map(p => p.price));
                const low = Math.min(...candlePricePoints.map(p => p.price));
                const close = candlePricePoints[candlePricePoints.length - 1].price;
                
                // Add the close price to our candle prices array
                candlePrices.push(close);
                
                console.log(`New 1m candle formed: Open=${open}, High=${high}, Low=${low}, Close=${close}`);
                
                // Keep candlePrices at a reasonable size
                if (candlePrices.length > 50) {
                    candlePrices.shift();
                }
            }
        }
        
        lastCandleTime = currentTime;
    }
    
    // Use priceHistory for indicators if we don't have enough candles yet
    const dataForIndicators = priceHistory.length >= 20 ? priceHistory : [];
    
    if (dataForIndicators.length < 20) {
        window.currentSignal = 'flat';
        signalDiv.innerHTML = 'Insufficient Data';
        updateIndicatorDisplay(true); // Pass true to indicate insufficient data
        return;
    }
    
    // Calculate all indicators
    const shortEMA = calculateEMA(dataForIndicators, 9);
    const longEMA = calculateEMA(dataForIndicators, 21);
    const rsiValue = calculateRSI(dataForIndicators, 14);
    const macdData = calculateMACD(dataForIndicators);
    const bollingerBands = calculateBollingerBands(dataForIndicators);
    const stochastic = calculateStochastic(dataForIndicators);
    const rocValue = calculateROC(dataForIndicators, 12);
    const awesomeOsc = calculateAwesomeOscillator(dataForIndicators);
    const parabolicSAR = calculateParabolicSAR(dataForIndicators);
    
    // Price action analysis
    const priceAction = analyzePriceAction(dataForIndicators);
    const supportResistance = findSupportResistance(dataForIndicators);
    const trend = detectTrend(dataForIndicators);
    const fractals = findFractals(dataForIndicators);
    
    // Multi-timeframe signal
    const mtfSignal = getMultiTimeframeSignal();
    
    // Current price
    const currentPrice = dataForIndicators[dataForIndicators.length - 1];
    
    // Signal scoring system
    let bullishScore = 0;
    let bearishScore = 0;
    
    // EMA signals (weight: 2)
    const emaDifference = shortEMA - longEMA;
    const emaThreshold = 0.0001;
    if (emaDifference > emaThreshold) bullishScore += 2;
    else if (emaDifference < -emaThreshold) bearishScore += 2;
    
    // RSI signals (weight: 2)
    if (rsiValue < 30) bullishScore += 2;
    else if (rsiValue > 70) bearishScore += 2;
    else if (rsiValue < 40) bullishScore += 1;
    else if (rsiValue > 60) bearishScore += 1;
    
    // MACD signals (weight: 2)
    if (macdData.macd > macdData.signal && macdData.histogram > 0) bullishScore += 2;
    else if (macdData.macd < macdData.signal && macdData.histogram < 0) bearishScore += 2;
    
    // Bollinger Bands signals (weight: 1)
    if (currentPrice < bollingerBands.lower) bullishScore += 1;
    else if (currentPrice > bollingerBands.upper) bearishScore += 1;
    
    // Stochastic signals (weight: 1)
    if (stochastic.k < 20 && stochastic.d < 20) bullishScore += 1;
    else if (stochastic.k > 80 && stochastic.d > 80) bearishScore += 1;
    
    // Rate of Change signals (weight: 1)
    if (rocValue > 1) bullishScore += 1;
    else if (rocValue < -1) bearishScore += 1;
    
    // Awesome Oscillator signals (weight: 1)
    if (awesomeOsc > 0) bullishScore += 1;
    else if (awesomeOsc < 0) bearishScore += 1;
    
    // Parabolic SAR signals (weight: 1)
    if (parabolicSAR.isUpTrend) bullishScore += 1;
    else if (!parabolicSAR.isUpTrend) bearishScore += 1;
    
    // Trend signals (weight: 2)
    if (trend === 'strong_up') bullishScore += 2;
    else if (trend === 'up') bullishScore += 1;
    else if (trend === 'strong_down') bearishScore += 2;
    else if (trend === 'down') bearishScore += 1;
    
    // Price action signals (weight: 1)
    if (priceAction.pattern.includes('bullish')) {
        bullishScore += 1;
    } else if (priceAction.pattern.includes('bearish')) {
        bearishScore += 1;
    }
    
    // Support/Resistance signals (weight: 1)
    if (supportResistance.nearSupport) bullishScore += 1;
    else if (supportResistance.nearResistance) bearishScore += 1;
    
    // Multi-timeframe signals (weight: 3)
    if (mtfSignal === 'buy') bullishScore += 3;
    else if (mtfSignal === 'sell') bearishScore += 3;
    
    // Determine final signal
    let signal = 'flat';
    const scoreDifference = Math.abs(bullishScore - bearishScore);
    const minScoreThreshold = 5; // Minimum score needed to generate a signal
    
    if (bullishScore > bearishScore && bullishScore >= minScoreThreshold && scoreDifference >= 3) {
        signal = 'buy';
    } else if (bearishScore > bullishScore && bearishScore >= minScoreThreshold && scoreDifference >= 3) {
        signal = 'sell';
    }
    
    // Avoid trading during consolidation
    if (priceAction.isConsolidating) {
        signal = 'flat';
    }
    
    // Update UI with indicator values
    signalDiv.innerHTML = `${signal.toUpperCase()} (B:${bullishScore} vs S:${bearishScore})`;
    signalDiv.style.backgroundColor = signal === 'buy' ? greenColor : (signal === 'sell' ? redColor : '#333');
    
    // Store the current signal and indicators in global variables for tradeLogic to use
    window.currentSignal = signal;
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
    
    // Update the indicator display
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
        candlePrices,
        currentTime
    });
    
    console.log(`Signal: ${signal}, Bullish Score: ${bullishScore}, Bearish Score: ${bearishScore}, Trend: ${trend}, Pattern: ${priceAction.pattern}`);
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

// Add the missing EMA calculation function
function calculateEMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1];
    
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
    
    for (let i = period; i < prices.length; i++) {
        ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }
    
    return ema;
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

// Helper function to calculate volatility
function calculateVolatility(prices) {
    if (prices.length < 10) return 0;
    
    const recent = prices.slice(-10);
    const mean = recent.reduce((sum, price) => sum + price, 0) / recent.length;
    
    // Calculate standard deviation
    const variance = recent.reduce((sum, price) => {
        return sum + Math.pow(price - mean, 2);
    }, 0) / recent.length;
    
    const stdDev = Math.sqrt(variance);
    
    // Return as percentage of mean price
    return stdDev / mean;
}

// Enhanced EMA calculation with validation
function calculateEMA(prices, period) {
    if (!prices || prices.length === 0) return 0;
    if (prices.length < period) return prices[prices.length - 1];
    
    const multiplier = 2 / (period + 1);
    let ema = prices[0];
    
    for (let i = 1; i < prices.length; i++) {
        ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }
    
    return ema;
}

// Enhanced RSI calculation
function calculateRSI(prices, period = 14) {
    if (!prices || prices.length < period + 1) return 50;
    
    let gains = 0;
    let losses = 0;
    
    // Calculate initial average gain and loss
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
    
    // Calculate RSI for remaining periods
    for (let i = period + 1; i < prices.length; i++) {
        const change = prices[i] - prices[i - 1];
        const gain = change > 0 ? change : 0;
        const loss = change < 0 ? Math.abs(change) : 0;
        
        avgGain = ((avgGain * (period - 1)) + gain) / period;
        avgLoss = ((avgLoss * (period - 1)) + loss) / period;
    }
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return rsi;
}
// Update the debug function to include candle information
function debugTradeStatus() {
    const time = Date.now();
    const timeSinceLastTrade = time - lastTradeTime;
    const timeSinceLastSignalCheck = time - lastSignalCheck;
    
    console.log(`Debug Trade Status:
    - Current Signal: ${window.currentSignal || 'undefined'}
    - EMA Signal: ${window.emaSignal || 'undefined'}
    - RSI Signal: ${window.rsiSignal || 'undefined'}
    - Stochastic Signal: ${window.stochSignal || 'undefined'}
    - Time since last trade: ${timeSinceLastTrade}ms (min required: ${minTimeBetweenTrades}ms)
    - Time since last signal check: ${timeSinceLastSignalCheck}ms (check interval: ${signalCheckInterval}ms)
    - EMA Difference: ${window.emaDifference ? window.emaDifference.toFixed(5) : 'undefined'}
    - RSI Value: ${window.currentRSI ? window.currentRSI.toFixed(2) : 'undefined'}
    - Stochastic Values: %K=${window.stochK ? window.stochK.toFixed(2) : 'undefined'}, %D=${window.stochD ? window.stochD.toFixed(2) : 'undefined'}
    - Candle Progress: ${window.candleProgress || 0}% (${Math.round(window.timeUntilNextCandle/1000) || 0}s until next candle)
    - Candle Count: ${candlePrices.length}
    - Cycles to Play: ${cyclesToPlay}
    - Current Profit: ${currentProfit}
    - Current Profit %: ${currentProfitPercent || 'undefined'}
    `);
}

/// Modify the tradeLogic function to use the sensitivity parameter
function tradeLogic() {
    let tradeDirection;
    let currentTrade = {};

    let time = Date.now();
    let hTime = humanTime(time);

    // Initialize default values
    let prevBetStep = 0;
    let currentBetStep = 0;
    let tradeStatus = 'won'; // Default status for first trade
    
    // Define these variables that were previously undefined
    let globalTrend = 'flat';
    let priceTrend = 'flat';
    
    // Only try to access betHistory if it has elements
    if (betHistory.length > 0) {
        prevBetStep = betHistory.slice(-1)[0].step;
        
        // Check if we have trade status information
        if (betHistory.slice(-1)[0].won) {
            tradeStatus = betHistory.slice(-1)[0].won;
        }
    }

    if (tradeStatus === 'won') {
        currentBetStep = 0;
    } else if (tradeStatus === 'lost') {
        if (prevBetStep < betArray.length-1) {
            currentBetStep = prevBetStep + 1; 
        } else {
            currentBetStep = 0;
        }
    } else if (tradeStatus === 'returned') {
        currentBetStep = prevBetStep;
    }

    if (betHistory.length < 3){
        currentBetStep = 0;
    }

    // Use the pre-calculated signal from calculateIndicators
    let signal = window.currentSignal || 'flat';
    
    // Get the score difference from the indicators
    const bullishScore = window.bullishScore || 0;
    const bearishScore = window.bearishScore || 0;
    const scoreDifference = Math.abs(bullishScore - bearishScore);
    
    // Apply sensitivity adjustment - higher sensitivity means we need less score difference to trade
    const adjustedThreshold = 11 - signalSensitivity; // Inverted scale: 1 is most sensitive (threshold=10), 10 is least (threshold=1)
    
    // Determine trade direction based on scores and sensitivity
    if (bullishScore > bearishScore && scoreDifference >= adjustedThreshold) {
        tradeDirection = !reverse ? 'buy' : 'sell';
        tradeDirectionDiv.style.background = '#009500'; // Green
    } else if (bearishScore > bullishScore && scoreDifference >= adjustedThreshold) {
        tradeDirection = !reverse ? 'sell' : 'buy';
        tradeDirectionDiv.style.background = '#B90000'; // Red
    } else {
        tradeDirection = 'flat';
        tradeDirectionDiv.style.background = '#555555'; // Gray
    }

    tradeDirectionDiv.innerHTML = `${tradeDirection} (${scoreDifference}/${adjustedThreshold})`;

    // Check profit limits
    if (currentProfit > limitWin){
        limitWin = limitWin1;
        limitLoss = limitLoss1;
        betArray = betArray1;
        let newDiv = winCycle.cloneNode();
        newDiv.style.height = '30px';
        newDiv.innerHTML = currentProfit;
        newDiv.innerHTML += '<div class="max-cycle">'+maxStepInCycle+'</div>';
        cyclesHistoryDiv.appendChild(newDiv);
        resetCycle('win');
    } else if (currentProfit - betValue < limitLoss) {
        if (limitWin == limitWin1){
            limitWin = limitWin2;
            limitLoss = limitLoss2;
            betArray = betArray2;
        } else if (limitWin == limitWin2){
            limitWin = limitWin3;
            limitLoss = limitLoss3;
            betArray = betArray3;
        } else {
            limitWin = limitWin1;
            limitLoss = limitLoss1;
            betArray = betArray1;
        }
        let newDiv = loseCycle.cloneNode();
        newDiv.style.height = '30px';
        newDiv.innerHTML = currentProfit;
        newDiv.innerHTML += '<div class="max-cycle">'+maxStepInCycle+'</div>';
        cyclesHistoryDiv.appendChild(newDiv);
        resetCycle('lose');
    } else if (cyclesToPlay > 0 && tradeDirection !== 'flat' && autoTradingEnabled){
        // Execute trade and update last trade time

        if (!isTradeOpen) {
            smartBet(currentBetStep, tradeDirection);
            isTradeOpen = true;
        }

        lastTradeTime = time;
        
        currentTrade.time = hTime;
        currentTrade.betTime = betTime;
        currentTrade.openPrice = globalPrice;
        currentTrade.step = currentBetStep;
        let betValue = getBetValue(currentTrade.step);
        currentTrade.betValue = betValue;
        currentTrade.betDirection = tradeDirection;
        currentTrade.globalTrend = globalTrend;
        currentTrade.priceTrend = priceTrend;
        currentTrade.shortEMA = window.currentShortEMA;
        currentTrade.longEMA = window.currentLongEMA;
        currentTrade.emaDiff = window.currentShortEMA - window.currentLongEMA;
        currentTrade.rsi = window.currentRSI;
        currentTrade.bullishScore = bullishScore;
        currentTrade.bearishScore = bearishScore;
        currentTrade.scoreDiff = scoreDifference;
        currentTrade.threshold = adjustedThreshold;
        betHistory.push(currentTrade);
        totalWager += betValue;
        wagerDiv.innerHTML = totalWager;

        // Update maximum step
        maxStepInCycle = Math.max(maxStepInCycle, currentTrade.step);
        maxStepDiv.innerHTML = maxStepInCycle;
        
        console.log(`Trade executed: ${tradeDirection} at step ${currentBetStep}, Score diff: ${scoreDifference}/${adjustedThreshold}`);
    }

    // Calculate win percentage
    let winCounter = 0;
    for (var i = 0; i < betHistory.length; i++) {
        if (betHistory[i].won === 'won'){
            winCounter++
        }
    }

    let winPercent = Math.round(winCounter / betHistory.length * 100 * 100 ) / 100;
    wonDiv.innerHTML = winPercent;
}

let smartBet = (step, tradeDirection) => {

    currentProfitPercent = parseInt(percentProfitDiv.innerHTML);
    profitPercentDivAdvisor.innerHTML = currentProfitPercent;

    if (currentProfitPercent < 90){
        console.log('%c BET IS NOT RECOMMENDED. Aborting mission! ', 'background: #B90000; color: #ffffff');
        profitPercentDivAdvisor.style.background = '#B90000';
        profitPercentDivAdvisor.style.color = "#ffffff";
        profitPercentDivAdvisor.innerHTML = 'win % is low! ABORT!!! => '+currentProfitPercent;
        return;
    }

    let steps;

    if (tradeDirection === 'null'){
        console.log('trade dir is NULL');
    }

    for (let i = 0; i <betArray.length;i++){
        if (step == betArray[i].step){
            steps = betArray[i].pressCount;
        }
    }

    for (i=0; i < 30; i++){
        setTimeout(function() {
            decreaseBet();
        }, i);
    }

    setTimeout(function() {  
        for (i=0; i < steps; i++){
            setTimeout(function() {
                increaseBet();
            }, i);
        }
    }, 50);

    setTimeout(function() {  
        if (tradeDirection == 'buy'){
            buy();
        } else {
            sell();
        }
        let betValue = getBetValue(step);
        // console.log('Betting: ' + betValue + ' / Step: ' + step + ' / Direction: ' + tradeDirection);
    }, 100);
}
let getBetValue = (betStep) => {
    let value;
    for (let i=0;i<betArray.length;i++) {
        if (betStep == betArray[i].step) {
            value = betArray[i].value;
        }
    }
    return value;
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
    // logTradeToGoogleSheets(appversion, winStatus, currentProfit, maxStepInCycle, symbolName);

    console.log('%c RESET CYCLE! '+hTime, 'background: #9326FF; color: #ffffff');

    profitDiv.style.background = 'inherit';

    maxStepInCycle = 0;
    
    // Reset the current bet step when starting a new cycle
    currentBetStep = 0;

    if (cyclesToPlay > 0) {
        cyclesStats.push(currentProfit);
        startBalance = currentBalance;
        cyclesToPlay--;
        // cyclesDiv.innerHTML = cyclesToPlay;
        let totalProfit = 0;
        for (let i = 0; i < cyclesStats.length; i++) {
            totalProfit += cyclesStats[i];
        }

        totalProfit = Math.round(totalProfit * 100) / 100;
        totalProfitDiv.innerHTML = totalProfit;
        if (totalProfit < 0) {
            totalProfitDiv.style.background = '#B90000';
        } else if (totalProfit > 0) {
            totalProfitDiv.style.background = '#009500';
        }
        firstTradeBlock = false;
    } else {
        console.log('%c ----- ALL CYCLES ENDED! ----- '+hTime+' ------', 'background: #9326FF; color: #ffffff');
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
        
        symbolElement.innerHTML = `${symbolName} <span style="color: ${priceChangeColor}; font-weight: bold;">${formattedPrice}</span>`;
    }
    
    // Update balance with current account value
    if (window.currentBalance) {
        // Format balance with commas for thousands and fixed to 2 decimal places
        const formattedBalance = parseFloat(window.currentBalance).toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        
        // Add color based on profit/loss compared to starting balance
        const balanceColor = window.currentBalance > startBalance ? '#00c800' : 
                            window.currentBalance < startBalance ? '#ff3a3a' : '#ffffff';
        
        balanceElement.innerHTML = `${formattedBalance}`;
        balanceElement.style.color = balanceColor;
    }
    
    // Update mode with additional information
    if (modeElement) {
        const sessionDuration = Math.floor((Date.now() - startTime) / 60000); // in minutes
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
        if (signalSensitivity <= 3) {
            sensitivityColor = '#ff3a3a'; // Red for aggressive
        } else if (signalSensitivity <= 6) {
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
            autoTradingLabel.style.color = autoTradingEnabled ? '#00c800' : '#ff3a3a';
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

    historyBetDiv = document.createElement("div");
    historyBetDiv.style.width = "10px";
    historyBetDiv.style.height = "10px";
    historyBetDiv.style.padding = "2px";
    historyBetDiv.style.display = "inline-block";
    historyBetDiv.classList.add("history-bet");
  
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
                <span class="info-value" id="trading-symbol">${symbolName}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Start Balance:</span>
                <span class="info-value">${startBalance}</span>
            </div>
            <div class="info-item">
                <span class="info-label">Start Time:</span>
                <span class="info-value">${startTime}</span>
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
    profitDiv = document.getElementById("profit");
    profitPercentDivAdvisor = document.getElementById("profit-percent");
    historyDiv = document.getElementById("history-box");
    signalDiv = document.getElementById("signal");
    tradingSymbolDiv = document.getElementById("trading-symbol");
    trendDiv = document.getElementById("price-trend");
    globalTrendDiv = document.getElementById("global-trend");
    tradeDirectionDiv = document.getElementById("trade-dir");
    timeDiv = document.getElementById("time");
    wonDiv = document.getElementById("won-percent");
    wagerDiv = document.getElementById("wager");
    maxStepDiv = document.getElementById("max-step");
    totalProfitDiv = document.getElementById("total-profit");
    cyclesHistoryDiv = document.getElementById("cycles-history");
    graphContainer = document.getElementById("graphs");

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
        
        symbolElement.innerHTML = `${symbolName} <span style="color: ${priceChangeColor}; font-weight: bold;">${formattedPrice}</span>`;
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

// Add these variables near the top of your file with other global variables
let signalSensitivity = 3; // Default sensitivity threshold (can be 1-10)
let autoTradingEnabled = true; // Toggle for auto-trading

// Add a UI control for sensitivity
function addSensitivityControl() {
    const controlDiv = document.createElement('div');
    controlDiv.style.marginTop = '15px';
    controlDiv.style.marginBottom = '15px';
    controlDiv.innerHTML = `
        <div style="margin-bottom: 10px;">
            <label for="sensitivity-slider">Signal Sensitivity: <span id="sensitivity-value">${signalSensitivity}</span></label>
            <input type="range" id="sensitivity-slider" min="1" max="10" value="${signalSensitivity}" style="width: 200px;">
        </div>
        <div>
            <label for="auto-trading-toggle">Auto Trading: </label>
            <input type="checkbox" id="auto-trading-toggle" ${autoTradingEnabled ? 'checked' : ''}>
        </div>
    `;
    
    // Insert before the graphs div
    const graphsDiv = document.getElementById('graphs');
    graphsDiv.parentNode.insertBefore(controlDiv, graphsDiv);
    
    // Add event listeners
    document.getElementById('sensitivity-slider').addEventListener('input', function(e) {
        signalSensitivity = parseInt(e.target.value);
        document.getElementById('sensitivity-value').textContent = signalSensitivity;
        console.log(`Signal sensitivity set to: ${signalSensitivity}`);
    });
    
    document.getElementById('auto-trading-toggle').addEventListener('change', function(e) {
        autoTradingEnabled = e.target.checked;
        console.log(`Auto trading ${autoTradingEnabled ? 'enabled' : 'disabled'}`);
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
        const timeUntilNextCandle = candleInterval - (currentTime - lastCandleTime);
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

    // logTradeToGoogleSheets(appversion, symbolName, openTime, betTime, openPrice, closePrice, betAmount, betStatus, betProfit);
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
    // console.log('Trade logged:', response);
    })
    .catch(err => {
    console.error('Error logging trade:', err);
    });
  }

// Helper function to calculate EMA
function calculateEMA(prices, period) {
    if (prices.length < period) {
        // Not enough data points, return simple average
        return prices.reduce((sum, price) => sum + price, 0) / prices.length;
    }
    
    const k = 2 / (period + 1); // Smoothing factor
    
    // Calculate initial SMA
    let ema = prices.slice(0, period).reduce((sum, price) => sum + price, 0) / period;
    
    // Calculate EMA for remaining prices
    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    
    return ema;
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

// Helper function to calculate RSI
function calculateRSI(prices, period) {
    if (prices.length <= period) {
        return 50; // Default neutral value if not enough data
    }
    
    // Calculate price changes
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
        changes.push(prices[i] - prices[i - 1]);
    }
    
    // Separate gains and losses
    const gains = changes.map(change => change > 0 ? change : 0);
    const losses = changes.map(change => change < 0 ? Math.abs(change) : 0);
    
    // Calculate average gains and losses
    let avgGain = gains.slice(0, period).reduce((sum, gain) => sum + gain, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((sum, loss) => sum + loss, 0) / period;
    
    // Calculate RSI for remaining periods using smoothed averages
    for (let i = period; i < changes.length; i++) {
        avgGain = ((avgGain * (period - 1)) + gains[i]) / period;
        avgLoss = ((avgLoss * (period - 1)) + losses[i]) / period;
    }
    
    if (avgLoss === 0) return 100; // Avoid division by zero
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return rsi;
}

// Add a function to calculate MACD
function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    if (prices.length < slowPeriod) {
        return {
            macd: 0,
            signal: 0,
            histogram: 0
        };
    }
    
    const fastEMA = calculateEMA(prices, fastPeriod);
    const slowEMA = calculateEMA(prices, slowPeriod);
    const macdLine = fastEMA - slowEMA;
    
    // For signal line, we need MACD values over time, but for simplicity, return current values
    return {
        macd: macdLine,
        signal: 0, // Simplified - would need historical MACD values for proper signal line
        histogram: macdLine
    };
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
    const fastEMA = calculateEMA(prices, fastPeriod);
    const slowEMA = calculateEMA(prices, slowPeriod);
    
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

