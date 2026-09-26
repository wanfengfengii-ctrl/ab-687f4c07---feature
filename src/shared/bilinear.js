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
export const MIN_LEADS = 1;
export const MAX_LEADS = 4;
export const COORD_LIMIT = 1_000_000;

/** 倍率闭区间判定的相对容差（仅用于吸收闭式计算末位浮点误差，不改变精确结论） */
const RATIO_EPS = 1e-9;
/** 引线与网格线交点去重容差（λ∈[0,1] 为引线全长参数） */
const LEAD_CUT_EPS = 1e-12;

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

/* ======================================================================
 * 纹样引线：按原网网格线切片 + 双线性映射后二次曲线的精确弧长
 * ======================================================================
 *
 * 一条引线在原网上是连接两个纹样标记的直线 A→B。校核伸缩倍率时，不能只
 * 比较两个织补后端点的距离——端点位置合适并不能保证引线中途没有被过度
 * 拉长。因此：
 *
 * 1. 求引线与全部原网网格线（u = 1..cols-1、v = 1..rows-1）的交点，连同
 *    两个端点，按引线全长参数 λ∈[0,1] 排序去重，把引线切成若干“单元内
 *    片段”。每个片段内部不再穿越任何网格线，属于唯一单元（沿网格线的
 *    片段归入相邻单元之一；共享边两侧映射在边上完全一致，弧长相同）。
 *
 * 2. 单元内片段以 z∈[0,1] 参数化。其原网端点的局部坐标为 (s0,t0)、
 *    (s1,t1)，s、t 均随 z 线性变化；代入双线性映射 P(s,t) 后，每条坐标
 *    关于 z 恰为二次多项式，即片段在织补面上是一条二次曲线：
 *
 *      Q(z) = A0 + B0·z + C0·z²，  Q'(z) = B0 + 2C0·z。
 *
 *    二次系数由 Q 在 z = 0、1/2、1 三点的值唯一确定（三点恒等可恢复
 *    整条二次曲线，不是采样近似）。
 *
 * 3. 弧长 L = ∫₀¹ |Q'(z)| dz。速度平方关于 z 是二次型：
 *
 *      f(z) = |Q'(z)|² = a z² + b z + c，
 *      a = 4(C0·C0) ≥ 0,  b = 4(B0·C0),  c = B0·B0。
 *
 *    令 u = 2az + b、k = 4ac − b²，则 f(z) = (u² + k)/(4a)，dz = du/(2a)，
 *    从而
 *
 *      L = [Φ(u₁) − Φ(u₀)] / (4·a^(3/2))，  u₀ = b，u₁ = 2a + b，
 *
 *    Φ 为 ∫√(u²+k) du 的闭式原函数（全部为初等函数，严格精确，仅含
 *    浮点末位误差，不做折线/像素/固定参数采样近似）：
 *
 *      k > 0:  Φ(u) = ½[u·√(u²+k) + k·asinh(u/√k)]
 *      k = 0:  Φ(u) = ½·u·|u|
 *
 *    对平面曲线恒有 k = 16(B0×C0)² ≥ 0（二维 Gram 行列式），无需其他分支；
 *    浮点算出的微小负 k 按 0 处理。J>0 的单元内非零长度片段速度恒正。
 *    a = 0（二次项系数为零，片段实为直线）时退化为
 *      ∫₀¹√(bz+c) dz 的闭式积分。
 *
 * 汇总：织补后长度 = 全部单元内片段弧长之和；倍率 = 织补后长度 / 原网
 * 直线长度。映射在共享边上连续（见 checkSharedEdges），片段首尾相接。
 * ====================================================================== */

/**
 * 闭式计算二次曲线 Q(z)=q0+(q1-q0-... )z+... 的弧长，z∈[0,1]。
 * q0/qh/q1 为曲线在 z=0、1/2、1 处的位置（三点确定唯一二次曲线）。
 */
export function quadraticArcLength(q0, qh, q1) {
  const Cx = 2 * (q0.x + q1.x - 2 * qh.x);
  const Cy = 2 * (q0.y + q1.y - 2 * qh.y);
  const Bx = q1.x - q0.x - Cx;
  const By = q1.y - q0.y - Cy;

  // 速度 v(z)=B+2Cz：端点速度 v0=B、v1=B+2C，且 ∫₀¹v dz = (v0+v1)/2 = q1−q0。
  const v0x = Bx, v0y = By;
  const v1x = Bx + 2 * Cx, v1y = By + 2 * Cy;
  const n0 = Math.hypot(v0x, v0y);
  const n1 = Math.hypot(v1x, v1y);

  // 速度方向不变（v0、v1 共线且不反向）时，|v| 的积分 = |∫v dz| = 弦长，
  // 这是严格等式。用叉积的相对大小判定“共线”，阈值只用于吸收双线性
  // 求值的末位浮点误差（恒等/仿射单元上本应严格共线的片段，直接代入
  // 通用公式会因 a≈0 的相消损失精度）；真有弯曲时弧长与弦长之差为
  // 偏转角²·弦长/24 量级，阈值 1e-12 对应 <1e-25 相对差，可忽略。
  const crossV = v0x * v1y - v0y * v1x;
  const dotV = v0x * v1x + v0y * v1y;
  if (n0 === 0 || n1 === 0 || Math.abs(crossV) <= 1e-12 * n0 * n1) {
    if (dotV >= 0) return Math.hypot(q1.x - q0.x, q1.y - q0.y);
    // 共线但速度反向（途中经过速度为零的尖点）：两段三角形面积之和
    const w = Math.hypot(v1x - v0x, v1y - v0y); // 反向时 w = n0 + n1 > 0
    return (n0 * n0 + n1 * n1) / (2 * w);
  }

  const a = 4 * (Cx * Cx + Cy * Cy);
  const b = 4 * (Bx * Cx + By * Cy);
  const c = Bx * Bx + By * By;
  // k = 4ac−b² = 16(B×C)²；crossV = B×(B+2C) = 2(B×C)，故 k = 4·crossV²
  const k = 4 * crossV * crossV;
  const u0 = b;
  const u1 = 2 * a + b;
  const sq = Math.sqrt(k);
  const phi = (u) => {
    const R = Math.hypot(u, sq); // √(u²+k)，避免溢出
    return 0.5 * (u * R + k * Math.asinh(u / sq));
  };
  return (phi(u1) - phi(u0)) / (4 * Math.pow(a, 1.5));
}

/**
 * 把引线 A→B 按与原网网格线的全部交点切成单元内片段。
 * 返回 { originalLength, cuts:[{lam,u,v}], segments:[{r,c,...端点}] }。
 * 重合交点（引线恰好穿过网结）去重；端点之外的交点剔除。
 */
export function splitLead(a, b, rows, cols) {
  const du = b.u - a.u;
  const dv = b.v - a.v;
  const originalLength = Math.hypot(du, dv);

  const cuts = [
    { lam: 0, u: a.u, v: a.v },
    { lam: 1, u: b.u, v: b.v },
  ];
  const addCut = (lam, u, v) => {
    if (lam > LEAD_CUT_EPS && lam < 1 - LEAD_CUT_EPS) cuts.push({ lam, u, v });
  };
  if (du !== 0) {
    for (let j = 1; j < cols; j++) {
      const lam = (j - a.u) / du;
      addCut(lam, j, a.v + lam * dv);
    }
  }
  if (dv !== 0) {
    for (let i = 1; i < rows; i++) {
      const lam = (i - a.v) / dv;
      addCut(lam, a.u + lam * du, i);
    }
  }

  cuts.sort((p, q) => p.lam - q.lam);
  // 按 λ 去重（引线穿过网结时竖线、横线给出同一交点）；合并时保留整数网格线坐标
  const merged = [];
  for (const cut of cuts) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(cut.lam - last.lam) <= LEAD_CUT_EPS) {
      last.u = Number.isInteger(last.u) ? last.u : (Number.isInteger(cut.u) ? cut.u : (last.u + cut.u) / 2);
      last.v = Number.isInteger(last.v) ? last.v : (Number.isInteger(cut.v) ? cut.v : (last.v + cut.v) / 2);
    } else {
      merged.push({ ...cut });
    }
  }

  const segments = [];
  for (let i = 0; i + 1 < merged.length; i++) {
    const p = merged[i];
    const q = merged[i + 1];
    if (q.lam - p.lam <= LEAD_CUT_EPS) continue;
    const mu = (p.u + q.u) / 2;
    const mv = (p.v + q.v) / 2;
    const loc = locateCell(mu, mv, rows, cols);
    if (!loc) continue; // 理论上不会发生：端点与交点均在原网内
    segments.push({
      r: loc.r, c: loc.c,
      lambda0: p.lam, lambda1: q.lam,
      u0: p.u, v0: p.v, u1: q.u, v1: q.v,
      s0: p.u - loc.c, t0: p.v - loc.r, s1: q.u - loc.c, t1: q.v - loc.r,
      originalLength: Math.hypot(q.u - p.u, q.v - p.v),
      mappedLength: 0,
    });
  }
  return { originalLength, cuts: merged, segments };
}

/**
 * 计算单条引线的伸缩证据（调用前须已通过输入校验与全网几何校核）。
 * 逐片段做双线性映射并以闭式弧长求和，返回原始/织补长度、实际倍率与
 * 经过的全部单元片段。端点下标无效时返回 valid:false 的占位证据
 * （长度字段为 null），由 verifyGrid 按录入顺序报告为首项失败。
 */
export function evaluateLead(lead, index, markers, rows, cols, knots) {
  const base = {
    index,
    from: lead.from,
    to: lead.to,
    minRatio: lead.minRatio,
    maxRatio: lead.maxRatio,
    originalLength: null,
    mappedLength: null,
    ratio: null,
    cutCount: 0,
    segments: [],
  };
  const validIndex = (key) =>
    Number.isInteger(lead[key]) && lead[key] >= 0 && lead[key] < markers.length;
  const fromOk = validIndex('from');
  const toOk = validIndex('to');
  const A = fromOk ? markers[lead.from] : null;
  const B = toOk ? markers[lead.to] : null;
  if (!A || !B) {
    return {
      ...base, valid: false,
      invalidFields: [!fromOk && 'from', !toOk && 'to'].filter(Boolean),
    };
  }

  const { originalLength, cuts, segments } = splitLead(A, B, rows, cols);

  let mappedLength = 0;
  for (const seg of segments) {
    const corners = cellCorners(knots, seg.r, seg.c);
    const q0 = bilinearMap(corners, seg.s0, seg.t0);
    const q1 = bilinearMap(corners, seg.s1, seg.t1);
    const sm = (seg.s0 + seg.s1) / 2;
    const tm = (seg.t0 + seg.t1) / 2;
    const qh = bilinearMap(corners, sm, tm);
    seg.mappedLength = quadraticArcLength(q0, qh, q1);
    seg.mapped = { q0, qh, q1 };
    mappedLength += seg.mappedLength;
  }

  return {
    ...base,
    valid: true,
    originalLength,
    mappedLength,
    ratio: originalLength > 0 ? mappedLength / originalLength : null,
    cutCount: cuts.length,
    segments,
  };
}

/** 倍率闭区间判定（仅用相对容差吸收闭式计算的末位浮点误差） */
export function ratioWithin(ratio, minRatio, maxRatio) {
  const tol = RATIO_EPS * Math.max(1, Math.abs(ratio));
  return ratio >= minRatio - tol && ratio <= maxRatio + tol;
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
 * 引线限制的结构校验（不依赖几何校核）：
 * 1–4 条；min/max 为有限正数且 min ≤ max。
 * 端点下标越界（“端点无效”）属于逐条引线的语义失败，在 verifyGrid 中
 * 与原始长度为零、倍率超限一起按引线录入顺序报告为首项失败（leadFailure），
 * 而非在此整体拒绝。
 */
export function validateLeads(spec) {
  const errors = [];
  const { leads } = spec ?? {};
  if (leads === undefined || leads === null) return errors;
  if (!Array.isArray(leads)) {
    errors.push({ kind: 'leads-shape', message: '纹样引线限制须为数组（1–4 条）' });
    return errors;
  }
  if (leads.length < MIN_LEADS || leads.length > MAX_LEADS) {
    errors.push({
      kind: 'leads-count',
      message: `纹样引线限制须为 ${MIN_LEADS}–${MAX_LEADS} 条，当前 ${leads.length} 条`,
    });
  }
  leads.forEach((lead, idx) => {
    const tag = `引线 L${idx + 1}`;
    const l = lead ?? {};
    for (const key of ['from', 'to']) {
      if (!Number.isInteger(l[key])) {
        errors.push({
          kind: 'lead-endpoint-field', index: idx, field: key,
          message: `${tag} 端点 ${key === 'from' ? 'A' : 'B'} 须为纹样标记的整数序号，当前：${l[key]}`,
        });
      }
    }
    for (const key of ['minRatio', 'maxRatio']) {
      if (typeof l[key] !== 'number' || !Number.isFinite(l[key]) || l[key] <= 0) {
        errors.push({
          kind: 'lead-ratio-field', index: idx, field: key,
          message: `${tag} 的${key === 'minRatio' ? '最小' : '最大'}伸缩倍率须为正数，当前：${l[key]}`,
        });
      }
    }
    if (
      typeof l.minRatio === 'number' && Number.isFinite(l.minRatio) && l.minRatio > 0 &&
      typeof l.maxRatio === 'number' && Number.isFinite(l.maxRatio) && l.maxRatio > 0 &&
      l.minRatio > l.maxRatio
    ) {
      errors.push({
        kind: 'lead-ratio-order', index: idx,
        message: `${tag} 的最小倍率 ${l.minRatio} 不得大于最大倍率 ${l.maxRatio}`,
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
 * 4. 仅当全网通过时，才把纹样标记换算到织补坐标（避免输出失真位置）；
 * 5. 若配置了引线限制（spec.leads），仅当全网通过时逐引线按网格线切片、
 *    对每段双线性映射后的二次曲线精确求弧长，并按录入顺序报告首项失败。
 *
 * 未配置 spec.leads 时响应与既有草稿完全一致（不含引线字段）。
 */
export function verifyGrid(spec) {
  const errors = validateInput(spec);
  if (errors.length) {
    return {
      ok: false, stage: 'validation', errors,
      firstFailure: null, minJacobian: null, cells: [], edges: null, markers: null,
    };
  }
  const leadErrors = validateLeads(spec);
  if (leadErrors.length) {
    return {
      ok: false, stage: 'validation', errors: leadErrors,
      firstFailure: null, minJacobian: null, cells: [], edges: null, markers: null,
    };
  }

  const { rows, cols, knots, markers, leads } = spec;
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
  let leadResults = null;
  let leadFailure = null;
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

    if (Array.isArray(leads)) {
      leadResults = leads.map((lead, idx) =>
        evaluateLead(lead, idx, markers, rows, cols, knots));
      // 首项失败按引线录入顺序：端点无效 → 原始长度为零 → 倍率超限。
      // 标记坐标已在 validateInput 确认有限且在原网范围内，故“端点
      // 无效”仅指引线端点下标不是已有标记的合法序号。
      for (const lr of leadResults) {
        let failure = null;
        if (!lr.valid) {
          const which = lr.invalidFields.map((f) => (f === 'from' ? 'A' : 'B')).join('、');
          const badVal = lr.invalidFields.includes('from') ? lr.from : lr.to;
          failure = {
            index: lr.index, from: lr.from, to: lr.to, type: 'endpoint',
            message: `引线 L${lr.index + 1} 端点${which}不是有效的已有标记序号`
              + `（共 ${markers.length} 个标记，合法序号 0–${markers.length - 1}），当前：${badVal}`,
            evidence: { markerCount: markers.length, originalLength: null, mappedLength: null, ratio: null },
          };
        } else if (lr.originalLength === 0) {
          failure = {
            index: lr.index, from: lr.from, to: lr.to, type: 'zero-length',
            message: `引线 L${lr.index + 1}（M${lr.from + 1}→M${lr.to + 1}）原网直线长度为 0，无法定义伸缩倍率`,
            evidence: { originalLength: 0, mappedLength: lr.mappedLength, ratio: null },
          };
        } else if (!ratioWithin(lr.ratio, lr.minRatio, lr.maxRatio)) {
          failure = {
            index: lr.index, from: lr.from, to: lr.to, type: 'ratio',
            message: `引线 L${lr.index + 1}（M${lr.from + 1}→M${lr.to + 1}）实际倍率 ${lr.ratio} 超出允许区间 [${lr.minRatio}, ${lr.maxRatio}]`,
            evidence: {
              originalLength: lr.originalLength,
              mappedLength: lr.mappedLength,
              ratio: lr.ratio,
              minRatio: lr.minRatio,
              maxRatio: lr.maxRatio,
            },
          };
        }
        if (failure) { leadFailure = failure; break; }
      }
      if (leadFailure) {
        // 引线失败同样拦截：不把会拉断纹样的引线交给织补师。
        // markers 保留换算位置作为长度证据的一部分（leadResults 已含全部数值）。
        return {
          ok: false, stage: 'leads', errors: [],
          firstFailure, minJacobian, cells, edges, markers: mappedMarkers,
          leads: leadResults, leadFailure,
        };
      }
    }
  }

  const result = {
    ok, stage: 'geometry', errors: [],
    firstFailure, minJacobian, cells, edges, markers: mappedMarkers,
  };
  if (leadResults) {
    result.leads = leadResults;
    result.leadFailure = null;
  }
  return result;
}
