(() => {
const anomalySearch = false; // search anomaly before bet opening
const anomalyPrevent = true; // prevent anomaly while trading
const anomalyLimit = 1;
let anomalyCounter = 0;
let anomalyDetected = false;
let totalAnomalies = 0;

const mode = 'REAL';
// cconst mode = 'DEMO';

let cyclesToPlay = 10;
let cyclesStats = [];

let tradingAllowed = true;

console.log("Anomaly prevent: ", anomalyPrevent);

const limitWin1 = 20;
const limitLoss1 = -700;

const limitWin2 = 700;
const limitLoss2 = -1900;

let limitWin = limitWin1;
let limitLoss = limitLoss1;

let globalTrend;
let globalBets = [];
let firstPriceTrendArray = [];

const betArray1 = [
    { step: 0, value: 2, pressCount: 1 },
    { step: 1, value: 4, pressCount: 3 },
    { step: 2, value: 9, pressCount: 8 },
    { step: 3, value: 20, pressCount: 11 },
    { step: 4, value: 40, pressCount: 15 },
    { step: 5, value: 90, pressCount: 21 },
    { step: 6, value: 200, pressCount: 24 },
    { step: 7, value: 400, pressCount: 27 }
];

const betArray2 = [
    { step: 0, value: 5, pressCount: 4 },
    { step: 1, value: 10, pressCount: 9 },
    { step: 2, value: 25, pressCount: 12 },
    { step: 3, value: 50, pressCount: 17 },
    { step: 4, value: 100, pressCount: 22 },
    { step: 5, value: 250, pressCount: 25 },
    { step: 6, value: 500, pressCount: 29 },
    { step: 7, value: 1000, pressCount: 32 }
];

let betArray = betArray1;
let betHistory = [];
let priceTrendHistory = [];
let priceTrend;
let priceHistory = [];
let currentBalance;
let currentProfit = 0;
let currentProfitPercent = 0;
let profitDiv;
let profitPercentDivAdvisor;
let timeDiv;
let wonDiv;
let wagerDiv;
let totalWager = 0;
let historyDiv;
let cyclesDiv;
let cyclesHistoryDiv;
let totalProfitDiv;
let historyBetDiv;
let anomalyDiv;
let globalPrice;
let updateStartPrice = false;
let firstTradeBlock = false;
let targetElement2;

let balanceDiv;

const percentProfitDiv = document.getElementsByClassName("value__val-start")[0];
if (mode == 'REAL') {
    balanceDiv = document.getElementsByClassName("js-hd js-balance-real-USD")[0];
} else {
    balanceDiv = document.getElementsByClassName("js-hd js-balance-demo")[0];
}
let priceString = balanceDiv.innerHTML;
priceString = priceString.split(',').join('');

let startBalance = parseFloat(priceString);
let prevBalance = startBalance;
console.log('Start Balance: ', startBalance);

const redColor = '#B90000';
const greenColor = '#009500';

const winCycle = document.createElement("div");
winCycle.style.backgroundColor = greenColor;
winCycle.style.padding = "5px";
winCycle.style.margin = "5px 10px";
winCycle.style.display = "inline-block";
winCycle.style.borderRadius = "3px";

const loseCycle = document.createElement("div");
loseCycle.style.backgroundColor = redColor;
loseCycle.style.padding = "5px";
loseCycle.style.margin = "5px 10px";
loseCycle.style.display = "inline-block";
loseCycle.style.borderRadius = "3px";

const targetElem = document.getElementsByClassName("tooltip-text");
const textToSearch = "Winnings amount you receive";
for (let i = 0; i < targetElem.length; i++) {
    const textContent = targetElem[i].textContent || targetElem[i].innerText;
    if (textContent.includes(textToSearch)) {
        targetElement2 = document.getElementsByClassName("tooltip-text")[i];
    }
}
const buyButton = document.getElementsByClassName("btn btn-call")[0];
let text = targetElement2.innerHTML;
let startPrice = parseFloat(text.match(/\d+.\d+(?=\ a)/g)[0]);
priceHistory.push(startPrice);
console.log('Start Price: ', startPrice);

let betInput = document.getElementsByClassName("call-put-block__in")[0].querySelector("input");
let betDivContent = document.getElementsByClassName("call-put-block__in")[0].querySelector("input").value;
let betValue = parseFloat(betDivContent);

// create an observer instance
let targetDiv = document.getElementsByClassName("scrollbar-container deals-list ps")[0];
let observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
        let newDeal = mutation.addedNodes[0];

        function hasClass(element, className) {
            return (' ' + element.className + ' ').indexOf(' ' + className + ' ') > -1;
        }

        let centerUp;
        let centerDiv = newDeal.childNodes[0].children[0].children[1].children[1];
        if (hasClass(centerDiv, 'price-up')) {
            centerUp = true;
        } else {
            centerUp = false;
        }

        let lastUp;
        let lastDiv = newDeal.childNodes[0].children[0].children[1].children[2];
        if (hasClass(lastDiv, 'price-up')) {
            lastUp = true;
        } else {
            lastUp = false;
        }

        let tradeStatus;
        if (centerUp && lastUp) {
            tradeStatus = 'won';
        } else if (centerUp && !lastUp) {
            tradeStatus = 'returned';
        } else if (!centerUp && !lastUp) {
            tradeStatus = 'lost';
        }
        if (betHistory.length > 0) betHistory[betHistory.length - 1].won = tradeStatus;

        console.log('Bet status: ', tradeStatus);

        if (startPrice < globalPrice) {
            priceTrend = 'up';
        } else if (startPrice == globalPrice) {
            priceTrend = 'flat';
        } else {
            priceTrend = 'down';
        }

        //Anomaly detection
        let last = priceTrendHistory.slice(-1).pop();

        if (priceTrend !== last && priceTrendHistory.length > 1 && priceTrend !== 'flat') {
            anomalyCounter++;
        } else {
            anomalyCounter = 0;
        }

        if (priceTrendHistory.length > anomalyLimit && anomalyCounter >= anomalyLimit) {
            console.log('%c Anomaly detected! ', 'background: #222; color: #bada55');
            if (!anomalyDetected) {
                totalAnomalies++;
                anomalyDiv.innerHTML = totalAnomalies;
            }
            anomalyDetected = true;
        } else {
            anomalyDetected = false;
        }
        console.log('anomalyCounter: ', anomalyCounter);

        priceTrendHistory.push(priceTrend);
        console.log('price Trend: ', priceTrend, 'Start price: ', startPrice);

        //Retrieveing Global Trend (last 10 trends)
        let last10Elements = takeRight(priceTrendHistory, 10);
        console.log('Last 10 Price Trend: ', last10Elements);

        let upCounter = 0;
        let downCounter = 0;
        for (let i = 0; i < last10Elements.length; i++) {
            if (last10Elements[i] === 'up') upCounter++;
            if (last10Elements[i] === 'down') downCounter++;
        }
        if (upCounter > downCounter) {
            globalTrend = 'up';
        } else if (upCounter < downCounter) {
            globalTrend = 'down';
        } else if (upCounter === downCounter) {
            globalTrend = 'flat';
        }
        console.log('Global Trend: ', globalTrend);

        if (currentProfit > limitWin) {
            limitWin = limitWin1;
            limitLoss = limitLoss1;
            betArray = betArray1;
            let newDiv = winCycle.cloneNode();
            newDiv.innerHTML = currentProfit;
            cyclesHistoryDiv.appendChild(newDiv);
            resetCycle();
        } else if (currentProfit < limitLoss) {
            if (limitWin == limitWin1) {
                limitWin = limitWin2;
                limitLoss = limitLoss2;
                betArray = betArray2;
            } else {
                limitWin = limitWin1;
                limitLoss = limitLoss1;
                betArray = betArray1;
            }
            let newDiv = loseCycle.cloneNode();
            newDiv.innerHTML = currentProfit;
            cyclesHistoryDiv.appendChild(newDiv);
            resetCycle();
        } else if (cyclesToPlay > 0) {
            makeBet(priceTrend, tradeStatus);
        }

        startPrice = globalPrice;
        priceHistory.push(startPrice);
    });
});
// configuration of the observer:
let config = { attributes: true, childList: true, characterData: true };
// pass in the target node, as well as the observer options
observer.observe(targetDiv, config);
// later, you can stop observing
// observer.disconnect();

let buy = () => document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 87, shiftKey: true }));
let sell = () => document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 83, shiftKey: true }));
let decreaseBet = () => document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 65, shiftKey: true }));
let increaseBet = () => document.dispatchEvent(new KeyboardEvent('keyup', { keyCode: 68, shiftKey: true }));
let setValue = v => document.getElementsByClassName("call-put-block__in")[0].querySelector("input").value = v; // todo: after that press ENTER event?

let queryPrice = () => {
    let text = targetElement2.innerHTML;
    globalPrice = parseFloat(text.match(/\d+.\d+(?=\ a)/g)[0]);

    // Detect balance change
    currentBalance = parseFloat(balanceDiv.innerHTML.split(',').join(''));
    currentProfit = Math.round((currentBalance - startBalance) * 100) / 100;
    profitDiv.innerHTML = currentProfit;
    if (currentProfit > 0) {
        profitDiv.style.background = '#009500';
    } else {
        profitDiv.style.background = '#B90000';
    }

    //first automatic bet
    let time = Date.now();
    let hTime = humanTime(time);
    timeDiv.innerHTML = hTime;
    // if (parseInt(hTime.slice(-1)) == 0 && !firstTradeBlock) { // 10 seconds
    if (parseInt(hTime.slice(-2)) == 0 && !firstTradeBlock) { // 1 minute
        let firstPriceTrend;
        if (startPrice < globalPrice) {
            firstPriceTrend = 'up';
        } else if (startPrice == globalPrice) {
            firstPriceTrend = 'flat';
        } else {
            firstPriceTrend = 'down';
        }
        firstPriceTrendArray.push(firstPriceTrend);
        firstTradeBlock = true;

        let currentTrade = {};
        // currentTrade.startPrice = startPrice;
        // currentTrade.globalPrice = globalPrice;
        currentTrade.time = hTime;
        currentTrade.step = 0;
        let betValue = getBetValue(currentTrade.step);
        currentTrade.betValue = betValue;
        currentTrade.betDirection = firstPriceTrend;
        currentTrade.anomalyDetected = anomalyDetected;
        currentTrade.globalTrend = globalTrend;
        currentTrade.priceTrend = firstPriceTrend;
        betHistory.push(currentTrade);
        totalWager += betValue;
        wagerDiv.innerHTML = totalWager;

        if (firstPriceTrendArray.length > 0) {
            smartBet(0, firstPriceTrend);
        }
    }
};
let makeBet = (priceTrend, tradeStatus) => {
    let tradeDirection;
    let currentTrade = {};

    // currentTrade.startPrice = startPrice;
    // currentTrade.globalPrice = globalPrice;

    let prevBetStep = betHistory.slice(-1)[0].step;
    let currentBetStep;

    if (tradeStatus === 'won') {
        currentBetStep = 0;
        // } else if (tradeStatus === 'lost' && (currentProfit - getBetValue(prevBetStep + 1)) > limitLoss) { // trying to not bet more than loss limit
    } else if (tradeStatus === 'lost') {
        if (prevBetStep < betArray.length - 1) {
            currentBetStep = prevBetStep + 1;
        } else {
            currentBetStep = 0;
        }
    } else if (tradeStatus === 'returned') {
        currentBetStep = prevBetStep;
    }

    if (priceTrend === 'flat' || anomalyDetected) {
        if (globalTrend === 'up') {
            tradeDirection = 'buy';
        } else if (globalTrend === 'down') {
            tradeDirection = 'sell';
        } else if (globalTrend === 'flat') {
            let last10Prices = takeRight(priceHistory, 10);
            let last10Max = last10Prices.max();
            let last10Min = last10Prices.min();
            let last10Average = (last10Max - last10Min) / 2 + last10Min;
            if (last10Average >= globalPrice) {
                tradeDirection = 'sell';
            } else {
                tradeDirection = 'buy';
            }
        }
    } else if (priceTrend === 'up') {
        tradeDirection = 'buy';
    } else if (priceTrend === 'down') {
        tradeDirection = 'sell';
    }

    smartBet(currentBetStep, tradeDirection);

    let time = Date.now();
    let hTime = humanTime(time);
    currentTrade.time = hTime;
    currentTrade.step = currentBetStep;
    let betValue = getBetValue(currentTrade.step);
    currentTrade.betValue = betValue;
    currentTrade.betDirection = tradeDirection;
    currentTrade.anomalyDetected = anomalyDetected;
    currentTrade.globalTrend = globalTrend;
    currentTrade.priceTrend = priceTrend;
    betHistory.push(currentTrade);
    totalWager += betValue;
    wagerDiv.innerHTML = totalWager;

    //  determine win %
    let winCounter = 0;
    for (let i = 0; i < betHistory.length; i++) {
        if (betHistory[i].won === 'won') {
            winCounter++;
        }
    }

    let winPercent = Math.round(winCounter / betHistory.length * 100 * 100) / 100;
    wonDiv.innerHTML = winPercent;

    console.log('Bet History: ', betHistory);
    console.log('----------------------------------------------------------------');
};
let smartBet = (step, tradeDirection) => {
    currentProfitPercent = parseInt(percentProfitDiv.innerHTML);
    profitPercentDivAdvisor.innerHTML = currentProfitPercent;

    if (currentProfitPercent < 92) {
        console.log('%c BET IS NOT RECOMMENDED. Aborting mission! ', 'background: #B90000; color: #ffffff');
        profitPercentDivAdvisor.style.background = '#B90000';
        profitPercentDivAdvisor.style.color = "#ffffff";
        profitPercentDivAdvisor.innerHTML = 'win % is low! ABORT!!! => ' + currentProfitPercent;
        return;
    }

    let steps;

    for (let i = 0; i < betArray.length; i++) {
        if (step == betArray[i].step) {
            steps = betArray[i].pressCount;
        }
    }

    for (let i = 0; i < 30; i++) {
        setTimeout(function () {
            decreaseBet();
        }, i);
    }

    setTimeout(function () {
        for (let i = 0; i < steps; i++) {
            setTimeout(function () {
                increaseBet();
            }, i);
        }
    }, 50);

    setTimeout(function () {
        if (tradeDirection == 'buy') {
            buy();
        } else {
            sell();
        }
        let betValue = getBetValue(step);
        console.log('Betting: ' + betValue + ' / Step: ' + step + ' / Direction: ' + tradeDirection);
    }, 150);
};
let getBetValue = (betStep) => {
    let value;
    for (let i = 0; i < betArray.length; i++) {
        if (betStep == betArray[i].step) {
            value = betArray[i].value;
        }
    }
    return value;
};
let takeRight = (arr, n = 1) => arr.slice(-n);
Array.prototype.max = function () {
    return Math.max.apply(null, this);
};
Array.prototype.min = function () {
    return Math.min.apply(null, this);
};
let humanTime = (time) => {
    let h = (new Date(time).getHours()).toString();
    if (h < 10) {
        h = '0' + h;
    }
    let m = (new Date(time).getMinutes()).toString();
    if (m < 10) {
        m = '0' + m;
    }
    let s = (new Date(time).getSeconds()).toString();
    if (s < 10) {
        s = '0' + s;
    }
    let humanTime = h + ':' + m + ':' + s;
    return humanTime;
};
let resetCycle = () => {
    let time = Date.now();
    let hTime = humanTime(time);

    console.log('%c RESET CYCLE! ' + hTime, 'background: #9326FF; color: #ffffff');

    profitDiv.style.background = 'inherit';

    if (cyclesToPlay > 0) {
        cyclesStats.push(currentProfit);
        startBalance = currentBalance;
        cyclesToPlay--;
        cyclesDiv.innerHTML = cyclesToPlay;
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
        console.log('%c ----- ALL CYCLES ENDED! ----- ' + hTime + ' ------', 'background: #9326FF; color: #ffffff');
    }
};
function addUI() {
    // create a new div element
    const newDiv = document.createElement("div");
    newDiv.style.width = "480px";
    newDiv.style.position = "absolute";
    newDiv.style.bottom = "20px";
    newDiv.style.right = "60px";
    newDiv.style.zIndex = "100500";
    newDiv.style.background = "rgba(0, 0, 0, 0.6)";
    newDiv.style.padding = "40px";
    newDiv.style.borderRadius = "10px";

    historyBetDiv = document.createElement("div");
    historyBetDiv.style.width = "10px";
    historyBetDiv.style.height = "10px";
    historyBetDiv.style.padding = "2px";
    historyBetDiv.style.display = "inline-block";
    historyBetDiv.classList.add("history-bet");

    // and give it some content
    const newContent = document.createTextNode("Bender ver. 1.8 - trading algorythm improved");

    // add the text node to the newly created div
    newDiv.appendChild(newContent);

    // add the newly created element and its content into the DOM
    const currentDiv = document.getElementById("div1");
    document.body.insertBefore(newDiv, currentDiv);

    newDiv.innerHTML += '<br><br><div>Start Balance: ' + startBalance + ' USD.<br><br>MODE: ' + mode + '</div><br>';
    newDiv.innerHTML += '<div>Current profit: <span id="profit">0</span> USD / Won: <span id="won-percent">0</span> % / Wager: $ <span id="wager">0</span></div><br>';
    newDiv.innerHTML += '<div>Current time: <span id="time">0:00</span></div><br>';
    newDiv.innerHTML += '<div>% profit on current pair: <span id="profit-percent">0</span> %</div><br>';
    // newDiv.innerHTML += '<div>History: <span id="history-box"></span></div><br>';
    newDiv.innerHTML += '<div>Anomaly count: <span id="anomaly-count">0</span></div><br>';
    newDiv.innerHTML += '<div>Cycles left: <span id="cycles-count">0</span> / Total Profit: <span id="total-profit">0</span> USD</div><br>';
    newDiv.innerHTML += '<div>Cycles history:<br><span id="cycles-history"></span></div><br>';

    profitDiv = document.getElementById("profit");
    profitPercentDivAdvisor = document.getElementById("profit-percent");
    historyDiv = document.getElementById("history-box");
    anomalyDiv = document.getElementById("anomaly-count");
    timeDiv = document.getElementById("time");
    wonDiv = document.getElementById("won-percent");
    wagerDiv = document.getElementById("wager");
    cyclesDiv = document.getElementById("cycles-count");
    cyclesDiv.innerHTML = cyclesToPlay;
    totalProfitDiv = document.getElementById("total-profit");
    cyclesHistoryDiv = document.getElementById("cycles-history");
}
addUI();
setInterval(queryPrice, 100);
})();
