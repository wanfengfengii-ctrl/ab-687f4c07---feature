/**
 * 双线性单元形变与全网不翻折的连续判定（严格连续判定，不以有限采样点替代）。
 *
 * 数学依据
 * --------
 * 每个矩形单元的织补形变视为连续双线性映射：
 *   P(s,t) = C0·(1-s)(1-t) + C1·s(1-t) + C2·s·t + C3·(1-s)t,  (s,t) ∈ [0,1]²
 * 其雅可比行列式 J(s,t) = (∂P/∂s) × (∂P/∂t) 关于 (s,t) 是双线性函数。
 *
 * 定理：双线性函数在矩形域 [0,1]² 上的最小值必在某一角点取得。
 *   证明：固定 t，J 关于 s 是线性函数，最小值在 s=0 或 s=1 处取得；
 *   两条边 s=0、s=1 上 J 关于 t 仍为线性，最小值在 t=0 或 t=1 处取得。
 *   故 min J = min{J(0,0), J(1,0), J(1,1), J(0,1)}。
 *
 * 推论（连续不翻折判据）：
 *   J(s,t) > 0  ∀(s,t)∈[0,1]²   ⇔   四个角点的 J 值均 > 0。
 * 因此检查 4 个角点即等价于检查单元内任意内部位置，无需任何采样。
 * 角点 J 值即该角点处两条邻边向量的叉积：
 *   J(0,0) = (C1-C0)×(C3-C0)   J(1,0) = (C1-C0)×(C2-C1)
 *   J(1,1) = (C2-C3)×(C2-C1)   J(0,1) = (C2-C3)×(C3-C0)
 *
 * 坐标约定：y 轴向下（与屏幕及矩阵行序一致），s 沿列方向，t 沿行方向。
 * 恒等单元（单位正方形）四角 J 均为 1；网结坐标为整数时 J 必为整数，
 * 故 J > 0 等价于 J ≥ 1，不存在数值模糊地带。
 *
 * 相邻单元共享边：共享边两侧的双线性映射在边上均退化为同一对端点的
 * 同一线性插值（双线性映射限制在边界上即为线性插值），因此只要两侧
 * 单元共用同一对网结——结构化网格在数据模型上天然如此——整条边
 * （含边上每一点）连续重合。checkSharedEdges 对该不变量做显式核验。
 */

export const MIN_ROWS = 2;
export const MAX_ROWS = 4;
export const MIN_COLS = 2;
export const MAX_COLS = 4;
export const MIN_MARKERS = 3;
export const MAX_MARKERS = 12;
export const COORD_LIMIT = 1_000_000;

/** 固定角点顺序：C0 左上 (s=0,t=0) → C1 右上 (1,0) → C2 右下 (1,1) → C3 左下 (0,1) */
export const CORNER_NAMES = [
  'C0 左上 (s=0,t=0)',
  'C1 右上 (s=1,t=0)',
  'C2 右下 (s=1,t=1)',
  'C3 左下 (s=0,t=1)',
];

export const FAILURE_TYPE_NAMES = {
  fold: '翻折（J < 0）',
  degenerate: '退化（J = 0）',
};

/** 二维叉积（z 分量）：a × b */
export function cross2(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

/** 生成原网（恒等网格）：网结 (i,j) 位于 (j, i)，单位间距 */
export function makeIdentityKnots(rows, cols) {
  const knots = [];
  for (let i = 0; i <= rows; i++) {
    const row = [];
    for (let j = 0; j <= cols; j++) row.push({ x: j, y: i });
    knots.push(row);
  }
  return knots;
}

/** 单元 (r,c) 的四角，按固定角点顺序 C0..C3 */
export function cellCorners(knots, r, c) {
  return [knots[r][c], knots[r][c + 1], knots[r + 1][c + 1], knots[r + 1][c]];
}

/** 四角雅可比值 [J(0,0), J(1,0), J(1,1), J(0,1)]，与 CORNER_NAMES 同序 */
export function cornerJacobians(corners) {
  const [C0, C1, C2, C3] = corners;
  return [
    cross2(C1.x - C0.x, C1.y - C0.y, C3.x - C0.x, C3.y - C0.y),
    cross2(C1.x - C0.x, C1.y - C0.y, C2.x - C1.x, C2.y - C1.y),
    cross2(C2.x - C3.x, C2.y - C3.y, C2.x - C1.x, C2.y - C1.y),
    cross2(C2.x - C3.x, C2.y - C3.y, C3.x - C0.x, C3.y - C0.y),
  ];
}

/** 双线性映射：局部坐标 (s,t) → 织补坐标 */
export function bilinearMap(corners, s, t) {
  const [C0, C1, C2, C3] = corners;
  const w0 = (1 - s) * (1 - t);
  const w1 = s * (1 - t);
  const w2 = s * t;
  const w3 = (1 - s) * t;
  return {
    x: w0 * C0.x + w1 * C1.x + w2 * C2.x + w3 * C3.x,
    y: w0 * C0.y + w1 * C1.y + w2 * C2.y + w3 * C3.y,
  };
}

/**
 * 原网坐标 (u,v) → 所在单元与局部坐标 (s,t)。
 * 边界上的点（u=cols 或 v=rows）归入末单元，局部坐标恰为 1。
 * 超出原网范围返回 null。
 */
export function locateCell(u, v, rows, cols) {
  if (!(u >= 0 && u <= cols && v >= 0 && v <= rows)) return null;
  const c = Math.min(Math.floor(u), cols - 1);
  const r = Math.min(Math.floor(v), rows - 1);
  return { r, c, s: u - c, t: v - r };
}

/**
 * 显式核验相邻单元共享同一条连续边：
 * 水平相邻单元的公共竖边、垂直相邻单元的公共横边，两侧端点必须一致。
 * （结构化网格由同一网结阵列装配，天然满足；此处对装配不变量做运行时核验。）
 */
export function checkSharedEdges(knots, rows, cols) {
  const mismatches = [];
  let edgeCount = 0;
  const samePoint = (a, b) => a.x === b.x && a.y === b.y;
  // 水平相邻：单元 (r,c) 的右边（C1,C2）与单元 (r,c+1) 的左边（C0,C3）
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      edgeCount++;
      const right = cellCorners(knots, r, c);
      const left = cellCorners(knots, r, c + 1);
      if (!samePoint(right[1], left[0]) || !samePoint(right[2], left[3])) {
        mismatches.push({ kind: 'vertical-edge', r, c });
      }
    }
  }
  // 垂直相邻：单元 (r,c) 的下边（C3,C2）与单元 (r+1,c) 的上边（C0,C1）
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      edgeCount++;
      const bottom = cellCorners(knots, r, c);
      const top = cellCorners(knots, r + 1, c);
      if (!samePoint(bottom[3], top[0]) || !samePoint(bottom[2], top[1])) {
        mismatches.push({ kind: 'horizontal-edge', r, c });
      }
    }
  }
  return { continuous: mismatches.length === 0, edgeCount, mismatches };
}

/**
 * 输入校验：网格规格、网结整数坐标、纹样标记数量与范围。
 * 返回错误数组（空数组表示通过），每个错误含 kind 与中文 message。
 */
export function validateInput(spec) {
  const errors = [];
  const { rows, cols, knots, markers } = spec ?? {};

  if (!Number.isInteger(rows) || rows < MIN_ROWS || rows > MAX_ROWS) {
    errors.push({ kind: 'rows', message: `行数须为 ${MIN_ROWS}–${MAX_ROWS} 的整数，当前：${rows}` });
  }
  if (!Number.isInteger(cols) || cols < MIN_COLS || cols > MAX_COLS) {
    errors.push({ kind: 'cols', message: `列数须为 ${MIN_COLS}–${MAX_COLS} 的整数，当前：${cols}` });
  }
  if (errors.length) return errors;

  if (
    !Array.isArray(knots) ||
    knots.length !== rows + 1 ||
    knots.some((row) => !Array.isArray(row) || row.length !== cols + 1)
  ) {
    errors.push({ kind: 'knots-shape', message: `网结阵列须为 ${rows + 1}×${cols + 1}` });
    return errors;
  }
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      const k = knots[i][j] ?? {};
      if (!Number.isInteger(k.x) || !Number.isInteger(k.y)) {
        errors.push({
          kind: 'knot-integer', i, j,
          message: `网结 K(${i},${j}) 坐标须为整数，当前 (${k.x}, ${k.y})`,
        });
      } else if (Math.abs(k.x) > COORD_LIMIT || Math.abs(k.y) > COORD_LIMIT) {
        errors.push({
          kind: 'knot-range', i, j,
          message: `网结 K(${i},${j}) 坐标超出允许范围 ±${COORD_LIMIT}`,
        });
      }
    }
  }

  if (!Array.isArray(markers) || markers.length < MIN_MARKERS || markers.length > MAX_MARKERS) {
    errors.push({
      kind: 'markers-count',
      message: `纹样标记数量须为 ${MIN_MARKERS}–${MAX_MARKERS} 个，当前 ${Array.isArray(markers) ? markers.length : '无效'}`,
    });
    return errors;
  }
  markers.forEach((m, idx) => {
    const u = m?.u;
    const v = m?.v;
    if (typeof u !== 'number' || typeof v !== 'number' || !Number.isFinite(u) || !Number.isFinite(v)) {
      errors.push({
        kind: 'marker-invalid', index: idx,
        message: `纹样标记 M${idx + 1} 坐标须为有限数值，当前 (${u}, ${v})`,
      });
    } else if (u < 0 || u > cols || v < 0 || v > rows) {
      errors.push({
        kind: 'marker-range', index: idx,
        message: `纹样标记 M${idx + 1} (${u}, ${v}) 超出原网范围 [0,${cols}]×[0,${rows}]`,
      });
    }
  });
  return errors;
}

/**
 * 全网校核（连续判定）：
 * 1. 输入校验（无效坐标直接判负）；
 * 2. 逐单元（行优先）计算四角雅可比，首项失败按行优先单元 + 固定角点顺序报告；
 * 3. 相邻单元共享边连续性核验；
 * 4. 仅当全网通过时，才把纹样标记换算到织补坐标（避免输出失真位置）。
 *
 * 返回结果对象：
 *   ok, stage('validation'|'geometry'), errors,
 *   firstFailure: { cell:{r,c}, corner, jacobian, type:'fold'|'degenerate' } | null,
 *   minJacobian: { value, cell:{r,c}, corner } | null,
 *   cells: 行优先单元证据数组,
 *   edges: { continuous, edgeCount, mismatches },
 *   markers: 换算后的标记数组（失败时为 null）
 */
export function verifyGrid(spec) {
  const errors = validateInput(spec);
  if (errors.length) {
    return {
      ok: false, stage: 'validation', errors,
      firstFailure: null, minJacobian: null, cells: [], edges: null, markers: null,
    };
  }

  const { rows, cols, knots, markers } = spec;
  const cells = [];
  let firstFailure = null;
  let minJacobian = null;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const corners = cellCorners(knots, r, c);
      const J = cornerJacobians(corners);
      const minJ = Math.min(...J);
      cells.push({ r, c, corners, cornerJacobians: J, minJ, ok: minJ > 0 });
      for (let k = 0; k < 4; k++) {
        if (minJacobian === null || J[k] < minJacobian.value) {
          minJacobian = { value: J[k], cell: { r, c }, corner: k };
        }
        if (J[k] <= 0 && !firstFailure) {
          firstFailure = {
            cell: { r, c }, corner: k, jacobian: J[k],
            type: J[k] < 0 ? 'fold' : 'degenerate',
          };
        }
      }
    }
  }

  const edges = checkSharedEdges(knots, rows, cols);
  const ok = !firstFailure && edges.continuous;

  let mappedMarkers = null;
  if (ok) {
    mappedMarkers = markers.map((m, idx) => {
      const loc = locateCell(m.u, m.v, rows, cols);
      const p = bilinearMap(cellCorners(knots, loc.r, loc.c), loc.s, loc.t);
      return {
        index: idx, u: m.u, v: m.v,
        cell: { r: loc.r, c: loc.c }, s: loc.s, t: loc.t,
        x: p.x, y: p.y,
      };
    });
  }

  return {
    ok, stage: 'geometry', errors: [],
    firstFailure, minJacobian, cells, edges, markers: mappedMarkers,
  };
}
