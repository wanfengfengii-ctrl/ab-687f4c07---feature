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
export const MIN_LINES = 1;
export const MAX_LINES = 4;
export const COORD_LIMIT = 1_000_000;

/** 倍率判定的相对容差（仅用于浮点边比较，弧长本身为精确闭式解） */
export const RATIO_EPS = 1e-9;

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

/* ===================================================================== */
/* 纹样引线：按原网网格线切分 + 双线性像（二次曲线）的精确弧长（闭式解） */
/* ===================================================================== */

/**
 * 速度多项式 q(λ) = aλ² + bλ + c 在 [x0,x1] 上的定积分 ∫ sqrt(q) dλ。
 *
 * 双线性映射限制在一条原网直线段上时，像曲线 r(λ) 是 λ 的二次函数
 * （s、t 沿直线线性变化，双线性形函数给出二次坐标），故其切向量
 * r'(λ) 是一次函数、速度 |r'(λ)| = sqrt(aλ²+bλ+c)。该积分存在
 * 标准原函数（对数/asinh 闭式解），此处直接求原函数端点值之差——
 * 这是精确弧长，不做折线、像素或固定参数采样近似。
 *
 * 退化情形（像曲线实为直线甚至点）单独处理，避免公式除零。
 */
export function integrateSpeed(a, b, c, x0, x1) {
  const span = x1 - x0;
  if (span <= 0) return 0;
  const antiderivative = (x) => {
    if (a === 0) {
      if (b === 0) return Math.sqrt(Math.max(c, 0)) * x;
      // ∫ sqrt(bx+c) dx = 2/(3b) (bx+c)^(3/2)
      return (2 / (3 * b)) * Math.pow(Math.max(b * x + c, 0), 1.5);
    }
    const q = a * x * x + b * x + c;
    const lin = 2 * a * x + b;
    const d = 4 * a * c - b * b; // 速度平方为完全平方时 d = 0
    if (d <= 1e-12 * Math.max(1, Math.abs(a * c), b * b)) {
      // 像曲线为直线：sqrt(q) = |√a·x + b/(2√a)|，解析积分
      const sq = Math.sqrt(a);
      const z = sq * x + b / (2 * sq);
      return (z * Math.abs(z)) / (2 * sq);
    }
    const sqd = Math.sqrt(d);
    // F(x) = (2ax+b)√q/(4a) + d/(8 a^(3/2)) asinh((2ax+b)/√d)
    return (lin * Math.sqrt(Math.max(q, 0))) / (4 * a)
      + d / (8 * a * Math.sqrt(a)) * Math.asinh(lin / sqd);
  };
  return antiderivative(x1) - antiderivative(x0);
}

/**
 * 把原网直线 A(u0,v0) → B(u1,v1) 按其与原网网格线（u、v 为整数的线）
 * 的全部交点切成单元内片段。端点本身（含边界）亦作为切点。
 *
 * 返回 [{ λ0, λ1, r, c, s0, t0, s1, t1 }]，每段中点严格落在某单元内部，
 * 因而片段归属无歧义；恰好沿网格线行走时由中点 floor 归入固定一侧。
 */
export function splitLeadLine(u0, v0, u1, v1, rows, cols) {
  const du = u1 - u0;
  const dv = v1 - v0;
  const cuts = new Set([0, 1]);
  const addCut = (coord, end, delta, max) => {
    if (delta === 0) return;
    const lo = Math.min(coord, end);
    const hi = Math.max(coord, end);
    // 仅收开区间内的整数网格线交点；端点 0、1 已在 cuts 中
    const k0 = Math.floor(lo) + 1;
    const k1 = Math.ceil(hi) - 1;
    for (let k = k0; k <= k1; k++) {
      if (k < 0 || k > max) continue;
      const lambda = (k - coord) / delta;
      if (lambda > 0 && lambda < 1) cuts.add(lambda);
    }
  };
  addCut(u0, u1, du, cols);
  addCut(v0, v1, dv, rows);
  const lambdas = [...cuts].sort((p, q) => p - q);

  const at = (lambda) => {
    const u = u0 + du * lambda;
    const v = v0 + dv * lambda;
    // 切点本应恰在整数网格线上：吸附掉浮点尾差，保证相邻片段端点严格共点
    const snap = (x, max) => {
      const r = Math.round(x);
      return (r >= 0 && r <= max && Math.abs(x - r) <= 1e-9) ? r : x;
    };
    return { u: snap(u, cols), v: snap(v, rows) };
  };
  const segments = [];
  for (let i = 0; i + 1 < lambdas.length; i++) {
    const l0 = lambdas[i];
    const l1 = lambdas[i + 1];
    if (!(l1 - l0 > 0)) continue;
    const p0 = at(l0);
    const p1 = at(l1);
    // 中点决定归属，避免角点/网格线上的浮点抖动导致归属摇摆
    const pm = at((l0 + l1) / 2);
    const loc = locateCell(pm.u, pm.v, rows, cols);
    if (!loc) continue;
    segments.push({
      lambda0: l0, lambda1: l1,
      r: loc.r, c: loc.c,
      s0: p0.u - loc.c, t0: p0.v - loc.r,
      s1: p1.u - loc.c, t1: p1.v - loc.r,
    });
  }
  return segments;
}

/**
 * 计算一条引线的全部证据：
 * 原网直线长度、各单元内片段、每片段双线性像（二次曲线）的精确弧长，
 * 以及织补后总长与实际伸缩倍率。
 *
 * 片段弧长：在单元局部坐标中 s(λ)=s0+ds·λ、t(λ)=t0+dt·t（λ 为片段内
 * 参数 0→1），像曲线切向量 r'(λ) 为一次函数：
 *   r'(λ) = P_s·ds + P_t·dt，P_s、P_t 随 (s,t) 线性变化
 * 速度平方为二次多项式，系数直接由四角坐标代数展开，交 integrateSpeed
 * 做闭式积分。跨片段的 λ 为全局参数，原网片段长度 = Δλ·原网直线总长。
 */
export function analyzeLeadLine(line, markers, knots, rows, cols) {
  const from = line?.from;
  const to = line?.to;
  if (!Number.isInteger(from) || !Number.isInteger(to)
      || from < 0 || from >= markers.length || to < 0 || to >= markers.length) {
    return {
      line, endpointInvalid: true,
      originalLength: null, wovenLength: null, ratio: null, segments: [],
    };
  }
  const A = markers[from];
  const B = markers[to];
  const du = B.u - A.u;
  const dv = B.v - A.v;
  const originalLength = Math.hypot(du, dv);

  const rawSegments = splitLeadLine(A.u, A.v, B.u, B.v, rows, cols);
  const segments = [];
  let wovenLength = 0;
  for (const seg of rawSegments) {
    const corners = cellCorners(knots, seg.r, seg.c);
    const [C0, C1, C2, C3] = corners;
    // 切向量对全局 λ 的系数：r(λ)=双线性(s(λ),t(λ))，r'(λ)=A1 λ + B1
    // 用片段两端的局部坐标与全局 λ 跨度直接构造线性插值的端点速度更稳妥：
    const deriv = (s, t) => {
      const Psx = (C1.x - C0.x) * (1 - t) + (C2.x - C3.x) * t;
      const Psy = (C1.y - C0.y) * (1 - t) + (C2.y - C3.y) * t;
      const Ptx = (C3.x - C0.x) * (1 - s) + (C2.x - C1.x) * s;
      const Pty = (C3.y - C0.y) * (1 - s) + (C2.y - C1.y) * s;
      // 全局参数速度：ds/dλ = (s1-s0)/Δλ 等，Δλ 已提出，故先求片段局部速度
      return { x: Psx, y: Psy, tx: Ptx, ty: Pty };
    };
    const d0 = deriv(seg.s0, seg.t0);
    const d1 = deriv(seg.s1, seg.t1);
    const dsdl = (seg.s1 - seg.s0); // 未除 Δλ：按片段局部 λ∈[0,1] 计
    const dtdl = (seg.t1 - seg.t0);
    const vx0 = d0.x * dsdl + d0.tx * dtdl;
    const vy0 = d0.y * dsdl + d0.ty * dtdl;
    const vx1 = d1.x * dsdl + d1.tx * dtdl;
    const vy1 = d1.y * dsdl + d1.ty * dtdl;
    // r_local'(z) = v0 + (v1-v0) z，z∈[0,1]；速度平方 = a z² + b z + c
    const ax = vx1 - vx0;
    const ay = vy1 - vy0;
    const qa = ax * ax + ay * ay;
    const qb = 2 * (ax * vx0 + ay * vy0);
    const qc = vx0 * vx0 + vy0 * vy0;
    const segWoven = integrateSpeed(qa, qb, qc, 0, 1);
    const segOriginal = (seg.lambda1 - seg.lambda0) * originalLength;
    wovenLength += segWoven;
    segments.push({
      r: seg.r, c: seg.c,
      s0: seg.s0, t0: seg.t0, s1: seg.s1, t1: seg.t1,
      lambda0: seg.lambda0, lambda1: seg.lambda1,
      originalLength: segOriginal, wovenLength: segWoven,
    });
  }

  return {
    endpointInvalid: false,
    from, to,
    originalLength,
    wovenLength,
    ratio: originalLength > 0 ? wovenLength / originalLength : null,
    segments,
  };
}

/**
 * 引线配置的输入校验（仅在 spec.lines 存在时执行；未配置时完全维持旧行为）。
 * 端点越界在逐条分析阶段按录入顺序报告（首项失败 + 长度证据）。
 */
export function validateLeadLineSpec(lines, markerCount) {
  const errors = [];
  if (!Array.isArray(lines) || lines.length < MIN_LINES || lines.length > MAX_LINES) {
    errors.push({
      kind: 'lines-count',
      message: `纹样引线数量须为 ${MIN_LINES}–${MAX_LINES} 条，当前 ${Array.isArray(lines) ? lines.length : '无效'}`,
    });
    return errors;
  }
  lines.forEach((ln, idx) => {
    const label = `引线 L${idx + 1}`;
    for (const key of ['from', 'to']) {
      if (!Number.isInteger(ln?.[key]) || ln[key] < 0 || ln[key] >= markerCount) {
        errors.push({
          kind: 'line-endpoint', index: idx, field: key,
          message: `${label} 的${key === 'from' ? '起点' : '终点'}标记无效（须为 0–${markerCount - 1} 的已有标记序号）`,
        });
      }
    }
    const lo = ln?.minRatio;
    const hi = ln?.maxRatio;
    const ratioOk = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
    if (!ratioOk(lo) || !ratioOk(hi)) {
      errors.push({
        kind: 'line-ratio-invalid', index: idx,
        message: `${label} 的最小/最大伸缩倍率须为正数，当前 [${lo}, ${hi}]`,
      });
    } else if (lo > hi + RATIO_EPS) {
      errors.push({
        kind: 'line-ratio-order', index: idx,
        message: `${label} 的最小倍率 ${lo} 不得大于最大倍率 ${hi}`,
      });
    }
  });
  return errors;
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
 * 1. 输入校验（无效坐标直接判负）；配置了纹样引线 lines 时同时校验引线；
 * 2. 逐单元（行优先）计算四角雅可比，首项失败按行优先单元 + 固定角点顺序报告；
 * 3. 相邻单元共享边连续性核验；
 * 4. 仅当全网通过时，才把纹样标记换算到织补坐标（避免输出失真位置）；
 * 5. 仅在既有定位网校核通过后，才逐条（录入顺序）核算纹样引线：
 *    按与原网网格线的全部交点切成单元内片段，对每片段双线性像（二次
 *    曲线）精确求弧长（闭式积分），汇总后与允许伸缩倍率区间比较。
 *
 * 返回结果对象：
 *   ok, stage('validation'|'geometry'), errors,
 *   firstFailure: { cell:{r,c}, corner, jacobian, type:'fold'|'degenerate' } | null,
 *   minJacobian: { value, cell:{r,c}, corner } | null,
 *   cells: 行优先单元证据数组,
 *   edges: { continuous, edgeCount, mismatches },
 *   markers: 换算后的标记数组（失败时为 null）
 *   lines: null（未配置）或 { items: 逐条证据, firstFailure }
 */
export function verifyGrid(spec) {
  const errors = validateInput(spec);
  const hasLines = spec != null && Object.prototype.hasOwnProperty.call(spec, 'lines')
    && spec.lines !== undefined && spec.lines !== null;
  const markerCount = Array.isArray(spec?.markers) ? spec.markers.length : 0;
  const lineErrors = hasLines ? validateLeadLineSpec(spec.lines, markerCount) : [];
  if (errors.length || lineErrors.length) {
    const result = {
      ok: false, stage: 'validation', errors: [...errors, ...lineErrors],
      firstFailure: null, minJacobian: null, cells: [], edges: null,
      markers: null,
    };
    // 未配置引线时响应字段与旧版本逐字一致（不新增 lines 键）
    if (hasLines) result.lines = null;
    return result;
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
  const gridOk = !firstFailure && edges.continuous;

  let mappedMarkers = null;
  let lineResult = null;
  if (gridOk) {
    mappedMarkers = markers.map((m, idx) => {
      const loc = locateCell(m.u, m.v, rows, cols);
      const p = bilinearMap(cellCorners(knots, loc.r, loc.c), loc.s, loc.t);
      return {
        index: idx, u: m.u, v: m.v,
        cell: { r: loc.r, c: loc.c }, s: loc.s, t: loc.t,
        x: p.x, y: p.y,
      };
    });

    if (hasLines) {
      const items = [];
      let firstLineFailure = null;
      spec.lines.forEach((ln, idx) => {
        const a = analyzeLeadLine(ln, markers, knots, rows, cols);
        const item = {
          index: idx, from: a.from, to: a.to,
          minRatio: ln.minRatio, maxRatio: ln.maxRatio,
          originalLength: a.originalLength,
          wovenLength: a.wovenLength,
          ratio: a.ratio,
          segments: a.segments,
          ok: false,
          reason: null,
        };
        if (a.endpointInvalid) {
          item.reason = 'endpoint-invalid';
        } else if (!(a.originalLength > 0)) {
          // 原始长度为零：两端点重合，倍率无定义，按录入顺序判为首项失败
          item.reason = 'zero-length';
        } else {
          const r = a.ratio;
          if (!(r >= ln.minRatio - RATIO_EPS && r <= ln.maxRatio + RATIO_EPS)) {
            item.reason = 'ratio-out-of-range';
          }
        }
        item.ok = item.reason === null;
        if (!item.ok && !firstLineFailure) firstLineFailure = { ...item };
        items.push(item);
      });
      lineResult = { items, firstFailure: firstLineFailure };
    }
  }

  const ok = gridOk && (!lineResult || lineResult.firstFailure === null);

  const result = {
    ok, stage: 'geometry', errors: [],
    firstFailure, minJacobian, cells, edges, markers: mappedMarkers,
  };
  if (hasLines) result.lines = lineResult; // 网格失败时 lineResult=null
  return result;
}
