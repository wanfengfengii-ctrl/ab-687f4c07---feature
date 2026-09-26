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

test('引线伸缩 API：通过样例返回逐片段弧长与倍率，未配置引线时无引线字段', async () => {
  await withServer(async (base) => {
    const okRes = await fetch(`${base}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: 3, cols: 4, knots: ident(3, 4),
        markers: [{ u: 0.2, v: 0.3 }, { u: 3.7, v: 2.6 }, { u: 1, v: 1 }],
        leads: [{ from: 0, to: 1, minRatio: 0.99, maxRatio: 1.01 }],
      }),
    });
    const body = await okRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.leads.length, 1);
    assert.equal(body.leads[0].segments.length, 6);
    assert.ok(Math.abs(body.leads[0].ratio - 1) < 1e-9);

    const plain = await fetch(`${base}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: 2, cols: 2, knots: ident(2, 2),
        markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 1.5 }],
      }),
    });
    const pb = await plain.json();
    assert.equal(pb.ok, true);
    assert.equal('leads' in pb, false);
  });
});

test('引线伸缩 API：倍率超限返回 stage=leads 与首项失败长度证据', async () => {
  await withServer(async (base) => {
    const k = ident(2, 2);
    k[1][0] = { x: -2, y: 1 };
    const res = await fetch(`${base}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rows: 2, cols: 2, knots: k,
        markers: [{ u: 0, v: 0 }, { u: 2, v: 2 }, { u: 1, v: 1 }],
        leads: [{ from: 0, to: 1, minRatio: 1, maxRatio: 1.05 }],
      }),
    });
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.stage, 'leads');
    assert.equal(body.leadFailure.index, 0);
    assert.equal(body.leadFailure.type, 'ratio');
    assert.ok(body.leadFailure.evidence.mappedLength > body.leadFailure.evidence.originalLength);
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
