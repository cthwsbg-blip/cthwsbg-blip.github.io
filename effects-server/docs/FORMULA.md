# 马身公式说明（approx-v1 vs U-tools）

## U-tools / uma-skill-tools（金标准）

`tools/gain.ts` / `basinnhyou.ts` 用 `RaceSolver` 对同一赛道、同一马跑两次（有/无技能），取

```
bashin = (pos_with - pos_without) / 2.5
```

再对随机发动点做 N 次采样，报告 min / max / median / mean。

这是全量物理积分，考虑体力、位置保持、加速度爬升、发动区间采样等。

## 本仓库 approx-v1（后端近似）

目标：用 **客户端已抽出的** skillselect `planner-data`（赛道 geo / 条件 / `si`）+ UST 固有技能表，在 Cloudflare Worker / 小 Node 服务上快速排出 Top 50，供效果页展示。

### 计入的技能

| 模式 | 内容 |
|---|---|
| `inherent`（默认） | 固有（`1{charaId}1`，UST rarity 5，若有）+ 初期所持 `si` |
| `si` | 仅 `si` |
| `unique` | 仅固有 |

### 条件处理

- **静态可判定**：`distance_type` / `ground_type` / `rotation` / `track_id` / `running_style`（有跑法筛选时）——不满足则该效果计 0。
- **动态 / 随机**：`phase_*_random`、`order*`、`bashin_diff*` 等——视为可满足，乘期望系数（随机约 ×0.55，名次约 ×0.85）。
- 未解析原子：保守折扣，不直接否决。

### 效果 → 马身

参考速度 `REF_SPEED = 20 m/s`，`1 馬身 = 2.5 m`（与 UST 相同）。

| 效果 | 近似 |
|---|---|
| 目标速度 `v`，持续 `t` 秒 | `(v * t * REF_SPEED) / 2.5` |
| 当前速度 | 同上 ×0.85 |
| 加速度 `a` | `(a * t * REF_SPEED * 0.4) / 2.5` |
| 被动「速度」40/60/80 | 折成约 0.05/0.075/0.1 的目标速度，再按短持续估算 |
| 回体 / 视野等 | 几乎不计（微量） |
| 对他人减速 debuff | 按绝对值的 30% 计入干扰价值 |

多段效果求和；角色总分为各自身技能之和。跑法筛选为「全部」时，对 0–4 跑法各算一遍取最高。

最后乘以 `CALIBRATION = 0.38`，把近似量级拉近 U-tools 固有技能常见的 3–6 马身区间（非回归拟合，仅展示用）。

`season` / `weather` / `ground_condition` 等未在请求中给出的环境条件：**默认不生效**（避免春ウマ娘○ 等污染泥地排行）。

### 与 U-tools 的主要差异（务必对外说明）

1. **无逐步积分**：不管体力耗尽、位置保持、加速未满等，数值会偏高或偏低。
2. **随机发动**用固定期望，不是 N 次采样分布（没有 min/max/median）。
3. **固有技能**来自 UST `skill_data.json`；比当前日服新的卡可能缺固有（仅剩 `si`）。
4. **校准**：未对 UST mean 做逐技能回归；相对排序在同赛道内通常可用，绝对值不要当「真实马身」。
5. 若要上生产级精度：Worker 侧改为调用 / 嵌入 `RaceSolver`（或离线 `precompute.js` + UST `gain.ts` 批出 JSON）。

### 版本

- `formula: "approx-v1"` —— 出现在 `/api/effects/rank` 响应里。
