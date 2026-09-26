import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyGrid, makeIdentityKnots, cellCorners, cornerJacobians,
  bilinearMap, locateCell, checkSharedEdges, cross2,
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
