/**
 * Keyboard → intents (doc 15 B6 "Keyboard"). H HFDS button · Space brake (hold) ·
 * ↑ throttle (hold) · ←/→ steer (hold) · G both-hand grip · L eyes on road · P pause ·
 * . step · 1–4 time scale 0.5×/1×/2×/4× (A-34). Ignored while typing in a form field.
 */
import { KEYBOARD_STEER_INPUT, TIME_SCALES, type TimeScale } from '../shared/constants';
import type { DriverAction, Snapshot } from '../shared/protocol';

export interface KeyboardHandlers {
  sendInput(action: DriverAction): void;
  latest(): Snapshot | null;
  togglePause(): void;
  step(): void;
  setTimeScale(scale: TimeScale): void;
}

function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    target.isContentEditable ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (tag === 'INPUT' &&
      !['checkbox', 'range', 'button'].includes((target as HTMLInputElement).type))
  );
}

export function initKeyboard(h: KeyboardHandlers): void {
  const held = new Set<string>();
  const steerFromKeys = () =>
    (held.has('ArrowLeft') ? KEYBOARD_STEER_INPUT : 0) -
    (held.has('ArrowRight') ? KEYBOARD_STEER_INPUT : 0);

  window.addEventListener('keydown', (e) => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const first = !held.has(e.key);
    switch (e.key) {
      case 'h':
      case 'H':
        if (first) h.sendInput({ kind: 'pressHfdsButton' });
        break;
      case ' ':
        if (first) h.sendInput({ kind: 'setBrake', pressed: true });
        break;
      case 'ArrowUp':
        if (first) h.sendInput({ kind: 'setThrottle', value: 1 });
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        held.add(e.key);
        if (first) h.sendInput({ kind: 'setSteer', value: steerFromKeys() });
        break;
      case 'g':
      case 'G': {
        if (!first) break;
        const grip = h.latest()?.driver.grip;
        const on = !(grip?.L && grip.R);
        h.sendInput({ kind: 'setGrip', L: on, R: on });
        break;
      }
      case 'l':
      case 'L':
        if (first)
          h.sendInput({ kind: 'setGaze', eyesOnRoad: !(h.latest()?.driver.eyesOnRoad ?? true) });
        break;
      case 'p':
      case 'P':
        if (first) h.togglePause();
        break;
      case '.':
        h.step();
        break;
      case '1':
      case '2':
      case '3':
      case '4': {
        const scale = TIME_SCALES[Number(e.key) - 1];
        if (first && scale !== undefined) h.setTimeScale(scale);
        break;
      }
      default:
        return;
    }
    held.add(e.key);
    e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    if (!held.delete(e.key)) return;
    if (e.key === ' ') h.sendInput({ kind: 'setBrake', pressed: false });
    else if (e.key === 'ArrowUp') h.sendInput({ kind: 'setThrottle', value: 0 });
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      h.sendInput({ kind: 'setSteer', value: steerFromKeys() });
    }
  });

  window.addEventListener('blur', () => {
    if (held.has(' ')) h.sendInput({ kind: 'setBrake', pressed: false });
    if (held.has('ArrowUp')) h.sendInput({ kind: 'setThrottle', value: 0 });
    if (held.has('ArrowLeft') || held.has('ArrowRight'))
      h.sendInput({ kind: 'setSteer', value: 0 });
    held.clear();
  });
}
