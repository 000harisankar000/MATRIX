'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const query = new URLSearchParams(window.location.search);
  const queryTarget = safeDecode(query.get('target') || '');
  const queryMode = query.get('mode') === 'snake' ? 'snake' : 'text';

  const blockTitle = document.getElementById('block-title');
  const targetDomain = document.getElementById('target-domain');
  const modeReadout = document.getElementById('mode-readout');
  const textMode = document.getElementById('text-mode');
  const snakeMode = document.getElementById('snake-mode');
  const warningOutput = document.getElementById('warning-output');
  const terminalPath = document.getElementById('terminal-path');
  const terminalState = document.getElementById('terminal-state');
  const matrixCanvas = document.getElementById('matrix-rain');
  const newTabClose = document.getElementById('new-tab-close');
  const snakeCanvas = document.getElementById('snake-canvas');
  const scoreElement = document.getElementById('score');
  const gameStatus = document.getElementById('game-status');
  const overlay = document.getElementById('game-overlay');
  const proceedButton = document.getElementById('proceed-button');

  let destinationUrl = extractOriginalUrlFromHash();
  let requestedTarget = normalizeDomain(queryTarget);
  let mode = queryMode;

  function safeDecode(value) {
    try {
      return decodeURIComponent(value);
    } catch (_error) {
      return value;
    }
  }

  function extractOriginalUrlFromHash() {
    try {
      const raw = window.location.hash.slice(1);
      if (!raw) return '';
      return raw.startsWith('http://') || raw.startsWith('https://') ? raw : safeDecode(raw);
    } catch (_error) {
      return '';
    }
  }

  function normalizeDomain(value) {
    try {
      let domain = String(value || '').trim().toLowerCase();
      if (!domain) return '';

      if (domain.includes('://')) domain = new URL(domain).hostname;
      domain = domain
        .replace(/^\*\./, '')
        .replace(/^www\./, '')
        .replace(/\.$/, '');

      return /^[a-z0-9.-]+$/.test(domain) ? domain : '';
    } catch (_error) {
      return '';
    }
  }

  function domainFromUrl(url) {
    try {
      return normalizeDomain(new URL(url).hostname);
    } catch (_error) {
      return '';
    }
  }

  function getSiteWarning(blockedSites, domain) {
    if (!Array.isArray(blockedSites)) return '';
    const match = blockedSites.find((site) => site.domain === domain);
    return typeof match?.warningText === 'string' ? match.warningText : '';
  }

  function setTargetDisplay(domain) {
    targetDomain.textContent = domain || 'unknown';
  }

  function renderTextMode(globalWarning, siteWarning) {
    const warning =
      siteWarning.trim() || globalWarning.trim() || 'ACCESS DENIED.';
    warningOutput.textContent = warning;
    terminalPath.textContent = `/focus/terminal/${requestedTarget || 'unknown'}`;
    terminalState.textContent = 'HARD BLOCK';
    blockTitle.textContent = 'ACCESS BLOCKED';
    modeReadout.textContent = 'MODE: TEXT WARNING';
  }

  async function loadPendingNavigationContext() {
    try {
      const currentTab = await new Promise((resolve) => {
        chrome.tabs.getCurrent((tab) => resolve(tab || null));
      });

      const tabId = currentTab?.id;
      if (typeof tabId !== 'number') return null;

      const response = await chrome.runtime.sendMessage({
        action: 'GET_BLOCK_CONTEXT',
        tabId
      });

      if (!response?.ok || !response.context) return null;

      destinationUrl = response.context.url || destinationUrl;
      requestedTarget = normalizeDomain(response.context.domain) || requestedTarget;
      mode = response.context.mode === 'snake' ? 'snake' : 'text';
      return response.context;
    } catch (error) {
      console.error('[Matrix block] Pending navigation context failed:', error);
      return null;
    }
  }

  async function loadContext() {
    try {
      await loadPendingNavigationContext();
      const response = await chrome.runtime.sendMessage({ action: 'GET_STATE' });
      const state = response?.ok ? response.state : null;

      if (!requestedTarget && destinationUrl) {
        requestedTarget = domainFromUrl(destinationUrl);
      }

      if (!requestedTarget) requestedTarget = 'unknown';

      // The service worker captures the exact navigation before DNR redirects
      // into this packaged page. Query parameters remain supported as a fallback.
      const configured = Array.isArray(state?.blockedSites)
        ? state.blockedSites.find((site) => site.domain === requestedTarget)
        : null;

      if (!query.get('target') && configured?.domain) {
        requestedTarget = configured.domain;
      }

      if (!query.get('mode')) {
        mode = configured?.mode === 'snake' ? 'snake' : 'text';
      }

      setTargetDisplay(requestedTarget);

      if (mode === 'text') {
        textMode.hidden = false;
        snakeMode.hidden = true;
        renderTextMode(
          state?.globalWarningText || '',
          getSiteWarning(state?.blockedSites, requestedTarget)
        );
        return;
      }

      textMode.hidden = true;
      snakeMode.hidden = false;
      modeReadout.textContent = 'MODE: SNAKE GAME';
      blockTitle.textContent = 'ACCESS CHALLENGE';
      gameStatus.textContent = destinationUrl
        ? 'USE ARROW KEYS TO MOVE'
        : 'DESTINATION URL NOT CAPTURED — DOMAIN ROOT WILL BE USED';
    } catch (error) {
      console.error('[Matrix block] Context load failed:', error);
      setTargetDisplay(requestedTarget || domainFromUrl(destinationUrl) || 'unknown');
      textMode.hidden = mode !== 'snake';
      snakeMode.hidden = mode === 'snake';
      if (mode === 'text') {
        renderTextMode('', 'ACCESS DENIED.');
      } else {
        blockTitle.textContent = 'ACCESS CHALLENGE';
      }
    }
  }

  function resizeMatrixCanvas() {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    matrixCanvas.width = Math.floor(window.innerWidth * dpr);
    matrixCanvas.height = Math.floor(window.innerHeight * dpr);
  }

  function startMatrixRain() {
    resizeMatrixCanvas();

    const ctx = matrixCanvas.getContext('2d');
    if (!ctx) return;

    let fontSize = window.innerWidth < 600 ? 11 : 14;
    let columns = Math.ceil(window.innerWidth / fontSize);
    let drops = Array.from({ length: columns }, () => Math.random() * -40);
    const glyphs = '01アイウエオカキクケコサシスセソ'.split('');

    function draw() {
      const scaleX = matrixCanvas.width / window.innerWidth;
      const scaleY = matrixCanvas.height / window.innerHeight;
      ctx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.font = `${fontSize}px monospace`;
      ctx.fillStyle = 'rgba(57, 255, 20, 0.22)';

      for (let index = 0; index < drops.length; index += 1) {
        const glyph = glyphs[Math.floor(Math.random() * glyphs.length)];
        ctx.fillText(glyph, index * fontSize, drops[index] * fontSize);

        if (
          drops[index] * fontSize > window.innerHeight &&
          Math.random() > 0.97
        ) {
          drops[index] = Math.random() * -18;
        }

        drops[index] += 0.55;
      }

      window.requestAnimationFrame(draw);
    }

    window.addEventListener('resize', () => {
      resizeMatrixCanvas();
      fontSize = window.innerWidth < 600 ? 11 : 14;
      columns = Math.ceil(window.innerWidth / fontSize);
      drops = Array.from({ length: columns }, () => Math.random() * -40);
    });

    draw();
  }

  function initSnakeGame() {
    const ctx = snakeCanvas.getContext('2d');
    if (!ctx) {
      gameStatus.textContent = 'CANVAS ERROR — RELOAD THE EXTENSION';
      return;
    }

    const gridSize = 20;
    const columns = Math.floor(snakeCanvas.width / gridSize);
    const rows = Math.floor(snakeCanvas.height / gridSize);
    const targetScore = 10;

    let snake = [
      { x: 8, y: 9 },
      { x: 7, y: 9 },
      { x: 6, y: 9 }
    ];
    let direction = { x: 1, y: 0 };
    let queuedDirection = { x: 1, y: 0 };
    let food = placeFood();
    let score = 0;
    let timer = null;
    let running = true;

    function samePosition(a, b) {
      return a.x === b.x && a.y === b.y;
    }

    function placeFood() {
      for (let attempts = 0; attempts < 200; attempts += 1) {
        const candidate = {
          x: Math.floor(Math.random() * columns),
          y: Math.floor(Math.random() * rows)
        };
        if (!snake.some((segment) => samePosition(segment, candidate))) {
          return candidate;
        }
      }
      return { x: 1, y: 1 };
    }

    function canTurn(next) {
      return !(next.x === -direction.x && next.y === -direction.y);
    }

    function updateScore() {
      scoreElement.textContent = `${score} / ${targetScore}`;
    }

    function drawGrid() {
      ctx.fillStyle = '#020602';
      ctx.fillRect(0, 0, snakeCanvas.width, snakeCanvas.height);
      ctx.strokeStyle = 'rgba(57, 255, 20, 0.06)';
      ctx.lineWidth = 1;

      for (let x = 0; x <= snakeCanvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, snakeCanvas.height);
        ctx.stroke();
      }

      for (let y = 0; y <= snakeCanvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(snakeCanvas.width, y);
        ctx.stroke();
      }
    }

    function drawFood() {
      ctx.fillStyle = '#ff4040';
      ctx.shadowColor = '#ff4040';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(
        food.x * gridSize + gridSize / 2,
        food.y * gridSize + gridSize / 2,
        6,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    function drawSnake() {
      snake.forEach((segment, index) => {
        ctx.fillStyle = index === 0 ? '#b4ff9f' : '#39ff14';
        ctx.shadowColor = '#39ff14';
        ctx.shadowBlur = index === 0 ? 15 : 8;
        ctx.fillRect(
          segment.x * gridSize + 2,
          segment.y * gridSize + 2,
          gridSize - 4,
          gridSize - 4
        );
      });
      ctx.shadowBlur = 0;
    }

    function draw() {
      drawGrid();
      drawFood();
      drawSnake();
    }

    function stopWithAuthorization() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      blockTitle.textContent = 'ACCESS AUTHORIZED';
      gameStatus.textContent = 'UNLOCK GRANTED — DESTINATION HANDOFF READY';
      overlay.hidden = false;
      proceedButton.hidden = false;
      proceedButton.focus();
    }

    function resetAfterCollision() {
      snake = [
        { x: 8, y: 9 },
        { x: 7, y: 9 },
        { x: 6, y: 9 }
      ];
      direction = { x: 1, y: 0 };
      queuedDirection = { x: 1, y: 0 };
      food = placeFood();
      score = 0;
      updateScore();
      gameStatus.textContent = 'SEQUENCE RESET — KEEP MOVING';
      draw();
    }

    function tick() {
      if (!running) return;

      direction = queuedDirection;
      const head = snake[0];
      const nextHead = {
        x: (head.x + direction.x + columns) % columns,
        y: (head.y + direction.y + rows) % rows
      };

      const willEat = samePosition(nextHead, food);
      const bodyToCheck = willEat ? snake : snake.slice(0, -1);

      if (bodyToCheck.some((segment) => samePosition(segment, nextHead))) {
        resetAfterCollision();
        return;
      }

      snake.unshift(nextHead);

      if (willEat) {
        score += 1;
        updateScore();

        if (score >= targetScore) {
          draw();
          stopWithAuthorization();
          return;
        }

        food = placeFood();
      } else {
        snake.pop();
      }

      draw();
    }

    document.addEventListener('keydown', (event) => {
      const directions = {
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 }
      };

      const next = directions[event.key];
      if (!next || !running) return;

      event.preventDefault();
      if (canTurn(next)) queuedDirection = next;
      snakeCanvas.focus();
    });

    draw();
    updateScore();
    snakeCanvas.focus();
    timer = setInterval(tick, 115);
  }

  proceedButton.addEventListener('click', async () => {
    if (mode !== 'snake') return;

    proceedButton.disabled = true;
    gameStatus.textContent = 'TEMPORARILY DISARMING DOMAIN FILTER…';

    try {
      const domain = normalizeDomain(requestedTarget);
      const response = await chrome.runtime.sendMessage({
        action: 'TEMPORARY_ALLOW',
        domain
      });

      if (!response?.ok) {
        throw new Error(response?.error || 'Could not arm destination handoff.');
      }

      const target = destinationUrl || (domain ? `https://${domain}/` : '');
      if (!target) throw new Error('Destination URL is unavailable.');

      window.location.href = target;
    } catch (error) {
      proceedButton.disabled = false;
      gameStatus.textContent = `HANDOFF ERROR — ${error.message}`;
      console.error('[Matrix block] Proceed failed:', error);
    }
  });

  newTabClose.addEventListener('click', async () => {
    try {
      const currentTab = await new Promise((resolve) => {
        chrome.tabs.getCurrent((tab) => resolve(tab || null));
      });

      const currentId = currentTab?.id;
      const createOptions =
        typeof currentTab?.windowId === 'number'
          ? { windowId: currentTab.windowId, active: true }
          : { active: true };

      await chrome.tabs.create(createOptions);

      if (typeof currentId === 'number') {
        await chrome.tabs.remove(currentId);
      }
    } catch (error) {
      console.error('[Matrix block] New-tab handoff failed:', error);
      gameStatus.textContent = 'COULD NOT CLOSE THIS TAB — USE CTRL+W';
    }
  });

  void (async () => {
    startMatrixRain();
    await loadContext();
    if (mode === 'snake') initSnakeGame();
  })();
});
