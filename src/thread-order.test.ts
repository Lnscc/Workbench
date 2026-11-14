import assert from 'node:assert/strict';
import test from 'node:test';
import { sortByUpdatedAtDesc } from './thread-order';

test('sorts threads by their latest update in descending order', () => {
  const threads = [
    { id: 'older', updatedAt: 10 },
    { id: 'newest', updatedAt: 30 },
    { id: 'middle', updatedAt: 20 }
  ];

  assert.deepEqual(sortByUpdatedAtDesc(threads).map(thread => thread.id), ['newest', 'middle', 'older']);
  assert.deepEqual(threads.map(thread => thread.id), ['older', 'newest', 'middle']);
});
