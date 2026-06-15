class INIParser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.result = {};
    this.currentSection = this.result;
    this.comments = [];
  }

  parse() {
    this.text = this.text.replace(/\r\n/g, '\n');
    const lines = this.text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      const trimmed = this.trimLine(line);

      if (trimmed === '') continue;

      if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
        this.comments.push({ line: i, text: trimmed });
        continue;
      }

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        const sectionName = trimmed.slice(1, -1).trim();
        this.currentSection = this.getOrCreateSection(sectionName);
        continue;
      }

      let valueLine = trimmed;
      while (valueLine.endsWith('\\') && i + 1 < lines.length) {
        valueLine = valueLine.slice(0, -1) + lines[++i].trim();
      }

      this.parseKeyValue(valueLine);
    }
    return this.result;
  }

  trimLine(line) {
    let result = line.trim();
    return result;
  }

  getOrCreateSection(name) {
    const parts = name.split('.');
    let obj = this.result;
    for (const part of parts) {
      if (!(part in obj)) {
        obj[part] = {};
      } else if (typeof obj[part] !== 'object' || Array.isArray(obj[part])) {
        obj[part] = {};
      }
      obj = obj[part];
    }
    return obj;
  }

  parseKeyValue(line) {
    let eqIdx = -1;
    let inStr = false;
    let strChar = '';

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (!inStr && (ch === '"' || ch === "'")) {
        inStr = true;
        strChar = ch;
      } else if (inStr && ch === strChar && line[i - 1] !== '\\') {
        inStr = false;
      } else if (!inStr && ch === '=') {
        eqIdx = i;
        break;
      }
    }

    if (eqIdx === -1) return;

    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    value = this.parseValue(value);

    if (Array.isArray(this.currentSection)) {
      this.currentSection[0][key] = value;
    } else {
      this.currentSection[key] = value;
    }
  }

  parseValue(value) {
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
      return value;
    }

    const lowered = value.toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;

    if (/^-?\d+$/.test(value)) return parseInt(value, 10);
    if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);

    return value;
  }
}

class INISerializer {
  constructor(obj, options = {}) {
    this.obj = obj;
    this.pretty = options.pretty !== false;
    this.indent = options.indent || '  ';
    this.types = options.types || {};
  }

  serialize() {
    const lines = [];
    const sections = [];
    const rootKeys = [];

    for (const key of Object.keys(this.obj)) {
      const value = this.obj[key];
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        sections.push({ name: key, value });
      } else if (Array.isArray(value)) {
        if (value.length > 0 && value.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
          for (let i = 0; i < value.length; i++) {
            const arrFullName = `${key}.${i}`;
            const arrSimplePairs = [];
            const arrNestedSections = [];
            for (const arrKey of Object.keys(value[i])) {
              const arrV = value[i][arrKey];
              if (typeof arrV === 'object' && arrV !== null && !Array.isArray(arrV)) {
                arrNestedSections.push({ name: arrKey, value: arrV });
              } else if (Array.isArray(arrV)) {
                if (arrV.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
                  for (let j = 0; j < arrV.length; j++) {
                    arrNestedSections.push({ name: `${arrKey}.${j}`, value: arrV[j] });
                  }
                } else {
                  for (let j = 0; j < arrV.length; j++) {
                    arrSimplePairs.push({ key: `${arrKey}.${j}`, value: arrV[j] });
                  }
                }
              } else {
                arrSimplePairs.push({ key: arrKey, value: arrV });
              }
            }
            if (arrSimplePairs.length > 0 || arrNestedSections.length > 0) {
              lines.push(`[${arrFullName}]`);
              for (const { key: sk, value: sv } of arrSimplePairs) {
                lines.push(`${sk} = ${this.valueToString(sv, `${arrFullName}.${sk}`)}`);
              }
              if (arrNestedSections.length > 0) lines.push('');
              this.serializeSections(arrNestedSections, arrFullName, lines);
            }
          }
        } else {
          for (let i = 0; i < value.length; i++) {
            rootKeys.push({ key: `${key}.${i}`, value: value[i] });
          }
        }
      } else {
        rootKeys.push({ key, value });
      }
    }

    const rootLines = [];
    for (const { key, value } of rootKeys) {
      rootLines.push(`${key} = ${this.valueToString(value, key)}`);
    }
    lines.unshift(...rootLines);

    if (rootKeys.length > 0 && sections.length > 0) {
      lines.push('');
    }

    this.serializeSections(sections, '', lines);

    return lines.join('\n') + '\n';
  }

  serializeSections(sections, prefix, lines) {
    for (const { name, value } of sections) {
      const fullName = prefix ? `${prefix}.${name}` : name;
      const simplePairs = [];
      const nestedSections = [];

      for (const key of Object.keys(value)) {
        const v = value[key];
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          nestedSections.push({ name: key, value: v });
        } else if (Array.isArray(v)) {
          if (v.every(item => typeof item === 'object' && item !== null && !Array.isArray(item))) {
            for (let i = 0; i < v.length; i++) {
              const arrFullName = `${fullName}.${key}.${i}`;
              const arrSimplePairs = [];
              const arrNestedSections = [];
              for (const arrKey of Object.keys(v[i])) {
                const arrV = v[i][arrKey];
                if (typeof arrV === 'object' && arrV !== null && !Array.isArray(arrV)) {
                  arrNestedSections.push({ name: arrKey, value: arrV });
                } else {
                  arrSimplePairs.push({ key: arrKey, value: arrV });
                }
              }
              if (arrSimplePairs.length > 0 || arrNestedSections.length > 0) {
                lines.push(`[${arrFullName}]`);
                for (const { key: sk, value: sv } of arrSimplePairs) {
                  lines.push(`${sk} = ${this.valueToString(sv, `${arrFullName}.${sk}`)}`);
                }
                if (arrNestedSections.length > 0) lines.push('');
                this.serializeSections(arrNestedSections, arrFullName, lines);
              }
            }
          } else {
            for (let i = 0; i < v.length; i++) {
              simplePairs.push({ key: `${key}.${i}`, value: v[i] });
            }
          }
        } else {
          simplePairs.push({ key, value: v });
        }
      }

      if (simplePairs.length > 0 || nestedSections.length > 0) {
        lines.push(`[${fullName}]`);
        for (const { key, value } of simplePairs) {
          lines.push(`${key} = ${this.valueToString(value, `${fullName}.${key}`)}`);
        }
        if (nestedSections.length > 0) lines.push('');
        this.serializeSections(nestedSections, fullName, lines);
      }

      if (lines[lines.length - 1] !== '') lines.push('');
    }
  }

  valueToString(value, path = '') {
    if (typeof value === 'string') {
      if (/^[A-Za-z0-9_\-.]+$/.test(value) && !/^(true|false)$/i.test(value)) {
        return value;
      }
      if (value.includes('\n')) {
        return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
      }
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    if (typeof value === 'boolean') return value.toString();
    if (typeof value === 'number') return value.toString();
    if (value instanceof Date) return `"${value.toISOString()}"`;
    return String(value);
  }
}

function parse(text) {
  const parser = new INIParser(text);
  return parser.parse();
}

function stringify(obj, options) {
  const serializer = new INISerializer(obj, options);
  return serializer.serialize();
}

module.exports = { parse, stringify };
