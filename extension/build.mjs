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
  console.log('🏎️  Building GHOST-NEXT Extension...\n');

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

  // Copy manifest.json to dist
  const manifestSrc = join(__dirname, 'manifest.json');
  const manifestDest = join(distDir, 'manifest.json');
  if (existsSync(manifestSrc)) {
    copyFileSync(manifestSrc, manifestDest);
    console.log('✅ manifest.json copied');
  }

  // Create assets directory in dist
  const distAssetsDir = join(distDir, 'assets');
  if (!existsSync(distAssetsDir)) {
    mkdirSync(distAssetsDir, { recursive: true });
  }

  // Copy icons from extension/assets/ if they exist
  const assetsSrc = join(__dirname, 'assets');
  if (existsSync(assetsSrc)) {
    const icons = ['icon16.png', 'icon32.png', 'icon48.png', 'icon128.png'];
    for (const icon of icons) {
      const src = join(assetsSrc, icon);
      const dest = join(distAssetsDir, icon);
      if (existsSync(src)) {
        copyFileSync(src, dest);
      }
    }
    console.log('✅ Icons copied to dist/assets/');
  } else {
    console.log('⚠️  No assets/ folder found - icons need to be added');
  }

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
