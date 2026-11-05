/**
 * Optional sound for the HMI alert channels (doc 15 B5 audio.ts; doc 17 M4): a WebAudio
 * chime while `hmi.audibleAlert` is on (R30.2, UC19) and the voice prompt via
 * speechSynthesis when `hmi.voicePrompt` appears (R31.2). Muted by default; the HMI shows
 * the same channels as text either way. Display only: the engine decides when they fire.
 */
import type { HmiState } from '../shared/domain';

const CHIME_INTERVAL_MS = 1200;

export interface AlertAudio {
  sync(hmi: HmiState): void;
}

export function initAudio(button: HTMLButtonElement): AlertAudio {
  let enabled = false;
  let ctx: AudioContext | null = null;
  let chimeTimer: number | null = null;
  let lastVoice: string | undefined;

  const beep = () => {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  };

  const stopChime = () => {
    if (chimeTimer !== null) window.clearInterval(chimeTimer);
    chimeTimer = null;
  };

  button.addEventListener('click', () => {
    enabled = !enabled;
    button.textContent = enabled ? 'Sound: on' : 'Sound: off';
    button.setAttribute('aria-pressed', String(enabled));
    if (enabled && !ctx && 'AudioContext' in window) ctx = new AudioContext();
    if (!enabled) {
      stopChime();
      window.speechSynthesis?.cancel();
    }
  });

  return {
    sync(hmi) {
      if (enabled && hmi.audibleAlert && chimeTimer === null) {
        beep();
        chimeTimer = window.setInterval(beep, CHIME_INTERVAL_MS);
      } else if (!hmi.audibleAlert || !enabled) {
        stopChime();
      }
      if (hmi.voicePrompt !== lastVoice) {
        lastVoice = hmi.voicePrompt;
        if (enabled && hmi.voicePrompt && 'speechSynthesis' in window) {
          window.speechSynthesis.speak(new SpeechSynthesisUtterance(hmi.voicePrompt));
        }
      }
    },
  };
}
