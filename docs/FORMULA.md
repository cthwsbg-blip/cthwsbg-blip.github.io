# 马身公式说明（RaceSolver）

## 金标准：uma-skill-tools RaceSolver

与站点 `/skill/` 技能模拟器、U-tools 同属物理积分栈。对同一赛道、同一面板跑两次（有自身携带技能 / 无技能）：

```
bashin = mean_i( (pos_with_i - pos_without_i) / 2.5 )
```

默认面板：速2200 / 耐1600 / 力1700 / 根1200 / 智1800，干劲绝好调，适性 A，多样本（默认 12）。

## 自身携带技能（对齐 U-tools 卡页）

| 类别 | 来源表 | 例（丸善斯基 100401） |
|---|---|---|
| 固有 | `card_rarity_data`→`skill_set`（稀有度5） | 紅焔ギア/LP1211-M |
| 进化 | `skill_upgrade_description` | かっ飛ばすわよ！ / 紅蓮のオーバーレブ / レッドゾーンを突き抜けて |
| 觉醒 | `available_skill_set` + `single_mode_skill_need_point`（Pt） | 直線巧者 170Pt 等 |

重建：`python3 scripts/rebuild_from_master.py`

## 数据源（Steam 日服）

见 `data/client/SOURCE_PATHS.txt`：

- 安装：`F:\SteamLibrary\steamapps\common\UmamusumePrettyDerby_Jpn`（appid **3564400**）
- 权威 DB：`C:\Users\1\AppData\LocalLow\Cygames\UmamusumePrettyDerby_Jpn\master\master.mdb`
- 本仓库副本：`data/client/master.mdb`

赛道几何：skillselect planner / uma-skill-tools `course_data.json`（与 `/skillselect` 同一套）。

## 后端 API

- `GET /api/effects/rank?course=&style=&limit=&nsamples=` → 默认 **UST RaceSolver**
- `?engine=approx` → 旧 approx-v1（仅调试）
- 浏览器不跑评分；结果可缓存于 `data/rankings_ust/`

## 赛道图

effects 页复用 skillselect 的 phase / 弯道 / 直线 / 坡道层（CSS+DOM 结构一致）。
