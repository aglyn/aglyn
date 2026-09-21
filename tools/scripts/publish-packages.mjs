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

/** The prerelease label in a version, or `null` for a release. */
export function prereleaseLabelOf(version) {
  const prerelease = /^\d+\.\d+\.\d+-([0-9A-Za-z-]+)/.exec(String(version ?? ''))
  return prerelease ? prerelease[1] : null
}

/** Has this package ever published a version that is not a prerelease? */
export function hasStableRelease(versions) {
  return (versions ?? []).some((version) => prereleaseLabelOf(version) === null)
}

/**
 * Which dist-tag a version goes out under.
 *
 * A release is `latest`. A prerelease is normally its own label (`beta`), so
 * that it is not what `npm install` hands somebody who asked for nothing in
 * particular — a rule that assumes `latest` already points at a release worth
 * having.
 *
 * ⚑ UNTIL ONE EXISTS, IT DOES NOT, and the prerelease takes `latest` instead
 * (AGL-3201). npm sets `latest` on a package's FIRST publish whatever `--tag`
 * says, so every one of these libs pinned it to the earliest beta — which for
 * `1.0.0-beta.143` was the single build whose folder-subpath imports a
 * consumer could not resolve at all. Every later beta went to `beta` and
 * `latest` never moved again, so a plain `npm i @aglyn/aglyn` kept handing out
 * the one build known to be broken. Between "the default is a prerelease" and
 * "the default does not work", the first is the lesser harm, and it is only
 * ever the newest prerelease.
 *
 * It CORRECTS ITSELF. The condition is the registry's own answer, per package,
 * so the day a non-prerelease ships that package's betas go back to `beta`
 * with nothing to remember and nothing to undo. `@aglyn/cli` is already there
 * — it carries its own stable number — and is unaffected.
 *
 * ⛔ It cannot be done by moving the tag after the fact. An OIDC token
 * authorizes `npm publish` and `npm stage publish` and nothing else, so a
 * `npm dist-tag add` in this workflow would need the long-lived token that
 * trusted publishing exists to retire. The tag is chosen at publish time
 * because that is the only moment CI is allowed to choose it.
 */
export function distTagFor(version, published) {
  const label = prereleaseLabelOf(version)
  if (!label) return 'latest'
  return hasStableRelease(published) ? label : 'latest'
}

/**
 * Which of `packages` the registry does not have at that version, each
 * carrying the versions it DOES have — so the dist-tag can be chosen from the
 * same answer rather than from a second round trip.
 */
export function missingFrom(packages, versionsOf) {
  return packages
    .map((entry) => ({ ...entry, published: versionsOf(entry.name) }))
    .filter((entry) => !entry.published.includes(entry.version))
}

/**
 * Every version the registry holds for `name`, `[]` for a package it has
 * never seen.
 *
 * ONE call per package, answering both questions this script asks: whether
 * the version being released is already out, and whether any non-prerelease
 * has ever shipped — which is what {@link distTagFor} needs. Asking twice
 * would double the registry round trips for an answer already in hand.
 */
export function publishedVersions(name, view = npmViewVersions) {
  const raw = view(name)
  if (raw === null) return []
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`could not read the registry's answer about ${name}: ${raw.slice(0, 200)}`)
  }
  // `npm view <pkg> versions --json` answers a bare string for a package with
  // exactly one version, and an array otherwise.
  if (typeof parsed === 'string') return [parsed]
  if (!Array.isArray(parsed)) {
    throw new Error(`the registry answered about ${name} in a shape this cannot read`)
  }
  return parsed
}

function npmViewVersions(name) {
  try {
    return execFileSync('npm', ['view', name, 'versions', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    // A 404 is the answer "this package does not exist yet". Anything else is
    // the registry not answering, and guessing "nothing published" there would
    // attempt to overwrite a version AND would put a prerelease on `latest`
    // for a package that has a stable release. Both streams are read: under
    // \`npm run -s\` the child inherits a silent log level, and the refusal is
    // then only in the JSON on stdout.
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`
    if (/E404|404 Not Found/.test(output)) return null
    throw new Error(`could not ask the registry about ${name}: ${output.trim() || error.message}`, { cause: error })
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

  const missing = missingFrom(packages, (name) => publishedVersions(name))
  console.log(`publish:packages: ${packages.length} package(s), ${packages.length - missing.length} already on the registry, ${missing.length} to publish${publish ? '' : ' (DRY RUN)'}`)
  for (const entry of missing) console.log(`  ${entry.name}@${entry.version} → ${distTagFor(entry.version, entry.published)}`)
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
    const args = ['publish', '--access', 'public', '--tag', distTagFor(entry.version, entry.published)]
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
