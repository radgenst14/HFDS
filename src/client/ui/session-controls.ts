/**
 * Top bar session controls (doc 15 B6 region 1): play/pause, step, time scale, reset,
 * shareable link and "Export log". Sends session messages only. While paused, the copied
 * link also carries the sim time (`#scenario=<id>&t=<s>`, doc 17 M6).
 */
import { TIME_SCALES, type TimeScale } from '../../shared/constants';
import type { ClientMessage, Snapshot } from '../../shared/protocol';
import { shareLink } from './scenario-picker';

export interface SessionControls {
  sync(snapshot: Snapshot): void;
  togglePause(): void;
  step(): void;
  setTimeScale(scale: TimeScale): void;
}

export function initSessionControls(send: (msg: ClientMessage) => void): SessionControls {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const playPause = $<HTMLButtonElement>('btn-play-pause');
  const stepBtn = $<HTMLButtonElement>('btn-step');
  const scaleSel = $<HTMLSelectElement>('time-scale');
  const resetBtn = $<HTMLButtonElement>('btn-reset');
  const shareBtn = $<HTMLButtonElement>('btn-share');
  const exportBtn = $<HTMLButtonElement>('btn-export-log');
  let paused = false;
  let latest: Snapshot | null = null;

  const controls: SessionControls = {
    sync(s) {
      latest = s;
      paused = s.paused;
      playPause.textContent = s.paused ? 'Play' : 'Pause';
      playPause.setAttribute('aria-pressed', String(s.paused));
      stepBtn.disabled = !s.paused;
      if (document.activeElement !== scaleSel) scaleSel.value = String(s.timeScale);
      for (const el of [playPause, scaleSel, resetBtn, shareBtn, exportBtn]) el.disabled = false;
    },
    togglePause() {
      send({ type: paused ? 'resume' : 'pause' });
    },
    step() {
      if (paused) send({ type: 'step' });
    },
    setTimeScale(scale) {
      send({ type: 'set_time_scale', scale });
    },
  };

  playPause.addEventListener('click', () => controls.togglePause());
  stepBtn.addEventListener('click', () => controls.step());
  scaleSel.addEventListener('change', () => {
    const v = Number(scaleSel.value);
    const scale = TIME_SCALES.find((x) => x === v);
    if (scale !== undefined) controls.setTimeScale(scale);
  });
  resetBtn.addEventListener('click', () => send({ type: 'reset' }));
  shareBtn.title =
    'Copy a link to this scenario. While paused, the link opens the scenario at this moment.';
  shareBtn.addEventListener('click', () => {
    const link = latest
      ? shareLink(latest.scenarioId, latest.paused ? latest.simTime : null)
      : window.location.href;
    void navigator.clipboard?.writeText(link).then(
      () => (shareBtn.textContent = 'Link copied'),
      () => (shareBtn.textContent = 'Copy failed'),
    );
    window.setTimeout(() => (shareBtn.textContent = 'Copy link'), 1500);
  });
  exportBtn.addEventListener('click', () => send({ type: 'export_log' }));
  return controls;
}
