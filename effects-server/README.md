# 614tools · 赛道有效马娘（Effects）Demo

按赛道计算每名马娘 **自身携带技能** 的马身收益，展示 **Top 50**。

## 自身携带技能（对齐 U-tools 卡页）

固有（`skill_set`）+ 进化（`skill_upgrade_description`）+ 觉醒（`available_skill_set`，含 Pt）。

数据从 Steam 日服 `master.mdb` 重建：`python3 scripts/rebuild_from_master.py`

权威路径见 `data/client/SOURCE_PATHS.txt`：
`C:\Users\1\AppData\LocalLow\Cygames\UmamusumePrettyDerby_Jpn\master\master.mdb`

## 马身

后端 **uma-skill-tools RaceSolver**（与 `/skill/` 同源）：`(pos_with - pos_without) / 2.5` 多样本均值。  
`?engine=approx` 可回退旧近似（仅调试）。

## 赛道图

复用 `/skillselect` 的序盘/中盘/终盘/最后阶段 + 弯道/直线/坡道层。

## 本地

```bash
cd server && node index.js
# http://127.0.0.1:8787/effects/
```

## 分支

改动只推 `effects-demo`，**不要合并 main / 不要上线 614tools.top**，等核实后再发。
