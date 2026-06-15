const fs = require('fs');
const path = require('path');

const EXTENDS_KEY = '_extends';

class MergeEngine {
  constructor(options = {}) {
    this.deep = options.deep !== false;
    this.arrayMode = options.arrayMode || 'replace';
    this.parseConfig = options.parseConfig || (() => {
      throw new Error('parseConfig function is required');
    });
    this.detectFormat = options.detectFormat || (() => null);
  }

  mergeObjects(base, override, visited) {
    if (visited === undefined) visited = [];

    const baseIdx = visited.findIndex(v => v.base === base && v.override === override);
    if (baseIdx !== -1) {
      return visited[baseIdx].result;
    }

    if (base === undefined) {
      return this.deepClone(override);
    }
    if (override === undefined) {
      return this.deepClone(base);
    }

    const baseIsArray = Array.isArray(base);
    const overrideIsArray = Array.isArray(override);

    if (baseIsArray || overrideIsArray) {
      return this.mergeArrays(base, override);
    }

    const baseIsObject = this.isPlainObject(base);
    const overrideIsObject = this.isPlainObject(override);

    if (baseIsObject && overrideIsObject) {
      const result = {};
      visited.push({ base, override, result });

      for (const key of Object.keys(base)) {
        if (key === EXTENDS_KEY) continue;
        result[key] = this.deepClone(base[key]);
      }

      for (const key of Object.keys(override)) {
        if (key === EXTENDS_KEY) continue;
        if (this.deep && key in result &&
            this.isPlainObject(result[key]) && this.isPlainObject(override[key])) {
          result[key] = this.mergeObjects(result[key], override[key], visited);
        } else if (this.deep && key in result &&
                   Array.isArray(result[key]) && Array.isArray(override[key])) {
          result[key] = this.mergeArrays(result[key], override[key]);
        } else {
          result[key] = this.deepClone(override[key]);
        }
      }

      return result;
    }

    return this.deepClone(override);
  }

  mergeArrays(base, override) {
    if (!Array.isArray(base) && Array.isArray(override)) {
      return this.deepClone(override);
    }
    if (Array.isArray(base) && !Array.isArray(override)) {
      return this.deepClone(base);
    }

    switch (this.arrayMode) {
      case 'concat':
        return [...base.map(item => this.deepClone(item)),
                ...override.map(item => this.deepClone(item))];
      case 'merge':
        const len = Math.max(base.length, override.length);
        const result = [];
        for (let i = 0; i < len; i++) {
          if (i < base.length && i < override.length) {
            result.push(this.mergeObjects(base[i], override[i]));
          } else if (i < base.length) {
            result.push(this.deepClone(base[i]));
          } else {
            result.push(this.deepClone(override[i]));
          }
        }
        return result;
      case 'replace':
      default:
        return this.deepClone(override);
    }
  }

  mergeMultiple(objs) {
    if (objs.length === 0) return {};
    if (objs.length === 1) return this.deepClone(this.removeExtendsKey(objs[0]));

    let result = this.deepClone(this.removeExtendsKey(objs[0]));
    for (let i = 1; i < objs.length; i++) {
      const cleanObj = this.deepClone(this.removeExtendsKey(objs[i]));
      result = this.mergeObjects(result, cleanObj);
    }
    return result;
  }

  removeExtendsKey(obj) {
    if (!this.isPlainObject(obj)) return obj;
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === EXTENDS_KEY) continue;
      if (this.isPlainObject(value)) {
        result[key] = this.removeExtendsKey(value);
      } else if (Array.isArray(value)) {
        result[key] = value.map(item => this.isPlainObject(item) ? this.removeExtendsKey(item) : item);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  resolveExtends(config, configFilePath, chain) {
    if (chain === undefined) chain = [];
    const absolutePath = path.resolve(configFilePath);
    if (chain.includes(absolutePath)) {
      const cycleStart = chain.indexOf(absolutePath);
      const cycle = [...chain.slice(cycleStart), absolutePath];
      throw new Error(`Circular inheritance detected: ${cycle.map(p => path.basename(p)).join(' -> ')}`);
    }

    const baseDir = path.dirname(absolutePath);
    chain = [...chain, absolutePath];

    if (!this.isPlainObject(config)) {
      return config;
    }

    const extendsValue = config[EXTENDS_KEY];
    let baseConfig = {};

    if (extendsValue !== undefined) {
      const extendFiles = Array.isArray(extendsValue) ? extendsValue : [extendsValue];

      for (const extendFile of extendFiles) {
        let resolvedExtendPath = extendFile;
        if (!path.isAbsolute(extendFile)) {
          resolvedExtendPath = path.resolve(baseDir, extendFile);
        }

        if (!fs.existsSync(resolvedExtendPath)) {
          throw new Error(`Extends file not found: ${extendFile} (resolved to ${resolvedExtendPath})`);
        }

        if (!this.isPlainObject(baseConfig)) baseConfig = {};

        let extendContent, extendFormat, extendData;
        try {
          extendContent = fs.readFileSync(resolvedExtendPath, 'utf-8');
          extendFormat = this.detectFormat(resolvedExtendPath, extendContent);
          if (!extendFormat) {
            throw new Error(`Could not detect format for extends file: ${resolvedExtendPath}`);
          }
          extendData = this.parseConfig(resolvedExtendPath, extendFormat);
        } catch (e) {
          throw new Error(`Failed to load extends file ${resolvedExtendPath}: ${e.message}`);
        }

        const resolvedExtendData = this.resolveExtends(extendData, resolvedExtendPath, chain);
        baseConfig = this.mergeObjects(baseConfig, resolvedExtendData);
      }
    }

    const cleanConfig = {};
    for (const [key, value] of Object.entries(config)) {
      if (key === EXTENDS_KEY) continue;
      cleanConfig[key] = value;
    }

    return this.mergeObjects(baseConfig, cleanConfig);
  }

  loadAndMergeFiles(filePaths, formatResolvers) {
    const loadedData = [];

    for (const filePath of filePaths) {
      const absolutePath = path.resolve(filePath);
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const content = fs.readFileSync(absolutePath, 'utf-8');
      const format = this.detectFormat(absolutePath, content);
      if (!format) {
        throw new Error(`Could not detect format for file: ${filePath}`);
      }

      const parser = formatResolvers[format];
      if (!parser) {
        throw new Error(`Unsupported format: ${format}`);
      }

      let data;
      try {
        data = parser(content);
      } catch (e) {
        throw new Error(`Failed to parse ${format} file ${filePath}: ${e.message}`);
      }

      data = this.resolveExtends(data, absolutePath);
      loadedData.push(data);
    }

    return this.mergeMultiple(loadedData);
  }

  isPlainObject(val) {
    return typeof val === 'object' && val !== null && !Array.isArray(val) && !(val instanceof Date);
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

function createMergeEngine(options) {
  return new MergeEngine(options);
}

function mergeConfigs(configs, options = {}) {
  const engine = new MergeEngine(options);
  return engine.mergeMultiple(configs);
}

function mergeFiles(filePaths, options, formatResolvers, detectFormat, parseFileFn) {
  const engine = new MergeEngine({
    ...options,
    detectFormat: detectFormat,
    parseConfig: (filePath, format) => {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parser = formatResolvers[format];
      if (!parser) throw new Error(`Unsupported format: ${format}`);
      return parser(content);
    }
  });
  return engine.loadAndMergeFiles(filePaths, formatResolvers);
}

function resolveExtendsInFile(filePath, options, formatResolvers, detectFormat) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  const format = detectFormat(absolutePath, content);
  if (!format) {
    throw new Error(`Could not detect format for file: ${filePath}`);
  }

  const parser = formatResolvers[format];
  if (!parser) {
    throw new Error(`Unsupported format: ${format}`);
  }

  const data = parser(content);
  const engine = new MergeEngine({
    ...options,
    detectFormat: detectFormat,
    parseConfig: (fp, fmt) => {
      const c = fs.readFileSync(fp, 'utf-8');
      const p = formatResolvers[fmt];
      if (!p) throw new Error(`Unsupported format: ${fmt}`);
      return p(c);
    }
  });

  return engine.resolveExtends(data, absolutePath);
}

module.exports = {
  MergeEngine,
  createMergeEngine,
  mergeConfigs,
  mergeFiles,
  resolveExtendsInFile,
  EXTENDS_KEY
};
