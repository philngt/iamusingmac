import { readFile, readdir, lstat } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(project, 'dist');
const failures = [];
let checkedReferences = 0;

function report(file, message) {
  failures.push(`${relative(project, file)}: ${message}`);
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      report(path, 'Symbolic links are not supported in the Pages artifact.');
    } else if (entry.isDirectory()) {
      files.push(...await walk(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function checkReference(owner, raw, kind) {
  const value = raw.trim().replace(/&amp;/g, '&');
  if (!value || value.startsWith('#')) return;
  if (value.startsWith('/')) {
    report(owner, `${kind} must use a relative path for project Pages: ${value}`);
    return;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return;
  if (kind === 'module import' && !value.startsWith('.')) {
    report(owner, `Bare module import requires a bundler or import map: ${value}`);
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(value.split(/[?#]/, 1)[0]);
  } catch {
    report(owner, `Invalid URL encoding in ${kind}: ${value}`);
    return;
  }
  const target = resolve(dirname(owner), pathname);
  if (target !== root && !target.startsWith(root + sep)) {
    report(owner, `${kind} resolves outside the published dist directory: ${value}`);
    return;
  }
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) throw new Error('symlink');
    if (stat.isDirectory()) await lstat(resolve(target, 'index.html'));
    checkedReferences += 1;
  } catch {
    report(owner, `Missing or unsupported ${kind}: ${value}`);
  }
}

async function checkFile(file) {
  const extension = extname(file);
  if (!['.html', '.css', '.js', '.mjs'].includes(extension)) return;
  const source = await readFile(file, 'utf8');
  if (extension === '.html') {
    for (const tag of source.matchAll(/<(?:script|link|img|source|video|audio|use|a)\b[^>]*>/gi)) {
      for (const attr of tag[0].matchAll(/\b(?:src|href|poster)\s*=\s*(["'])(.*?)\1/gi)) {
        await checkReference(file, attr[2], 'HTML reference');
      }
    }
  }
  if (extension === '.css' || extension === '.html') {
    for (const match of source.matchAll(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi)) {
      await checkReference(file, match[2], 'CSS URL');
    }
  }
  if (extension === '.js' || extension === '.mjs') {
    const syntax = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (syntax.status !== 0) report(file, syntax.stderr.trim() || 'JavaScript syntax check failed.');
    const imports = /(?:\b(?:import|export)\s+(?:[^;'"\n]*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\))/g;
    for (const match of source.matchAll(imports)) {
      await checkReference(file, match[1] ?? match[2], 'module import');
    }
  }
}

try {
  const entry = await lstat(resolve(root, 'index.html'));
  if (!entry.isFile()) throw new Error('dist/index.html must be a regular file.');
  const files = await walk(root);
  for (const file of files) await checkFile(file);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(`Static checks passed: ${files.length} files, ${checkedReferences} local references, valid JavaScript syntax.`);
    console.log('All checked local paths work beneath a GitHub Pages repository subpath.');
  }
} catch (error) {
  console.error(`Static check failed: ${error.message}`);
  process.exitCode = 1;
}
