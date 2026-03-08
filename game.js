"use strict";

const isCompactMobile = window.matchMedia("(max-width: 640px)").matches;

const CONFIG = {
  gridSize: 20,
  boardCols: isCompactMobile ? 16 : 20,
  boardRows: isCompactMobile ? 22 : 28,
  tickMsBase: 130,
  powerupDurationMs: 6000,
  powerupSpawnChance: 0.35,
  pointsFood: 10,
  pointsBonusPowerup: 25,
  swipeThresholdPx: isCompactMobile ? 18 : 24,
  colors: {
    grid: "rgba(111, 176, 255, 0.08)",
    snake: "#66ffd6",
    snakeHead: "#c2fff0",
    food: "#ff8ca3",
    speed: "#ffd966",
    slow: "#8db7ff",
    bonus: "#c596ff",
    shrink: "#ffb86b",
  },
};

const DIRECTION_VECTORS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const OPPOSITE_DIRECTION = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

const POWERUPS = ["speed", "slow", "bonus", "shrink"];

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const scoreValue = document.getElementById("scoreValue");
const bestValue = document.getElementById("bestValue");
const effectChip = document.getElementById("effectChip");
const startOverlay = document.getElementById("startOverlay");
const gameOverOverlay = document.getElementById("gameOverOverlay");
const finalScore = document.getElementById("finalScore");
const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");
const helpBtn = document.getElementById("helpBtn");
const helpPanel = document.getElementById("helpPanel");
const closeHelpBtn = document.getElementById("closeHelpBtn");

const state = {
  snake: [],
  direction: "right",
  queuedDirection: null,
  food: null,
  powerup: null,
  activeEffects: {
    timed: null,
    instant: null,
  },
  score: 0,
  bestScore: 0,
  status: "idle",
  tickMs: CONFIG.tickMsBase,
  lastTickAt: 0,
  accumulatorMs: 0,
  rafId: 0,
  pausedBeforeHidden: false,
  touchStart: null,
};

function loadBestScore() {
  try {
    const saved = window.localStorage.getItem("neon-snake-best");
    const parsed = Number.parseInt(saved, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch (_err) {
    return 0;
  }
}

function saveBestScore() {
  try {
    window.localStorage.setItem("neon-snake-best", String(state.bestScore));
  } catch (_err) {
    // Ignore quota/privacy errors and keep game playable.
  }
}

function resizeCanvas() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.style.aspectRatio = `${CONFIG.boardCols} / ${CONFIG.boardRows}`;
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function initGame() {
  state.bestScore = loadBestScore();
  bestValue.textContent = String(state.bestScore);
  restartGame();
  state.status = "idle";
  startOverlay.classList.add("visible");
  gameOverOverlay.classList.remove("visible");
  resizeCanvas();
  render();
  startLoop();
}

function startGame() {
  state.status = "running";
  state.lastTickAt = performance.now();
  state.accumulatorMs = 0;
  startOverlay.classList.remove("visible");
  gameOverOverlay.classList.remove("visible");
}

function restartGame() {
  const midY = Math.floor(CONFIG.boardRows / 2);
  const midX = Math.floor(CONFIG.boardCols / 2);

  state.snake = [
    { x: midX - 1, y: midY },
    { x: midX - 2, y: midY },
    { x: midX - 3, y: midY },
  ];
  state.direction = "right";
  state.queuedDirection = null;
  state.food = null;
  state.powerup = null;
  state.activeEffects.timed = null;
  state.activeEffects.instant = null;
  state.score = 0;
  state.tickMs = CONFIG.tickMsBase;
  state.accumulatorMs = 0;
  scoreValue.textContent = "0";
  finalScore.textContent = "0";
  updateEffectChip();
  spawnFood();
}

function randomCell() {
  return {
    x: Math.floor(Math.random() * CONFIG.boardCols),
    y: Math.floor(Math.random() * CONFIG.boardRows),
  };
}

function isCellOnSnake(cell) {
  return state.snake.some((seg) => seg.x === cell.x && seg.y === cell.y);
}

function isSameCell(a, b) {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

function spawnFood() {
  let next = randomCell();
  let guard = 0;
  while ((isCellOnSnake(next) || isSameCell(next, state.powerup)) && guard < 500) {
    next = randomCell();
    guard += 1;
  }
  state.food = next;
}

function spawnPowerup() {
  if (state.powerup || Math.random() > CONFIG.powerupSpawnChance) {
    return;
  }
  const type = POWERUPS[Math.floor(Math.random() * POWERUPS.length)];
  let next = randomCell();
  let guard = 0;
  while ((isCellOnSnake(next) || isSameCell(next, state.food)) && guard < 500) {
    next = randomCell();
    guard += 1;
  }
  state.powerup = { ...next, type };
}

function recalculateTickMs() {
  let nextTick = CONFIG.tickMsBase;
  const timed = state.activeEffects.timed;
  if (timed?.type === "speed") {
    nextTick = Math.round(CONFIG.tickMsBase * 0.8);
  } else if (timed?.type === "slow") {
    nextTick = Math.round(CONFIG.tickMsBase * 1.25);
  }
  state.tickMs = nextTick;
}

function applyPowerup(type) {
  if (type === "bonus") {
    state.score += CONFIG.pointsBonusPowerup;
    scoreValue.textContent = String(state.score);
    state.activeEffects.instant = {
      label: "+25 Bonus",
      color: "rgba(197, 150, 255, 0.95)",
      expiresAt: performance.now() + 1200,
    };
    updateEffectChip();
    return;
  }
  if (type === "shrink") {
    if (state.snake.length > 3) {
      const removable = Math.min(3, state.snake.length - 3);
      state.snake.splice(state.snake.length - removable, removable);
    }
    state.activeEffects.instant = {
      label: "Shrink -3",
      color: "rgba(255, 184, 107, 0.95)",
      expiresAt: performance.now() + 1200,
    };
    updateEffectChip();
    return;
  }
  state.activeEffects.timed = {
    type,
    expiresAt: performance.now() + CONFIG.powerupDurationMs,
  };
  recalculateTickMs();
  updateEffectChip();
}

function clearExpiredEffects(nowMs) {
  const timed = state.activeEffects.timed;
  const instant = state.activeEffects.instant;
  if (instant && nowMs >= instant.expiresAt) {
    state.activeEffects.instant = null;
  }
  if (!timed) {
    return;
  }
  if (nowMs >= timed.expiresAt) {
    state.activeEffects.timed = null;
    recalculateTickMs();
    updateEffectChip();
  }
}

function wrapPosition(pos) {
  return {
    x: (pos.x + CONFIG.boardCols) % CONFIG.boardCols,
    y: (pos.y + CONFIG.boardRows) % CONFIG.boardRows,
  };
}

function checkCollision(nextHead, willGrow) {
  const bodyToCheck = willGrow ? state.snake : state.snake.slice(0, -1);
  return bodyToCheck.some((seg) => seg.x === nextHead.x && seg.y === nextHead.y);
}

function handleDirectionInput(nextDirection) {
  if (!DIRECTION_VECTORS[nextDirection]) {
    return;
  }
  const current = state.queuedDirection || state.direction;
  if (OPPOSITE_DIRECTION[current] === nextDirection) {
    return;
  }
  state.queuedDirection = nextDirection;
}

function endGame() {
  state.status = "gameover";
  finalScore.textContent = String(state.score);
  if (state.score > state.bestScore) {
    state.bestScore = state.score;
    bestValue.textContent = String(state.bestScore);
    saveBestScore();
  }
  gameOverOverlay.classList.add("visible");
}

function updateGame(deltaMs) {
  if (state.status !== "running") {
    return;
  }

  state.accumulatorMs += deltaMs;
  clearExpiredEffects(performance.now());

  while (state.accumulatorMs >= state.tickMs) {
    state.accumulatorMs -= state.tickMs;

    if (state.queuedDirection) {
      state.direction = state.queuedDirection;
      state.queuedDirection = null;
    }

    const vec = DIRECTION_VECTORS[state.direction];
    const currentHead = state.snake[0];
    const rawNextHead = {
      x: currentHead.x + vec.x,
      y: currentHead.y + vec.y,
    };
    const nextHead = wrapPosition(rawNextHead);
    const willEatFood = isSameCell(nextHead, state.food);

    if (checkCollision(nextHead, willEatFood)) {
      endGame();
      break;
    }

    state.snake.unshift(nextHead);

    if (willEatFood) {
      state.score += CONFIG.pointsFood;
      scoreValue.textContent = String(state.score);
      spawnFood();
      spawnPowerup();
    } else {
      state.snake.pop();
    }

    if (state.powerup && isSameCell(nextHead, state.powerup)) {
      const type = state.powerup.type;
      state.powerup = null;
      applyPowerup(type);
    }
  }
}

function drawRoundedCell(x, y, size, radius, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + size - radius, y);
  ctx.quadraticCurveTo(x + size, y, x + size, y + radius);
  ctx.lineTo(x + size, y + size - radius);
  ctx.quadraticCurveTo(x + size, y + size, x + size - radius, y + size);
  ctx.lineTo(x + radius, y + size);
  ctx.quadraticCurveTo(x, y + size, x, y + size - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}

function renderGrid(cellSize) {
  ctx.strokeStyle = CONFIG.colors.grid;
  ctx.lineWidth = 1;
  for (let c = 1; c < CONFIG.boardCols; c += 1) {
    const x = c * cellSize;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CONFIG.boardRows * cellSize);
    ctx.stroke();
  }
  for (let r = 1; r < CONFIG.boardRows; r += 1) {
    const y = r * cellSize;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CONFIG.boardCols * cellSize, y);
    ctx.stroke();
  }
}

function renderObjects(cellSize) {
  if (state.food) {
    const fx = state.food.x * cellSize;
    const fy = state.food.y * cellSize;
    drawRoundedCell(fx + 2, fy + 2, cellSize - 4, 7, CONFIG.colors.food);
  }

  if (state.powerup) {
    const px = state.powerup.x * cellSize;
    const py = state.powerup.y * cellSize;
    const color =
      state.powerup.type === "speed"
        ? CONFIG.colors.speed
        : state.powerup.type === "slow"
          ? CONFIG.colors.slow
          : state.powerup.type === "bonus"
            ? CONFIG.colors.bonus
            : CONFIG.colors.shrink;
    drawRoundedCell(px + 2, py + 2, cellSize - 4, 9, color);
  }

  state.snake.forEach((segment, index) => {
    const x = segment.x * cellSize;
    const y = segment.y * cellSize;
    const color = index === 0 ? CONFIG.colors.snakeHead : CONFIG.colors.snake;
    drawRoundedCell(x + 1.5, y + 1.5, cellSize - 3, index === 0 ? 8 : 6, color);
  });
}

function render() {
  const cellSize = Math.floor(
    Math.min(canvas.clientWidth / CONFIG.boardCols, canvas.clientHeight / CONFIG.boardRows)
  );
  const drawWidth = cellSize * CONFIG.boardCols;
  const drawHeight = cellSize * CONFIG.boardRows;

  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.fillStyle = "#031428";
  ctx.fillRect(0, 0, drawWidth, drawHeight);

  renderGrid(cellSize);
  renderObjects(cellSize);
  updateEffectChip();
}

function updateEffectChip() {
  const instant = state.activeEffects.instant;
  if (instant && performance.now() < instant.expiresAt) {
    effectChip.textContent = instant.label;
    effectChip.style.borderColor = instant.color;
    return;
  }

  const timed = state.activeEffects.timed;
  if (!timed) {
    effectChip.textContent = "No effect";
    effectChip.style.borderColor = "rgba(154, 233, 255, 0.45)";
    return;
  }

  const msLeft = Math.max(0, timed.expiresAt - performance.now());
  const secs = (msLeft / 1000).toFixed(1);
  const label = timed.type === "speed" ? "Speed" : "Slow";
  effectChip.textContent = `${label} ${secs}s`;
  effectChip.style.borderColor =
    timed.type === "speed" ? "rgba(255, 217, 102, 0.9)" : "rgba(141, 183, 255, 0.9)";
}

function openHelpPanel() {
  helpPanel.hidden = false;
}

function closeHelpPanel() {
  helpPanel.hidden = true;
}

function frame(now) {
  const deltaMs = Math.min(48, now - state.lastTickAt || 0);
  state.lastTickAt = now;
  updateGame(deltaMs);
  render();
  state.rafId = requestAnimationFrame(frame);
}

function startLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
  }
  state.lastTickAt = performance.now();
  state.rafId = requestAnimationFrame(frame);
}

function getDirectionFromSwipe(dx, dy) {
  if (Math.abs(dx) < CONFIG.swipeThresholdPx && Math.abs(dy) < CONFIG.swipeThresholdPx) {
    return null;
  }
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? "right" : "left";
  }
  return dy > 0 ? "down" : "up";
}

function setupInputHandlers() {
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const mapping = {
      arrowup: "up",
      w: "up",
      arrowdown: "down",
      s: "down",
      arrowleft: "left",
      a: "left",
      arrowright: "right",
      d: "right",
    };
    const dir = mapping[key];
    if (!dir) {
      return;
    }
    event.preventDefault();
    handleDirectionInput(dir);
    if (state.status === "idle") {
      startGame();
    }
  });

  canvas.addEventListener(
    "touchstart",
    (event) => {
      const t = event.changedTouches[0];
      state.touchStart = { x: t.clientX, y: t.clientY };
    },
    { passive: true }
  );

  canvas.addEventListener(
    "touchmove",
    (event) => {
      event.preventDefault();
    },
    { passive: false }
  );

  canvas.addEventListener(
    "touchend",
    (event) => {
      if (!state.touchStart) {
        return;
      }
      const t = event.changedTouches[0];
      const dx = t.clientX - state.touchStart.x;
      const dy = t.clientY - state.touchStart.y;
      state.touchStart = null;
      const dir = getDirectionFromSwipe(dx, dy);
      if (!dir) {
        return;
      }
      handleDirectionInput(dir);
      if (state.status === "idle") {
        startGame();
      }
    },
    { passive: true }
  );

  startBtn.addEventListener("click", () => {
    if (state.status !== "running") {
      restartGame();
      startGame();
    }
  });

  restartBtn.addEventListener("click", () => {
    restartGame();
    startGame();
  });

  helpBtn.addEventListener("click", () => {
    openHelpPanel();
  });

  closeHelpBtn.addEventListener("click", () => {
    closeHelpPanel();
  });

  helpPanel.addEventListener("click", (event) => {
    if (event.target === helpPanel) {
      closeHelpPanel();
    }
  });

  window.addEventListener("resize", () => {
    resizeCanvas();
    render();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.status === "running") {
      state.status = "paused";
      state.pausedBeforeHidden = true;
      return;
    }
    if (!document.hidden && state.pausedBeforeHidden) {
      state.pausedBeforeHidden = false;
      state.status = "running";
      state.lastTickAt = performance.now();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !helpPanel.hidden) {
      closeHelpPanel();
    }
  });
}

setupInputHandlers();
initGame();
