const fs = require('fs');

class PathParser {
  static parse(pathStr) {
    const segments = [];
    let i = 0;

    while (i < pathStr.length) {
      if (pathStr[i] === '.') {
        i++;
        continue;
      }

      if (pathStr[i] === '[') {
        const endBracket = pathStr.indexOf(']', i);
        if (endBracket === -1) {
          throw new Error(`Invalid path syntax: unmatched '[' at position ${i}`);
        }
        const indexStr = pathStr.slice(i + 1, endBracket);
        const index = parseInt(indexStr, 10);
        if (isNaN(index) || index < 0) {
          throw new Error(`Invalid array index: '${indexStr}' at position ${i + 1}`);
        }
        segments.push({ type: 'index', value: index });
        i = endBracket + 1;
        continue;
      }

      let keyStart = i;
      let key = '';

      while (i < pathStr.length && pathStr[i] !== '.' && pathStr[i] !== '[') {
        key += pathStr[i];
        i++;
      }

      if (key === '') {
        if (keyStart === 0) {
          throw new Error(`Invalid path syntax: path cannot start with '.' or '['`);
        } else {
          throw new Error(`Invalid path syntax: empty key segment at position ${keyStart}`);
        }
      }

      segments.push({ type: 'key', value: key });
    }

    return segments;
  }

  static segmentsToString(segments) {
    let result = '';
    for (const seg of segments) {
      if (seg.type === 'key') {
        if (result !== '') result += '.';
        result += seg.value;
      } else if (seg.type === 'index') {
        result += `[${seg.value}]`;
      }
    }
    return result;
  }
}

function getValue(data, pathStr) {
  const segments = PathParser.parse(pathStr);
  let current = data;
  let pathSoFar = '';

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segStr = segments.slice(0, i + 1).map(s => s.type === 'key' ? s.value : `[${s.value}]`).join('.');

    if (seg.type === 'key') {
      if (current === null || current === undefined || typeof current !== 'object' || Array.isArray(current) || current instanceof Date) {
        throw new Error(`Cannot access key '${seg.value}' at '${pathSoFar || "(root)"}': value is not an object`);
      }
      if (!(seg.value in current)) {
        return { found: false, value: undefined, path: pathStr };
      }
      current = current[seg.value];
    } else if (seg.type === 'index') {
      if (!Array.isArray(current)) {
        throw new Error(`Cannot access index [${seg.value}] at '${pathSoFar || "(root)"}': value is not an array`);
      }
      if (seg.value >= current.length || seg.value < 0) {
        return { found: false, value: undefined, path: pathStr };
      }
      current = current[seg.value];
    }

    pathSoFar = segStr;
  }

  return { found: true, value: current, path: pathStr };
}

function setValue(data, pathStr, value) {
  const segments = PathParser.parse(pathStr);
  if (segments.length === 0) {
    throw new Error('Path cannot be empty');
  }

  const lastSeg = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);

  let current = data;
  let parent = null;
  let parentPath = '';

  for (let i = 0; i < parentSegments.length; i++) {
    const seg = parentSegments[i];

    if (seg.type === 'key') {
      if (current === null || current === undefined || typeof current !== 'object' || Array.isArray(current) || current instanceof Date) {
        current = {};
        if (parent !== null) {
          const prevSeg = parentSegments[i - 1];
          if (prevSeg.type === 'key') {
            parent[prevSeg.value] = current;
          } else {
            parent[prevSeg.value] = current;
          }
        }
      }
      if (!(seg.value in current) || current[seg.value] === null || current[seg.value] === undefined ||
          (typeof current[seg.value] !== 'object') || Array.isArray(current[seg.value]) === false && i + 1 < parentSegments.length && parentSegments[i + 1].type === 'index') {
        const nextSeg = i + 1 < parentSegments.length ? parentSegments[i + 1] : lastSeg;
        current[seg.value] = nextSeg.type === 'index' ? [] : {};
      }
      parent = current;
      current = current[seg.value];
    } else if (seg.type === 'index') {
      if (!Array.isArray(current)) {
        current = [];
        if (parent !== null) {
          const prevSeg = parentSegments[i - 1];
          if (prevSeg.type === 'key') {
            parent[prevSeg.value] = current;
          } else {
            parent[prevSeg.value] = current;
          }
        }
      }
      while (current.length <= seg.value) {
        const nextSeg = i + 1 < parentSegments.length ? parentSegments[i + 1] : lastSeg;
        current.push(nextSeg.type === 'index' ? [] : {});
      }
      parent = current;
      current = current[seg.value];
    }
  }

  if (parentSegments.length === 0) {
    if (lastSeg.type === 'key') {
      if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data) || data instanceof Date) {
        throw new Error('Cannot set key on non-object root value');
      }
      data[lastSeg.value] = value;
    } else {
      if (!Array.isArray(data)) {
        throw new Error('Cannot set index on non-array root value');
      }
      while (data.length <= lastSeg.value) {
        data.push(undefined);
      }
      data[lastSeg.value] = value;
    }
  } else {
    if (lastSeg.type === 'key') {
      if (current === null || current === undefined || typeof current !== 'object' || Array.isArray(current) || current instanceof Date) {
        current = {};
        const prevSeg = parentSegments[parentSegments.length - 1];
        if (prevSeg.type === 'key') {
          parent[prevSeg.value] = current;
        } else {
          parent[prevSeg.value] = current;
        }
      }
      current[lastSeg.value] = value;
    } else {
      if (!Array.isArray(current)) {
        current = [];
        const prevSeg = parentSegments[parentSegments.length - 1];
        if (prevSeg.type === 'key') {
          parent[prevSeg.value] = current;
        } else {
          parent[prevSeg.value] = current;
        }
      }
      while (current.length <= lastSeg.value) {
        current.push(undefined);
      }
      current[lastSeg.value] = value;
    }
  }

  return data;
}

function deleteValue(data, pathStr) {
  const segments = PathParser.parse(pathStr);
  if (segments.length === 0) {
    throw new Error('Path cannot be empty');
  }

  const lastSeg = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);

  let current = data;

  for (let i = 0; i < parentSegments.length; i++) {
    const seg = parentSegments[i];
    if (seg.type === 'key') {
      if (current === null || current === undefined || typeof current !== 'object' || Array.isArray(current) || current instanceof Date) {
        return { deleted: false, value: undefined, path: pathStr };
      }
      if (!(seg.value in current)) {
        return { deleted: false, value: undefined, path: pathStr };
      }
      current = current[seg.value];
    } else if (seg.type === 'index') {
      if (!Array.isArray(current)) {
        return { deleted: false, value: undefined, path: pathStr };
      }
      if (seg.value >= current.length) {
        return { deleted: false, value: undefined, path: pathStr };
      }
      current = current[seg.value];
    }
  }

  let deletedValue;
  let deleted = false;

  if (parentSegments.length === 0) {
    if (lastSeg.type === 'key') {
      if (data !== null && data !== undefined && typeof data === 'object' && !Array.isArray(data) && !(data instanceof Date) && lastSeg.value in data) {
        deletedValue = data[lastSeg.value];
        delete data[lastSeg.value];
        deleted = true;
      }
    } else {
      if (Array.isArray(data) && lastSeg.value >= 0 && lastSeg.value < data.length) {
        deletedValue = data[lastSeg.value];
        data.splice(lastSeg.value, 1);
        deleted = true;
      }
    }
  } else {
    if (lastSeg.type === 'key') {
      if (current !== null && current !== undefined && typeof current === 'object' && !Array.isArray(current) && !(current instanceof Date) && lastSeg.value in current) {
        deletedValue = current[lastSeg.value];
        delete current[lastSeg.value];
        deleted = true;
      }
    } else {
      if (Array.isArray(current) && lastSeg.value >= 0 && lastSeg.value < current.length) {
        deletedValue = current[lastSeg.value];
        current.splice(lastSeg.value, 1);
        deleted = true;
      }
    }
  }

  return { deleted: deleted, value: deletedValue, path: pathStr };
}

function inferValueType(strValue) {
  if (strValue === null || strValue === undefined) {
    return { type: 'null', value: null };
  }

  const trimmed = String(strValue).trim();

  if (trimmed === 'null' || trimmed === 'NULL') {
    return { type: 'null', value: null };
  }

  if (trimmed === 'true' || trimmed === 'TRUE') {
    return { type: 'boolean', value: true };
  }
  if (trimmed === 'false' || trimmed === 'FALSE') {
    return { type: 'boolean', value: false };
  }

  if (/^-?\d+$/.test(trimmed)) {
    const intVal = parseInt(trimmed, 10);
    return { type: 'integer', value: intVal };
  }

  if (/^-?\d+\.\d+$/.test(trimmed) || /^-?\d+e[+-]?\d+$/i.test(trimmed)) {
    const floatVal = parseFloat(trimmed);
    return { type: 'number', value: floatVal };
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return { type: 'string', value: trimmed.slice(1, -1) };
  }

  return { type: 'string', value: trimmed };
}

function parseExplicitType(strValue, typeName) {
  const trimmed = String(strValue).trim();

  switch (typeName.toLowerCase()) {
    case 'string':
    case 'str':
      return { type: 'string', value: trimmed };
    case 'integer':
    case 'int':
      if (!/^-?\d+$/.test(trimmed)) {
        throw new Error(`Invalid integer value: '${trimmed}'`);
      }
      return { type: 'integer', value: parseInt(trimmed, 10) };
    case 'number':
    case 'float':
    case 'double':
      if (!/^-?(\d+\.?\d*|\d*\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
        throw new Error(`Invalid number value: '${trimmed}'`);
      }
      return { type: 'number', value: parseFloat(trimmed) };
    case 'boolean':
    case 'bool':
      if (trimmed === 'true' || trimmed === 'TRUE' || trimmed === '1') {
        return { type: 'boolean', value: true };
      }
      if (trimmed === 'false' || trimmed === 'FALSE' || trimmed === '0') {
        return { type: 'boolean', value: false };
      }
      throw new Error(`Invalid boolean value: '${trimmed}' (use true/false)`);
    case 'null':
    case 'nil':
    case 'none':
      return { type: 'null', value: null };
    case 'json':
      try {
        return { type: 'json', value: JSON.parse(trimmed) };
      } catch (e) {
        throw new Error(`Invalid JSON value: ${e.message}`);
      }
    default:
      throw new Error(`Unknown type: '${typeName}'. Supported types: string, integer, number, boolean, null, json`);
  }
}

function formatValueForDisplay(value) {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === 'object' || Array.isArray(value)) {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}

function getValueType(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (value instanceof Date) return 'datetime';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

module.exports = {
  PathParser,
  getValue,
  setValue,
  deleteValue,
  inferValueType,
  parseExplicitType,
  formatValueForDisplay,
  getValueType
};
