export function anchorBranchToGroup(groupCenterX, groupTreeX, focusTreeX) {
  return groupCenterX - (focusTreeX - groupTreeX);
}

export function virtualBusRange(sourceX, targetXs) {
  const xs = [sourceX, ...targetXs];
  return [Math.min(...xs), Math.max(...xs)];
}

export function virtualBusY(sourceBottom, targetTop, depth = 0, offset = 18) {
  const midpoint = (sourceBottom + targetTop) / 2;
  // 制度组与首层机构之间的垂直间隔很窄，向下错层会把总线压到
  // 机构顶部的装饰边框上；该层使用真正的中点，深层总线再错层。
  const signedOffset = depth === 0
    ? -Math.abs(offset)
    : depth === 1
      ? 0
      : Math.abs(offset);
  const low = Math.min(sourceBottom, targetTop);
  const high = Math.max(sourceBottom, targetTop);
  const clearance = Math.min(12, Math.max(0, (high - low) / 3));
  return Math.max(
    low + clearance,
    Math.min(high - clearance, midpoint + signedOffset),
  );
}

export function subordinateGroupAncestorId(node) {
  let current = node;
  while (current) {
    if (current.data?.isSubordinateGroup) return current.data.id ?? null;
    current = current.parent;
  }
  return null;
}

export function hierarchyNodeGap(
  a,
  b,
  { sibling = 18, cousin = 30, subordinateGroup = 64 } = {},
) {
  const aGroupId = subordinateGroupAncestorId(a);
  const bGroupId = subordinateGroupAncestorId(b);
  if (aGroupId != null && bGroupId != null && aGroupId !== bGroupId) {
    return subordinateGroup;
  }
  return a?.parent === b?.parent ? sibling : cousin;
}

export function fitRangeShift(contentLeft, contentRight, viewportLeft, viewportRight) {
  const contentWidth = contentRight - contentLeft;
  const viewportWidth = viewportRight - viewportLeft;
  if (contentWidth > viewportWidth) {
    return (viewportLeft + viewportRight - contentLeft - contentRight) / 2;
  }
  if (contentLeft < viewportLeft) return viewportLeft - contentLeft;
  if (contentRight > viewportRight) return viewportRight - contentRight;
  return 0;
}

export function horizontalRangesFit(ranges, viewportLeft, viewportRight, gap = 18) {
  const ordered = [...ranges].sort((a, b) => a.left - b.left);
  if (ordered.some((range) => range.left < viewportLeft || range.right > viewportRight)) {
    return false;
  }
  return ordered.every((range, index) => (
    index === 0 || range.left - ordered[index - 1].right >= gap
  ));
}

export function packHorizontalRanges(ranges, gap = 18) {
  const ordered = [...ranges]
    .map((range) => ({ ...range }))
    .sort((a, b) => a.left - b.left || a.right - b.right);
  if (ordered.length <= 1) return ordered;

  const preferredCenter = (
    Math.min(...ordered.map((range) => range.left))
    + Math.max(...ordered.map((range) => range.right))
  ) / 2;
  let cursorRight = -Infinity;
  for (const range of ordered) {
    const width = Math.max(0, range.right - range.left);
    range.left = Math.max(range.left, cursorRight + gap);
    range.right = range.left + width;
    cursorRight = range.right;
  }

  const packedCenter = (ordered[0].left + ordered.at(-1).right) / 2;
  const centerShift = preferredCenter - packedCenter;
  return ordered.map((range) => ({
    ...range,
    left: range.left + centerShift,
    right: range.right + centerShift,
  }));
}

// 按输入顺序向一个方向推开重叠范围。后续范围继承同一累计位移，
// 因而同一方向上的节点始终一起移动，不会被分别重新打包。
export function pushOverlappingRanges(ranges, gap = 18) {
  let cumulativeOffset = 0;
  let previousRight = -Infinity;
  return (ranges || []).map((range) => {
    const left = range.left + cumulativeOffset;
    if (Number.isFinite(previousRight) && left < previousRight + gap) {
      cumulativeOffset += previousRight + gap - left;
    }
    const next = {
      ...range,
      left: range.left + cumulativeOffset,
      right: range.right + cumulativeOffset,
      offset: cumulativeOffset,
    };
    previousRight = next.right;
    return next;
  });
}

export function buildHierarchyEdgeIndex(edges = []) {
  const normalizedEdges = Array.isArray(edges) ? edges : [];
  const childrenByParent = new Map();
  for (const edge of normalizedEdges) {
    if (edge?.parent == null) continue;
    const children = childrenByParent.get(edge.parent);
    if (children) children.push(edge);
    else childrenByParent.set(edge.parent, [edge]);
  }

  const subtreeIdsByRoot = new Map();
  return {
    edges: normalizedEdges,
    childrenFor(parentId) {
      return childrenByParent.get(parentId) || [];
    },
    subtreeIds(rootId) {
      if (subtreeIdsByRoot.has(rootId)) return subtreeIdsByRoot.get(rootId);
      const result = [];
      const queue = [rootId];
      const visited = new Set();
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const entityId = queue[cursor];
        if (visited.has(entityId)) continue;
        visited.add(entityId);
        result.push(entityId);
        for (const edge of childrenByParent.get(entityId) || []) {
          if (!visited.has(edge.child)) queue.push(edge.child);
        }
      }
      subtreeIdsByRoot.set(rootId, result);
      return result;
    },
  };
}

export function panScrollbarGeometry({
  viewportSize,
  contentSize,
  minPan,
  maxPan,
  currentPan,
  minThumbSize = 42,
}) {
  const panRange = Math.max(0, maxPan - minPan);
  const enabled = contentSize > viewportSize && panRange > 0;
  if (!enabled) {
    return { enabled: false, thumbSize: viewportSize, thumbTravel: 0, thumbOffset: 0 };
  }
  const thumbSize = Math.max(
    minThumbSize,
    Math.min(viewportSize, viewportSize * viewportSize / contentSize)
  );
  const thumbTravel = viewportSize - thumbSize;
  const clampedPan = Math.max(minPan, Math.min(maxPan, currentPan));
  const thumbOffset = (maxPan - clampedPan) / panRange * thumbTravel;
  return { enabled, thumbSize, thumbTravel, thumbOffset };
}

export function panFromScrollbarOffset(offset, thumbTravel, minPan, maxPan) {
  if (thumbTravel <= 0) return maxPan;
  const clampedOffset = Math.max(0, Math.min(thumbTravel, offset));
  return maxPan - clampedOffset / thumbTravel * (maxPan - minPan);
}

export function focusPanToCenter(nodeX, viewportCenter, minPan, maxPan) {
  const desiredPan = viewportCenter - nodeX;
  return Math.max(minPan, Math.min(maxPan, desiredPan));
}

export function isHorizontalWheelGesture({
  deltaX = 0,
  deltaY = 0,
  shiftKey = false,
  ctrlKey = false,
} = {}) {
  if (ctrlKey) return false;
  const horizontalDelta = Math.abs(Number(deltaX) || 0);
  const verticalDelta = Math.abs(Number(deltaY) || 0);
  return Boolean(shiftKey) || (horizontalDelta > 0 && horizontalDelta >= verticalDelta);
}

function matrixAttributes(matrix) {
  return {
    a: matrix.a,
    b: matrix.b,
    c: matrix.c,
    d: matrix.d,
    e: matrix.e,
    f: matrix.f,
  };
}

export function relativeAffineMatrix(rootMatrix, elementMatrix) {
  if (!elementMatrix) return null;
  if (!rootMatrix) return matrixAttributes(elementMatrix);
  const determinant = rootMatrix.a * rootMatrix.d - rootMatrix.b * rootMatrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    return matrixAttributes(elementMatrix);
  }
  const inverse = {
    a: rootMatrix.d / determinant,
    b: -rootMatrix.b / determinant,
    c: -rootMatrix.c / determinant,
    d: rootMatrix.a / determinant,
    e: (rootMatrix.c * rootMatrix.f - rootMatrix.d * rootMatrix.e) / determinant,
    f: (rootMatrix.b * rootMatrix.e - rootMatrix.a * rootMatrix.f) / determinant,
  };
  return {
    a: inverse.a * elementMatrix.a + inverse.c * elementMatrix.b,
    b: inverse.b * elementMatrix.a + inverse.d * elementMatrix.b,
    c: inverse.a * elementMatrix.c + inverse.c * elementMatrix.d,
    d: inverse.b * elementMatrix.c + inverse.d * elementMatrix.d,
    e: inverse.a * elementMatrix.e + inverse.c * elementMatrix.f + inverse.e,
    f: inverse.b * elementMatrix.e + inverse.d * elementMatrix.f + inverse.f,
  };
}
