/**
 * 程序化音效：全部用 WebAudio 振荡器与噪声合成，仓库不带任何音频素材。
 */
export function createAudio() {
  let ac = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;
  let lastShootAt = 0;
  let lastGemAt = 0;
  let shotToggle = false;

  function ensure() {
    if (ac) return ac;
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    try {
      ac = new Ctor();
    } catch {
      return null;
    }
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ac.destination);
    noiseBuffer = makeNoiseBuffer(ac);
    return ac;
  }

  function now() {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  function tone({ from = 440, to = from, dur = 0.09, type = 'square', gain = 0.1, delay = 0 }) {
    if (!ensure()) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, from), t0);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function noise({ dur = 0.1, gain = 0.08, freq = 1200, delay = 0 }) {
    if (!ensure() || !noiseBuffer) return;
    const t0 = ac.currentTime + delay;
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer;
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq, t0);
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  function play(event) {
    if (!event || muted) return;
    switch (event.type) {
      case 'shoot': {
        shotToggle = !shotToggle;
        if (!shotToggle) return;
        const t = now();
        if (t - lastShootAt < 45) return;
        lastShootAt = t;
        tone({ from: 900, to: 620, dur: 0.05, type: 'square', gain: 0.045 });
        break;
      }
      case 'kill':
        noise({ dur: 0.11, gain: 0.07, freq: 900 });
        tone({ from: 320, to: 120, dur: 0.11, type: 'triangle', gain: 0.04 });
        break;
      case 'gem': {
        const t = now();
        if (t - lastGemAt < 70) return;
        lastGemAt = t;
        tone({ from: 1400, to: 1900, dur: 0.05, type: 'sine', gain: 0.025 });
        break;
      }
      case 'hurt':
        tone({ from: 210, to: 80, dur: 0.22, type: 'sawtooth', gain: 0.14 });
        noise({ dur: 0.16, gain: 0.07, freq: 520 });
        break;
      case 'dash':
        noise({ dur: 0.16, gain: 0.06, freq: 2400 });
        tone({ from: 600, to: 1200, dur: 0.12, type: 'sine', gain: 0.045 });
        break;
      case 'nova':
        tone({ from: 160, to: 900, dur: 0.28, type: 'sine', gain: 0.09 });
        noise({ dur: 0.24, gain: 0.05, freq: 1500 });
        break;
      case 'levelup':
        [523, 659, 784].forEach((f, i) => tone({ from: f, to: f, dur: 0.14, type: 'triangle', gain: 0.09, delay: i * 0.07 }));
        break;
      case 'upgrade':
        tone({ from: 660, to: 990, dur: 0.16, type: 'triangle', gain: 0.09 });
        break;
      case 'boss':
        tone({ from: 90, to: 45, dur: 0.9, type: 'sawtooth', gain: 0.16 });
        break;
      case 'bossBurst':
        noise({ dur: 0.14, gain: 0.04, freq: 700 });
        break;
      case 'victory':
        [523, 659, 784, 1047].forEach((f, i) => tone({ from: f, to: f, dur: 0.22, type: 'triangle', gain: 0.1, delay: i * 0.1 }));
        break;
      case 'dead':
        tone({ from: 240, to: 55, dur: 0.8, type: 'sawtooth', gain: 0.16 });
        break;
      default:
        break;
    }
  }

  function setMuted(next) {
    muted = Boolean(next);
    if (master) master.gain.value = muted ? 0 : 0.9;
  }

  function unlock() {
    if (!ensure()) return;
    if (ac.state === 'suspended') ac.resume();
  }

  return {
    play,
    setMuted,
    unlock,
    isMuted: () => muted,
  };
}

function makeNoiseBuffer(ac) {
  const length = Math.floor(ac.sampleRate * 0.4);
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}
