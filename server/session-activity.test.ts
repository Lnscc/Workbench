import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSessionTail } from './session-activity.js';

const event = (type: string) => JSON.stringify({ type: 'event_msg', payload: { type } });
const started = `${event('task_started')}\n${JSON.stringify({ type: 'turn_context' })}`;
const aborted = event('turn_aborted');

test('a manual stop ends activity, including when the start is outside the tail', () => {
  for (const tail of [`${started}\n${aborted}`, aborted, `{partial\n${aborted}\n`]) {
    assert.deepEqual(parseSessionTail(tail, 1000, 1000), { working: false, interruption: null });
  }
});

test('a new turn after a stop is working until it completes or is stopped again', () => {
  const resumed = `${started}\n${aborted}\n${started}`;
  assert.equal(parseSessionTail(resumed, 1000, 1000).working, true);
  for (const end of [event('task_complete'), aborted]) {
    assert.equal(parseSessionTail(`${resumed}\n${end}`, 1000, 1000).working, false);
  }
});
