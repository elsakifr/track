/**
 * @track/tracking-client — platform-neutral offline buffer and batch uploader.
 *
 * The TypeScript reference implementation of the upload protocol (ADR-0008). Storage and
 * network are injected — `PositionQueue` and `RejectedEventStore` for storage, `Transport` for
 * sending — so the same logic runs on React Native (SQLite, M3) and in the Node simulator.
 */
export { assertBatchLimit } from './queue.ts';
export type { PositionQueue } from './queue.ts';
export { InMemoryPositionQueue } from './memory-queue.ts';
export { InMemoryRejectedEventStore } from './rejected-store.ts';
export type { RejectedEventStore, RejectedPosition } from './rejected-store.ts';
export { parseUploadOutcome } from './transport.ts';
export type { RejectedInBatch, Transport, UploadOutcome } from './transport.ts';
export { DEFAULT_BACKOFF } from './backoff.ts';
export type { BackoffOptions } from './backoff.ts';
export { Uploader } from './uploader.ts';
export type {
  FlushOutcome,
  FlushResult,
  UploaderOptions,
  UploaderState,
  UploaderStatus,
} from './uploader.ts';
