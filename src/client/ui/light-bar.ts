/**
 * Steering-wheel light bar (R33, R34; doc 15 B6). Never colour alone: every state has a
 * text label (accessibility rule in doc 15 B6). Animation is CSS; reduced motion slows it.
 */
import type { HmiState, LightBarState } from '../../shared/domain';

const LABELS: Record<LightBarState, string> = {
  Off: 'Off',
  SolidGreen: 'Solid green — HFDS steering, hands-free allowed (R33, R33.1)',
  FlashingGreen: 'Flashing green — driver engagement questionable (R34.1)',
  PulsingBlue: 'Pulsing blue — driver steering manually (R34.2)',
  FlashingRed: 'Flashing red — take steering control immediately (R34.3)',
};

export interface LightBar {
  sync(hmi: HmiState): void;
}

export function initLightBar(host: HTMLElement): LightBar {
  const bar = document.createElement('div');
  bar.className = 'light-bar';
  bar.dataset.testid = 'light-bar';
  bar.setAttribute('role', 'status');
  const label = document.createElement('span');
  label.className = 'light-bar-label';
  label.dataset.testid = 'light-bar-label';
  host.replaceChildren(bar, label);
  let last = '';
  return {
    sync(hmi) {
      const key = `${hmi.lightBarStatus}|${hmi.lightBarError}`;
      if (key === last) return;
      last = key;
      bar.dataset.state = hmi.lightBarError ? 'Error' : hmi.lightBarStatus;
      label.textContent = hmi.lightBarError
        ? 'Amber flash — activation error (R16.3)'
        : LABELS[hmi.lightBarStatus];
    },
  };
}
