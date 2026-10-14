import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { READER_STATUS, startReader } from '../src/dsmr/reader.js';
import { normalizeConfig } from '../src/config.js';
import { NL_DSMR5, SE_TOTALS } from './fixtures/telegrams.js';

/** A fake TCP socket: the test plays the P1 reader. */
function fakeConnect() {
  const sockets = [];
  const connect = (options) => {
    const socket = new EventEmitter();
    socket.options = options;
    socket.setTimeout = () => {};
    socket.destroyed = false;
    socket.destroy = () => {
      if (socket.destroyed) return;
      socket.destroyed = true;
      socket.emit('close');
    };
    sockets.push(socket);
    return socket;
  };
  return { connect, sockets };
}

function recorder() {
  const telegrams = [];
  const statuses = [];
  return {
    telegrams,
    statuses,
    handlers: {
      onTelegram: (telegram) => telegrams.push(telegram),
      onStatus: (status, error) => statuses.push(error ? `${status}: ${error.message}` : status),
    },
  };
}

test('TCP: the stream is cut into telegrams, connected on the first one', () => {
  const { connect, sockets } = fakeConnect();
  const { telegrams, statuses, handlers } = recorder();
  const config = normalizeConfig({ host: '192.168.1.50', port: 2001 });
  const stop = startReader(config, handlers, { connect });
  assert.deepEqual(sockets[0].options, { host: '192.168.1.50', port: 2001 });
  sockets[0].emit('data', Buffer.from(NL_DSMR5.slice(0, 100), 'latin1'));
  assert.deepEqual(statuses, [READER_STATUS.CONNECTING]);
  sockets[0].emit('data', Buffer.from(NL_DSMR5.slice(100) + SE_TOTALS, 'latin1'));
  assert.deepEqual(telegrams, [NL_DSMR5, SE_TOTALS]);
  assert.deepEqual(statuses, [READER_STATUS.CONNECTING, READER_STATUS.CONNECTED]);
  stop();
  assert.equal(sockets[0].destroyed, true);
  assert.equal(statuses.at(-1), READER_STATUS.STOPPED);
});

test('TCP: a lost connection is retried with a growing delay', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { connect, sockets } = fakeConnect();
  const { statuses, handlers } = recorder();
  const stop = startReader(normalizeConfig({ host: 'p1.local' }), handlers, { connect });
  sockets[0].emit('error', new Error('connect ECONNREFUSED'));
  sockets[0].destroy();
  assert.equal(statuses.at(-1), 'error: connect ECONNREFUSED');
  t.mock.timers.tick(5_000);
  assert.equal(sockets.length, 2, 'retried after 5 s');
  sockets[1].destroy();
  t.mock.timers.tick(5_000);
  assert.equal(sockets.length, 2, 'the second retry waits longer');
  t.mock.timers.tick(5_000);
  assert.equal(sockets.length, 3);
  stop();
  t.mock.timers.tick(120_000);
  assert.equal(sockets.length, 3, 'no retry once stopped');
});

test('TCP: a silent reader is disconnected (and then retried)', () => {
  const { connect, sockets } = fakeConnect();
  const { statuses, handlers } = recorder();
  const stop = startReader(normalizeConfig({ host: 'p1.local' }), handlers, { connect });
  sockets[0].emit('timeout');
  assert.equal(sockets[0].destroyed, true);
  stop();
  assert.ok(statuses.includes(READER_STATUS.STOPPED));
});

test('HTTP: the last telegram is polled at the refresh interval', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, text: async () => NL_DSMR5 };
  };
  const { telegrams, statuses, handlers } = recorder();
  const config = normalizeConfig({
    connection_type: 'http',
    http_url: 'http://192.168.1.60/api/v1/telegram',
    publish_interval: 10,
  });
  const stop = startReader(config, handlers, { fetchImpl });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(telegrams, [NL_DSMR5]);
  assert.deepEqual(statuses, [READER_STATUS.CONNECTING, READER_STATUS.CONNECTED]);
  t.mock.timers.tick(10_000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(urls.length, 2);
  assert.equal(urls[0], 'http://192.168.1.60/api/v1/telegram');
  stop();
});

test('HTTP: an error answer is reported', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => '' });
  const { telegrams, statuses, handlers } = recorder();
  const config = normalizeConfig({ connection_type: 'http', http_url: 'http://p1.local/x' });
  const stop = startReader(config, handlers, { fetchImpl });
  await new Promise((resolve) => setImmediate(resolve));
  stop();
  assert.deepEqual(telegrams, []);
  assert.equal(statuses[1], 'error: HTTP 403 from the P1 reader');
});
