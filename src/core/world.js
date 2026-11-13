import { BOSS, ENEMY_TYPES, PLAYER, TUNING } from './config.js';
import { clamp, circleHit, damp, distance, normalize, TAU } from './mathx.js';
import { mulberry32 } from './rng.js';
import { computeStats, levelOf, rollChoices, UPGRADE_BY_ID } from './upgrades.js';

let uidSeq = 1;

/**
 * 世界状态：纯数据 + 纯函数更新，不触碰 DOM，因此可在 Node 中直接跑模拟与测试。
 */
export function createWorld({ seed = 20260101, width = 1280, height = 800 } = {}) {
  const world = {
    seed: seed >>> 0,
    rng: mulberry32(seed),
    width,
    height,
    time: 0,
    state: 'playing', // playing | levelup | dead | victory
    nextBossAt: TUNING.bossAt,
    boss: null,
    bossCount: 0,
    kills: 0,
    score: 0,
    spawnTimer: 0.5,
    nextRushAt: 16,
    events: [],
    shake: 0,
    pendingChoices: [],
    enemies: [],
    bullets: [],
    enemyBullets: [],
    gems: [],
    particles: [],
    floaters: [],
    rings: [],
    player: null,
  };
  world.player = createPlayer(world);
  return world;
}

function createPlayer(world) {
  const levels = {};
  const stats = computeStats(levels);
  return {
    x: world.width / 2,
    y: world.height / 2,
    radius: PLAYER.radius,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    speed: stats.moveSpeed,
    stats,
    levels,
    aim: -Math.PI / 2,
    fireCd: 0,
    novaCd: stats.nova.cooldown,
    orbitAngle: 0,
    dashTime: 0,
    dashCd: 0,
    dashX: 0,
    dashY: 0,
    invuln: 0,
    hurtFlash: 0,
    level: 1,
    xp: 0,
    xpNext: TUNING.xpBase,
  };
}

function refreshStats(player) {
  const stats = computeStats(player.levels);
  const gained = stats.maxHp - player.maxHp;
  player.stats = stats;
  player.maxHp = stats.maxHp;
  player.speed = stats.moveSpeed;
  if (gained > 0) player.hp = Math.min(player.maxHp, player.hp + gained);
  player.hp = Math.min(player.hp, player.maxHp);
}

function emit(world, event) {
  if (world.events.length > 64) world.events.shift();
  world.events.push({ t: world.time, ...event });
}

function addParticle(world, x, y, vx, vy, life, size, color) {
  if (world.particles.length >= TUNING.maxParticles) world.particles.shift();
  world.particles.push({ x, y, vx, vy, life, max: life, size, color });
}

function addFloater(world, x, y, text, color) {
  if (world.floaters.length >= TUNING.maxFloaters) world.floaters.shift();
  world.floaters.push({ x, y, vy: -34, life: 0.7, max: 0.7, text, color });
}

function addRing(world, x, y, radius, color) {
  world.rings.push({ x, y, radius, life: 0.45, max: 0.45, color });
}

function removeDead(list) {
  let w = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (!list[i].dead) {
      list[w] = list[i];
      w += 1;
    }
  }
  list.length = w;
}

export function nearestEnemy(world, x, y, range) {
  let best = null;
  let bestDist = range * range;
  for (const e of world.enemies) {
    if (e.dead) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

function edgePoint(world) {
  const side = Math.floor(world.rng() * 4);
  const pad = 36;
  if (side === 0) return { x: world.rng() * world.width, y: -pad };
  if (side === 1) return { x: world.width + pad, y: world.rng() * world.height };
  if (side === 2) return { x: world.rng() * world.width, y: world.height + pad };
  return { x: -pad, y: world.rng() * world.height };
}

export function hpScale(world) {
  return 1 + world.time * TUNING.hpRamp + world.bossCount * 0.6;
}

export function spawnEnemy(world, typeId, x, y) {
  const def = ENEMY_TYPES[typeId];
  if (!def) return null;
  const pos = x === undefined || y === undefined ? edgePoint(world) : { x, y };
  const scale = hpScale(world);
  const enemy = {
    uid: (uidSeq += 1),
    type: typeId,
    def,
    x: pos.x,
    y: pos.y,
    radius: def.radius,
    hp: def.hp * scale,
    maxHp: def.hp * scale,
    speed: def.speed,
    damage: def.damage,
    xp: def.xp,
    score: def.score,
    color: def.color,
    shape: def.shape,
    weave: Boolean(def.weave),
    phase: world.rng() * TAU,
    angle: 0,
    flash: 0,
    kx: 0,
    ky: 0,
    orbitCd: 0,
    shoot: def.shoot ? { ...def.shoot } : null,
    shootCd: 1 + world.rng(),
    boss: false,
    dead: false,
  };
  world.enemies.push(enemy);
  return enemy;
}

function spawnRush(world) {
  const count = Math.min(12, 5 + Math.floor(world.time / 20));
  const side = Math.floor(world.rng() * 4);
  for (let i = 0; i < count; i += 1) {
    if (world.enemies.length >= TUNING.maxEnemies) break;
    const spread = world.rng();
    const along = 60 + spread * (side % 2 === 0 ? world.width - 120 : world.height - 120);
    const jitter = -30 + world.rng() * 60;
    const pos =
      side === 0
        ? { x: along, y: -30 + jitter }
        : side === 1
          ? { x: world.width + 30 - jitter, y: along }
          : side === 2
            ? { x: along, y: world.height + 30 - jitter }
            : { x: -30 + jitter, y: along };
    spawnEnemy(world, world.time > 30 ? 'runner' : 'grunt', pos.x, pos.y);
  }
  emit(world, { type: 'rush' });
}

export function spawnBoss(world) {
  const pos = edgePoint(world);
  const hp = BOSS.hp * (1 + world.bossCount * 0.75);
  const boss = {
    uid: (uidSeq += 1),
    type: 'boss',
    def: BOSS,
    x: pos.x,
    y: pos.y,
    radius: BOSS.radius,
    hp,
    maxHp: hp,
    speed: BOSS.speed,
    damage: BOSS.damage,
    xp: BOSS.xp,
    score: BOSS.score,
    color: BOSS.color,
    shape: 'boss',
    phase: 0,
    angle: 0,
    flash: 0,
    kx: 0,
    ky: 0,
    orbitCd: 0,
    shoot: null,
    shootCd: 0,
    boss: true,
    burstCd: 1.6,
    aimCd: 1.2,
    minionCd: 5,
    burstOffset: 0,
    dead: false,
  };
  world.enemies.push(boss);
  world.boss = boss;
  world.bossCount += 1;
  world.shake = 16;
  emit(world, { type: 'boss' });
  return boss;
}

function spawnWave(world) {
  const pool = ['grunt'];
  if (world.time > 12) pool.push('runner');
  if (world.time > 25) pool.push('spitter');
  if (world.time > 40) pool.push('brute');
  const count = 1 + (world.rng() < 0.35 * Math.min(1, world.time / 60) ? 1 : 0);
  for (let i = 0; i < count; i += 1) {
    if (world.enemies.length >= TUNING.maxEnemies) return;
    const typeId = pool[Math.floor(world.rng() * pool.length)];
    spawnEnemy(world, typeId);
  }
}

function spawnInterval(world) {
  return Math.max(TUNING.spawnIntervalMin, TUNING.spawnIntervalBase - world.time * TUNING.spawnRamp);
}

function firePlayer(world) {
  const p = world.player;
  const s = p.stats;
  const base = p.aim;
  for (let i = 0; i < s.shots; i += 1) {
    const a = base + (i - (s.shots - 1) / 2) * s.spread;
    world.bullets.push({
      x: p.x + Math.cos(a) * (p.radius + 4),
      y: p.y + Math.sin(a) * (p.radius + 4),
      vx: Math.cos(a) * s.bulletSpeed,
      vy: Math.sin(a) * s.bulletSpeed,
      radius: TUNING.bulletRadius,
      damage: s.damage,
      pierce: s.pierce,
      life: 1.6,
      hits: [],
      dead: false,
    });
  }
  emit(world, { type: 'shoot' });
}

function fireEnemyBullet(world, enemy, angle, speed, damage, radius) {
  world.enemyBullets.push({
    x: enemy.x + Math.cos(angle) * enemy.radius,
    y: enemy.y + Math.sin(angle) * enemy.radius,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius,
    damage,
    dead: false,
  });
}

function damageEnemy(world, enemy, amount, kbx = 0, kby = 0) {
  if (enemy.dead) return;
  enemy.hp -= amount;
  enemy.flash = 0.12;
  enemy.kx += kbx;
  enemy.ky += kby;
  addFloater(world, enemy.x, enemy.y - enemy.radius - 4, String(Math.round(amount)), '#e2e8ff');
  if (enemy.hp <= 0) killEnemy(world, enemy);
}

function spawnGems(world, enemy) {
  const drops = enemy.boss ? 12 : Math.min(4, Math.max(1, Math.round(enemy.xp / 1.5)));
  const value = enemy.boss ? 6 : enemy.xp;
  for (let i = 0; i < drops; i += 1) {
    const a = world.rng() * TAU;
    const sp = 50 + world.rng() * 90;
    world.gems.push({
      x: enemy.x,
      y: enemy.y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      value,
      life: 20,
      seeking: false,
      dead: false,
    });
  }
}

function killEnemy(world, enemy) {
  if (enemy.dead) return;
  enemy.dead = true;
  world.kills += 1;
  world.score += enemy.score;
  world.shake = Math.min(16, world.shake + (enemy.boss ? 14 : 1.6));
  const count = enemy.boss ? 40 : enemy.radius;
  for (let i = 0; i < count; i += 1) {
    const a = world.rng() * TAU;
    const sp = 60 + world.rng() * 220;
    addParticle(world, enemy.x, enemy.y, Math.cos(a) * sp, Math.sin(a) * sp, 0.35 + world.rng() * 0.45, 1.5 + world.rng() * 2.5, enemy.color);
  }
  spawnGems(world, enemy);
  if (enemy.boss) {
    world.boss = null;
    world.state = 'victory';
    world.nextBossAt = world.time + 90;
    emit(world, { type: 'victory', x: enemy.x, y: enemy.y });
    return;
  }
  emit(world, { type: 'kill', x: enemy.x, y: enemy.y });
}

function damagePlayer(world, amount) {
  const p = world.player;
  if (world.state !== 'playing' || p.invuln > 0 || p.dashTime > 0) return false;
  p.hp -= amount;
  p.invuln = TUNING.contactInvuln;
  p.hurtFlash = 1;
  world.shake = Math.min(18, world.shake + 6);
  emit(world, { type: 'hurt', amount });
  if (p.hp <= 0) {
    p.hp = 0;
    world.state = 'dead';
    emit(world, { type: 'dead' });
  }
  return true;
}

function castNova(world) {
  const p = world.player;
  const nova = p.stats.nova;
  world.shake = Math.min(16, world.shake + 4);
  addRing(world, p.x, p.y, nova.radius, '#7dd3fc');
  for (const e of world.enemies) {
    if (e.dead) continue;
    if (circleHit(p.x, p.y, nova.radius, e.x, e.y, e.radius)) damageEnemy(world, e, nova.damage);
  }
  emit(world, { type: 'nova' });
}

function checkLevelUp(world) {
  const p = world.player;
  while (p.xp >= p.xpNext) {
    p.xp -= p.xpNext;
    p.level += 1;
    p.xpNext = Math.max(4, Math.round(TUNING.xpBase * TUNING.xpGrowth ** (p.level - 1)));
    world.score += 50;
    emit(world, { type: 'levelup' });
    const choices = rollChoices(world.rng, p.levels, 3);
    if (choices.length === 0) continue;
    world.pendingChoices = choices;
    world.state = 'levelup';
    return;
  }
}

/** 直接同步玩家属性缓存，供调试与测试在改写等级后调用。 */
export function syncStats(world) {
  refreshStats(world.player);
}

export function applyChoice(world, id) {
  if (world.state !== 'levelup') return false;
  const p = world.player;
  const meta = UPGRADE_BY_ID.get(id);
  if (!meta) return false;
  if (levelOf(p.levels, id) >= meta.max) return false;
  if (!world.pendingChoices.some((c) => c.id === id)) return false;
  p.levels[id] = levelOf(p.levels, id) + 1;
  refreshStats(p);
  if (id === 'armor') p.hp = Math.min(p.maxHp, p.hp + 25);
  world.pendingChoices = [];
  world.state = 'playing';
  emit(world, { type: 'upgrade', id });
  return true;
}

export function continueEndless(world) {
  if (world.state !== 'victory') return false;
  world.state = 'playing';
  world.spawnTimer = 1.2;
  world.nextBossAt = world.time + 90;
  return true;
}

function updatePlayer(world, dt, input) {
  const p = world.player;
  const move = normalize(input.mx ?? 0, input.my ?? 0);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.invuln = Math.max(0, p.invuln - dt);
  p.hurtFlash = Math.max(0, p.hurtFlash - dt * 3);

  if (input.dash && p.dashCd <= 0 && (move.x !== 0 || move.y !== 0)) {
    p.dashTime = TUNING.dashTime;
    p.dashCd = TUNING.dashCooldown;
    p.dashX = move.x;
    p.dashY = move.y;
    p.invuln = Math.max(p.invuln, TUNING.dashTime + 0.08);
    emit(world, { type: 'dash' });
  }

  if (p.dashTime > 0) {
    p.dashTime = Math.max(0, p.dashTime - dt);
    p.x += p.dashX * TUNING.dashSpeed * dt;
    p.y += p.dashY * TUNING.dashSpeed * dt;
    addParticle(world, p.x, p.y, -p.dashX * 60, -p.dashY * 60, 0.3, 3, '#67e8f9');
  } else {
    p.x += move.x * p.speed * dt;
    p.y += move.y * p.speed * dt;
  }

  p.x = clamp(p.x, p.radius, world.width - p.radius);
  p.y = clamp(p.y, p.radius, world.height - p.radius);

  if (p.stats.regen > 0 && p.hp > 0) p.hp = Math.min(p.maxHp, p.hp + p.stats.regen * dt);

  const target = nearestEnemy(world, p.x, p.y, p.stats.range);
  if (target) p.aim = Math.atan2(target.y - p.y, target.x - p.x);
  else if (move.x !== 0 || move.y !== 0) p.aim = Math.atan2(move.y, move.x);

  p.fireCd -= dt;
  if (p.fireCd <= 0) {
    if (target) {
      firePlayer(world);
      p.fireCd = p.stats.fireInterval;
    } else {
      p.fireCd = 0;
    }
  }

  if (p.stats.nova.level > 0) {
    p.novaCd -= dt;
    if (p.novaCd <= 0) {
      p.novaCd = p.stats.nova.cooldown;
      castNova(world);
    }
  }

  const orbit = p.stats.orbit;
  if (orbit.level > 0) {
    p.orbitAngle = (p.orbitAngle + orbit.speed * dt) % TAU;
    for (let i = 0; i < orbit.count; i += 1) {
      const a = p.orbitAngle + (TAU * i) / orbit.count;
      const bx = p.x + Math.cos(a) * orbit.radius;
      const by = p.y + Math.sin(a) * orbit.radius;
      for (const e of world.enemies) {
        if (e.dead || e.orbitCd > 0) continue;
        if (circleHit(bx, by, orbit.bladeRadius, e.x, e.y, e.radius)) {
          e.orbitCd = orbit.hitCooldown;
          damageEnemy(world, e, orbit.damage, Math.cos(a) * 40, Math.sin(a) * 40);
        }
      }
    }
  }
}

function updateEnemies(world, dt) {
  const p = world.player;
  for (const e of world.enemies) {
    if (e.dead) continue;
    e.flash = Math.max(0, e.flash - dt);
    e.orbitCd = Math.max(0, e.orbitCd - dt);
    const decay = damp(0.86, dt);
    e.kx *= decay;
    e.ky *= decay;

    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    let vx = (dx / d) * e.speed;
    let vy = (dy / d) * e.speed;

    if (e.weave) {
      const wobble = world.time * 3 + e.phase;
      vx += Math.cos(wobble) * e.speed * 0.7;
      vy += Math.sin(wobble) * e.speed * 0.7;
    }

    if (e.boss) {
      e.burstCd -= dt;
      if (e.burstCd <= 0) {
        e.burstCd = BOSS.burstInterval;
        e.burstOffset += 0.4;
        for (let i = 0; i < BOSS.burstCount; i += 1) {
          const a = e.burstOffset + (TAU * i) / BOSS.burstCount;
          fireEnemyBullet(world, e, a, BOSS.burstSpeed, 14, 7);
        }
        emit(world, { type: 'bossBurst' });
      }
      e.aimCd -= dt;
      if (e.aimCd <= 0) {
        e.aimCd = BOSS.aimInterval;
        const base = Math.atan2(dy, dx);
        for (let i = -1; i <= 1; i += 1) fireEnemyBullet(world, e, base + i * 0.18, 250, 12, 6);
      }
      e.minionCd -= dt;
      if (e.minionCd <= 0) {
        e.minionCd = BOSS.minionInterval;
        for (let i = 0; i < 3; i += 1) {
          if (world.enemies.length < TUNING.maxEnemies) spawnEnemy(world, 'runner', e.x + (i - 1) * 30, e.y + 20);
        }
      }
    } else if (e.shoot) {
      e.shootCd -= dt;
      if (e.shootCd <= 0 && d < e.shoot.range) {
        e.shootCd = e.shoot.interval;
        fireEnemyBullet(world, e, Math.atan2(dy, dx), e.shoot.speed, e.shoot.damage, e.shoot.radius);
      }
    }

    e.x += (vx + e.kx) * dt;
    e.y += (vy + e.ky) * dt;
    e.angle = Math.atan2(vy, vx);

    if (circleHit(e.x, e.y, e.radius, p.x, p.y, p.radius)) damagePlayer(world, e.damage);
  }

  // 轻量分离：只和数组里前几个近邻互推，避免敌人叠成一团。
  for (let i = 0; i < world.enemies.length; i += 1) {
    const a = world.enemies[i];
    if (a.dead) continue;
    for (let j = i + 1; j < Math.min(i + 6, world.enemies.length); j += 1) {
      const b = world.enemies[j];
      if (b.dead) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = a.radius + b.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0 && d2 < min * min) {
        const d = Math.sqrt(d2);
        const push = ((min - d) / d) * 0.35;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
      }
    }
  }

  removeDead(world.enemies);
  if (world.boss && world.boss.dead) world.boss = null;
}

function updateBullets(world, dt) {
  for (const b of world.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    for (const e of world.enemies) {
      if (b.dead || e.dead) continue;
      if (b.hits.includes(e.uid)) continue;
      if (!circleHit(b.x, b.y, b.radius, e.x, e.y, e.radius)) continue;
      b.hits.push(e.uid);
      damageEnemy(world, e, b.damage, b.vx * 0.05, b.vy * 0.05);
      world.shake = Math.min(12, world.shake + 0.5);
      addParticle(world, b.x, b.y, -b.vx * 0.05, -b.vy * 0.05, 0.2, 2, '#a5f3fc');
      if (b.pierce > 0) b.pierce -= 1;
      else b.dead = true;
    }
    if (b.life <= 0 || b.x < -60 || b.y < -60 || b.x > world.width + 60 || b.y > world.height + 60) b.dead = true;
  }
  removeDead(world.bullets);

  const p = world.player;
  for (const b of world.enemyBullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (circleHit(b.x, b.y, b.radius, p.x, p.y, p.radius)) {
      if (damagePlayer(world, b.damage)) b.dead = true;
    }
    if (b.x < -60 || b.y < -60 || b.x > world.width + 60 || b.y > world.height + 60) b.dead = true;
  }
  removeDead(world.enemyBullets);
}

function updateGems(world, dt) {
  const p = world.player;
  const magnet = p.stats.magnet;
  for (const g of world.gems) {
    g.life -= dt;
    // 爆散初速只在落地瞬间有效，之后统一被玩家吸引，避免远处掉落永远吃不到。
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    const decay = damp(0.86, dt);
    g.vx *= decay;
    g.vy *= decay;

    const dx = p.x - g.x;
    const dy = p.y - g.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d < magnet) g.seeking = true;
    const pull = g.seeking ? Math.min(720, 300 + Math.max(0, magnet - d) * 8) : 120;
    g.x += (dx / d) * pull * dt;
    g.y += (dy / d) * pull * dt;
    if (circleHit(g.x, g.y, 8, p.x, p.y, p.radius)) {
      p.xp += g.value;
      world.score += g.value * 5;
      g.dead = true;
      emit(world, { type: 'gem' });
    } else if (g.life <= 0) {
      g.dead = true;
    }
  }
  removeDead(world.gems);
}

function updateVisuals(world, dt) {
  for (const pt of world.particles) {
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
  }
  let w = 0;
  for (let i = 0; i < world.particles.length; i += 1) {
    if (world.particles[i].life > 0) {
      world.particles[w] = world.particles[i];
      w += 1;
    }
  }
  world.particles.length = w;

  for (const f of world.floaters) {
    f.y += f.vy * dt;
    f.life -= dt;
  }
  world.floaters = world.floaters.filter((f) => f.life > 0);

  for (const r of world.rings) r.life -= dt;
  world.rings = world.rings.filter((r) => r.life > 0);

  if (world.state !== 'playing') {
    // 结算界面仍要让碎片与震屏自然收尾。
    world.shake = Math.max(0, world.shake - dt * 3.6);
  }
}

/**
 * 主更新入口。input: {mx, my, dash}，mx/my 为 −1..1 的原始轴值，内部会归一化。
 */
export function update(world, dt, input = {}) {
  if (world.state !== 'playing') {
    updateVisuals(world, Math.min(dt, 0.05));
    return;
  }
  const step = Math.min(Math.max(dt, 0), 0.05);
  world.time += step;
  world.shake = Math.max(0, world.shake - step * 3.6);
  world.events.length = 0;

  updatePlayer(world, step, input);
  if (world.state !== 'playing') {
    updateVisuals(world, step);
    return;
  }

  world.spawnTimer -= step;
  if (world.spawnTimer <= 0 && world.enemies.length < TUNING.maxEnemies) {
    world.spawnTimer = spawnInterval(world);
    spawnWave(world);
  }
  if (!world.boss && world.time >= world.nextBossAt) spawnBoss(world);
  if (world.time >= world.nextRushAt) {
    world.nextRushAt = world.time + 18;
    spawnRush(world);
  }

  updateEnemies(world, step);
  updateBullets(world, step);
  updateGems(world, step);
  updateVisuals(world, step);

  if (world.state === 'playing') checkLevelUp(world);
}

export { distance };
