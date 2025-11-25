#!/usr/bin/env node
/**
 * Build script for GHOST-NEXT extension
 *
 * Currently the extension uses plain JavaScript files.
 * This script is a placeholder for future build steps like:
 * - TypeScript compilation
 * - Bundling with esbuild/rollup
 * - Minification
 * - Asset processing
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const extensionDir = join(projectRoot, 'extension');
const distDir = join(extensionDir, 'dist');

console.log('Building GHOST-NEXT extension...\n');

// Check if TypeScript source exists
const srcDir = join(extensionDir, 'src');
const hasTypeScript = existsSync(srcDir);

if (hasTypeScript) {
  console.log('TypeScript source found, compiling...');

  try {
    execSync('npm run build', {
      cwd: extensionDir,
      stdio: 'inherit'
    });
    console.log('TypeScript compilation complete\n');
  } catch (error) {
    console.error('TypeScript compilation failed');
    process.exit(1);
  }
} else {
  console.log('No TypeScript source, using JavaScript files directly');
}

// Verify required files exist
const requiredFiles = [
  'manifest.json',
  'content.js',
  'background.js',
  'overlay.js'
];

console.log('\nVerifying extension files:');
let allFilesExist = true;

for (const file of requiredFiles) {
  const filePath = join(extensionDir, file);
  const exists = existsSync(filePath);
  console.log(`  ${exists ? '✓' : '✗'} ${file}`);
  if (!exists) allFilesExist = false;
}

if (!allFilesExist) {
  console.error('\nError: Some required files are missing');
  process.exit(1);
}

// Verify manifest.json
console.log('\nValidating manifest.json...');
try {
  const manifestPath = join(extensionDir, 'manifest.json');
  const manifest = JSON.parse(require('fs').readFileSync(manifestPath, 'utf8'));

  if (manifest.manifest_version !== 3) {
    console.warn('Warning: Not using Manifest V3');
  }

  if (!manifest.content_scripts?.[0]?.js?.includes('content.js')) {
    console.warn('Warning: content.js not in content_scripts');
  }

  console.log('  Manifest version:', manifest.manifest_version);
  console.log('  Extension name:', manifest.name);
  console.log('  Version:', manifest.version);
} catch (error) {
  console.error('Error validating manifest.json:', error.message);
  process.exit(1);
}

console.log('\n✓ Extension build complete');
console.log('\nTo load the extension:');
console.log('  1. Open chrome://extensions');
console.log('  2. Enable "Developer mode"');
console.log('  3. Click "Load unpacked"');
console.log(`  4. Select: ${extensionDir}`);
console.log('\nOr run: ./scripts/start-mcp.sh');
