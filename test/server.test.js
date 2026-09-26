import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

const ident = (rows, cols) =>
  Array.from({ length: rows + 1 }, (_, i) =>
    Array.from({ length: cols + 1 }, (_, j) => ({ x: j, y: i })));

async function withServer(fn) {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('健康检查与校核 API', async () => {
  await withServer(async (base) => {
    const h = await fetch(`${base}/healthz`);
    assert.equal(h.status, 200);
    const hb = await h.json();
    assert.equal(hb.status, 'ok');
    assert.ok(typeof hb.uptimeSeconds === 'number');

    const res = await fetch(`${base}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: 2, cols: 2, knots: ident(2, 2),
        markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 1.5 }],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.minJacobian.value, 1);
    assert.equal(body.markers.length, 3);
  });
});

test('API 错误处理：方法不允许与非法 JSON', async () => {
  await withServer(async (base) => {
    const get = await fetch(`${base}/api/verify`);
    assert.equal(get.status, 405);

    const bad = await fetch(`${base}/api/verify`, { method: 'POST', body: 'not json' });
    assert.equal(bad.status, 400);

    const empty = await fetch(`${base}/api/verify`, { method: 'POST', body: '{}' });
    assert.equal(empty.status, 200);
    const eb = await empty.json();
    assert.equal(eb.ok, false);
    assert.equal(eb.stage, 'validation');
  });
});

test('静态文件：不存在的路径返回 404，路径穿越被拒绝', async () => {
  await withServer(async (base) => {
    const missing = await fetch(`${base}/no-such-file.js`);
    assert.equal(missing.status, 404);
    const traversal = await fetch(`${base}/..%2F..%2Fpackage.json`);
    assert.ok([403, 404].includes(traversal.status));
  });
});
