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

/* 6) 样例 E：引线伸缩通过 —— 恒等网格倍率恰为 1，逐片段弧长之和 = 原长 */
{
  const { status, body } = await postVerify({
    rows: 3, cols: 4, knots: ident(3, 4),
    markers: [{ u: 0.2, v: 0.3 }, { u: 3.7, v: 2.6 }, { u: 1, v: 1 }],
    leads: [{ from: 0, to: 1, minRatio: 0.99, maxRatio: 1.01 }],
  });
  const ld = body.leads && body.leads[0];
  check(status === 200 && body.ok === true && body.stage === 'geometry', '样例E：引线伸缩校核通过');
  check(
    !!ld && ld.segments.length === 6 &&
    near(ld.originalLength, Math.hypot(3.5, 2.3)) &&
    near(ld.mappedLength, ld.originalLength, 1e-9) &&
    near(ld.ratio, 1, 1e-9),
    '样例E：6 个单元片段、闭式弧长汇总 = 原长、倍率 = 1', JSON.stringify(ld && {
      seg: ld.segments.length, orig: ld.originalLength, mapped: ld.mappedLength, ratio: ld.ratio,
    }),
  );
}

/* 7) 样例 F：端点合适但中途被拉长 —— 逐片段弧长判倍率超限（端点距离会漏判） */
{
  const k = ident(2, 2);
  k[1][0] = { x: -2, y: 1 }; // 左边界网结左移，几何仍通过，引线在单元(0,0)内弓起
  const { body } = await postVerify({
    rows: 2, cols: 2, knots: k,
    markers: [{ u: 0, v: 0 }, { u: 2, v: 2 }, { u: 1, v: 1 }],
    leads: [{ from: 0, to: 1, minRatio: 1, maxRatio: 1.05 }],
  });
  const f = body.leadFailure || {};
  const ev = f.evidence || {};
  check(
    body.ok === false && body.stage === 'leads' && f.index === 0 && f.type === 'ratio',
    '样例F：引线倍率超限、阶段为 leads', JSON.stringify(f),
  );
  check(
    typeof ev.originalLength === 'number' && typeof ev.mappedLength === 'number' &&
    ev.mappedLength > ev.originalLength * 1.05 &&
    // 端点织补后仍是 (0,0) 与 (2,2)：端点距离不变，证明判据来自中途弧长
    near(ev.originalLength, Math.hypot(2, 2)),
    '样例F：长度证据显示中途过度拉长（非端点距离）',
    JSON.stringify({ orig: ev.originalLength, mapped: ev.mappedLength, ratio: ev.ratio }),
  );
  check(Array.isArray(body.leads) && body.leads[0].segments.length === 2,
    '样例F：列出经过的 2 个单元片段');
}

/* 8) 样例 G：原长为零的引线 —— 按录入顺序报告首项失败与长度证据 */
{
  const { body } = await postVerify({
    rows: 2, cols: 2, knots: ident(2, 2),
    markers: [{ u: 1, v: 1 }, { u: 1, v: 1 }, { u: 0, v: 0 }, { u: 2, v: 2 }],
    leads: [
      { from: 2, to: 3, minRatio: 1, maxRatio: 1 },       // L1 通过
      { from: 0, to: 1, minRatio: 0.5, maxRatio: 2 },     // L2 零长，首项失败
    ],
  });
  const f = body.leadFailure || {};
  check(
    body.ok === false && body.stage === 'leads' && f.index === 1 && f.type === 'zero-length' &&
    f.evidence && f.evidence.originalLength === 0,
    '样例G：零长引线按录入顺序报告首项失败及长度证据', JSON.stringify(f),
  );
}

/* 9) 样例 H：未配置引线的既有草稿 —— 响应不含任何引线字段 */
{
  const { body } = await postVerify({
    rows: 2, cols: 2, knots: ident(2, 2),
    markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 1.5 }],
  });
  check(
    body.ok === true && !('leads' in body) && !('leadFailure' in body),
    '样例H：未配置引线时响应保持原样',
  );
}

if (failures) {
  console.error(`\n冒烟验收未通过：${failures} 项失败`);
  process.exit(1);
}
console.log('\n冒烟验收通过：健康检查 + 校核样例（含纹样引线伸缩样例 E–H）');
