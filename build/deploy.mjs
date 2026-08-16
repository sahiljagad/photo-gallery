#!/usr/bin/env node
/**
 * deploy.mjs — Build and force-push dist/ to gh-pages as a single orphan commit.
 */

import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from './build.mjs';

const ROOT = join(import.meta.dirname, '..');

function getBasePath() {
  try {
    const remote = execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim();
    // Extract repo name from URL
    // Handles: https://github.com/user/repo.git, git@github.com:user/repo.git
    const match = remote.match(/[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    if (!match) return '/';
    const [, owner, repo] = match;
    // If the repo is <owner>.github.io, it serves from /
    if (repo === `${owner}.github.io`) return '/';
    return `/${repo}/`;
  } catch {
    return '/';
  }
}

async function run() {
  const base = getBasePath();
  console.log(`Base path: ${base}`);

  // Rebuild without drafts. This is the only guarantee that a draft album's
  // derivatives are absent from dist/ — pruneOrphans deletes anything not in
  // the published set, so a previously previewed draft cannot ride along.
  console.log('\nRebuilding published albums only...');
  const archive = await build({ includeDrafts: false });
  const total = archive.reduce((n, a) => n + a.photos.length, 0);
  console.log(`Publishing ${archive.length} album(s), ${total} photograph(s).`);

  // Build with the correct base
  console.log('\nBuilding...');
  execSync(`npx vite build --base ${base}`, { cwd: ROOT, stdio: 'inherit' });

  // Add .nojekyll to dist
  const distDir = join(ROOT, 'dist');
  writeFileSync(join(distDir, '.nojekyll'), '');
  console.log('Added .nojekyll');

  // Deploy to gh-pages as a single orphan commit
  console.log('\nDeploying to gh-pages...');
  const cmds = [
    'git init',
    'git checkout -b gh-pages',
    'git add -A',
    'git commit -m "deploy"',
  ];

  for (const cmd of cmds) {
    execSync(cmd, { cwd: distDir, stdio: 'inherit' });
  }

  // Get the remote URL and force-push
  const remote = execSync('git remote get-url origin', { cwd: ROOT, encoding: 'utf8' }).trim();
  execSync(`git push --force ${remote} gh-pages`, { cwd: distDir, stdio: 'inherit' });

  console.log('\nDeployed to gh-pages.');
}

run().catch((e) => { console.error(e.message); process.exit(1); });
