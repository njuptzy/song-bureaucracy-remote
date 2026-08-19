#!/usr/bin/env python3
"""Persistent draft and linear revision history for the visualization database."""

from __future__ import annotations

import hashlib
import json
import shutil
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable


EDITABLE_FIELDS = {
    "Timepoints": {
        "time", "event", "event_type", "lifecycle_effect", "attr_category",
        "attr_officer_type", "attr_grade", "quotation",
    },
    "Relationships": {"subject_id", "object_id", "quotation"},
}
EVENT_TYPES = {
    "establish", "restore", "abolish", "rename", "reorganize", "merge", "split",
    "incorporate", "duty_transfer", "affiliation_change", "staffing_change",
    "record",
}
LIFECYCLE_EFFECTS = {"activate", "preserve", "deactivate", "ignore"}
SUPPORTED_TABLES = ("Entities", "Timepoints", "Relationships", "Citations", "NormalizedTimes")
ROW_KEYS = {
    "Entities": "id",
    "Timepoints": "id",
    "Relationships": "id",
    "Citations": "id",
    "NormalizedTimes": "timepoint_id",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def canonical_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def token(value) -> str:
    return str(value)


def is_temp(value) -> bool:
    return isinstance(value, str) and value.startswith("tmp:")


class RevisionError(RuntimeError):
    def __init__(self, message: str, *, code: str = "REVISION_ERROR", status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status

    def payload(self) -> dict:
        return {"error": str(self), "code": self.code}


class RevisionStore:
    """Sidecar revision database paired with one result database."""

    def __init__(
        self,
        entries_db: Path,
        normalizer: Callable[[str], dict],
        revisions_db: Path | None = None,
    ):
        self.entries_db = Path(entries_db).resolve()
        self.revisions_db = Path(revisions_db or self.entries_db.with_suffix(".revisions.db")).resolve()
        self.normalizer = normalizer
        self._lock = threading.RLock()
        with self._entries_connection() as entries:
            self.has_normalized_times = self._table_exists(entries, "NormalizedTimes")
        self.revisions_db.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @property
    def rollback_db(self) -> Path:
        return self.entries_db.with_name(f"{self.entries_db.stem}.latest-rollback{self.entries_db.suffix}")

    @property
    def rollback_revisions_db(self) -> Path:
        return self.revisions_db.with_name(
            f"{self.revisions_db.stem}.latest-rollback{self.revisions_db.suffix}"
        )

    @contextmanager
    def _revision_connection(self):
        connection = sqlite3.connect(self.revisions_db, timeout=20)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA journal_mode = DELETE")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @contextmanager
    def _entries_connection(self, *, readonly: bool = True):
        if readonly:
            connection = sqlite3.connect(f"file:{self.entries_db}?mode=ro", uri=True, timeout=20)
        else:
            connection = sqlite3.connect(self.entries_db, timeout=20)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            if not readonly:
                connection.commit()
        except Exception:
            if not readonly:
                connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._lock, self._revision_connection() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS RevisionMeta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS RevisionCommits (
                    hash TEXT PRIMARY KEY,
                    parent_hash TEXT,
                    summary TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    reverts_hash TEXT,
                    operation_count INTEGER NOT NULL,
                    result_fingerprint TEXT NOT NULL,
                    is_baseline INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY(parent_hash) REFERENCES RevisionCommits(hash)
                );
                CREATE TABLE IF NOT EXISTS RevisionOperations (
                    commit_hash TEXT NOT NULL,
                    operation_order INTEGER NOT NULL,
                    group_id TEXT NOT NULL,
                    action TEXT NOT NULL,
                    target_table TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    before_json TEXT,
                    after_json TEXT,
                    reason TEXT NOT NULL,
                    automatic INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(commit_hash, operation_order),
                    FOREIGN KEY(commit_hash) REFERENCES RevisionCommits(hash)
                );
                CREATE TABLE IF NOT EXISTS RevisionEvidence (
                    commit_hash TEXT NOT NULL,
                    evidence_order INTEGER NOT NULL,
                    group_id TEXT NOT NULL,
                    mode TEXT NOT NULL,
                    citation_id INTEGER,
                    citation TEXT NOT NULL,
                    quotation TEXT NOT NULL,
                    note TEXT NOT NULL,
                    conflict_flag INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY(commit_hash, evidence_order),
                    FOREIGN KEY(commit_hash) REFERENCES RevisionCommits(hash)
                );
                CREATE TABLE IF NOT EXISTS RevisionOperationEvidence (
                    commit_hash TEXT NOT NULL,
                    operation_order INTEGER NOT NULL,
                    evidence_order INTEGER NOT NULL,
                    PRIMARY KEY(commit_hash, operation_order, evidence_order),
                    FOREIGN KEY(commit_hash, operation_order)
                        REFERENCES RevisionOperations(commit_hash, operation_order),
                    FOREIGN KEY(commit_hash, evidence_order)
                        REFERENCES RevisionEvidence(commit_hash, evidence_order)
                );
                CREATE TABLE IF NOT EXISTS RevisionWorkspace (
                    id INTEGER PRIMARY KEY CHECK(id = 1),
                    base_head TEXT,
                    base_fingerprint TEXT,
                    base_marker TEXT,
                    cursor INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS DraftGroups (
                    group_id TEXT PRIMARY KEY,
                    position INTEGER NOT NULL UNIQUE,
                    label TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS DraftOperations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_id TEXT NOT NULL,
                    operation_order INTEGER NOT NULL,
                    action TEXT NOT NULL,
                    target_table TEXT NOT NULL,
                    target_id TEXT NOT NULL,
                    before_json TEXT,
                    after_json TEXT,
                    automatic INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(group_id, operation_order),
                    FOREIGN KEY(group_id) REFERENCES DraftGroups(group_id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS DraftEvidence (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    group_id TEXT NOT NULL,
                    evidence_order INTEGER NOT NULL,
                    mode TEXT NOT NULL,
                    citation_id INTEGER,
                    citation TEXT NOT NULL,
                    quotation TEXT NOT NULL,
                    note TEXT NOT NULL,
                    conflict_flag INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(group_id, evidence_order),
                    FOREIGN KEY(group_id) REFERENCES DraftGroups(group_id) ON DELETE CASCADE
                );
                """
            )
            connection.execute(
                "INSERT OR IGNORE INTO RevisionWorkspace(id, cursor, updated_at) VALUES (1, 0, ?)",
                (utc_now(),),
            )
            if self._meta(connection, "head") is None:
                with self._entries_connection() as entries:
                    fingerprint = self._content_fingerprint(entries)
                baseline_hash = hashlib.sha256(
                    f"song-bureaucracy-baseline\n{fingerprint}".encode("utf-8")
                ).hexdigest()
                connection.execute(
                    """
                    INSERT OR IGNORE INTO RevisionCommits(
                        hash, parent_hash, summary, created_at, reverts_hash,
                        operation_count, result_fingerprint, is_baseline
                    ) VALUES (?, NULL, ?, ?, NULL, 0, ?, 1)
                    """,
                    (baseline_hash, "初始数据库基线", utc_now(), fingerprint),
                )
                self._set_meta(connection, "head", baseline_hash)
                self._set_meta(connection, "expected_fingerprint", fingerprint)
                self._set_meta(connection, "expected_marker", self._file_marker())

    @staticmethod
    def _meta(connection: sqlite3.Connection, key: str) -> str | None:
        row = connection.execute("SELECT value FROM RevisionMeta WHERE key = ?", (key,)).fetchone()
        return row[0] if row else None

    @staticmethod
    def _set_meta(connection: sqlite3.Connection, key: str, value: str) -> None:
        connection.execute(
            "INSERT INTO RevisionMeta(key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    def _file_marker(self) -> str:
        parts = []
        for path in (self.entries_db, Path(f"{self.entries_db}-wal")):
            try:
                stat = path.stat()
                parts.append(f"{path.name}:{stat.st_ino}:{stat.st_size}:{stat.st_mtime_ns}:{stat.st_ctime_ns}")
            except FileNotFoundError:
                parts.append(f"{path.name}:missing")
        return "|".join(parts)

    @staticmethod
    def _content_fingerprint(connection: sqlite3.Connection, schema: str = "main") -> str:
        digest = hashlib.sha256()
        tables = [
            row[0]
            for row in connection.execute(
                f"SELECT name FROM {schema}.sqlite_master "
                "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        for table in tables:
            columns = [row[1] for row in connection.execute(f'PRAGMA {schema}.table_info("{table}")')]
            digest.update(canonical_json([table, columns]).encode("utf-8"))
            order = ""
            if columns:
                order = " ORDER BY " + ",".join(f'"{column}"' for column in columns)
            for row in connection.execute(f'SELECT * FROM {schema}."{table}"{order}'):
                digest.update(canonical_json(list(row)).encode("utf-8"))
        return digest.hexdigest()

    def _table_exists(self, connection: sqlite3.Connection, table: str, schema: str = "main") -> bool:
        return connection.execute(
            f"SELECT 1 FROM {schema}.sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone() is not None

    @staticmethod
    def _columns(connection: sqlite3.Connection, table: str, schema: str = "main") -> list[str]:
        return [row[1] for row in connection.execute(f'PRAGMA {schema}.table_info("{table}")')]

    def _active_groups(self, connection: sqlite3.Connection) -> list[sqlite3.Row]:
        cursor = connection.execute("SELECT cursor FROM RevisionWorkspace WHERE id=1").fetchone()[0]
        return list(
            connection.execute(
                "SELECT * FROM DraftGroups WHERE position <= ? ORDER BY position", (cursor,)
            )
        )

    def _draft_operations(self, connection: sqlite3.Connection) -> list[dict]:
        groups = self._active_groups(connection)
        if not groups:
            return []
        group_ids = [group["group_id"] for group in groups]
        placeholders = ",".join("?" for _ in group_ids)
        rows = connection.execute(
            f"SELECT o.*, g.position, g.reason FROM DraftOperations o "
            f"JOIN DraftGroups g ON g.group_id=o.group_id "
            f"WHERE o.group_id IN ({placeholders}) ORDER BY g.position,o.operation_order",
            group_ids,
        )
        return [self._operation_payload(row) for row in rows]

    @staticmethod
    def _operation_payload(row: sqlite3.Row | dict) -> dict:
        value = dict(row)
        return {
            "group_id": value["group_id"],
            "operation_order": value["operation_order"],
            "action": value["action"],
            "target_table": value["target_table"],
            "target_id": value["target_id"],
            "before": json.loads(value["before_json"]) if value.get("before_json") else None,
            "after": json.loads(value["after_json"]) if value.get("after_json") else None,
            "automatic": bool(value["automatic"]),
            "reason": value.get("reason", ""),
        }

    def _materialize(self, draft_connection: sqlite3.Connection, operations: list[dict] | None = None) -> dict:
        state = {table: {} for table in SUPPORTED_TABLES}
        with self._entries_connection() as entries:
            for table in SUPPORTED_TABLES:
                if not self._table_exists(entries, table):
                    continue
                key_name = ROW_KEYS[table]
                for row in entries.execute(f'SELECT * FROM "{table}"'):
                    item = dict(row)
                    state[table][token(item[key_name])] = item
        for operation in operations if operations is not None else self._draft_operations(draft_connection):
            table_state = state[operation["target_table"]]
            key = token(operation["target_id"])
            if operation["action"] == "delete":
                table_state.pop(key, None)
            else:
                table_state[key] = dict(operation["after"])
        return state

    def _ensure_editable(self, table: str, action: str, after: dict | None) -> None:
        if table not in EDITABLE_FIELDS:
            raise RevisionError("第一阶段只能修改时间点和前后演变关系", code="TABLE_NOT_EDITABLE")
        if action not in {"insert", "update", "delete"}:
            raise RevisionError("操作类型必须是 insert、update 或 delete", code="INVALID_ACTION")
        if action != "delete" and not isinstance(after, dict):
            raise RevisionError("新增或修改操作缺少 after 字段", code="MISSING_AFTER")
        if action == "update":
            invalid = set(after) - EDITABLE_FIELDS[table]
            if invalid:
                raise RevisionError(
                    f"不可直接修改字段：{', '.join(sorted(invalid))}", code="FIELD_NOT_EDITABLE"
                )

    def _new_operation(
        self,
        state: dict,
        *,
        group_id: str,
        action: str,
        table: str,
        target_id,
        after: dict | None,
        automatic: bool,
        reason: str,
    ) -> dict:
        key = token(target_id)
        before = state[table].get(key)
        if action == "insert":
            if before is not None:
                raise RevisionError(f"{table} {target_id} 已存在", code="ROW_ALREADY_EXISTS")
            result = dict(after or {})
            result[ROW_KEYS[table]] = target_id
        elif action == "update":
            if before is None:
                raise RevisionError(f"{table} {target_id} 不存在", code="ROW_NOT_FOUND", status=404)
            result = {**before, **(after or {})}
            result[ROW_KEYS[table]] = before[ROW_KEYS[table]]
        else:
            if before is None:
                raise RevisionError(f"{table} {target_id} 不存在", code="ROW_NOT_FOUND", status=404)
            result = None
        operation = {
            "group_id": group_id,
            "operation_order": 0,
            "action": action,
            "target_table": table,
            "target_id": target_id,
            "before": dict(before) if before is not None else None,
            "after": result,
            "automatic": automatic,
            "reason": reason,
        }
        if action == "delete":
            state[table].pop(key, None)
        else:
            state[table][key] = dict(result)
        return operation

    def _normalized_row(self, timepoint_id, raw_time: str) -> dict:
        payload = dict(self.normalizer(raw_time or ""))
        payload["timepoint_id"] = timepoint_id
        payload["raw_time"] = raw_time or ""
        return payload

    @staticmethod
    def _citation_target(table: str) -> str:
        return table

    def _expand_manual_operation(
        self,
        state: dict,
        group_id: str,
        request: dict,
        reason: str,
        evidence: list[dict],
    ) -> list[dict]:
        action = request.get("action")
        table = request.get("target_table")
        target_id = request.get("target_id")
        after_input = request.get("after")
        self._ensure_editable(table, action, after_input)
        if action != "insert" and target_id is None:
            raise RevisionError("操作缺少 target_id", code="MISSING_TARGET_ID")
        if action == "insert" and target_id is None:
            target_id = f"tmp:{uuid.uuid4().hex}"

        operations: list[dict] = []
        if table == "Timepoints":
            if action == "insert":
                after = dict(after_input)
                if after.get("entity_id") is None:
                    raise RevisionError("新增时间点必须指定所属实体", code="MISSING_ENTITY")
                if token(after["entity_id"]) not in state["Entities"]:
                    raise RevisionError("新增时间点所属实体不存在", code="INVALID_ENTITY")
                for field in (
                    "time", "event", "attr_category", "attr_officer_type", "attr_grade", "quotation",
                ):
                    after.setdefault(field, "")
                after.setdefault("event_type", "record")
                after.setdefault("lifecycle_effect", "preserve")
                after.setdefault("prev_id", None)
                after.setdefault("succ_id", None)
                if evidence and not after.get("quotation"):
                    after["quotation"] = evidence[0]["quotation"]
                operations.append(self._new_operation(
                    state, group_id=group_id, action="insert", table=table,
                    target_id=target_id, after=after, automatic=False, reason=reason,
                ))
                for neighbor_id, field, reverse_field in (
                    (after.get("prev_id"), "prev_id", "succ_id"),
                    (after.get("succ_id"), "succ_id", "prev_id"),
                ):
                    if neighbor_id is None:
                        continue
                    neighbor = state["Timepoints"].get(token(neighbor_id))
                    if not neighbor or token(neighbor["entity_id"]) != token(after["entity_id"]):
                        raise RevisionError("相邻时间点必须属于同一实体", code="INVALID_CHAIN_NEIGHBOR")
                    operations.append(self._new_operation(
                        state, group_id=group_id, action="update", table="Timepoints",
                        target_id=neighbor_id, after={reverse_field: target_id}, automatic=True, reason=reason,
                    ))
                if self.has_normalized_times:
                    operations.append(self._new_operation(
                        state, group_id=group_id, action="insert", table="NormalizedTimes",
                        target_id=target_id, after=self._normalized_row(target_id, after.get("time", "")),
                        automatic=True, reason=reason,
                    ))
            elif action == "update":
                current = state["Timepoints"].get(token(target_id))
                if not current:
                    raise RevisionError("时间点不存在", code="ROW_NOT_FOUND", status=404)
                after = dict(after_input)
                if evidence and evidence[0]["mode"] == "new" and evidence[0]["quotation"]:
                    after.setdefault("quotation", evidence[0]["quotation"])
                operations.append(self._new_operation(
                    state, group_id=group_id, action="update", table=table,
                    target_id=target_id, after=after, automatic=False, reason=reason,
                ))
                if "time" in after and self.has_normalized_times:
                    normalized = self._normalized_row(target_id, state["Timepoints"][token(target_id)].get("time", ""))
                    norm_action = "update" if token(target_id) in state["NormalizedTimes"] else "insert"
                    operations.append(self._new_operation(
                        state, group_id=group_id, action=norm_action, table="NormalizedTimes",
                        target_id=target_id, after=normalized, automatic=True, reason=reason,
                    ))
            else:
                current = state["Timepoints"].get(token(target_id))
                if not current:
                    raise RevisionError("时间点不存在", code="ROW_NOT_FOUND", status=404)
                related_relations = [
                    row for row in state["Relationships"].values()
                    if token(row.get("subject_id")) == token(target_id)
                    or token(row.get("object_id")) == token(target_id)
                ]
                relation_ids = {token(row["id"]) for row in related_relations}
                for citation_row in list(state["Citations"].values()):
                    if (
                        citation_row.get("target_table") == "Relationships"
                        and token(citation_row.get("target_id")) in relation_ids
                    ):
                        operations.append(self._new_operation(
                            state, group_id=group_id, action="delete", table="Citations",
                            target_id=citation_row["id"], after=None, automatic=True, reason=reason,
                        ))
                for relation in related_relations:
                    operations.append(self._new_operation(
                        state, group_id=group_id, action="delete", table="Relationships",
                        target_id=relation["id"], after=None, automatic=True, reason=reason,
                    ))
                for citation_row in list(state["Citations"].values()):
                    if (
                        citation_row.get("target_table") == "Timepoints"
                        and token(citation_row.get("target_id")) == token(target_id)
                    ):
                        operations.append(self._new_operation(
                            state, group_id=group_id, action="delete", table="Citations",
                            target_id=citation_row["id"], after=None, automatic=True, reason=reason,
                        ))
                if token(target_id) in state["NormalizedTimes"]:
                    operations.append(self._new_operation(
                        state, group_id=group_id, action="delete", table="NormalizedTimes",
                        target_id=target_id, after=None, automatic=True, reason=reason,
                    ))
                prev_id, succ_id = current.get("prev_id"), current.get("succ_id")
                if prev_id is not None and token(prev_id) in state["Timepoints"]:
                    operations.append(self._new_operation(
                        state, group_id=group_id, action="update", table="Timepoints",
                        target_id=prev_id, after={"succ_id": succ_id}, automatic=True, reason=reason,
                    ))
                if succ_id is not None and token(succ_id) in state["Timepoints"]:
                    operations.append(self._new_operation(
                        state, group_id=group_id, action="update", table="Timepoints",
                        target_id=succ_id, after={"prev_id": prev_id}, automatic=True, reason=reason,
                    ))
                operations.append(self._new_operation(
                    state, group_id=group_id, action="delete", table=table,
                    target_id=target_id, after=None, automatic=False, reason=reason,
                ))
        else:
            if action == "insert":
                after = dict(after_input)
                after["relation_type"] = "前后演变"
                after.setdefault("staff_quota", None)
                after.setdefault("staff_type", None)
                after.setdefault("quotation", evidence[0]["quotation"] if evidence else "")
            elif action == "update":
                after = dict(after_input)
                current = state["Relationships"].get(token(target_id))
                if not current or current.get("relation_type") != "前后演变":
                    raise RevisionError("第一阶段只能修改前后演变关系", code="RELATION_NOT_EDITABLE")
                if evidence and evidence[0]["mode"] == "new" and evidence[0]["quotation"]:
                    after.setdefault("quotation", evidence[0]["quotation"])
            else:
                current = state["Relationships"].get(token(target_id))
                if not current or current.get("relation_type") != "前后演变":
                    raise RevisionError("第一阶段只能删除前后演变关系", code="RELATION_NOT_EDITABLE")
                for citation_row in list(state["Citations"].values()):
                    if (
                        citation_row.get("target_table") == "Relationships"
                        and token(citation_row.get("target_id")) == token(target_id)
                    ):
                        operations.append(self._new_operation(
                            state, group_id=group_id, action="delete", table="Citations",
                            target_id=citation_row["id"], after=None, automatic=True, reason=reason,
                        ))
                after = None
            operations.append(self._new_operation(
                state, group_id=group_id, action=action, table=table,
                target_id=target_id, after=after, automatic=False, reason=reason,
            ))

        manual = next((operation for operation in operations if not operation["automatic"]), None)
        if manual and manual["action"] != "delete":
            for item in evidence:
                if item["mode"] != "new":
                    continue
                citation_id = f"tmp:{uuid.uuid4().hex}"
                citation_after = {
                    "target_table": self._citation_target(table),
                    "target_id": target_id,
                    "citation": item["citation"],
                    "quotation": item["quotation"],
                    "note": item["note"],
                    "conflict_flag": item["conflict_flag"],
                }
                operations.append(self._new_operation(
                    state, group_id=group_id, action="insert", table="Citations",
                    target_id=citation_id, after=citation_after, automatic=True, reason=reason,
                ))
        return operations

    def _normalize_evidence(self, state: dict, request: list, operation_request: dict) -> list[dict]:
        if not isinstance(request, list) or not request:
            raise RevisionError("每项人工修改必须关联证据", code="EVIDENCE_REQUIRED")
        result = []
        target_table = operation_request.get("target_table")
        target_id = operation_request.get("target_id")
        for item in request:
            if not isinstance(item, dict):
                raise RevisionError("证据格式不正确", code="INVALID_EVIDENCE")
            mode = item.get("mode", "new")
            if mode == "existing":
                citation_id = item.get("citation_id")
                row = state["Citations"].get(token(citation_id))
                if not row:
                    raise RevisionError("关联的已有证据不存在", code="EVIDENCE_NOT_FOUND")
                if row.get("target_table") != target_table or token(row.get("target_id")) != token(target_id):
                    raise RevisionError("已有证据不属于当前事实", code="EVIDENCE_TARGET_MISMATCH")
                result.append({
                    "mode": "existing",
                    "citation_id": row["id"],
                    "citation": row.get("citation") or "",
                    "quotation": row.get("quotation") or "",
                    "note": row.get("note") or "",
                    "conflict_flag": int(row.get("conflict_flag") or 0),
                })
            elif mode == "new":
                citation = str(item.get("citation") or "").strip()
                quotation = str(item.get("quotation") or "").strip()
                if not citation or not quotation:
                    raise RevisionError("新增证据必须填写出处和逐字引文", code="EVIDENCE_INCOMPLETE")
                result.append({
                    "mode": "new",
                    "citation_id": None,
                    "citation": citation,
                    "quotation": quotation,
                    "note": str(item.get("note") or "").strip(),
                    "conflict_flag": int(bool(item.get("conflict_flag"))),
                })
            else:
                raise RevisionError("证据模式必须是 existing 或 new", code="INVALID_EVIDENCE_MODE")
        return result

    def add_group(self, payload: dict) -> dict:
        reason = str(payload.get("reason") or "").strip()
        if not reason:
            raise RevisionError("修改理由不能为空", code="REASON_REQUIRED")
        requests = payload.get("operations")
        if not isinstance(requests, list) or not requests:
            raise RevisionError("操作组不能为空", code="OPERATIONS_REQUIRED")
        with self._lock, self._revision_connection() as connection:
            self._assert_editable_state(connection)
            connection.commit()
            connection.execute("BEGIN IMMEDIATE")
            workspace = connection.execute("SELECT * FROM RevisionWorkspace WHERE id=1").fetchone()
            connection.execute("DELETE FROM DraftGroups WHERE position > ?", (workspace["cursor"],))
            position = workspace["cursor"] + 1
            if position == 1:
                with self._entries_connection() as entries:
                    base_fingerprint = self._content_fingerprint(entries)
                base_head = self._meta(connection, "head")
                connection.execute(
                    "UPDATE RevisionWorkspace SET base_head=?,base_fingerprint=?,base_marker=? WHERE id=1",
                    (base_head, base_fingerprint, self._file_marker()),
                )
            state = self._materialize(connection)
            group_id = str(payload.get("group_id") or uuid.uuid4().hex)
            label = str(payload.get("label") or "人工校订").strip() or "人工校订"
            connection.execute(
                "INSERT INTO DraftGroups(group_id,position,label,reason,created_at) VALUES (?,?,?,?,?)",
                (group_id, position, label, reason, utc_now()),
            )
            all_operations = []
            all_evidence = []
            for request in requests:
                self._ensure_editable(request.get("target_table"), request.get("action"), request.get("after"))
                evidence = self._normalize_evidence(state, request.get("evidence", payload.get("evidence")), request)
                all_evidence.extend(evidence)
                all_operations.extend(
                    self._expand_manual_operation(state, group_id, request, reason, evidence)
                )
            errors = self._validate_changed_state(state, all_operations)
            if errors:
                raise RevisionError(errors[0], code="DRAFT_VALIDATION_FAILED")
            for order, operation in enumerate(all_operations, start=1):
                operation["operation_order"] = order
                connection.execute(
                    """
                    INSERT INTO DraftOperations(
                        group_id,operation_order,action,target_table,target_id,
                        before_json,after_json,automatic
                    ) VALUES (?,?,?,?,?,?,?,?)
                    """,
                    (
                        group_id, order, operation["action"], operation["target_table"],
                        token(operation["target_id"]),
                        canonical_json(operation["before"]) if operation["before"] is not None else None,
                        canonical_json(operation["after"]) if operation["after"] is not None else None,
                        int(operation["automatic"]),
                    ),
                )
            for order, item in enumerate(all_evidence, start=1):
                connection.execute(
                    """
                    INSERT INTO DraftEvidence(
                        group_id,evidence_order,mode,citation_id,citation,quotation,note,conflict_flag
                    ) VALUES (?,?,?,?,?,?,?,?)
                    """,
                    (
                        group_id, order, item["mode"], item["citation_id"], item["citation"],
                        item["quotation"], item["note"], item["conflict_flag"],
                    ),
                )
            connection.execute(
                "UPDATE RevisionWorkspace SET cursor=?,updated_at=? WHERE id=1",
                (position, utc_now()),
            )
            connection.commit()
            return {"group_id": group_id, "preview": self.preview()}

    def _assert_editable_state(self, connection: sqlite3.Connection) -> None:
        expected = self._meta(connection, "expected_fingerprint")
        expected_marker = self._meta(connection, "expected_marker")
        marker = self._file_marker()
        if marker == expected_marker:
            return
        with self._entries_connection() as entries:
            current = self._content_fingerprint(entries)
        if expected and current != expected:
            raise RevisionError(
                "正式数据库已被外部脚本修改，版本工作区已锁定",
                code="EXTERNAL_DATABASE_CHANGE",
                status=409,
            )
        self._set_meta(connection, "expected_marker", marker)

    def state(self) -> dict:
        with self._lock, self._revision_connection() as connection:
            workspace = connection.execute("SELECT * FROM RevisionWorkspace WHERE id=1").fetchone()
            groups = list(connection.execute("SELECT * FROM DraftGroups ORDER BY position"))
            locked_reason = ""
            try:
                self._assert_editable_state(connection)
            except RevisionError as exc:
                locked_reason = str(exc)
            return {
                "head": self._meta(connection, "head"),
                "baseline": connection.execute(
                    "SELECT hash FROM RevisionCommits WHERE is_baseline=1 ORDER BY created_at LIMIT 1"
                ).fetchone()[0],
                "draft": {
                    "group_count": workspace["cursor"],
                    "total_group_count": len(groups),
                    "cursor": workspace["cursor"],
                    "can_undo": workspace["cursor"] > 0,
                    "can_redo": workspace["cursor"] < len(groups),
                    "groups": [self._group_payload(connection, group) for group in groups],
                },
                "edit_locked": bool(locked_reason),
                "lock_reason": locked_reason,
            }

    def _group_payload(self, connection: sqlite3.Connection, group: sqlite3.Row) -> dict:
        operations = [
            self._operation_payload({**dict(row), "reason": group["reason"]})
            for row in connection.execute(
                "SELECT * FROM DraftOperations WHERE group_id=? ORDER BY operation_order",
                (group["group_id"],),
            )
        ]
        evidence = [dict(row) for row in connection.execute(
            "SELECT mode,citation_id,citation,quotation,note,conflict_flag "
            "FROM DraftEvidence WHERE group_id=? ORDER BY evidence_order",
            (group["group_id"],),
        )]
        return {
            "group_id": group["group_id"],
            "position": group["position"],
            "label": group["label"],
            "reason": group["reason"],
            "created_at": group["created_at"],
            "operations": operations,
            "evidence": evidence,
        }

    def _workspace_action(self, action: str) -> dict:
        with self._lock, self._revision_connection() as connection:
            workspace = connection.execute("SELECT * FROM RevisionWorkspace WHERE id=1").fetchone()
            total = connection.execute("SELECT COUNT(*) FROM DraftGroups").fetchone()[0]
            cursor = workspace["cursor"]
            if action == "undo":
                cursor = max(0, cursor - 1)
            elif action == "redo":
                cursor = min(total, cursor + 1)
            elif action == "discard":
                connection.execute("DELETE FROM DraftGroups")
                cursor = 0
                connection.execute(
                    "UPDATE RevisionWorkspace SET base_head=NULL,base_fingerprint=NULL,base_marker=NULL WHERE id=1"
                )
            connection.execute(
                "UPDATE RevisionWorkspace SET cursor=?,updated_at=? WHERE id=1", (cursor, utc_now())
            )
            connection.commit()
        return self.state()

    def undo(self) -> dict:
        return self._workspace_action("undo")

    def redo(self) -> dict:
        return self._workspace_action("redo")

    def discard(self) -> dict:
        return self._workspace_action("discard")

    def remove_group(self, group_id: str) -> dict:
        with self._lock, self._revision_connection() as connection:
            row = connection.execute(
                "SELECT position FROM DraftGroups WHERE group_id=?", (group_id,)
            ).fetchone()
            if not row:
                raise RevisionError("草稿操作组不存在", code="GROUP_NOT_FOUND", status=404)
            cursor = connection.execute("SELECT cursor FROM RevisionWorkspace WHERE id=1").fetchone()[0]
            position = row["position"]
            connection.execute("DELETE FROM DraftGroups WHERE group_id=?", (group_id,))
            connection.execute(
                "UPDATE DraftGroups SET position=position-1 WHERE position>?", (position,)
            )
            if position <= cursor:
                cursor -= 1
            connection.execute(
                "UPDATE RevisionWorkspace SET cursor=?,updated_at=? WHERE id=1", (cursor, utc_now())
            )
            connection.commit()
        return self.state()

    def _validate_changed_state(self, state: dict, operations: list[dict]) -> list[str]:
        errors = []
        changed_timepoints = {
            token(operation["target_id"])
            for operation in operations
            if operation["target_table"] == "Timepoints"
        }
        changed_relations = {
            token(operation["target_id"])
            for operation in operations
            if operation["target_table"] == "Relationships" and operation["action"] != "delete"
        }
        for point_id in changed_timepoints:
            row = state["Timepoints"].get(point_id)
            if not row:
                continue
            if row.get("event_type") not in EVENT_TYPES:
                errors.append(f"时间点 {point_id} 的事件类型无效")
            if row.get("lifecycle_effect") not in LIFECYCLE_EFFECTS:
                errors.append(f"时间点 {point_id} 的存废影响无效")
            for field, reverse in (("prev_id", "succ_id"), ("succ_id", "prev_id")):
                neighbor_id = row.get(field)
                if neighbor_id is None:
                    continue
                neighbor = state["Timepoints"].get(token(neighbor_id))
                if not neighbor:
                    errors.append(f"时间点 {point_id} 的 {field} 指向不存在记录")
                elif token(neighbor.get("entity_id")) != token(row.get("entity_id")):
                    errors.append(f"时间点 {point_id} 的链指针跨越了实体")
                elif token(neighbor.get(reverse)) != point_id:
                    errors.append(f"时间点 {point_id} 与 {neighbor_id} 的链指针不互反")
        for relation_id in changed_relations:
            row = state["Relationships"].get(relation_id)
            if not row:
                continue
            if row.get("relation_type") != "前后演变":
                errors.append(f"关系 {relation_id} 不是前后演变")
                continue
            source = state["Timepoints"].get(token(row.get("subject_id")))
            target = state["Timepoints"].get(token(row.get("object_id")))
            if not source or not target:
                errors.append(f"关系 {relation_id} 的端点不存在")
                continue
            source_entity = state["Entities"].get(token(source.get("entity_id")))
            target_entity = state["Entities"].get(token(target.get("entity_id")))
            if source_entity and target_entity and source_entity.get("type") != target_entity.get("type"):
                errors.append(f"关系 {relation_id} 两端实体类型不一致")
        return errors

    def preview(self) -> dict:
        with self._lock, self._revision_connection() as connection:
            operations = self._draft_operations(connection)
            state = self._materialize(connection, operations)
            errors = self._validate_changed_state(state, operations)
            base_state = self._materialize(connection, [])
            patch = {}
            for table, public_name in (
                ("Timepoints", "timepoints"),
                ("Relationships", "relationships"),
                ("Citations", "citations"),
                ("NormalizedTimes", "normalized_times"),
            ):
                base_rows = base_state[table]
                final_rows = state[table]
                upsert = [row for key, row in final_rows.items() if base_rows.get(key) != row]
                deleted = [base_rows[key][ROW_KEYS[table]] for key in base_rows.keys() - final_rows.keys()]
                patch[public_name] = {"upsert": upsert, "delete": deleted}
            normalized = {token(row["timepoint_id"]): row for row in patch["normalized_times"]["upsert"]}
            for row in patch["timepoints"]["upsert"]:
                row.update(normalized.get(token(row["id"]), {}))
            affected_entities = set()
            affected_years = set()
            for row in patch["timepoints"]["upsert"]:
                affected_entities.add(row.get("entity_id"))
                for key in ("year_start", "year_end"):
                    if isinstance(row.get(key), int):
                        affected_years.add(row[key])
            for operation in operations:
                if operation["target_table"] != "Timepoints":
                    continue
                for row in (operation.get("before"), operation.get("after")):
                    if not row:
                        continue
                    affected_entities.add(row.get("entity_id"))
                    normalized_row = self.normalizer(row.get("time") or "")
                    for key in ("year_start", "year_end"):
                        if isinstance(normalized_row.get(key), int):
                            affected_years.add(normalized_row[key])
            all_timepoints = state["Timepoints"]
            for row in patch["relationships"]["upsert"]:
                for field in ("subject_id", "object_id"):
                    point = all_timepoints.get(token(row.get(field)))
                    if point:
                        affected_entities.add(point.get("entity_id"))
                        normalized_row = state["NormalizedTimes"].get(token(point.get("id"))) or {}
                        for key in ("year_start", "year_end"):
                            if isinstance(normalized_row.get(key), int):
                                affected_years.add(normalized_row[key])
            for operation in operations:
                if operation["target_table"] != "Relationships":
                    continue
                for row in (operation.get("before"), operation.get("after")):
                    if not row:
                        continue
                    for field in ("subject_id", "object_id"):
                        point = all_timepoints.get(token(row.get(field)))
                        if not point:
                            continue
                        affected_entities.add(point.get("entity_id"))
                        normalized_row = state["NormalizedTimes"].get(token(point.get("id"))) or {}
                        for key in ("year_start", "year_end"):
                            if isinstance(normalized_row.get(key), int):
                                affected_years.add(normalized_row[key])
            differences = [
                {
                    "group_id": operation["group_id"],
                    "action": operation["action"],
                    "target_table": operation["target_table"],
                    "target_id": operation["target_id"],
                    "before": operation["before"],
                    "after": operation["after"],
                    "automatic": operation["automatic"],
                }
                for operation in operations
            ]
            return {
                "patch": patch,
                "differences": differences,
                "affected_entity_ids": sorted(value for value in affected_entities if value is not None),
                "affected_years": sorted(affected_years),
                "validation": {"valid": not errors, "errors": errors},
                "state": self.state(),
            }

    @staticmethod
    def _resolve_temp(value, temp_ids: dict[str, int]):
        if is_temp(value):
            if value not in temp_ids:
                raise RevisionError(f"临时 ID 尚未解析：{value}", code="UNRESOLVED_TEMP_ID")
            return temp_ids[value]
        return value

    def _resolve_row(self, row: dict | None, temp_ids: dict[str, int]) -> dict | None:
        if row is None:
            return None
        result = {}
        for key, value in row.items():
            if key in {"id", "timepoint_id", "entity_id", "prev_id", "succ_id", "subject_id", "object_id", "target_id"}:
                result[key] = self._resolve_temp(value, temp_ids) if value is not None else None
            else:
                result[key] = value
        return result

    def _backup(self) -> None:
        source = sqlite3.connect(f"file:{self.entries_db}?mode=ro", uri=True)
        target = sqlite3.connect(self.rollback_db)
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()
        shutil.copy2(self.revisions_db, self.rollback_revisions_db)

    def _apply_operations(
        self,
        connection: sqlite3.Connection,
        operations: list[dict],
    ) -> list[dict]:
        temp_ids: dict[str, int] = {}
        realized = []
        for operation in operations:
            table = operation["target_table"]
            key_name = ROW_KEYS[table]
            target_id = operation["target_id"]
            before = self._resolve_row(operation["before"], temp_ids)
            if operation["action"] == "insert" and is_temp(target_id) and target_id not in temp_ids:
                unresolved_after = dict(operation["after"] or {})
                unresolved_after.pop(key_name, None)
                after = self._resolve_row(unresolved_after, temp_ids)
            else:
                after = self._resolve_row(operation["after"], temp_ids)
            if operation["action"] in {"update", "delete"}:
                resolved_id = self._resolve_temp(target_id, temp_ids)
                current_row = connection.execute(
                    f'SELECT * FROM data."{table}" WHERE "{key_name}"=?', (resolved_id,)
                ).fetchone()
                current = dict(current_row) if current_row else None
                if current != before:
                    raise RevisionError(
                        f"{table} {resolved_id} 已变化，提交被拒绝",
                        code="STALE_BEFORE_VALUE",
                        status=409,
                    )
            if operation["action"] == "insert":
                insert_row = dict(after or {})
                preserve_id = not is_temp(target_id) or target_id in temp_ids
                if is_temp(target_id) and target_id not in temp_ids:
                    insert_row.pop(key_name, None)
                elif is_temp(target_id):
                    insert_row[key_name] = temp_ids[target_id]
                columns = [column for column in self._columns(connection, table, "data") if column in insert_row]
                placeholders = ",".join("?" for _ in columns)
                cursor = connection.execute(
                    f'INSERT INTO data."{table}" ({",".join(chr(34)+column+chr(34) for column in columns)}) '
                    f'VALUES ({placeholders})',
                    [insert_row[column] for column in columns],
                )
                actual_id = insert_row.get(key_name) if preserve_id else cursor.lastrowid
                if is_temp(target_id) and target_id not in temp_ids:
                    temp_ids[target_id] = actual_id
                after = dict(after or {})
                after[key_name] = actual_id
                after = self._resolve_row(after, temp_ids)
                resolved_id = actual_id
            elif operation["action"] == "update":
                resolved_id = self._resolve_temp(target_id, temp_ids)
                columns = [column for column in self._columns(connection, table, "data") if column != key_name]
                connection.execute(
                    f'UPDATE data."{table}" SET '
                    + ",".join(f'"{column}"=?' for column in columns)
                    + f' WHERE "{key_name}"=?',
                    [after.get(column) for column in columns] + [resolved_id],
                )
            else:
                resolved_id = self._resolve_temp(target_id, temp_ids)
                connection.execute(
                    f'DELETE FROM data."{table}" WHERE "{key_name}"=?', (resolved_id,)
                )
            realized.append({
                **operation,
                "target_id": token(resolved_id),
                "before": before,
                "after": after,
            })
        return realized

    def _database_checks(self, connection: sqlite3.Connection, realized: list[dict]) -> None:
        fk_rows = list(connection.execute("PRAGMA data.foreign_key_check"))
        if fk_rows:
            raise RevisionError(f"外键检查失败：{fk_rows[:3]}", code="FOREIGN_KEY_CHECK_FAILED")
        integrity = connection.execute("PRAGMA data.integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RevisionError(f"数据库完整性检查失败：{integrity}", code="INTEGRITY_CHECK_FAILED")
        orphan_citations = connection.execute(
            """
            SELECT COUNT(*) FROM data.Citations c
            WHERE (c.target_table='Entities' AND NOT EXISTS(
                    SELECT 1 FROM data.Entities e WHERE e.id=c.target_id))
               OR (c.target_table='Timepoints' AND NOT EXISTS(
                    SELECT 1 FROM data.Timepoints t WHERE t.id=c.target_id))
               OR (c.target_table='Relationships' AND NOT EXISTS(
                    SELECT 1 FROM data.Relationships r WHERE r.id=c.target_id))
               OR c.target_table NOT IN ('Entities','Timepoints','Relationships')
            """
        ).fetchone()[0]
        if orphan_citations:
            raise RevisionError("引用孤儿检查失败", code="ORPHAN_CITATION_CHECK_FAILED")
        chain_error = connection.execute(
            """
            SELECT COUNT(*) FROM data.Timepoints t
            LEFT JOIN data.Timepoints p ON p.id=t.prev_id
            LEFT JOIN data.Timepoints s ON s.id=t.succ_id
            WHERE (t.prev_id IS NOT NULL AND (p.id IS NULL OR p.succ_id IS NOT t.id))
               OR (t.succ_id IS NOT NULL AND (s.id IS NULL OR s.prev_id IS NOT t.id))
            """
        ).fetchone()[0]
        if chain_error:
            raise RevisionError("时间点链指针检查失败", code="CHAIN_CHECK_FAILED")
        changed_relation_ids = [
            int(operation["target_id"])
            for operation in realized
            if operation["target_table"] == "Relationships"
            and operation["action"] != "delete"
            and not operation["automatic"]
        ]
        for relation_id in changed_relation_ids:
            row = connection.execute(
                """
                SELECT r.relation_type, es.type, eo.type
                FROM data.Relationships r
                JOIN data.Timepoints s ON s.id=r.subject_id
                JOIN data.Timepoints o ON o.id=r.object_id
                JOIN data.Entities es ON es.id=s.entity_id
                JOIN data.Entities eo ON eo.id=o.entity_id
                WHERE r.id=?
                """,
                (relation_id,),
            ).fetchone()
            if not row or row[0] != "前后演变" or row[1] != row[2]:
                raise RevisionError("前后演变关系端点类型或方向非法", code="INVALID_RELATION_ENDPOINTS")
        if self._table_exists(connection, "NormalizedTimes", "data"):
            mismatch = connection.execute(
                """
                SELECT COUNT(*) FROM data.Timepoints t
                LEFT JOIN data.NormalizedTimes n ON n.timepoint_id=t.id
                WHERE n.timepoint_id IS NULL OR n.raw_time IS NOT t.time
                """
            ).fetchone()[0]
            orphan = connection.execute(
                """
                SELECT COUNT(*) FROM data.NormalizedTimes n
                LEFT JOIN data.Timepoints t ON t.id=n.timepoint_id WHERE t.id IS NULL
                """
            ).fetchone()[0]
            if mismatch or orphan:
                raise RevisionError("标准化时间与时间点不一致", code="NORMALIZED_TIME_MISMATCH")

    def commit(self, summary: str, *, reverts_hash: str | None = None, operations: list[dict] | None = None) -> dict:
        summary = str(summary or "").strip()
        if not summary:
            raise RevisionError("提交说明不能为空", code="SUMMARY_REQUIRED")
        with self._lock, self._revision_connection() as connection:
            self._assert_editable_state(connection)
            connection.commit()
            workspace = connection.execute("SELECT * FROM RevisionWorkspace WHERE id=1").fetchone()
            draft_operations = operations if operations is not None else self._draft_operations(connection)
            if not draft_operations:
                raise RevisionError("当前工作区没有可提交的修改", code="EMPTY_DRAFT")
            with self._entries_connection() as entries:
                current_fingerprint = self._content_fingerprint(entries)
            expected_base = workspace["base_fingerprint"] if operations is None else self._meta(connection, "expected_fingerprint")
            if current_fingerprint != expected_base:
                raise RevisionError("正式数据库已变化，提交被拒绝", code="BASE_VERSION_CONFLICT", status=409)
            self._backup()
            connection.execute("ATTACH DATABASE ? AS data", (str(self.entries_db),))
            try:
                connection.execute("PRAGMA data.journal_mode = DELETE")
                connection.execute("BEGIN IMMEDIATE")
                realized = self._apply_operations(connection, draft_operations)
                self._database_checks(connection, realized)
                parent = self._meta(connection, "head")
                operation_content = [
                    {
                        "group_id": operation["group_id"],
                        "action": operation["action"],
                        "target_table": operation["target_table"],
                        "target_id": operation["target_id"],
                        "before": operation["before"],
                        "after": operation["after"],
                        "automatic": operation["automatic"],
                    }
                    for operation in realized
                ]
                commit_hash = hashlib.sha256(
                    f"{parent}\n{canonical_json(operation_content)}".encode("utf-8")
                ).hexdigest()
                result_fingerprint = self._content_fingerprint(connection, "data")
                connection.execute(
                    """
                    INSERT INTO RevisionCommits(
                        hash,parent_hash,summary,created_at,reverts_hash,
                        operation_count,result_fingerprint,is_baseline
                    ) VALUES (?,?,?,?,?,?,?,0)
                    """,
                    (
                        commit_hash, parent, summary, utc_now(), reverts_hash,
                        len(realized), result_fingerprint,
                    ),
                )
                for order, operation in enumerate(realized, start=1):
                    connection.execute(
                        """
                        INSERT INTO RevisionOperations(
                            commit_hash,operation_order,group_id,action,target_table,target_id,
                            before_json,after_json,reason,automatic
                        ) VALUES (?,?,?,?,?,?,?,?,?,?)
                        """,
                        (
                            commit_hash, order, operation["group_id"], operation["action"],
                            operation["target_table"], operation["target_id"],
                            canonical_json(operation["before"]) if operation["before"] is not None else None,
                            canonical_json(operation["after"]) if operation["after"] is not None else None,
                            operation.get("reason", ""), int(operation["automatic"]),
                        ),
                    )
                if operations is None:
                    evidence_rows = list(connection.execute(
                        """
                        SELECT e.*,g.position FROM DraftEvidence e
                        JOIN DraftGroups g ON g.group_id=e.group_id
                        WHERE g.position <= ? ORDER BY g.position,e.evidence_order
                        """,
                        (workspace["cursor"],),
                    ))
                    for evidence_order, evidence in enumerate(evidence_rows, start=1):
                        connection.execute(
                            """
                            INSERT INTO RevisionEvidence(
                                commit_hash,evidence_order,group_id,mode,citation_id,
                                citation,quotation,note,conflict_flag
                            ) VALUES (?,?,?,?,?,?,?,?,?)
                            """,
                            (
                                commit_hash, evidence_order, evidence["group_id"], evidence["mode"],
                                evidence["citation_id"], evidence["citation"], evidence["quotation"],
                                evidence["note"], evidence["conflict_flag"],
                            ),
                        )
                        for operation_order, operation in enumerate(realized, start=1):
                            if operation["group_id"] == evidence["group_id"] and not operation["automatic"]:
                                connection.execute(
                                    "INSERT INTO RevisionOperationEvidence VALUES (?,?,?)",
                                    (commit_hash, operation_order, evidence_order),
                                )
                self._set_meta(connection, "head", commit_hash)
                self._set_meta(connection, "expected_fingerprint", result_fingerprint)
                connection.execute("DELETE FROM DraftGroups")
                connection.execute(
                    """
                    UPDATE RevisionWorkspace SET base_head=NULL,base_fingerprint=NULL,
                        base_marker=NULL,cursor=0,updated_at=? WHERE id=1
                    """,
                    (utc_now(),),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.execute("DETACH DATABASE data")
            marker = self._file_marker()
            self._set_meta(connection, "expected_marker", marker)
            connection.commit()
            return {"commit": self.get_commit(commit_hash), "state": self.state()}

    def list_commits(self, limit: int = 50) -> dict:
        with self._revision_connection() as connection:
            rows = connection.execute(
                """
                SELECT hash,parent_hash,summary,created_at,reverts_hash,operation_count,is_baseline
                FROM RevisionCommits ORDER BY rowid DESC LIMIT ?
                """,
                (max(1, min(int(limit), 200)),),
            )
            return {"commits": [dict(row) for row in rows], "head": self._meta(connection, "head")}

    def delete_commit(self, commit_hash: str) -> dict:
        """Undo and permanently remove the current HEAD commit."""
        with self._lock, self._revision_connection() as connection:
            self._assert_editable_state(connection)
            connection.commit()
            workspace = connection.execute(
                "SELECT cursor FROM RevisionWorkspace WHERE id=1"
            ).fetchone()
            draft_count = connection.execute("SELECT COUNT(*) FROM DraftGroups").fetchone()[0]
            if draft_count or workspace["cursor"]:
                raise RevisionError(
                    "工作区非空，不能删除提交历史",
                    code="DRAFT_NOT_EMPTY",
                    status=409,
                )
            commit_row = connection.execute(
                "SELECT * FROM RevisionCommits WHERE hash=?", (commit_hash,)
            ).fetchone()
            if not commit_row:
                raise RevisionError("提交不存在", code="COMMIT_NOT_FOUND", status=404)
            if commit_row["is_baseline"]:
                raise RevisionError("初始基线不能删除", code="BASELINE_DELETE_FORBIDDEN", status=409)
            if commit_hash != self._meta(connection, "head"):
                raise RevisionError(
                    "只能删除当前最新提交；中间提交仍被后续历史依赖",
                    code="NOT_HEAD_COMMIT",
                    status=409,
                )
            parent_hash = commit_row["parent_hash"]
            parent_row = connection.execute(
                "SELECT result_fingerprint FROM RevisionCommits WHERE hash=?", (parent_hash,)
            ).fetchone()
            if not parent_row:
                raise RevisionError("父提交不存在，不能删除", code="PARENT_COMMIT_NOT_FOUND", status=409)

            inverse = []
            rows = connection.execute(
                "SELECT * FROM RevisionOperations WHERE commit_hash=? ORDER BY operation_order DESC",
                (commit_hash,),
            )
            for row in rows:
                action = {"insert": "delete", "delete": "insert", "update": "update"}[row["action"]]
                before = json.loads(row["before_json"]) if row["before_json"] else None
                after = json.loads(row["after_json"]) if row["after_json"] else None
                inverse.append({
                    "group_id": f"delete:{commit_hash[:12]}",
                    "operation_order": len(inverse) + 1,
                    "action": action,
                    "target_table": row["target_table"],
                    "target_id": row["target_id"],
                    "before": after,
                    "after": before,
                    "automatic": True,
                    "reason": f"删除提交 {commit_hash[:12]}",
                })
            if not inverse:
                raise RevisionError("空提交不能删除", code="EMPTY_COMMIT", status=409)

            self._backup()
            connection.execute("ATTACH DATABASE ? AS data", (str(self.entries_db),))
            try:
                connection.execute("PRAGMA data.journal_mode = DELETE")
                connection.execute("BEGIN IMMEDIATE")
                realized = self._apply_operations(connection, inverse)
                self._database_checks(connection, realized)
                result_fingerprint = self._content_fingerprint(connection, "data")
                if result_fingerprint != parent_row["result_fingerprint"]:
                    raise RevisionError(
                        "撤销后的数据库与父版本不一致，删除已取消",
                        code="DELETE_RESULT_MISMATCH",
                        status=409,
                    )
                connection.execute(
                    "DELETE FROM RevisionOperationEvidence WHERE commit_hash=?", (commit_hash,)
                )
                connection.execute("DELETE FROM RevisionEvidence WHERE commit_hash=?", (commit_hash,))
                connection.execute("DELETE FROM RevisionOperations WHERE commit_hash=?", (commit_hash,))
                connection.execute("DELETE FROM RevisionCommits WHERE hash=?", (commit_hash,))
                self._set_meta(connection, "head", parent_hash)
                self._set_meta(connection, "expected_fingerprint", result_fingerprint)
                connection.execute(
                    """
                    UPDATE RevisionWorkspace SET base_head=NULL,base_fingerprint=NULL,
                        base_marker=NULL,cursor=0,updated_at=? WHERE id=1
                    """,
                    (utc_now(),),
                )
                connection.commit()
            except Exception:
                connection.rollback()
                raise
            finally:
                connection.execute("DETACH DATABASE data")
            marker = self._file_marker()
            self._set_meta(connection, "expected_marker", marker)
            connection.commit()
            return {
                "deleted_hash": commit_hash,
                "head": parent_hash,
                "state": self.state(),
            }

    def get_commit(self, commit_hash: str) -> dict:
        with self._revision_connection() as connection:
            commit = connection.execute(
                "SELECT * FROM RevisionCommits WHERE hash=?", (commit_hash,)
            ).fetchone()
            if not commit:
                raise RevisionError("提交不存在", code="COMMIT_NOT_FOUND", status=404)
            operations = []
            for row in connection.execute(
                "SELECT * FROM RevisionOperations WHERE commit_hash=? ORDER BY operation_order",
                (commit_hash,),
            ):
                operations.append({
                    "operation_order": row["operation_order"],
                    "group_id": row["group_id"],
                    "action": row["action"],
                    "target_table": row["target_table"],
                    "target_id": row["target_id"],
                    "before": json.loads(row["before_json"]) if row["before_json"] else None,
                    "after": json.loads(row["after_json"]) if row["after_json"] else None,
                    "reason": row["reason"],
                    "automatic": bool(row["automatic"]),
                })
            evidence = [dict(row) for row in connection.execute(
                "SELECT * FROM RevisionEvidence WHERE commit_hash=? ORDER BY evidence_order",
                (commit_hash,),
            )]
            return {**dict(commit), "operations": operations, "evidence": evidence}

    def _restore_operations(self, target_hash: str) -> list[dict]:
        with self._revision_connection() as connection:
            if not connection.execute(
                "SELECT 1 FROM RevisionCommits WHERE hash=?", (target_hash,)
            ).fetchone():
                raise RevisionError("目标版本不存在", code="COMMIT_NOT_FOUND", status=404)
            head = self._meta(connection, "head")
            commits = []
            cursor = head
            while cursor and cursor != target_hash:
                row = connection.execute(
                    "SELECT parent_hash FROM RevisionCommits WHERE hash=?", (cursor,)
                ).fetchone()
                if not row:
                    break
                commits.append(cursor)
                cursor = row["parent_hash"]
            if cursor != target_hash:
                raise RevisionError("目标版本不在当前线性历史中", code="NOT_ANCESTOR")
            inverse = []
            for commit_hash in commits:
                rows = list(connection.execute(
                    "SELECT * FROM RevisionOperations WHERE commit_hash=? ORDER BY operation_order DESC",
                    (commit_hash,),
                ))
                for row in rows:
                    action = {"insert": "delete", "delete": "insert", "update": "update"}[row["action"]]
                    before = json.loads(row["before_json"]) if row["before_json"] else None
                    after = json.loads(row["after_json"]) if row["after_json"] else None
                    inverse.append({
                        "group_id": f"restore:{target_hash[:12]}",
                        "operation_order": len(inverse) + 1,
                        "action": action,
                        "target_table": row["target_table"],
                        "target_id": row["target_id"],
                        "before": after,
                        "after": before,
                        "automatic": True,
                        "reason": f"恢复至版本 {target_hash[:12]}",
                    })
            return inverse

    def restore_preview(self, target_hash: str) -> dict:
        operations = self._restore_operations(target_hash)
        return {
            "target_hash": target_hash,
            "operation_count": len(operations),
            "operations": operations,
        }

    def restore(self, target_hash: str, summary: str | None = None) -> dict:
        state = self.state()
        if state["draft"]["group_count"] or state["draft"]["total_group_count"]:
            raise RevisionError("工作区非空，不能恢复历史版本", code="DRAFT_NOT_EMPTY", status=409)
        operations = self._restore_operations(target_hash)
        if not operations:
            raise RevisionError("当前已经是目标版本", code="ALREADY_AT_TARGET")
        return self.commit(
            summary or f"恢复至版本 {target_hash[:12]}",
            reverts_hash=target_hash,
            operations=operations,
        )
