/**
 * Transport that runs the engine in a Web Worker (doc 15 Part A). Only this module knows
 * where the engine runs; a WebSocketTransport could replace it later.
 */
import type { ClientMessage, EngineMessage } from '../shared/protocol';
import type { Transport } from './transport';

export class WorkerTransport implements Transport {
  private readonly worker: Worker;
  private readonly handlers: Array<(msg: EngineMessage) => void> = [];

  /** @param scenariosBaseUrl absolute URL of the scenarios/ folder (passed as the worker name). */
  constructor(scenariosBaseUrl: string) {
    this.worker = new Worker(new URL('../engine/worker.ts', import.meta.url), {
      type: 'module',
      name: scenariosBaseUrl,
    });
    this.worker.onmessage = (ev: MessageEvent<EngineMessage>) => {
      for (const h of this.handlers) h(ev.data);
    };
    this.worker.onerror = (ev) => {
      const msg: EngineMessage = { type: 'error', message: `Engine worker error: ${ev.message}` };
      for (const h of this.handlers) h(msg);
    };
  }

  send(msg: ClientMessage): void {
    this.worker.postMessage(msg);
  }

  onMessage(handler: (msg: EngineMessage) => void): void {
    this.handlers.push(handler);
  }

  close(): void {
    this.worker.terminate();
    this.handlers.length = 0;
  }
}
