import test from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32, randInt, shuffle } from '../src/core/rng.js';
import { clamp, circleHit, normalize } from '../src/core/mathx.js';
import { computeStats, rollChoices, UPGRADES, UPGRADE_BY_ID } from '../src/core/upgrades.js';

test('mulberry32 同种子同序列，落在 [0,1)', () => {
  const a = mulberry32(123);
  const b = mulberry32(123);
  const c = mulberry32(124);
  const seqA = Array.from({ length: 50 }, () => a());
  const seqB = Array.from({ length: 50 }, () => b());
  const seqC = Array.from({ length: 50 }, () => c());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) {
    assert.ok(v >= 0 && v < 1, `越界随机值 ${v}`);
  }
});

test('shuffle 保留元素集合且同种子可复现', () => {
  const source = ['a', 'b', 'c', 'd', 'e', 'f'];
  const first = shuffle(mulberry32(9), source.slice());
  const second = shuffle(mulberry32(9), source.slice());
  assert.deepEqual(first, second);
  assert.deepEqual([...first].sort(), [...source].sort());
});

test('randInt 覆盖闭区间且不越界', () => {
  const rng = mulberry32(77);
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) {
    const v = randInt(rng, 2, 5);
    assert.ok(v >= 2 && v <= 5, `randInt 越界 ${v}`);
    seen.add(v);
  }
  assert.equal(seen.size, 4);
});

test('向量与几何工具', () => {
  assert.equal(clamp(12, 0, 10), 10);
  assert.equal(clamp(-3, 0, 10), 0);
  assert.deepEqual(normalize(0, 0), { x: 0, y: 0 });
  const n = normalize(3, 4);
  assert.ok(Math.abs(n.x - 0.6) < 1e-9 && Math.abs(n.y - 0.8) < 1e-9);
  assert.equal(circleHit(0, 0, 5, 9, 0, 4), true);
  assert.equal(circleHit(0, 0, 5, 10, 0, 4), false);
});

test('升级卡池 id 唯一且等级上限为正', () => {
  const ids = UPGRADES.map((u) => u.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const u of UPGRADES) {
    assert.ok(u.max > 0, `${u.id} 上限异常`);
    assert.equal(UPGRADE_BY_ID.get(u.id), u);
  }
});

test('computeStats 随升级单调变化', () => {
  const base = computeStats({});
  const quick = computeStats({ fireRate: 3 });
  const heavy = computeStats({ damage: 3 });
  const armor = computeStats({ armor: 4 });

  assert.ok(quick.fireInterval < base.fireInterval);
  assert.ok(heavy.damage > base.damage);
  assert.equal(base.shots, 1);
  assert.equal(computeStats({ multishot: 2 }).shots, 3);
  assert.equal(computeStats({ pierce: 3 }).pierce, 3);
  assert.ok(armor.maxHp > base.maxHp);
  assert.ok(computeStats({ magnet: 2 }).magnet > base.magnet);
  assert.equal(base.nova.level, 0);
  assert.ok(computeStats({ nova: 2 }).nova.radius > computeStats({ nova: 1 }).nova.radius);
  assert.equal(computeStats({ orbit: 2 }).orbit.count, 2);
  assert.ok(computeStats({ regen: 1 }).regen > 0);
});

test('rollChoices 抽三张不重复卡，且同种子可复现', () => {
  const a = rollChoices(mulberry32(5), {}, 3);
  const b = rollChoices(mulberry32(5), {}, 3);
  assert.deepEqual(a.map((u) => u.id), b.map((u) => u.id));
  assert.equal(a.length, 3);
  assert.equal(new Set(a.map((u) => u.id)).size, 3);
});

test('rollChoices 排除满级卡，全部满级时返回空数组', () => {
  const levels = {};
  for (const u of UPGRADES) levels[u.id] = u.max;
  assert.deepEqual(rollChoices(mulberry32(1), levels, 3), []);

  levels.damage = 0;
  levels.speed = 0;
  const picks = rollChoices(mulberry32(1), levels, 3);
  assert.equal(picks.length, 2);
  assert.deepEqual(picks.map((u) => u.id).sort(), ['damage', 'speed']);
});
