const fs = require('fs');
const path = require('path');

const ENV_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-((?:[^}]|\\})*))?\}/g;

class EnvResolver {
  constructor(options = {}) {
    this.envFile = options.envFile || null;
    this.envVars = { ...process.env };
    this.referencedVars = new Map();
    this.missingVars = new Set();
    this.loadedEnvFile = false;
  }

  loadEnvFile(envFilePath) {
    const absPath = path.resolve(envFilePath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Environment file not found: ${envFilePath}`);
    }

    const content = fs.readFileSync(absPath, 'utf-8');
    const lines = content.replace(/\r\n/g, '\n').split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;

      const eqIdx = trimmed.search(/[=:]/);
      if (eqIdx === -1) continue;

      let key = trimmed.slice(0, eqIdx).trim();
      if (key.startsWith('export ')) {
        key = key.slice(7).trim();
      }

      let value = trimmed.slice(eqIdx + 1).trim();
      value = this.stripQuotes(value);
      value = this.processEscapes(value);

      if (!(key in this.envVars)) {
        this.envVars[key] = value;
      }
    }

    this.loadedEnvFile = true;
  }

  stripQuotes(value) {
    if (value.length < 2) return value;
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value;
  }

  processEscapes(value) {
    return value
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }

  resolve(data, inPlace = false) {
    if (this.envFile && !this.loadedEnvFile) {
      this.loadEnvFile(this.envFile);
    }

    const result = inPlace ? data : this.deepClone(data);
    this.resolveInPlace(result, '');
    return result;
  }

  resolveInPlace(obj, currentPath) {
    if (typeof obj === 'string') {
      return this.resolveString(obj, currentPath);
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        const itemPath = currentPath ? `${currentPath}[${i}]` : `[${i}]`;
        const resolved = this.resolveInPlace(obj[i], itemPath);
        if (resolved !== undefined) {
          obj[i] = resolved;
        }
      }
      return obj;
    }

    if (typeof obj === 'object' && obj !== null && !(obj instanceof Date)) {
      for (const key of Object.keys(obj)) {
        const keyPath = currentPath ? `${currentPath}.${key}` : key;
        const resolved = this.resolveInPlace(obj[key], keyPath);
        if (resolved !== undefined) {
          obj[key] = resolved;
        }
      }
      return obj;
    }

    return obj;
  }

  resolveString(str, configPath) {
    if (!str) return str;

    const originalStr = str;
    let hasPlaceholders = false;

    const result = str.replace(ENV_PATTERN, (match, varName, defaultValue) => {
      hasPlaceholders = true;

      const varRecord = this.referencedVars.get(varName) || {
        name: varName,
        defaultValue: defaultValue,
        paths: [],
        resolved: false,
        value: undefined,
        missing: false
      };

      if (configPath && !varRecord.paths.includes(configPath)) {
        varRecord.paths.push(configPath);
      }

      if (varName in this.envVars) {
        varRecord.resolved = true;
        varRecord.value = this.envVars[varName];
        varRecord.missing = false;
        this.referencedVars.set(varName, varRecord);
        return this.envVars[varName];
      }

      if (defaultValue !== undefined) {
        varRecord.resolved = true;
        varRecord.value = defaultValue;
        varRecord.missing = false;
        this.referencedVars.set(varName, varRecord);
        return defaultValue;
      }

      varRecord.resolved = false;
      varRecord.value = undefined;
      varRecord.missing = true;
      this.missingVars.add(varName);
      this.referencedVars.set(varName, varRecord);

      return match;
    });

    if (!hasPlaceholders) {
      return undefined;
    }

    return result;
  }

  hasMissingVars() {
    return this.missingVars.size > 0;
  }

  getMissingVarsList() {
    return Array.from(this.missingVars);
  }

  getReferencedVars() {
    return Array.from(this.referencedVars.values()).map(v => ({
      name: v.name,
      defaultValue: v.defaultValue,
      paths: v.paths,
      resolved: v.resolved,
      value: v.resolved ? v.value : undefined,
      missing: v.missing
    }));
  }

  deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj);
    if (Array.isArray(obj)) return obj.map(item => this.deepClone(item));
    const result = {};
    for (const key of Object.keys(obj)) {
      result[key] = this.deepClone(obj[key]);
    }
    return result;
  }
}

function resolveEnv(data, options = {}) {
  const resolver = new EnvResolver(options);
  const resolved = resolver.resolve(data);
  const missingVars = resolver.getMissingVarsList();

  return {
    data: resolved,
    missingVars: missingVars,
    referencedVars: resolver.getReferencedVars(),
    hasMissing: missingVars.length > 0
  };
}

function resolveEnvFile(configFilePath, options, formatParsers, detectFormat, parseFileFn) {
  const absPath = path.resolve(configFilePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Config file not found: ${configFilePath}`);
  }

  const content = fs.readFileSync(absPath, 'utf-8');
  const format = detectFormat(absPath, content);
  if (!format) {
    throw new Error(`Could not detect format for file: ${configFilePath}`);
  }

  const parser = formatParsers[format];
  if (!parser) {
    throw new Error(`Unsupported format: ${format}`);
  }

  const data = parser(content);
  return { ...resolveEnv(data, options), format: format, filePath: absPath };
}

function formatDryRunOutput(result) {
  const vars = result.referencedVars;

  if (vars.length === 0) {
    return 'No environment variable references found in the configuration.\n';
  }

  let output = `Found ${vars.length} environment variable reference(s):\n\n`;

  for (const v of vars) {
    const status = v.missing ? 'MISSING' : (v.defaultValue !== undefined ? 'DEFAULT' : 'RESOLVED');
    const statusColor = v.missing ? '✗' : (v.defaultValue !== undefined ? '◦' : '✓');
    output += `${statusColor} ${v.name} [${status}]\n`;
    if (v.defaultValue !== undefined) {
      output += `    Default: ${JSON.stringify(v.defaultValue)}\n`;
    }
    if (v.resolved && v.value !== undefined) {
      output += `    Value:   ${JSON.stringify(v.value)}\n`;
    }
    if (v.missing) {
      output += `    Value:   (NOT SET)\n`;
    }
    if (v.paths.length > 0) {
      output += `    Used at: ${v.paths.join(', ')}\n`;
    }
    output += '\n';
  }

  if (result.hasMissing) {
    output += `\n⚠ Warning: ${result.missingVars.length} environment variable(s) are missing and have no default value.\n`;
    output += `Missing: ${result.missingVars.join(', ')}\n`;
  } else {
    output += `✓ All referenced environment variables are either defined or have default values.\n`;
  }

  return output;
}

function formatMissingVarsError(missingVars) {
  return `Error: ${missingVars.length} environment variable(s) are not defined and have no default value: ${missingVars.join(', ')}`;
}

module.exports = {
  EnvResolver,
  resolveEnv,
  resolveEnvFile,
  formatDryRunOutput,
  formatMissingVarsError,
  ENV_PATTERN
};
