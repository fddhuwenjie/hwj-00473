const fs = require('fs');

const VALID_TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object', 'null', 'datetime', 'any'];

class SchemaValidator {
  constructor(schema) {
    this.schema = schema;
    this.errors = [];
  }

  validate(data, path = '', schemaNode = this.schema) {
    if (schemaNode.$schema) {
      schemaNode = schemaNode.properties ? schemaNode : this.extractRootSchema(schemaNode);
    }

    if (schemaNode.type) {
      this.validateType(data, path, schemaNode.type, schemaNode);
    }

    if (schemaNode.required && this.isObject(data)) {
      for (const reqKey of schemaNode.required) {
        const fullKey = path ? `${path}.${reqKey}` : reqKey;
        if (!(reqKey in data)) {
          this.addError(fullKey, 'missing_required',
            `Required key '${fullKey}' is missing`,
            undefined, undefined);
        }
      }
    }

    if (schemaNode.properties && this.isObject(data)) {
      for (const [propKey, propSchema] of Object.entries(schemaNode.properties)) {
        if (propKey in data) {
          const fullKey = path ? `${path}.${propKey}` : propKey;
          this.validate(data[propKey], fullKey, propSchema);
        }
      }
    }

    if (schemaNode.items && Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        const itemPath = `${path}[${i}]`;
        this.validate(data[i], itemPath, schemaNode.items);
      }
    }

    if (schemaNode.enum !== undefined) {
      const matched = schemaNode.enum.some(v => {
        if (v === null) return data === null;
        if (typeof v === 'object') return JSON.stringify(v) === JSON.stringify(data);
        return v === data;
      });
      if (!matched) {
        this.addError(path, 'enum_mismatch',
          `Value '${JSON.stringify(data)}' is not in the allowed enum`,
          schemaNode.enum, data);
      }
    }

    if (schemaNode.pattern !== undefined && typeof data === 'string') {
      try {
        const regex = new RegExp(schemaNode.pattern);
        if (!regex.test(data)) {
          this.addError(path, 'pattern_mismatch',
            `String does not match pattern '${schemaNode.pattern}'`,
            schemaNode.pattern, data);
        }
      } catch (e) {
        this.addError(path, 'invalid_pattern',
          `Invalid regex pattern: ${e.message}`, schemaNode.pattern, undefined);
      }
    }

    if (schemaNode.minimum !== undefined && typeof data === 'number') {
      if (data < schemaNode.minimum) {
        this.addError(path, 'minimum_violation',
          `Value ${data} is less than minimum ${schemaNode.minimum}`,
          `>= ${schemaNode.minimum}`, data);
      }
    }

    if (schemaNode.maximum !== undefined && typeof data === 'number') {
      if (data > schemaNode.maximum) {
        this.addError(path, 'maximum_violation',
          `Value ${data} is greater than maximum ${schemaNode.maximum}`,
          `<= ${schemaNode.maximum}`, data);
      }
    }

    if (schemaNode.minLength !== undefined && typeof data === 'string') {
      if (data.length < schemaNode.minLength) {
        this.addError(path, 'minLength_violation',
          `String length ${data.length} is less than minLength ${schemaNode.minLength}`,
          `length >= ${schemaNode.minLength}`, data);
      }
    }

    if (schemaNode.maxLength !== undefined && typeof data === 'string') {
      if (data.length > schemaNode.maxLength) {
        this.addError(path, 'maxLength_violation',
          `String length ${data.length} is greater than maxLength ${schemaNode.maxLength}`,
          `length <= ${schemaNode.maxLength}`, data);
      }
    }

    if (schemaNode.minItems !== undefined && Array.isArray(data)) {
      if (data.length < schemaNode.minItems) {
        this.addError(path, 'minItems_violation',
          `Array length ${data.length} is less than minItems ${schemaNode.minItems}`,
          `length >= ${schemaNode.minItems}`, data.length);
      }
    }

    if (schemaNode.maxItems !== undefined && Array.isArray(data)) {
      if (data.length > schemaNode.maxItems) {
        this.addError(path, 'maxItems_violation',
          `Array length ${data.length} is greater than maxItems ${schemaNode.maxItems}`,
          `length <= ${schemaNode.maxItems}`, data.length);
      }
    }

    if (schemaNode.uniqueItems && Array.isArray(data)) {
      const seen = new Set();
      for (const item of data) {
        const key = typeof item === 'object' ? JSON.stringify(item) : String(item);
        if (seen.has(key)) {
          this.addError(path, 'uniqueItems_violation',
            `Array contains duplicate items`, undefined, undefined);
          break;
        }
        seen.add(key);
      }
    }

    return this.errors;
  }

  extractRootSchema(schemaNode) {
    if (schemaNode.type || schemaNode.properties || schemaNode.items) {
      return schemaNode;
    }
    return schemaNode;
  }

  isObject(val) {
    return typeof val === 'object' && val !== null && !Array.isArray(val) && !(val instanceof Date);
  }

  validateType(data, path, expectedType, schemaNode) {
    const types = Array.isArray(expectedType) ? expectedType : [expectedType];
    let matched = false;

    for (const t of types) {
      if (this.checkType(data, t)) {
        matched = true;
        break;
      }
    }

    if (!matched) {
      const actualType = this.getActualType(data);
      this.addError(path, 'type_mismatch',
        `Expected type '${types.join(' | ')}', got '${actualType}'`,
        types.join(' | '), actualType);
    }
  }

  checkType(data, type) {
    switch (type) {
      case 'string':
        return typeof data === 'string';
      case 'number':
        return typeof data === 'number';
      case 'integer':
        return typeof data === 'number' && Number.isInteger(data);
      case 'boolean':
        return typeof data === 'boolean';
      case 'array':
        return Array.isArray(data);
      case 'object':
        return this.isObject(data);
      case 'null':
        return data === null;
      case 'datetime':
        return data instanceof Date || (typeof data === 'string' && !isNaN(Date.parse(data)));
      case 'any':
        return true;
      default:
        return false;
    }
  }

  getActualType(data) {
    if (data === null) return 'null';
    if (data instanceof Date) return 'datetime';
    if (Array.isArray(data)) return 'array';
    return typeof data;
  }

  addError(path, errorType, message, expected, actual) {
    this.errors.push({
      path: path || '(root)',
      type: errorType,
      message: message,
      expected: expected,
      actual: actual
    });
  }
}

function validateConfig(data, schema) {
  const validator = new SchemaValidator(schema);
  return validator.validate(data);
}

function validateConfigFile(configFilePath, schemaFilePath, parseConfig) {
  const configContent = fs.readFileSync(configFilePath, 'utf-8');
  const schemaContent = fs.readFileSync(schemaFilePath, 'utf-8');

  const configData = parseConfig(configContent);
  const schema = JSON.parse(schemaContent);

  return validateConfig(configData, schema);
}

function formatValidationErrors(errors) {
  if (errors.length === 0) {
    return '✓ Schema validation passed: No errors found.\n';
  }

  let output = `✗ Schema validation failed: Found ${errors.length} error(s):\n\n`;
  for (let i = 0; i < errors.length; i++) {
    const err = errors[i];
    output += `[${i + 1}] ${err.path}\n`;
    output += `  Type:    ${err.type}\n`;
    output += `  Message: ${err.message}\n`;
    if (err.expected !== undefined) {
      output += `  Expected: ${JSON.stringify(err.expected)}\n`;
    }
    if (err.actual !== undefined) {
      output += `  Actual:   ${JSON.stringify(err.actual)}\n`;
    }
    output += '\n';
  }
  return output;
}

class SchemaGenerator {
  constructor() {
    this.collectedValues = new Map();
  }

  generate(data, options = {}) {
    const includeExamples = options.includeExamples !== false;
    const schema = this.inferSchema(data, '', includeExamples);
    schema.$schema = 'http://json-schema.org/draft-07/schema#';
    schema.$comment = 'Auto-generated schema by confconv';
    return schema;
  }

  inferSchema(data, path, includeExamples) {
    if (data === null || data === undefined) {
      return { type: 'null' };
    }

    if (data instanceof Date) {
      return { type: 'datetime' };
    }

    if (Array.isArray(data)) {
      return this.inferArraySchema(data, path, includeExamples);
    }

    if (typeof data === 'object') {
      return this.inferObjectSchema(data, path, includeExamples);
    }

    if (typeof data === 'string') {
      const schema = { type: 'string' };
      if (includeExamples) schema.examples = [data];
      if (!isNaN(Date.parse(data)) && /^\d{4}-\d{2}-\d{2}/.test(data)) {
        schema.format = 'date-time';
      }
      return schema;
    }

    if (typeof data === 'number') {
      const schema = Number.isInteger(data) ? { type: 'integer' } : { type: 'number' };
      if (includeExamples) schema.examples = [data];
      return schema;
    }

    if (typeof data === 'boolean') {
      return { type: 'boolean' };
    }

    return { type: 'any' };
  }

  inferArraySchema(arr, path, includeExamples) {
    const schema = { type: 'array' };
    if (arr.length === 0) {
      return schema;
    }

    schema.minItems = arr.length;
    schema.maxItems = arr.length;

    const itemSchemas = arr.map(item => this.inferSchema(item, `${path}[]`, includeExamples));
    const firstType = itemSchemas[0].type;
    const allSameType = itemSchemas.every(s => s.type === firstType);

    if (allSameType && firstType === 'object') {
      const mergedProps = {};
      const requiredSet = new Set();
      for (const item of arr) {
        for (const key of Object.keys(item)) {
          requiredSet.add(key);
        }
      }

      for (const itemSchema of itemSchemas) {
        if (itemSchema.properties) {
          for (const [propKey, propSchema] of Object.entries(itemSchema.properties)) {
            if (!(propKey in mergedProps)) {
              mergedProps[propKey] = propSchema;
            }
          }
        }
      }

      schema.items = { type: 'object', properties: mergedProps };
      if (requiredSet.size > 0) {
        schema.items.required = Array.from(requiredSet);
      }
    } else if (allSameType) {
      schema.items = itemSchemas[0];
    } else {
      schema.items = { type: 'any' };
    }

    return schema;
  }

  inferObjectSchema(obj, path, includeExamples) {
    const schema = { type: 'object', properties: {}, required: [] };

    for (const [key, value] of Object.entries(obj)) {
      const fullKey = path ? `${path}.${key}` : key;
      schema.properties[key] = this.inferSchema(value, fullKey, includeExamples);
      schema.required.push(key);
    }

    if (schema.required.length === 0) {
      delete schema.required;
    }

    return schema;
  }
}

function generateSchemaFromData(data, options) {
  const generator = new SchemaGenerator();
  return generator.generate(data, options);
}

function generateSchemaFromFile(configFilePath, parseConfig, options) {
  const content = fs.readFileSync(configFilePath, 'utf-8');
  const data = parseConfig(content);
  return generateSchemaFromData(data, options);
}

module.exports = {
  SchemaValidator,
  validateConfig,
  validateConfigFile,
  formatValidationErrors,
  SchemaGenerator,
  generateSchemaFromData,
  generateSchemaFromFile,
  VALID_TYPES
};
