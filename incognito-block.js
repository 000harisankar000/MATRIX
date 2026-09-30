'use strict';

(() => {
  // This content script is deliberately an Incognito-only fallback.
  // Normal tabs continue using declarativeNetRequest.
  if (!chrome.extension?.inIncognitoContext) return;
  if (!/^https?:$/i.test(location.protocol)) return;

  const destinationUrl = location.href;
  const hostname = String(location.hostname || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!hostname) return;

  let rendered = false;
  let gameTimer = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  const css = `
    :host, * { box-sizing:border-box; }
    html,body { margin:0 !important; padding:0 !important; min-height:100% !important; }
    body { background:#000 !important; color:#e8f5e8 !important; font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important; }
    #mfi-root { min-height:100vh; background:#000; color:#e8f5e8; position:relative; overflow:hidden; }
    #mfi-rain { position:fixed; inset:0; width:100vw; height:100vh; pointer-events:none; opacity:.72; z-index:0; }
    .mfi-vig { position:fixed; inset:0; pointer-events:none; z-index:1; background:radial-gradient(circle at center,transparent 35%,rgba(0,0,0,.78) 100%); }
    .mfi-page { position:relative; z-index:2; width:min(1020px,calc(100% - 34px)); min-height:100vh; margin:0 auto; display:grid; align-content:center; gap:18px; padding:28px 0; }
    .mfi-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; padding-bottom:16px; border-bottom:1px solid rgba(57,255,20,.2); }
    .mfi-eye,.mfi-kicker { margin:0; color:#70ad70; font:800 9px/1.3 monospace; letter-spacing:.16em; text-transform:uppercase; }
    h1 { margin:5px 0 0; color:#efffec; font-size:clamp(34px,7vw,66px); letter-spacing:-.04em; text-shadow:0 0 28px rgba(57,255,20,.2); }
    .mfi-target { display:grid; gap:5px; padding:11px 13px; border:1px solid rgba(57,255,20,.22); border-radius:11px; background:rgba(0,4,0,.86); text-align:right; }
    .mfi-target code { max-width:min(42vw,350px); overflow:hidden; color:#39ff14; font:800 12px/1.3 monospace; text-overflow:ellipsis; white-space:nowrap; }
    .mfi-panel { border:1px solid rgba(57,255,20,.24); border-radius:16px; background:rgba(1,5,2,.94); box-shadow:0 24px 70px rgba(0,0,0,.48),0 0 30px rgba(57,255,20,.04); overflow:hidden; }
    .mfi-top { display:grid; grid-template-columns:1fr auto; gap:12px; align-items:center; padding:10px 13px; border-bottom:1px solid rgba(57,255,20,.18); background:rgba(9,15,9,.9); color:#789078; font:800 9px/1 monospace; letter-spacing:.08em; }
    .mfi-body { padding:clamp(22px,4vw,40px); }
    .mfi-prompt { margin:0 0 18px; color:#39ff14; font:800 12px/1.5 monospace; }
    .mfi-warning { margin:0; color:#d9ffd1; white-space:pre-wrap; overflow-wrap:anywhere; font:500 clamp(18px,3vw,28px)/1.45 monospace; text-shadow:0 0 14px rgba(57,255,20,.11); }
    .mfi-note { margin:28px 0 0; padding-top:17px; border-top:1px solid rgba(57,255,20,.14); color:#8ca18c; font:800 9px/1.5 monospace; letter-spacing:.08em; }
    .mfi-snake { padding:22px; }
    .mfi-intro { display:flex; align-items:center; justify-content:space-between; gap:18px; margin-bottom:16px; }
    .mfi-intro h2 { margin:5px 0; font-size:clamp(20px,3vw,28px); }
    .mfi-muted { color:#789078; margin:0; }
    .mfi-score { min-width:112px; padding:10px 12px; border:1px solid rgba(57,255,20,.22); border-radius:10px; background:#030703; text-align:right; }
    .mfi-score span { display:block; color:#789078; font:800 8px/1 monospace; letter-spacing:.08em; }
    .mfi-score strong { display:block; margin-top:6px; color:#39ff14; font:900 20px/1 monospace; }
    .mfi-frame { position:relative; overflow:hidden; border:1px solid rgba(57,255,20,.18); border-radius:12px; background:#010201; }
    #mfi-game { display:block; width:100%; height:auto; max-height:55vh; image-rendering:pixelated; outline:none; }
    .mfi-actions { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:14px; flex-wrap:wrap; }
    button { min-height:44px; padding:0 14px; border:1px solid #39ff14; border-radius:10px; background:#071008; color:#39ff14; font:800 11px/1 monospace; letter-spacing:.08em; text-transform:uppercase; cursor:pointer; }
    button:disabled { opacity:.55; cursor:wait; }
    .mfi-status { color:#789078; font:800 9px/1.5 monospace; letter-spacing:.06em; }
    .mfi-overlay { position:absolute; inset:0; display:grid; place-items:center; padding:20px; background:rgba(0,4,0,.78); }
    .mfi-dialog { width:min(460px,100%); padding:24px; border:1px solid #39ff14; border-radius:14px; background:rgba(2,9,3,.97); }
    .mfi-dialog strong { display:block; margin-top:6px; font-size:22px; }
    .mfi-footer { display:flex; justify-content:space-between; gap:12px; color:#789078; font:700 8px/1.4 monospace; letter-spacing:.08em; }
    @media (max-width:700px){ .mfi-head,.mfi-intro{flex-direction:column}.mfi-target{text-align:left;width:100%}.mfi-target code{max-width:100%}.mfi-footer{flex-direction:column} }
  `;

  function buildBase() {
    if (rendered) return;
    rendered = true;
    document.documentElement.innerHTML = `
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ACCESS BLOCKED</title></head>
      <body><div id="mfi-root"><canvas id="mfi-rain" aria-hidden="true"></canvas><div class="mfi-vig" aria-hidden="true"></div><main class="mfi-page"><header class="mfi-head"><div><p class="mfi-eye">MATRIX // INCOGNITO INTERCEPT</p><h1 id="mfi-title">ACCESS BLOCKED</h1></div><div class="mfi-target"><span class="mfi-kicker">TARGET</span><code>${esc(hostname)}</code></div></header><section id="mfi-panel" class="mfi-panel"></section><footer class="mfi-footer"><span>HARD BLOCK // LOCAL FALLBACK</span><span>INCOGNITO: ACTIVE</span></footer></main></div></body>`;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    startRain();
  }

  function startRain() {
    const canvas = document.getElementById('mfi-rain');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let size = innerWidth < 600 ? 11 : 14;
    let cols = Math.ceil(innerWidth / size);
    let drops = Array.from({length:cols},()=>Math.random()*-40);
    const glyphs='01アイウエオカキクケコサシスセソ'.split('');
    const resize=()=>{ const dpr=Math.max(1,devicePixelRatio||1); canvas.width=Math.floor(innerWidth*dpr); canvas.height=Math.floor(innerHeight*dpr); size=innerWidth<600?11:14; cols=Math.ceil(innerWidth/size); drops=Array.from({length:cols},()=>Math.random()*-40); };
    addEventListener('resize',resize,{passive:true}); resize();
    const draw=()=>{ const sx=canvas.width/innerWidth, sy=canvas.height/innerHeight; ctx.setTransform(sx,0,0,sy,0,0); ctx.fillStyle='rgba(0,0,0,.08)'; ctx.fillRect(0,0,innerWidth,innerHeight); ctx.font=`${size}px monospace`; ctx.fillStyle='rgba(57,255,20,.22)'; for(let i=0;i<drops.length;i++){ctx.fillText(glyphs[Math.floor(Math.random()*glyphs.length)],i*size,drops[i]*size); if(drops[i]*size>innerHeight&&Math.random()>.97)drops[i]=Math.random()*-18; drops[i]+=.55;} requestAnimationFrame(draw);}; draw();
  }

  function renderText(warning) {
    buildBase();
    const panel = document.getElementById('mfi-panel');
    panel.innerHTML = `<div class="mfi-top"><span>ROOT@MATRIX:~$ ACCESS_REQUEST --DENIED</span><span>HARD BLOCK</span></div><div class="mfi-body"><pre class="mfi-warning">${esc(warning || 'ACCESS DENIED.')}</pre><p class="mfi-note">NO PROCEED ACTION IS AVAILABLE. CLOSE THIS TAB TO EXIT.</p></div>`;
  }

  function renderSnake() {
    buildBase();
    const panel = document.getElementById('mfi-panel');
    panel.innerHTML = `<div class="mfi-snake"><div class="mfi-intro"><div><p class="mfi-kicker">CHALLENGE PROTOCOL</p><h2>Snake unlock sequence</h2><p class="mfi-muted">Collect red food nodes. Score 10 points to authorize one destination handoff.</p></div><div class="mfi-score"><span>SCORE</span><strong id="mfi-score">0 / 10</strong></div></div><div class="mfi-frame"><canvas id="mfi-game" width="560" height="360" tabindex="0"></canvas><div id="mfi-overlay" class="mfi-overlay" hidden><div class="mfi-dialog"><p class="mfi-kicker">PROTOCOL COMPLETE</p><strong>ACCESS AUTHORIZED</strong><p class="mfi-muted">Destination handoff unlocked for this blocked domain.</p></div></div></div><div class="mfi-actions"><button id="mfi-exit" type="button">EXIT TO NEW TAB</button><button id="mfi-proceed" type="button" hidden>PROCEED TO DESTINATION →</button><span id="mfi-status" class="mfi-status">USE ARROW KEYS TO MOVE</span></div></div>`;
    const canvas=document.getElementById('mfi-game'),ctx=canvas.getContext('2d'),scoreEl=document.getElementById('mfi-score'),status=document.getElementById('mfi-status'),overlay=document.getElementById('mfi-overlay'),proceed=document.getElementById('mfi-proceed'),exit=document.getElementById('mfi-exit');
    if(!ctx){renderText('CANVAS ERROR — RELOAD THE PAGE');return;}
    const g=20,c=28,r=18,target=10; let snake=[{x:8,y:9},{x:7,y:9},{x:6,y:9}],dir={x:1,y:0},queued={x:1,y:0},score=0,running=true;
    let food=placeFood();
    function same(a,b){return a.x===b.x&&a.y===b.y}
    function placeFood(){for(let i=0;i<200;i++){const f={x:Math.floor(Math.random()*c),y:Math.floor(Math.random()*r)};if(!snake.some(s=>same(s,f)))return f;}return {x:1,y:1}}
    function canTurn(n){return !(n.x===-dir.x&&n.y===-dir.y)}
    function draw(){ctx.fillStyle='#020602';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='rgba(57,255,20,.06)';for(let x=0;x<=canvas.width;x+=g){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke()}for(let y=0;y<=canvas.height;y+=g){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke()}ctx.fillStyle='#ff4040';ctx.shadowColor='#ff4040';ctx.shadowBlur=12;ctx.beginPath();ctx.arc(food.x*g+10,food.y*g+10,6,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;snake.forEach((s,i)=>{ctx.fillStyle=i?'#39ff14':'#b4ff9f';ctx.shadowColor='#39ff14';ctx.shadowBlur=i?8:15;ctx.fillRect(s.x*g+2,s.y*g+2,16,16)});ctx.shadowBlur=0}
    function updateScore(){scoreEl.textContent=`${score} / ${target}`}
    function stop(){running=false;if(gameTimer)clearInterval(gameTimer);gameTimer=null;overlay.hidden=false;proceed.hidden=false;document.getElementById('mfi-title').textContent='ACCESS AUTHORIZED';status.textContent='UNLOCK GRANTED — DESTINATION HANDOFF READY';proceed.focus()}
    function reset(){snake=[{x:8,y:9},{x:7,y:9},{x:6,y:9}];dir={x:1,y:0};queued={x:1,y:0};score=0;food=placeFood();updateScore();status.textContent='SEQUENCE RESET — KEEP MOVING';draw()}
    function tick(){if(!running)return;dir=queued;const h=snake[0],nh={x:(h.x+dir.x+c)%c,y:(h.y+dir.y+r)%r},eat=same(nh,food),body=eat?snake:snake.slice(0,-1);if(body.some(s=>same(s,nh))){reset();return}snake.unshift(nh);if(eat){score++;updateScore();if(score>=target){draw();stop();return}food=placeFood()}else snake.pop();draw()}
    addEventListener('keydown',e=>{const map={ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0}};const n=map[e.key];if(!n||!running)return;e.preventDefault();if(canTurn(n))queued=n},{capture:true});
    exit.addEventListener('click',()=>{open('', '_self');});
    proceed.addEventListener('click',async()=>{proceed.disabled=true;status.textContent='TEMPORARILY DISARMING DOMAIN FILTER…';try{const res=await chrome.runtime.sendMessage({action:'TEMPORARY_ALLOW',domain:hostname});if(!res?.ok)throw new Error(res?.error||'Could not arm destination handoff.');location.href=destinationUrl;}catch(err){proceed.disabled=false;status.textContent=`HANDOFF ERROR — ${err.message}`;}});
    canvas.focus();draw();updateScore();gameTimer=setInterval(tick,115);
  }

  chrome.runtime.sendMessage({action:'CHECK_BLOCK_STATUS', domain:hostname}).then((response)=>{
    if (!response?.ok || !response.blocked) return;
    if (response.mode === 'snake') renderSnake();
    else renderText(response.warningText || 'ACCESS DENIED.');
  }).catch(()=>{});
})();
