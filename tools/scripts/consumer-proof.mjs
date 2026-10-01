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

// Prove a consumer story: copy its example out of the repo, install the
// packages it names into that blank project, build it, run its check, and
// open it in a browser (AGL-3201).
//
//   npm run proof:consumer -- logic-only                       # pack this tree's libs
//   npm run proof:consumer -- logic-only besigner-ui           # several, one build
//   npm run proof:consumer -- logic-only --registry            # this tree's version, from npm
//   npm run proof:consumer -- logic-only --registry=1.0.0-beta.219
//   npm run proof:consumer -- logic-only --keep                # leave the projects to look at
//   npm run proof:consumer -- logic-only --no-browser          # skip the browser step
//
// Nothing inside this repo can see whether a lib is installable: every import
// resolves through a tsconfig alias or the root node_modules, and the apps
// consume the libs' SOURCE, never what `nx build` emits. The first run of this
// found four defects that every test and guard was green over — no lib
// declared its dependencies, `@swc/helpers` was declared at a range whose
// paths the compiled code does not use, the ESM output imported its own files
// without extensions, and `lodash-es/isEqual` named no file.
//
// ## The example IS the proof
//
// A story is a project under `examples/consumers/<story>`: a small app a
// developer can copy, with its own package.json, `npm run build` and
// `npm run check`. The proof copies it to a directory outside the repo, points
// its `@aglyn/*` dependencies at the version under test, installs with a plain
// `npm install`, runs the same two scripts a developer would, and then loads
// the built app in Chrome. So an example cannot rot without this going red,
// and what this proves is exactly what the README tells somebody to type.
//
// What the story adds here is what the example cannot say about itself: the
// packages it must be able to do WITHOUT, and what a person does in the
// browser. A plain install brings every peer that is not optional, so a lib
// that grows a hard peer drags it into every consumer. And some defects only
// a browser shows: the inspector threw the moment an element was selected,
// from an import that every server-side render and every test was green over.
//
// ## Two sources, two questions
//
// - Packed (the default): builds each lib in the closure from THIS tree and
//   `npm pack`s it, which is the tarball `publish:packages` would upload. It
//   is the only proof that can stop a release, because a published version
//   can never be replaced. The promotion PR runs it.
// - `--registry`: installs the exact version from npm, siblings and all, the
//   way a user gets it. It sees what packing cannot — a package the release
//   failed to publish, a sibling pin the registry cannot satisfy — and it can
//   only report, because by then the version is out. The publish workflow
//   runs it after every release.
//
// It installs from the registry, builds and bundles, so it takes minutes and
// needs the network. It is not a guard.
//
// Exit codes: 0 every story holds · 1 one did not, with the step that failed.

import { execFile, execFileSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { caretAdmits, readPackageMap } from './lib/lib-boundaries.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Each story: the example it is, what its install must not bring, and what a
 * person does with it in a browser. A browser step waits for text to be
 * visible (`see`), clicks something (`click`, by role and accessible name or
 * by its text), or waits for the field a label names to hold a value
 * (`field`). Any uncaught error on the page fails the story.
 */
export const STORIES = {
  // "Just the logic, and I bring my own UI."
  'logic-only': {
    example: 'examples/consumers/logic-only',
    forbidden: ['next', 'firebase', 'firebase-admin', '@mui/material', '@aglyn/besigner-ui'],
    browser: [
      { see: 'Build your own editor' },
      { click: { role: 'button', name: 'Paragraph: Select, move, copy, paste, undo and redo.' } },
      { click: { role: 'button', name: 'Move out' } },
      { see: 'Moved out of its container' },
    ],
  },
  // "The besigner as it ships, without the console."
  //
  // The example brings `next` and `firebase`, and both are debts rather than
  // choices: `next` for two `next/dynamic` calls, and `firebase` because the
  // working-draft store writes Firestore itself instead of taking a store
  // from whoever embeds it. What this holds is the other half — no console,
  // no tenant runtime and no plugin is in the closure.
  'besigner-ui': {
    example: 'examples/consumers/besigner-ui',
    forbidden: [
      'firebase-admin',
      '@aglyn/tenant-runtime',
      '@aglyn/tenant-data-admin',
      '@aglyn/tenant-feature-instance',
      '@aglyn/plugins-mui',
      '@aglyn/plugins-crm',
    ],
    // The canvas renders inside a CLOSED shadow root, which no locator can
    // reach, so the element is selected the way a person does it from the
    // element tree. Selecting it draws the inspector, where the published
    // editor once threw on an import only a browser resolves; the field and
    // its value are the example's own, so they prove the form rendered and
    // the document loaded.
    browser: [
      { click: { role: 'button', name: 'Expand children' } },
      { click: { role: 'button', name: 'Expand children' } },
      { click: { text: 'Heading', exact: true } },
      { field: 'Text content', value: 'Besigner, outside the console' },
    ],
  },
}

/** What an example leaves behind when it has been run, never copied. */
const NOT_COPIED = new Set(['node_modules', 'dist', '.check', 'package-lock.json'])

/**
 * How long a plain install may take. The besigner-ui closure installs in
 * about three minutes; an unsatisfiable peer range made npm search for
 * eighteen before giving up, so past this the answer is "it cannot resolve".
 */
const INSTALL_TIMEOUT_MS = 10 * 60_000

/** The `@aglyn/*` packages an example's manifest asks for. */
export function askedFor(manifest) {
  return Object.keys(manifest?.dependencies ?? {})
    .filter((name) => name.startsWith('@aglyn/'))
    .sort()
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

/**
 * The example's manifest as the proof installs it: its `@aglyn/*` dependencies
 * pointed at the version under test.
 *
 * Packed, EVERY package in the closure is named, each at its tarball. A
 * sibling pins its `@aglyn/*` siblings at the exact version, and a version
 * that is not published yet resolves from nowhere else; the tarballs at the
 * top level are what npm finds first. From the registry only the packages the
 * example asks for change: the rest arrive through those pins, which is what
 * a user gets.
 */
export function consumerManifest(manifest, { version, tarballs = null }) {
  const dependencies = { ...manifest.dependencies }
  if (tarballs) {
    for (const [name, file] of Object.entries(tarballs)) dependencies[name] = `file:${file}`
  } else {
    for (const name of askedFor(manifest)) dependencies[name] = version
  }
  return { ...manifest, dependencies }
}

/**
 * What stops an example from being the proof, as sentences. Empty when
 * nothing does.
 *
 * An example names its `@aglyn/*` packages with a caret range, because that
 * is what a developer copying it should type, while the proof installs one
 * exact version. A range that did not admit that version would have the copy
 * install something nobody proved, so it is refused and the range is raised.
 */
export function exampleProblems(manifest, { version, examplePath }) {
  const problems = []
  if (!askedFor(manifest).length) problems.push(`${examplePath}/package.json asks for no @aglyn/* package`)
  for (const script of ['build', 'check']) {
    if (!manifest?.scripts?.[script]) problems.push(`${examplePath}/package.json has no "${script}" script, and the proof runs it`)
  }
  for (const name of askedFor(manifest)) {
    const range = manifest.dependencies[name]
    if (!caretAdmits(range, version)) {
      problems.push(
        `${examplePath}/package.json asks for ${name}@"${range}", which does not admit ${version}, the version this proves — ` +
          `a developer copying it would install something nobody proved. Name it as "^${version}".`,
      )
    }
  }
  return problems
}

/** Example folders no story names, so a new example cannot sit unproved. */
export function examplesWithoutStory(root = ROOT, stories = STORIES) {
  const dir = join(root, 'examples/consumers')
  if (!existsSync(dir)) return []
  const known = new Set(Object.values(stories).map((story) => story.example))
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !known.has(`examples/consumers/${entry.name}`))
    .map((entry) => entry.name)
}

/**
 * Waits until the registry has `version` of every one of `names`.
 *
 * npm's read path lags a finished publish by MINUTES, and this runs minutes
 * after one — so "not there yet" is answered by asking again, and only a
 * package still missing after every attempt fails the proof. Reading the lag
 * as a missing package is how the dist-tag step once went green with two
 * packages a release behind.
 */
export async function awaitPublished(
  names,
  version,
  { view = npmViewVersion, attempts = 20, delayMs = 30_000, sleep = defaultSleep, log = () => {} } = {},
) {
  let missing = [...names]
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const answers = await Promise.all(missing.map(async (name) => [name, await view(name, version)]))
    missing = answers.filter(([, answer]) => answer !== version).map(([name]) => name)
    if (!missing.length) return []
    if (attempt < attempts) {
      const named = `${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`
      log(`${missing.length} package(s) not on the registry at ${version} yet (attempt ${attempt} of ${attempts}): ${named}`)
      await sleep(delayMs)
    }
  }
  return missing
}

export function parseArgs(argv) {
  const options = { stories: [], registry: null, keep: false, browser: true }
  for (const arg of argv) {
    if (arg === '--keep') options.keep = true
    else if (arg === '--no-browser') options.browser = false
    else if (arg === '--registry') options.registry = ''
    else if (arg.startsWith('--registry=')) options.registry = arg.slice('--registry='.length)
    else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}`)
    else options.stories.push(arg)
  }
  return options
}

const execFileAsync = promisify(execFile)
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The version npm answers for `name@version`, or `null` when it has none. */
async function npmViewVersion(name, version) {
  try {
    const { stdout } = await execFileAsync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8' })
    return stdout.trim() || null
  } catch {
    return null
  }
}

function run(command, args, cwd, options = {}) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...options })
}

/** The last lines of what a failed command printed: the error is usually at the end. */
function tailOf(error, lines = 40) {
  const text = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim() || String(error?.message ?? error)
  return text.split('\n').slice(-lines).join('\n')
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function main(argv) {
  const options = parseArgs(argv)
  const unknown = options.stories.filter((name) => !STORIES[name])
  if (!options.stories.length || unknown.length) {
    console.error(`proof:consumer: name a story — ${Object.keys(STORIES).join(', ')}${unknown.length ? ` (not ${unknown.join(', ')})` : ''}`)
    return 1
  }

  const rootManifest = readJson(join(ROOT, 'package.json'))
  const packed = options.registry === null
  const version = options.registry || rootManifest.version
  const projectByAlias = new Map(readPackageMap(ROOT).filter((project) => project.alias).map((project) => [project.alias, project]))
  const readManifest = (project) => readJson(join(ROOT, project.root, 'package.json'))

  const plans = options.stories.map((name) => {
    const story = STORIES[name]
    const manifest = readJson(join(ROOT, story.example, 'package.json'))
    return { name, story, manifest, projects: closure(askedFor(manifest), projectByAlias, readManifest) }
  })
  const union = [...new Map(plans.flatMap((plan) => plan.projects).map((project) => [project.alias, project])).values()]
  console.log(
    `proof:consumer ${options.stories.join(', ')} at ${version}, ${packed ? 'packed from this tree' : 'from the registry'}: ` +
      `${union.length} packages in the closure`,
  )

  const work = mkdtempSync(join(tmpdir(), 'aglyn-consumer-'))
  let failed = 0
  try {
    const tarballs = packed ? buildAndPack(union, work, version) : null
    if (!packed) {
      console.log(`  · wait for ${version} on the registry`)
      const missing = await awaitPublished(union.map((project) => project.alias), version, { log: (line) => console.log(`    ${line}`) })
      if (missing.length) throw new Error(`the registry never answered ${version} for: ${missing.join(', ')}`)
    }
    const browser = options.browser ? await launchBrowser(work, rootManifest) : null
    try {
      for (const plan of plans) {
        if (!(await prove(plan, { work, version, tarballs, browser }))) failed += 1
      }
    } finally {
      await browser?.close()
    }
  } catch (error) {
    console.error(`proof:consumer: FAILED before a story could run\n${tailOf(error)}`)
    return 1
  } finally {
    if (options.keep) console.log(`  kept ${work}`)
    else rmSync(work, { recursive: true, force: true })
  }
  return failed ? 1 : 0
}

/**
 * Builds every lib in the closure and packs each, as `publish:packages` would.
 *
 * Each lib's `dist` is cleared first, and each packed manifest must carry the
 * version under test. A manifest left over from an earlier build packs the
 * previous release, and npm then fetches that sibling from the registry
 * without a word, so the proof would pass on packages it never packed. That
 * happened once, through the svg-icons build (see its vite.config.ts).
 */
function buildAndPack(projects, work, version) {
  console.log('  · build')
  for (const project of projects) rmSync(join(ROOT, 'dist', project.root), { recursive: true, force: true })
  run('npx', ['nx', 'run-many', '-t', 'build', '-p', projects.map((project) => project.name).join(',')], ROOT)
  console.log('  · pack')
  mkdirSync(join(work, 'tarballs'))
  const tarballs = {}
  for (const project of projects) {
    const dist = join(ROOT, 'dist', project.root)
    if (!existsSync(join(dist, 'package.json'))) throw new Error(`${project.name} built no package at dist/${project.root}`)
    const built = readJson(join(dist, 'package.json'))
    if (built.name !== project.alias || built.version !== version) {
      throw new Error(`dist/${project.root} is ${built.name}@${built.version}, not ${project.alias}@${version}`)
    }
    // The license text travels with every package. npm packs a LICENSE only
    // from the package's own directory, and the repo keeps one, at the root.
    copyFileSync(join(ROOT, 'LICENSE'), join(dist, 'LICENSE'))
    const file = run('npm', ['pack', '--silent', '--pack-destination', join(work, 'tarballs')], dist).trim().split('\n').pop()
    tarballs[project.alias] = join(work, 'tarballs', basename(file))
  }
  return tarballs
}

/** One story, in its own blank project. True when it holds. */
async function prove({ name, story, manifest, projects }, { work, version, tarballs, browser }) {
  const dir = join(work, name)
  let current = 'copy the example'
  try {
    const problems = exampleProblems(manifest, { version, examplePath: story.example })
    if (problems.length) throw new Error(problems.join('\n'))
    cpSync(join(ROOT, story.example), dir, { recursive: true, filter: (source) => !NOT_COPIED.has(basename(source)) })
    const closureTarballs = tarballs ? Object.fromEntries(projects.map((project) => [project.alias, tarballs[project.alias]])) : null
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(consumerManifest(manifest, { version, tarballs: closureTarballs }), null, 2)}\n`)

    current = 'npm install'
    console.log(`  · ${name}: ${current}`)
    // A PLAIN install, the one a consumer types. npm installs every peer that
    // is not marked optional, so this is also the proof of which frameworks a
    // story drags in: the first release installed `next`, `firebase` and MUI
    // beside the logic packages, because the core named them as hard peers
    // and the proof was hiding that behind `--legacy-peer-deps`. Said here as
    // a flag so a developer's own npm config cannot hide it again.
    run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', '--legacy-peer-deps=false'], dir, { timeout: INSTALL_TIMEOUT_MS })
    const present = story.forbidden.filter((forbidden) => existsSync(join(dir, 'node_modules', forbidden)))
    if (present.length) throw new Error(`the install pulled in what this story must not need: ${present.join(', ')}`)
    const wrong = projects
      .map((project) => [project.alias, readInstalledVersion(dir, project.alias)])
      .filter(([, installed]) => installed !== version)
    if (wrong.length) throw new Error(`installed the wrong version: ${wrong.map(([alias, installed]) => `${alias}@${installed ?? 'nothing'}`).join(', ')}`)

    current = 'npm run build'
    console.log(`  · ${name}: ${current}`)
    run('npm', ['run', 'build'], dir)

    current = 'npm run check'
    console.log(`  · ${name}: ${current}`)
    // The check's own verdict is its last line; the bundling above it is noise.
    console.log(`    ${run('npm', ['run', '--silent', 'check'], dir).trim().split('\n').pop()}`)

    if (browser) {
      current = 'open it in Chrome'
      console.log(`  · ${name}: ${current}`)
      await browse(browser, join(dir, 'dist'), story.browser ?? [])
    }
    console.log(`proof:consumer ${name}: holds (${projects.length} packages at ${version})`)
    return true
  } catch (error) {
    const gaveUp = error?.code === 'ETIMEDOUT' ? `gave up after ${INSTALL_TIMEOUT_MS / 60_000} minutes: npm could not settle the dependency tree\n` : ''
    console.error(`proof:consumer ${name}: FAILED at "${current}"\n${gaveUp}${tailOf(error)}`)
    return false
  }
}

function readInstalledVersion(dir, name) {
  const file = join(dir, 'node_modules', name, 'package.json')
  return existsSync(file) ? readJson(file).version : null
}

/**
 * Chrome, through `playwright-core`, which drives a browser it does not
 * download. The repo's own copy when there is one; otherwise — the registry
 * proof runs with no repo install — the same range, installed beside the
 * stories.
 */
export async function launchBrowser(work, rootManifest) {
  let playwright
  try {
    playwright = await import('playwright-core')
  } catch {
    const dir = join(work, 'browser')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{ "private": true }\n')
    const range = rootManifest.devDependencies?.['playwright-core'] ?? rootManifest.dependencies?.['playwright-core'] ?? 'latest'
    run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', `playwright-core@${range}`], dir)
    playwright = await import(pathToFileURL(createRequire(join(dir, 'package.json')).resolve('playwright-core')).href)
  }
  const { chromium } = playwright.chromium ? playwright : playwright.default
  try {
    return await chromium.launch({ headless: true, ...chromeExecutable() })
  } catch (error) {
    throw new Error(
      `no Chrome to open the examples in (${String(error.message).split('\n')[0]}). ` +
        'Set CONSUMER_PROOF_CHROME to a Chrome or Chromium binary, or pass --no-browser.',
      { cause: error },
    )
  }
}

/** Where Chrome is: an explicit path, a macOS install, or Playwright's `chrome` channel. */
function chromeExecutable() {
  const explicit = process.env.CONSUMER_PROOF_CHROME || process.env.E2E_CHROME_PATH
  if (explicit) return { executablePath: explicit }
  if (process.platform === 'darwin') {
    const found = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ].find((path) => existsSync(path))
    if (found) return { executablePath: found }
  }
  return { channel: 'chrome' }
}

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

/** Serves a built app the way a static host would, unknown paths answering with the app. */
function serveStatic(root) {
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname))
    let file = join(root, path)
    if (!file.startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html')
    response.writeHead(200, { 'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(response)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const STEP_TIMEOUT_MS = 30_000

/**
 * The field a visible label names, the way a person finds it. Found through
 * the label's `for`, because the inspector's text fields are editable regions
 * rather than inputs, and an accessible-name lookup does not follow a label
 * to a region.
 */
async function fieldLabeled(page, text) {
  const literal = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const label = page.locator('label').filter({ hasText: new RegExp(`^\\s*${literal}\\s*$`) }).first()
  const id = await label.getAttribute('for', { timeout: STEP_TIMEOUT_MS })
  return id ? page.locator(`[id="${id}"]`) : page.getByLabel(text, { exact: true })
}

/**
 * Polls a text field until it holds `value`: a field can render before its
 * value arrives. A field is an input or an editable region, so its text is
 * read either way.
 */
async function waitForValue(locator, value) {
  const deadline = Date.now() + STEP_TIMEOUT_MS
  let seen = null
  while (Date.now() < deadline) {
    seen = await locator
      .evaluate((element) => (typeof element.value === 'string' ? element.value : element.textContent), undefined, { timeout: 1_000 })
      .catch(() => null)
    if (seen?.trim() === value) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(seen === null ? 'no such text field' : `the field held ${JSON.stringify(seen)}, not ${JSON.stringify(value)}`)
}

/** Loads the built app and walks the story's steps; any uncaught page error fails it. */
export async function browse(browser, root, steps) {
  const server = await serveStatic(root)
  const page = await browser.newPage()
  const errors = []
  let current = 'load the page'
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    for (const step of steps) {
      current = JSON.stringify(step)
      if (step.see) {
        await page.getByText(step.see).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
      } else if (step.click) {
        const { role, name, text, exact = false } = step.click
        const target = role ? page.getByRole(role, { name, exact: true }) : page.getByText(text, { exact })
        await target.first().click({ timeout: STEP_TIMEOUT_MS })
      } else if (step.field) {
        await waitForValue(await fieldLabeled(page, step.field), step.value)
      }
      if (errors.length) break
    }
    // Long enough for an effect that throws after the last step to land.
    await page.waitForTimeout(500)
  } catch (error) {
    const thrown = errors.length ? `\nThe page threw first:\n  ${errors.join('\n  ')}` : ''
    throw new Error(`step ${current}: ${String(error.message).split('\n')[0]}${thrown}`, { cause: error })
  } finally {
    await page.close()
    server.close()
  }
  if (errors.length) throw new Error(`the page threw:\n  ${errors.join('\n  ')}`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`proof:consumer: FAILED — ${error.message}`)
      process.exit(1)
    },
  )
}
