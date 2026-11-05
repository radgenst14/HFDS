/**
 * Client entry: wires the scenario picker, session controls, Driver panel, keyboard,
 * road renderer, cluster, caption and event log to the engine through the Transport
 * (doc 15 Part A "Architecture"). The client renders snapshots and sends intents; it
 * never decides HFDS outcomes (CLAUDE.md rule 5).
 */
import type { LogEntry, LogFile } from '../shared/domain';
import type { EngineMessage, Snapshot } from '../shared/protocol';
import { WorkerTransport } from '../transport/worker-transport';
import type { Transport } from '../transport/transport';
import { initAudio } from './audio';
import { initKeyboard } from './input';
import { RoadRenderer } from './renderer/renderer';
import { renderCaption, renderCaptionError, type ScenarioInfo } from './ui/caption-panel';
import { initChecklist } from './ui/checklist';
import { initCluster } from './ui/cluster';
import { initDriverPanel } from './ui/driver-panel';
import { initEventLogPanel } from './ui/event-log';
import { initScenarioPicker } from './ui/scenario-picker';
import { initSessionControls } from './ui/session-controls';

const byId = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from index.html`);
  return node as T;
};

function downloadLog(file: LogFile): void {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hfds-log-${file.scenarioId}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function init(): Promise<void> {
  const scenariosBase = new URL('./scenarios/', document.baseURI).href;
  const transport: Transport = new WorkerTransport(scenariosBase);

  const captionBody = byId('caption-body');
  const cluster = initCluster(byId('cluster'));
  const checklist = initChecklist(byId('checklist-body'));
  const audio = initAudio(byId<HTMLButtonElement>('btn-sound'));
  const log = initEventLogPanel(byId<HTMLOListElement>('event-log-body'));
  const session = initSessionControls((m) => transport.send(m));
  const driverPanel = initDriverPanel(byId('driver-body'), (action) =>
    transport.send({ type: 'input', action }),
  );
  byId('director-body').textContent = 'Director injections are added in M5 (doc 17).';
  byId('trace-body').textContent = 'Requirement trace panel is added in M6 (doc 17).';

  let latest: Snapshot | null = null;
  let renderer: RoadRenderer | null = null;
  try {
    renderer = await RoadRenderer.create(byId('road-view'));
  } catch (err) {
    byId('road-view').textContent = `Road view unavailable: ${String(err)}`;
  }

  transport.onMessage((msg: EngineMessage) => {
    switch (msg.type) {
      case 'state':
        latest = msg.snapshot;
        renderer?.push(msg.snapshot);
        cluster.sync(msg.snapshot);
        checklist.sync(msg.snapshot);
        audio.sync(msg.snapshot.hmi);
        session.sync(msg.snapshot);
        driverPanel.sync(msg.snapshot);
        break;
      case 'event':
        if (msg.name === 'scenario_loaded') {
          log.clear();
          renderCaption(captionBody, msg.data as ScenarioInfo);
        } else if (msg.name !== 'scenario_end') {
          log.append(msg.data as LogEntry);
        }
        break;
      case 'error':
        console.error(msg.message);
        renderCaptionError(captionBody, msg.message);
        break;
      case 'log_export':
        downloadLog(msg.file);
        break;
    }
  });

  initKeyboard({
    sendInput: (action) => transport.send({ type: 'input', action }),
    latest: () => latest,
    togglePause: () => session.togglePause(),
    step: () => session.step(),
    setTimeScale: (scale) => session.setTimeScale(scale),
  });

  const picker = byId<HTMLSelectElement>('scenario-picker');
  try {
    await initScenarioPicker(picker, (id) => transport.send({ type: 'load_scenario', id }));
  } catch (err) {
    picker.replaceChildren(new Option('Failed to load presets', '', true, true));
    renderCaptionError(captionBody, String(err));
  }
}

void init();
