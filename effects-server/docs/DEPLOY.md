# 部署说明（给其他 bot / 维护者）

效果页成功标准：**马身计算只在后端**；前端只拉 JSON 展示 Top 50。

## 本地（本仓库）

```bash
cd effects-server/ (+ Pages `effects/`)server
node index.js
# http://127.0.0.1:8787/effects/
# http://127.0.0.1:8787/api/effects/courses
# http://127.0.0.1:8787/api/effects/rank?course=11101&style=0&limit=50
```

环境变量：

| 变量 | 默认 | 含义 |
|---|---|---|
| `PORT` | `8787` | 监听端口 |
| `HOST` | `127.0.0.1` | 绑定地址 |
| `EFFECTS_DB` | `../data/effects_db.json` | 赛道/马娘/技能库 |

刷新数据：

```bash
python3 scripts/sync_effects_db.py
# 从 https://614tools.top/skillselect/ 抽 planner-data，并合并 UST 固有技能
```

预计算（可丢静态托管或 Worker KV）：

```bash
node server/precompute.js
# → data/rankings/{courseId}_s{style}_inherent.json
```

## 接到 api.614tools.top（uma-breeding-jobs Worker）

现有 Worker 根响应：

```json
{"ok":true,"service":"uma-breeding-jobs","endpoints":["GET /api/jobs", ...]}
```

建议新增（与本服务同契约，便于前端零改）：

1. `GET /api/effects/courses` → 同 `server/index.js` 的 `listCourses()`
2. `GET /api/effects/rank?course=&style=&limit=&mode=` → 调用 `rankCourse()` 或读预计算 JSON
3. 把 `server/bashin.js` + `data/effects_db.json` 打进 Worker（或 R2/KV）
4. **禁止**把 `bashin.js` 打进 Pages 前端 bundle

可选两阶段：

- **Phase A（快）**：CI 跑 `precompute.js`，把 `data/rankings/**` 上传 R2；Worker 只做文件映射。
- **Phase B（准）**：Worker / 独立 Node 跑 UST `RaceSolver`（GPL-3.0，注意许可证声明，与 skillselect 页脚一致）。

## Pages（614tools.top/effects/）

1. 将 ``effects/**`` 发到 Pages 仓库 `effects/` 目录（与 `skillselect/` 并列）。
2. 前端 `app.js` 默认在非 8787 时请求 `https://api.614tools.top`；也可用 `?api=https://...` 覆盖。
3. 在首页 `index.html` 加一张卡片链到 `./effects/`。
4. **发布前**与 skillselect 一样：先把 diff 给仓库所有者确认。

## 目录职责

```
effects-server/ (+ Pages `effects/`)
  data/effects_db.json     # 后端只读库
  data/rankings/           # 可选预计算
  server/bashin.js         # 评分（不可上前端）
  server/index.js          # HTTP API + 静态 demo
  public/effects/          # 展示页（只 fetch）
  scripts/sync_effects_db.py
  docs/FORMULA.md
  docs/DEPLOY.md
```
