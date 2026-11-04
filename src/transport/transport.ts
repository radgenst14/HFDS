/**
 * The only seam between the page and the engine (doc 15 Part A "Architecture").
 * WorkerTransport (M1) runs the engine in a Web Worker; a WebSocketTransport could
 * move it to a server later without touching the renderer or UI.
 */
import type { ClientMessage, EngineMessage } from '../shared/protocol';

export interface Transport {
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: EngineMessage) => void): void;
  close(): void;
}
