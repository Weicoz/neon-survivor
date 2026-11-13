/**
 * 输入层：键盘轴 + 触屏虚拟摇杆，统一成 {mx,my} 轴值与一次性的 dash 触发。
 */
export function createInput(target, handlers = {}) {
  const keys = new Set();
  const joystick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0, radius: 62 };
  let dashQueued = false;
  let pointerStart = 0;

  const onKeyDown = (event) => {
    const code = event.code;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) event.preventDefault();
    if (!keys.has(code)) {
      if (code === 'Space') dashQueued = true;
      if (code === 'KeyP' || code === 'Escape') handlers.onPause?.();
      if (code === 'KeyM') handlers.onMute?.();
      if (code === 'KeyR') handlers.onRestart?.();
      if (code === 'Digit1') handlers.onQuickPick?.(0);
      if (code === 'Digit2') handlers.onQuickPick?.(1);
      if (code === 'Digit3') handlers.onQuickPick?.(2);
    }
    keys.add(code);
    handlers.onAnyInput?.();
  };

  const onKeyUp = (event) => {
    keys.delete(event.code);
  };

  const onBlur = () => {
    keys.clear();
    releasePointer();
  };

  function releasePointer() {
    joystick.active = false;
    joystick.id = null;
    joystick.x = 0;
    joystick.y = 0;
  }

  const onPointerDown = (event) => {
    handlers.onAnyInput?.();
    if (joystick.active) return;
    joystick.active = true;
    joystick.id = event.pointerId;
    joystick.ox = event.clientX;
    joystick.oy = event.clientY;
    joystick.x = 0;
    joystick.y = 0;
    pointerStart = globalThis.performance?.now?.() ?? Date.now();
    target.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (!joystick.active || event.pointerId !== joystick.id) return;
    let dx = event.clientX - joystick.ox;
    let dy = event.clientY - joystick.oy;
    const len = Math.hypot(dx, dy);
    if (len > joystick.radius) {
      dx = (dx / len) * joystick.radius;
      dy = (dy / len) * joystick.radius;
    }
    joystick.x = dx / joystick.radius;
    joystick.y = dy / joystick.radius;
  };

  const onPointerUp = (event) => {
    if (!joystick.active || event.pointerId !== joystick.id) return;
    const elapsed = (globalThis.performance?.now?.() ?? Date.now()) - pointerStart;
    const moved = Math.hypot(event.clientX - joystick.ox, event.clientY - joystick.oy);
    if (elapsed < 220 && moved < 14) dashQueued = true;
    releasePointer();
  };

  const onContextMenu = (event) => event.preventDefault();

  globalThis.addEventListener('keydown', onKeyDown, { passive: false });
  globalThis.addEventListener('keyup', onKeyUp);
  globalThis.addEventListener('blur', onBlur);
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerUp);
  target.addEventListener('contextmenu', onContextMenu);

  function move() {
    let x = 0;
    let y = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
    if (x === 0 && y === 0 && joystick.active) {
      x = joystick.x;
      y = joystick.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    return { mx: x, my: y };
  }

  function consumeDash() {
    const dash = dashQueued;
    dashQueued = false;
    return dash;
  }

  function dispose() {
    globalThis.removeEventListener('keydown', onKeyDown);
    globalThis.removeEventListener('keyup', onKeyUp);
    globalThis.removeEventListener('blur', onBlur);
    target.removeEventListener('pointerdown', onPointerDown);
    target.removeEventListener('pointermove', onPointerMove);
    target.removeEventListener('pointerup', onPointerUp);
    target.removeEventListener('pointercancel', onPointerUp);
    target.removeEventListener('contextmenu', onContextMenu);
  }

  return { move, consumeDash, joystick, dispose };
}
