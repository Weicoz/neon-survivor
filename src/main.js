import { applyChoice, continueEndless, createWorld, syncStats, update } from './core/world.js';
import { UPGRADES, levelOf } from './core/upgrades.js';
import { clamp } from './core/mathx.js';
import { createRenderer } from './render/renderer.js';
import { createAudio } from './platform/audio.js';
import { createInput } from './platform/input.js';

const BEST_KEY = 'neon-survivor:best';
const MUTE_KEY = 'neon-survivor:muted';

const canvas = document.getElementById('game');
const els = {
  hpFill: document.getElementById('hpFill'),
  hpText: document.getElementById('hpText'),
  xpFill: document.getElementById('xpFill'),
  xpText: document.getElementById('xpText'),
  statTime: document.getElementById('statTime'),
  statKills: document.getElementById('statKills'),
  statScore: document.getElementById('statScore'),
  bossBar: document.getElementById('bossBar'),
  bossFill: document.getElementById('bossFill'),
  bossHpText: document.getElementById('bossHpText'),
  startOverlay: document.getElementById('startOverlay'),
  levelOverlay: document.getElementById('levelOverlay'),
  pauseOverlay: document.getElementById('pauseOverlay'),
  overOverlay: document.getElementById('overOverlay'),
  victoryOverlay: document.getElementById('victoryOverlay'),
  cards: document.getElementById('cards'),
  startBest: document.getElementById('startBest'),
  overResult: document.getElementById('overResult'),
  victoryResult: document.getElementById('victoryResult'),
  muteBtn: document.getElementById('muteBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  toast: document.getElementById('toast'),
  startBtn: document.getElementById('startBtn'),
  resumeBtn: document.getElementById('resumeBtn'),
  retryBtn: document.getElementById('retryBtn'),
  endlessBtn: document.getElementById('endlessBtn'),
  victoryRetryBtn: document.getElementById('victoryRetryBtn'),
};

const renderer = createRenderer(canvas);
const audio = createAudio();

const view = { width: window.innerWidth, height: window.innerHeight, dpr: 1 };
let world = createWorld({ width: view.width, height: view.height });
let started = false;
let paused = false;
let lastFrame = 0;
let overlayState = '';
let toastTimer = 0;
let best = loadBest();

const hud = { hp: '', xp: '', time: -1, kills: -1, score: -1, boss: -1 };

const input = createInput(canvas, {
  onPause: () => togglePause(),
  onMute: () => toggleMute(),
  onRestart: () => {
    if (started) startGame();
  },
  onQuickPick: (index) => pickCard(index),
  onAnyInput: () => audio.unlock(),
});

function loadBest() {
  try {
    const raw = localStorage.getItem(BEST_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Number.isFinite(parsed.score)) return parsed;
  } catch {
    /* 隐私模式下忽略存储错误 */
  }
  return { score: 0, time: 0, kills: 0, level: 1 };
}

function saveBest() {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch {
    /* 忽略 */
  }
}

function recordBest() {
  const score = Math.round(world.score);
  if (score <= (best.score ?? 0)) return;
  best = { score, time: Math.floor(world.time), kills: world.kills, level: world.player.level };
  saveBest();
  renderBestLabel();
  showToast('新纪录！');
}

function renderBestLabel() {
  if (!best || !best.score) {
    els.startBest.textContent = '最佳战绩：—';
    return;
  }
  els.startBest.textContent = `最佳战绩：${best.score} 分 · 存活 ${formatTime(best.time)} · 击杀 ${best.kills}`;
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function resize() {
  view.width = Math.max(320, window.innerWidth);
  view.height = Math.max(320, window.innerHeight);
  view.dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.resize(view.width, view.height, view.dpr);
  world.width = view.width;
  world.height = view.height;
  const p = world.player;
  p.x = clamp(p.x, p.radius, Math.max(p.radius, world.width - p.radius));
  p.y = clamp(p.y, p.radius, Math.max(p.radius, world.height - p.radius));
}

function startGame() {
  world = createWorld({
    seed: (Date.now() ^ 0x9e3779b9) >>> 0,
    width: view.width,
    height: view.height,
  });
  started = true;
  paused = false;
  overlayState = '';
  hud.time = -1;
  hud.kills = -1;
  hud.score = -1;
  lastFrame = performance.now();
  audio.unlock();
  showToast('武器已自动锁定，活过 90 秒');
}

function togglePause() {
  if (!started || world.state !== 'playing') return;
  paused = !paused;
}

function toggleMute() {
  const next = !audio.isMuted();
  audio.setMuted(next);
  els.muteBtn.textContent = next ? '🔇' : '🔊';
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    /* 忽略 */
  }
  showToast(next ? '已静音' : '已开启音效');
}

function pickCard(index) {
  if (world.state !== 'levelup') return;
  const choice = world.pendingChoices[index];
  if (!choice) return;
  if (applyChoice(world, choice.id)) showToast(`${choice.icon} ${choice.name} Lv.${levelOf(world.player.levels, choice.id)}`);
}

function drainEvents() {
  if (world.events.length === 0) return;
  for (const event of world.events) {
    audio.play(event);
    if (event.type === 'rush') showToast('敌群来袭');
  }
  world.events.length = 0;
}

function renderCards() {
  els.cards.textContent = '';
  const p = world.player;
  world.pendingChoices.forEach((choice, index) => {
    const lv = levelOf(p.levels, choice.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card';
    btn.innerHTML =
      `<span class="card__icon">${choice.icon}</span>` +
      `<span class="card__name">${choice.name}</span>` +
      `<span class="card__effect">${choice.effect}</span>` +
      `<span class="card__level">Lv.${lv} → Lv.${lv + 1} · 上限 ${choice.max}</span>`;
    btn.addEventListener('click', () => pickCard(index));
    els.cards.appendChild(btn);
  });
}

function resultPairs() {
  return [
    ['存活时间', formatTime(world.time)],
    ['击杀数', String(world.kills)],
    ['等级', `Lv.${world.player.level}`],
    ['分数', String(Math.round(world.score))],
    ['最佳分数', String(best.score ?? 0)],
    ['Boss 出场', `${world.bossCount} 次`],
  ];
}

function renderResult(target) {
  target.textContent = '';
  for (const [label, value] of resultPairs()) {
    const wrap = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    wrap.append(dt, dd);
    target.appendChild(wrap);
  }
}

function syncOverlays() {
  let state = 'start';
  if (started) state = paused ? 'pause' : world.state;
  if (state === overlayState) {
    if (state === 'levelup' && els.cards.childElementCount !== world.pendingChoices.length) renderCards();
    return;
  }
  overlayState = state;
  els.startOverlay.hidden = state !== 'start';
  els.pauseOverlay.hidden = state !== 'pause';
  els.levelOverlay.hidden = state !== 'levelup';
  els.overOverlay.hidden = state !== 'dead';
  els.victoryOverlay.hidden = state !== 'victory';

  if (state === 'levelup') renderCards();
  if (state === 'dead' || state === 'victory') {
    recordBest();
    renderResult(state === 'dead' ? els.overResult : els.victoryResult);
  }
}

function syncHud() {
  const p = world.player;
  const hpRatio = clamp(p.hp / p.maxHp, 0, 1);
  const hpKey = `${Math.round(hpRatio * 1000)}|${Math.round(p.hp)}|${p.maxHp}`;
  if (hud.hp !== hpKey) {
    hud.hp = hpKey;
    els.hpFill.style.width = `${hpRatio * 100}%`;
    els.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
  }

  const xpRatio = clamp(p.xp / p.xpNext, 0, 1);
  const xpKey = `${Math.round(xpRatio * 1000)}|${p.level}`;
  if (hud.xp !== xpKey) {
    hud.xp = xpKey;
    els.xpFill.style.width = `${xpRatio * 100}%`;
    els.xpText.textContent = `Lv.${p.level} · ${Math.floor(p.xp)}/${p.xpNext}`;
  }

  const seconds = Math.floor(world.time);
  if (hud.time !== seconds) {
    hud.time = seconds;
    els.statTime.textContent = formatTime(seconds);
  }
  if (hud.kills !== world.kills) {
    hud.kills = world.kills;
    els.statKills.textContent = String(world.kills);
  }
  const score = Math.round(world.score);
  if (hud.score !== score) {
    hud.score = score;
    els.statScore.textContent = String(score);
  }

  const boss = world.boss;
  els.bossBar.hidden = !boss;
  if (boss) {
    const ratio = clamp(boss.hp / boss.maxHp, 0, 1);
    const key = Math.round(ratio * 1000);
    if (hud.boss !== key) {
      hud.boss = key;
      els.bossFill.style.width = `${ratio * 100}%`;
      els.bossHpText.textContent = `${Math.ceil(boss.hp)} / ${Math.round(boss.maxHp)}`;
    }
  }
}

function showToast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 1800);
}

function frame(timestamp) {
  requestAnimationFrame(frame);
  const dt = lastFrame ? Math.min(0.05, (timestamp - lastFrame) / 1000) : 0.016;
  lastFrame = timestamp;

  if (started && !paused) {
    const move = input.move();
    update(world, dt, { mx: move.mx, my: move.my, dash: input.consumeDash() });
    drainEvents();
  } else {
    input.consumeDash();
  }

  renderer.draw(world, { width: view.width, height: view.height, joystick: input.joystick });
  syncHud();
  syncOverlays();
}

els.startBtn.addEventListener('click', startGame);
els.retryBtn.addEventListener('click', startGame);
els.victoryRetryBtn.addEventListener('click', startGame);
els.endlessBtn.addEventListener('click', () => {
  if (continueEndless(world)) showToast('下一波 Boss 将在 90 秒后抵达');
});
els.resumeBtn.addEventListener('click', () => {
  paused = false;
  overlayState = '';
});
els.pauseBtn.addEventListener('click', () => {
  if (!started) return;
  if (world.state === 'playing') paused = !paused;
  else if (world.state === 'levelup') paused = false;
});
els.muteBtn.addEventListener('click', toggleMute);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && started && world.state === 'playing') paused = true;
});
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);

// 调试钩子：仅在 ?debug=1 时暴露世界状态，方便自动化截图与平衡排查。
if (new URLSearchParams(window.location.search).has('debug')) {
  window.__neon = {
    get world() {
      return world;
    },
    start: startGame,
    grantAll() {
      for (const u of UPGRADES) world.player.levels[u.id] = u.max;
      syncStats(world);
      world.player.hp = world.player.maxHp;
      return { ...world.player.levels };
    },
    step(seconds = 1) {
      const frames = Math.round(seconds * 60);
      for (let i = 0; i < frames; i += 1) {
        update(world, 1 / 60, { mx: 0, my: 0 });
        if (world.state === 'levelup') applyChoice(world, world.pendingChoices[0].id);
      }
      return { time: world.time, state: world.state, level: world.player.level };
    },
  };
}

if (localStorage.getItem(MUTE_KEY) === '1') {
  audio.setMuted(true);
  els.muteBtn.textContent = '🔇';
}
resize();
renderBestLabel();
requestAnimationFrame(frame);
