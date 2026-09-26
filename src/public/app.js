import {
  verifyGrid, makeIdentityKnots,
  MIN_ROWS, MAX_ROWS, MIN_COLS, MAX_COLS, MIN_MARKERS, MAX_MARKERS,
  MIN_LEADS, MAX_LEADS,
  CORNER_NAMES, FAILURE_TYPE_NAMES,
} from '/shared/bilinear.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#canvas');
const ctx = canvas.getContext('2d');

function defaultMarkers(rows, cols) {
  return [
    { u: 0.5, v: 0.5 },
    { u: cols / 2, v: rows / 2 },
    { u: cols - 0.5, v: rows - 0.5 },
  ];
}

const state = {
  rows: 3,
  cols: 3,
  knots: makeIdentityKnots(3, 3),
  markers: defaultMarkers(3, 3),
  leads: [], // 纹样引线限制；空数组表示未配置（校核请求不传 leads）
  result: null, // 最近一次校核结论
  fresh: false, // 结论是否仍对应当前输入（任何修改立即置 false）
};

/* ---------------- 输入控件 ---------------- */

const rowsSel = $('#rows');
const colsSel = $('#cols');
for (let n = MIN_ROWS; n <= MAX_ROWS; n++) rowsSel.add(new Option(String(n), n));
for (let n = MIN_COLS; n <= MAX_COLS; n++) colsSel.add(new Option(String(n), n));
rowsSel.value = state.rows;
colsSel.value = state.cols;
rowsSel.onchange = () => resetGrid(Number(rowsSel.value), state.cols);
colsSel.onchange = () => resetGrid(state.rows, Number(colsSel.value));

$('#resetKnots').onclick = () => {
  state.knots = makeIdentityKnots(state.rows, state.cols);
  buildKnotFields();
  invalidate();
};

function resetGrid(rows, cols) {
  state.rows = rows;
  state.cols = cols;
  state.knots = makeIdentityKnots(rows, cols);
  state.markers = defaultMarkers(rows, cols);
  state.leads = [];
  state.result = null;
  buildKnotFields();
  buildMarkerFields();
  buildLeadFields();
  invalidate();
}

let knotInputs = []; // knotInputs[i][j] = { xi, yi }

function buildKnotFields() {
  const host = $('#knotFields');
  host.innerHTML = '';
  knotInputs = [];
  for (let i = 0; i <= state.rows; i++) {
    const rowEl = document.createElement('div');
    rowEl.className = 'knot-row';
    const title = document.createElement('span');
    title.className = 'knot-row-title';
    title.textContent = `第 ${i} 行`;
    rowEl.append(title);
    const arr = [];
    for (let j = 0; j <= state.cols; j++) {
      const k = state.knots[i][j];
      const field = document.createElement('span');
      field.className = 'knot-field';
      const lab = document.createElement('em');
      lab.textContent = `K(${i},${j})`;
      const xi = document.createElement('input');
      xi.type = 'number';
      xi.step = '1';
      xi.value = Number.isFinite(k.x) ? k.x : '';
      xi.setAttribute('aria-label', `K(${i},${j}) x`);
      const yi = document.createElement('input');
      yi.type = 'number';
      yi.step = '1';
      yi.value = Number.isFinite(k.y) ? k.y : '';
      yi.setAttribute('aria-label', `K(${i},${j}) y`);
      xi.oninput = () => updateKnot(i, j, xi.valueAsNumber, state.knots[i][j].y);
      yi.oninput = () => updateKnot(i, j, state.knots[i][j].x, yi.valueAsNumber);
      field.append(lab, xi, yi);
      rowEl.append(field);
      arr.push({ xi, yi });
    }
    host.append(rowEl);
    knotInputs.push(arr);
  }
}

function updateKnot(i, j, x, y) {
  state.knots[i][j] = { x, y };
  invalidate();
}

function syncKnotInputs(i, j) {
  const pair = knotInputs[i] && knotInputs[i][j];
  if (!pair) return;
  pair.xi.value = state.knots[i][j].x;
  pair.yi.value = state.knots[i][j].y;
}

function buildMarkerFields() {
  const host = $('#markerFields');
  host.innerHTML = '';
  state.markers.forEach((m, idx) => {
    const row = document.createElement('div');
    row.className = 'marker-row';
    const lab = document.createElement('em');
    lab.textContent = `M${idx + 1}`;
    const ui = document.createElement('input');
    ui.type = 'number';
    ui.step = '0.1';
    ui.value = Number.isFinite(m.u) ? m.u : '';
    ui.oninput = () => { state.markers[idx].u = ui.valueAsNumber; invalidate(); };
    const vi = document.createElement('input');
    vi.type = 'number';
    vi.step = '0.1';
    vi.value = Number.isFinite(m.v) ? m.v : '';
    vi.oninput = () => { state.markers[idx].v = vi.valueAsNumber; invalidate(); };
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '删除';
    rm.disabled = state.markers.length <= MIN_MARKERS;
    rm.onclick = () => {
      state.markers.splice(idx, 1);
      // 删除标记会改变后续标记下标：同步修正引用它的引线端点，
      // 直接引用被删标记的引线整条移除（端点已不存在）。
      state.leads = state.leads
        .filter((ld) => ld.from !== idx && ld.to !== idx)
        .map((ld) => ({
          ...ld,
          from: ld.from > idx ? ld.from - 1 : ld.from,
          to: ld.to > idx ? ld.to - 1 : ld.to,
        }));
      buildMarkerFields();
      buildLeadFields();
      invalidate();
    };
    row.append(lab, document.createTextNode('u ='), ui, document.createTextNode('v ='), vi, rm);
    host.append(row);
  });
  $('#addMarker').disabled = state.markers.length >= MAX_MARKERS;
}

$('#addMarker').onclick = () => {
  if (state.markers.length >= MAX_MARKERS) return;
  state.markers.push({ u: state.cols / 2, v: state.rows / 2 });
  buildMarkerFields();
  buildLeadFields();
  invalidate();
};

/* ---------------- 纹样引线限制 ---------------- */

function markerOptions(selected) {
  return state.markers
    .map((m, i) => `<option value="${i}"${i === selected ? ' selected' : ''}>M${i + 1} (${fmt(m.u)}, ${fmt(m.v)})</option>`)
    .join('');
}

function buildLeadFields() {
  const host = $('#leadFields');
  host.innerHTML = '';
  state.leads.forEach((ld, idx) => {
    const row = document.createElement('div');
    row.className = 'lead-row';

    const lab = document.createElement('em');
    lab.textContent = `L${idx + 1}`;

    const fromSel = document.createElement('select');
    fromSel.innerHTML = markerOptions(ld.from);
    fromSel.setAttribute('aria-label', `引线 L${idx + 1} 端点 A`);
    fromSel.onchange = () => { ld.from = Number(fromSel.value); invalidate(); };

    const toSel = document.createElement('select');
    toSel.innerHTML = markerOptions(ld.to);
    toSel.setAttribute('aria-label', `引线 L${idx + 1} 端点 B`);
    toSel.onchange = () => { ld.to = Number(toSel.value); invalidate(); };

    const minI = document.createElement('input');
    minI.type = 'number';
    minI.step = '0.01';
    minI.min = '0';
    minI.value = String(ld.minRatio);
    minI.setAttribute('aria-label', `引线 L${idx + 1} 最小倍率`);
    minI.oninput = () => { ld.minRatio = minI.valueAsNumber; invalidate(); };

    const maxI = document.createElement('input');
    maxI.type = 'number';
    maxI.step = '0.01';
    maxI.min = '0';
    maxI.value = String(ld.maxRatio);
    maxI.setAttribute('aria-label', `引线 L${idx + 1} 最大倍率`);
    maxI.oninput = () => { ld.maxRatio = maxI.valueAsNumber; invalidate(); };

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.textContent = '删除';
    rm.onclick = () => {
      state.leads.splice(idx, 1);
      buildLeadFields();
      invalidate();
    };

    row.append(
      lab,
      document.createTextNode('A ='), fromSel,
      document.createTextNode('B ='), toSel,
      document.createTextNode('倍率区间 ['), minI, document.createTextNode('，'), maxI, document.createTextNode(']'),
      rm,
    );
    host.append(row);
  });
  $('#addLead').disabled = state.leads.length >= MAX_LEADS;
}

$('#addLead').onclick = () => {
  if (state.leads.length >= MAX_LEADS) return;
  // 默认取前两个不同标记，倍率区间 [0.5, 2]；标记不足 2 个时后端会拒绝
  const from = 0;
  const to = state.markers.length > 1 ? 1 : 0;
  state.leads.push({ from, to, minRatio: 0.5, maxRatio: 2 });
  buildLeadFields();
  invalidate();
};

$('#verifyBtn').onclick = () => {
  const spec = {
    rows: state.rows,
    cols: state.cols,
    knots: state.knots,
    markers: state.markers,
  };
  // 仅在配置了引线限制时携带 leads：未配置草稿的请求与响应保持原样
  if (state.leads.length > 0) spec.leads = state.leads;
  state.result = verifyGrid(spec);
  state.fresh = true;
  renderResults();
  draw();
};

/** 任何输入修改后立即使旧结论失效 */
function invalidate() {
  state.fresh = false;
  renderResults();
  draw();
}

/* ---------------- 结论展示 ---------------- */

function fmt(n) {
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  const s = n.toFixed(4).replace(/\.?0+$/, '');
  return s === '' || s === '-' ? '0' : s;
}

function renderResults() {
  const host = $('#results');
  const stale = $('#staleNotice');
  if (!state.result) {
    stale.hidden = true;
    host.innerHTML = '<p class="hint">尚未校核。配置网格与标记后点击“校核”，将对每个单元做连续双线性判定。</p>';
    return;
  }
  if (!state.fresh) {
    stale.hidden = false;
    host.innerHTML = '';
    return;
  }
  stale.hidden = true;
  host.innerHTML = renderConclusion(state.result);
}

function renderCellTable(res) {
  const rows = res.cells.map((cell, i) => {
    const js = cell.cornerJacobians
      .map((j, k) => `<span class="${j <= 0 ? 'bad' : ''}">J${k}=${j}</span>`)
      .join(' ');
    return `<tr class="${cell.ok ? '' : 'fail-row'}">
      <td>单元 (${cell.r},${cell.c})（行优先第 ${i + 1} 个）</td>
      <td>${js}</td>
      <td>${cell.minJ}</td>
      <td>${cell.ok ? '通过' : '失败'}</td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr><th>单元（行优先）</th><th>四角雅可比（固定角点序 C0→C3）</th><th>最小值</th><th>结论</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderLeadTable(res) {
  const rows = res.leads.map((ld) => {
    const failed = res.leadFailure && res.leadFailure.index === ld.index;
    const cells = ld.segments
      .map((s) => `(${s.r},${s.c}) 原${fmt(s.originalLength)}→织${fmt(s.mappedLength)}`)
      .join('；');
    const ratioText = ld.ratio === null ? '—（原长为 0）' : fmt(ld.ratio);
    return `<tr class="${failed ? 'fail-row' : ''}">
      <td>L${ld.index + 1}（M${ld.from + 1}→M${ld.to + 1}）</td>
      <td>${fmt(ld.originalLength)}</td>
      <td>${fmt(ld.mappedLength)}</td>
      <td class="${failed ? 'bad' : ''}"><b>${ratioText}</b></td>
      <td>[${fmt(ld.minRatio)}，${fmt(ld.maxRatio)}]</td>
      <td>${ld.segments.length} 段：${cells}</td>
    </tr>`;
  }).join('');
  return `<table>
    <thead><tr>
      <th>引线</th><th>原网直线长度</th><th>织补后弧长（逐片段闭式积分汇总）</th>
      <th>实际倍率</th><th>允许倍率</th><th>经过的单元内片段</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderConclusion(res) {
  const parts = [];

  if (res.stage === 'validation') {
    parts.push(`<div class="banner fail">输入无效：共 ${res.errors.length} 处问题，首项如下。</div>`);
    parts.push(`<p class="first-failure">首项失败证据：${res.errors[0].message}</p>`);
    if (res.errors.length > 1) {
      parts.push(`<ul>${res.errors.slice(1).map((e) => `<li>${e.message}</li>`).join('')}</ul>`);
    }
    parts.push('<p class="hint">已拦截：未输出纹样换算位置，以免失真坐标误导织补。</p>');
    return parts.join('');
  }

  if (!res.ok && res.stage === 'leads') {
    const f = res.leadFailure;
    parts.push('<div class="banner fail">几何校核通过，但纹样引线伸缩校核未通过。</div>');
    parts.push(`<p class="first-failure">首项引线失败（按录入顺序 L1→L${res.leads.length}）：${f.message}。</p>`);
    if (f.evidence) {
      const ev = f.evidence;
      const lines = [];
      if (typeof ev.originalLength === 'number') lines.push(`原网直线长度 = ${fmt(ev.originalLength)}`);
      if (typeof ev.mappedLength === 'number') lines.push(`织补后弧长 = ${fmt(ev.mappedLength)}`);
      if (typeof ev.ratio === 'number') lines.push(`实际倍率 = ${fmt(ev.ratio)}`);
      if (lines.length) parts.push(`<p>长度证据：${lines.join('；')}。</p>`);
    }
    parts.push('<p class="hint">已拦截：该引线可能在中途被过度拉长，请勿交给织补师。</p>');
    parts.push(renderLeadTable(res));
    parts.push(renderCellTable(res));
    return parts.join('');
  }

  if (!res.ok) {
    const f = res.firstFailure;
    const n = f.cell.r * state.cols + f.cell.c + 1;
    parts.push(`<div class="banner fail">校核未通过：网格存在${f.type === 'fold' ? '翻折' : '退化'}。</div>`);
    parts.push(`<p class="first-failure">首项失败证据：单元 (${f.cell.r},${f.cell.c})（行优先第 ${n} 个单元），`
      + `角点 ${CORNER_NAMES[f.corner]}，J = ${f.jacobian}，判定：${FAILURE_TYPE_NAMES[f.type]}。</p>`);
    parts.push('<p class="hint">已拦截：未输出纹样换算位置，以免失真坐标误导织补。</p>');
    parts.push(renderCellTable(res));
    return parts.join('');
  }

  const m = res.minJacobian;
  parts.push('<div class="banner ok">校核通过：全网连续无翻折、无退化。</div>');
  parts.push(`<p>全网最小雅可比证据：<b>J<sub>min</sub> = ${m.value}</b>，`
    + `位于单元 (${m.cell.r},${m.cell.c}) 角点 ${CORNER_NAMES[m.corner]}。`
    + `双线性函数的最小值必在角点取得，故单元内部任意位置 J ≥ J<sub>min</sub> &gt; 0（连续判定，非采样）。</p>`);
  parts.push(`<p>相邻单元共享边：${res.edges.continuous ? '连续' : '不连续'}`
    + `（共 ${res.edges.edgeCount} 条内部边，两侧共用同一对网结，边上双线性退化为同一线性插值）。</p>`);

  const markerRows = res.markers.map((mk) =>
    `<tr>
      <td>M${mk.index + 1}</td>
      <td>(${fmt(mk.u)}, ${fmt(mk.v)})</td>
      <td>单元 (${mk.cell.r},${mk.cell.c})，s=${fmt(mk.s)}，t=${fmt(mk.t)}</td>
      <td><b>(${fmt(mk.x)}, ${fmt(mk.y)})</b></td>
    </tr>`).join('');
  parts.push(`<table>
    <thead><tr><th>标记</th><th>原网坐标 (u, v)</th><th>所在单元 / 局部坐标</th><th>织补坐标 (x, y)</th></tr></thead>
    <tbody>${markerRows}</tbody>
  </table>`);

  if (Array.isArray(res.leads)) {
    parts.push('<div class="banner ok lead-ok">纹样引线伸缩校核通过：全部引线实际倍率均在允许区间内（逐片段二次曲线闭式弧长汇总）。</div>');
    parts.push(renderLeadTable(res));
  }
  parts.push(renderCellTable(res));
  return parts.join('');
}

/* ---------------- 画布 ---------------- */

const COLORS = {
  original: '#9aa4b2',
  edge: '#2f4b7c',
  knot: '#1565c0',
  knotFill: '#ffffff',
  marker: '#6b7280',
  mapped: '#d32f2f',
  leadOrig: '#8d6e63',
  leadMapped: '#6a1b9a',
  leadFail: '#d32f2f',
  ok: 'rgba(40,160,90,0.16)',
  fail: 'rgba(220,60,60,0.14)',
  failFirst: 'rgba(220,60,60,0.32)',
  plain: 'rgba(80,120,200,0.10)',
};

let view = { scale: 1, ox: 0, oy: 0 };

function computeView() {
  const pts = [{ x: 0, y: 0 }, { x: state.cols, y: state.rows }];
  for (const row of state.knots) {
    for (const k of row) if (finite(k)) pts.push(k);
  }
  for (const m of state.markers) {
    if (Number.isFinite(m.u) && Number.isFinite(m.v)) pts.push({ x: m.u, y: m.v });
  }
  // 引线织补曲线（含二次贝塞尔控制点）也纳入取景范围
  const leadRes = state.fresh && state.result && Array.isArray(state.result.leads) ? state.result.leads : null;
  if (leadRes) {
    for (const lr of leadRes) {
      for (const s of lr.segments) {
        const { q0, qh, q1 } = s.mapped;
        pts.push(q0, q1, { x: 2 * qh.x - (q0.x + q1.x) / 2, y: 2 * qh.y - (q0.y + q1.y) / 2 });
      }
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const pad = 60;
  const W = canvas.width, H = canvas.height;
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  const scale = Math.min((W - 2 * pad) / w, (H - 2 * pad) / h);
  view = {
    scale,
    ox: pad + ((W - 2 * pad) - w * scale) / 2 - minX * scale,
    oy: pad + ((H - 2 * pad) - h * scale) / 2 - minY * scale,
  };
}

const toPx = (x, y) => [view.ox + x * view.scale, view.oy + y * view.scale];
const toGrid = (px, py) => [(px - view.ox) / view.scale, (py - view.oy) / view.scale];
const finite = (p) => Number.isFinite(p.x) && Number.isFinite(p.y);

function line(x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function cellCornersOf(r, c) {
  return [state.knots[r][c], state.knots[r][c + 1], state.knots[r + 1][c + 1], state.knots[r + 1][c]];
}

function cellStatus(res, r, c) {
  if (!res || res.stage !== 'geometry') return 'plain';
  const cell = res.cells[r * state.cols + c];
  if (!cell) return 'plain';
  if (cell.ok) return 'ok';
  const f = res.firstFailure;
  return f && f.cell.r === r && f.cell.c === c ? 'failFirst' : 'fail';
}

function draw() {
  computeView();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 1;
  drawOriginalGrid();
  drawCells();
  drawMarkers();
  drawLeads();
  drawKnots();
}

function drawOriginalGrid() {
  ctx.save();
  ctx.strokeStyle = COLORS.original;
  ctx.setLineDash([5, 4]);
  for (let j = 0; j <= state.cols; j++) line(...toPx(j, 0), ...toPx(j, state.rows));
  for (let i = 0; i <= state.rows; i++) line(...toPx(0, i), ...toPx(state.cols, i));
  ctx.restore();
}

function drawCells() {
  const res = state.fresh ? state.result : null;
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cs = cellCornersOf(r, c);
      if (!cs.every(finite)) continue;
      const status = cellStatus(res, r, c);
      ctx.beginPath();
      cs.forEach((p, k) => {
        const [px, py] = toPx(p.x, p.y);
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = COLORS[status];
      ctx.fill();
      ctx.strokeStyle = COLORS.edge;
      ctx.lineWidth = status === 'failFirst' ? 2.5 : 1.2;
      ctx.stroke();
    }
  }
  ctx.lineWidth = 1;

  // 首项失败角点证据
  if (res && res.stage === 'geometry' && res.firstFailure) {
    const f = res.firstFailure;
    const p = cellCornersOf(f.cell.r, f.cell.c)[f.corner];
    if (finite(p)) {
      const [px, py] = toPx(p.x, p.y);
      ctx.beginPath();
      ctx.arc(px, py, 11, 0, Math.PI * 2);
      ctx.strokeStyle = COLORS.mapped;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = COLORS.mapped;
      ctx.font = '12px system-ui';
      ctx.fillText(`首项失败 J=${f.jacobian}`, px + 14, py - 10);
    }
  }
}

function drawKnots() {
  ctx.font = '10px system-ui';
  for (let i = 0; i <= state.rows; i++) {
    for (let j = 0; j <= state.cols; j++) {
      const k = state.knots[i][j];
      if (!finite(k)) continue;
      const [px, py] = toPx(k.x, k.y);
      ctx.beginPath();
      ctx.rect(px - 5, py - 5, 10, 10);
      ctx.fillStyle = COLORS.knotFill;
      ctx.fill();
      ctx.strokeStyle = COLORS.knot;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = '#374151';
      ctx.fillText(`(${k.x},${k.y})`, px + 8, py + 14);
    }
  }
}

function drawMarkers() {
  const res = state.fresh ? state.result : null;
  const mapped = res && res.ok && res.markers ? res.markers : null;
  ctx.font = '11px system-ui';
  state.markers.forEach((m, idx) => {
    if (!Number.isFinite(m.u) || !Number.isFinite(m.v)) return;
    const [px, py] = toPx(m.u, m.v);
    ctx.beginPath();
    ctx.moveTo(px, py - 6);
    ctx.lineTo(px + 6, py);
    ctx.lineTo(px, py + 6);
    ctx.lineTo(px - 6, py);
    ctx.closePath();
    ctx.strokeStyle = COLORS.marker;
    ctx.stroke();
    ctx.fillStyle = COLORS.marker;
    ctx.fillText(`M${idx + 1}`, px + 9, py - 7);
    const mp = mapped && mapped[idx];
    if (mp) {
      const [qx, qy] = toPx(mp.x, mp.y);
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = COLORS.mapped;
      line(px, py, qx, qy);
      ctx.restore();
      ctx.beginPath();
      ctx.arc(qx, qy, 5, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.mapped;
      ctx.fill();
      ctx.fillText(`M${idx + 1}'`, qx + 9, qy + 14);
    }
  });
}

/* ---------------- 纹样引线 ---------------- */

function drawLeads() {
  if (state.leads.length === 0) return;
  const res = state.fresh ? state.result : null;
  // 几何阶段失败时 res.leads 为 undefined，不绘制；leads 阶段失败时仍绘制（含证据曲线）
  const leadResults = res && Array.isArray(res.leads) ? res.leads : null;

  state.leads.forEach((ld, idx) => {
    const a = state.markers[ld.from];
    const b = state.markers[ld.to];
    if (!a || !b || !Number.isFinite(a.u) || !Number.isFinite(b.u)) return;

    // 原网直线（原网坐标空间）
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = COLORS.leadOrig;
    ctx.lineWidth = 1.2;
    line(...toPx(a.u, a.v), ...toPx(b.u, b.v));
    ctx.restore();

    // 织补后曲线：逐片段为精确二次曲线，用二次贝塞尔绘制
    const lr = leadResults && leadResults[idx];
    if (lr) {
      const failed = res.leadFailure && res.leadFailure.index === idx;
      ctx.save();
      ctx.strokeStyle = failed ? COLORS.leadFail : COLORS.leadMapped;
      ctx.lineWidth = failed ? 2.6 : 2;
      ctx.beginPath();
      lr.segments.forEach((s, si) => {
        const { q0, qh, q1 } = s.mapped;
        // 二次贝塞尔控制点 P 满足其 z=1/2 点 = qh：P = 2qh − (q0+q1)/2
        const pcx = 2 * qh.x - (q0.x + q1.x) / 2;
        const pcy = 2 * qh.y - (q0.y + q1.y) / 2;
        const [x0, y0] = toPx(q0.x, q0.y);
        const [cx, cy] = toPx(pcx, pcy);
        const [x1, y1] = toPx(q1.x, q1.y);
        if (si === 0) ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(cx, cy, x1, y1);
      });
      ctx.stroke();
      ctx.restore();
    }
  });
}

/* ---------------- 网结拖动 ---------------- */

let dragKnot = null;

function eventGrid(e) {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas.width / rect.width);
  const py = (e.clientY - rect.top) * (canvas.height / rect.height);
  return toGrid(px, py);
}

canvas.addEventListener('pointerdown', (e) => {
  const [gx, gy] = eventGrid(e);
  const tol = 14 / view.scale;
  let best = null;
  let bestD = tol;
  for (let i = 0; i <= state.rows; i++) {
    for (let j = 0; j <= state.cols; j++) {
      const k = state.knots[i][j];
      if (!finite(k)) continue;
      const d = Math.hypot(k.x - gx, k.y - gy);
      if (d <= bestD) { bestD = d; best = { i, j }; }
    }
  }
  if (best) {
    dragKnot = best;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragKnot) return;
  const [gx, gy] = eventGrid(e);
  state.knots[dragKnot.i][dragKnot.j] = { x: Math.round(gx), y: Math.round(gy) };
  syncKnotInputs(dragKnot.i, dragKnot.j);
  invalidate();
});

const endDrag = () => { dragKnot = null; canvas.style.cursor = ''; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

/* ---------------- 初始化 ---------------- */

buildKnotFields();
buildMarkerFields();
buildLeadFields();
renderResults();
draw();
