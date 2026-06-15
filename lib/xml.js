class XMLParser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
  }

  parse() {
    this.skipDeclarationAndComments();
    this.skipWhitespace();
    const result = this.parseElement();
    return result;
  }

  skipWhitespace() {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos])) {
      this.pos++;
    }
  }

  skipDeclarationAndComments() {
    while (this.pos < this.text.length) {
      this.skipWhitespace();
      if (this.text.substr(this.pos, 4) === '<!--') {
        this.pos += 4;
        const endIdx = this.text.indexOf('-->', this.pos);
        if (endIdx === -1) throw new Error('Unterminated XML comment');
        this.pos = endIdx + 3;
      } else if (this.text.substr(this.pos, 2) === '<?') {
        this.pos += 2;
        const endIdx = this.text.indexOf('?>', this.pos);
        if (endIdx === -1) throw new Error('Unterminated XML declaration');
        this.pos = endIdx + 2;
      } else if (this.text.substr(this.pos, 9) === '<!DOCTYPE') {
        const endIdx = this.text.indexOf('>', this.pos);
        if (endIdx === -1) throw new Error('Unterminated DOCTYPE');
        this.pos = endIdx + 1;
      } else {
        break;
      }
    }
  }

  parseElement() {
    this.expect('<');
    const tagName = this.parseName();
    const attrs = this.parseAttributes();
    const result = {};

    if (Object.keys(attrs).length > 0) {
      for (const key of Object.keys(attrs)) {
        result[`@${key}`] = attrs[key];
      }
    }

    if (this.text.substr(this.pos, 2) === '/>') {
      this.pos += 2;
      this.skipWhitespace();
      return { [tagName]: result };
    }

    this.expect('>');

    let children = [];
    let textContent = '';

    while (this.pos < this.text.length) {
      this.skipWhitespace();
      if (this.text.substr(this.pos, 2) === '</') {
        this.pos += 2;
        const closeName = this.parseName();
        if (closeName !== tagName) {
          throw new Error(`Mismatched tag: expected </${tagName}>, got </${closeName}>`);
        }
        this.expect('>');
        this.skipWhitespace();
        break;
      }

      if (this.text[this.pos] === '<') {
        if (this.text.substr(this.pos, 4) === '<!--') {
          this.pos += 4;
          const endIdx = this.text.indexOf('-->', this.pos);
          this.pos = endIdx + 3;
          continue;
        }
        const child = this.parseElement();
        children.push(child);
      } else {
        const text = this.parseText();
        if (text.trim() !== '') {
          textContent += text.trim() + ' ';
        }
      }
    }

    textContent = textContent.trim();

    const hasAttrs = Object.keys(result).length > 0;
    const hasChildren = children.length > 0;

    if (!hasAttrs && !hasChildren && textContent !== '') {
      return { [tagName]: textContent };
    }

    if (textContent !== '' && !hasChildren) {
      result['#text'] = textContent;
    } else if (textContent !== '') {
      result['#text'] = textContent;
    }

    for (const child of children) {
      for (const childKey of Object.keys(child)) {
        if (childKey in result) {
          if (!Array.isArray(result[childKey])) {
            result[childKey] = [result[childKey]];
          }
          result[childKey].push(child[childKey]);
        } else {
          result[childKey] = child[childKey];
        }
      }
    }

    return { [tagName]: result };
  }

  parseName() {
    const start = this.pos;
    if (!/[A-Za-z_]/.test(this.text[this.pos])) {
      throw new Error(`Invalid tag name at position ${this.pos}`);
    }
    while (this.pos < this.text.length && /[A-Za-z0-9_:.-]/.test(this.text[this.pos])) {
      this.pos++;
    }
    return this.text.slice(start, this.pos);
  }

  parseAttributes() {
    const attrs = {};
    while (this.pos < this.text.length) {
      this.skipWhitespace();
      if (this.text[this.pos] === '>' || this.text.substr(this.pos, 2) === '/>') {
        break;
      }
      const name = this.parseName();
      this.skipWhitespace();
      this.expect('=');
      this.skipWhitespace();
      const value = this.parseAttributeValue();
      attrs[name] = value;
    }
    return attrs;
  }

  parseAttributeValue() {
    const quote = this.text[this.pos];
    if (quote !== '"' && quote !== "'") {
      throw new Error(`Expected quote at position ${this.pos}`);
    }
    this.pos++;
    let value = '';
    while (this.pos < this.text.length && this.text[this.pos] !== quote) {
      if (this.text[this.pos] === '&') {
        value += this.parseEntity();
      } else {
        value += this.text[this.pos];
        this.pos++;
      }
    }
    this.pos++;
    return value;
  }

  parseEntity() {
    this.expect('&');
    const start = this.pos;
    while (this.pos < this.text.length && this.text[this.pos] !== ';') {
      this.pos++;
    }
    this.expect(';');
    const entity = this.text.slice(start, this.pos - 1);
    const entities = {
      'amp': '&',
      'lt': '<',
      'gt': '>',
      'quot': '"',
      'apos': "'"
    };
    if (entity in entities) return entities[entity];
    if (entity.startsWith('#x')) {
      return String.fromCharCode(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith('#')) {
      return String.fromCharCode(parseInt(entity.slice(1), 10));
    }
    return `&${entity};`;
  }

  parseText() {
    let text = '';
    while (this.pos < this.text.length && this.text[this.pos] !== '<') {
      if (this.text[this.pos] === '&') {
        text += this.parseEntity();
      } else {
        text += this.text[this.pos];
        this.pos++;
      }
    }
    return text;
  }

  expect(ch) {
    if (this.text[this.pos] !== ch) {
      throw new Error(`Expected '${ch}' at position ${this.pos}, got '${this.text[this.pos]}'`);
    }
    this.pos++;
  }
}

class XMLSerializer {
  constructor(obj, options = {}) {
    this.obj = obj;
    this.pretty = options.pretty !== false;
    this.indent = options.indent || '  ';
  }

  serialize() {
    let result = '';
    if (this.pretty) result += '<?xml version="1.0" encoding="UTF-8"?>\n';
    else result += '<?xml version="1.0" encoding="UTF-8"?>';
    result += this.serializeNode(this.obj, 0);
    if (this.pretty && !result.endsWith('\n')) result += '\n';
    return result;
  }

  serializeNode(obj, level) {
    let result = '';
    for (const tagName of Object.keys(obj)) {
      const value = obj[tagName];
      result += this.serializeElement(tagName, value, level);
    }
    return result;
  }

  serializeElement(name, value, level) {
    const indent = this.pretty ? this.indent.repeat(level) : '';
    const newLine = this.pretty ? '\n' : '';

    const attrs = {};
    const children = {};
    let textContent = '';
    let hasContent = false;

    if (typeof value !== 'object' || value === null) {
      textContent = this.escapeText(String(value ?? ''));
      hasContent = true;
    } else if (Array.isArray(value)) {
      let result = '';
      for (const item of value) {
        result += this.serializeElement(name, item, level);
      }
      return result;
    } else {
      for (const key of Object.keys(value)) {
        if (key.startsWith('@')) {
          attrs[key.slice(1)] = value[key];
        } else if (key === '#text') {
          textContent = this.escapeText(String(value[key]));
          hasContent = true;
        } else {
          children[key] = value[key];
        }
      }
      hasContent = hasContent || Object.keys(children).length > 0;
    }

    let result = indent + '<' + name;

    for (const attrName of Object.keys(attrs)) {
      result += ` ${attrName}="${this.escapeAttr(String(attrs[attrName]))}"`;
    }

    if (!hasContent) {
      result += '/>' + newLine;
      return result;
    }

    result += '>';

    const hasChildren = Object.keys(children).length > 0;

    if (hasChildren) {
      result += newLine;
      for (const childName of Object.keys(children)) {
        result += this.serializeElement(childName, children[childName], level + 1);
      }
      result += indent;
    }

    if (textContent) {
      result += textContent;
    }

    result += `</${name}>` + newLine;
    return result;
  }

  escapeText(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  escapeAttr(text) {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}

function parse(text) {
  const parser = new XMLParser(text);
  return parser.parse();
}

function stringify(obj, options) {
  const serializer = new XMLSerializer(obj, options);
  return serializer.serialize();
}

module.exports = { parse, stringify };
