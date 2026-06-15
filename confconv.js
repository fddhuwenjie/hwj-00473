#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const toml = require('./lib/toml');
const ini = require('./lib/ini');
const xml = require('./lib/xml');
const dotenv = require('./lib/dotenv');
const formats = require('./lib/formats');
const convert = require('./lib/convert');

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

Usage:
  node confconv.js INPUT [-o OUTPUT] [--from FORMAT] [--to FORMAT] [options]
  node confconv.js convert DIR --from FORMAT --to FORMAT [options]
  node confconv.js validate FILE [--from FORMAT]

Formats: json, yaml, toml, ini, xml, dotenv

Options:
  -o, --output      Output file path
  --from            Source format (auto-detected if omitted)
  --to              Target format (auto-detected from output extension if omitted)
  --validate        Validate syntax only, do not convert
  --diff            Show semantic differences after conversion
  --pretty          Pretty-print output (default)
  --compact         Compact output
  -h, --help        Show this help message

Examples:
  node confconv.js input.yaml -o output.toml
  node confconv.js convert ./configs --from yaml --to json
  node confconv.js validate config.toml
  node confconv.js input.json -o output.toml --diff
  `.trim());
}

function parseArgs(argv) {
  const args = {
    mode: 'convert',
    positional: [],
    output: null,
    from: null,
    to: null,
    validate: false,
    diff: false,
    pretty: true
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
    } else if (arg === 'convert' && args.positional.length === 0) {
      args.mode = 'batch';
    } else if (arg === 'validate' && args.positional.length === 0) {
      args.mode = 'validate';
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

  const serialized = serializeData(data, targetFormat, { pretty: args.pretty });

  if (outputPath) {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, serialized, 'utf-8');
    console.log(`✓ Converted ${path.basename(input)} (${sourceFormat}) → ${path.basename(outputPath)} (${targetFormat})`);
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
      const { data } = parseFile(inputPath, fromFormat);
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

function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help) {
    printUsage();
    return;
  }

  try {
    if (args.mode === 'batch') {
      handleBatch(args);
    } else if (args.mode === 'validate') {
      handleValidate(args);
    } else {
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
  FORMAT_SERIALIZERS
};
