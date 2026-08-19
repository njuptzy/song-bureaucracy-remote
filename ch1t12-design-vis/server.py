#!/usr/bin/env python3
"""宋代职官设计稿可视化：数据服务、修订工作区与 dist 静态托管。

用法:
    python3 server.py [--port 8650] [--entries-db PATH] [--dict-db PATH]

接口:
    GET /data/song-bureaucracy-core.json  返回首屏结构数据
    GET /api/details/entity/{id}          按机构或官职返回原文与引文
    GET /api/details/relation/{id}        按关系返回其构建来源词条原文
    GET /api/data                         兼容旧客户端的完整 JSON
    GET /           dist/index.html（需先 pnpm build）
"""

import argparse
import json
import re
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO_ROOT / "vis/backend"))

from normalize_times import (  # noqa: E402
    ERA_YEARS,
    REFERENCE_SOURCES,
    SONG_EMPEROR_REIGNS,
    normalize_time,
)
from institution_categories import (  # noqa: E402
    INSTITUTION_GROUP_NAMES,
    classify_institution,
    classify_institution_group,
    resolve_source_catalogs,
    resolve_source_order,
)
from revision_store import RevisionError, RevisionStore  # noqa: E402
ENTRIES_DB = REPO_ROOT / "data/database/song_bureaucracy_entries_ch1t12.db"
DICT_DB = REPO_ROOT / "data/database/song_bureaucracy_dictionary_ch1t12.db"
DICT_TABLE = "chapter1t12"
DIST_DIR = HERE / "dist"
DESIGN_DIR = REPO_ROOT / "vis/宋代职官体系可视化打包文件 /svg格式"
DESIGN_HIERARCHY_SVG = DESIGN_DIR / "宋代职官体系可视化界面_画板 1 副本 4-01.svg"
DESIGN_COMPOSITION_SVG = DESIGN_DIR / "宋代职官体系可视化界面_画板 1 副本 4-02.svg"
DESIGN_TIMELINE_SVG = (
    REPO_ROOT
    / "vis/宋代职官体系可视化打包文件 /svg格式/宋代职官体系可视化界面字体转曲_画板 1 副本 4-01.svg"
)
DESIGN_FZQING_FONT = REPO_ROOT / "vis/宋代职官体系可视化打包文件 /字体/FZQingKBYSJW-M.TTF"
DESIGN_ADOBE_SONG_FONT = REPO_ROOT / "vis/宋代职官体系可视化打包文件 /字体/AdobeSongStd-Light.otf"

SUMMARY_LEN = 400
SECTION_LEN = 300
CHANGE_RELATION_OPTIONAL_COLUMNS = (
    "relation_subtype",
    "change_event_id",
    "relation_group_id",
    "relation_scope",
)
# 数据库文件没有变化时，前端仍可能命中旧的 immutable 首屏缓存。
# 每次改变首屏数据契约时递增此版本，确保新字段立即进入浏览器。
PAYLOAD_SCHEMA_VERSION = "20260819-full-dictionary-sections-v1"

_cache = {}
_cache_lock = threading.Lock()
_revision_store = None


def _database_fingerprint() -> str:
    parts = [PAYLOAD_SCHEMA_VERSION]
    for path in (ENTRIES_DB, DICT_DB):
        for candidate in (path, Path(f"{path}-wal")):
            try:
                stat = candidate.stat()
                # mtime 和文件大小可能在同尺寸数据库替换、原位更新后保持不变；
                # ctime 与 inode 一并进入指纹，避免实时服务继续发送旧 payload。
                parts.append(
                    f"{candidate.name}:{stat.st_ino}:{stat.st_mtime_ns}:"
                    f"{stat.st_ctime_ns}:{stat.st_size}"
                )
            except FileNotFoundError:
                parts.append(f"{candidate.name}:missing")
    return "|".join(parts)


def _connect(path: Path) -> sqlite3.Connection:
    if not path.exists():
        sys.exit(f"数据库不存在: {path}")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _dict_section(fields: dict, keys, *, limit: int | None = SECTION_LEN) -> str:
    for k in keys:
        v = fields.get(k)
        if isinstance(v, str) and v.strip():
            value = v.strip()
            return value if limit is None else value[:limit]
    return ""


def _normalized_time_payload(raw_time: str) -> dict:
    normalized = normalize_time(raw_time or "")
    return {
        "raw_time": raw_time or "",
        "year_start": normalized.year_start,
        "year_end": normalized.year_end,
        "month": normalized.month,
        "is_leap_month": normalized.is_leap_month,
        "day": normalized.day,
        "end_month": normalized.end_month,
        "end_is_leap_month": normalized.end_is_leap_month,
        "end_day": normalized.end_day,
        "month_text": normalized.month_text or "",
        "day_text": normalized.day_text or "",
        "end_month_text": normalized.end_month_text or "",
        "end_day_text": normalized.end_day_text or "",
        "sort_order": normalized.sort_order,
        "time_type": normalized.time_type,
        "parse_note": normalized.parse_note or "",
    }


def _relationship_columns(entries: sqlite3.Connection) -> set[str]:
    return {row["name"] for row in entries.execute("PRAGMA table_info(Relationships)")}


def _build_change_relations(
    entries: sqlite3.Connection,
    normalized_by_id: dict[int, dict],
    *,
    include_quotation: bool = True,
) -> list[dict]:
    """Return atomic evolution/transfer edges without inferring time or grouping."""
    columns = _relationship_columns(entries)
    optional_selects = [
        f"r.{column} AS {column}" if column in columns else f"NULL AS {column}"
        for column in CHANGE_RELATION_OPTIONAL_COLUMNS
    ]
    rows = entries.execute(
        f"""
        SELECT r.id AS rid, r.subject_id, r.object_id, r.relation_type,
               r.quotation, s.entity_id AS subj, o.entity_id AS obj,
               {", ".join(optional_selects)}
        FROM Relationships r
        JOIN Timepoints s ON r.subject_id = s.id
        JOIN Timepoints o ON r.object_id = o.id
        WHERE r.relation_type = ?
           OR r.relation_type LIKE ?
           OR r.relation_type = ?
        ORDER BY r.id
        """,
        ("前后演变", "演变·%", "职掌·移交"),
    )

    relations = []
    for row in rows:
        subtype = row["relation_subtype"] or None
        is_unclassified = row["relation_type"] == "前后演变" and subtype is None
        relation = {
                "id": row["rid"],
                "relation_type": row["relation_type"],
                "relation_subtype": subtype,
                "classification_status": "unclassified" if is_unclassified else "classified",
                "display_relation_type": (
                    "前后演变（未分类）" if is_unclassified else subtype or row["relation_type"]
                ),
                "source": row["subj"],
                "target": row["obj"],
                "source_timepoint_id": row["subject_id"],
                "target_timepoint_id": row["object_id"],
                "source_time": dict(normalized_by_id.get(row["subject_id"]) or {}),
                "target_time": dict(normalized_by_id.get(row["object_id"]) or {}),
                "evidence_key": f"R{row['rid']}",
                "change_event_id": row["change_event_id"],
                "relation_group_id": row["relation_group_id"],
                "relation_scope": row["relation_scope"] or None,
            }
        if include_quotation:
            relation["quotation"] = row["quotation"] or ""
        relations.append(relation)
    return relations


def _dictionary_row_payload(row: sqlite3.Row, *, full_sections: bool = False) -> dict:
    fields = {}
    raw = row["fields"]
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                fields = parsed
        except (ValueError, TypeError):
            fields = {}
    text = (row["text"] or "").strip()
    full_catalog = row["catalog"] or ""
    section_limit = None if full_sections else SECTION_LEN
    return {
        "page": row["page"],
        "catalog": full_catalog.split("/")[-1],
        "summary": text[:SUMMARY_LEN],
        "text": text,
        "origin": _dict_section(fields, ("职源与沿革", "职源", "沿革"), limit=section_limit),
        "aliases": _dict_section(fields, ("简称与别名", "简称", "别称"), limit=section_limit),
        "duty": _dict_section(fields, ("职掌", "职责", "职掌与编制"), limit=section_limit),
        "rank": _dict_section(fields, ("品位", "官品", "品阶", "品秩", "位遇", "序位"), limit=section_limit),
        "children": _dict_section(fields, ("下级机构", "所辖机构", "所属机构"), limit=section_limit),
        "office": _dict_section(fields, ("衙署", "办公地点"), limit=section_limit),
        "composition": _dict_section(fields, ("编制", "官额", "吏额"), limit=section_limit),
    }


def _dictionary_full_original(row: sqlite3.Row) -> str:
    """返回辞典行的完整原文内容，不使用详情摘要的截断上限。"""
    fields = {}
    if row["fields"]:
        try:
            parsed = json.loads(row["fields"])
            if isinstance(parsed, dict):
                fields = parsed
        except (ValueError, TypeError):
            fields = {}
    sections = [
        ("职源与沿革", ("职源与沿革", "职源", "沿革")),
        ("职掌", ("职掌", "职责", "职掌与编制")),
        ("品位", ("品位", "官品", "品阶", "品秩", "位遇", "序位")),
        ("编制", ("编制", "官额", "吏额")),
        ("简称与别名", ("简称与别名", "简称", "别称")),
        ("下级机构", ("下级机构", "所辖机构", "所属机构")),
        ("衙署", ("衙署", "办公地点")),
    ]
    parts = []
    head = (row["text"] or "").strip()
    if head:
        parts.append(head)
    for label, keys in sections:
        value = ""
        for key in keys:
            candidate = fields.get(key)
            if isinstance(candidate, str) and candidate.strip():
                value = candidate.strip()
                break
        if value:
            parts.append(f"{label}：{value}")
    return "\n".join(parts)


def build_payload(*, include_details: bool = True) -> dict:
    entries = _connect(ENTRIES_DB)
    dictionary = _connect(DICT_DB)

    entities = [
        {"id": r["id"], "title": r["title"], "type": r["type"]}
        for r in entries.execute("SELECT id, title, type FROM Entities ORDER BY id")
    ]

    timepoints = {}
    normalized_by_id = {}
    for r in entries.execute(
        "SELECT id, entity_id, time, event, event_type, lifecycle_effect,"
        " prev_id, succ_id, attr_category, attr_officer_type, attr_grade, quotation"
        " FROM Timepoints ORDER BY entity_id, id"
    ):
        normalized_payload = _normalized_time_payload(r["time"] or "")
        normalized_by_id[r["id"]] = normalized_payload
        timepoint = {
                "id": r["id"],
                "prev_id": r["prev_id"],
                "succ_id": r["succ_id"],
                "time": r["time"] or "",
                "event": r["event"] or "",
                "event_type": r["event_type"] or "record",
                "lifecycle_effect": r["lifecycle_effect"] or "preserve",
                "attr_category": r["attr_category"] or "",
                "attr_officer_type": r["attr_officer_type"] or "",
                "attr_grade": r["attr_grade"] or "",
                **normalized_payload,
            }
        if include_details:
            timepoint["quotation"] = r["quotation"] or ""
        timepoints.setdefault(r["entity_id"], []).append(timepoint)

    def entity_edges(relation_type: str):
        rows = entries.execute(
            """
            SELECT r.id AS rid, r.subject_id, r.object_id,
                   s.entity_id AS subj, o.entity_id AS obj,
                   r.staff_quota, r.staff_type
            FROM Relationships r
            JOIN Timepoints s ON r.subject_id = s.id
            JOIN Timepoints o ON r.object_id = o.id
            WHERE r.relation_type = ? AND s.entity_id != o.entity_id
            """,
            (relation_type,),
        )
        return list(rows)

    def periods_for(row):
        periods = []
        seen_periods = set()
        for timepoint_id in (row["subject_id"], row["object_id"]):
            item = normalized_by_id.get(timepoint_id) or {}
            start = item.get("year_start")
            end = item.get("year_end")
            if start is None or end is None:
                continue
            key = (start, end, item.get("time_type"))
            if key in seen_periods:
                continue
            seen_periods.add(key)
            periods.append(
                {"start": start, "end": end, "time_type": item.get("time_type", "")}
            )
        return periods

    # 统称主体仍保留在数据中供检索和详情使用；前端仅在它没有明确
    # 上下级机构边时，避免把它作为独立机构挂到虚拟分类根下。
    collective_rows = entity_edges("统称与实例")
    collective_entity_ids = {row["subj"] for row in collective_rows}
    collective_instance_edges = [
        {
            "id": row["rid"],
            "collective": row["subj"],
            "instance": row["obj"],
            "periods": periods_for(row),
            "states": [
                {
                    "id": row["rid"],
                    "subject_timepoint_id": row["subject_id"],
                    "object_timepoint_id": row["object_id"],
                }
            ],
        }
        for row in collective_rows
    ]

    # 上下级机构：映射回实体 id 对并去重（subject=上级 → object=下级）
    hierarchy_by_key = {}
    for r in entity_edges("上下级机构"):
        key = (r["subj"], r["obj"])
        if key not in hierarchy_by_key:
            hierarchy_by_key[key] = {
                "id": r["rid"],
                "parent": r["subj"],
                "child": r["obj"],
                "periods": [],
                "states": [],
            }
        hierarchy_by_key[key]["states"].append(
            {
                "id": r["rid"],
                "subject_timepoint_id": r["subject_id"],
                "object_timepoint_id": r["object_id"],
            }
        )
        existing = hierarchy_by_key[key]["periods"]
        for period in periods_for(r):
            if period not in existing:
                existing.append(period)
    hierarchy_edges = list(hierarchy_by_key.values())

    # 编制隶属：subject=机构时间点 → object=官职时间点；同一实体对可能有多条
    # （不同时间点的员额变化），全部保留，按 (org, official, quota, type) 去重
    staff_by_key = {}
    for r in entity_edges("编制隶属"):
        key = (r["subj"], r["obj"], r["staff_quota"] or "", r["staff_type"] or "")
        if key not in staff_by_key:
            staff_by_key[key] = {
                "id": r["rid"],
                "org": r["subj"],
                "official": r["obj"],
                "staff_quota": r["staff_quota"] or "",
                "staff_type": r["staff_type"] or "",
                "periods": [],
                "states": [],
            }
        staff_by_key[key]["states"].append(
            {
                "id": r["rid"],
                "subject_timepoint_id": r["subject_id"],
                "object_timepoint_id": r["object_id"],
            }
        )
        existing = staff_by_key[key]["periods"]
        for period in periods_for(r):
            if period not in existing:
                existing.append(period)
    staff_edges = list(staff_by_key.values())

    # 前后演变：供年度截面执行同一机构不同名称的互斥切换。
    # 与上下级边不同，这些边不参与层级树，只携带端点时间证据。
    evolution_edges = []
    for r in entity_edges("前后演变"):
        evolution_edges.append(
            {
                "id": r["rid"],
                "source": r["subj"],
                "target": r["obj"],
                "periods": periods_for(r),
                "states": [
                    {
                        "id": r["rid"],
                        "subject_timepoint_id": r["subject_id"],
                        "object_timepoint_id": r["object_id"],
                    }
                ],
            }
        )

    # 演变视图读取逐条关系，不借用 periods_for() 将两端时间合并，也不从
    # 自由文本推断子类型或关系组。旧“前后演变”明确标为未分类；将来数据库
    # 增加结构化子类型和组字段后，接口会通过 PRAGMA 自动透传。
    change_relations = _build_change_relations(
        entries, normalized_by_id, include_quotation=include_details
    )

    citations = {}
    if include_details:
        for r in entries.execute(
            "SELECT id, target_table, target_id, citation, quotation, note, conflict_flag"
            " FROM Citations ORDER BY target_table, target_id, id"
        ):
            key = ("T" if r["target_table"] == "Timepoints" else "R") + str(r["target_id"])
            citations.setdefault(key, []).append(
                {
                    "id": r["id"],
                    "citation": r["citation"] or "",
                    "quotation": r["quotation"] or "",
                    "note": r["note"] or "",
                    "conflict_flag": r["conflict_flag"] or 0,
                }
            )

    # 辞典匹配：按 title 精确匹配当前辞典表，抽取摘要与 fields 中的职源/职掌
    dict_rows = {}
    catalogs_by_title = {}
    catalogs_by_page = {}
    catalogs_by_reference = {}
    orders_by_title = {}
    orders_by_page = {}
    orders_by_reference = {}
    query = f'SELECT id, title, catalog, page, text, fields FROM "{DICT_TABLE}"'
    for r in dictionary.execute(query):
        title = r["title"]
        page = str(r["page"] or "").strip()
        source_order = int(r["id"])
        full_catalog = r["catalog"] or ""
        catalogs_by_title.setdefault(title, set()).add(full_catalog)
        orders_by_title.setdefault(title, set()).add(source_order)
        if page:
            catalogs_by_page.setdefault(page, set()).add(full_catalog)
            catalogs_by_reference.setdefault((title, page), set()).add(full_catalog)
            orders_by_page.setdefault(page, set()).add(source_order)
            orders_by_reference.setdefault((title, page), set()).add(source_order)
        if title in dict_rows or not include_details:
            continue
        dict_rows[title] = _dictionary_row_payload(r)

    sources_by_entity = {}
    for r in entries.execute(
        "SELECT target_id, source_entry, source_page"
        " FROM BuildRecords WHERE target_table = 'Entities'"
    ):
        source = (r["source_entry"] or "").strip()
        page = str(r["source_page"] or "").strip()
        sources_by_entity.setdefault(r["target_id"], set()).add((source, page))

    category_by_entity = {}
    source_order_by_entity = {}
    source_catalogs_by_entity = {}
    attr_categories_by_entity = {}
    for entity in entities:
        if entity["type"] != "机构":
            continue
        source_catalogs = resolve_source_catalogs(
            entity["title"],
            sources_by_entity.get(entity["id"], ()),
            catalogs_by_reference,
            catalogs_by_page,
            catalogs_by_title,
        )
        attr_categories = sorted({
            item["attr_category"]
            for item in timepoints.get(entity["id"], ())
            if item["attr_category"]
        })
        source_catalogs_by_entity[entity["id"]] = sorted(source_catalogs)
        source_order_by_entity[entity["id"]] = resolve_source_order(
            entity["title"],
            sources_by_entity.get(entity["id"], ()),
            orders_by_reference,
            orders_by_page,
            orders_by_title,
        )
        attr_categories_by_entity[entity["id"]] = attr_categories
        category_by_entity[entity["id"]] = classify_institution(
            attr_categories, sorted(source_catalogs), entity["title"]
        )

    # Derived instances and renamed successors may have no direct BuildRecord.
    # They inherit only across semantic identity edges, never from hierarchy.
    identity_edges = [
        (edge["collective"], edge["instance"], "统称与实例")
        for edge in collective_instance_edges
    ] + [
        (edge["source"], edge["target"], "前后演变")
        for edge in evolution_edges
    ]
    changed = True
    while changed:
        changed = False
        for source_id, target_id, relation_type in identity_edges:
            source_category = category_by_entity.get(source_id, (None, ""))[0]
            target_category = category_by_entity.get(target_id, (None, ""))[0]
            if source_category and target_id in category_by_entity and not target_category:
                category_by_entity[target_id] = (
                    source_category,
                    f"沿{relation_type}继承自实体 #{source_id}",
                )
                changed = True
            elif target_category and source_id in category_by_entity and not source_category:
                category_by_entity[source_id] = (
                    target_category,
                    f"沿{relation_type}继承自实体 #{target_id}",
                )
                changed = True
            source_order = source_order_by_entity.get(source_id, (None, ""))[0]
            target_order = source_order_by_entity.get(target_id, (None, ""))[0]
            if (
                source_order is not None
                and target_id in source_order_by_entity
                and target_order is None
            ):
                source_order_by_entity[target_id] = (
                    source_order,
                    f"沿{relation_type}继承辞典顺序自实体 #{source_id}",
                )
                changed = True
            elif (
                target_order is not None
                and source_id in source_order_by_entity
                and source_order is None
            ):
                source_order_by_entity[source_id] = (
                    target_order,
                    f"沿{relation_type}继承辞典顺序自实体 #{target_id}",
                )
                changed = True

    unresolved_category_ids = [
        entity_id
        for entity_id, (category, _) in category_by_entity.items()
        if category is None
    ]
    if unresolved_category_ids:
        sample = ", ".join(str(entity_id) for entity_id in unresolved_category_ids[:20])
        raise ValueError(
            f"有 {len(unresolved_category_ids)} 个机构缺少分类证据，示例实体 ID: {sample}"
        )

    institution_group_by_entity = {}
    for entity in entities:
        if entity["type"] != "机构":
            continue
        category = category_by_entity[entity["id"]][0]
        institution_group_by_entity[entity["id"]] = classify_institution_group(
            category,
            entity["title"],
            attr_categories_by_entity.get(entity["id"], ()),
            source_catalogs_by_entity.get(entity["id"], ()),
        )

    # 分组同样只沿语义身份边继承；不沿历史上下级边传播，避免把虚拟分类
    # 误当成真实隶属，也避免改隶时静默改变实体的长期分组。
    changed = True
    while changed:
        changed = False
        for source_id, target_id, relation_type in identity_edges:
            source_group = institution_group_by_entity.get(source_id, (None, ""))[0]
            target_group = institution_group_by_entity.get(target_id, (None, ""))[0]
            source_category = category_by_entity.get(source_id, (None, ""))[0]
            target_category = category_by_entity.get(target_id, (None, ""))[0]
            if source_category != target_category:
                continue
            if source_group and target_id in institution_group_by_entity and not target_group:
                institution_group_by_entity[target_id] = (
                    source_group,
                    f"沿{relation_type}继承分组自实体 #{source_id}",
                )
                changed = True
            elif target_group and source_id in institution_group_by_entity and not source_group:
                institution_group_by_entity[source_id] = (
                    target_group,
                    f"沿{relation_type}继承分组自实体 #{target_id}",
                )
                changed = True

    category_counts = {}
    institution_group_counts = {}
    institution_group_unresolved_ids = {}
    central_group_counts = {}
    central_group_unresolved_ids = []
    for entity in entities:
        if entity["type"] != "机构":
            continue
        category, category_basis = category_by_entity[entity["id"]]
        entity["category"] = category
        entity["category_basis"] = category_basis
        source_order, source_order_basis = source_order_by_entity[entity["id"]]
        entity["source_order"] = source_order
        entity["source_order_basis"] = source_order_basis
        category_counts[category] = category_counts.get(category, 0) + 1
        institution_group, institution_group_basis = institution_group_by_entity[entity["id"]]
        resolved_group = institution_group or f"其他{category}"
        entity["institution_group"] = resolved_group
        entity["institution_group_basis"] = institution_group_basis
        category_groups = institution_group_counts.setdefault(category, {})
        category_groups[resolved_group] = category_groups.get(resolved_group, 0) + 1
        if not institution_group:
            institution_group_unresolved_ids.setdefault(category, []).append(entity["id"])
        if category == "中央机构":
            entity["central_group"] = institution_group or ""
            entity["central_group_basis"] = institution_group_basis
            if institution_group:
                central_group_counts[institution_group] = central_group_counts.get(institution_group, 0) + 1
            else:
                central_group_unresolved_ids.append(entity["id"])

    entries.close()
    dictionary.close()

    entity_titles = {e["title"] for e in entities}
    dictionary_payload = {t: v for t, v in dict_rows.items() if t in entity_titles}

    return {
        "entities": entities,
        "timepoints": timepoints,
        "hierarchyEdges": hierarchy_edges,
        "staffEdges": staff_edges,
        "evolutionEdges": evolution_edges,
        "changeRelations": change_relations,
        "collectiveEntityIds": sorted(collective_entity_ids),
        "collectiveInstanceEdges": collective_instance_edges,
        "citations": citations,
        "dictionary": dictionary_payload,
        "meta": {
            "entities": len(entities),
            "hierarchyEdges": len(hierarchy_edges),
            "staffEdges": len(staff_edges),
            "evolutionEdges": len(evolution_edges),
            "changeRelations": len(change_relations),
            "collectiveEntities": len(collective_entity_ids),
            "collectiveInstanceEdges": len(collective_instance_edges),
            "dictionaryMatched": len(dictionary_payload),
            "categoryCounts": category_counts,
            "categoryUnresolved": len(unresolved_category_ids),
            "categoryUnresolvedIds": unresolved_category_ids,
            "sourceOrderMatched": sum(
                1
                for order, _ in source_order_by_entity.values()
                if order is not None
            ),
            "institutionGroupNames": {
                category: list(groups)
                for category, groups in INSTITUTION_GROUP_NAMES.items()
            },
            "institutionGroupCounts": institution_group_counts,
            "institutionGroupUnresolved": {
                category: len(ids)
                for category, ids in institution_group_unresolved_ids.items()
            },
            "institutionGroupUnresolvedIds": institution_group_unresolved_ids,
            "centralGroupCounts": central_group_counts,
            "centralGroupUnresolved": len(central_group_unresolved_ids),
            "centralGroupUnresolvedIds": central_group_unresolved_ids,
            "source": ENTRIES_DB.name,
            "yearMin": 960,
            "yearMax": 1279,
            # 年号范围与 normalize_times.py 共用同一份可追溯表，避免前端
            # 重新维护一份静态列表，也避免把原设计 SVG 的示意文字当作数据。
            "eras": [
                {"name": name, "start": start, "end": end}
                for name, (start, end) in ERA_YEARS.items()
                if 960 <= start <= 1279
            ],
            "emperorReigns": [dict(reign) for reign in SONG_EMPEROR_REIGNS],
            "emperorReignsSource": {
                "title": REFERENCE_SOURCES["emperor_reign_table"][0],
                "url": REFERENCE_SOURCES["emperor_reign_table"][1],
            },
        },
    }


def build_entity_details(entity_id: int) -> dict:
    entries = _connect(ENTRIES_DB)
    dictionary = _connect(DICT_DB)
    try:
        entity = entries.execute(
            "SELECT id, title FROM Entities WHERE id = ?", (entity_id,)
        ).fetchone()
        if entity is None:
            raise ValueError(f"机构或官职不存在: {entity_id}")

        timepoint_rows = list(entries.execute(
            "SELECT id, quotation FROM Timepoints WHERE entity_id = ? ORDER BY id",
            (entity_id,),
        ))
        timepoint_ids = [row["id"] for row in timepoint_rows]
        relation_rows = list(entries.execute(
            """
            SELECT DISTINCT r.id, r.quotation
            FROM Relationships r
            JOIN Timepoints s ON s.id = r.subject_id
            JOIN Timepoints o ON o.id = r.object_id
            WHERE s.entity_id = ? OR o.entity_id = ?
            ORDER BY r.id
            """,
            (entity_id, entity_id),
        ))
        relation_ids = [row["id"] for row in relation_rows]

        citations = {}
        targets = [("Timepoints", target_id) for target_id in timepoint_ids]
        targets.extend(("Relationships", target_id) for target_id in relation_ids)
        for target_table, target_id in targets:
            key = ("T" if target_table == "Timepoints" else "R") + str(target_id)
            rows = entries.execute(
                """
                SELECT id, citation, quotation, note, conflict_flag
                FROM Citations
                WHERE target_table = ? AND target_id = ?
                ORDER BY id
                """,
                (target_table, target_id),
            )
            values = [
                {
                    "id": row["id"],
                    "citation": row["citation"] or "",
                    "quotation": row["quotation"] or "",
                    "note": row["note"] or "",
                    "conflict_flag": row["conflict_flag"] or 0,
                }
                for row in rows
            ]
            if values:
                citations[key] = values

        dictionary_row = dictionary.execute(
            f'SELECT title, catalog, page, text, fields FROM "{DICT_TABLE}" WHERE title = ? ORDER BY rowid LIMIT 1',
            (entity["title"],),
        ).fetchone()
        return {
            "entityId": entity_id,
            "dictionary": {
                entity["title"]: _dictionary_row_payload(
                    dictionary_row, full_sections=True
                )
            } if dictionary_row else {},
            "citations": citations,
            "timepointQuotations": {
                str(row["id"]): row["quotation"] or ""
                for row in timepoint_rows if row["quotation"]
            },
            "relationQuotations": {
                str(row["id"]): row["quotation"] or ""
                for row in relation_rows if row["quotation"]
            },
        }
    finally:
        entries.close()
        dictionary.close()


def _relationship_source_records(
    entries: sqlite3.Connection,
    dictionary: sqlite3.Connection,
    relation_id: int,
) -> list[dict]:
    """沿 BuildRecords 还原一条关系的辞典来源。

    优先用「词条名 + 页码」精确匹配；只有标题唯一时才允许
    仅按标题回退。汇总标记或无法匹配的来源原样返回，不猜测词条。
    """
    build_rows = list(entries.execute(
        """
        SELECT source_entry, source_page, decision
        FROM BuildRecords
        WHERE target_table = 'Relationships' AND target_id = ?
        ORDER BY id
        """,
        (relation_id,),
    ))
    records = []
    seen_records = set()
    for build_row in build_rows:
        source_entry = (build_row["source_entry"] or "").strip()
        source_page = str(build_row["source_page"] or "").strip()
        decision = (build_row["decision"] or "").strip()
        record_key = (source_entry, source_page, decision)
        if record_key in seen_records:
            continue
        seen_records.add(record_key)

        exact_rows = []
        if source_entry and source_page:
            exact_rows = list(dictionary.execute(
                f'''SELECT id, title, catalog, page, text, fields
                    FROM "{DICT_TABLE}"
                    WHERE trim(title) = ? AND trim(CAST(page AS TEXT)) = ?
                    ORDER BY id''',
                (source_entry, source_page),
            ))

        matched_rows = exact_rows
        match_status = "exact" if exact_rows else "unmatched"
        if not matched_rows and source_entry:
            title_rows = list(dictionary.execute(
                f'''SELECT id, title, catalog, page, text, fields
                    FROM "{DICT_TABLE}"
                    WHERE trim(title) = ?
                    ORDER BY id''',
                (source_entry,),
            ))
            if len(title_rows) == 1:
                matched_rows = title_rows
                match_status = "title_unique"
        if not matched_rows and "/" in source_entry:
            composite_rows = []
            composite_complete = True
            page_range_match = re.fullmatch(r"(\d+)\s*[-–—]\s*(\d+)", source_page)
            page_range = (
                range(int(page_range_match.group(1)), int(page_range_match.group(2)) + 1)
                if page_range_match else ()
            )
            for title in (part.strip() for part in source_entry.split("/")):
                if not title:
                    continue
                title_rows = list(dictionary.execute(
                    f'''SELECT id, title, catalog, page, text, fields
                        FROM "{DICT_TABLE}"
                        WHERE trim(title) = ?
                        ORDER BY id''',
                    (title,),
                ))
                if page_range:
                    title_rows = [
                        row for row in title_rows
                        if str(row["page"] or "").strip().isdigit()
                        and int(str(row["page"]).strip()) in page_range
                    ]
                if len(title_rows) != 1:
                    composite_complete = False
                    break
                composite_rows.extend(title_rows)
            if composite_complete and composite_rows:
                matched_rows = composite_rows
                match_status = "composite_titles"

        entries_payload = []
        for row in matched_rows:
            payload = _dictionary_row_payload(row)
            payload["id"] = row["id"]
            payload["title"] = row["title"]
            payload["originalText"] = _dictionary_full_original(row)
            entries_payload.append(payload)
        records.append({
            "sourceEntry": source_entry,
            "sourcePage": source_page,
            "decision": decision,
            "matchStatus": match_status,
            "entries": entries_payload,
        })
    return records


def build_relation_details(relation_id: int) -> dict:
    entries = _connect(ENTRIES_DB)
    dictionary = _connect(DICT_DB)
    try:
        exists = entries.execute(
            "SELECT 1 FROM Relationships WHERE id = ?", (relation_id,)
        ).fetchone()
        if exists is None:
            raise ValueError(f"关系不存在: {relation_id}")
        return {
            "relationId": relation_id,
            "relationshipSources": {
                str(relation_id): _relationship_source_records(
                    entries, dictionary, relation_id
                )
            },
        }
    finally:
        entries.close()
        dictionary.close()


def get_payload() -> bytes:
    fingerprint = _database_fingerprint()
    with _cache_lock:
        if _cache.get("fingerprint") != fingerprint:
            _cache.clear()
            _cache["fingerprint"] = fingerprint
            print("[server] 数据库已更新，重建 /api/data payload ...", flush=True)
            _cache["data"] = json.dumps(build_payload(), ensure_ascii=False).encode("utf-8")
            print(f"[server] payload 大小 {len(_cache['data']) / 1024 / 1024:.1f} MB", flush=True)
        elif "data" not in _cache:
            _cache["data"] = json.dumps(build_payload(), ensure_ascii=False).encode("utf-8")
        return _cache["data"]


def get_core_payload() -> bytes:
    fingerprint = _database_fingerprint()
    with _cache_lock:
        if _cache.get("fingerprint") != fingerprint:
            _cache.clear()
            _cache["fingerprint"] = fingerprint
        if "core" not in _cache:
            print("[server] 构建首屏核心数据 ...", flush=True)
            _cache["core"] = json.dumps(
                build_payload(include_details=False), ensure_ascii=False
            ).encode("utf-8")
            print(f"[server] 核心数据大小 {len(_cache['core']) / 1024 / 1024:.1f} MB", flush=True)
        return _cache["core"]


def get_entity_details_payload(entity_id: int) -> bytes:
    fingerprint = _database_fingerprint()
    with _cache_lock:
        if _cache.get("fingerprint") != fingerprint:
            _cache.clear()
            _cache["fingerprint"] = fingerprint
        details = _cache.setdefault("entity_details", {})
        if entity_id not in details:
            details[entity_id] = json.dumps(
                build_entity_details(entity_id), ensure_ascii=False
            ).encode("utf-8")
        return details[entity_id]


def get_relation_details_payload(relation_id: int) -> bytes:
    fingerprint = _database_fingerprint()
    with _cache_lock:
        if _cache.get("fingerprint") != fingerprint:
            _cache.clear()
            _cache["fingerprint"] = fingerprint
        details = _cache.setdefault("relation_details", {})
        if relation_id not in details:
            details[relation_id] = json.dumps(
                build_relation_details(relation_id), ensure_ascii=False
            ).encode("utf-8")
        return details[relation_id]


def get_version() -> bytes:
    return json.dumps({"version": _database_fingerprint()}, ensure_ascii=False).encode("utf-8")


def get_revision_store() -> RevisionStore:
    if _revision_store is None:
        raise RuntimeError("修订工作区尚未初始化")
    return _revision_store


CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "Ch1t12DesignVis/0.1"

    def log_message(self, fmt, *args):  # 安静一点
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(
        self,
        code: int,
        body: bytes,
        content_type: str,
        cache_control: str = "no-store",
    ):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache_control)
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, code: int, payload):
        self._send(
            code,
            json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            "application/json; charset=utf-8",
        )

    def _read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise RevisionError("Content-Length 不合法", code="INVALID_CONTENT_LENGTH") from exc
        if length <= 0:
            return {}
        if length > 2 * 1024 * 1024:
            raise RevisionError("请求体超过 2 MB", code="PAYLOAD_TOO_LARGE", status=413)
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RevisionError("请求体不是有效 JSON", code="INVALID_JSON") from exc
        if not isinstance(payload, dict):
            raise RevisionError("请求体必须是 JSON 对象", code="INVALID_JSON_OBJECT")
        return payload

    def _revision_call(self, callback):
        try:
            self._send_json(200, callback())
        except RevisionError as exc:
            self._send_json(exc.status, exc.payload())
        except Exception as exc:  # noqa: BLE001
            import traceback
            traceback.print_exc()
            self._send_json(500, {"error": str(exc), "code": "INTERNAL_ERROR"})

    def do_GET(self):
        request_url = urlparse(self.path)
        path = request_url.path
        query = parse_qs(request_url.query)
        if path == "/api/revisions/state":
            self._revision_call(lambda: get_revision_store().state())
            return
        if path == "/api/revisions/draft/preview":
            self._revision_call(lambda: get_revision_store().preview())
            return
        if path == "/api/revisions/commits":
            self._revision_call(lambda: get_revision_store().list_commits())
            return
        commit_match = re.fullmatch(r"/api/revisions/commits/([0-9a-f]{64})", path)
        if commit_match:
            self._revision_call(lambda: get_revision_store().get_commit(commit_match.group(1)))
            return
        design_files = {
            "/api/design/hierarchy.svg": DESIGN_HIERARCHY_SVG,
            "/api/design/composition.svg": DESIGN_COMPOSITION_SVG,
            "/api/design/timeline.svg": DESIGN_TIMELINE_SVG,
            "/api/design/fzqing.ttf": DESIGN_FZQING_FONT,
            "/api/design/adobe-song.otf": DESIGN_ADOBE_SONG_FONT,
        }
        if path in design_files:
            content_type = {
                ".svg": "image/svg+xml",
                ".ttf": "font/ttf",
                ".otf": "font/otf",
            }.get(design_files[path].suffix.lower(), "application/octet-stream")
            cache_control = (
                "public, max-age=31536000, immutable"
                if query.get("v")
                else "public, max-age=300"
            )
            self._send(
                200,
                design_files[path].read_bytes(),
                content_type,
                cache_control=cache_control,
            )
            return
        detail_match = re.fullmatch(r"/api/details/entity/(\d+)", path)
        if detail_match:
            try:
                requested_version = query.get("v", [""])[0]
                current_version = _database_fingerprint()
                self._send(
                    200,
                    get_entity_details_payload(int(detail_match.group(1))),
                    "application/json; charset=utf-8",
                    cache_control=(
                        "public, max-age=31536000, immutable"
                        if requested_version == current_version
                        else "no-store"
                    ),
                )
            except Exception as exc:  # noqa: BLE001
                self._send_json(404 if isinstance(exc, ValueError) else 500, {"error": str(exc)})
            return
        relation_detail_match = re.fullmatch(r"/api/details/relation/(\d+)", path)
        if relation_detail_match:
            try:
                requested_version = query.get("v", [""])[0]
                current_version = _database_fingerprint()
                self._send(
                    200,
                    get_relation_details_payload(int(relation_detail_match.group(1))),
                    "application/json; charset=utf-8",
                    cache_control=(
                        "public, max-age=31536000, immutable"
                        if requested_version == current_version
                        else "no-store"
                    ),
                )
            except Exception as exc:  # noqa: BLE001
                self._send_json(404 if isinstance(exc, ValueError) else 500, {"error": str(exc)})
            return
        if path == "/data/song-bureaucracy-core.json":
            try:
                requested_version = query.get("v", [""])[0]
                current_version = _database_fingerprint()
                self._send(
                    200,
                    get_core_payload(),
                    "application/json; charset=utf-8",
                    cache_control=(
                        "public, max-age=31536000, immutable"
                        if requested_version == current_version
                        else "no-store"
                    ),
                )
            except Exception as exc:  # noqa: BLE001
                import traceback
                traceback.print_exc()
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
            return
        if path in (
            "/api/data",
            "/api/data.json",
            "/data/song-bureaucracy.json",
        ):
            try:
                requested_version = query.get("v", [""])[0]
                current_version = _database_fingerprint()
                cache_control = (
                    "public, max-age=31536000, immutable"
                    if requested_version == current_version
                    else "no-store"
                )
                self._send(
                    200,
                    get_payload(),
                    "application/json; charset=utf-8",
                    cache_control=cache_control,
                )
            except Exception as exc:  # noqa: BLE001
                import traceback
                traceback.print_exc()
                self._send(500, json.dumps({"error": str(exc)}).encode(), "application/json")
            return
        if path == "/api/version":
            self._send(200, get_version(), "application/json; charset=utf-8")
            return
        if path == "/api/health":
            self._send(200, b'{"ok":true}', "application/json")
            return

        # 静态文件：dist/
        if path in ("", "/"):
            path = "/index.html"
        safe = Path(*[p for p in path.split("/") if p not in ("", "..")])
        target = (DIST_DIR / safe).resolve()
        if not str(target).startswith(str(DIST_DIR.resolve())) or not target.is_file():
            # SPA 回退
            target = DIST_DIR / "index.html"
            if not target.is_file():
                self._send(503, "dist/ 不存在，请先运行 pnpm build".encode(), "text/plain; charset=utf-8")
                return
        ctype = CONTENT_TYPES.get(target.suffix.lower(), "application/octet-stream")
        cache_control = "no-cache"
        if path.startswith("/assets/"):
            cache_control = "public, max-age=31536000, immutable"
        elif target.name == "favicon.svg":
            cache_control = "public, max-age=86400"
        self._send(200, target.read_bytes(), ctype, cache_control=cache_control)

    def do_POST(self):
        path = urlparse(self.path).path
        payload_cache = None

        def body():
            nonlocal payload_cache
            if payload_cache is None:
                payload_cache = self._read_json()
            return payload_cache

        routes = {
            "/api/revisions/draft/operations": lambda: get_revision_store().add_group(body()),
            "/api/revisions/draft/undo": lambda: get_revision_store().undo(),
            "/api/revisions/draft/redo": lambda: get_revision_store().redo(),
            "/api/revisions/draft/discard": lambda: get_revision_store().discard(),
            "/api/revisions/commit": lambda: get_revision_store().commit(body().get("summary", "")),
            "/api/revisions/restore-preview": lambda: get_revision_store().restore_preview(
                body().get("target_hash", "")
            ),
            "/api/revisions/restore": lambda: get_revision_store().restore(
                body().get("target_hash", ""), body().get("summary")
            ),
            "/api/revisions/normalize-time": lambda: _normalized_time_payload(
                str(body().get("time", ""))
            ),
        }
        callback = routes.get(path)
        if callback is None:
            self._send_json(404, {"error": "接口不存在", "code": "NOT_FOUND"})
            return
        self._revision_call(callback)

    def do_DELETE(self):
        path = urlparse(self.path).path
        commit_match = re.fullmatch(r"/api/revisions/commits/([0-9a-f]{64})", path)
        if commit_match:
            self._revision_call(lambda: get_revision_store().delete_commit(commit_match.group(1)))
            return
        match = re.fullmatch(r"/api/revisions/draft/operations/([A-Za-z0-9:_-]+)", path)
        if not match:
            self._send_json(404, {"error": "接口不存在", "code": "NOT_FOUND"})
            return
        self._revision_call(lambda: get_revision_store().remove_group(match.group(1)))


def main():
    global ENTRIES_DB, DICT_DB, DICT_TABLE, _revision_store

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8650)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--entries-db", type=Path, default=ENTRIES_DB)
    parser.add_argument("--dict-db", type=Path, default=DICT_DB)
    parser.add_argument("--dict-table", default=DICT_TABLE)
    parser.add_argument(
        "--revisions-db",
        type=Path,
        help="旁路版本库路径；默认由 --entries-db 推导为 *.revisions.db",
    )
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", args.dict_table):
        parser.error("--dict-table 必须是合法的 SQLite 表名")
    ENTRIES_DB = args.entries_db.expanduser().resolve()
    DICT_DB = args.dict_db.expanduser().resolve()
    DICT_TABLE = args.dict_table
    revisions_db = args.revisions_db.expanduser().resolve() if args.revisions_db else None
    _revision_store = RevisionStore(ENTRIES_DB, _normalized_time_payload, revisions_db)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"[server] 结构化数据源: {ENTRIES_DB}")
    print(f"[server] 辞典数据源: {DICT_DB}（表 {DICT_TABLE}）")
    print(f"[server] 版本工作区: {_revision_store.revisions_db}")
    print(f"[server] 服务地址: http://{args.host}:{args.port}/", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
