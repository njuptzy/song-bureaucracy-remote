function idKey(value) {
  return String(value);
}

function normalizedTime(row = {}) {
  const keys = [
    "raw_time", "year_start", "year_end", "month", "is_leap_month", "day",
    "end_month", "end_is_leap_month", "end_day", "month_text", "day_text",
    "end_month_text", "end_day_text", "sort_order", "time_type", "parse_note",
  ];
  return Object.fromEntries(keys.map((key) => [key, row[key] ?? null]));
}

function timepointIndex(data) {
  const index = new Map();
  for (const bucketName of ["timepoints", "preSongTimepoints"]) {
    for (const [entityId, rows] of Object.entries(data?.[bucketName] || {})) {
      for (const row of rows || []) index.set(idKey(row.id), { row, entityId, bucketName });
    }
  }
  return index;
}

function relationPayload(row, points, revisionStatus = "") {
  const sourceEntry = points.get(idKey(row.subject_id));
  const targetEntry = points.get(idKey(row.object_id));
  const sourcePoint = sourceEntry?.row;
  const targetPoint = targetEntry?.row;
  return {
    ...row,
    source: sourcePoint?.entity_id ?? sourcePoint?.entityId
      ?? (sourceEntry?.entityId != null ? Number(sourceEntry.entityId) : null),
    target: targetPoint?.entity_id ?? targetPoint?.entityId
      ?? (targetEntry?.entityId != null ? Number(targetEntry.entityId) : null),
    source_timepoint_id: row.subject_id,
    target_timepoint_id: row.object_id,
    source_time: normalizedTime(sourcePoint),
    target_time: normalizedTime(targetPoint),
    display_relation_type: "前后演变（未分类）",
    classification_status: "unclassified",
    evidence_key: `R${row.id}`,
    _revision_status: revisionStatus || row._revision_status || "",
  };
}

function evolutionEdge(row, points, revisionStatus = "") {
  const sourceEntry = points.get(idKey(row.subject_id));
  const targetEntry = points.get(idKey(row.object_id));
  const sourcePoint = sourceEntry?.row;
  const targetPoint = targetEntry?.row;
  return {
    id: row.id,
    source: sourcePoint?.entity_id ?? sourcePoint?.entityId
      ?? (sourceEntry?.entityId != null ? Number(sourceEntry.entityId) : null),
    target: targetPoint?.entity_id ?? targetPoint?.entityId
      ?? (targetEntry?.entityId != null ? Number(targetEntry.entityId) : null),
    periods: [],
    states: [{
      id: row.id,
      subject_timepoint_id: row.subject_id,
      object_timepoint_id: row.object_id,
    }],
    _revision_status: revisionStatus || row._revision_status || "",
  };
}

function manualDifferenceMap(differences, table) {
  return new Map(
    (differences || [])
      .filter((item) => item.target_table === table && !item.automatic)
      .map((item) => [idKey(item.target_id), item]),
  );
}

function removeRowFromBuckets(buckets, rowId) {
  const key = idKey(rowId);
  for (const bucketName of ["timepoints", "preSongTimepoints"]) {
    for (const [entityId, rows] of Object.entries(buckets[bucketName])) {
      if (!(rows || []).some((row) => idKey(row.id) === key)) continue;
      buckets[bucketName][entityId] = rows.filter((row) => idKey(row.id) !== key);
    }
  }
}

function putTimepoint(buckets, row) {
  const entityId = idKey(row.entity_id ?? row.entityId);
  const bucketName = row.time_type === "pre_song" ? "preSongTimepoints" : "timepoints";
  const current = buckets[bucketName][entityId] || [];
  buckets[bucketName][entityId] = [...current, row];
}

function applyTimepointPatch(data, preview) {
  const patch = preview?.patch?.timepoints || { upsert: [], delete: [] };
  const buckets = {
    timepoints: { ...(data.timepoints || {}) },
    preSongTimepoints: { ...(data.preSongTimepoints || {}) },
  };
  const original = timepointIndex(data);
  const manual = manualDifferenceMap(preview?.differences, "Timepoints");

  for (const rowId of patch.delete || []) removeRowFromBuckets(buckets, rowId);
  for (const row of patch.upsert || []) {
    removeRowFromBuckets(buckets, row.id);
    const difference = manual.get(idKey(row.id));
    const status = difference?.action === "insert" ? "added"
      : difference?.action === "update" ? "modified" : "";
    putTimepoint(buckets, { ...row, _revision_status: status });
  }

  for (const difference of preview?.differences || []) {
    if (difference.target_table !== "Timepoints" || !difference.before) continue;
    if (difference.action === "delete") {
      putTimepoint(buckets, {
        ...difference.before,
        id: `deleted:${difference.target_id}`,
        _revision_original_id: difference.target_id,
        _revision_status: "deleted",
      });
    } else if (difference.action === "update" && !difference.automatic) {
      const before = difference.before;
      const after = difference.after || {};
      if (before.time !== after.time) {
        putTimepoint(buckets, {
          ...before,
          ...(original.get(idKey(difference.target_id))?.row || {}),
          id: `before:${difference.target_id}`,
          prev_id: null,
          succ_id: null,
          _revision_original_id: difference.target_id,
          _revision_status: "before",
        });
      }
    }
  }
  return buckets;
}

function applyRelationPatch(data, preview, points) {
  const patch = preview?.patch?.relationships || { upsert: [], delete: [] };
  const deleted = new Set((patch.delete || []).map(idKey));
  const upserts = new Map((patch.upsert || []).map((row) => [idKey(row.id), row]));
  const manual = manualDifferenceMap(preview?.differences, "Relationships");
  const changeRelations = (data.changeRelations || [])
    .filter((row) => !deleted.has(idKey(row.id)) && !upserts.has(idKey(row.id)))
    .map((row) => ({ ...row }));
  const evolutionEdges = (data.evolutionEdges || [])
    .filter((row) => !deleted.has(idKey(row.id)) && !upserts.has(idKey(row.id)))
    .map((row) => ({ ...row }));

  for (const row of upserts.values()) {
    if (row.relation_type !== "前后演变") continue;
    const difference = manual.get(idKey(row.id));
    const status = difference?.action === "insert" ? "added"
      : difference?.action === "update" ? "modified" : "";
    changeRelations.push(relationPayload(row, points, status));
    evolutionEdges.push(evolutionEdge(row, points, status));
  }
  for (const difference of preview?.differences || []) {
    if (difference.target_table !== "Relationships" || !difference.before) continue;
    if (!difference.automatic && difference.action === "update") {
      const before = {
        ...difference.before,
        id: `before:${difference.target_id}`,
        _revision_original_id: difference.target_id,
      };
      changeRelations.push(relationPayload(before, points, "before"));
      evolutionEdges.push(evolutionEdge(before, points, "before"));
    } else if (difference.action === "delete") {
      const before = {
        ...difference.before,
        id: `deleted:${difference.target_id}`,
        _revision_original_id: difference.target_id,
      };
      changeRelations.push(relationPayload(before, points, "deleted"));
      evolutionEdges.push(evolutionEdge(before, points, "deleted"));
    }
  }
  return { changeRelations, evolutionEdges };
}

function citationKey(row) {
  return `${row.target_table === "Timepoints" ? "T" : "R"}${row.target_id}`;
}

function applyCitationPatch(data, preview) {
  const patch = preview?.patch?.citations || { upsert: [], delete: [] };
  const result = { ...(data.citations || {}) };
  const deleted = new Set((patch.delete || []).map(idKey));
  for (const [key, rows] of Object.entries(result)) {
    if ((rows || []).some((row) => deleted.has(idKey(row.id)))) {
      result[key] = rows.filter((row) => !deleted.has(idKey(row.id)));
    }
  }
  for (const row of patch.upsert || []) {
    for (const [key, rows] of Object.entries(result)) {
      if ((rows || []).some((item) => idKey(item.id) === idKey(row.id))) {
        result[key] = rows.filter((item) => idKey(item.id) !== idKey(row.id));
      }
    }
    const key = citationKey(row);
    result[key] = [...(result[key] || []), { ...row }];
  }
  return result;
}

/** Apply only the server-provided revision delta; untouched data keeps identity. */
export function applyRevisionPreview(data, preview) {
  if (!data || !preview?.patch) return data;
  const buckets = applyTimepointPatch(data, preview);
  const withTimepoints = { ...data, ...buckets };
  const points = timepointIndex(withTimepoints);
  return {
    ...withTimepoints,
    ...applyRelationPatch(data, preview, points),
    citations: applyCitationPatch(data, preview),
    revisionPreview: {
      differences: preview.differences || [],
      affectedEntityIds: preview.affected_entity_ids || [],
      affectedYears: preview.affected_years || [],
    },
  };
}
