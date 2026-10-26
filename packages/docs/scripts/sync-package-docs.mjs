import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const packagesRoot = path.resolve(docsRoot, '..');
const outDir = path.join(docsRoot, 'src/content/docs/packages');
const check = process.argv.includes('--check');

const packages = await loadPackages();
const expected = new Map([
  ['index.md', indexPage(packages)],
  ...packages.map((pkg) => [`${pkg.dirName}.md`, packagePage(pkg)]),
]);

if (check) {
  const mismatches = await diff(expected);
  if (mismatches.length > 0) {
    console.error(
      'Package docs are out of date. Run `node packages/docs/scripts/sync-package-docs.mjs`.',
    );
    for (const file of mismatches) console.error(`  ${file}`);
    process.exit(1);
  }
} else {
  await writePages(expected);
}

async function loadPackages() {
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const loaded = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(packagesRoot, entry.name);
    const manifestPath = path.join(dir, 'package.json');
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (manifest.private === true || manifest.name === 'hexok') continue;
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      throw new Error(`${manifestPath} is missing a name`);
    }
    const readmePath = path.join(dir, 'README.md');
    let readme;
    try {
      readme = await readFile(readmePath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        throw new Error(
          `Published package ${manifest.name} is missing ${readmePath}`,
        );
      }
      throw error;
    }
    loaded.push({
      dirName: entry.name,
      name: manifest.name,
      description:
        typeof manifest.description === 'string' ? manifest.description : '',
      readme,
    });
  }
  loaded.sort((a, b) => a.name.localeCompare(b.name));
  return loaded;
}

function packagePage(pkg) {
  const order = packages.findIndex((item) => item.name === pkg.name) + 1;
  return `${frontmatter({
    title: pkg.name,
    description: pkg.description,
    order,
  })}<!-- Generated from packages/${pkg.dirName}/README.md. Do not edit. -->

${pageBody(pkg.readme)}`;
}

function indexPage(listed) {
  const items = listed
    .map((pkg) => `- [${pkg.name}](/hexok/packages/${pkg.dirName}/)`)
    .join('\n');
  return `${frontmatter({
    title: 'Packages',
    description: 'Ports, adapters, and schema helpers published beside hexok.',
    label: 'Overview',
    order: 0,
  })}<!-- Generated from published package READMEs. Do not edit. -->

These pages are copied from each package README. \`hexok\` primitives stay in [Concepts](/hexok/concepts/).

${items}
`;
}

function frontmatter({ title, description, label, order }) {
  const sidebar =
    label === undefined
      ? `  order: ${order}\n`
      : `  label: ${JSON.stringify(label)}\n  order: ${order}\n`;
  return `---
title: ${JSON.stringify(title)}
description: ${JSON.stringify(description)}
sidebar:
${sidebar}---

`;
}

function pageBody(readme) {
  const lines = readme
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  if (lines[0]?.startsWith('# ')) {
    lines.shift();
    if (lines[0] === '') lines.shift();
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

async function diff(pages) {
  const mismatches = [];
  for (const [name, content] of pages) {
    const file = path.join(outDir, name);
    let current;
    try {
      current = await readFile(file, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        mismatches.push(path.relative(packagesRoot, file));
        continue;
      }
      throw error;
    }
    if (current !== content) mismatches.push(path.relative(packagesRoot, file));
  }
  let existing = [];
  try {
    existing = await readdir(outDir);
  } catch (error) {
    if (!(error && error.code === 'ENOENT')) throw error;
  }
  for (const name of existing) {
    if (!name.endsWith('.md')) continue;
    if (!pages.has(name))
      mismatches.push(path.relative(packagesRoot, path.join(outDir, name)));
  }
  return mismatches;
}

async function writePages(pages) {
  await mkdir(outDir, { recursive: true });
  let existing = [];
  try {
    existing = await readdir(outDir);
  } catch (error) {
    if (!(error && error.code === 'ENOENT')) throw error;
  }
  for (const name of existing) {
    if (name.endsWith('.md') && !pages.has(name)) {
      await rm(path.join(outDir, name));
    }
  }
  for (const [name, content] of pages) {
    await writeFile(path.join(outDir, name), content);
  }
}
