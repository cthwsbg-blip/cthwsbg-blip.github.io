# 614tools · 赛道有效马娘（Effects）

按赛道计算每名马娘 **自身携带技能** 的马身收益，展示 **Top 50**。

## 成功标准

- 选赛道 → 看该赛道 Top 50（高→低）
- 评分用固有 + 初期所持（`si`），数据来自 skillselect 抽出物 + UST 固有表
- **马身计算在后端**；前端只展示 API 结果
- 跑法筛选可 refinement
- 公式与 U-tools 差异见 `docs/FORMULA.md`
- 部署见 `docs/DEPLOY.md`

## 快速开始

```bash
cd server && node index.js
# 打开 http://127.0.0.1:8787/effects/
```

## API

- `GET /api/effects/courses`
- `GET /api/effects/rank?course=11101&style=0&limit=50&mode=inherent`
