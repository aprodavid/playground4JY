#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const packageJsonPath = path.join(repoRoot, 'package.json');
const lockPath = path.join(repoRoot, 'package-lock.json');

const semverStrict = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const semverRange = /^(\^|~|>=|<=|>|<)?\s*(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const errors = [];

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${label} is empty or not a string`);
  }
}

function assertVersionString(value, label, { allowRange = false } = {}) {
  assertNonEmptyString(value, label);
  if (typeof value !== 'string' || value.trim() === '') return;

  const isValid = allowRange ? semverRange.test(value.trim()) : semverStrict.test(value.trim());
  if (!isValid) {
    errors.push(`${label} has invalid version format: "${value}"`);
  }
}

function validateDependencyMap(obj, label) {
  if (!obj) return;
  for (const [name, spec] of Object.entries(obj)) {
    assertNonEmptyString(spec, `${label}.${name}`);
    if (typeof spec === 'string' && !(/^[~^><=]/.test(spec) || semverStrict.test(spec))) {
      errors.push(`${label}.${name} is not semver/range: "${spec}"`);
    }
  }
}

const pkg = readJson(packageJsonPath);
const lock = readJson(lockPath);

assertNonEmptyString(pkg.name, 'package.json name');
assertVersionString(pkg.version, 'package.json version');
validateDependencyMap(pkg.dependencies, 'package.json dependencies');
validateDependencyMap(pkg.devDependencies, 'package.json devDependencies');
validateDependencyMap(pkg.peerDependencies, 'package.json peerDependencies');
validateDependencyMap(pkg.overrides, 'package.json overrides');
validateDependencyMap(pkg.resolutions, 'package.json resolutions');

const pinnedExpectations = {
  next: '15.3.8',
  'eslint-config-next': '15.3.8',
  react: '19.0.0',
  'react-dom': '19.0.0',
};

for (const [name, expected] of Object.entries(pinnedExpectations)) {
  const rootSpec = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  if (rootSpec !== expected) {
    errors.push(`package.json ${name} must be ${expected}, found ${String(rootSpec)}`);
  }
}

assertVersionString(lock.version, 'package-lock.json root version');

const rootPackage = lock.packages?.[''];
if (!rootPackage) {
  errors.push('package-lock.json packages[""] entry is missing');
} else {
  assertVersionString(rootPackage.version, 'package-lock.json packages[""] version');
}

for (const [pkgPath, entry] of Object.entries(lock.packages ?? {})) {
  if (!entry || typeof entry !== 'object') continue;

  if ('name' in entry && (typeof entry.name !== 'string' || entry.name.trim() === '')) {
    errors.push(`package-lock.json ${pkgPath || '(root)'} has empty name`);
  }

  if ('version' in entry) {
    assertVersionString(entry.version, `package-lock.json ${pkgPath || '(root)'}.version`);
  }

  for (const depField of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    const map = entry[depField];
    if (!map) continue;
    for (const [depName, depSpec] of Object.entries(map)) {
      if (typeof depSpec !== 'string' || depSpec.trim() === '') {
        errors.push(`package-lock.json ${pkgPath || '(root)'}.${depField}.${depName} is empty`);
      }
    }
  }
}

const lockTargets = ['next', 'eslint-config-next', 'react', 'react-dom', '@types/react', '@types/react-dom'];
for (const depName of lockTargets) {
  const lockEntry = lock.packages?.[`node_modules/${depName}`];
  if (!lockEntry) {
    errors.push(`package-lock.json missing node_modules/${depName} entry`);
    continue;
  }
  assertVersionString(lockEntry.version, `package-lock.json node_modules/${depName}.version`);
}

if (errors.length) {
  console.error('❌ Package metadata validation failed:');
  for (const err of errors) {
    console.error(`- ${err}`);
  }
  process.exit(1);
}

console.log('✅ Package metadata validation passed');
console.log(`- package.json: ${pkg.name}@${pkg.version}`);
console.log(`- lockfileVersion: ${lock.lockfileVersion}`);
console.log(`- next/eslint-config-next/react/react-dom: ${pkg.dependencies.next} / ${pkg.devDependencies['eslint-config-next']} / ${pkg.dependencies.react} / ${pkg.dependencies['react-dom']}`);
