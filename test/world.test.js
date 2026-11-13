import test from 'node:test';
import assert from 'node:assert/strict';

import { ENEMY_TYPES, TUNING } from '../src/core/config.js';
import {
  applyChoice,
  continueEndless,
  createWorld,
  spawnBoss,
  spawnEnemy,
  update,
} from '../src/core/world.js';

const FRAME = 1 / 60;

function quietWorld(options = {}) {
  const world = createWorld({ width: 900, height: 600, seed: 424242, ...options });
  world.spawnTimer = Number.MAX_SAFE_INTEGER;
  world.nextBossAt = Number.MAX_SAFE_INTEGER;
  return world;
}

function step(world, seconds, input = {}) {
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i += 1) update(world, FRAME, input);
}

test('玩家按输入方向移动并被边界夹紧', () => {
  const world = quietWorld();
  const startX = world.player.x;
  step(world, 0.4, { mx: 1, my: 0 });
  assert.ok(world.player.x > startX + 20, '玩家应向右侧移动');
  assert.equal(world.player.y, world.height / 2);

  step(world, 6, { mx: 1, my: 0 });
  assert.equal(world.player.x, world.width - world.player.radius);
});

test('冲刺进入短暂无敌并拉开距离', () => {
  const world = quietWorld();
  const startX = world.player.x;
  update(world, FRAME, { mx: 1, my: 0, dash: true });
  assert.ok(world.player.dashTime > 0);
  assert.ok(world.player.dashCd > 0);
  assert.ok(world.player.invuln > 0);
  step(world, 0.2, { mx: 0, my: 0 });
  assert.ok(world.player.x > startX + 100, '冲刺位移应明显大于普通移动');
});

test('子弹击杀敌人并产出经验宝石与分数', () => {
  const world = quietWorld();
  spawnEnemy(world, 'grunt', world.player.x + 120, world.player.y);
  assert.equal(world.enemies.length, 1);

  for (let i = 0; i < 180 && world.kills === 0; i += 1) update(world, FRAME, {});

  assert.equal(world.kills, 1, '敌人应被击杀');
  assert.equal(world.enemies.filter((e) => !e.dead).length, 0);
  assert.ok(world.gems.length >= 1, '击杀应掉落经验');
  assert.ok(world.score > 0, '击杀应加分');

  step(world, 1.2, { mx: 0, my: 0 });
  assert.ok(world.player.xp > 0, '宝石应被吸附拾取');
});

test('接触伤害只结算一次，无敌期不重复掉血', () => {
  const world = quietWorld();
  const startHp = world.player.hp;
  spawnEnemy(world, 'grunt', world.player.x, world.player.y);

  update(world, FRAME, {});
  const afterFirst = world.player.hp;
  assert.equal(afterFirst, startHp - ENEMY_TYPES.grunt.damage);
  assert.ok(world.player.invuln > 0);

  update(world, FRAME, {});
  assert.equal(world.player.hp, afterFirst, '无敌期内不应再次受伤');
});

test('生命归零进入死亡态并记录事件', () => {
  const world = quietWorld();
  world.player.hp = 5;
  spawnEnemy(world, 'grunt', world.player.x, world.player.y);

  update(world, FRAME, {});

  assert.equal(world.player.hp, 0);
  assert.equal(world.state, 'dead');
  assert.ok(world.events.some((e) => e.type === 'dead'));
});

test('经验满触发升级三选一，选择后回到战斗并生效', () => {
  const world = quietWorld();
  world.player.xp = world.player.xpNext;

  update(world, FRAME, {});

  assert.equal(world.state, 'levelup');
  assert.equal(world.pendingChoices.length, 3);
  assert.equal(world.player.level, 2);

  const choice = world.pendingChoices[0];
  assert.equal(applyChoice(world, choice.id), true);
  assert.equal(world.state, 'playing');
  assert.equal(world.player.levels[choice.id], 1);
  assert.equal(world.pendingChoices.length, 0);

  assert.equal(applyChoice(world, choice.id), false, '非升级态不可再选卡');
});

test('boss 在配置时间出现，被击杀后进入胜利态且可继续无尽', () => {
  const world = quietWorld();
  world.time = TUNING.bossAt;
  world.nextBossAt = TUNING.bossAt;

  update(world, FRAME, {});

  assert.ok(world.boss, '时间到应生成 boss');
  assert.equal(world.bossCount, 1);
  assert.ok(world.events.some((e) => e.type === 'boss'));

  world.boss.hp = 1;
  world.boss.x = world.player.x + 150;
  world.boss.y = world.player.y;
  step(world, 1.2, {});

  assert.equal(world.state, 'victory');
  assert.equal(world.boss, null);
  assert.ok(world.score >= 1200);

  assert.equal(continueEndless(world), true);
  assert.equal(world.state, 'playing');
  assert.ok(world.nextBossAt > world.time);

  assert.equal(continueEndless(world), false, '非胜利态不可触发无尽');
});

test('同种子同输入产生完全一致的局面', () => {
  const run = () => {
    const world = createWorld({ width: 800, height: 600, seed: 20260101 });
    for (let i = 0; i < 600; i += 1) {
      const t = i * FRAME;
      update(world, FRAME, { mx: Math.cos(t * 2), my: Math.sin(t * 1.5) });
      if (world.state === 'levelup') applyChoice(world, world.pendingChoices[0].id);
      if (world.state !== 'playing') break;
    }
    return {
      time: world.time,
      kills: world.kills,
      score: world.score,
      enemies: world.enemies.length,
      level: world.player.level,
      x: Math.round(world.player.x * 1000) / 1000,
      y: Math.round(world.player.y * 1000) / 1000,
    };
  };
  assert.deepEqual(run(), run());
});

test('120 秒冒烟：无异常、实体数量受控、boss 按时出现', () => {
  const world = createWorld({ width: 960, height: 640, seed: 7 });
  world.player.hp = 1e6;
  let nanSeen = false;
  let maxEnemiesSeen = 0;

  for (let i = 0; i < 120 * 60; i += 1) {
    const t = i * FRAME;
    update(world, FRAME, { mx: Math.cos(t * 1.7), my: Math.sin(t * 1.3) });
    if (world.state === 'levelup') applyChoice(world, world.pendingChoices[0].id);
    if (!Number.isFinite(world.player.x) || !Number.isFinite(world.player.y)) nanSeen = true;
    maxEnemiesSeen = Math.max(maxEnemiesSeen, world.enemies.length);
    if (world.state === 'dead' || world.state === 'victory') break;
  }

  assert.equal(nanSeen, false, '玩家坐标不得出现 NaN');
  assert.ok(world.kills > 20, `应产生可观击杀，实际 ${world.kills}`);
  assert.ok(maxEnemiesSeen <= TUNING.maxEnemies, '同屏敌人数量应受上限约束');
  assert.ok(world.particles.length <= TUNING.maxParticles, '粒子数量应受上限约束');
  assert.ok(world.time >= 30, '模拟应能持续推进');

  const bossWorld = quietWorld();
  bossWorld.time = TUNING.bossAt - 0.1;
  bossWorld.nextBossAt = TUNING.bossAt;
  spawnBoss(bossWorld);
  assert.equal(bossWorld.bossCount, 1);
  assert.ok(bossWorld.boss.hp > 0);
});
