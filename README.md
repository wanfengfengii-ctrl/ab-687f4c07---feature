# 壁毯修复定位网校核

浏览器中建立 2–4 行 × 2–4 列矩形单元的定位网，拖动或录入织补后各网结的整数坐标，
录入 3–12 个原网纹样标记；点击“校核”后，应用把每个单元视为**连续双线性形变**，
将标记换算到织补坐标，并对整张网做**连续不翻折判定**（不以有限采样点替代）。

## 连续判定的数学依据

单元的织补映射为双线性插值 `P(s,t)`，其雅可比行列式 `J(s,t)` 关于 `(s,t)` 是双线性函数。
双线性函数在矩形域上的最小值必在某一角点取得（固定 t 时关于 s 线性，两端关于 t 亦线性），因此：

```
J(s,t) > 0  ∀(s,t)∈[0,1]²   ⇔   四个角点的 J 值均 > 0
```

检查 4 个角点即等价于检查单元内**任意内部位置**，这是严格的连续判定而非采样。
角点 J 值即该角点两条邻边向量的叉积；网结坐标为整数时 J 必为整数，故 `J > 0 ⇔ J ≥ 1`，无数值模糊地带。

- **翻折**：某角点 `J < 0`；**退化**：某角点 `J = 0`。
- 首项失败证据按**行优先单元顺序**与**固定角点顺序**（C0 左上 → C1 右上 → C2 右下 → C3 左下）报告。
- 相邻单元共享边：共享边两侧的双线性映射在边上退化为同一对端点的同一线性插值，
  结构化网格天然共用网结，并由 `checkSharedEdges` 显式核验。
- 只有全网通过时才输出纹样标记的换算位置，避免把失真坐标交给织补师。
- 网结拖动或任何字段修改都会立即使旧结论失效（页面提示重新校核）。

## 运行（Docker Compose）

```bash
# 启动 Web 服务（宿主机端口可配置，默认 8080）
WEB_PORT=9000 docker compose up --build web
# 打开 http://localhost:9000

# 一次性验收：代码测试 → 构建 → 健康与校核样例冒烟，以退出码报告结论
docker compose up --build --exit-code-from verify
echo $?   # 0 = 验收通过
```

- Web 服务健康检查：`GET /healthz`（Compose healthcheck 与 Dockerfile HEALTHCHECK 均使用）。
- 校核 API：`POST /api/verify`，请求体 `{rows, cols, knots, markers}`，
  与浏览器页面共用同一数学模块 `src/shared/bilinear.js`。

## 本地开发（Node ≥ 20，无第三方依赖）

```bash
npm test          # 单元测试（node:test）
npm run build     # 构建 dist/（含恒等网格自检）
npm start         # 构建并启动服务（PORT 环境变量可改端口，默认 8080）
npm run smoke     # 对运行中的服务做健康 + 校核样例冒烟
```

## 目录结构

```
src/shared/bilinear.js   # 核心数学：双线性映射、连续不翻折判定、标记换算（浏览器/服务端/测试共用）
src/server.js            # 静态服务 + /healthz + /api/verify
src/public/              # 浏览器页面（画布拖动、字段录入、结论展示）
scripts/build.js         # 构建：自检 + 组装 dist/ + SHA-256 清单
scripts/smoke.js         # 冒烟：健康检查 + 恒等/翻折/退化/无效坐标样例
test/                    # node:test 单元测试
Dockerfile               # 单镜像：构建期自检，运行时非 root
docker-compose.yml       # web（健康检查、端口可配）+ verify（一次性验收，退出码报告）
```
