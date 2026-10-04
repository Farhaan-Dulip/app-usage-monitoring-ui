// In-memory evaluation of the small MongoDB query subset the portal uses, so a
// key-value store (DynamoDB) can stand in for MongoDB collections. Supported:
// field equality, RegExp values, $in / $nin (values or RegExps), $gt / $gte /
// $lt / $lte, top-level $or / $and, sort specs and inclusion/exclusion projections.

function comparable(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && typeof value.toHexString === 'function') return value.toHexString();
  return value;
}

function valueMatches(actual, expected) {
  if (expected instanceof RegExp) return typeof actual === 'string' && expected.test(actual);
  return comparable(actual) === comparable(expected);
}

function conditionMatches(actual, condition) {
  if (condition instanceof RegExp || condition === null || typeof condition !== 'object'
    || condition instanceof Date || typeof condition.toHexString === 'function') {
    return valueMatches(actual, condition);
  }
  return Object.entries(condition).every(([operator, operand]) => {
    const value = comparable(actual);
    switch (operator) {
      case '$in': return operand.some((candidate) => valueMatches(actual, candidate));
      case '$nin': return !operand.some((candidate) => valueMatches(actual, candidate));
      case '$gt': return value !== undefined && value > comparable(operand);
      case '$gte': return value !== undefined && value >= comparable(operand);
      case '$lt': return value !== undefined && value < comparable(operand);
      case '$lte': return value !== undefined && value <= comparable(operand);
      case '$ne': return !valueMatches(actual, operand);
      default: throw new Error(`Unsupported query operator ${operator}`);
    }
  });
}

export function matchesFilter(document, filter = {}) {
  return Object.entries(filter).every(([field, condition]) => {
    if (field === '$or') return condition.some((branch) => matchesFilter(document, branch));
    if (field === '$and') return condition.every((branch) => matchesFilter(document, branch));
    return conditionMatches(document?.[field], condition);
  });
}

export function sortDocuments(documents, spec = {}) {
  const fields = Object.entries(spec);
  if (!fields.length) return documents;
  return [...documents].sort((first, second) => {
    for (const [field, direction] of fields) {
      const a = comparable(first?.[field]);
      const b = comparable(second?.[field]);
      if (a === b) continue;
      if (a === undefined || a === null) return -direction;
      if (b === undefined || b === null) return direction;
      return (a < b ? -1 : 1) * direction;
    }
    return 0;
  });
}

export function projectDocument(document, projection) {
  if (!projection || !Object.keys(projection).length) return document;
  const entries = Object.entries(projection);
  const inclusive = entries.some(([field, flag]) => flag && field !== '_id');
  if (inclusive) {
    const result = {};
    if (projection._id !== 0 && '_id' in document) result._id = document._id;
    entries.forEach(([field, flag]) => {
      if (flag && field in document) result[field] = document[field];
    });
    return result;
  }
  const result = { ...document };
  entries.forEach(([field, flag]) => {
    if (!flag) delete result[field];
  });
  return result;
}

// Applies the update operators the portal uses ($set, $setOnInsert, $unset).
export function applyUpdate(document, update, { inserting = false } = {}) {
  const result = { ...document };
  Object.entries(update).forEach(([operator, fields]) => {
    if (operator === '$set') Object.assign(result, fields);
    else if (operator === '$setOnInsert') { if (inserting) Object.assign(result, fields); }
    else if (operator === '$unset') Object.keys(fields).forEach((field) => delete result[field]);
    else throw new Error(`Unsupported update operator ${operator}`);
  });
  return result;
}

// Fields with plain equality in a filter become the inserted document on upsert.
export function equalityFields(filter = {}) {
  return Object.fromEntries(
    Object.entries(filter).filter(([field, value]) =>
      !field.startsWith('$') && (value === null || typeof value !== 'object' || value instanceof Date
        || typeof value.toHexString === 'function'))
  );
}

// DynamoDB cannot store Dates or class instances; keep JSON-equivalent values.
export function toStorable(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && typeof value.toHexString === 'function') return value.toHexString();
  if (Array.isArray(value)) return value.map(toStorable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, toStorable(item)])
    );
  }
  return value;
}
