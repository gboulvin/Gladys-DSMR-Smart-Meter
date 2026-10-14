import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configProblem, DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';

test('normalizeConfig returns the defaults when called with no argument', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig coerces and bounds the values coming from the form', () => {
  const config = normalizeConfig({
    connection_type: 'http',
    host: ' 192.168.1.50 ',
    port: '2001',
    publish_interval: '1',
    decryption_key: '00112233445566778899aabbccddeeff',
  });
  assert.equal(config.connection_type, 'http');
  assert.equal(config.host, '192.168.1.50');
  assert.equal(config.port, 2001);
  assert.equal(config.publish_interval, 5, 'never faster than every 5 s');
  assert.equal(config.decryption_key, '00112233445566778899AABBCCDDEEFF');
});

test('an unknown connection type falls back to TCP', () => {
  assert.equal(normalizeConfig({ connection_type: 'serial' }).connection_type, 'tcp');
});

test('configProblem says what is missing, in the four languages', () => {
  const tcp = configProblem(normalizeConfig({}));
  assert.match(tcp.en, /IP address/);
  assert.deepEqual(Object.keys(tcp), ['en', 'fr', 'de', 'es']);
  assert.match(configProblem(normalizeConfig({ connection_type: 'http' })).en, /URL/);
  assert.match(
    configProblem(normalizeConfig({ host: 'p1.local', decryption_key: 'abc' }), 'abc').en,
    /32 hexadecimal/,
  );
  assert.equal(configProblem(normalizeConfig({ host: 'p1.local' })), null);
  assert.equal(
    configProblem(normalizeConfig({ connection_type: 'http', http_url: 'http://p1/x' })),
    null,
  );
});
