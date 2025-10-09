// ==UserScript==
// @name         Verter_M1_BALRES_v0.2.8.4
// @description  Auto-trade + Signals (EMA3/9, EMA9/15, SQZ) + CLOSE via legacy Trades observer (guard+dedupe) + BalanceStable(2s) + DockBox (+50%) + Stats (Wager on DOM close) + One-At-A-Time Gate
// @version      0.2.8.4
// @match        https://pocketoption.com/*
// @run-at       document-idle
// ==/UserScript==

(function () {
  if (window.__verterBoot) { console.log('[VERTER] already armed'); return; }
  window.__verterBoot = true;

  const VER = '0.2.8.4';
  const DEBUG = false;

  // ===== Utils =====
  function now(){ return Date.now(); }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
  function r2(x){ return Math.round(x*100)/100; }
  function fmt2(x){ return (x==null||isNaN(x))?'—':(+x).toFixed(2); }
  function normMoney(s){
    if(!s) return null;
    s=String(s).replace(/[\s\u00A0]/g,'').replace(/[A-Za-z$€£¥₽₴₺₹₩₦฿₿]/g,'').replace(/[^0-9,.\-]/g,'');
    if(/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) s=s.replace(/,/g,'');
    else if(/^-?\d{1,3}(?:\.\d{3})+,\d+$/.test(s)){ s=s.replace(/\./g,'').replace(/,/g,'.'); }
    else { var c=(s.match(/,/g)||[]).length,d=(s.match(/\./g)||[]).length; if(c&&!d){ var last=s.split(',').pop(); s=(last.length===3)?s.replace(/,/g,''):s.replace(/,/g,'.'); } }
    var n=parseFloat(s); return isNaN(n)?null:r2(n);
  }

  // ===== SessionStats =====
  var SessionStats=(function(){
    var s={startTime:null,startBalance:null,lastBalance:null,tradesTotal:0,wins:0,losses:0,returns:0,
           volumeTotal:0,volumeByType:{WIN:0,LOSS:0,RET:0},profitTotal:0};
    function ensureInit(v){ if(s.startBalance==null && v!=null){ s.startBalance=v; s.startTime=Date.now(); } }
    function onBalance(v){ if(v==null) return; ensureInit(v); s.lastBalance=v;
      if(s.startBalance!=null && s.lastBalance!=null) s.profitTotal=r2(s.lastBalance-s.startBalance); }
    function onClose(type, pnl, finalBal, amount){
      if(type==='WIN') s.wins++; else if(type==='LOSS') s.losses++; else if(type==='RET') s.returns++;
      s.tradesTotal++;
      if(amount!=null) s.volumeTotal=r2(s.volumeTotal+amount);
      if(type&&amount!=null) s.volumeByType[type]=r2((s.volumeByType[type]||0)+amount);
      if(finalBal!=null) s.lastBalance=finalBal;
      if(s.startBalance!=null && s.lastBalance!=null) s.profitTotal=r2(s.lastBalance-s.startBalance);
    }
    function snapshot(){
      var winPct=s.tradesTotal? Math.round((s.wins/s.tradesTotal*1000))/10:0;
      var snapshotObj={};
      for(var k in s){ if(Object.prototype.hasOwnProperty.call(s,k)){ snapshotObj[k]=s[k]; } }
      snapshotObj.winPct=winPct;
      return snapshotObj;
    }
    return { onBalance:onBalance,onClose:onClose,snapshot:snapshot,get:function(){return s;} };
  })();

  // ===== Balance feeder + Stable(2s) =====
  var Balance=(function(){
    var target=null;
    function find(){
      return document.querySelector('.balance-info-block__balance .js-balance-demo')
          || document.querySelector('span.js-balance-demo')
          || document.querySelector('[class*="balance"] [class*="js-balance"]')
          || document.body;
    }
    function read(){
      var raw='';
      if(target){
        raw = target.textContent || '';
        if(!raw && target.getAttribute){
          raw = target.getAttribute('data-hd-show') || '';
        }
      }
      return normMoney(raw);
    }
    function boot(){
      target=find();
      if(!target || target===document.body){ console.warn('[BAL] target not found'); return; }
      var obs=new MutationObserver(()=>BalanceStable.feed());
      obs.observe(target,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-hd-show']});
      setTimeout(()=>{ try{BalanceStable.feed();}catch(e){} },0);
      console.log('[BAL][BOOT] feeder→2s stable');
      return ()=>{ try{obs.disconnect();}catch(e){} };
    }
    return { boot, read, getTarget:()=>target };
  })();

  var BalanceStable=(function(){
    var t=null, stable=null, cbs=[];
    function feed(){ if(t) return; t=setTimeout(function(){ t=null; var v=null; try{ v=Balance.read(); }catch(e){} if(v==null) return;
      var prev=stable; stable=v;
      try{
        SessionStats.onBalance(stable);
        if(prev!=null && prev!==stable){ console.log('[BAL][COMMIT]', prev.toFixed(2),'→',stable.toFixed(2)); }
        else if(prev==null){ console.log('[BAL][COMMIT]', stable.toFixed(2)); }
      }catch(e){}
      for(var i=0;i<cbs.length;i++){ try{ cbs[i](stable, Date.now()); }catch(_e){} }
    },2000); }
    function onStable(cb){ if(typeof cb==='function') cbs.push(cb); }
    function getStable(){ return stable; }
    return { feed, onStable, getStable };
  })();

  // ===== Tick source (tooltip probe) =====
  var tickSource=(function(){
    function readTooltip(){
      var rx=/(\d+\.\d{3,6})/g, roots=document.querySelectorAll('[role="tooltip"],[class*="tooltip"],[class*="tippy"],[class*="popper"]'), cand=[];
      for(var i=0;i<roots.length;i++){ var t=roots[i].textContent||''; var m; while((m=rx.exec(t))){ var v=parseFloat(m[1]); if(isFinite(v)) cand.push(v); } }
      if(!cand.length) return null;
      for(var j=cand.length-1;j>=0;j--){ var v=cand[j]; if(v>0.0001 && v<100000) return v; }
      return null;
    }
    function subscribe(cb, period){
      var last=null;
      var iv=setInterval(function(){ try{ var p=readTooltip(); if(p==null) return; if(last===null || p!==last){ last=p; cb(p, Date.now()); } }catch(e){} }, Math.max(100,period|0));
      return function(){ clearInterval(iv); };
    }
    return { subscribe };
  })();

  // ===== DockBox (панель+график, +50%, drag) =====
  var DockBox=(function(){
    var state={ticks:[],candlesM1:[],cur:null};
    var box=document.createElement('div');
    box.style.cssText='position:fixed;z-index:999999;right:12px;bottom:12px;width:960px;height:420px;background:#111;color:#ddd;font:13px monospace;border:1px solid #333;border-radius:6px;display:flex;flex-direction:column;user-select:none';
    var bar=document.createElement('div'); bar.className='verter-dock-header';
    bar.style.cssText='padding:6px 8px;border-bottom:1px solid #222;display:flex;justify-content:space-between;align-items:center;gap:10px;cursor:move;flex-wrap:wrap';
    var left=document.createElement('div'); left.style.cssText='display:flex;gap:10px;align-items:center;flex-wrap:wrap';
    var right=document.createElement('div'); right.style.cssText='display:flex;gap:10px;align-items:center;flex-wrap:wrap';
    bar.appendChild(left); bar.appendChild(right);
    var cv=document.createElement('canvas'); cv.style.flex='1'; cv.style.display='block';
    box.appendChild(bar); box.appendChild(cv); document.body.appendChild(box);
    var ctx=cv.getContext('2d');

    (function restorePos(){
      try{
        const s = JSON.parse(localStorage.getItem('verter.dock.pos')||'null');
        if(s && typeof s.left==='number' && typeof s.top==='number'){
          box.style.right = box.style.bottom = '';
          box.style.left = s.left+'px'; box.style.top  = s.top +'px';
        }
      }catch(e){}
    })();
    (function makeDraggable(){
      let dragging=false, sx=0, sy=0, bx=0, by=0;
      function onDown(e){
        dragging=true;
        const r = box.getBoundingClientRect();
        sx=e.clientX; sy=e.clientY; bx=r.left; by=r.top;
        box.style.right = box.style.bottom = '';
        box.style.left  = bx+'px'; box.style.top = by+'px';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp, {once:true});
        e.preventDefault();
      }
      function onMove(e){
        if(!dragging) return;
        const dx=e.clientX-sx, dy=e.clientY-sy;
        const vw=window.innerWidth, vh=window.innerHeight;
        const rect=box.getBoundingClientRect(), w=rect.width, h=rect.height;
        const nx=clamp(bx+dx,0,vw-w), ny=clamp(by+dy,0,vh-h);
        box.style.left=nx+'px'; box.style.top=ny+'px';
      }
      function onUp(){
        dragging=false;
        try{
          const r=box.getBoundingClientRect();
          localStorage.setItem('verter.dock.pos', JSON.stringify({left:Math.round(r.left), top:Math.round(r.top)}));
        }catch(e){}
        window.removeEventListener('mousemove', onMove);
      }
      bar.addEventListener('mousedown', onDown);
    })();
    document.addEventListener('keydown', function(e){
      if(e.altKey && (e.key==='i'||e.key==='I')){ box.style.display = (box.style.display==='none')?'flex':'none'; }
      if(e.altKey && (e.key==='r'||e.key==='R')){
        localStorage.removeItem('verter.dock.pos');
        box.style.left = box.style.top = ''; box.style.right = '12px'; box.style.bottom = '12px';
      }
    });

    function fit(){
      var r=box.getBoundingClientRect(), head=bar.getBoundingClientRect().height|0;
      var w=Math.max(480,(r.width|0)), h=Math.max(240,((r.height-head)|0));
      if(cv.width!==w || cv.height!==h){ cv.width=w; cv.height=h; }
    }
    window.addEventListener('resize', function(){ fit(); schedule(); });
    fit();

    function onTick(p,ts){
      var t=ts||Date.now();
      state.ticks.push({t:t,p:p}); if(state.ticks.length>5000) state.ticks=state.ticks.slice(-5000);
      var mKey=Math.floor(t/60000);
      if(!state.cur||state.cur.mKey!==mKey){
        if(state.cur){
          state.cur.C=state.cur.lastP;
          state.candlesM1.push({tOpen:state.cur.tOpen,O:state.cur.O,H:state.cur.H,L:state.cur.L,C:state.cur.C});
          if(state.candlesM1.length>600) state.candlesM1=state.candlesM1.slice(-600);
          console.log('[M1][CLOSE]', new Date(state.cur.tOpen).toISOString(), state.cur);
        }
        state.cur={mKey:mKey,tOpen:mKey*60000,O:p,H:p,L:p,C:p,lastP:p};
      }else{
        if(p>state.cur.H) state.cur.H=p;
        if(p<state.cur.L) state.cur.L=p;
        state.cur.lastP=p;
      }
      schedule(); renderHeader();
    }

    var raf=0,need=false; function schedule(){ if(need) return; need=true; raf=requestAnimationFrame(function(){ need=false; draw(); }); }
    function draw(){
      fit(); var W=cv.width,H=cv.height;
      var data=state.candlesM1.slice(-120); if(state.cur) data=data.concat([{O:state.cur.O,H:state.cur.H,L:state.cur.L,C:state.cur.lastP}]);
      ctx.clearRect(0,0,W,H); if(!data.length) return;
      var hi=-1e9,lo=1e9; for(var i=0;i<data.length;i++){ hi=Math.max(hi,data[i].H); lo=Math.min(lo,data[i].L); }
      var span=(hi-lo)||1;
      ctx.globalAlpha=.25; ctx.strokeStyle='#666'; ctx.lineWidth=1;
      for(var g=1;g<4;g++){ var y=(H/4*g)|0; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
      ctx.globalAlpha=1; var n=data.length,bw=Math.max(3,Math.floor(W/n)-3),gap=2; ctx.lineWidth=1; ctx.strokeStyle='#bbb';
      for(var j=0;j<n;j++){
        var c=data[j],x=j*(bw+gap)+1;
        var yH=H-((c.H-lo)/span*H),yL=H-((c.L-lo)/span*H),yO=H-((c.O-lo)/span*H),yC=H-((c.C-lo)/span*H);
        ctx.beginPath(); ctx.moveTo(x+bw/2,yH); ctx.lineTo(x+bw/2,yL); ctx.stroke();
        var yTop=Math.min(yO,yC),yBot=Math.max(yO,yC),live=(j===n-1&&!!state.cur);
        ctx.fillStyle=(c.C>=c.O)?(live?'rgba(46,139,87,.7)':'#2e8b57'):(live?'rgba(170,58,58,.7)':'#aa3a3a');
        ctx.fillRect(x,yTop,bw,Math.max(1,yBot-yTop));
      }
    }

    var modeText='IDLE';
    var sigStats={ready:{E39:0,E915:0,SQZ:0}, need:{E39:9,E915:15,SQZ:20}, hits:{E39:0,E915:0,SQZ:0}};
    function setMode(t){ modeText=t||modeText; renderHeader(); }
    function setSigReady(name,have){ sigStats.ready[name]=have; renderHeader(); }
    function incSigHit(name){ sigStats.hits[name]=(sigStats.hits[name]||0)+1; renderHeader(); }

    function renderHeader(){
      var ss=SessionStats.get();
      left.innerHTML =
        'Start: ' + (ss.startTime? new Date(ss.startTime).toLocaleTimeString():'—') +
        ' | Bal: ' + fmt2(ss.startBalance) + ' → ' + fmt2(ss.lastBalance) +
        ' | P/L: ' + fmt2(ss.profitTotal) +
        ' | Wager: ' + fmt2(ss.volumeTotal) +
        ' | Trades: ' + ss.tradesTotal + ' (W/L/R ' + ss.wins + '/' + ss.losses + '/' + ss.returns + ')' +
        ' | Win%: ' + (ss.tradesTotal? (ss.wins/ss.tradesTotal*100).toFixed(1):'0.0'); // keep concise

      right.innerHTML =
        'Signals: '+
        'E3/9 ['+sigStats.ready.E39+'/'+sigStats.need.E39+', hits '+(sigStats.hits.E39||0)+'] | '+
        'E9/15 ['+sigStats.ready.E915+'/'+sigStats.need.E915+', hits '+(sigStats.hits.E915||0)+'] | '+
        'SQZ ['+sigStats.ready.SQZ+'/'+sigStats.need.SQZ+', hits '+(sigStats.hits.SQZ||0)+']'+
        ' | Mode: <b>'+modeText+'</b>'+
        ' | Verter v'+VER;
    }

    var unsubscribe=tickSource.subscribe(function(p,ts){ onTick(p,ts); },200);
    function stop(){ try{unsubscribe&&unsubscribe();}catch(e){} try{cancelAnimationFrame(raf);}catch(e){} const r = box.getBoundingClientRect(); return {pos:{left:r.left,top:r.top}}; }

    console.log('[VERTER][BOOT] DockBox (chart+panel, drag) v'+VER);
    return { stop, getState:function(){return state;}, setMode, setSigReady, incSigHit };
  })();

  // ===== Signals (EMA3/9, EMA9/15, TTM Squeeze) =====
  var SignalEngine=(function(){
    var lastSqzOn=null;
    function ema(arr,period){ if(arr.length<period) return []; var k=2/(period+1), out=[], prev=arr[0];
      for(var i=0;i<arr.length;i++){ prev=(i===0)?arr[i]:(arr[i]*k + prev*(1-k)); out.push(prev); } return out; }
    function sma(arr,len){ if(arr.length<len) return []; var out=[], sum=0; for(var i=0;i<arr.length;i++){ sum+=arr[i]; if(i>=len) sum-=arr[i-len]; if(i>=len-1) out.push(sum/len); } return out; }
    function stdev(arr,len){
      if(arr.length<len) return []; var out=[], q=[], sum=0;
      for(var i=0;i<arr.length;i++){ q.push(arr[i]); sum+=arr[i]; if(q.length>len) sum-=q.shift();
        if(q.length===len){ var mean=sum/len, s=0; for(var k=0;k<q.length;k++) s+=(q[k]-mean)*(q[k]-mean); out.push(Math.sqrt(s/len)); } }
      return out;
    }
    function atr(candles,len){ if(candles.length<2) return 0; var n=Math.min(len, candles.length-1), sum=0, prevC=candles[candles.length-n-1].C;
      for(var i=candles.length-n;i<candles.length;i++){ var c=candles[i], tr=Math.max(c.H-c.L, Math.abs(c.H-prevC), Math.abs(c.L-prevC)); sum+=tr; prevC=c.C; }
      return sum/Math.max(1,n);
    }
    function linregSlope(arr,len){
      if(arr.length<len) return 0; var a=arr.slice(-len), n=a.length, sx=0, sy=0, sxx=0, sxy=0;
      for(var i=0;i<n;i++){ var x=i+1,y=a[i]; sx+=x; sy+=y; sxx+=x*x; sxy+=x*y; }
      var denom = n*sxx - sx*sx; if(denom===0) return 0;
      return (n*sxy - sx*sy)/denom;
    }
    function evalAll(){
      var st=DockBox.getState(); var data=st.candlesM1.slice(-120);
      if(st.cur) data=data.concat([{O:st.cur.O,H:st.cur.H,L:st.cur.L,C:st.cur.lastP}]);
      if(!data.length) return {best:null, logs:[]};
      var closes=data.map(function(c){return c.C;});

      DockBox.setSigReady('E39', Math.min(closes.length, 9));
      DockBox.setSigReady('E915', Math.min(closes.length, 15));
      DockBox.setSigReady('SQZ', Math.min(closes.length, 20));

      var okE39=null, okE915=null, sqz=null;
      if(closes.length>=9){
        var e3=ema(closes,3), e9=ema(closes,9);
        if(e3[e3.length-1]>e9[e9.length-1]) okE39={side:'BUY',src:'E39'};
        else if(e3[e3.length-1]<e9[e9.length-1]) okE39={side:'SELL',src:'E39'};
      }
      if(closes.length>=15){
        var eF=ema(closes,9), eS=ema(closes,15);
        if(eF[eF.length-1]>eS[eS.length-1]) okE915={side:'BUY',src:'E915'};
        else if(eF[eF.length-1]<eS[eS.length-1]) okE915={side:'SELL',src:'E915'};
      }
      if(closes.length>=20){
        var len=20, sma20=sma(closes,len), std20=stdev(closes,len);
        if(sma20.length && std20.length){
          var m=sma20[sma20.length-1], sd=std20[sma20.length-1];
          var upperBB = m + 2.0*sd, lowerBB = m - 2.0*sd;
          var atr20 = atr(data.slice(-len), len);
          var rangeKC = 1.5*atr20;
          var upperKC = m + rangeKC, lowerKC = m - rangeKC;
          var on = (upperBB - lowerBB) < (upperKC - lowerKC);
          var slope = linregSlope(closes, len);
          if(lastSqzOn===null) lastSqzOn=on;
          if(lastSqzOn===true && on===false){
            var side = slope>0 ? 'BUY' : (slope<0 ? 'SELL' : null);
            if(side){ sqz={side:side,src:'SQZ'}; }
          }
          lastSqzOn=on;
        }
      }
      var pick = sqz || okE915 || okE39 || null;
      if(pick){ DockBox.incSigHit(pick.src); }
      return {best:pick, logs:[]};
    }
    return { evalAll };
  })();

  // ===== Hotkey Driver (Shift+W/S only) =====
  var HotkeyDriver=(function(){
    function hotkey(side){
      try{
        var keyCode = side==='BUY' ? 87 : 83; // W / S
        var ev = new KeyboardEvent('keyup', { keyCode:keyCode, which:keyCode, key:(side==='BUY'?'w':'s'), shiftKey:true, bubbles:true, cancelable:true });
        return document.dispatchEvent(ev);
      }catch(e){ return false; }
    }
    function trade(side){ try{ document.body.click(); }catch(e){} return hotkey(side); }
    return { trade };
  })();

  // ===== Stake reader =====
  function readStake(){
    var cand = document.querySelector('input[type="text"][inputmode="decimal"], input[type="number"], input[name*="amount"], [class*="deal-amount"] input');
    var v=null; if(cand){ v = normMoney(cand.value || cand.getAttribute('value') || cand.getAttribute('placeholder')); }
    if(v==null){ var n = document.querySelector('[class*="amount"], [class*="stake"], [class*="sum"]'); v = normMoney(n && n.textContent); }
    return v!=null?v:null;
  }

  // ===== Trade gate: одна ставка за раз =====
  var TradeGate = { busy:false, tOpen:0 };
  setInterval(function(){
    if (TradeGate.busy && Date.now()-TradeGate.tOpen > 120000){
      console.warn('[TRADE][GUARD] force-unlock after 120s without DOM close');
      TradeGate.busy=false; TradeGate.tOpen=0; DockBox.setMode('IDLE');
    }
  }, 5000);

  // ===== Legacy Trades Observer (logic unchanged; added guards+dedupe only) =====
  window.betHistory = window.betHistory || [];
  (function bootLegacyObserver(){
    let targetDiv = document.getElementsByClassName("scrollbar-container deals-list ps")[0];
    if(!targetDiv){
      console.warn('[TRADES] legacy target not found at boot; will retry');
      let tries=0; let iv=setInterval(function(){
        targetDiv = document.getElementsByClassName("scrollbar-container deals-list ps")[0];
        if(targetDiv || ++tries>60){ clearInterval(iv); if(targetDiv) attach(targetDiv); }
      },1000);
    } else attach(targetDiv);

    function attach(target){
      const recent = new Set();
      function remember(key){
        recent.add(key);
        if(recent.size>32){ const it=recent.values(); recent.delete(it.next().value); }
      }
      let observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
          if(!mutation.addedNodes || !mutation.addedNodes.length) return;
          const node = mutation.addedNodes[0];
          if(!node || node.nodeType!==1) return; // only ELEMENT_NODE

          // антидубль по содержимому строки
          const key = (node.textContent||'').slice(0,256);
          if(key && recent.has(key)) return;

          try{
            // ОРИГИНАЛЬНАЯ ЛОГИКА: читаем два индикатора price-up
            function hasClass(element, className) {
              return !!(element && element.classList && element.classList.contains(className));
            }
            // строго тот же путь в DOM, но под try/catch
            let newDeal = node;
            let centerDiv = newDeal.childNodes[0].children[0].children[1].children[1];
            let lastDiv   = newDeal.childNodes[0].children[0].children[1].children[2];

            let centerUp = hasClass(centerDiv, 'price-up');
            let lastUp   = hasClass(lastDiv,   'price-up');

            let tradeStatus;
            if (centerUp && lastUp) tradeStatus = 'won';
            else if (centerUp && !lastUp) tradeStatus = 'returned';
            else tradeStatus = 'lost';

            if (window.betHistory.length > 0){
              // перехват setter'а произойдёт в TradeBridge.arm()
              window.betHistory[window.betHistory.length - 1].won = tradeStatus;
            }
            console.log('Bet status: ',tradeStatus);
            remember(key);
          }catch(e){
            if(DEBUG) console.warn('[TRADES][PARSE][SKIP]', e&&e.message);
          }
        });
      });
      observer.observe(target, { childList:true });
      console.log('[TRADES][BOOT] legacy observer attached');
    }
  })();

  // ===== Bridge: перехват присвоения .won для подсчётов =====
  var TradeBridge=(function(){
    var pending=null; // {side, amount, tOpen, pre}
    function arm(side, amount){
      const rec = {};
      Object.defineProperty(rec,'won',{
        set:function(v){
          var type = v==='won'?'WIN':(v==='lost'?'LOSS':'RET');
          var bal = BalanceStable.getStable() || Balance.read() || null;
          console.log('[TRADES][CLOSED][DOM]', type, 'amt=', fmt2(pending&&pending.amount||amount));
          try{ SessionStats.onClose(type, null, bal, pending&&pending.amount||amount); }catch(e){}
          pending=null;
          TradeGate.busy=false; TradeGate.tOpen=0;
          DockBox.setMode('IDLE');
          var ss=SessionStats.snapshot();
          console.log('[SES] trades='+ss.tradesTotal+' W/L/R='+ss.wins+'/'+ss.losses+'/'+ss.returns+' Wager='+fmt2(ss.volumeTotal)+' P/L='+fmt2(ss.profitTotal));
        },
        enumerable:true, configurable:true
      });
      window.betHistory.push(rec);
      pending = { side: side, amount: amount, tOpen: now(), pre: BalanceStable.getStable()||Balance.read()||null };
    }
    return { arm };
  })();

  // ===== TradeController (без дедлайна; ждём DOM; семафор) =====
  (function(){
    if(!Balance.getTarget()){ Balance.boot(); }
    var st={mode:'IDLE'};
    setInterval(function(){
      if(st.mode!=='IDLE') return;
      if(TradeGate.busy) return;

      var res=SignalEngine.evalAll();
      if(!res || !res.best) return;

      var side=res.best.side, amount=readStake();
      TradeGate.busy=true; TradeGate.tOpen=Date.now(); DockBox.setMode('OPENED');
      if(DEBUG) console.log('[TRG]['+side+'] amt='+fmt2(amount));
      TradeBridge.arm(side, amount);
      var sent = HotkeyDriver.trade(side);
      if(!sent) console.warn('[OPEN][WARN] hotkey not delivered');
    }, 1000);

    console.log('[TRD][BOOT] auto-trade ON, CLOSE via legacy Trades observer only, gate=ON');
  })();

  // ===== Boot last =====
  if(!Balance.getTarget()){ Balance.boot(); }
  console.log('[VERTER][BOOT]', VER);

  // ===== Global stop =====
  window.__verterStopAll=function(){
    console.log('[VERTER] stopped');
    return {};
  };
})();

