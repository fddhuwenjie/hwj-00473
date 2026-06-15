class TOMLParser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.comments = [];
    this.result = {};
    this.currentPath = [];
    this.currentTable = this.result;
    this.arrayTables = new Map();
  }

  parse() {
    while (this.pos < this.text.length) {
      this.skipWhitespaceAndComments();
      if (this.pos >= this.text.length) break;

      if (this.text[this.pos] === '[') {
        this.parseTableOrArrayTable();
      } else if (this.isKeyStart(this.text[this.pos])) {
        const key = this.parseKey();
        this.skipWhitespace();
        this.expect('=');
        this.skipWhitespace();
        const value = this.parseValue();
        this.setValue(this.currentPath, key, value);
        this.skipWhitespaceAndComments();
      } else {
        throw new Error(`Unexpected character at position ${this.pos}: ${this.text[this.pos]}`);
      }
    }
    return this.result;
  }

  skipWhitespace() {
    while (this.pos < this.text.length && (this.text[this.pos] === ' ' || this.text[this.pos] === '\t')) {
      this.pos++;
    }
  }

  skipWhitespaceAndComments() {
    while (this.pos < this.text.length) {
      this.skipWhitespace();
      if (this.text[this.pos] === '#') {
        const start = this.pos;
        while (this.pos < this.text.length && this.text[this.pos] !== '\n') {
          this.pos++;
        }
        if (this.pos < this.text.length) this.pos++;
      } else if (this.text[this.pos] === '\n' || this.text[this.pos] === '\r') {
        this.pos++;
      } else {
        break;
      }
    }
  }

  expect(ch) {
    if (this.text[this.pos] !== ch) {
      throw new Error(`Expected '${ch}' at position ${this.pos}, got '${this.text[this.pos]}'`);
    }
    this.pos++;
  }

  isKeyStart(ch) {
    return /[A-Za-z0-9_-]/.test(ch) || ch === '"' || ch === "'";
  }

  parseKey() {
    this.skipWhitespace();
    const keys = [];
    while (true) {
      let key;
      if (this.text[this.pos] === '"') {
        key = this.parseBasicString();
      } else if (this.text[this.pos] === "'") {
        key = this.parseLiteralString();
      } else {
        const start = this.pos;
        while (this.pos < this.text.length && /[A-Za-z0-9_-]/.test(this.text[this.pos])) {
          this.pos++;
        }
        key = this.text.slice(start, this.pos);
        if (!key) throw new Error(`Empty key at position ${this.pos}`);
      }
      keys.push(key);
      this.skipWhitespace();
      if (this.text[this.pos] === '.') {
        this.pos++;
        this.skipWhitespace();
      } else {
        break;
      }
    }
    return keys;
  }

  parseTableOrArrayTable() {
    this.expect('[');
    if (this.text[this.pos] === '[') {
      this.pos++;
      this.skipWhitespace();
      const keys = this.parseKey();
      this.skipWhitespace();
      this.expect(']');
      this.expect(']');
      this.skipWhitespaceAndComments();

      const path = keys.slice(0, -1);
      const lastKey = keys[keys.length - 1];
      this.currentPath = keys;
      this.currentTable = this.getOrCreateArrayTable(path, lastKey);
    } else {
      this.skipWhitespace();
      const keys = this.parseKey();
      this.skipWhitespace();
      this.expect(']');
      this.skipWhitespaceAndComments();

      this.currentPath = keys;
      this.currentTable = this.getOrCreateTable(keys);
    }
  }

  getOrCreateTable(keys) {
    let obj = this.result;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!(key in obj)) {
        obj[key] = {};
      } else if (typeof obj[key] !== 'object' || Array.isArray(obj[key])) {
        throw new Error(`Cannot redefine key '${key}' as table`);
      }
      obj = obj[key];
    }
    return obj;
  }

  getOrCreateArrayTable(path, key) {
    let obj = this.result;
    for (const k of path) {
      if (!(k in obj)) obj[k] = {};
      obj = obj[k];
    }
    if (!(key in obj)) {
      obj[key] = [];
    }
    if (!Array.isArray(obj[key])) {
      throw new Error(`Cannot redefine key '${key}' as array table`);
    }
    const newTable = {};
    obj[key].push(newTable);
    return newTable;
  }

  setValue(path, keys, value) {
    let obj;
    if (path.length === 0) {
      obj = this.result;
    } else {
      obj = this.currentTable;
    }
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in obj)) {
        obj[key] = {};
      } else if (typeof obj[key] !== 'object' || Array.isArray(obj[key])) {
        throw new Error(`Cannot redefine key '${key}'`);
      }
      obj = obj[key];
    }
    const lastKey = keys[keys.length - 1];
    if (lastKey in obj) {
      throw new Error(`Duplicate key: ${keys.join('.')}`);
    }
    obj[lastKey] = value;
  }

  parseValue() {
    this.skipWhitespace();
    const ch = this.text[this.pos];

    if (ch === '"') {
      if (this.text.substr(this.pos, 3) === '"""') {
        return this.parseMultiLineBasicString();
      }
      return this.parseBasicString();
    }
    if (ch === "'") {
      if (this.text.substr(this.pos, 3) === "'''") {
        return this.parseMultiLineLiteralString();
      }
      return this.parseLiteralString();
    }
    if (ch === '[') return this.parseArray();
    if (ch === '{') return this.parseInlineTable();
    if (ch === 't' || ch === 'f') {
      if (this.text.substr(this.pos, 4) === 'true' || this.text.substr(this.pos, 5) === 'false') {
        return this.parseBoolean();
      }
    }
    if (/[+\-\d]/.test(ch)) {
      if (/^\d{4}-\d{2}-\d{2}/.test(this.text.substr(this.pos))) {
        return this.parseDateTime();
      }
      return this.parseNumber();
    }
    if (/[A-Za-z]/.test(ch)) {
      if (/^\d{4}-\d{2}-\d{2}/.test(this.text.substr(this.pos)) || /^\d{4}-\d{2}-\d{2}T/.test(this.text.substr(this.pos))) {
        return this.parseDateTime();
      }
    }
    throw new Error(`Unexpected value at position ${this.pos}: ${this.text[this.pos]}`);
  }

  parseBasicString() {
    this.expect('"');
    let result = '';
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      if (ch === '"') {
        this.pos++;
        return result;
      }
      if (ch === '\\') {
        result += this.parseEscape();
      } else if (ch === '\n') {
        throw new Error('Unterminated string');
      } else {
        result += ch;
        this.pos++;
      }
    }
    throw new Error('Unterminated string');
  }

  parseMultiLineBasicString() {
    this.pos += 3;
    if (this.text[this.pos] === '\n') this.pos++;
    if (this.text.substr(this.pos, 2) === '\r\n') this.pos += 2;
    let result = '';
    while (this.pos < this.text.length) {
      if (this.text.substr(this.pos, 3) === '"""') {
        this.pos += 3;
        return result;
      }
      const ch = this.text[this.pos];
      if (ch === '\\') {
        if (this.text[this.pos + 1] === '\n' || (this.text[this.pos + 1] === '\r' && this.text[this.pos + 2] === '\n')) {
          this.pos++;
          if (this.text[this.pos] === '\r') this.pos++;
          this.pos++;
          while (this.pos < this.text.length && (this.text[this.pos] === ' ' || this.text[this.pos] === '\t' || this.text[this.pos] === '\n' || (this.text[this.pos] === '\r' && this.text[this.pos + 1] === '\n'))) {
            if (this.text[this.pos] === '\r') this.pos++;
            this.pos++;
          }
        } else {
          result += this.parseEscape();
        }
      } else {
        result += ch;
        this.pos++;
      }
    }
    throw new Error('Unterminated multi-line string');
  }

  parseLiteralString() {
    this.expect("'");
    let result = '';
    while (this.pos < this.text.length) {
      if (this.text[this.pos] === "'") {
        this.pos++;
        return result;
      }
      result += this.text[this.pos];
      this.pos++;
    }
    throw new Error('Unterminated literal string');
  }

  parseMultiLineLiteralString() {
    this.pos += 3;
    if (this.text[this.pos] === '\n') this.pos++;
    if (this.text.substr(this.pos, 2) === '\r\n') this.pos += 2;
    let result = '';
    while (this.pos < this.text.length) {
      if (this.text.substr(this.pos, 3) === "'''") {
        this.pos += 3;
        return result;
      }
      result += this.text[this.pos];
      this.pos++;
    }
    throw new Error('Unterminated multi-line literal string');
  }

  parseEscape() {
    this.expect('\\');
    const ch = this.text[this.pos];
    this.pos++;
    const escapes = {
      'b': '\b',
      't': '\t',
      'n': '\n',
      'f': '\f',
      'r': '\r',
      '"': '"',
      '\\': '\\',
      '/': '/'
    };
    if (ch in escapes) return escapes[ch];
    if (ch === 'u') {
      const hex = this.text.substr(this.pos, 4);
      this.pos += 4;
      return String.fromCharCode(parseInt(hex, 16));
    }
    if (ch === 'U') {
      const hex = this.text.substr(this.pos, 8);
      this.pos += 8;
      const code = parseInt(hex, 16);
      if (code > 0xFFFF) {
        return String.fromCharCode(0xD800 + ((code - 0x10000) >> 10), 0xDC00 + ((code - 0x10000) & 0x3FF));
      }
      return String.fromCharCode(code);
    }
    throw new Error(`Invalid escape: \\${ch}`);
  }

  parseArray() {
    this.expect('[');
    this.skipWhitespaceAndComments();
    const result = [];
    while (this.text[this.pos] !== ']') {
      const value = this.parseValue();
      result.push(value);
      this.skipWhitespaceAndComments();
      if (this.text[this.pos] === ',') {
        this.pos++;
        this.skipWhitespaceAndComments();
      } else if (this.text[this.pos] !== ']') {
        throw new Error(`Expected ',' or ']' at position ${this.pos}`);
      }
    }
    this.expect(']');
    return result;
  }

  parseInlineTable() {
    this.expect('{');
    this.skipWhitespace();
    const result = {};
    if (this.text[this.pos] === '}') {
      this.pos++;
      return result;
    }
    while (true) {
      const keys = this.parseKey();
      this.skipWhitespace();
      this.expect('=');
      this.skipWhitespace();
      const value = this.parseValue();
      let obj = result;
      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!(key in obj)) obj[key] = {};
        obj = obj[key];
      }
      obj[keys[keys.length - 1]] = value;
      this.skipWhitespace();
      if (this.text[this.pos] === ',') {
        this.pos++;
        this.skipWhitespace();
      } else if (this.text[this.pos] === '}') {
        break;
      } else {
        throw new Error(`Expected ',' or '}' at position ${this.pos}`);
      }
    }
    this.expect('}');
    return result;
  }

  parseBoolean() {
    if (this.text.substr(this.pos, 4) === 'true') {
      this.pos += 4;
      return true;
    }
    if (this.text.substr(this.pos, 5) === 'false') {
      this.pos += 5;
      return false;
    }
    throw new Error(`Invalid boolean at position ${this.pos}`);
  }

  parseNumber() {
    const start = this.pos;
    if (this.text[this.pos] === '+' || this.text[this.pos] === '-') this.pos++;
    
    let isFloat = false;
    let isInfOrNan = false;
    
    if (this.text.substr(this.pos, 3) === 'inf') {
      this.pos += 3;
      isInfOrNan = true;
      const sign = this.text[start] === '-' ? -1 : 1;
      return sign * Infinity;
    }
    if (this.text.substr(this.pos, 3) === 'nan') {
      this.pos += 3;
      isInfOrNan = true;
      return NaN;
    }

    while (this.pos < this.text.length && /[0-9_]/.test(this.text[this.pos])) {
      this.pos++;
    }

    if (this.text[this.pos] === '.' && /[0-9]/.test(this.text[this.pos + 1])) {
      isFloat = true;
      this.pos++;
      while (this.pos < this.text.length && /[0-9_]/.test(this.text[this.pos])) {
        this.pos++;
      }
    }

    if (this.text[this.pos] === 'e' || this.text[this.pos] === 'E') {
      isFloat = true;
      this.pos++;
      if (this.text[this.pos] === '+' || this.text[this.pos] === '-') this.pos++;
      while (this.pos < this.text.length && /[0-9_]/.test(this.text[this.pos])) {
        this.pos++;
      }
    }

    const numStr = this.text.slice(start, this.pos).replace(/_/g, '');
    return isFloat ? parseFloat(numStr) : parseInt(numStr, 10);
  }

  parseDateTime() {
    const start = this.pos;
    while (this.pos < this.text.length && /[0-9T:+.\-Z]/.test(this.text[this.pos])) {
      this.pos++;
    }
    const dateStr = this.text.slice(start, this.pos);
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid datetime: ${dateStr}`);
    }
    return date;
  }
}

class TOMLSerializer {
  constructor(obj, options = {}) {
    this.obj = obj;
    this.pretty = options.pretty !== false;
    this.indent = options.indent || '  ';
  }

  serialize() {
    const lines = [];
    this.serializeValue(this.obj, '', lines, true);
    return lines.join('\n') + '\n';
  }

  serializeValue(obj, prefix, lines, isRoot = false) {
    if (Array.isArray(obj)) {
      if (obj.length > 0 && obj.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
        for (const item of obj) {
          lines.push(`[[${prefix}]]`);
          this.serializeValue(item, prefix, lines);
          lines.push('');
        }
        return;
      }
    }

    const simplePairs = [];
    const tables = [];
    const arrayTables = [];

    for (const key of Object.keys(obj)) {
      const value = obj[key];
      const fullKey = prefix ? `${prefix}.${this.escapeKey(key)}` : this.escapeKey(key);
      if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
        if (Array.isArray(value)) {
          if (value.length > 0 && value.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
            arrayTables.push({ key, fullKey, value });
          } else {
            simplePairs.push({ key, value });
          }
        } else {
          tables.push({ key, fullKey, value });
        }
      } else {
        simplePairs.push({ key, value });
      }
    }

    for (const { key, value } of simplePairs) {
      lines.push(`${this.escapeKey(key)} = ${this.valueToString(value)}`);
    }

    if (!isRoot && simplePairs.length > 0 && tables.length > 0) {
      lines.push('');
    }

    for (const { fullKey, value } of tables) {
      if (Object.keys(value).length > 0) {
        lines.push(`[${fullKey}]`);
        this.serializeValue(value, fullKey, lines);
        lines.push('');
      }
    }

    for (const { fullKey, value } of arrayTables) {
      for (const item of value) {
        lines.push(`[[${fullKey}]]`);
        this.serializeValue(item, fullKey, lines);
        lines.push('');
      }
    }
  }

  escapeKey(key) {
    if (/^[A-Za-z0-9_-]+$/.test(key)) return key;
    return '"' + key.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  valueToString(value) {
    if (typeof value === 'string') {
      if (value.includes('\n')) {
        return `"""${value.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"')}"""`;
      }
      return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
    }
    if (typeof value === 'boolean') return value.toString();
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return 'nan';
      if (value === Infinity) return 'inf';
      if (value === -Infinity) return '-inf';
      return value.toString();
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (Array.isArray(value)) {
      const items = value.map(v => this.valueToString(v));
      return `[${items.join(', ')}]`;
    }
    if (typeof value === 'object' && value !== null) {
      const pairs = Object.keys(value).map(k => `${this.escapeKey(k)} = ${this.valueToString(value[k])}`);
      return `{ ${pairs.join(', ')} }`;
    }
    return '""';
  }
}

function parse(text) {
  const parser = new TOMLParser(text);
  return parser.parse();
}

function stringify(obj, options) {
  const serializer = new TOMLSerializer(obj, options);
  return serializer.serialize();
}

module.exports = { parse, stringify };
