/**
 * Driver panel (doc 15 B6 region 5): HFDS button, brake, throttle, steer, grip areas,
 * eyes on road, gap and set speed. Each control sends an `input` intent (DriverAction);
 * the panel mirrors the engine's driver state so scripted timeline actions show up.
 */
import { GAP_SETTINGS_S } from '../../shared/constants';
import { GapSetting, enumValues } from '../../shared/domain';
import type { DriverAction, Snapshot } from '../../shared/protocol';

type Send = (action: DriverAction) => void;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string> } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(node, rest);
  if (dataset) Object.assign(node.dataset, dataset);
  node.append(...children);
  return node;
}

export interface DriverPanel {
  sync(snapshot: Snapshot): void;
}

export function initDriverPanel(host: HTMLElement, send: Send): DriverPanel {
  const hfdsBtn = el('button', {
    type: 'button',
    className: 'hfds-button',
    textContent: 'HFDS button (H)',
  });
  hfdsBtn.dataset.testid = 'hfds-button';
  hfdsBtn.addEventListener('click', () => send({ kind: 'pressHfdsButton' }));

  const brakeBtn = el('button', { type: 'button', textContent: 'Brake (hold Space)' });
  brakeBtn.dataset.testid = 'brake-button';
  const brakeOn = () => send({ kind: 'setBrake', pressed: true });
  const brakeOff = () => send({ kind: 'setBrake', pressed: false });
  brakeBtn.addEventListener('pointerdown', brakeOn);
  brakeBtn.addEventListener('pointerup', brakeOff);
  brakeBtn.addEventListener('pointerleave', (e) => {
    if (e.buttons) brakeOff();
  });

  const throttle = el('input', { type: 'range', min: '0', max: '1', step: '0.05', value: '0' });
  throttle.setAttribute('aria-label', 'Throttle');
  throttle.addEventListener('input', () =>
    send({ kind: 'setThrottle', value: Number(throttle.value) }),
  );

  const steer = el('input', { type: 'range', min: '-1', max: '1', step: '0.05', value: '0' });
  steer.setAttribute('aria-label', 'Steering (left is positive)');
  steer.addEventListener('input', () => send({ kind: 'setSteer', value: -Number(steer.value) }));
  const center = el('button', { type: 'button', textContent: 'Center' });
  center.addEventListener('click', () => send({ kind: 'setSteer', value: 0 }));

  const grips = (['L', 'R', 'TOP', 'BOTTOM'] as const).map((k) => {
    const box = el('input', { type: 'checkbox' });
    box.addEventListener('change', () => send({ kind: 'setGrip', [k]: box.checked }));
    return { k, box, label: el('label', {}, [box, ` ${k}`]) };
  });

  const eyes = el('input', { type: 'checkbox' });
  eyes.addEventListener('change', () => send({ kind: 'setGaze', eyesOnRoad: eyes.checked }));

  const gap = el(
    'select',
    {},
    enumValues(GapSetting).map((g) => el('option', { value: g, textContent: g })),
  );
  gap.setAttribute('aria-label', 'Following gap');
  gap.addEventListener('change', () =>
    send({ kind: 'setGap', gapSetting: gap.value as GapSetting }),
  );

  const setSpeed = el('input', { type: 'number', min: '1', max: '100', step: '1', value: '65' });
  setSpeed.setAttribute('aria-label', 'Set speed (mph)');
  const setSpeedBtn = el('button', { type: 'button', textContent: 'Set' });
  setSpeedBtn.addEventListener('click', () => {
    const mph = Number(setSpeed.value);
    if (mph > 0) send({ kind: 'setSpeed', mph });
  });

  const row = (label: string, ...nodes: Node[]) =>
    el('div', { className: 'control-row' }, [
      el('span', { className: 'control-label', textContent: label }),
      ...nodes,
    ]);

  host.replaceChildren(
    row('HFDS', hfdsBtn),
    row('Brake', brakeBtn),
    row('Throttle', throttle),
    row('Steer', steer, center),
    row('Grip', ...grips.map((g) => g.label)),
    row('Eyes', el('label', {}, [eyes, ' on road (L)'])),
    row('Gap', gap),
    row('Set speed', setSpeed, setSpeedBtn),
  );

  return {
    sync(s) {
      const d = s.driver;
      const busy = (n: Element) => document.activeElement === n;
      if (!busy(throttle)) throttle.value = String(d.throttle);
      if (!busy(steer)) steer.value = String(-d.steer);
      for (const g of grips) g.box.checked = d.grip[g.k];
      eyes.checked = d.eyesOnRoad;
      brakeBtn.classList.toggle('active', d.brake);
      if (!busy(gap)) {
        const current = Object.entries(GAP_SETTINGS_S).find(
          ([, v]) => v === s.hfds.acc.timeGapS,
        )?.[0];
        if (current) gap.value = current;
      }
    },
  };
}
