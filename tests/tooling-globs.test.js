import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { ESLint } from 'eslint';

const require = createRequire(import.meta.url);
const nodemonMatch = require('nodemon/lib/monitor/match');
const parser = require('@typescript-eslint/parser');

test('ESLint discovers nested brace-glob files and honours ignored directories', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'esphome-eslint-'));
  try {
    mkdirSync(path.join(root, 'src', 'nested'), { recursive: true });
    mkdirSync(path.join(root, 'generated'), { recursive: true });
    writeFileSync(path.join(root, 'src', 'nested', 'device.js'), 'const unused = 1;\n');
    writeFileSync(path.join(root, 'generated', 'skip.js'), 'invalid syntax here');
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: [{ ignores: ['generated/**'] }, {
        files: ['**/*.{js,mjs}'],
        rules: { 'no-unused-vars': 'error' },
      }],
    });
    const results = await eslint.lintFiles(['**/*.{js,mjs}']);
    assert.equal(results.length, 1);
    assert.equal(results[0].messages[0].ruleId, 'no-unused-vars');
    assert.equal(results[0].filePath, path.join(root, 'src', 'nested', 'device.js'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TypeScript project service matches allowDefaultProject and rejects other files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'esphome-parser-'));
  const options = {
    filePath: path.join(root, 'tool.js'),
    tsconfigRootDir: root,
    projectService: { allowDefaultProject: ['*.js'], defaultProject: 'tsconfig.json' },
  };
  try {
    mkdirSync(path.join(root, 'src'));
    writeFileSync(path.join(root, 'src', 'included.ts'), 'export const value = 1;');
    writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"allowJs":true},"include":["src/**/*"]}');
    writeFileSync(options.filePath, 'const value = 1;');
    const result = parser.parseForESLint('const value = 1;', options);
    assert.ok(result.services.program);
    assert.throws(() => parser.parseForESLint('const value = 1;', {
      ...options, filePath: path.join(root, 'other.ts'),
    }), /not found by the project service/);
  } finally {
    parser.clearCaches();
    rmSync(root, { recursive: true, force: true });
  }
});

test('nodemon restart matching includes watched extensions and excludes ignored paths', () => {
  const root = process.cwd();
  const files = ['src/device.ts', 'src/nested/state.js', 'src/device.json', 'src/generated/skip.ts']
    .map(file => path.join(root, file));
  const result = nodemonMatch(files, ['src/**/*', '!src/generated/**'], 'ts,js');
  assert.deepEqual([...result.result].sort(), files.slice(0, 2).sort());
});
