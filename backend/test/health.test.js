import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server.js';
import http from 'node:http';

test('health endpoint is exposed', async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const { port } = server.address();
  const response = await fetch(`http://localhost:${port}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ok');
  server.close();
});
