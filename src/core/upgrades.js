import { PLAYER, TUNING } from './config.js';
import { shuffle } from './rng.js';

/** 升级卡池：id 必须与 computeStats 中的等级键一致。 */
export const UPGRADES = [
  { id: 'fireRate', name: '超频回路', icon: '⚡', max: 5, effect: '射击间隔 −14%' },
  { id: 'damage', name: '过载核心', icon: '💥', max: 5, effect: '子弹伤害 +25%' },
  { id: 'multishot', name: '分裂弹头', icon: '🎯', max: 3, effect: '每次齐射 +1 发' },
  { id: 'pierce', name: '穿甲弹芯', icon: '➤', max: 3, effect: '穿透 +1 个目标' },
  { id: 'speed', name: '矢量推进器', icon: '🚀', max: 4, effect: '移动速度 +10%' },
  { id: 'armor', name: '纳米装甲', icon: '🛡', max: 4, effect: '生命上限 +25，立即回复 25' },
  { id: 'magnet', name: '引力线圈', icon: '🧲', max: 3, effect: '拾取半径 +40%' },
  { id: 'nova', name: '冲击新星', icon: '✳', max: 3, effect: '定期释放范围冲击波' },
  { id: 'orbit', name: '轨道刃', icon: '⚔', max: 3, effect: '环绕刀刃 +1 把' },
  { id: 'regen', name: '再生涂层', icon: '✚', max: 3, effect: '每秒回复 0.9 生命' },
];

export const UPGRADE_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

export function levelOf(levels, id) {
  return levels[id] ?? 0;
}

/** 由升级等级推导玩家属性；纯函数，便于单元测试与调参。 */
export function computeStats(levels = {}) {
  const lv = (id) => levelOf(levels, id);
  const shots = 1 + lv('multishot');
  const novaLevel = lv('nova');
  const orbitLevel = lv('orbit');
  return {
    fireInterval: PLAYER.baseFireInterval * 0.86 ** lv('fireRate'),
    damage: PLAYER.baseDamage * 1.25 ** lv('damage'),
    bulletSpeed: PLAYER.bulletSpeed,
    pierce: lv('pierce'),
    shots,
    spread: shots > 1 ? 0.13 : 0,
    range: TUNING.playerRange,
    moveSpeed: PLAYER.baseSpeed * 1.1 ** lv('speed'),
    maxHp: PLAYER.baseHp + 25 * lv('armor'),
    regen: 0.9 * lv('regen'),
    magnet: PLAYER.magnet * 1.4 ** lv('magnet'),
    nova: {
      level: novaLevel,
      cooldown: Math.max(1.2, 3.4 - 0.55 * novaLevel),
      radius: 120 + 34 * novaLevel,
      damage: 18 + 20 * novaLevel,
    },
    orbit: {
      level: orbitLevel,
      count: orbitLevel,
      radius: 86,
      speed: 2.6,
      damage: 10 + 9 * orbitLevel,
      bladeRadius: 13,
      hitCooldown: 0.4,
    },
  };
}

/** 抽 3 张未满级的卡；池空时返回空数组，由世界层转为分数奖励。 */
export function rollChoices(rng, levels, count = 3) {
  const available = UPGRADES.filter((u) => levelOf(levels, u.id) < u.max);
  if (available.length === 0) return [];
  return shuffle(rng, available.slice()).slice(0, count);
}
