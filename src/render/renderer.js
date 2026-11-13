import { TAU } from '../core/mathx.js';
import { mulberry32 } from '../core/rng.js';

/**
 * 只负责把世界状态画到 canvas，不修改世界。
 * 性能约束：热点循环里不使用 shadowBlur，发光一律用「多层半透明描边」模拟。
 */
export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const stars = createStars();
  let vignette = null;
  let background = null;
  let halo = null;

  function resize(width, height, dpr) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.28, width / 2, height / 2, Math.max(width, height) * 0.78);
    vignette.addColorStop(0, 'rgba(6,8,20,0)');
    vignette.addColorStop(1, 'rgba(4,6,16,0.85)');

    background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, '#080b1a');
    background.addColorStop(0.55, '#0b1024');
    background.addColorStop(1, '#060814');

    halo = ctx.createRadialGradient(0, 0, 2, 0, 0, 46);
    halo.addColorStop(0, 'rgba(34,211,238,0.42)');
    halo.addColorStop(1, 'rgba(34,211,238,0)');
  }

  function draw(world, { width, height, joystick } = {}) {
    const shake = world.shake;
    // 屏幕震动用 Math.random，避免消耗世界内的可复现随机流。
    const sx = shake > 0.05 ? (Math.random() - 0.5) * shake : 0;
    const sy = shake > 0.05 ? (Math.random() - 0.5) * shake : 0;

    ctx.save();
    ctx.translate(sx, sy);
    drawBackground(world, width, height);
    drawRings(world);
    drawGems(world);
    drawParticles(world);
    drawEnemyBullets(world);
    drawEnemies(world);
    drawBullets(world);
    drawPlayer(world);
    drawFloaters(world);
    ctx.restore();

    if (vignette) {
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);
    }
    const flash = world.player.hurtFlash;
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,60,90,${Math.min(0.32, flash * 0.32)})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (world.player.dashTime > 0) {
      ctx.fillStyle = 'rgba(103,232,249,0.06)';
      ctx.fillRect(0, 0, width, height);
    }
    if (joystick?.active) {
      ctx.save();
      ctx.strokeStyle = 'rgba(125,211,252,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(joystick.ox, joystick.oy, joystick.radius, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(34,211,238,0.55)';
      ctx.beginPath();
      ctx.arc(joystick.ox + joystick.x * joystick.radius, joystick.oy + joystick.y * joystick.radius, 20, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBackground(world, width, height) {
    ctx.fillStyle = background ?? '#070a16';
    ctx.fillRect(0, 0, width, height);

    const t = world.time;
    for (const s of stars) {
      const drift = (s.y + t * s.speed * 0.01) % 1;
      const twinkle = 0.45 + 0.55 * Math.abs(Math.sin(t * s.twinkle + s.phase));
      ctx.fillStyle = `rgba(${s.hue},${twinkle * s.alpha})`;
      ctx.fillRect(s.x * width, drift * height, s.size, s.size);
    }

    ctx.strokeStyle = 'rgba(88,120,255,0.08)';
    ctx.lineWidth = 1;
    const cell = 64;
    const ox = (t * 6) % cell;
    const oy = (t * 4) % cell;
    ctx.beginPath();
    for (let x = -cell + ox; x < width + cell; x += cell) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = -cell + oy; y < height + cell; y += cell) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(125,211,252,0.16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);
  }

  function drawRings(world) {
    for (const r of world.rings) {
      const k = 1 - r.life / r.max;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius * (0.35 + 0.75 * k), 0, TAU);
      ctx.strokeStyle = withAlpha(r.color, 0.55 * (1 - k));
      ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.stroke();
    }
  }

  function drawGems(world) {
    const t = world.time;
    ctx.save();
    for (const g of world.gems) {
      const r = 5 + Math.sin(t * 6 + g.x * 0.05) * 1.2;
      const color = g.value >= 4 ? '#f9a8d4' : '#67e8f9';
      ctx.fillStyle = withAlpha(color, 0.18);
      ctx.beginPath();
      ctx.arc(g.x, g.y, r * 2.6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(g.x, g.y - r);
      ctx.lineTo(g.x + r * 0.8, g.y);
      ctx.lineTo(g.x, g.y + r);
      ctx.lineTo(g.x - r * 0.8, g.y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawParticles(world) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of world.particles) {
      ctx.fillStyle = withAlpha(p.color, Math.max(0, p.life / p.max));
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.restore();
  }

  function drawEnemyBullets(world) {
    if (world.enemyBullets.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,45,149,0.22)';
    ctx.beginPath();
    for (const b of world.enemyBullets) {
      ctx.moveTo(b.x + b.radius * 2.2, b.y);
      ctx.arc(b.x, b.y, b.radius * 2.2, 0, TAU);
    }
    ctx.fill();
    ctx.fillStyle = '#ff9ad5';
    ctx.beginPath();
    for (const b of world.enemyBullets) {
      ctx.moveTo(b.x + b.radius, b.y);
      ctx.arc(b.x, b.y, b.radius, 0, TAU);
    }
    ctx.fill();
    ctx.restore();
  }

  function drawBullets(world) {
    if (world.bullets.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(34,211,238,0.25)';
    ctx.lineWidth = 9;
    ctx.beginPath();
    for (const b of world.bullets) {
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016);
    }
    ctx.stroke();
    ctx.strokeStyle = '#c8fbff';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  function drawEnemies(world) {
    for (const e of world.enemies) {
      const color = e.flash > 0 ? '#ffffff' : e.color;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.angle + Math.PI / 2);
      if (e.boss) {
        drawBossShape(e, color);
      } else {
        poly(e.radius, e.shape);
        ctx.fillStyle = withAlpha(color, 0.22);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = withAlpha(color, 0.55);
        ctx.beginPath();
        ctx.arc(0, 0, e.radius * 0.34, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
      if (e.maxHp > 40 && !e.boss) {
        const w = e.radius * 2;
        const ratio = Math.max(0, e.hp / e.maxHp);
        ctx.fillStyle = 'rgba(2,6,18,0.7)';
        ctx.fillRect(e.x - w / 2, e.y - e.radius - 12, w, 4);
        ctx.fillStyle = '#f472b6';
        ctx.fillRect(e.x - w / 2, e.y - e.radius - 12, w * ratio, 4);
      }
    }
  }

  function drawBossShape(e, color) {
    ctx.beginPath();
    const spikes = 9;
    for (let i = 0; i < spikes * 2; i += 1) {
      const a = (Math.PI * i) / spikes;
      const r = i % 2 === 0 ? e.radius : e.radius * 0.72;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = withAlpha(color, 0.22);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = 'rgba(11,16,34,0.92)';
    ctx.beginPath();
    ctx.arc(0, 0, e.radius * 0.44, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();

    const pulse = 0.85 + 0.15 * Math.sin(e.uid + e.hp * 0.01);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, e.radius * 0.2 * pulse, 0, TAU);
    ctx.fill();
  }

  function poly(radius, shape) {
    ctx.beginPath();
    if (shape === 'tri') {
      ctx.moveTo(0, -radius);
      ctx.lineTo(radius * 0.85, radius * 0.75);
      ctx.lineTo(-radius * 0.85, radius * 0.75);
      ctx.closePath();
      return;
    }
    if (shape === 'square') {
      const r = radius * 0.85;
      ctx.rect(-r, -r, r * 2, r * 2);
      return;
    }
    if (shape === 'diamond') {
      ctx.moveTo(0, -radius);
      ctx.lineTo(radius, 0);
      ctx.lineTo(0, radius);
      ctx.lineTo(-radius, 0);
      ctx.closePath();
      return;
    }
    const sides = 6;
    for (let i = 0; i < sides; i += 1) {
      const a = (TAU * i) / sides - Math.PI / 2;
      const x = Math.cos(a) * radius;
      const y = Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function drawPlayer(world) {
    const p = world.player;
    if (p.hp <= 0) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.aim + Math.PI / 2);

    if (halo) {
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, 46, 0, TAU);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(0, -p.radius * 1.35);
    ctx.lineTo(p.radius * 0.95, p.radius * 0.95);
    ctx.lineTo(0, p.radius * 0.45);
    ctx.lineTo(-p.radius * 0.95, p.radius * 0.95);
    ctx.closePath();
    ctx.fillStyle = 'rgba(34,211,238,0.22)';
    ctx.fill();
    ctx.fillStyle = p.invuln > 0 && Math.floor(world.time * 24) % 2 === 0 ? '#f8fafc' : '#22d3ee';
    ctx.fill();
    ctx.restore();

    const orbit = p.stats.orbit;
    for (let i = 0; i < orbit.count; i += 1) {
      const a = p.orbitAngle + (TAU * i) / Math.max(1, orbit.count);
      const bx = p.x + Math.cos(a) * orbit.radius;
      const by = p.y + Math.sin(a) * orbit.radius;
      ctx.fillStyle = 'rgba(251,191,36,0.2)';
      ctx.beginPath();
      ctx.arc(bx, by, 13, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.arc(bx, by, 6, 0, TAU);
      ctx.fill();
    }
  }

  function drawFloaters(world) {
    if (world.floaters.length === 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    for (const f of world.floaters) {
      ctx.fillStyle = withAlpha(f.color, Math.max(0, f.life / f.max));
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  return { resize, draw };
}

function createStars() {
  const rng = mulberry32(20260101);
  const stars = [];
  for (let i = 0; i < 90; i += 1) {
    stars.push({
      x: rng(),
      y: rng(),
      size: rng() < 0.75 ? 1 : 2,
      speed: 0.6 + rng() * 3.4,
      alpha: 0.25 + rng() * 0.55,
      twinkle: 0.6 + rng() * 2.2,
      phase: rng() * TAU,
      hue: rng() < 0.6 ? '190,230,255' : '255,214,240',
    });
  }
  return stars;
}

function withAlpha(hex, alpha) {
  const a = Math.max(0, Math.min(1, alpha));
  if (!hex.startsWith('#')) return hex;
  const value = hex.slice(1);
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const num = Number.parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${a})`;
}
