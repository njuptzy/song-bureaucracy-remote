function validSourceOrder(entity) {
  const value = Number(entity?.source_order);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function compareEntityIds(firstId, secondId) {
  const firstNumber = Number(firstId);
  const secondNumber = Number(secondId);
  if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
    return firstNumber - secondNumber;
  }
  return String(firstId ?? "").localeCompare(String(secondId ?? ""), "zh", { numeric: true });
}

export function compareInstitutionsBySourceOrder(first, second) {
  const firstOrder = validSourceOrder(first);
  const secondOrder = validSourceOrder(second);
  if (firstOrder !== null || secondOrder !== null) {
    if (firstOrder === null) return 1;
    if (secondOrder === null) return -1;
    if (firstOrder !== secondOrder) return firstOrder - secondOrder;
  }

  const titleOrder = String(first?.title || "").localeCompare(
    String(second?.title || ""),
    "zh",
  );
  return titleOrder || compareEntityIds(first?.id, second?.id);
}

export function compareInstitutionIdsBySourceOrder(entityMap, firstId, secondId) {
  return compareInstitutionsBySourceOrder(entityMap.get(firstId), entityMap.get(secondId));
}
