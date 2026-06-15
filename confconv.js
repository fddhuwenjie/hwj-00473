#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const toml = require('./lib/toml');
const ini = require('./lib/ini');
const xml = require('./lib/xml');
const dotenv = require('./lib/dotenv');
const formats = require('./lib/formats');
const convert = require('./lib/convert');
const comments = require('./lib/comments');
const schema = require('./lib/schema');
const merge = require('./lib/merge');
const resolve = require('./lib/resolve');
const pathquery = require('./lib/pathquery');

const FORMAT_PARSERS = {
  json: formats.parseJSON,
  yaml: formats.parseYAML,
  toml: toml.parse,
  ini: ini.parse,
  xml: xml.parse,
  dotenv: dotenv.parse
};

const FORMAT_SERIALIZERS = {
  json: formats.stringifyJSON,
  yaml: formats.stringifyYAML,
  toml: toml.stringify,
  ini: ini.stringify,
  xml: xml.stringify,
  dotenv: dotenv.stringify
};

function printUsage() {
  console.log(`
Config Converter (confconv)
============================

Core Commands:
  node confconv.js INPUT [-o OUTPUT] [--from FORMAT] [--to FORMAT] [options]
  node confconv.js convert DIR --from FORMAT --to FORMAT [options]
  node confconv.js validate FILE [--from FORMAT]

New Commands:
  node confconv.js comments FILE [--from FORMAT] [--json] [--sidecar]
  node confconv.js schema validate FILE --schema SCHEMA_FILE [--from FORMAT]
  node confconv.js schema generate FILE [--from FORMAT] [-o OUTPUT] [--no-examples]
  node confconv.js merge FILE1 FILE2 [FILE3 ...] [-o OUTPUT] [options]
  node confconv.js resolve FILE [-o OUTPUT] [options]
  node confconv.js get FILE PATH [--from FORMAT] [--json]
  node confconv.js set FILE PATH VALUE [--from FORMAT] [--type TYPE] [--in-place]
  node confconv.js delete FILE PATH [--from FORMAT] [--in-place] [-o OUTPUT]

Formats: json, yaml, toml, ini, xml, dotenv

Global Options:
  -o, --output      Output file path
  --from            Source format (auto-detected if omitted)
  --to              Target format (auto-detected from output extension if omitted)
  --validate        Validate syntax only, do not convert
  --diff            Show semantic differences after conversion
  --pretty          Pretty-print output (default)
  --compact         Compact output
  -h, --help        Show this help message

Merge Options:
  --shallow         Shallow merge (no recursive object merging)
  --array-mode M    Array handling: replace (default) | concat | merge

Resolve Options:
  --env-file FILE   Load environment variables from .env file
  --dry-run         List env var references without outputting result
  --strict          Exit with error if any env var is missing (no default)

Get/Set/Delete Options:
  --type TYPE       Explicit value type for set: string, integer, number, boolean, null, json
  --in-place        Modify the file in place (default for set/delete)
  --json            Output value as JSON (for get command)

Schema Options:
  --schema FILE     Path to JSON schema file (for validate)
  --no-examples     Don't include example values in generated schema

Comments Options:
  --json            Output comments as JSON
  --sidecar         Also write comments to .comments.json sidecar file

Examples:
  node confconv.js input.yaml -o output.toml
  node confconv.js comments config.toml
  node confconv.js schema validate config.yaml --schema rules.json
  node confconv.js schema generate config.toml -o schema.json
  node confconv.js merge base.yaml override.yaml -o merged.json
  node confconv.js resolve config.yaml --env-file .env --dry-run
  node confconv.js get config.toml database.host
  node confconv.js set config.yaml app.debug false --type boolean
  node confconv.js delete config.ini servers[0]
`.trim());
}

function parseArgs(argv) {
  const args = {
    mode: 'convert',
    subMode: null,
    positional: [],
    output: null,
    from: null,
    to: null,
    validate: false,
    diff: false,
    pretty: true,
    schema: null,
    shallow: false,
    arrayMode: 'replace',
    envFile: null,
    dryRun: false,
    strict: false,
    type: null,
    inPlace: false,
    jsonOutput: false,
    noExamples: false,
    sidecar: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      args.help = true;
    } else if (arg === '-o' || arg === '--output') {
      args.output = argv[++i];
    } else if (arg === '--from') {
      args.from = argv[++i];
    } else if (arg === '--to') {
      args.to = argv[++i];
    } else if (arg === '--validate') {
      args.validate = true;
    } else if (arg === '--diff') {
      args.diff = true;
    } else if (arg === '--pretty') {
      args.pretty = true;
    } else if (arg === '--compact') {
      args.pretty = false;
    } else if (arg === '--schema') {
      args.schema = argv[++i];
    } else if (arg === '--shallow') {
      args.shallow = true;
    } else if (arg === '--array-mode') {
      args.arrayMode = argv[++i];
    } else if (arg === '--env-file') {
      args.envFile = argv[++i];
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--strict') {
      args.strict = true;
    } else if (arg === '--type') {
      args.type = argv[++i];
    } else if (arg === '--in-place') {
      args.inPlace = true;
    } else if (arg === '--json') {
      args.jsonOutput = true;
    } else if (arg === '--no-examples') {
      args.noExamples = true;
    } else if (arg === '--sidecar') {
      args.sidecar = true;
    } else if (args.positional.length === 0) {
      if (arg === 'convert') {
        args.mode = 'batch';
      } else if (arg === 'validate') {
        args.mode = 'validate';
      } else if (arg === 'comments') {
        args.mode = 'comments';
      } else if (arg === 'schema') {
        args.mode = 'schema';
        args.subMode = argv[++i] || 'validate';
      } else if (arg === 'merge') {
        args.mode = 'merge';
      } else if (arg === 'resolve') {
        args.mode = 'resolve';
      } else if (arg === 'get') {
        args.mode = 'get';
      } else if (arg === 'set') {
        args.mode = 'set';
      } else if (arg === 'delete') {
        args.mode = 'delete';
      } else {
        args.positional.push(arg);
      }
    } else if (!arg.startsWith('-')) {
      args.positional.push(arg);
    }
  }

  return args;
}

function parseFile(filePath, format) {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!format) {
    format = formats.detectFormat(filePath, content);
    if (!format) {
      throw new Error(`Could not detect format for file: ${filePath}`);
    }
  }
  const parser = FORMAT_PARSERS[format];
  if (!parser) {
    throw new Error(`Unsupported format: ${format}`);
  }
  try {
    const data = parser(content);
    return { data, format, content };
  } catch (e) {
    throw new Error(`Failed to parse ${format} file ${filePath}: ${e.message}`);
  }
}

function serializeData(data, format, options) {
  const serializer = FORMAT_SERIALIZERS[format];
  if (!serializer) {
    throw new Error(`Unsupported output format: ${format}`);
  }
  const prepared = convert.prepareForFormat(data, format);
  return serializer(prepared, { pretty: options.pretty });
}

function handleConvert(args) {
  const input = args.positional[0];
  if (!input) {
    console.error('Error: Missing input file');
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(input)) {
    console.error(`Error: Input file not found: ${input}`);
    process.exit(1);
  }

  const { data, format: sourceFormat, content } = parseFile(input, args.from);

  if (args.validate) {
    console.log(`✓ Valid ${sourceFormat} file: ${input}`);
    return;
  }

  let targetFormat = args.to;
  let outputPath = args.output;

  if (!targetFormat && outputPath) {
    targetFormat = formats.detectFormatByExtension(outputPath);
  }

  if (!targetFormat) {
    console.error('Error: Could not determine target format. Use --to FORMAT or specify output file with known extension.');
    process.exit(1);
  }

  let sourceComments = null;
  if (comments.formatSupportsComments(sourceFormat)) {
    sourceComments = comments.extractComments(content, sourceFormat);
  }

  const serialized = serializeData(data, targetFormat, { pretty: args.pretty });

  if (outputPath) {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, serialized, 'utf-8');
    console.log(`✓ Converted ${path.basename(input)} (${sourceFormat}) → ${path.basename(outputPath)} (${targetFormat})`);

    if (!comments.formatSupportsComments(targetFormat) && sourceComments && sourceComments.length > 0) {
      const sidecarPath = comments.writeCommentsSidecar(outputPath, sourceComments);
      console.log(`  ℹ Comments saved to: ${path.basename(sidecarPath)}`);
    }
  } else {
    process.stdout.write(serialized);
  }

  if (args.diff) {
    let reParsed;
    try {
      const parser = FORMAT_PARSERS[targetFormat];
      if (parser) {
        reParsed = parser(serialized);
      }
    } catch (e) {
      console.log(`\n⚠ Could not re-parse output for diff: ${e.message}`);
    }
    if (reParsed !== undefined) {
      const diffs = convert.semanticDiff(data, reParsed);
      console.log('\n' + convert.formatDiff(diffs));
    }
  }
}

function handleBatch(args) {
  const dir = args.positional[0];
  if (!dir) {
    console.error('Error: Missing directory path');
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error(`Error: Directory not found: ${dir}`);
    process.exit(1);
  }

  const fromFormat = args.from;
  const toFormat = args.to;

  if (!fromFormat || !toFormat) {
    console.error('Error: --from and --to are required for batch conversion');
    process.exit(1);
  }

  const extMap = {
    json: ['.json'],
    yaml: ['.yaml', '.yml'],
    toml: ['.toml'],
    ini: ['.ini'],
    xml: ['.xml'],
    dotenv: ['.env', '.env.local', '.env.production', '.env.development']
  };

  const inputExts = extMap[fromFormat] || [];
  const outputExt = extMap[toFormat] ? extMap[toFormat][0] : `.${toFormat}`;

  const files = fs.readdirSync(dir).filter(f => {
    const fullPath = path.join(dir, f);
    if (!fs.statSync(fullPath).isFile()) return false;
    return inputExts.some(ext => f.endsWith(ext) || (fromFormat === 'dotenv' && (f === '.env' || f.startsWith('.env.'))));
  });

  if (files.length === 0) {
    console.log(`No ${fromFormat} files found in ${dir}`);
    return;
  }

  let success = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const inputPath = path.join(dir, file);
      const { data, content } = parseFile(inputPath, fromFormat);
      const serialized = serializeData(data, toFormat, { pretty: args.pretty });

      let outputFile;
      if (fromFormat === 'dotenv') {
        outputFile = file + outputExt;
      } else {
        outputFile = file.replace(new RegExp(inputExts.map(e => e.replace('.', '\\.')).join('|') + '$'), outputExt);
      }
      const outputPath = path.join(dir, outputFile);
      fs.writeFileSync(outputPath, serialized, 'utf-8');
      console.log(`✓ ${file} → ${outputFile}`);
      success++;
    } catch (e) {
      console.error(`✗ ${file}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${success} converted, ${failed} failed`);
}

function handleValidate(args) {
  const file = args.positional[0];
  if (!file) {
    console.error('Error: Missing file path');
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }

  try {
    const { format } = parseFile(file, args.from);
    console.log(`✓ Valid ${format} file: ${file}`);
  } catch (e) {
    console.error(`✗ Invalid file: ${e.message}`);
    process.exit(1);
  }
}

function handleComments(args) {
  const file = args.positional[0];
  if (!file) {
    console.error('Error: Missing file path');
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }

  const extracted = comments.extractCommentsFromFile(file, args.from, formats);

  if (args.jsonOutput) {
    console.log(JSON.stringify(extracted, null, 2));
  } else {
    console.log(comments.formatCommentsDisplay(extracted));
  }

  if (args.sidecar) {
    const sidecarPath = comments.writeCommentsSidecar(file, extracted);
    console.log(`✓ Comments sidecar written to: ${sidecarPath}`);
  }
}

function handleSchema(args) {
  if (args.subMode === 'validate') {
    handleSchemaValidate(args);
  } else if (args.subMode === 'generate') {
    handleSchemaGenerate(args);
  } else {
    console.error(`Error: Unknown schema subcommand: ${args.subMode}. Use 'validate' or 'generate'.`);
    process.exit(1);
  }
}

function handleSchemaValidate(args) {
  const file = args.positional[0];
  if (!file) {
    console.error('Error: Missing config file path');
    printUsage();
    process.exit(1);
  }
  if (!args.schema) {
    console.error('Error: --schema FILE is required for schema validation');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`Error: Config file not found: ${file}`);
    process.exit(1);
  }
  if (!fs.existsSync(args.schema)) {
    console.error(`Error: Schema file not found: ${args.schema}`);
    process.exit(1);
  }

  const { data, format } = parseFile(file, args.from);
  const schemaContent = fs.readFileSync(args.schema, 'utf-8');
  let schemaObj;
  try {
    schemaObj = JSON.parse(schemaContent);
  } catch (e) {
    console.error(`Error: Invalid JSON in schema file: ${e.message}`);
    process.exit(1);
  }

  const errors = schema.validateConfig(data, schemaObj);
  console.log(schema.formatValidationErrors(errors));

  if (errors.length > 0) {
    process.exit(1);
  }
}

function handleSchemaGenerate(args) {
  const file = args.positional[0];
  if (!file) {
    console.error('Error: Missing config file path');
    printUsage();
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }

  const { data, format } = parseFile(file, args.from);
  const generated = schema.generateSchemaFromData(data, {
    includeExamples: !args.noExamples
  });

  const jsonOutput = JSON.stringify(generated, null, 2) + '\n';

  if (args.output) {
    const outputDir = path.dirname(args.output);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(args.output, jsonOutput, 'utf-8');
    console.log(`✓ Schema generated from ${path.basename(file)} (${format}) → ${path.basename(args.output)}`);
  } else {
    process.stdout.write(jsonOutput);
  }
}

function handleMerge(args) {
  const files = args.positional;
  if (files.length < 2) {
    console.error('Error: At least 2 files are required for merge');
    printUsage();
    process.exit(1);
  }

  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.error(`Error: File not found: ${f}`);
      process.exit(1);
    }
  }

  let targetFormat = args.to;
  let outputPath = args.output;

  if (!targetFormat && outputPath) {
    targetFormat = formats.detectFormatByExtension(outputPath);
  }

  if (!targetFormat) {
    targetFormat = formats.detectFormatByExtension(files[0]);
    if (!targetFormat) {
      targetFormat = 'json';
    }
  }

  const result = merge.mergeFiles(
    files,
    {
      deep: !args.shallow,
      arrayMode: args.arrayMode
    },
    FORMAT_PARSERS,
    formats.detectFormat,
    parseFile
  );

  const serialized = serializeData(result, targetFormat, { pretty: args.pretty });

  if (outputPath) {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, serialized, 'utf-8');
    console.log(`✓ Merged ${files.length} files → ${path.basename(outputPath)} (${targetFormat})`);
    console.log(`  Priority order: ${files.map(f => path.basename(f)).join(' < ')}`);
  } else {
    process.stdout.write(serialized);
  }
}

function handleResolve(args) {
  const file = args.positional[0];
  if (!file) {
    console.error('Error: Missing config file path');
    printUsage();
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }

  const result = resolve.resolveEnvFile(
    file,
    { envFile: args.envFile },
    FORMAT_PARSERS,
    formats.detectFormat,
    parseFile
  );

  if (args.dryRun) {
    console.log(resolve.formatDryRunOutput(result));
    if (result.hasMissing && args.strict) {
      process.exit(1);
    }
    return;
  }

  if (result.hasMissing) {
    console.error(`Error: ${resolve.formatMissingVarsError(result.missingVars)}`);
    process.exit(1);
  }

  let targetFormat = args.to || result.format;
  let outputPath = args.output;

  if (!targetFormat && outputPath) {
    targetFormat = formats.detectFormatByExtension(outputPath);
  }

  const serialized = serializeData(result.data, targetFormat, { pretty: args.pretty });

  if (outputPath) {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, serialized, 'utf-8');
    console.log(`✓ Resolved env vars in ${path.basename(file)} → ${path.basename(outputPath)} (${targetFormat})`);
    if (result.referencedVars.length > 0) {
      console.log(`  Substituted ${result.referencedVars.length} variable(s)`);
    }
  } else {
    process.stdout.write(serialized);
  }
}

function handleGet(args) {
  const file = args.positional[0];
  const keyPath = args.positional[1];

  if (!file || !keyPath) {
    console.error('Error: get command requires FILE and PATH arguments');
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }

  const { data, format } = parseFile(file, args.from);
  const result = pathquery.getValue(data, keyPath);

  if (!result.found) {
    console.error(`Error: Key '${keyPath}' not found in ${path.basename(file)}`);
    process.exit(1);
  }

  const valueType = pathquery.getValueType(result.value);

  if (args.jsonOutput || typeof result.value === 'object' || result.value === null) {
    console.log(JSON.stringify(result.value, null, 2));
  } else {
    console.log(result.value);
  }
}

function handleSet(args) {
  const file = args.positional[0];
  const keyPath = args.positional[1];
  const rawValue = args.positional[2];

  if (!file || !keyPath || rawValue === undefined) {
    console.error('Error: set command requires FILE, PATH, and VALUE arguments');
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }

  let parsedValue;
  try {
    if (args.type) {
      const explicit = pathquery.parseExplicitType(rawValue, args.type);
      parsedValue = explicit.value;
    } else {
      const inferred = pathquery.inferValueType(rawValue);
      parsedValue = inferred.value;
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }

  const { data, format } = parseFile(file, args.from);
  const original = JSON.parse(JSON.stringify(data));
  pathquery.setValue(data, keyPath, parsedValue);

  const serialized = serializeData(data, format, { pretty: args.pretty });

  const outputPath = args.output || file;
  fs.writeFileSync(outputPath, serialized, 'utf-8');

  const valueType = pathquery.getValueType(parsedValue);
  console.log(`✓ Set '${keyPath}' = ${JSON.stringify(parsedValue)} (${valueType}) in ${path.basename(outputPath)}`);
}

function handleDelete(args) {
  const file = args.positional[0];
  const keyPath = args.positional[1];

  if (!file || !keyPath) {
    console.error('Error: delete command requires FILE and PATH arguments');
    printUsage();
    process.exit(1);
  }

  if (!fs.existsSync(file)) {
    console.error(`Error: File not found: ${file}`);
    process.exit(1);
  }

  const { data, format } = parseFile(file, args.from);
  const result = pathquery.deleteValue(data, keyPath);

  if (!result.deleted) {
    console.error(`Error: Key '${keyPath}' not found in ${path.basename(file)}`);
    process.exit(1);
  }

  const serialized = serializeData(data, format, { pretty: args.pretty });
  const outputPath = args.output || file;
  fs.writeFileSync(outputPath, serialized, 'utf-8');

  const deletedType = pathquery.getValueType(result.value);
  console.log(`✓ Deleted '${keyPath}' (was ${deletedType}) from ${path.basename(outputPath)}`);
}

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help) {
    printUsage();
    return;
  }

  try {
    switch (args.mode) {
      case 'batch':
        handleBatch(args);
        break;
      case 'validate':
        handleValidate(args);
        break;
      case 'comments':
        handleComments(args);
        break;
      case 'schema':
        handleSchema(args);
        break;
      case 'merge':
        handleMerge(args);
        break;
      case 'resolve':
        handleResolve(args);
        break;
      case 'get':
        handleGet(args);
        break;
      case 'set':
        handleSet(args);
        break;
      case 'delete':
        handleDelete(args);
        break;
      default:
        handleConvert(args);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseFile,
  serializeData,
  FORMAT_PARSERS,
  FORMAT_SERIALIZERS,
  comments,
  schema,
  merge,
  resolve,
  pathquery
};
