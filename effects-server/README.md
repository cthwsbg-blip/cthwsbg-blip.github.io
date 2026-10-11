# effects-server · 赛道有效马娘（后端）

马身评分 **只在这里（或 api.614tools.top Worker）运行**。Pages 上的 `effects/` 前端只展示 JSON。

## 布局（本仓库）

```
cthwsbg-blip.github.io/
  effects/                 # 静态前端 + 预计算 rankings（Pages 可直接用）
  effects-server/          # Node 评分服务 + docs + sync 脚本
    bashin.js              # 评分公式（勿打进前端 bundle）
    index.js               # GET /api/effects/courses|rank
    data/effects_db.json
    docs/FORMULA.md
    docs/DEPLOY.md
    scripts/sync_effects_db.py
```

## 本地运行

```bash
cd effects-server
node index.js
# http://127.0.0.1:8787/effects/
# http://127.0.0.1:8787/api/effects/rank?course=11101&limit=50
```

刷新数据 / 预计算：

```bash
python3 scripts/sync_effects_db.py   # 需要能访问 614tools.top + GitHub raw
node precompute.js                   # 写出到 ../effects/data/rankings/ 需先改 OUT 或手动复制
```

预计算默认写到 `effects-server/data/rankings/`（ROOT=`__dirname`）。发布到 Pages 时复制到 `effects/data/rankings/`。

## Worker

把 `bashin.js` + `data/effects_db.json` 接到现有 `uma-breeding-jobs`（api.614tools.top）的 `/api/effects/*`。详见 `docs/DEPLOY.md`。在 Worker 上线前，生产站用 `effects/data/rankings/*.json` 静态回退。
