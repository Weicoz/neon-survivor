// 平衡性模拟：用一个会逃命、会吃宝石的机器人跑完整局，评估难度曲线。
import { applyChoice, continueEndless, createWorld, update } from '../src/core/world.js';

function botInput(world) {
  const p = world.player;
  let ax = 0;
  let ay = 0;
  for (const e of world.enemies) {
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < 240) {
      const w = (240 - d) / 240;
      ax += (dx / d) * w * 2.8;
      ay += (dy / d) * w * 2.8;
    }
  }
  let best = null;
  let bestD = 1e9;
  for (const g of world.gems) {
    const d = Math.hypot(g.x - p.x, g.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  if (best && bestD > 24) {
    ax += ((best.x - p.x) / bestD) * 1.1;
    ay += ((best.y - p.y) / bestD) * 1.1;
  }
  // 别贴边
  const margin = 90;
  if (p.x < margin) ax += 1.4;
  if (p.x > world.width - margin) ax -= 1.4;
  if (p.y < margin) ay += 1.4;
  if (p.y > world.height - margin) ay -= 1.4;

  const len = Math.hypot(ax, ay) || 1;
  const dash = world.enemies.some((e) => Math.hypot(e.x - p.x, e.y - p.y) < e.radius + p.radius + 14);
  return { mx: ax / len, my: ay / len, dash };
}

export function playOne(seed, maxSeconds = 240) {
  const world = createWorld({ width: 1100, height: 720, seed });
  const dt = 1 / 60;
  const marks = [];
  let nextMark = 30;
  for (let i = 0; i < maxSeconds * 60; i += 1) {
    update(world, dt, botInput(world));
    if (world.state === 'levelup') applyChoice(world, world.pendingChoices[0].id);
    if (world.state === 'victory') {
      marks.push(`Victory@${Math.round(world.time)}s Lv${world.player.level}`);
      if (!world.continued) {
        world.continued = true;
        continueEndless(world);
      }
    }
    if (world.time >= nextMark) {
      marks.push(`${nextMark}s Lv${world.player.level} kills${world.kills} enemies${world.enemies.length} hp${Math.round(world.player.hp)}`);
      nextMark += 30;
    }
    if (world.state === 'dead') break;
  }
  return {
    seed,
    time: Math.round(world.time),
    level: world.player.level,
    kills: world.kills,
    score: Math.round(world.score),
    state: world.state,
    hp: Math.round(world.player.hp),
    upgrades: world.player.levels,
    marks,
  };
}

const seeds = [1, 2, 3, 4, 5];
for (const seed of seeds) {
  const result = playOne(seed);
  console.log(JSON.stringify(result));
}
