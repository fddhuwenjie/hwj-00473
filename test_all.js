const fs = require('fs');
const path = require('path');

const confconv = require('./confconv');
const comments = require('./lib/comments');
const schema = require('./lib/schema');
const merge = require('./lib/merge');
const resolve = require('./lib/resolve');
const pathquery = require('./lib/pathquery');
const formats = require('./lib/formats');
const toml = require('./lib/toml');
const ini = require('./lib/ini');
const xml = require('./lib/xml');
const dotenv = require('./lib/dotenv');

const EXAMPLES_DIR = path.join(__dirname, 'examples');
const TMP_DIR = path.join(__dirname, 'tmp_test');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passCount++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${e.message}`);
    failCount++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

function assertEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(message || `Expected ${expectedStr}, got ${actualStr}`);
  }
}

function setupTmpDir() {
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
}

function cleanupTmpDir() {
  if (fs.existsSync(TMP_DIR)) {
    const files = fs.readdirSync(TMP_DIR);
    for (const f of files) {
      fs.unlinkSync(path.join(TMP_DIR, f));
    }
    fs.rmdirSync(TMP_DIR);
  }
}

function copyExample(srcName, dstName) {
  const src = path.join(EXAMPLES_DIR, srcName);
  const dst = path.join(TMP_DIR, dstName);
  fs.copyFileSync(src, dst);
  return dst;
}

console.log('\n========================================');
console.log('Config Converter - Complete Test Suite');
console.log('========================================\n');

setupTmpDir();

try {

console.log('1. Testing Original Core Functions');
console.log('-----------------------------------');

test('Parse sample.toml', () => {
  const result = confconv.parseFile(path.join(EXAMPLES_DIR, 'sample.toml'), 'toml');
  assertEqual(result.format, 'toml');
  assert(result.data.app.name === 'My Application');
  assert(result.data.database.host === 'localhost');
  assert(Array.isArray(result.data.servers));
  assert(result.data.servers.length === 2);
});

test('Parse sample.yaml', () => {
  const result = confconv.parseFile(path.join(EXAMPLES_DIR, 'sample.yaml'), 'yaml');
  assertEqual(result.format, 'yaml');
  assert(result.data.app.debug === true);
  assert(result.data.app.port === 8080);
});

test('Parse sample.json', () => {
  const result = confconv.parseFile(path.join(EXAMPLES_DIR, 'sample.json'), 'json');
  assertEqual(result.format, 'json');
  assert(result.data.features.length === 4);
});

test('Parse sample.ini', () => {
  const result = confconv.parseFile(path.join(EXAMPLES_DIR, 'sample.ini'), 'ini');
  assertEqual(result.format, 'ini');
  assert(result.data.app !== undefined);
});

test('Convert TOML to JSON', () => {
  const { data } = confconv.parseFile(path.join(EXAMPLES_DIR, 'sample.toml'), 'toml');
  const serialized = confconv.serializeData(data, 'json', { pretty: true });
  const parsed = JSON.parse(serialized);
  assert(parsed.app.name === 'My Application');
  assert(parsed.database.port === 5432);
});

console.log('\n2. Testing Feature 1: Comments Extraction');
console.log('------------------------------------------');

test('Extract comments from TOML', () => {
  const content = fs.readFileSync(path.join(EXAMPLES_DIR, 'sample.toml'), 'utf-8');
  const extracted = comments.extractComments(content, 'toml');
  assert(Array.isArray(extracted));
  const appComment = extracted.find(c => c.key === 'description' || c.key.startsWith('description'));
  console.log(`    Extracted ${extracted.length} comment(s) from TOML`);
});

test('Extract comments from YAML', () => {
  const yamlContent = `
# Top level comment
app:
  # Name of app
  name: MyApp
  version: "1.0" # inline version comment
port: 8080
`;
  const extracted = comments.extractComments(yamlContent, 'yaml');
  console.log(`    Extracted ${extracted.length} comment(s) from YAML`);
  assert(extracted.length >= 2, 'Expected at least 2 comments');
});

test('Extract comments from INI', () => {
  const iniContent = `
; Main config file
; Version 2.0
[database]
; Database host
host = localhost
port = 5432 ; Postgres default port
`;
  const extracted = comments.extractComments(iniContent, 'ini');
  console.log(`    Extracted ${extracted.length} comment(s) from INI`);
  assert(extracted.length >= 3, 'Expected at least 3 comments');
  const portComment = extracted.find(c => c.key === 'database.port');
  assert(portComment !== undefined, 'Expected inline comment on port');
});

test('Comments sidecar file for JSON output', () => {
  const tmpYaml = copyExample('sample.yaml', 'test_sidecar.yaml');
  const { data, content, format } = confconv.parseFile(tmpYaml, 'yaml');
  const sourceComments = comments.extractComments(content, format);
  const outputPath = path.join(TMP_DIR, 'output_sidecar.json');
  const serialized = confconv.serializeData(data, 'json', { pretty: true });
  fs.writeFileSync(outputPath, serialized, 'utf-8');
  if (sourceComments.length > 0) {
    const sidecar = comments.writeCommentsSidecar(outputPath, sourceComments);
    assert(fs.existsSync(sidecar), 'Sidecar file should exist');
    const sidecarData = JSON.parse(fs.readFileSync(sidecar, 'utf-8'));
    assert(sidecarData.comments !== undefined, 'Sidecar should have comments');
    console.log(`    Sidecar written with ${sidecarData.comments.length} comment(s)`);
    fs.unlinkSync(sidecar);
  }
  fs.unlinkSync(outputPath);
});

console.log('\n3. Testing Feature 2: Schema Validation & Generation');
console.log('---------------------------------------------------');

test('Generate schema from config', () => {
  const { data } = confconv.parseFile(path.join(EXAMPLES_DIR, 'sample.json'), 'json');
  const generatedSchema = schema.generateSchemaFromData(data, { includeExamples: true });
  assert(generatedSchema.$schema !== undefined);
  assert(generatedSchema.type === 'object');
  assert(generatedSchema.properties !== undefined);
  assert(generatedSchema.properties.app !== undefined);
  assert(generatedSchema.properties.app.type === 'object');
  console.log(`    Generated schema with ${Object.keys(generatedSchema.properties).length} top-level properties`);
});

test('Validate config against generated schema', () => {
  const { data } = confconv.parseFile(path.join(EXAMPLES_DIR, 'sample.json'), 'json');
  const generatedSchema = schema.generateSchemaFromData(data);
  const errors = schema.validateConfig(data, generatedSchema);
  assertEqual(errors.length, 0, 'Should have no validation errors');
});

test('Schema validation with type errors', () => {
  const testSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      port: { type: 'integer', minimum: 1, maximum: 65535 },
      debug: { type: 'boolean' },
      tags: { type: 'array', items: { type: 'string' } }
    },
    required: ['name', 'port']
  };

  const validData = { name: 'test', port: 8080, debug: true, tags: ['a', 'b'] };
  assertEqual(schema.validateConfig(validData, testSchema).length, 0);

  const invalidData1 = { port: 'not-a-number', debug: 'yes' };
  let errors = schema.validateConfig(invalidData1, testSchema);
  assert(errors.length >= 2, 'Expected at least 2 errors');
  assert(errors.some(e => e.type === 'missing_required'), 'Should have missing required error');
  assert(errors.some(e => e.type === 'type_mismatch'), 'Should have type mismatch error');

  const invalidData2 = { name: 'x', port: 70000 };
  errors = schema.validateConfig(invalidData2, testSchema);
  assert(errors.length >= 1, 'Expected maximum violation');
  assert(errors.some(e => e.type === 'maximum_violation'), 'Should have maximum violation');
});

test('Schema with pattern and enum', () => {
  const testSchema = {
    type: 'object',
    properties: {
      email: { type: 'string', pattern: '^.+@.+$' },
      status: { type: 'string', enum: ['active', 'inactive', 'pending'] }
    }
  };

  const valid = { email: 'a@b.com', status: 'active' };
  assertEqual(schema.validateConfig(valid, testSchema).length, 0);

  const invalidEmail = { email: 'not-email', status: 'active' };
  const errors1 = schema.validateConfig(invalidEmail, testSchema);
  assert(errors1.some(e => e.type === 'pattern_mismatch'));

  const invalidStatus = { email: 'a@b.com', status: 'deleted' };
  const errors2 = schema.validateConfig(invalidStatus, testSchema);
  assert(errors2.some(e => e.type === 'enum_mismatch'));
});

console.log('\n4. Testing Feature 3: Config Merge & Inheritance');
console.log('------------------------------------------------');

test('Simple shallow merge', () => {
  const base = { a: 1, b: { x: 10, y: 20 }, c: [1, 2] };
  const override = { b: { z: 30 }, c: [3, 4], d: 'new' };
  const result = merge.mergeConfigs([base, override], { deep: false, arrayMode: 'replace' });
  assertEqual(result.a, 1);
  assertEqual(result.b, { z: 30 });
  assertEqual(result.c, [3, 4]);
  assertEqual(result.d, 'new');
});

test('Deep merge objects', () => {
  const base = {
    database: { host: 'localhost', port: 5432, credentials: { user: 'admin' } },
    features: ['auth']
  };
  const override = {
    database: { port: 3306, credentials: { password: 'secret' }, ssl: true },
    features: ['logging']
  };
  const result = merge.mergeConfigs([base, override], { deep: true, arrayMode: 'replace' });
  assertEqual(result.database.host, 'localhost');
  assertEqual(result.database.port, 3306);
  assertEqual(result.database.credentials.user, 'admin');
  assertEqual(result.database.credentials.password, 'secret');
  assert(result.database.ssl === true);
  assertEqual(result.features, ['logging']);
});

test('Array concat mode', () => {
  const base = { tags: ['a', 'b'] };
  const override = { tags: ['c', 'd'] };
  const result = merge.mergeConfigs([base, override], { deep: true, arrayMode: 'concat' });
  assertEqual(result.tags.length, 4);
  assert(result.tags.includes('a'));
  assert(result.tags.includes('d'));
});

test('Array merge mode', () => {
  const base = { servers: [{ name: 's1', port: 80 }, { name: 's2' }] };
  const override = { servers: [{ port: 443 }, { ssl: true }] };
  const result = merge.mergeConfigs([base, override], { deep: true, arrayMode: 'merge' });
  assertEqual(result.servers[0].name, 's1');
  assertEqual(result.servers[0].port, 443);
  assertEqual(result.servers[1].ssl, true);
});

test('Multiple file merge with different formats', () => {
  const baseJson = copyExample('sample.json', 'base.json');
  const { data: baseData } = confconv.parseFile(baseJson, 'json');
  const overrideData = {
    app: { debug: false, newField: 'override' },
    database: { new_option: true },
    extra: 'from_override'
  };
  const overridePath = path.join(TMP_DIR, 'override.yaml');
  fs.writeFileSync(overridePath, formats.stringifyYAML(overrideData), 'utf-8');

  const result = merge.mergeFiles(
    [baseJson, overridePath],
    { deep: true, arrayMode: 'replace' },
    confconv.FORMAT_PARSERS,
    formats.detectFormat,
    confconv.parseFile
  );

  assertEqual(result.app.debug, false);
  assertEqual(result.app.newField, 'override');
  assertEqual(result.app.name, 'My Application');
  assert(result.database.new_option === true);
  assert(result.extra === 'from_override');

  fs.unlinkSync(overridePath);
});

test('Extends inheritance with _extends field', () => {
  const baseConfig = {
    app: {
      name: 'BaseApp',
      version: '1.0.0',
      debug: true
    },
    database: {
      host: 'localhost',
      port: 5432
    }
  };
  const basePath = path.join(TMP_DIR, 'base_extends.yaml');
  fs.writeFileSync(basePath, formats.stringifyYAML(baseConfig), 'utf-8');

  const childConfig = {
    _extends: 'base_extends.yaml',
    app: {
      version: '2.0.0'
    },
    features: ['auth']
  };
  const childPath = path.join(TMP_DIR, 'child_extends.yaml');
  fs.writeFileSync(childPath, formats.stringifyYAML(childConfig), 'utf-8');

  const result = merge.resolveExtendsInFile(
    childPath,
    { deep: true, arrayMode: 'replace' },
    confconv.FORMAT_PARSERS,
    formats.detectFormat
  );

  assertEqual(result.app.name, 'BaseApp');
  assertEqual(result.app.version, '2.0.0');
  assertEqual(result.app.debug, true);
  assertEqual(result.database.host, 'localhost');
  assertEqual(result.features, ['auth']);

  fs.unlinkSync(basePath);
  fs.unlinkSync(childPath);
});

console.log('\n5. Testing Feature 4: Environment Variable Interpolation');
console.log('-------------------------------------------------------');

process.env.TEST_APP_NAME = 'EnvTestApp';
process.env.TEST_DB_HOST = 'db.example.com';
process.env.TEST_DB_PORT = '3306';

test('Basic env var replacement', () => {
  const data = {
    app: {
      name: '${TEST_APP_NAME}',
      host: '${TEST_DB_HOST}'
    },
    port: '${TEST_DB_PORT}'
  };
  const result = resolve.resolveEnv(data);
  assert(!result.hasMissing, 'Should have no missing vars');
  assertEqual(result.data.app.name, 'EnvTestApp');
  assertEqual(result.data.app.host, 'db.example.com');
});

test('Env var with default value', () => {
  const data = {
    timeout: '${NONEXISTENT_VAR:-30}',
    fallback: '${ALSO_MISSING:-default_value}'
  };
  const result = resolve.resolveEnv(data);
  assertEqual(result.data.timeout, '30');
  assertEqual(result.data.fallback, 'default_value');
  assert(result.referencedVars.length > 0, 'Should track referenced vars');
  const timeoutVar = result.referencedVars.find(v => v.name === 'NONEXISTENT_VAR');
  assert(timeoutVar.defaultValue === '30');
  assert(timeoutVar.resolved === true);
});

test('Missing env vars detection', () => {
  const data = {
    secret: '${NONEXISTENT_SECRET}',
    key: '${MISSING_KEY}'
  };
  const result = resolve.resolveEnv(data);
  assert(result.hasMissing === true, 'Should detect missing vars');
  assert(result.missingVars.length >= 2);
  assert(result.missingVars.includes('NONEXISTENT_SECRET'));
  assert(result.missingVars.includes('MISSING_KEY'));
});

test('Load env vars from .env file', () => {
  const envContent = `
DOTENV_APP_NAME=DotEnvApp
DOTENV_DEBUG=true
DOTENV_PORT=9090
`;
  const envFilePath = path.join(TMP_DIR, 'test.env');
  fs.writeFileSync(envFilePath, envContent, 'utf-8');

  const data = {
    name: '${DOTENV_APP_NAME}',
    debug: '${DOTENV_DEBUG}',
    port: '${DOTENV_PORT}'
  };
  const result = resolve.resolveEnv(data, { envFile: envFilePath });
  assertEqual(result.data.name, 'DotEnvApp');
  assertEqual(result.data.debug, 'true');
  assertEqual(result.data.port, '9090');

  fs.unlinkSync(envFilePath);
});

test('Dry run mode output', () => {
  process.env.DRY_TEST = 'present';
  const data = {
    a: '${DRY_TEST}',
    b: '${MISSING_NO_DEFAULT}',
    c: '${HAS_DEFAULT:-fallback}'
  };
  const result = resolve.resolveEnv(data);
  const output = resolve.formatDryRunOutput(result);
  assert(output.includes('DRY_TEST'), 'Should mention DRY_TEST in output');
  assert(output.includes('MISSING'), 'Should mention missing');
  console.log(`\n${output.split('\n').slice(0, 8).map(l => '      ' + l).join('\n')}`);
});

delete process.env.TEST_APP_NAME;
delete process.env.TEST_DB_HOST;
delete process.env.TEST_DB_PORT;
delete process.env.DRY_TEST;

console.log('\n6. Testing Feature 5: Config Path Query (Get/Set/Delete)');
console.log('--------------------------------------------------------');

const sampleData = {
  app: {
    name: 'TestApp',
    version: '1.0',
    debug: true,
    port: 8080,
    credentials: {
      username: 'admin',
      password: 's3cr3t'
    }
  },
  servers: [
    { name: 's1', host: 'h1', port: 80 },
    { name: 's2', host: 'h2', port: 443 }
  ],
  features: ['auth', 'logging']
};

test('Get value by dot-path', () => {
  const result = pathquery.getValue(sampleData, 'app.name');
  assert(result.found === true);
  assertEqual(result.value, 'TestApp');
});

test('Get nested value', () => {
  const result = pathquery.getValue(sampleData, 'app.credentials.password');
  assert(result.found === true);
  assertEqual(result.value, 's3cr3t');
});

test('Get array element by index', () => {
  const result = pathquery.getValue(sampleData, 'servers[1].host');
  assert(result.found === true);
  assertEqual(result.value, 'h2');
});

test('Get array feature element', () => {
  const result = pathquery.getValue(sampleData, 'features[0]');
  assert(result.found === true);
  assertEqual(result.value, 'auth');
});

test('Get non-existent key returns not found', () => {
  const result = pathquery.getValue(sampleData, 'app.nonexistent.field');
  assert(result.found === false);
});

test('Set simple value', () => {
  const data = JSON.parse(JSON.stringify(sampleData));
  pathquery.setValue(data, 'app.name', 'UpdatedApp');
  assertEqual(data.app.name, 'UpdatedApp');
});

test('Set nested value', () => {
  const data = JSON.parse(JSON.stringify(sampleData));
  pathquery.setValue(data, 'app.credentials.password', 'newpass');
  assertEqual(data.app.credentials.password, 'newpass');
});

test('Set array element', () => {
  const data = JSON.parse(JSON.stringify(sampleData));
  pathquery.setValue(data, 'servers[0].port', 8080);
  assertEqual(data.servers[0].port, 8080);
});

test('Set value with auto type inference', () => {
  const inferred1 = pathquery.inferValueType('42');
  assertEqual(inferred1.type, 'integer');
  assertEqual(inferred1.value, 42);

  const inferred2 = pathquery.inferValueType('3.14');
  assertEqual(inferred2.type, 'number');

  const inferred3 = pathquery.inferValueType('true');
  assertEqual(inferred3.type, 'boolean');
  assertEqual(inferred3.value, true);

  const inferred4 = pathquery.inferValueType('null');
  assertEqual(inferred4.type, 'null');

  const inferred5 = pathquery.inferValueType('hello world');
  assertEqual(inferred5.type, 'string');
});

test('Set value with explicit type', () => {
  const explicit1 = pathquery.parseExplicitType('123', 'string');
  assertEqual(explicit1.type, 'string');
  assertEqual(explicit1.value, '123');

  const explicit2 = pathquery.parseExplicitType('true', 'boolean');
  assertEqual(explicit2.type, 'boolean');

  const explicit3 = pathquery.parseExplicitType('{"a":1}', 'json');
  assertEqual(explicit3.value.a, 1);
});

test('Delete key from object', () => {
  const data = JSON.parse(JSON.stringify(sampleData));
  const result = pathquery.deleteValue(data, 'app.debug');
  assert(result.deleted === true);
  assert(data.app.debug === undefined);
  assert('name' in data.app);
});

test('Delete array element', () => {
  const data = JSON.parse(JSON.stringify(sampleData));
  const originalLen = data.servers.length;
  const result = pathquery.deleteValue(data, 'servers[0]');
  assert(result.deleted === true);
  assertEqual(data.servers.length, originalLen - 1);
  assertEqual(data.servers[0].name, 's2');
});

test('Delete non-existent key', () => {
  const data = JSON.parse(JSON.stringify(sampleData));
  const result = pathquery.deleteValue(data, 'app.nonexistent');
  assert(result.deleted === false);
});

test('Path parser validation', () => {
  const segs = pathquery.PathParser.parse('a.b.c[0].d');
  assert(segs.length === 5);
  assertEqual(segs[0].type, 'key');
  assertEqual(segs[0].value, 'a');
  assertEqual(segs[2].type, 'key');
  assertEqual(segs[2].value, 'c');
  assertEqual(segs[3].type, 'index');
  assertEqual(segs[3].value, 0);
});

test('End-to-end get from file', () => {
  const tmpFile = copyExample('sample.json', 'test_get.json');
  const { data } = confconv.parseFile(tmpFile, 'json');
  const result = pathquery.getValue(data, 'database.credentials.username');
  assert(result.found === true);
  assertEqual(result.value, 'admin');
  fs.unlinkSync(tmpFile);
});

test('End-to-end set and persist to file', () => {
  const tmpFile = copyExample('sample.yaml', 'test_set.yaml');
  const { data, format } = confconv.parseFile(tmpFile, 'yaml');
  pathquery.setValue(data, 'app.debug', false);
  pathquery.setValue(data, 'app.newKey', 'test');
  const serialized = confconv.serializeData(data, format, { pretty: true });
  fs.writeFileSync(tmpFile, serialized, 'utf-8');
  const reloaded = confconv.parseFile(tmpFile, format);
  assertEqual(reloaded.data.app.debug, false);
  assertEqual(reloaded.data.app.newKey, 'test');
  fs.unlinkSync(tmpFile);
});

console.log('\n7. Testing CLI Command Integration');
console.log('----------------------------------');

const { execSync } = require('child_process');
const CLI = 'node confconv.js';

function runCli(args, env = {}) {
  try {
    const output = execSync(`${CLI} ${args} 2>&1`, {
      encoding: 'utf-8',
      env: { ...process.env, ...env }
    });
    return { success: true, output, exitCode: 0 };
  } catch (e) {
    return { success: false, output: e.stdout + e.stderr, exitCode: e.status };
  }
}

test('CLI: comments subcommand', () => {
  const r = runCli(`comments ${path.join(EXAMPLES_DIR, 'sample.toml')}`);
  assert(r.success, `CLI failed: ${r.output}`);
  console.log(`    CLI output sample: "${r.output.split('\n')[0].slice(0, 60)}..."`);
});

test('CLI: schema generate subcommand', () => {
  const tmpOutput = path.join(TMP_DIR, 'gen_schema.json');
  const r = runCli(`schema generate ${path.join(EXAMPLES_DIR, 'sample.json')} -o ${tmpOutput} --no-examples`);
  assert(r.success, `CLI failed: ${r.output}`);
  assert(fs.existsSync(tmpOutput));
  const schemaData = JSON.parse(fs.readFileSync(tmpOutput, 'utf-8'));
  assert(schemaData.$schema !== undefined);
  fs.unlinkSync(tmpOutput);
});

test('CLI: merge subcommand', () => {
  const f1 = copyExample('sample.json', 'm1.json');
  const f2 = copyExample('sample.yaml', 'm2.yaml');
  const tmpOutput = path.join(TMP_DIR, 'merged.json');
  const r = runCli(`merge ${f1} ${f2} -o ${tmpOutput}`);
  assert(r.success, `CLI failed: ${r.output}`);
  assert(fs.existsSync(tmpOutput));
  fs.unlinkSync(f1);
  fs.unlinkSync(f2);
  fs.unlinkSync(tmpOutput);
});

test('CLI: resolve dry-run', () => {
  const resolveData = {
    host: '${RESOLVE_TEST_HOST:-localhost}',
    port: '${RESOLVE_TEST_PORT:-8080}'
  };
  const resolveFile = path.join(TMP_DIR, 'resolve_test.json');
  fs.writeFileSync(resolveFile, JSON.stringify(resolveData, null, 2), 'utf-8');
  const r = runCli(`resolve ${resolveFile} --dry-run`);
  assert(r.success, `CLI failed: ${r.output}`);
  assert(r.output.includes('RESOLVE_TEST_HOST'));
  fs.unlinkSync(resolveFile);
});

test('CLI: get subcommand', () => {
  const tmpFile = copyExample('sample.json', 'cli_get.json');
  const r = runCli(`get ${tmpFile} database.host`);
  assert(r.success, `CLI failed: ${r.output}`);
  assert(r.output.trim() === 'localhost');
  fs.unlinkSync(tmpFile);
});

test('CLI: set subcommand', () => {
  const tmpFile = copyExample('sample.json', 'cli_set.json');
  const r = runCli(`set ${tmpFile} app.port 9999 --type integer`);
  assert(r.success, `CLI failed: ${r.output}`);
  const data = JSON.parse(fs.readFileSync(tmpFile, 'utf-8'));
  assertEqual(data.app.port, 9999);
  fs.unlinkSync(tmpFile);
});

console.log('\n========================================');
console.log('Test Results Summary');
console.log('========================================');
console.log(`  Passed: ${passCount}`);
console.log(`  Failed: ${failCount}`);
console.log(`  Total:  ${passCount + failCount}`);

if (failCount === 0) {
  console.log('\n  🎉 All tests passed!\n');
} else {
  console.log(`\n  ⚠ ${failCount} test(s) failed.\n`);
  process.exit(1);
}

} finally {
  cleanupTmpDir();
}
