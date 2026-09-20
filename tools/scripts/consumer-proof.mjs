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

// Prove a consumer story: pack the libs as they would be published, install
// them into an EMPTY project outside the workspace, bundle an entry that
// imports them, and run it (AGL-3201).
//
//   npm run proof:consumer -- logic-only
//   npm run proof:consumer -- logic-only --keep     # leave the project to look at
//
// Nothing inside this repo can see whether a lib is installable: every import
// resolves through a tsconfig alias or the root node_modules, and the apps
// consume the libs' SOURCE, never what `nx build` emits. The first run of this
// found four defects that every test and guard was green over — no lib
// declared its dependencies, `@swc/helpers` was declared at a range whose
// paths the compiled code does not use, the ESM output imported its own files
// without extensions, and `lodash-es/isEqual` named no file.
//
// A story names the packages a consumer asks for, the peers they are told to
// bring, and the peers that must NOT be needed. The closure of `@aglyn/*`
// dependencies is read off each lib's package.json, so a story is also a
// check that those declarations are complete.
//
// It builds, installs from the registry and bundles, so it takes minutes and
// needs the network. It is not a guard; run it before touching how a lib is
// built or what it declares.
//
// Exit codes: 0 the story holds · 1 it does not, with the step that failed.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPackageMap } from './lib/lib-boundaries.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

export const STORIES = {
  // "Just the logic, and I bring my own UI."
  'logic-only': {
    packages: ['@aglyn/aglyn', '@aglyn/besigner'],
    peers: ['react@19'],
    forbidden: ['next', 'firebase', 'firebase-admin', '@mui/material', '@aglyn/besigner-ui'],
    entry: [
      "import * as core from '@aglyn/aglyn'",
      "import * as besigner from '@aglyn/besigner'",
      "import { pluginTaxProfile, registerPluginTaxProfile } from '@aglyn/aglyn/plugin-manager/plugin-tax-profile'",
      "registerPluginTaxProfile({ flatTax: (_r, cents) => ({ taxCents: Math.round(cents / 10), label: 'Tax', pct: 10 }), taxModeOf: () => 'manual' }, { pluginId: 'consumer' })",
      "const tax = pluginTaxProfile().flatTax({}, 1000, 'Tax').taxCents",
      "if (tax !== 100) throw new Error('a core seam answered ' + tax)",
      "if (Object.keys(core).length < 100 || Object.keys(besigner).length < 10) throw new Error('an entry point exported almost nothing')",
      "console.log('PROOF_OK')",
    ],
  },
  // "The besigner as it ships, without the console."
  //
  // The peers are what the editor asks for TODAY, and two of them are debts
  // rather than choices: `next` for two `next/dynamic` calls, and `firebase`
  // because the working-draft store writes Firestore itself instead of taking
  // a store from whoever embeds it. What this holds is the other half — no
  // console, no tenant runtime and no plugin is in the closure.
  'besigner-ui': {
    packages: ['@aglyn/besigner-ui', '@aglyn/aglyn-node-renderer'],
    peers: [
      'react@19',
      'react-dom@19',
      'next',
      'firebase',
      '@mui/material',
      '@mui/system',
      '@mui/icons-material',
      '@mui/lab',
      '@mui/x-data-grid',
      '@mui/x-date-pickers',
      '@emotion/react',
      '@emotion/styled',
    ],
    forbidden: ['firebase-admin', '@aglyn/tenant-runtime', '@aglyn/tenant-data-admin', '@aglyn/tenant-feature-instance', '@aglyn/plugins-mui', '@aglyn/plugins-crm'],
    entry: [
      "import * as ui from '@aglyn/besigner-ui'",
      "import * as renderer from '@aglyn/aglyn-node-renderer'",
      "if (Object.keys(ui).length < 5 || Object.keys(renderer).length < 1) throw new Error('an entry point exported almost nothing')",
      "console.log('PROOF_OK')",
    ],
  },
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
}

/** The story's packages and every `@aglyn/*` package they declare, transitively. */
export function closure(packages, projectByAlias, readManifest) {
  const seen = new Set()
  const walk = (name) => {
    const project = projectByAlias.get(name)
    if (seen.has(name) || !project) return
    seen.add(name)
    for (const dependency of Object.keys(readManifest(project).dependencies ?? {})) walk(dependency)
  }
  for (const name of packages) walk(name)
  return [...seen].map((name) => projectByAlias.get(name))
}

function main() {
  const [storyName, ...flags] = process.argv.slice(2)
  const story = STORIES[storyName]
  if (!story) {
    console.error(`proof:consumer: name a story — ${Object.keys(STORIES).join(', ')}`)
    process.exit(1)
  }
  const step = (label) => console.log(`  · ${label}`)
  const projectByAlias = new Map(readPackageMap(ROOT).filter((project) => project.alias).map((project) => [project.alias, project]))
  const projects = closure(story.packages, projectByAlias, (project) =>
    JSON.parse(readFileSync(join(ROOT, project.root, 'package.json'), 'utf8')),
  )
  console.log(`proof:consumer ${storyName}: ${projects.length} packages in the closure`)

  step('build')
  run('npx', ['nx', 'run-many', '-t', 'build', '-p', projects.map((project) => project.name).join(',')], ROOT)

  const dir = mkdtempSync(join(tmpdir(), `aglyn-consumer-${storyName}-`))
  try {
    step('pack')
    mkdirSync(join(dir, 'tarballs'))
    for (const project of projects) {
      const dist = join(ROOT, 'dist', project.root)
      if (!existsSync(join(dist, 'package.json'))) throw new Error(`${project.name} built no package at dist/${project.root}`)
      run('npm', ['pack', '--silent', '--pack-destination', join(dir, 'tarballs')], dist)
    }

    step('install into an empty project')
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: `consumer-${storyName}`, private: true, type: 'module' }, null, 2)}\n`)
    const tarballs = readdirSync(join(dir, 'tarballs')).map((name) => join(dir, 'tarballs', name))
    // Peers are named by the story rather than auto-installed, so the proof is
    // also about which of them a consumer can do WITHOUT.
    run('npm', ['install', '--legacy-peer-deps', '--no-audit', '--no-fund', '--loglevel=error', ...tarballs, ...story.peers], dir)
    const present = story.forbidden.filter((name) => existsSync(join(dir, 'node_modules', name)))
    if (present.length) throw new Error(`the install pulled in what this story must not need: ${present.join(', ')}`)

    step('bundle')
    writeFileSync(join(dir, 'entry.mjs'), `${story.entry.join('\n')}\n`)
    writeFileSync(
      join(dir, 'vite.config.mjs'),
      "export default { logLevel: 'error', build: { ssr: 'entry.mjs', outDir: 'out', minify: false }, ssr: { noExternal: true } }\n",
    )
    run(join(ROOT, 'node_modules', '.bin', 'vite'), ['build', '--config', 'vite.config.mjs'], dir)

    step('run')
    const output = run('node', [join('out', 'entry.js')], dir)
    if (!output.includes('PROOF_OK')) throw new Error(`the bundle ran and did not finish:\n${output}`)
    console.log(`proof:consumer ${storyName}: holds`)
  } catch (error) {
    console.error(`proof:consumer ${storyName}: FAILED\n${String(error.stderr || error.message || error).split('\n').slice(0, 12).join('\n')}`)
    process.exitCode = 1
  } finally {
    if (flags.includes('--keep')) console.log(`  kept ${dir}`)
    else rmSync(dir, { recursive: true, force: true })
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main()
