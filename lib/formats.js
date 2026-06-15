const yaml = require('js-yaml');

function parseJSON(text) {
  return JSON.parse(text);
}

function stringifyJSON(obj, options = {}) {
  const pretty = options.pretty !== false;
  if (pretty) {
    return JSON.stringify(obj, null, options.indent || 2) + '\n';
  }
  return JSON.stringify(obj);
}

function parseYAML(text) {
  return yaml.load(text);
}

function stringifyYAML(obj, options = {}) {
  return yaml.dump(obj, {
    indent: options.indent || 2,
    lineWidth: -1,
    noRefs: true
  });
}

const EXTENSIONS = {
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.xml': 'xml',
  '.env': 'dotenv'
};

function detectFormatByExtension(filepath) {
  const path = require('path');
  const ext = path.extname(filepath).toLowerCase();
  if (ext in EXTENSIONS) return EXTENSIONS[ext];

  const basename = path.basename(filepath).toLowerCase();
  if (basename === '.env' || basename === 'env') return 'dotenv';
  return null;
}

function detectFormatByContent(text) {
  text = text.trim();
  if (text === '') return null;

  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      JSON.parse(text);
      return 'json';
    } catch (e) {}
  }

  if (text.startsWith('<?xml') || (text.startsWith('<') && text.endsWith('>') && text.includes('</'))) {
    return 'xml';
  }

  const lines = text.split('\n').map(l => l.trim()).filter(l => l !== '' && !l.startsWith('#') && !l.startsWith(';'));

  if (lines.length === 0) return null;

  let hasTable = false;
  let hasArrayTable = false;
  let hasEquals = false;
  let hasColon = false;

  for (const line of lines) {
    if (line.startsWith('[[')) {
      hasArrayTable = true;
    } else if (line.startsWith('[')) {
      hasTable = true;
    }
    if (line.includes('=')) {
      const idx = line.indexOf('=');
      const before = line.slice(0, idx).trim();
      if (!before.startsWith('-')) {
        hasEquals = true;
      }
    }
    if (/^[A-Za-z_][\w]*\s*:/.test(line)) {
      hasColon = true;
    }
  }

  if (hasArrayTable) return 'toml';

  if (hasEquals && hasTable) {
    let hasBracketArray = false;
    for (const line of lines) {
      if (line.includes('=[') || line.includes('= [')) {
        hasBracketArray = true;
      }
    }
    if (hasBracketArray) return 'toml';

    let hasQuotedKeys = false;
    for (const line of lines) {
      if (line.startsWith('"') || line.includes('."') || line.includes('= "') || line.includes("='") || line.includes("= '")) {
        hasQuotedKeys = true;
      }
    }
    if (hasQuotedKeys) return 'toml';

    return 'ini';
  }

  if (hasEquals && !hasTable) {
    let hasExport = false;
    for (const line of lines) {
      if (line.startsWith('export ')) hasExport = true;
    }
    if (hasExport) return 'dotenv';
    return 'dotenv';
  }

  if (hasColon && !hasEquals) {
    return 'yaml';
  }

  if (hasTable && hasEquals) {
    return 'ini';
  }

  return null;
}

function detectFormat(filepath, text) {
  if (filepath) {
    const extFormat = detectFormatByExtension(filepath);
    if (extFormat) return extFormat;
  }
  if (text) {
    return detectFormatByContent(text);
  }
  return null;
}

module.exports = {
  parseJSON,
  stringifyJSON,
  parseYAML,
  stringifyYAML,
  detectFormat,
  detectFormatByExtension,
  detectFormatByContent
};
