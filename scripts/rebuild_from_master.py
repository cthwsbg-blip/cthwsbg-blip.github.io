#!/usr/bin/env python3
"""Rebuild effects_db.json from Steam JP master.mdb.

Inherent skills per card (matches U-tools card page):
  - unique: skill_set of rarity 5 (固有スキル)
  - evo: skill_upgrade_description (進化スキル)
  - awake: available_skill_set + single_mode_skill_need_point Pt (覚醒スキル)

Courses/geo kept from skillselect planner-data (same uma-skill-tools geometry
skillselect already uses). Skill effect payloads merged from planner + UST.

Authoritative client DB path (documented in data/client/SOURCE_PATHS.txt):
  Steam install: F:\\SteamLibrary\\steamapps\\common\\UmamusumePrettyDerby_Jpn (appid 3564400)
  master.mdb:   C:\\Users\\1\\AppData\\LocalLow\\Cygames\\UmamusumePrettyDerby_Jpn\\master\\master.mdb
"""
from __future__ import annotations

import json
import re
import sqlite3
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "effects_db.json"
PUBLIC_OUT = ROOT / "public" / "effects" / "data" / "effects_db.json"
MDB = Path(
    __import__("os").environ.get(
        "EFFECTS_MASTER_MDB",
        str(ROOT / "data" / "client" / "master.mdb"),
    )
)
SKILLSELECT = "https://614tools.top/skillselect/"
UST_SKILLS = "https://raw.githubusercontent.com/alpha123/uma-skill-tools/master/data/skill_data.json"
UST_NAMES = "https://raw.githubusercontent.com/alpha123/uma-skill-tools/master/data/skillnames.json"
LOCAL_UST_SKILLS = Path("/workspace/uma-skill-tools/data/skill_data.json")
LOCAL_UST_NAMES = Path("/workspace/uma-skill-tools/data/skillnames.json")
LOCAL_COURSE = Path("/workspace/uma-skill-tools/data/course_data.json")

TYPE_MAP = {
    1: "速度",
    2: "耐力",
    3: "力量",
    4: "根性",
    5: "智力",
    9: "耐力回复(占最大体力比例)",
    21: "当前速度",
    22: "当前速度(推测)",
    27: "目标速度",
    31: "加速度",
}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "614tools-effects-rebuild/0.2"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


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
    for e in effects:
        for r in e[4]:
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
        "id": int(sid) if str(sid).isdigit() else sid,
        "n": n or sid,
        "r": int(raw.get("rarity") or 0),
        "c": cls,
        "spd": 0,
        "e": effects,
        "sc": [],
        "neg": 0,
        "db": 0,
        "source": "ust",
    }


def skill_set_ids(row: sqlite3.Row) -> list[int]:
    out = []
    for i in range(1, 21):
        key = f"skill_id{i}"
        if key not in row.keys():
            continue
        sid = row[f"skill_id{i}"]
        if sid:
            out.append(int(sid))
    return out


def text_name(con: sqlite3.Connection, skill_id: int, cache: dict) -> str:
    if skill_id in cache:
        return cache[skill_id]
    r = con.execute(
        'SELECT text FROM text_data WHERE category=47 AND "index"=?', (skill_id,)
    ).fetchone()
    name = r[0] if r else str(skill_id)
    cache[skill_id] = name
    return name


def main() -> None:
    if not MDB.exists():
        raise SystemExit(f"master.mdb not found: {MDB}")

    # planner for courses + zh names/icons
    html = fetch(SKILLSELECT).decode("utf-8", "replace")
    m = re.search(
        r'<script type="application/json" id="planner-data">(.*?)</script>', html, re.S
    )
    if not m:
        raise SystemExit("planner-data not found on skillselect page")
    planner = json.loads(m.group(1).replace("\\u003c", "<"))

    if LOCAL_UST_SKILLS.exists():
        ust = load_json(LOCAL_UST_SKILLS)
        names = load_json(LOCAL_UST_NAMES)
    else:
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
                "inout": c.get("inout"),
                "inoutLabel": c.get("inoutLabel") or "",
                "turn": c["turn"],
                "turnLabel": c.get("turnLabel") or "",
                "distType": c["distType"],
                "basis": c.get("basis"),
                "dirtgrade": bool(c.get("dirtgrade")),
                "geo": c.get("geo") or {},
            }
        )

    # Enrich geo from local UST course_data if planner geo empty
    if LOCAL_COURSE.exists():
        cd = load_json(LOCAL_COURSE)
        for c in courses:
            geo = c.get("geo") or {}
            if geo.get("corners") or geo.get("straights") or geo.get("slopes"):
                continue
            raw = cd.get(str(c["id"]))
            if not raw:
                continue
            c["geo"] = {
                "corners": [[x["start"], x["length"]] for x in raw.get("corners") or []],
                "straights": [
                    [x["start"], x["end"], x.get("frontType", 0)]
                    for x in raw.get("straights") or []
                ],
                "slopes": [
                    [x["start"], x["length"], x.get("slope", x.get("grade", 0))]
                    for x in raw.get("slopes") or []
                ],
            }

    skills: dict[str, dict] = {}
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
        if sid in skills:
            continue
        skills[sid] = ust_to_planner_skill(sid, raw, names.get(sid))

    planner_cards = {int(c["id"]): c for c in planner["cards"]}

    con = sqlite3.connect(str(MDB))
    con.row_factory = sqlite3.Row
    cur = con.cursor()

    # Pt map
    pt_map = {
        int(r["id"]): int(r["need_skill_point"])
        for r in cur.execute("SELECT id, need_skill_point FROM single_mode_skill_need_point")
    }

    cards = []
    name_cache: dict = {}
    card_rows = list(cur.execute("SELECT * FROM card_data ORDER BY id"))
    for row in card_rows:
        cid = int(row["id"])
        chara = int(row["chara_id"])
        pc = planner_cards.get(cid, {})

        # unique from rarity-5 skill_set
        rr = cur.execute(
            "SELECT * FROM card_rarity_data WHERE card_id=? AND rarity=5", (cid,)
        ).fetchone()
        unique_ids = []
        if rr is not None:
            ss = cur.execute(
                "SELECT * FROM skill_set WHERE id=?", (rr["skill_set"],)
            ).fetchone()
            unique_ids = skill_set_ids(ss) if ss is not None else []
        unique_id = unique_ids[0] if unique_ids else None

        # awakening (+ initial need_rank 0)
        awake_rows = list(cur.execute(
            "SELECT skill_id, need_rank FROM available_skill_set "
            "WHERE available_skill_set_id=? ORDER BY need_rank, skill_id",
            (row["available_skill_set_id"],),
        ))
        awake = []
        for a in awake_rows:
            sid = int(a["skill_id"])
            awake.append(
                {
                    "id": sid,
                    "rank": int(a["need_rank"]),
                    "pt": pt_map.get(sid),
                    "name": text_name(con, sid, name_cache),
                }
            )

        # evolution
        evo_rows = list(cur.execute(
            "SELECT skill_id, rank FROM skill_upgrade_description "
            "WHERE card_id=? ORDER BY rank, skill_id",
            (cid,),
        ))
        evo = []
        for e in evo_rows:
            sid = int(e["skill_id"])
            evo.append({"id": sid, "rank": int(e["rank"]), "name": text_name(con, sid, name_cache)})
            # ensure skill payload exists
            if str(sid) not in skills and str(sid) in ust:
                skills[str(sid)] = ust_to_planner_skill(
                    str(sid), ust[str(sid)], names.get(str(sid))
                )

        # ensure unique in skills
        if unique_id is not None and str(unique_id) not in skills and str(unique_id) in ust:
            skills[str(unique_id)] = ust_to_planner_skill(
                str(unique_id), ust[str(unique_id)], names.get(str(unique_id))
            )

        # si = need_rank 0 awake (初期所持), keep for compatibility
        si = [a["id"] for a in awake if a["rank"] == 0]
        if not si and pc.get("si"):
            si = list(pc.get("si") or [])

        cards.append(
            {
                "id": cid,
                "t": pc.get("t") or "",
                "n": pc.get("n") or text_name(cur, chara) if False else (pc.get("n") or ""),
                "zn": pc.get("zn") or "",
                "st": pc.get("st") or row["running_style"],
                "ap": pc.get("ap") or {},
                "i": pc.get("i") or "",
                "col": pc.get("col") or "",
                "chara": chara,
                "uniqueId": unique_id,
                "uniqueIds": unique_ids,
                "si": si,
                "evo": evo,
                "awake": awake,
                # flat list used by ranking: unique + evo + all awake
                "inherent": (
                    ([unique_id] if unique_id else [])
                    + [e["id"] for e in evo]
                    + [a["id"] for a in awake]
                ),
            }
        )
        # fill JP name from text_data chara if missing
        if not cards[-1]["n"]:
            r = con.execute(
                'SELECT text FROM text_data WHERE category=6 AND "index"=?', (chara,)
            ).fetchone()
            if r:
                cards[-1]["n"] = r[0]

    con.close()

    # dedupe inherent ids per card
    for c in cards:
        seen = set()
        inherent = []
        for sid in c["inherent"]:
            if sid is None or sid in seen:
                continue
            seen.add(sid)
            inherent.append(sid)
        c["inherent"] = inherent

    now = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="minutes")
    out = {
        "meta": {
            "source": "Steam JP master.mdb + skillselect planner (courses/zh) + uma-skill-tools skills",
            "masterMdb": str(MDB),
            "clientPaths": {
                "steamInstall": r"F:\SteamLibrary\steamapps\common\UmamusumePrettyDerby_Jpn",
                "steamAppId": 3564400,
                "masterMdbRuntime": r"C:\Users\1\AppData\LocalLow\Cygames\UmamusumePrettyDerby_Jpn\master\master.mdb",
            },
            "inherentDefinition": "unique(skill_set r5) + evolution(skill_upgrade_description) + awakening(available_skill_set incl. Pt)",
            "syncedAt": now,
            "cardCount": len(cards),
            "courseCount": len(courses),
            "skillCount": len(skills),
            "uniqueMapped": sum(1 for c in cards if c["uniqueId"]),
            "evoMapped": sum(1 for c in cards if c["evo"]),
            "awakeMapped": sum(1 for c in cards if c["awake"]),
        },
        "tracks": list(tracks.values()),
        "courses": courses,
        "skills": skills,
        "cards": cards,
    }
    payload = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(payload, encoding="utf-8")
    PUBLIC_OUT.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_OUT.write_text(payload, encoding="utf-8")
    print(json.dumps(out["meta"], ensure_ascii=False, indent=2))
    # sanity: 100401
    c = next(x for x in cards if x["id"] == 100401)
    print(
        "card 100401 unique",
        c["uniqueId"],
        "evo",
        [e["name"] for e in c["evo"]],
        "awake",
        [(a["name"], a["pt"], a["rank"]) for a in c["awake"]],
        "inherent count",
        len(c["inherent"]),
    )
    print("wrote", OUT, "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
