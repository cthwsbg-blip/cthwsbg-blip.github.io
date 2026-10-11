#!/usr/bin/env python3
"""Refresh data/effects_db.json from live skillselect planner-data + UST unique skills."""
from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "effects_db.json"
SKILLSELECT = "https://614tools.top/skillselect/"
UST_SKILLS = "https://raw.githubusercontent.com/alpha123/uma-skill-tools/master/data/skill_data.json"
UST_NAMES = "https://raw.githubusercontent.com/alpha123/uma-skill-tools/master/data/skillnames.json"

TYPE_MAP = {
    1: "速度", 2: "耐力", 3: "力量", 4: "根性", 5: "智力",
    9: "耐力回复(占最大体力比例)",
    21: "当前速度", 22: "当前速度(推测)",
    27: "目标速度", 31: "加速度",
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "614tools-effects-sync/0.1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def ust_to_planner_skill(sid: str, raw: dict, name_entry) -> dict:
    if isinstance(name_entry, list):
        n = name_entry[0] or (name_entry[1] if len(name_entry) > 1 else "")
    else:
        n = name_entry or sid
    effects = []
    for alt in raw.get("alternatives") or []:
        cond = alt.get("condition") or ""
        pre = alt.get("precondition") or None
        dur = alt.get("baseDuration")
        duration = (dur / 10000.0) if isinstance(dur, (int, float)) and dur else None
        rows = []
        for ef in alt.get("effects") or []:
            t = TYPE_MAP.get(ef.get("type"))
            if not t:
                continue
            mod = ef.get("modifier") or 0
            typ = ef.get("type")
            if typ in (1, 2, 3, 4, 5):
                val = mod
            elif typ == 9:
                val = mod / 100.0
            else:
                val = mod / 10000.0
            target = ef.get("target") or 0
            is_debuff = 1 if (val < 0 or target not in (0, 1)) else 0
            rows.append([t, val, 0, is_debuff])
        if rows:
            effects.append([pre, cond, duration, 500, rows])
    cls = "other"
    for *_rest, rows in ((e[0], e[1], e[2], e[3], e[4]) for e in effects):
        for r in rows:
            if r[0] in ("目标速度", "当前速度") or str(r[0]).startswith("当前速度"):
                cls = "speed"
                break
            if r[0] == "加速度":
                cls = "accel"
                break
            if "回复" in str(r[0]):
                cls = "heal"
        if cls != "other":
            break
    if not effects:
        cls = "passive"
    return {
        "id": int(sid) if sid.isdigit() else sid,
        "n": n or sid,
        "r": 5,
        "c": cls,
        "spd": 0,
        "e": effects,
        "sc": [],
        "neg": 0,
        "db": 0,
        "source": "ust-unique",
    }


def main() -> None:
    html = fetch(SKILLSELECT).decode("utf-8", "replace")
    m = re.search(r'<script type="application/json" id="planner-data">(.*?)</script>', html, re.S)
    if not m:
        raise SystemExit("planner-data not found on skillselect page")
    planner = json.loads(m.group(1).replace("\\u003c", "<"))
    ust = json.loads(fetch(UST_SKILLS).decode())
    names = json.loads(fetch(UST_NAMES).decode())

    tracks = {
        t["id"]: {"id": t["id"], "ja": t.get("ja"), "zh": t.get("zh")}
        for t in planner["tracks"]
    }
    courses = []
    for c in planner["courses"]:
        tr = tracks.get(c["track"], {})
        courses.append(
            {
                "id": c["id"],
                "track": c["track"],
                "trackZh": tr.get("zh") or tr.get("ja") or str(c["track"]),
                "trackJa": tr.get("ja") or "",
                "distance": c["distance"],
                "ground": c["ground"],
                "inout": c["inout"],
                "inoutLabel": c.get("inoutLabel") or "",
                "turn": c["turn"],
                "turnLabel": c.get("turnLabel") or "",
                "distType": c["distType"],
                "basis": c.get("basis"),
                "dirtgrade": bool(c.get("dirtgrade")),
                "geo": c.get("geo") or {},
            }
        )

    skills = {}
    for s in planner["skills"]:
        skills[str(s["id"])] = {
            "id": s["id"],
            "n": s["n"],
            "r": s["r"],
            "c": s["c"],
            "spd": s.get("spd") or 0,
            "e": s.get("e") or [],
            "sc": s.get("sc") or [],
            "neg": s.get("neg") or 0,
            "db": s.get("db") or 0,
            "source": "planner",
        }
    for sid, raw in ust.items():
        if raw.get("rarity") != 5 or sid in skills:
            continue
        skills[sid] = ust_to_planner_skill(sid, raw, names.get(sid))

    cards = []
    for c in planner["cards"]:
        chara = int(str(c["id"])[:4])
        uniq = f"1{chara}1"
        cards.append(
            {
                "id": c["id"],
                "t": c.get("t") or "",
                "n": c.get("n") or "",
                "zn": c.get("zn") or "",
                "st": c.get("st"),
                "ap": c.get("ap") or {},
                "i": c.get("i") or "",
                "col": c.get("col") or "",
                "si": list(c.get("si") or []),
                "chara": chara,
                "uniqueId": uniq if uniq in skills else None,
            }
        )

    from datetime import datetime, timezone, timedelta

    now = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="minutes")
    out = {
        "meta": {
            "source": "skillselect planner-data + uma-skill-tools unique (rarity 5)",
            "syncedAt": now,
            "cardCount": len(cards),
            "courseCount": len(courses),
            "skillCount": len(skills),
            "uniqueMapped": sum(1 for c in cards if c["uniqueId"]),
        },
        "tracks": list(tracks.values()),
        "courses": courses,
        "skills": skills,
        "cards": cards,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(out["meta"], ensure_ascii=False, indent=2))
    print("wrote", OUT, "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
