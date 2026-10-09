#!/usr/bin/env node
// Simple build script to prepare the extension for Chrome
// Reads .env file and injects values into config.js

const fs = require('fs');
const path = require('path');

// Read .env file
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    console.error('Error: .env file not found.');
    console.error('Please copy .env.example to .env and fill in your Supabase credentials.');
    console.error('  cp .env.example .env');
    process.exit(1);
  }

  const envContent = fs.readFileSync(envPath, 'utf-8');
  const env = {};

  envContent.split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const [key, ...valueParts] = line.split('=');
      if (key) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });

  // Validate required variables
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) {
    console.error('Error: SUPABASE_URL and SUPABASE_KEY must be set in .env file');
    console.error('Please edit .env and add your Supabase credentials');
    process.exit(1);
  }

  if (env.SUPABASE_URL.includes('your-project') || env.SUPABASE_KEY.includes('your_publishable_key')) {
    console.error('Error: Please replace the placeholder values in .env with your actual Supabase credentials');
    process.exit(1);
  }

  return env;
}

// Copy directory recursively
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Build the extension
function build() {
  console.log('Building Page Blocker extension...\n');

  const env = loadEnv();
  const distDir = path.join(__dirname, 'dist');

  // Clean dist directory
  if (fs.existsSync(distDir)) {
    console.log('Cleaning dist directory...');
    fs.rmSync(distDir, { recursive: true });
  }

  console.log('Copying files...');

  // Copy manifest.json
  fs.mkdirSync(distDir);
  fs.copyFileSync(
    path.join(__dirname, 'manifest.json'),
    path.join(distDir, 'manifest.json')
  );

  // Copy src directory
  copyDir(path.join(__dirname, 'src'), path.join(distDir, 'src'));

  // Generate config.js from template
  console.log('Generating config.js with your Supabase credentials...');
  const configTemplate = fs.readFileSync(
    path.join(__dirname, 'src', 'utils', 'config.template.js'),
    'utf-8'
  );

  const config = configTemplate
    .replace('__SUPABASE_URL__', env.SUPABASE_URL)
    .replace('__SUPABASE_KEY__', env.SUPABASE_KEY);

  fs.writeFileSync(
    path.join(distDir, 'src', 'utils', 'config.js'),
    config
  );

  console.log('\n✓ Build complete!\n');
  console.log('Next steps:');
  console.log('  1. Open Chrome and go to chrome://extensions/');
  console.log('  2. Enable "Developer mode" (toggle in top right)');
  console.log('  3. Click "Load unpacked"');
  console.log('  4. Select the /dist folder from this project\n');
  console.log('Your extension is ready to use!');
}

// Run build
try {
  build();
} catch (error) {
  console.error('\nBuild failed:', error.message);
  process.exit(1);
}
