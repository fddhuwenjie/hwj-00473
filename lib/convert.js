function flattenArraysForINI(obj, prefix = '') {
  const result = {};
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const flat = flattenArraysForINI(item, `${prefix}${i}.`);
        Object.assign(result, flat);
      } else if (Array.isArray(item)) {
        const flat = flattenArraysForINI(item, `${prefix}${i}.`);
        Object.assign(result, flat);
      } else {
        result[`${prefix}${i}`] = item;
      }
    }
    return result;
  }

  if (typeof obj === 'object' && obj !== null) {
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const newPrefix = prefix ? `${prefix}${key}` : key;
      if (Array.isArray(value)) {
        if (value.length > 0 && value.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
          result[key] = value.map(item => flattenArraysForINI(item));
        } else {
          const flat = flattenArraysForINI(value, `${newPrefix}.`);
          Object.assign(result, flat);
        }
      } else if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
        result[key] = flattenArraysForINI(value, `${newPrefix}.`);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  return obj;
}

function prepareForFormat(obj, toFormat) {
  let result = deepClone(obj);

  if (toFormat === 'ini') {
    result = flattenArraysForINI(result);
  }

  if (toFormat === 'dotenv') {
    result = flattenForDotEnv(result);
  }

  if (toFormat === 'xml') {
    result = prepareForXML(result);
  }

  return result;
}

function flattenForDotEnv(obj, prefix = '') {
  const result = {};
  if (typeof obj === 'object' && obj !== null && !Array.isArray(obj) && !(obj instanceof Date)) {
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const newPrefix = prefix ? `${prefix}_${key}` : key;
      if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
        Object.assign(result, flattenForDotEnv(value, newPrefix));
      } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          const itemKey = `${newPrefix}_${i}`;
          if (typeof item === 'object' && item !== null && !Array.isArray(item) && !(item instanceof Date)) {
            Object.assign(result, flattenForDotEnv(item, itemKey));
          } else {
            result[itemKey] = item;
          }
        }
      } else {
        result[newPrefix] = value;
      }
    }
  }
  return result;
}

function prepareForXML(obj) {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { root: obj };
  }
  const keys = Object.keys(obj);
  if (keys.length === 1 && !keys[0].startsWith('@')) {
    return obj;
  }
  return { root: obj };
}

function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Date) return new Date(obj);
  if (Array.isArray(obj)) return obj.map(deepClone);
  const result = {};
  for (const key of Object.keys(obj)) {
    result[key] = deepClone(obj[key]);
  }
  return result;
}

function semanticDiff(original, converted, path = '') {
  const differences = [];

  if (typeof original !== typeof converted) {
    if (original instanceof Date && typeof converted === 'string') {
      const d = new Date(converted);
      if (isNaN(d.getTime()) || d.getTime() !== original.getTime()) {
        differences.push({ path, original, converted, type: 'datetime-precision', message: 'Datetime conversion precision loss' });
      }
      return differences;
    }
    if (typeof original === 'number' && typeof converted === 'string') {
      const n = Number(converted);
      if (isNaN(n) || n !== original) {
        differences.push({ path, original, converted, type: 'type-change', message: `Type changed from ${typeof original} to string` });
      }
      return differences;
    }
    if (typeof original === 'boolean' && typeof converted === 'string') {
      if (converted !== String(original)) {
        differences.push({ path, original, converted, type: 'type-change', message: `Type changed from boolean to string` });
      }
      return differences;
    }
    differences.push({ path, original, converted, type: 'type-change', message: `Type changed from ${typeof original} to ${typeof converted}` });
    return differences;
  }

  if (typeof original === 'number' && typeof converted === 'number') {
    if (original !== converted) {
      if (Math.abs(original - converted) < 1e-10) {
        differences.push({ path, original, converted, type: 'precision', message: 'Minor floating point precision difference' });
      } else {
        differences.push({ path, original, converted, type: 'value-change', message: 'Value changed significantly' });
      }
    }
    return differences;
  }

  if (original instanceof Date && converted instanceof Date) {
    if (original.getTime() !== converted.getTime()) {
      differences.push({ path, original, converted, type: 'datetime-precision', message: 'Datetime value changed' });
    }
    return differences;
  }

  if (Array.isArray(original) && Array.isArray(converted)) {
    if (original.length !== converted.length) {
      differences.push({ path, original, converted, type: 'array-length', message: `Array length changed from ${original.length} to ${converted.length}` });
    }
    const len = Math.min(original.length, converted.length);
    for (let i = 0; i < len; i++) {
      differences.push(...semanticDiff(original[i], converted[i], `${path}[${i}]`));
    }
    return differences;
  }

  if (typeof original === 'object' && original !== null && converted !== null) {
    const origKeys = Object.keys(original).filter(k => !k.startsWith('#'));
    const convKeys = Object.keys(converted).filter(k => !k.startsWith('#'));

    for (const key of origKeys) {
      const newPath = path ? `${path}.${key}` : key;
      if (!(key in converted)) {
        differences.push({ path: newPath, original: original[key], converted: undefined, type: 'missing', message: `Key '${newPath}' missing in converted output` });
      } else {
        differences.push(...semanticDiff(original[key], converted[key], newPath));
      }
    }

    for (const key of convKeys) {
      const newPath = path ? `${path}.${key}` : key;
      if (!(key in original)) {
        differences.push({ path: newPath, original: undefined, converted: converted[key], type: 'added', message: `Key '${newPath}' added in converted output` });
      }
    }
    return differences;
  }

  if (original !== converted) {
    differences.push({ path, original, converted, type: 'value-change', message: 'Value changed' });
  }

  return differences;
}

function formatDiff(differences) {
  if (differences.length === 0) {
    return 'No semantic differences detected.\n';
  }
  let output = `Found ${differences.length} semantic difference(s):\n\n`;
  for (const diff of differences) {
    output += `[${diff.type}] ${diff.path || '(root)'}: ${diff.message}\n`;
    if (diff.original !== undefined) {
      output += `  original: ${JSON.stringify(diff.original)}\n`;
    }
    if (diff.converted !== undefined) {
      output += `  converted: ${JSON.stringify(diff.converted)}\n`;
    }
    output += '\n';
  }
  return output;
}

module.exports = {
  prepareForFormat,
  semanticDiff,
  formatDiff,
  flattenArraysForINI,
  deepClone
};
