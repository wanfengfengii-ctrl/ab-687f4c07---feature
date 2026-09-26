import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyGrid, makeIdentityKnots, cellCorners, cornerJacobians,
  bilinearMap, locateCell, checkSharedEdges, cross2,
  quadraticArcLength, splitLead, evaluateLead, validateLeads, ratioWithin,
} from '../src/shared/bilinear.js';

const ident = makeIdentityKnots;
const threeMarkers = [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 1.5 }];

test('恒等网格：通过，J_min=1，标记原样换算，共享边连续', () => {
  const res = verifyGrid({
    rows: 2, cols: 2, knots: ident(2, 2),
    markers: [{ u: 0.5, v: 0.5 }, { u: 1.5, v: 1.5 }, { u: 2, v: 1 }],
  });
  assert.equal(res.ok, true);
  assert.equal(res.stage, 'geometry');
  assert.equal(res.minJacobian.value, 1);
  assert.deepEqual(res.minJacobian.cell, { r: 0, c: 0 });
  assert.equal(res.edges.continuous, true);
  assert.equal(res.edges.edgeCount, 4); // 2*1 + 1*2
  assert.deepEqual(
    res.markers.map((m) => [m.x, m.y]),
    [[0.5, 0.5], [1.5, 1.5], [2, 1]],
  );
});

test('均匀放大 3 倍：J_min = 9（面积比例）', () => {
  const knots = ident(2, 2).map((row) => row.map((k) => ({ x: 3 * k.x, y: 3 * k.y })));
  const res = verifyGrid({ rows: 2, cols: 2, knots, markers: threeMarkers });
  assert.equal(res.ok, true);
  assert.equal(res.minJacobian.value, 9);
});

test('剪切网格：面积保持，J 恒为 1，标记按剪切换算', () => {
  const knots = ident(2, 2);
  knots[0] = knots[0].map((k) => ({ x: k.x + 1, y: k.y })); // 顶行右移 1
  const res = verifyGrid({
    rows: 2, cols: 2, knots,
    markers: [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 0.5, v: 1.5 }],
  });
  assert.equal(res.ok, true);
  assert.equal(res.minJacobian.value, 1);
  assert.deepEqual(res.markers[0], { index: 0, u: 0.5, v: 0.5, cell: { r: 0, c: 0 }, s: 0.5, t: 0.5, x: 1, y: 0.5 });
  assert.deepEqual([res.markers[1].x, res.markers[1].y], [1, 1]);
  assert.deepEqual([res.markers[2].x, res.markers[2].y], [0.5, 1.5]);
});

test('非仿射双线性：角点 J 互不相同，J_min 落在正确角点，标记按双线性换算', () => {
  const knots = ident(2, 2);
  knots[0][0] = { x: -1, y: -1 }; // 仅移动左上角，得到真正的双线性（非仿射）形变
  const res = verifyGrid({
    rows: 2, cols: 2, knots,
    markers: [{ u: 0.5, v: 0.5 }, { u: 0, v: 0 }, { u: 0.5, v: 0 }],
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.cells[0].cornerJacobians, [3, 2, 1, 2]);
  assert.equal(res.minJacobian.value, 1);
  assert.deepEqual(res.minJacobian.cell, { r: 0, c: 0 });
  assert.equal(res.minJacobian.corner, 2);
  assert.deepEqual([res.markers[0].x, res.markers[0].y], [0.25, 0.25]);
  assert.deepEqual([res.markers[1].x, res.markers[1].y], [-1, -1]);
  assert.deepEqual([res.markers[2].x, res.markers[2].y], [0, -0.5]);
});

test('翻折：首项失败 = 行优先首个失败单元 + 固定角点序首个失败角点，不输出标记', () => {
  const knots = ident(2, 2);
  knots[1][1] = { x: -1, y: -1 };
  const res = verifyGrid({ rows: 2, cols: 2, knots, markers: threeMarkers });
  assert.equal(res.ok, false);
  assert.deepEqual(res.cells[0].cornerJacobians, [1, -1, -3, -1]);
  assert.deepEqual(res.firstFailure, {
    cell: { r: 0, c: 0 }, corner: 1, jacobian: -1, type: 'fold',
  });
  assert.equal(res.markers, null);
});

test('行优先顺序：后面的单元先失败时仍按行优先报告', () => {
  const knots = ident(3, 3);
  knots[1][2] = { x: -1, y: -1 }; // 影响单元 (0,1)、(0,2)、(1,1)、(1,2)
  const res = verifyGrid({ rows: 3, cols: 3, knots, markers: threeMarkers });
  assert.equal(res.ok, false);
  assert.deepEqual(res.firstFailure.cell, { r: 0, c: 1 });
  assert.equal(res.firstFailure.corner, 1);
  assert.equal(res.firstFailure.type, 'fold');
});

test('退化：J = 0 判定为 degenerate', () => {
  const knots = ident(2, 2);
  knots[1][1] = { x: 2, y: 0 }; // 单元(0,0)角点C1处两边共线
  const res = verifyGrid({ rows: 2, cols: 2, knots, markers: threeMarkers });
  assert.equal(res.ok, false);
  assert.deepEqual(res.firstFailure, {
    cell: { r: 0, c: 0 }, corner: 1, jacobian: 0, type: 'degenerate',
  });
});

test('连续判定的数学依据：角点最小值 = 稠密采样最小值（验证定理本身，应用不采样）', () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let trial = 0; trial < 300; trial++) {
    const corners = Array.from({ length: 4 }, () => ({
      x: Math.floor(rand() * 21) - 10,
      y: Math.floor(rand() * 21) - 10,
    }));
    const cornerMin = Math.min(...cornerJacobians(corners));
    let sampleMin = Infinity;
    for (let a = 0; a <= 10; a++) {
      for (let b = 0; b <= 10; b++) {
        const s = a / 10;
        const t = b / 10;
        const [C0, C1, C2, C3] = corners;
        const dSx = (C1.x - C0.x) * (1 - t) + (C2.x - C3.x) * t;
        const dSy = (C1.y - C0.y) * (1 - t) + (C2.y - C3.y) * t;
        const dTx = (C3.x - C0.x) * (1 - s) + (C2.x - C1.x) * s;
        const dTy = (C3.y - C0.y) * (1 - s) + (C2.y - C1.y) * s;
        sampleMin = Math.min(sampleMin, cross2(dSx, dSy, dTx, dTy));
      }
    }
    assert.ok(Math.abs(sampleMin - cornerMin) < 1e-9, `trial ${trial}: ${sampleMin} != ${cornerMin}`);
  }
});

test('locateCell：边界归入末单元，越界返回 null', () => {
  assert.deepEqual(locateCell(0, 0, 2, 2), { r: 0, c: 0, s: 0, t: 0 });
  assert.deepEqual(locateCell(2, 2, 2, 2), { r: 1, c: 1, s: 1, t: 1 });
  assert.deepEqual(locateCell(0.5, 1.5, 3, 4), { r: 1, c: 0, s: 0.5, t: 0.5 });
  assert.equal(locateCell(-0.1, 0, 2, 2), null);
  assert.equal(locateCell(0, 2.0001, 2, 2), null);
});

test('bilinearMap：角点处返回角点', () => {
  const corners = [{ x: 1, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 6 }, { x: 1, y: 6 }];
  assert.deepEqual(bilinearMap(corners, 0, 0), { x: 1, y: 2 });
  assert.deepEqual(bilinearMap(corners, 1, 0), { x: 4, y: 2 });
  assert.deepEqual(bilinearMap(corners, 1, 1), { x: 4, y: 6 });
  assert.deepEqual(bilinearMap(corners, 0, 1), { x: 1, y: 6 });
});

test('checkSharedEdges：结构化网格共享边连续，内部边数量正确', () => {
  const res = checkSharedEdges(ident(3, 4), 3, 4);
  assert.equal(res.continuous, true);
  assert.equal(res.edgeCount, 3 * 3 + 2 * 4); // 17
  assert.deepEqual(res.mismatches, []);
});

test('无效坐标：非整数网结被拒绝并定位到具体网结', () => {
  const knots = ident(2, 2);
  knots[0][1] = { x: 0.5, y: 0 };
  const res = verifyGrid({ rows: 2, cols: 2, knots, markers: threeMarkers });
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'validation');
  assert.equal(res.errors[0].kind, 'knot-integer');
  assert.deepEqual([res.errors[0].i, res.errors[0].j], [0, 1]);
  assert.equal(res.markers, null);
});

test('无效输入：行列越界、网结缺失、标记数量与范围', () => {
  assert.equal(verifyGrid({ rows: 1, cols: 2, knots: [], markers: threeMarkers }).errors[0].kind, 'rows');
  assert.equal(verifyGrid({ rows: 5, cols: 2, knots: [], markers: threeMarkers }).errors[0].kind, 'rows');
  const tooFew = verifyGrid({ rows: 2, cols: 2, knots: ident(2, 2), markers: threeMarkers.slice(0, 2) });
  assert.equal(tooFew.errors[0].kind, 'markers-count');
  const tooMany = verifyGrid({
    rows: 2, cols: 2, knots: ident(2, 2),
    markers: Array.from({ length: 13 }, () => ({ u: 1, v: 1 })),
  });
  assert.equal(tooMany.errors[0].kind, 'markers-count');
  const outOfRange = verifyGrid({
    rows: 2, cols: 2, knots: ident(2, 2),
    markers: [{ u: 3, v: 1 }, { u: 1, v: 1 }, { u: 1, v: 1 }],
  });
  assert.equal(outOfRange.errors[0].kind, 'marker-range');
  const nanMarker = verifyGrid({
    rows: 2, cols: 2, knots: ident(2, 2),
    markers: [{ u: NaN, v: 1 }, { u: 1, v: 1 }, { u: 1, v: 1 }],
  });
  assert.equal(nanMarker.errors[0].kind, 'marker-invalid');
  const badShape = verifyGrid({ rows: 2, cols: 2, knots: ident(2, 3), markers: threeMarkers });
  assert.equal(badShape.errors[0].kind, 'knots-shape');
});

test('网格规格边界：2x2 与 4x4 均合法', () => {
  for (const [rows, cols] of [[2, 2], [4, 4], [2, 4], [4, 2]]) {
    const markers = [
      { u: 0.5, v: 0.5 },
      { u: cols / 2, v: rows / 2 },
      { u: cols - 0.5, v: rows - 0.5 },
    ];
    const res = verifyGrid({ rows, cols, knots: ident(rows, cols), markers });
    assert.equal(res.ok, true, `${rows}x${cols}`);
    assert.equal(res.minJacobian.value, 1);
    assert.equal(res.cells.length, rows * cols);
  }
});

test('cellCorners 按固定角点序返回四角', () => {
  const knots = ident(2, 2);
  assert.deepEqual(
    cellCorners(knots, 0, 0),
    [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
  );
  assert.deepEqual(
    cellCorners(knots, 1, 1),
    [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }],
  );
});

/* ==================== 纹样引线：切片与二次曲线精确弧长 ==================== */

/**
 * 独立的高精度参考积分（每子区间 8 点 Gauss-Legendre × 64 子区间），
 * 仅用于速度方向连续变化的弯曲片段；含 |线性| 尖点的退化情形改用解析值
 * 对照（数值积分在尖点附近收敛慢）。不参与应用逻辑。
 */
function gaussLegendre8() {
  // 8 点 Gauss-Legendre 节点/权值（对称，仅列正半轴）
  const xp = [0.9602898564975363, 0.7966664774136267, 0.5255324099163290, 0.1834346424956498];
  const wp = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620];
  const nodes = [], weights = [];
  for (let i = 0; i < 4; i++) {
    nodes.push(-xp[i], xp[i]);
    weights.push(wp[i], wp[i]);
  }
  return { nodes, weights };
}
const GL8 = gaussLegendre8();

function referenceArcLength(q0, qh, q1) {
  const Cx = 2 * (q0.x + q1.x - 2 * qh.x);
  const Cy = 2 * (q0.y + q1.y - 2 * qh.y);
  const Bx = q1.x - q0.x - Cx;
  const By = q1.y - q0.y - Cy;
  const sub = 32;
  let sum = 0;
  for (let m = 0; m < sub; m++) {
    for (let g = 0; g < 8; g++) {
      const z = ((m + 0.5) + 0.5 * GL8.nodes[g]) / sub;
      const w = GL8.weights[g];
      sum += w * Math.hypot(Bx + 2 * Cx * z, By + 2 * Cy * z);
    }
  }
  return sum / (2 * sub);
}

test('quadraticArcLength：直线段（a=0）退化为端点距离', () => {
  assert.ok(Math.abs(quadraticArcLength({ x: 0, y: 0 }, { x: 1.5, y: 2 }, { x: 3, y: 4 }) - 5) < 1e-12);
  assert.equal(quadraticArcLength({ x: 2, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 2 }), 0);
});

test('quadraticArcLength：闭式结果与高精度数值积分一致（覆盖 k>0 与 k=0 分支）', () => {
  // k = 16(B0×C0)²：一般情形 k>0；B0∥C0（含 B0=0）时 k=0
  const cases = [
    // 对称拱起：速度中间小
    { q0: { x: 0, y: 0 }, qh: { x: 1, y: 2 }, q1: { x: 2, y: 0 } },
    // 强烈弯曲
    { q0: { x: 0, y: 0 }, qh: { x: 0.2, y: 3 }, q1: { x: 1, y: 0 } },
    // B0=0：起点速度为零，方向单调，弧长 = 1
    { q0: { x: 0, y: 0 }, qh: { x: 0.25, y: 0 }, q1: { x: 1, y: 0 } },
    // 随机一般情形
    { q0: { x: -3, y: 1 }, qh: { x: 2, y: -2 }, q1: { x: 4, y: 5 } },
    { q0: { x: 10, y: -7 }, qh: { x: -5, y: 8 }, q1: { x: 6, y: 2 } },
  ];
  for (const c of cases) {
    const exact = quadraticArcLength(c.q0, c.qh, c.q1);
    const ref = referenceArcLength(c.q0, c.qh, c.q1);
    // 弧长必不短于端点弦长
    assert.ok(exact >= Math.hypot(c.q1.x - c.q0.x, c.q1.y - c.q0.y) - 1e-9);
    assert.ok(Math.abs(exact - ref) / Math.max(ref, 1e-12) < 1e-9,
      `闭式 ${exact} vs 参考积分 ${ref}`);
  }

  // 速度反向（经过尖点，B0∥C0 反向）：数值积分在 |线性| 尖点处收敛慢，
  // 直接对照解析值 ∫|v|dz = (|v0|²+|v1|²)/(2|v1−v0|)
  const cusp = { q0: { x: 0, y: 0 }, qh: { x: 0.2, y: 0.2 }, q1: { x: 1, y: 1 } };
  {
    const Cx = 2 * (cusp.q0.x + cusp.q1.x - 2 * cusp.qh.x);
    const Cy = 2 * (cusp.q0.y + cusp.q1.y - 2 * cusp.qh.y);
    const Bx = cusp.q1.x - cusp.q0.x - Cx;
    const By = cusp.q1.y - cusp.q0.y - Cy;
    const n0 = Math.hypot(Bx, By);
    const n1 = Math.hypot(Bx + 2 * Cx, By + 2 * Cy);
    const w = Math.hypot(2 * Cx, 2 * Cy);
    const analytic = (n0 * n0 + n1 * n1) / (2 * w);
    assert.ok(Math.abs(quadraticArcLength(cusp.q0, cusp.qh, cusp.q1) - analytic) < 1e-12);
  }
});

test('quadraticArcLength：随机双线性片段上闭式与参考积分一致', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let trial = 0; trial < 100; trial++) {
    // 保证 J>0 的随机非仿射单元：在恒等单元上施加适度随机扰动
    const base = cellCorners(ident(1, 1), 0, 0);
    const corners = base.map((p) => ({ x: p.x + (rand() - 0.5) * 0.8, y: p.y + (rand() - 0.5) * 0.8 }));
    assert.ok(Math.min(...cornerJacobians(corners)) > 0);
    const s0 = rand(), t0 = rand(), s1 = rand(), t1 = rand();
    const q0 = bilinearMap(corners, s0, t0);
    const qh = bilinearMap(corners, (s0 + s1) / 2, (t0 + t1) / 2);
    const q1 = bilinearMap(corners, s1, t1);
    const exact = quadraticArcLength(q0, qh, q1);
    const ref = referenceArcLength(q0, qh, q1);
    assert.ok(Math.abs(exact - ref) / Math.max(ref, 1e-12) < 1e-9, `trial ${trial}`);
  }
});

test('splitLead：跨 3 列 2 行的引线被切成 5 个单元内片段，片段长度之和 = 原长', () => {
  // (0.2,0.3) → (3.7,2.6)：穿过 u=1,2,3 与 v=1,2，共 5 个交点、6 段
  const a = { u: 0.2, v: 0.3 };
  const b = { u: 3.7, v: 2.6 };
  const { originalLength, cuts, segments } = splitLead(a, b, 3, 4);
  assert.equal(cuts.length, 7); // 2 端点 + 5 交点
  assert.equal(segments.length, 6);
  assert.ok(Math.abs(originalLength - Math.hypot(3.5, 2.3)) < 1e-12);
  const sum = segments.reduce((acc, s) => acc + s.originalLength, 0);
  assert.ok(Math.abs(sum - originalLength) < 1e-12);
  // 片段首尾相接
  for (let i = 1; i < cuts.length; i++) assert.ok(cuts[i].lam > cuts[i - 1].lam);
  // 各片段归属单元正确（首段 (0,0)，终点附近 (2,3)）
  assert.deepEqual([segments[0].r, segments[0].c], [0, 0]);
  assert.deepEqual([segments.at(-1).r, segments.at(-1).c], [2, 3]);
});

test('splitLead：引线穿过网结时竖线/横线交点去重', () => {
  // 从 (0.5,0.5) 到 (2.5,2.5) 经过 (1,1) 与 (2,2) 两个网结
  const { cuts, segments } = splitLead({ u: 0.5, v: 0.5 }, { u: 2.5, v: 2.5 }, 3, 3);
  assert.deepEqual(cuts.map((c) => [c.u, c.v]),
    [[0.5, 0.5], [1, 1], [2, 2], [2.5, 2.5]]);
  assert.equal(segments.length, 3);
});

test('splitLead：沿网格线行进的引线正确切片（边界点按 locateCell 归入下侧单元）', () => {
  const { segments } = splitLead({ u: 0, v: 1 }, { u: 3, v: 1 }, 2, 3);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments.map((s) => [s.r, s.c]), [[1, 0], [1, 1], [1, 2]]);
});

test('恒等网格：引线织补长度 = 原长，倍率 = 1，片段弧长之和 = 原长', () => {
  const markers = [
    { u: 0.2, v: 0.3 }, { u: 3.7, v: 2.6 }, { u: 1, v: 1 },
  ];
  const res = verifyGrid({
    rows: 3, cols: 4, knots: ident(3, 4), markers,
    leads: [{ from: 0, to: 1, minRatio: 0.99, maxRatio: 1.01 }],
  });
  assert.equal(res.ok, true);
  assert.equal(res.stage, 'geometry');
  const lead = res.leads[0];
  assert.ok(Math.abs(lead.originalLength - lead.mappedLength) < 1e-9);
  assert.ok(Math.abs(lead.ratio - 1) < 1e-9);
  assert.equal(lead.segments.length, 6);
  const segSum = lead.segments.reduce((a, s) => a + s.mappedLength, 0);
  assert.ok(Math.abs(segSum - lead.mappedLength) < 1e-12);
});

test('均匀缩放：引线倍率 = 缩放系数，哪怕只看端点也相同（基线）', () => {
  const k = ident(2, 2).map((row) => row.map((p) => ({ x: 2 * p.x, y: 2 * p.y })));
  const markers = [{ u: 0, v: 0 }, { u: 2, v: 2 }, { u: 1, v: 0 }];
  const res = verifyGrid({
    rows: 2, cols: 2, knots: k, markers,
    leads: [{ from: 0, to: 1, minRatio: 1.9, maxRatio: 2.1 }],
  });
  assert.equal(res.ok, true);
  assert.ok(Math.abs(res.leads[0].ratio - 2) < 1e-9);
});

test('非仿射单元：端点合适但中途被拉长——逐片段弧长抓住端点距离漏掉的超限', () => {
  // 2×2 网的内结无法移动（四周单元必翻折）；把左侧边界网结 K(1,0)
  // 从 (0,1) 左移到 (-2,1)。单元(0,0)四角 J=[1,1,3,3]、单元(1,0)
  // J=[3,3,3,3]，全网仍连续无翻折，但 (0,0)→(2,2) 引线在首单元内向
  // 左弓起（中点映射到 (0,0.5)），织补弧长约为原长 1.07 倍超过上限，
  // 而两端点织补后位置不变（端点距离“看似合适”）。
  const k = ident(2, 2);
  k[1][0] = { x: -2, y: 1 };
  const markers = [
    { u: 0, v: 0 },       // M1 (0,0) → (0,0)
    { u: 2, v: 2 },       // M3 (2,2) → (2,2)，端点距离不变
    { u: 1, v: 1 },       // M2 (1,1) → (1,1)
  ];
  const res = verifyGrid({
    rows: 2, cols: 2, knots: k, markers,
    leads: [{ from: 0, to: 1, minRatio: 1, maxRatio: 1.05 }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'leads');
  assert.equal(res.leadFailure.type, 'ratio');
  assert.equal(res.leadFailure.index, 0);
  // 首片段 (0,0)→(1,1) 在单元(0,0)内下弓，弧长必超过其原长 √2
  const first = res.leads[0].segments[0];
  assert.deepEqual([first.r, first.c], [0, 0]);
  assert.ok(first.mappedLength > first.originalLength * 1.05);
  // 端点弦长反而“合适”：证明逐片段精确弧长的必要性
  const chord = Math.hypot(2 - 0, 2 - 0);
  assert.ok(Math.abs(chord - res.leads[0].originalLength) < 1e-12);
  assert.ok(res.leads[0].mappedLength > chord);
  // 两个单元片段，映射在共享网结 (1,1) 处首尾相接
  assert.deepEqual(res.leads[0].segments.map((s) => [s.r, s.c]), [[0, 0], [1, 1]]);
});

test('原始长度为零：按录入顺序报告首项失败并给出长度证据', () => {
  const markers = [
    { u: 1, v: 1 }, { u: 1, v: 1 }, // M1=M2，零长引线
    { u: 0, v: 0 }, { u: 2, v: 2 },
  ];
  const res = verifyGrid({
    rows: 2, cols: 2, knots: ident(2, 2), markers,
    leads: [
      { from: 2, to: 3, minRatio: 1, maxRatio: 1 }, // 第一条其实通过
      { from: 0, to: 1, minRatio: 0.5, maxRatio: 2 }, // 第二条零长，失败
    ],
  });
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'leads');
  assert.equal(res.leadFailure.index, 1);
  assert.equal(res.leadFailure.type, 'zero-length');
  assert.equal(res.leadFailure.evidence.originalLength, 0);
  assert.equal(res.leads[1].ratio, null);
});

test('倍率超限：多条引线时按录入顺序返回首个失败项，证据含两种长度与倍率', () => {
  const markers = [{ u: 0, v: 0 }, { u: 2, v: 0 }, { u: 0, v: 2 }, { u: 2, v: 2 }];
  const res = verifyGrid({
    rows: 2, cols: 2, knots: ident(2, 2), markers,
    leads: [
      { from: 0, to: 1, minRatio: 1, maxRatio: 1 }, // 通过
      { from: 0, to: 2, minRatio: 2, maxRatio: 3 }, // 倍率 1 < 2，失败
      { from: 0, to: 3, minRatio: 0.1, maxRatio: 0.5 }, // 也会失败但不是首项
    ],
  });
  assert.equal(res.ok, false);
  assert.equal(res.leadFailure.index, 1);
  assert.equal(res.leadFailure.type, 'ratio');
  assert.ok(Math.abs(res.leadFailure.evidence.originalLength - 2) < 1e-12);
  assert.ok(Math.abs(res.leadFailure.evidence.mappedLength - 2) < 1e-12);
  assert.ok(Math.abs(res.leadFailure.evidence.ratio - 1) < 1e-12);
});

test('几何未通过时不进行引线校核（不输出 leads）', () => {
  const k = ident(2, 2);
  k[1][1] = { x: -1, y: -1 };
  const res = verifyGrid({
    rows: 2, cols: 2, knots: k, markers: threeMarkers,
    leads: [{ from: 0, to: 1, minRatio: 1, maxRatio: 2 }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'geometry');
  assert.equal(res.leads, undefined);
  assert.equal(res.markers, null);
});

test('未配置引线的既有草稿：响应完全不含引线字段', () => {
  const res = verifyGrid({ rows: 2, cols: 2, knots: ident(2, 2), markers: threeMarkers });
  assert.deepEqual(Object.keys(res).sort(),
    ['cells', 'edges', 'errors', 'firstFailure', 'markers', 'minJacobian', 'ok', 'stage']);
});

test('validateLeads：数量、端点字段类型、倍率字段与次序校验（端点越界留给 leads 阶段）', () => {
  const spec = { rows: 2, cols: 2, markers: threeMarkers };
  assert.equal(validateLeads({ ...spec, leads: [] })[0].kind, 'leads-count');
  assert.equal(validateLeads({ ...spec, leads: Array.from({ length: 5 }, () => ({})) })[0].kind, 'leads-count');
  const badField = validateLeads({ ...spec, leads: [{ from: 'x', to: 1, minRatio: 1, maxRatio: 2 }] });
  assert.equal(badField[0].kind, 'lead-endpoint-field');
  // 越界但为整数：validateLeads 不拦截，交由 leads 阶段按录入顺序报告
  const outOfRange = validateLeads({ ...spec, leads: [{ from: 9, to: 1, minRatio: 1, maxRatio: 2 }] });
  assert.deepEqual(outOfRange, []);
  const badRatio = validateLeads({ ...spec, leads: [{ from: 0, to: 1, minRatio: 0, maxRatio: 2 }] });
  assert.equal(badRatio[0].kind, 'lead-ratio-field');
  const nanRatio = validateLeads({ ...spec, leads: [{ from: 0, to: 1, minRatio: NaN, maxRatio: 2 }] });
  assert.equal(nanRatio[0].kind, 'lead-ratio-field');
  const order = validateLeads({ ...spec, leads: [{ from: 0, to: 1, minRatio: 2, maxRatio: 1 }] });
  assert.equal(order[0].kind, 'lead-ratio-order');
  assert.deepEqual(validateLeads({ ...spec, leads: undefined }), []);
});

test('端点无效：按引线录入顺序报告首项失败（不被前一条通过的引线掩盖）', () => {
  const markers = [{ u: 0, v: 0 }, { u: 2, v: 2 }, { u: 1, v: 1 }];
  const res = verifyGrid({
    rows: 2, cols: 2, knots: ident(2, 2), markers,
    leads: [
      { from: 0, to: 1, minRatio: 1, maxRatio: 1 }, // L1 通过
      { from: 0, to: 7, minRatio: 0.5, maxRatio: 2 }, // L2 端点 B 越界，首项失败
      { from: 0, to: 1, minRatio: 0.1, maxRatio: 0.2 }, // L3 也失败但不是首项
    ],
  });
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'leads');
  assert.equal(res.leadFailure.index, 1);
  assert.equal(res.leadFailure.type, 'endpoint');
  assert.equal(res.leadFailure.evidence.markerCount, 3);
  assert.equal(res.leadFailure.evidence.originalLength, null);
  assert.equal(res.leads[1].valid, false);
  assert.deepEqual(res.leads[1].invalidFields, ['to']);
});

test('ratioWithin：闭区间边界视为通过', () => {
  assert.equal(ratioWithin(1, 1, 1), true);
  assert.equal(ratioWithin(2, 1, 2), true);
  assert.equal(ratioWithin(2.001, 1, 2), false);
});

test('引线结果列出经过的单元片段：跨单元片段证据完整', () => {
  const markers = [{ u: 0, v: 0 }, { u: 2, v: 2 }, { u: 0.5, v: 1.5 }];
  const lr = evaluateLead(
    { from: 0, to: 1, minRatio: 0.5, maxRatio: 2 }, 0,
    markers, 2, 2, ident(2, 2),
  );
  // (0,0)→(2,2) 经 (1,1)：单元 (0,0) 与 (1,1) 两个片段
  assert.deepEqual(lr.segments.map((s) => [s.r, s.c]), [[0, 0], [1, 1]]);
  for (const s of lr.segments) {
    assert.ok(s.originalLength > 0);
    assert.ok(Math.abs(s.mappedLength - s.originalLength) < 1e-12);
    assert.ok(s.mapped.q0 && s.mapped.q1 && s.mapped.qh);
  }
});
