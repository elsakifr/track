import { InMemoryPositionQueue } from './memory-queue.ts';
import { describePositionQueue } from './queue-conformance.ts';

describePositionQueue('InMemoryPositionQueue', () => new InMemoryPositionQueue());
