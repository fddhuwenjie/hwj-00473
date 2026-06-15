const fs = require('fs');
const path = require('path');

class CommentExtractor {
  constructor(text, format) {
    this.text = text.replace(/\r\n/g, '\n');
    this.lines = this.text.split('\n');
    this.format = format;
    this.comments = [];
  }

  extract() {
    if (this.format === 'toml') {
      return this.extractTOML();
    } else if (this.format === 'ini') {
      return this.extractINI();
    } else if (this.format === 'yaml') {
      return this.extractYAML();
    } else if (this.format === 'xml') {
      return this.extractXML();
    } else if (this.format === 'dotenv') {
      return this.extractDotEnv();
    }
    return [];
  }

  extractTOML() {
    const comments = [];
    let keyPath = [];
    let pendingComments = [];
    let inMultiLineString = false;
    let multiLineChar = '';

    for (let i = 0; i < this.lines.length; i++) {
      let line = this.lines[i];
      const trimmed = line.trim();

      if (inMultiLineString) {
        const endIdx = line.indexOf(multiLineChar);
        if (endIdx !== -1) {
          inMultiLineString = false;
        }
        continue;
      }

      if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
        multiLineChar = trimmed.startsWith('"""') ? '"""' : "'''";
        if (!trimmed.endsWith(multiLineChar) || trimmed.length <= 6) {
          inMultiLineString = true;
        }
        continue;
      }

      if (trimmed === '') continue;

      if (trimmed.startsWith('#')) {
        pendingComments.push({ line: i + 1, text: trimmed.slice(1).trim(), type: 'standalone' });
        continue;
      }

      const hashIdx = this.findUnquotedChar(line, '#');
      let lineComment = null;
      if (hashIdx !== -1) {
        lineComment = line.slice(hashIdx + 1).trim();
        line = line.slice(0, hashIdx).trimEnd();
      }

      let sectionMatch = line.match(/^\[\[(.+?)\]\]\s*$/);
      if (sectionMatch) {
        keyPath = sectionMatch[1].trim().split('.').map(k => k.replace(/^["']|["']$/g, ''));
        this.attachPendingComments(pendingComments, comments, keyPath.join('.'), i + 1, 'section');
        pendingComments = [];
        if (lineComment) {
          comments.push({
            line: i + 1,
            key: keyPath.join('.'),
            text: lineComment,
            type: 'inline',
            element: 'section-header'
          });
        }
        continue;
      }

      sectionMatch = line.match(/^\[(.+?)\]\s*$/);
      if (sectionMatch) {
        keyPath = sectionMatch[1].trim().split('.').map(k => k.replace(/^["']|["']$/g, ''));
        this.attachPendingComments(pendingComments, comments, keyPath.join('.'), i + 1, 'section');
        pendingComments = [];
        if (lineComment) {
          comments.push({
            line: i + 1,
            key: keyPath.join('.'),
            text: lineComment,
            type: 'inline',
            element: 'section-header'
          });
        }
        continue;
      }

      const keyValue = this.parseTOMLKeyValue(line);
      if (keyValue) {
        const fullKey = [...keyPath, ...keyValue.keys].join('.');
        this.attachPendingComments(pendingComments, comments, fullKey, i + 1, 'key');
        pendingComments = [];
        if (lineComment) {
          comments.push({
            line: i + 1,
            key: fullKey,
            text: lineComment,
            type: 'inline',
            element: 'key-value'
          });
        }
      }
    }

    return comments;
  }

  parseTOMLKeyValue(line) {
    const keys = [];
    let pos = 0;

    while (pos < line.length) {
      while (pos < line.length && /\s/.test(line[pos])) pos++;

      let key;
      if (line[pos] === '"') {
        const end = this.findUnquotedChar(line.slice(pos + 1), '"');
        if (end === -1) return null;
        key = line.slice(pos + 1, pos + 1 + end);
        pos += 1 + end + 1;
      } else if (line[pos] === "'") {
        const end = line.indexOf("'", pos + 1);
        if (end === -1) return null;
        key = line.slice(pos + 1, end);
        pos = end + 1;
      } else {
        const start = pos;
        while (pos < line.length && /[A-Za-z0-9_-]/.test(line[pos])) pos++;
        if (start === pos) return null;
        key = line.slice(start, pos);
      }
      keys.push(key);

      while (pos < line.length && /\s/.test(line[pos])) pos++;

      if (line[pos] === '.') {
        pos++;
        continue;
      } else if (line[pos] === '=') {
        return { keys };
      } else {
        return null;
      }
    }
    return null;
  }

  extractINI() {
    const comments = [];
    let keyPath = [];
    let pendingComments = [];

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      let trimmed = line.trim();

      if (trimmed === '') continue;

      if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
        pendingComments.push({
          line: i + 1,
          text: trimmed.slice(1).trim(),
          type: 'standalone'
        });
        continue;
      }

      const commentCharIdx = this.findINICommentIndex(line);
      let lineComment = null;
      if (commentCharIdx !== -1) {
        lineComment = line.slice(commentCharIdx + 1).trim();
        trimmed = line.slice(0, commentCharIdx).trim();
      }

      const sectionMatch = trimmed.match(/^\[(.+?)\]\s*$/);
      if (sectionMatch) {
        keyPath = sectionMatch[1].trim().split('.');
        this.attachPendingComments(pendingComments, comments, keyPath.join('.'), i + 1, 'section');
        pendingComments = [];
        if (lineComment) {
          comments.push({
            line: i + 1,
            key: keyPath.join('.'),
            text: lineComment,
            type: 'inline',
            element: 'section-header'
          });
        }
        continue;
      }

      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        const fullKey = [...keyPath, key].join('.');
        this.attachPendingComments(pendingComments, comments, fullKey, i + 1, 'key');
        pendingComments = [];
        if (lineComment) {
          comments.push({
            line: i + 1,
            key: fullKey,
            text: lineComment,
            type: 'inline',
            element: 'key-value'
          });
        }
      }
    }

    return comments;
  }

  findINICommentIndex(line) {
    let inStr = false;
    let strChar = '';

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (!inStr && (ch === '"' || ch === "'")) {
        inStr = true;
        strChar = ch;
      } else if (inStr && ch === strChar) {
        inStr = false;
      } else if (!inStr && (ch === ';' || ch === '#')) {
        return i;
      }
    }
    return -1;
  }

  extractYAML() {
    const comments = [];
    const keyPath = [];
    const pathStack = [];
    let pendingComments = [];

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      const trimmed = line.trim();

      if (trimmed === '') continue;
      if (trimmed.startsWith('---') || trimmed.startsWith('...')) continue;

      if (trimmed.startsWith('#')) {
        pendingComments.push({
          line: i + 1,
          text: trimmed.slice(1).trim(),
          type: 'standalone'
        });
        continue;
      }

      const hashIdx = this.findUnquotedChar(line, '#');
      let lineComment = null;
      if (hashIdx !== -1) {
        lineComment = line.slice(hashIdx + 1).trim();
      }

      const contentLine = hashIdx !== -1 ? line.slice(0, hashIdx).trimEnd() : line;
      const indent = contentLine.length - contentLine.replace(/^\s*/, '').length;

      while (pathStack.length > 0 && indent <= pathStack[pathStack.length - 1].indent) {
        pathStack.pop();
        keyPath.pop();
      }

      const content = contentLine.trim();

      if (content.startsWith('- ')) {
        let arrIndex = 0;
        if (pathStack.length > 0) {
          const parent = pathStack[pathStack.length - 1];
          arrIndex = parent.arrayIndex !== undefined ? parent.arrayIndex + 1 : 0;
          parent.arrayIndex = arrIndex;
        }
        if (keyPath.length > 0) {
          keyPath[keyPath.length - 1] = `${keyPath[keyPath.length - 1].replace(/\[\d+\]$/, '')}[${arrIndex}]`;
        }

        const itemContent = content.slice(2).trim();
        const colonIdx = itemContent.indexOf(':');
        if (colonIdx !== -1) {
          const key = itemContent.slice(0, colonIdx).trim();
          const fullKey = keyPath.length > 0 ? `${keyPath.join('.').replace(/\[\d+\]/g, m => m)}.${key}` : key;
          this.attachPendingComments(pendingComments, comments, fullKey, i + 1, 'key');
          pendingComments = [];
          if (lineComment) {
            comments.push({
              line: i + 1,
              key: fullKey,
              text: lineComment,
              type: 'inline',
              element: 'key-value'
            });
          }
        }
        continue;
      }

      const colonIdx = content.indexOf(':');
      if (colonIdx !== -1) {
        let key = content.slice(0, colonIdx).trim();
        key = key.replace(/^["']|["']$/g, '');
        const value = content.slice(colonIdx + 1).trim();

        keyPath.push(key);
        pathStack.push({ indent, arrayIndex: undefined });

        const fullKey = keyPath.join('.');
        this.attachPendingComments(pendingComments, comments, fullKey, i + 1, 'key');
        pendingComments = [];
        if (lineComment) {
          comments.push({
            line: i + 1,
            key: fullKey,
            text: lineComment,
            type: 'inline',
            element: 'key-value'
          });
        }

        if (value !== '' && !value.startsWith('|') && !value.startsWith('>')) {
          keyPath.pop();
          pathStack.pop();
        }
      }
    }

    return comments;
  }

  extractXML() {
    const comments = [];
    let match;
    const regex = /<!--([\s\S]*?)-->/g;
    let lineCount = 1;
    let lastIndex = 0;

    while ((match = regex.exec(this.text)) !== null) {
      const beforeMatch = this.text.slice(lastIndex, match.index);
      lineCount += beforeMatch.split('\n').length - 1;

      const commentText = match[1].trim();
      const commentEndLine = lineCount + match[0].split('\n').length - 1;

      comments.push({
        line: lineCount,
        key: '(document)',
        text: commentText,
        type: 'xml-comment',
        element: 'document'
      });

      lineCount = commentEndLine;
      lastIndex = regex.lastIndex;
    }

    return comments;
  }

  extractDotEnv() {
    const comments = [];
    let pendingComments = [];

    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      const trimmed = line.trim();

      if (trimmed === '') continue;

      if (trimmed.startsWith('#')) {
        pendingComments.push({
          line: i + 1,
          text: trimmed.slice(1).trim(),
          type: 'standalone'
        });
        continue;
      }

      const hashIdx = this.findDotEnvCommentIndex(line);
      let lineComment = null;
      if (hashIdx !== -1) {
        lineComment = line.slice(hashIdx + 1).trim();
      }

      const contentLine = hashIdx !== -1 ? line.slice(0, hashIdx) : line;
      const eqIdx = contentLine.search(/[=:]/);
      if (eqIdx !== -1) {
        let key = contentLine.slice(0, eqIdx).trim();
        if (key.startsWith('export ')) {
          key = key.slice(7).trim();
        }
        this.attachPendingComments(pendingComments, comments, key, i + 1, 'key');
        pendingComments = [];
        if (lineComment) {
          comments.push({
            line: i + 1,
            key: key,
            text: lineComment,
            type: 'inline',
            element: 'key-value'
          });
        }
      }
    }

    return comments;
  }

  findDotEnvCommentIndex(line) {
    let inQuote = false;
    let quoteChar = '';
    let eqFound = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if ((ch === '=' || ch === ':') && !eqFound && !inQuote) {
        eqFound = true;
        continue;
      }
      if (eqFound && !inQuote && (ch === '"' || ch === "'")) {
        inQuote = true;
        quoteChar = ch;
        continue;
      }
      if (eqFound && inQuote && ch === quoteChar && line[i - 1] !== '\\') {
        inQuote = false;
        continue;
      }
      if (eqFound && !inQuote && ch === '#') {
        return i;
      }
    }
    return -1;
  }

  attachPendingComments(pending, result, key, line, element) {
    for (const comment of pending) {
      result.push({
        line: comment.line,
        key: key,
        text: comment.text,
        type: comment.type,
        element: element
      });
    }
    pending.length = 0;
  }

  findUnquotedChar(str, char) {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === char && !inSingle && !inDouble) return i;
    }
    return -1;
  }
}

function extractComments(content, format) {
  const extractor = new CommentExtractor(content, format);
  return extractor.extract();
}

function extractCommentsFromFile(filePath, format, formats) {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!format) {
    format = formats.detectFormat(filePath, content);
  }
  if (!format) {
    throw new Error(`Could not detect format for file: ${filePath}`);
  }
  return extractComments(content, format);
}

function formatCommentsDisplay(comments) {
  if (comments.length === 0) {
    return 'No comments found in the file.\n';
  }

  let output = `Found ${comments.length} comment(s):\n\n`;
  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    output += `Comment #${i + 1}\n`;
    output += `  Line: ${c.line}\n`;
    output += `  Key:  ${c.key}\n`;
    output += `  Type: ${c.type}${c.element ? ` (${c.element})` : ''}\n`;
    output += `  Text: ${c.text}\n`;
    output += '\n';
  }
  return output;
}

function writeCommentsSidecar(filePath, comments) {
  const sidecarPath = filePath + '.comments.json';
  const sidecarData = {
    sourceFile: path.basename(filePath),
    extractedAt: new Date().toISOString(),
    comments: comments
  };
  fs.writeFileSync(sidecarPath, JSON.stringify(sidecarData, null, 2) + '\n', 'utf-8');
  return sidecarPath;
}

const FORMATS_WITH_NATIVE_COMMENTS = ['toml', 'ini', 'yaml', 'xml', 'dotenv'];

function formatSupportsComments(format) {
  return FORMATS_WITH_NATIVE_COMMENTS.includes(format);
}

module.exports = {
  extractComments,
  extractCommentsFromFile,
  formatCommentsDisplay,
  writeCommentsSidecar,
  formatSupportsComments,
  FORMATS_WITH_NATIVE_COMMENTS
};
