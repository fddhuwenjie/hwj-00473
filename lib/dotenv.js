class DotEnvParser {
  constructor(text) {
    this.text = text;
    this.result = {};
  }

  parse() {
    this.text = this.text.replace(/\r\n/g, '\n');
    const lines = this.text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const trimmed = line.trim();

      if (trimmed === '' || trimmed.startsWith('#')) {
        continue;
      }

      let key = '';
      let value = '';
      let inKey = true;
      let hasQuote = false;
      let quoteChar = '';

      for (let j = 0; j < line.length; j++) {
        const ch = line[j];

        if (inKey) {
          if (ch === '=' || ch === ':') {
            inKey = false;
          } else if (ch === ' ' || ch === '\t') {
            if (key !== '') {
              while (j < line.length && (line[j] === ' ' || line[j] === '\t')) {
                j++;
              }
              if (j < line.length && (line[j] === '=' || line[j] === ':')) {
                inKey = false;
              }
            }
          } else if (ch === '#') {
            break;
          } else {
            key += ch;
          }
        } else {
          if (!hasQuote && (ch === ' ' || ch === '\t') && value === '') {
            continue;
          }
          if (!hasQuote && (ch === '"' || ch === "'") && value === '') {
            hasQuote = true;
            quoteChar = ch;
            continue;
          }
          if (hasQuote && ch === quoteChar && line[j - 1] !== '\\') {
            hasQuote = false;
            continue;
          }
          if (!hasQuote && ch === '#') {
            break;
          }
          if (!hasQuote && ch === '\\' && j + 1 < line.length && (line[j + 1] === 'n')) {
            value += '\n';
            j++;
            continue;
          }
          if (hasQuote && ch === '\\' && j + 1 < line.length) {
            const next = line[j + 1];
            if (next === quoteChar || next === '\\') {
              value += next;
              j++;
              continue;
            }
            if (next === 'n') {
              value += '\n';
              j++;
              continue;
            }
          }
          value += ch;
        }
      }

      if (key !== '') {
        this.result[key.trim()] = value;
      }
    }
    return this.result;
  }
}

class DotEnvSerializer {
  constructor(obj, options = {}) {
    this.obj = obj;
    this.pretty = options.pretty !== false;
    this.types = options.types || {};
  }

  serialize() {
    const lines = [];
    this.serializeObject(this.obj, '', lines);
    return lines.join('\n') + '\n';
  }

  serializeObject(obj, prefix, lines) {
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const fullKey = prefix ? `${prefix}_${key}` : key;

      if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)) {
        this.serializeObject(value, fullKey, lines);
      } else if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          const arrayKey = `${fullKey}_${i}`;
          if (typeof item === 'object' && item !== null && !Array.isArray(item) && !(item instanceof Date)) {
            this.serializeObject(item, arrayKey, lines);
          } else {
            lines.push(this.formatKeyValue(arrayKey, item));
          }
        }
      } else {
        lines.push(this.formatKeyValue(fullKey, value));
      }
    }
  }

  formatKeyValue(key, value) {
    const typeInfo = this.getTypeInfo(value);
    const formatted = this.formatValue(value);
    if (typeInfo) {
      return `${key}=${formatted} # type:${typeInfo}`;
    }
    return `${key}=${formatted}`;
  }

  getTypeInfo(value) {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'float';
    if (value instanceof Date) return 'datetime';
    if (value === null) return 'null';
    return '';
  }

  formatValue(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return `"${value.toISOString()}"`;
    if (typeof value === 'string') {
      if (value.includes('\n') || value.includes('"') || value.includes("'") || value.includes('#')) {
        return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
      }
      return value;
    }
    return String(value);
  }
}

function parse(text) {
  const parser = new DotEnvParser(text);
  return parser.parse();
}

function stringify(obj, options) {
  const serializer = new DotEnvSerializer(obj, options);
  return serializer.serialize();
}

module.exports = { parse, stringify };
