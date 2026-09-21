#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 */

// Publish every lib to npm (AGL-3201).
//
//   npm run publish:packages                 # DRY RUN: says what would go out
//   npm run publish:packages -- --publish    # publishes
//   npm run publish:packages -- --only @aglyn/cli,@aglyn/aglyn
//
// Every `libs/**` project is a package, and they go out together: each one
// names its siblings at the exact repo version (`release:prepare` moves them
// as one), so a release where half were published is a set of packages that
// cannot install. `@aglyn/cli` keeps a version of its own and rides the same
// run — it publishes whenever its version is one the registry has not seen.
//
// ## What makes a second run safe
//
// A version already on the registry is SKIPPED, never an error: npm refuses to
// overwrite one, a promotion that changed no lib still runs this, and a run
// that died half way has to be re-runnable to finish the set. So the run is
// "publish what is missing", and running it twice publishes nothing twice.
//
// ## What it refuses
//
// It builds everything FIRST and publishes nothing until every package has
// built and carries its license — a failure at package 30 would otherwise
// leave 29 live and unrepairable, since a published version cannot be
// replaced. The dist-tag is `latest` for a release version and the
// prerelease's own label (`beta`) otherwise, so a beta never becomes what
// `npm install` hands somebody who asked for nothing in particular.
//
// Exit codes: 0 done (or dry run) · 1 a build, a check or a publish failed.

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPackageMap } from './lib/lib-boundaries.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

/** `latest` for a release, the prerelease label otherwise (`1.0.0-beta.3` → `beta`). */
export function distTagFor(version) {
  const prerelease = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(version)
  return prerelease ? prerelease[1] : 'latest'
}

/** Which of `packages` the registry does not have at that version. */
export function missingFrom(packages, isPublished) {
  return packages.filter((entry) => !isPublished(entry.name, entry.version))
}

function isPublished(name, version) {
  try {
    const out = execFileSync('npm', ['view', `${name}@${version}`, 'version', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return out.trim().length > 0
  } catch (error) {
    // A 404 is the answer "no". Anything else is the registry not answering,
    // and guessing "not published" there would attempt to overwrite a version.
    // Both streams are read: under \`npm run -s\` the child inherits a silent
    // log level, and the refusal is then only in the JSON on stdout.
    if (/E404|404 Not Found/.test(`${error.stdout ?? ''}${error.stderr ?? ''}`)) return false
    throw new Error(`could not ask the registry about ${name}@${version}: ${`${error.stderr ?? ''}${error.stdout ?? ''}`.trim() || error.message}`, { cause: error })
  }
}

function main(argv) {
  const publish = argv.includes('--publish')
  const onlyFlag = argv.indexOf('--only')
  const only = onlyFlag >= 0 ? new Set(String(argv[onlyFlag + 1] ?? '').split(',').filter(Boolean)) : null

  const projects = readPackageMap(ROOT)
    .filter((project) => project.projectType === 'library' && project.alias)
    .filter((project) => existsSync(join(ROOT, project.root, 'package.json')))
  const packages = projects
    .map((project) => {
      const pkg = JSON.parse(readFileSync(join(ROOT, project.root, 'package.json'), 'utf8'))
      return { project: project.name, root: project.root, name: pkg.name, version: pkg.version, private: pkg.private === true }
    })
    .filter((entry) => !entry.private && (!only || only.has(entry.name)))

  const missing = missingFrom(packages, isPublished)
  console.log(`publish:packages: ${packages.length} package(s), ${packages.length - missing.length} already on the registry, ${missing.length} to publish${publish ? '' : ' (DRY RUN)'}`)
  for (const entry of missing) console.log(`  ${entry.name}@${entry.version} → ${distTagFor(entry.version)}`)
  if (!missing.length) return 0

  console.log('  · build')
  execFileSync('npx', ['nx', 'run-many', '-t', 'build', '-p', missing.map((entry) => entry.project).join(',')], { cwd: ROOT, stdio: 'inherit' })

  // Everything is checked before anything is published: a version that went
  // out cannot be taken back, so a failure has to happen before the first one.
  for (const entry of missing) {
    const dist = join(ROOT, 'dist', entry.root)
    if (!existsSync(join(dist, 'package.json'))) throw new Error(`${entry.name} built no package at dist/${entry.root}`)
    const built = JSON.parse(readFileSync(join(dist, 'package.json'), 'utf8'))
    if (built.name !== entry.name || built.version !== entry.version) {
      throw new Error(`dist/${entry.root} is ${built.name}@${built.version}, not ${entry.name}@${entry.version}`)
    }
    // npm packs a LICENSE only from the package's own directory.
    copyFileSync(join(ROOT, 'LICENSE'), join(dist, 'LICENSE'))
  }

  console.log(publish ? '  · publish' : '  · pack (dry run)')
  for (const entry of missing) {
    const args = ['publish', '--access', 'public', '--tag', distTagFor(entry.version)]
    if (!publish) args.push('--dry-run')
    // Provenance is signed by the CI run's identity; outside one there is none.
    // Said either way, because every package.json asks for it in
    // \`publishConfig\` and npm refuses to publish rather than go without.
    else args.push(process.env.GITHUB_ACTIONS ? '--provenance' : '--provenance=false')
    // A real publish keeps the terminal: an account with two-factor auth is
    // asked to approve in the browser, and npm with no stdin cannot wait for
    // that — it fails with EOTP instead of asking.
    execFileSync('npm', args, { cwd: join(ROOT, 'dist', entry.root), stdio: publish ? 'inherit' : ['ignore', 'ignore', 'inherit'] })
    console.log(`    ${publish ? 'published' : 'would publish'} ${entry.name}@${entry.version}`)
  }
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    console.error(`publish:packages: FAILED — ${error.message}`)
    process.exit(1)
  }
}
