import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyGrid, makeIdentityKnots, splitLeadLine, analyzeLeadLine,
  integrateSpeed,
} from '../src/shared/bilinear.js';

const ident = makeIdentityKnots;
const threeMarkers = [{ u: 0.5, v: 0.5 }, { u: 1, v: 1 }, { u: 1.5, v: 1.5 }];

/** 高精度自适应 Gauss-Kronrod 风格参考积分：仅测试中使用，应用本身不采样 */
function refArcLength(corners, s0, t0, s1, t1, depth = 0, cache = new Map()) {
  const key = `${s0}|${t0}|${s1}|${t1}`;
  // 递归 Simpson（细分 24 层，误差 1e-12 量级），只用于交叉验证闭式解
  const [C0, C1, C2, C3] = corners;
  const pos = (s, t) => ({
    x: C0.x * (1 - s) * (1 - t) + C1.x * s * (1 - t) + C2.x * s * t + C3.x * (1 - s) * t,
    y: C0.y * (1 - s) * (1 - t) + C1.y * s * (1 - t) + C2.y * s * t + C3.y * (1 - s) * t,
  });
  const speedAt = (z) => {
    const s = s0 + (s1 - s0) * z;
    const t = t0 + (t1 - t0) * z;
    const Psx = (C1.x - C0.x) * (1 - t) + (C2.x - C3.x) * t;
    const Psy = (C1.y - C0.y) * (1 - t) + (C2.y - C3.y) * t;
    const Ptx = (C3.x - C0.x) * (1 - s) + (C2.x - C1.x) * s;
    const Pty = (C3.y - C0.y) * (1 - s) + (C2.y - C1.y) * s;
    return Math.hypot(Psx * (s1 - s0) + Ptx * (t1 - t0), Psy * (s1 - s0) + Pty * (t1 - t0));
  };
  const simpson = (a, b, fa, fm, fb) => (b - a) / 6 * (fa + 4 * fm + fb);
  function rec(a, b, fa, fm, fb, whole, dep) {
    const m1 = (a + (a + b) / 2) / 2;
    const m2 = ((a + b) / 2 + b) / 2;
    const f1 = speedAt(m1);
    const f2 = speedAt(m2);
    const m = (a + b) / 2;
    const left = simpson(a, m, fa, f1, fm);
    const right = simpson(m, b, fm, f2, fb);
    const delta = left + right - whole;
    if (dep > 22 || Math.abs(delta) <= 1e-11) return left + right + delta / 15;
    return rec(a, m, fa, f1, fm, left, dep + 1) + rec(m, b, fm, f2, fb, right, dep + 1);
  }
  const a = 0, b = 1, m = 0.5;
  const fa = speedAt(a), fm = speedAt(m), fb = speedAt(b);
  return rec(a, b, fa, fm, fb, simpson(a, b, fa, fm, fb), 0);
}

test('未配置 lines：响应不含 lines 字段，旧行为逐字不变', () => {
  const res = verifyGrid({ rows: 2, cols: 2, knots: ident(2, 2), markers: threeMarkers });
  assert.equal(res.ok, true);
  assert.equal(Object.prototype.hasOwnProperty.call(res, 'lines'), false);
});

test('splitLeadLine：与网格线的全部交点都成为切点（含斜线跨多单元）', () => {
  // 从 (0.2,0.2) 到 (3.2,1.2)：穿过 u=1,2,3 与 v=1 共 4 条内部网格线
  const segs = splitLeadLine(0.2, 0.2, 3.2, 1.2, 2, 4);
  assert.equal(segs.length, 5);
  assert.deepEqual([segs[0].r, segs[0].c], [0, 0]);
  assert.deepEqual([segs[1].r, segs[1].c], [0, 1]);
  // v=1 的交点 λ=0.8 先于 u=3 的 λ≈0.933：第三段仍在 r=0
  assert.deepEqual([segs[2].r, segs[2].c], [0, 2]);
  assert.deepEqual([segs[3].r, segs[3].c], [1, 2]);
  assert.deepEqual([segs[4].r, segs[4].c], [1, 3]);
  // 片段首尾相接覆盖全程
  assert.ok(Math.abs(segs[0].lambda0) < 1e-12);
  assert.ok(Math.abs(segs[segs.length - 1].lambda1 - 1) < 1e-12);
  for (let i = 1; i < segs.length; i++) {
    assert.ok(Math.abs(segs[i].lambda0 - segs[i - 1].lambda1) < 1e-12);
  }
  // 每段端点吸附到整数网格线
  assert.ok(Math.abs(segs[0].s1 - 1) < 1e-12);
  assert.ok(Math.abs(segs[1].s0 - 0) < 1e-12);
});

test('splitLeadLine：水平/垂直线与沿网格线行走', () => {
  const h = splitLeadLine(0.3, 1, 3.7, 1, 2, 4);
  // 0.3→3.7 穿过 u=1,2,3：4 段
  assert.equal(h.length, 4);
  assert.deepEqual(h.map((s) => s.c), [0, 1, 2, 3]);
  // 沿整数网格线 v=1 行走：归入固定一侧（r=1，因中点 floor）
  assert.ok(h.every((s) => s.r === 1));

  const v = splitLeadLine(2, 0, 2, 2, 2, 4);
  assert.equal(v.length, 2);
  assert.ok(v.every((s) => s.c === 2));
});

test('恒等网格：引线弧长 = 原网直线长度，倍率 1，片段原长之和=总长', () => {
  const markers = [{ u: 0.2, v: 0.2 }, { u: 3.2, v: 1.2 }, { u: 1, v: 1 }];
  const res = verifyGrid({
    rows: 2, cols: 4, knots: ident(2, 4), markers,
    lines: [{ from: 0, to: 1, minRatio: 1, maxRatio: 1 }],
  });
  assert.equal(res.ok, true);
  const item = res.lines.items[0];
  const L = Math.hypot(3, 1);
  assert.ok(Math.abs(item.originalLength - L) < 1e-12);
  assert.ok(Math.abs(item.wovenLength - L) < 1e-10, `woven=${item.wovenLength}`);
  assert.ok(Math.abs(item.ratio - 1) < 1e-10);
  assert.equal(item.segments.length, 5);
  const sumOrig = item.segments.reduce((a, s) => a + s.originalLength, 0);
  assert.ok(Math.abs(sumOrig - L) < 1e-10);
});

test('均匀放大 k 倍：倍率恰为 k（精确闭式弧长，多片段汇总）', () => {
  for (const k of [2, 3, 5]) {
    const knots = ident(2, 3).map((row) => row.map((q) => ({ x: k * q.x, y: k * q.y })));
    const markers = [{ u: 0.1, v: 0.1 }, { u: 2.9, v: 1.9 }];
    while (markers.length < 3) markers.push({ u: 1, v: 1 });
    const res = verifyGrid({
      rows: 2, cols: 3, knots, markers,
      lines: [{ from: 0, to: 1, minRatio: k, maxRatio: k }],
    });
    assert.equal(res.ok, true, `k=${k}`);
    assert.ok(Math.abs(res.lines.items[0].ratio - k) < 1e-9, `k=${k} ratio=${res.lines.items[0].ratio}`);
  }
});

test('闭式弧长 vs 自适应 Simpson：随机非仿射单元、随机线段方向全部吻合', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let trials = 0;
  for (let t = 0; t < 300; t++) {
    const corners = Array.from({ length: 4 }, () => ({
      x: Math.floor(rand() * 11) - 5,
      y: Math.floor(rand() * 11) - 5,
    }));
    // 跳过翻折/退化单元
    const cross = (ax, ay, bx, by) => ax * by - ay * bx;
    const [C0, C1, C2, C3] = corners;
    const j0 = cross(C1.x - C0.x, C1.y - C0.y, C3.x - C0.x, C3.y - C0.y);
    if (j0 <= 0) continue;
    // 单元内随机线段（局部坐标）
    const s0 = rand(), t0 = rand(), s1 = rand(), t1 = rand();
    const a = analyzeLeadLine(
      { from: 0, to: 1 },
      [{ u: s0, v: t0 }, { u: s1, v: t1 }],
      [corners, [corners[3], corners[2], corners[2], corners[3]]],
      1, 1,
    );
    const exact = a.wovenLength;
    const ref = refArcLength(corners, s0, t0, s1, t1);
    assert.ok(Math.abs(exact - ref) < 1e-8 * Math.max(1, ref),
      `trial ${trials}: exact=${exact} ref=${ref}`);
    trials++;
  }
  assert.ok(trials > 100);
});

test('integrateSpeed 退化分支：常速度（直线像）与零速度（点像）', () => {
  // sqrt(4) = 2 在 [0,1] → 2
  assert.ok(Math.abs(integrateSpeed(0, 0, 4, 0, 1) - 2) < 1e-12);
  // sqrt(9x+0) 不好，改测 sqrt(4x+0): ∫0^1 2√x = 4/3
  assert.ok(Math.abs(integrateSpeed(0, 4, 0, 0, 1) - 4 / 3) < 1e-12);
  // 完全平方：|2x-1| 在 [0,1] 积分 = 0.5（a=4,b=-4,c=1,d=0）
  assert.ok(Math.abs(integrateSpeed(4, -4, 1, 0, 1) - 0.5) < 1e-12);
  // 空区间
  assert.equal(integrateSpeed(1, 0, 1, 1, 1), 0);
});

test('倍率超限：ok=false，按录入顺序给出首项失败与长度证据，标记仍换算', () => {
  // 横向拉伸 2 倍、纵向不变的仿射网；倍率窗口 [0.9,1.1]
  const knots = ident(2, 3).map((row) => row.map((q) => ({ x: 2 * q.x, y: q.y })));
  const markers = [
    { u: 0.5, v: 0.5 }, { u: 2.5, v: 0.5 }, // 水平线：倍率 2，超限
    { u: 0.5, v: 1.5 }, // 垂直线到 M3：倍率 1，通过
  ];
  const res = verifyGrid({
    rows: 2, cols: 3, knots, markers,
    lines: [
      { from: 0, to: 2, minRatio: 0.9, maxRatio: 1.1 }, // 先通过
      { from: 0, to: 1, minRatio: 0.9, maxRatio: 1.1 }, // 后失败 → 首项
    ],
  });
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'geometry');
  assert.ok(res.markers !== null, '网格本身通过，标记照常换算');
  assert.equal(res.lines.firstFailure.index, 1);
  assert.equal(res.lines.firstFailure.reason, 'ratio-out-of-range');
  assert.ok(Math.abs(res.lines.firstFailure.originalLength - 2) < 1e-12);
  assert.ok(Math.abs(res.lines.firstFailure.wovenLength - 4) < 1e-9);
  assert.ok(Math.abs(res.lines.firstFailure.ratio - 2) < 1e-9);
  assert.equal(res.lines.items[0].ok, true);
  assert.equal(res.lines.items[1].ok, false);
});

test('中途被拉长：端点看似合适但跨单元超限被判失败（核心场景）', () => {
  // 非翻折双线性形变：中间一行网结向上拱（x 不变），引线两端点织补后
  // 仍相距 2（看似倍率 1），但像曲线中途绕过拱顶，弧长 = 2√2。
  const knots = ident(2, 2);
  knots[1] = [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 1 }]; // 中行上拱
  knots[2] = [{ x: 0, y: 2 }, { x: 1, y: 4 }, { x: 2, y: 2 }]; // 底行同步拉开避免退化
  const markers = [
    { u: 0, v: 1 }, { u: 2, v: 1 }, { u: 0.5, v: 0.5 },
  ];
  const res = verifyGrid({
    rows: 2, cols: 2, knots, markers,
    lines: [{ from: 0, to: 1, minRatio: 0.95, maxRatio: 1.05 }],
  });
  // 网格本身通过不翻折判定，但引线倍率超限 → 整体判负
  assert.equal(res.firstFailure, null, '网格无翻折/退化');
  assert.equal(res.ok, false, '引线倍率超限，整体判负');
  const f = res.lines.firstFailure;
  assert.equal(f.reason, 'ratio-out-of-range');
  assert.ok(Math.abs(f.originalLength - 2) < 1e-12);
  assert.ok(Math.abs(f.wovenLength - 2 * Math.SQRT2) < 1e-9, `woven=${f.wovenLength}`);
  assert.equal(f.segments.length, 2);
  assert.deepEqual(f.segments.map((s) => s.c), [0, 1]);
});

test('原始长度为零：首项失败，给出零长度证据，倍率为 null', () => {
  const markers = [
    { u: 1, v: 1 }, { u: 1, v: 1 }, // 重合
    { u: 0.5, v: 0.5 },
  ];
  const res = verifyGrid({
    rows: 2, cols: 2, knots: ident(2, 2), markers,
    lines: [{ from: 0, to: 1, minRatio: 0.5, maxRatio: 2 }],
  });
  assert.equal(res.ok, false);
  const f = res.lines.firstFailure;
  assert.equal(f.index, 0);
  assert.equal(f.reason, 'zero-length');
  assert.equal(f.originalLength, 0);
  assert.equal(f.ratio, null);
});

test('端点无效：校验阶段拒绝（引用不存在的标记序号）', () => {
  const res = verifyGrid({
    rows: 2, cols: 2, knots: ident(2, 2), markers: threeMarkers,
    lines: [{ from: 0, to: 9, minRatio: 0.5, maxRatio: 2 }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.stage, 'validation');
  assert.equal(res.errors[0].kind, 'line-endpoint');
  assert.equal(res.lines, null);
});

test('引线数量与倍率合法性校验', () => {
  const base = { rows: 2, cols: 2, knots: ident(2, 2), markers: threeMarkers };
  assert.equal(verifyGrid({ ...base, lines: [] }).errors.some((e) => e.kind === 'lines-count'), true);
  const five = Array.from({ length: 5 }, (_, i) => ({ from: 0, to: 1, minRatio: 1, maxRatio: 1 }));
  assert.equal(verifyGrid({ ...base, lines: five }).errors.some((e) => e.kind === 'lines-count'), true);
  assert.equal(
    verifyGrid({ ...base, lines: [{ from: 0, to: 1, minRatio: 0, maxRatio: 1 }] }).errors[0].kind,
    'line-ratio-invalid',
  );
  assert.equal(
    verifyGrid({ ...base, lines: [{ from: 0, to: 1, minRatio: 2, maxRatio: 1 }] }).errors[0].kind,
    'line-ratio-order',
  );
});

test('网格翻折时不核算引线：lines=null，首项失败仍是几何失败', () => {
  const knots = ident(2, 2);
  knots[1][1] = { x: -1, y: -1 };
  const res = verifyGrid({
    rows: 2, cols: 2, knots, markers: threeMarkers,
    lines: [{ from: 0, to: 1, minRatio: 1, maxRatio: 1 }],
  });
  assert.equal(res.ok, false);
  assert.equal(res.firstFailure.type, 'fold');
  assert.equal(res.lines, null);
  assert.equal(res.markers, null);
});

test('倍率边界：恰在边界上通过（含容差），略超即失败', () => {
  const markers = [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 0.5, v: 0.5 }];
  const ok = verifyGrid({
    rows: 2, cols: 2, knots: ident(2, 2), markers,
    lines: [{ from: 0, to: 1, minRatio: 1, maxRatio: 1 }],
  });
  assert.equal(ok.ok, true);
  const bad = verifyGrid({
    rows: 2, cols: 2, knots: ident(2, 2), markers,
    lines: [{ from: 0, to: 1, minRatio: 1.001, maxRatio: 2 }],
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.lines.firstFailure.reason, 'ratio-out-of-range');
});
