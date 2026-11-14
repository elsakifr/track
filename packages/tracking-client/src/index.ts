/**
 * @track/tracking-client — platform-neutral offline buffer and batch uploader.
 *
 * The TypeScript reference implementation of the upload protocol (ADR-0008). Storage is
 * injected through the `PositionQueue` interface, so the same logic runs on React Native
 * (SQLite, M3) and in the Node simulator (in memory). The uploader follows in #17.
 */
export { assertBatchLimit } from './queue.ts';
export type { PositionQueue } from './queue.ts';
export { InMemoryPositionQueue } from './memory-queue.ts';
