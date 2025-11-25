#!/usr/bin/env node

/**
 * Extension Build Script
 *
 * Uses esbuild to bundle the Chrome extension.
 * Outputs to dist/ directory for loading as unpacked extension.
 */

import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isWatch = process.argv.includes('--watch');
const isProd = process.argv.includes('--prod');

// Ensure dist directory exists
const distDir = join(__dirname, 'dist');
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}
mkdirSync(distDir, { recursive: true });

// Common esbuild options
const commonOptions = {
  bundle: true,
  minify: isProd,
  sourcemap: !isProd,
  target: ['chrome100'],
  logLevel: 'info',
  outdir: distDir,
};

// Build configurations for each entry point
const builds = [
  {
    name: 'content',
    entryPoints: [join(__dirname, 'src/content.ts')],
    outfile: join(distDir, 'content.js'),
    format: 'iife',
  },
  {
    name: 'background',
    entryPoints: [join(__dirname, 'src/background.ts')],
    outfile: join(distDir, 'background.js'),
    format: 'esm',
  },
];

async function build() {
  console.log('🏎️  Building AssistMD Ghost Overlay Extension...\n');

  try {
    for (const config of builds) {
      console.log(`📦 Building ${config.name}...`);

      const buildConfig = {
        ...commonOptions,
        entryPoints: config.entryPoints,
        outfile: config.outfile,
        format: config.format,
      };

      // Remove outdir when using outfile
      delete buildConfig.outdir;

      if (isWatch) {
        const ctx = await esbuild.context(buildConfig);
        await ctx.watch();
        console.log(`👀 Watching ${config.name}...`);
      } else {
        await esbuild.build(buildConfig);
        console.log(`✅ ${config.name} built successfully`);
      }
    }

    // Copy static assets
    copyStaticAssets();

    console.log('\n🏁 Build complete!');
    console.log(`📁 Output: ${distDir}`);

    if (isWatch) {
      console.log('\n👀 Watching for changes...');
    }
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

function copyStaticAssets() {
  console.log('\n📋 Copying static assets...');

  // Create icons directory
  const iconsDir = join(__dirname, 'icons');
  const distIconsDir = join(distDir, '../icons');

  if (!existsSync(distIconsDir)) {
    mkdirSync(distIconsDir, { recursive: true });
  }

  // Note: Icons would need to be created separately
  // For now, we'll just ensure the directory exists

  console.log('✅ Static assets copied');
}

// Create placeholder icons
function createPlaceholderIcons() {
  const iconsDir = join(__dirname, 'icons');
  if (!existsSync(iconsDir)) {
    mkdirSync(iconsDir, { recursive: true });
  }

  // Simple SVG icon placeholder (would be replaced with actual icons)
  const sizes = [16, 32, 48, 128];
  console.log('📌 Note: Create icon files in extension/icons/ directory');
  console.log('   Required sizes:', sizes.map(s => `${s}x${s}`).join(', '));
}

// Run build
build().then(() => {
  createPlaceholderIcons();
});
