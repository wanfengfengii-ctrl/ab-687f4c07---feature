/**
 * 冒烟验收：健康检查 + 校核样例（通过 /api/verify，与浏览器页面共用同一数学模块）。
 * 用法：node scripts/smoke.js [baseURL]   （默认 http://127.0.0.1:8080，可用 SMOKE_BASE_URL 覆盖）
 * 全部通过退出码 0，否则退出码 1。
 */

const base = (process.argv[2] || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');

let failures = 0;
function check(cond, label, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  —— ' + extra : ''}`);
  if (!cond) failures++;
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const ident = (rows, cols) =>
  Array.from({ length: rows + 1 }, (_, i) =>
    Array.from({ length: cols + 1 }, (_, j) => ({ x: j, y: i })));

async function postVerify(spec) {
  const res = await fetch(`${base}/api/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(spec),
  });
  return { status: res.status, body: await res.json() };
}

/* 1) 健康检查（重试等待服务就绪） */
let health = null;
for (let i = 0; i < 30 && !health; i++) {
  try {
    const r = await fetch(`${base}/healthz`);
    if (r.ok) health = await r.json();
  } catch { /* 服务尚未就绪，继续等待 */ }
  if (!health) await new Promise((r) => setTimeout(r, 1000));
}
check(!!health && health.status === 'ok', '健康检查 GET /healthz', JSON.stringify(health));

/* 2) 样例 A：恒等网格 —— 通过，J_min = 1，标记原样换算 */
{
  const { status, body } = await postVerify({
    rows: 2, cols: 2, knots: ident(2, 2),
    markers: [{ u: 0.5, v: 0.5 }, { u: 1.5, v: 1.5 }, { u: 2, v: 1 }],
  });
  check(status === 200 && body.ok === true, '样例A：恒等网格校核通过');
  check(body.minJacobian && body.minJacobian.value === 1, '样例A：全网最小雅可比 = 1', JSON.stringify(body.minJacobian));
  const m = body.markers || [];
  check(
    m.length === 3 && near(m[0].x, 0.5) && near(m[0].y, 0.5) && near(m[1].x, 1.5) && near(m[2].x, 2) && near(m[2].y, 1),
    '样例A：标记换算位置正确', JSON.stringify(m),
  );
  check(body.edges && body.edges.continuous === true && body.edges.edgeCount === 4, '样例A：相邻单元共享边连续');
}

/* 3) 样例 B：翻折 —— 首项失败证据 = 单元(0,0) 角点 C1，J = -1，且不输出标记 */
{
  const k = ident(2, 2);
  k[1][1] = { x: -1, y: -1 };
  const { body } = await postVerify({
    rows: 2, cols: 2, knots: k,
    markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 0.5 }],
  });
  const f = body.firstFailure || {};
  const cell = f.cell || {};
  check(
    body.ok === false && f.type === 'fold' && cell.r === 0 && cell.c === 0 && f.corner === 1 && f.jacobian === -1,
    '样例B：翻折首项证据（行优先单元 + 固定角点序）', JSON.stringify(f),
  );
  check(body.markers === null, '样例B：失败时不输出纹样换算位置');
}

/* 4) 样例 C：退化 —— 首项失败证据 = 单元(0,0) 角点 C1，J = 0 */
{
  const k = ident(2, 2);
  k[1][1] = { x: 2, y: 0 };
  const { body } = await postVerify({
    rows: 2, cols: 2, knots: k,
    markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 0.5 }],
  });
  const f = body.firstFailure || {};
  const cell = f.cell || {};
  check(
    body.ok === false && f.type === 'degenerate' && cell.r === 0 && cell.c === 0 && f.corner === 1 && f.jacobian === 0,
    '样例C：退化首项证据', JSON.stringify(f),
  );
  check(body.markers === null, '样例C：失败时不输出纹样换算位置');
}

/* 5) 样例 D：无效坐标 —— 非整数网结被拒绝 */
{
  const k = ident(2, 2);
  k[0][1] = { x: 0.5, y: 0 };
  const { body } = await postVerify({
    rows: 2, cols: 2, knots: k,
    markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 1.5 }],
  });
  check(
    body.ok === false && body.stage === 'validation' && Array.isArray(body.errors) && body.errors.length > 0,
    '样例D：无效坐标被拒绝', JSON.stringify(body.errors && body.errors[0]),
  );
  check(body.markers === null, '样例D：无效输入不输出纹样位置');
}

/* 6) 样例 E：引线伸缩——恒等网格倍率恰为 1，片段证据完整 */
{
  const markers = [{ u: 0.2, v: 0.2 }, { u: 3.2, v: 1.2 }, { u: 1, v: 1 }];
  const { body } = await postVerify({
    rows: 2, cols: 4, knots: ident(2, 4), markers,
    lines: [{ from: 0, to: 1, minRatio: 0.99, maxRatio: 1.01 }],
  });
  const it = body.lines && body.lines.items && body.lines.items[0];
  const L = Math.hypot(3, 1);
  check(body.ok === true && body.lines && body.lines.firstFailure === null, '样例E：恒等网引线倍率 1 通过');
  check(
    !!it && near(it.originalLength, L) && near(it.wovenLength, L, 1e-9)
      && near(it.ratio, 1, 1e-9) && it.segments.length === 5,
    '样例E：原始/织补长度、倍率与 5 个单元片段证据', JSON.stringify(it && {
      o: it.originalLength, w: it.wovenLength, r: it.ratio, n: it.segments.length,
    }),
  );
}

/* 7) 样例 F：中途被拉长——端点直线距离看似倍率 1，逐片段精确弧长判超限 */
{
  const k = ident(2, 2);
  k[1] = [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 1 }];
  k[2] = [{ x: 0, y: 2 }, { x: 1, y: 4 }, { x: 2, y: 2 }];
  const markers = [{ u: 0, v: 1 }, { u: 2, v: 1 }, { u: 0.5, v: 0.5 }];
  const { body } = await postVerify({
    rows: 2, cols: 2, knots: k, markers,
    lines: [{ from: 0, to: 1, minRatio: 0.95, maxRatio: 1.05 }],
  });
  const f = body.lines && body.lines.firstFailure;
  check(
    body.ok === false && body.firstFailure === null && f && f.index === 0
      && f.reason === 'ratio-out-of-range' && f.segments.length === 2,
    '样例F：网格通过但引线中途拉长，首项失败为倍率超限', JSON.stringify(f && {
      reason: f.reason, segs: f.segments.length,
    }),
  );
  check(
    !!f && near(f.originalLength, 2) && near(f.wovenLength, 2 * Math.SQRT2, 1e-9)
      && near(f.ratio, Math.SQRT2, 1e-9),
    '样例F：长度证据 = 原长 2、精确弧长 2√2、倍率 √2', JSON.stringify(f && {
      o: f.originalLength, w: f.wovenLength, r: f.ratio,
    }),
  );
  check(body.markers !== null, '样例F：网格本身通过，标记换算位置仍输出');
}

/* 8) 样例 G：原始长度为零——按录入顺序首项失败并给零长度证据 */
{
  const markers = [{ u: 1, v: 1 }, { u: 1, v: 1 }, { u: 0.5, v: 0.5 }];
  const { body } = await postVerify({
    rows: 2, cols: 2, knots: ident(2, 2), markers,
    lines: [{ from: 0, to: 1, minRatio: 0.5, maxRatio: 2 }],
  });
  const f = body.lines && body.lines.firstFailure;
  check(
    body.ok === false && f && f.reason === 'zero-length' && f.originalLength === 0 && f.ratio === null,
    '样例G：零长度引线首项失败（含长度证据）', JSON.stringify(f),
  );
}

/* 9) 样例 H：未配置引线的既有草稿——响应形态保持原样（lines=null） */
{
  const { body } = await postVerify({
    rows: 2, cols: 2, knots: ident(2, 2),
    markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 1.5 }],
  });
  check(body.ok === true && !Object.prototype.hasOwnProperty.call(body, 'lines'),
    '样例H：未配置引线时响应不含 lines 字段，既有响应逐字不变');
}

/* 10) 样例 I：端点引用无效标记——校验阶段拒绝 */
{
  const { body } = await postVerify({
    rows: 2, cols: 2, knots: ident(2, 2),
    markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 1.5 }],
    lines: [{ from: 0, to: 9, minRatio: 0.5, maxRatio: 2 }],
  });
  check(
    body.ok === false && body.stage === 'validation'
      && body.errors.some((e) => e.kind === 'line-endpoint'),
    '样例I：引线端点无效被拒绝', JSON.stringify(body.errors[0]),
  );
}

if (failures) {
  console.error(`\n冒烟验收未通过：${failures} 项失败`);
  process.exit(1);
}
console.log('\n冒烟验收通过：健康检查 + 全部校核样例');
