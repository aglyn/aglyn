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
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Bring my site's fidelity report (AGL-4109): how a built site scores against
 * its source, as tables a person reads and can paste into an issue. No model
 * is called and nothing is written anywhere.
 *
 *   node libs/plugins/ai/scripts/site-import-fidelity-report.mts
 *
 * reports the recorded pages and frames, read, compiled and checked offline,
 * and the same pages built as the 10/29 import built them, as a control.
 *
 *   node libs/plugins/ai/scripts/site-import-fidelity-report.mts --host <id>
 *
 * reports a site an import built, for a live check. Its reads are Admin SDK
 * `get()`s and nothing else: the host, the import job, each page's screen and
 * current version, and the header and footer's layout and version. A page's
 * source is the job's own read while it holds one; the job empties a read once
 * its page is in, so otherwise the page is read again from the source site, as
 * a wave reads it (AglynBot, robots.txt honored, nothing but those addresses).
 *
 *   --job <id>              The import job. Default: the site's newest.
 *   --page <path>           Only this page; may be repeated. Default: every page that is in.
 *   --source <path>=<file>  Answer an address of the source site from a saved
 *                           file (a page, or a stylesheet); may be repeated.
 *                           With any of these the source site is asked nothing,
 *                           and a page with no file is listed as not scored.
 *   --json <file>           Also write every report in full.
 *
 * Against production, run it from the repo root with the Admin SDK's
 * credentials in the environment (`set -a; . ./.env; set +a`). With
 * `FIRESTORE_EMULATOR_HOST` set, it reads the emulator instead, in the project
 * `GCLOUD_PROJECT` names. A source this platform serves (aglyn.com) answers
 * AglynBot only with `SITE_IMPORT_EDGE_TOKEN` in the environment, as a crawl
 * does (`site-import-edge.ts`); without it the edge challenges the read, and
 * its pages are listed as not scored until they are given with `--source`.
 *
 * It exits 0 when everything scored holds the bar, 1 when something does not,
 * and 2 when it could not report.
 */

import { writeFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const require = createRequire(join(ROOT, 'package.json'))
type Dict = Record<string, any>

const AI = 'libs/plugins/ai/src/lib'
/** A read of the source's pages may take its time: nothing is waiting on it. */
const SOURCE_READ_MS = 10 * 60_000
const PRODUCTION_PROJECT = 'aglyn-main'

function readAliases(): Record<string, string> {
  const base = JSON.parse(readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8'))
  const alias: Record<string, string> = {}
  for (const [key, targets] of Object.entries(base.compilerOptions.paths as Record<string, string[]>)) {
    const target = targets[0].replace(/^\.\//, '')
    if (key.endsWith('/*')) alias[key.slice(0, -1)] = join(ROOT, target.replace(/\/?\*$/, '')) + '/'
    else alias[key] = join(ROOT, target)
  }
  return alias
}

/** The libs, through the repo's own loader, as the other scripts here read them. */
function loader(): (file: string) => Promise<Dict> {
  const { createJiti } = require('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), {
    alias: readAliases(),
    jsx: true,
    interopDefault: true,
    moduleCache: true,
    fsCache: join(tmpdir(), 'aglyn-ai-fidelity-report-jiti'),
    sourceMaps: false,
  })
  return (file) => jiti.import(join(ROOT, file)) as Promise<Dict>
}

interface Args {
  host: string | null
  job: string | null
  pages: string[]
  sources: Map<string, string>
  json: string | null
}

const USAGE = 'Usage: site-import-fidelity-report.mts [--host <id> [--job <id>] [--page <path>]… [--source <path>=<file>]…] [--json <file>]'

const pathKey = (path: string) => (path.replace(/\/+$/, '') || '/').replace(/^(?!\/)/, '/')

function readArgs(argv: readonly string[]): Args {
  const args: Args = { host: null, job: null, pages: [], sources: new Map(), json: null }
  for (let at = 0; at < argv.length; at += 2) {
    const name = argv[at] as string
    const value = argv[at + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value.\n${USAGE}`)
    if (name === '--host') args.host = value
    else if (name === '--job') args.job = value
    else if (name === '--json') args.json = resolve(value)
    else if (name === '--page') args.pages.push(pathKey(value))
    else if (name === '--source') {
      const split = value.indexOf('=')
      if (split < 1) throw new Error(`--source takes <path>=<file>.\n${USAGE}`)
      args.sources.set(pathKey(value.slice(0, split)), resolve(value.slice(split + 1)))
    } else throw new Error(`Unknown option ${name}.\n${USAGE}`)
  }
  if (!args.host && (args.job || args.pages.length || args.sources.size)) throw new Error(`--job, --page and --source need --host.\n${USAGE}`)
  return args
}

/*------------------------------------------
 * The tables
 *-----------------------------------------*/

/** A table with its columns lined up, which reads in a terminal and pastes into an issue. */
function table(headers: readonly string[], rows: ReadonlyArray<readonly string[]>): string {
  const widths = headers.map((header, at) => Math.max(2, header.length, ...rows.map((row) => (row[at] ?? '').length)))
  const line = (cells: readonly string[]) => `| ${cells.map((cell, at) => cell.padEnd(widths[at] as number)).join(' | ')} |`
  return [line(headers), line(widths.map(() => '--')), ...rows.map(line)].join('\n')
}

const count = (entry: { built: number; source: number }) => `${entry.built}/${entry.source}`
const score = (value: number) => value.toFixed(2)

interface PageRow {
  /** What a person calls the page. */
  name: string
  report: Dict
}

/** Whether a page ships: its structure at the bar, its words exactly whole. */
const holds = (report: Dict, threshold: number) => report.score >= threshold && report.words.ratio === 1

/** The pages side by side: each measure, built over source. */
function pagesTable(rows: readonly PageRow[], threshold: number): string {
  return table(
    ['page', 'score', 'holds', 'words', 'extra', 'sections', 'bands', 'widths', 'rows', 'tables', 'tabs', 'pictures', 'framing', 'icons', 'buttons', 'headings', 'forms', 'videos', 'lowest'],
    rows.map(({ name, report }) => [
      name,
      score(report.score),
      holds(report, threshold) ? 'yes' : 'NO',
      `${report.words.source - report.words.missing}/${report.words.source}`,
      String(report.words.extra),
      count(report.sections),
      count(report.bands),
      count(report.widths),
      count(report.rows),
      count(report.tables),
      count(report.tabs),
      count(report.pictures),
      // A report of a page scored before the framing measure (AGL-4138) has none.
      report.framing ? count(report.framing) : '-',
      count(report.icons),
      count(report.buttons),
      count(report.headings),
      count(report.forms),
      // A report of a page scored before the videos measure (AGL-4140) has none.
      report.videos ? count(report.videos) : '-',
      report.lowest ?? '-',
    ]),
  )
}

/** The groups the sources hold, by kind: each item its own element, with its parts. */
function groupsTable(rows: readonly PageRow[]): string | null {
  const kinds = [...new Set(rows.flatMap(({ report }) => Object.keys(report.groups)))].sort()
  if (!kinds.length) return null
  return table(
    ['page', ...kinds],
    rows.map(({ name, report }) => [name, ...kinds.map((kind) => (report.groups[kind] ? count(report.groups[kind].items) : '-'))]),
  )
}

const FRAME_MEASURES: ReadonlyArray<[string, string]> = [
  ['items', 'header items, in the row'],
  ['menus', 'menus'],
  ['entries', 'menu entries'],
  ['details', 'their lines and icons'],
  ['ctas', 'header buttons'],
  ['drawer', 'phone menu entries'],
  ['phone', 'menu button with its phone menu'],
  ['nowrap', 'row on one line'],
  ['menuColumns', 'menu panel columns, in order'],
  ['panels', 'filled columns and footer boxes'],
  ['tiles', 'icon tiles'],
  ['pictures', 'menu pictures'],
  ['hover', 'menus opening on hover'],
  ['logo', 'footer logo'],
  ['columns', 'footer columns'],
  ['links', 'footer links'],
  ['social', 'footer profiles'],
  ['facts', 'footer facts'],
]

/** The header and footer, each measure a row, each frame a column. */
function framesTable(frames: ReadonlyArray<{ name: string; report: Dict }>): string {
  return table(
    ['measure', ...frames.map((frame) => frame.name)],
    [
      ['score', ...frames.map((frame) => score(frame.report.score))],
      ...FRAME_MEASURES.map(([key, label]) => [label, ...frames.map((frame) => count(frame.report[key]))]),
      ['items in the source’s order', ...frames.map((frame) => (frame.report.inOrder ? 'yes' : 'NO'))],
    ],
  )
}

/** What a page is short of: every measure under whole, its numbers, and a few of the words. */
function shortOf(rows: readonly PageRow[], frames: ReadonlyArray<{ name: string; report: Dict }>): string[] {
  const out: string[] = []
  for (const { name, report } of rows) {
    const short: string[] = []
    const { words } = report
    if (words.ratio !== 1) {
      const said = [...words.examples.missing.map((word: string) => `-${word}`), ...words.examples.extra.map((word: string) => `+${word}`)].join(' ')
      short.push(`words: ${words.missing} missing, ${words.extra} extra${said ? ` (${said})` : ''}`)
    }
    for (const key of ['sections', 'bands', 'widths', 'rows', 'tables', 'tabs', 'pictures', 'framing', 'icons', 'buttons', 'headings', 'forms', 'videos']) {
      if (report[key] && report[key].ratio < 1) short.push(`${key} ${count(report[key])}`)
    }
    for (const [kind, entry] of Object.entries(report.groups as Dict)) if (entry.items.ratio < 1) short.push(`${kind} ${count(entry.items)}`)
    if (report.bands.ratio < 1) short.push(`bands read ${report.bands.read.join(', ')}; drawn ${report.bands.drawn.join(', ')}`)
    if (short.length) out.push(`- ${name}: ${short.join('; ')}`)
  }
  for (const { name, report } of frames) {
    const short = FRAME_MEASURES.filter(([key]) => report[key].ratio < 1).map(([key, label]) => `${label} ${count(report[key])}`)
    if (!report.inOrder) short.push('items out of the source’s order')
    if (short.length) out.push(`- header and footer, ${name}: ${short.join('; ')}`)
  }
  return out
}

/** What the score reads and leaves out on purpose, as the guide says it. */
function notScored(rows: readonly PageRow[]): string | null {
  const lone = rows.reduce((total, row) => total + row.report.icons.lone, 0)
  const unlinked = rows.reduce((total, row) => total + row.report.buttons.unlinked, 0)
  return lone || unlinked ? `Reported, not scored: ${lone} icon${lone === 1 ? '' : 's'} standing alone, ${unlinked} button${unlinked === 1 ? '' : 's'} that go${unlinked === 1 ? 'es' : ''} nowhere a page can send a visitor.` : null
}

/** The result, in one line, and the exit code it means. */
function verdict(rows: readonly PageRow[], frames: ReadonlyArray<{ report: Dict }>, threshold: number): { line: string; ok: boolean } {
  if (!rows.length) return { line: 'Result: NO PAGE SCORED, so this says nothing of whether the site holds the bar.', ok: false }
  const pagesHeld = rows.filter(({ report }) => holds(report, threshold)).length
  const framesHeld = frames.filter(({ report }) => report.score >= threshold).length
  const ok = pagesHeld === rows.length && framesHeld === frames.length
  const parts = [`${pagesHeld} of ${rows.length} page${rows.length === 1 ? '' : 's'}`, `${framesHeld} of ${frames.length} header${frames.length === 1 ? ' and footer' : 's and footers'}`]
  return { line: `${ok ? 'Result: holds the bar' : 'Result: BELOW THE BAR'}: ${parts.join(' and ')} at ${score(threshold)} or above on structure, words exactly 1.`, ok }
}

/** Each page asked for, as its row of the ledger stands: how it was built, what it came to and what it said. */
function ledgerTable(pages: readonly Dict[], items: readonly Dict[]): string {
  const row = new Map(items.map((item) => [item.slot, item]))
  return table(
    ['page', 'build', 'status', 'credits', 'note'],
    pages.map((page) => {
      const item = row.get(page.slot)
      return [String(page.path), String(page.build ?? '-'), String(item?.status ?? 'no row'), String(item?.creditsSpent ?? 0), String(item?.note ?? '-')]
    }),
  )
}

/*------------------------------------------
 * The recorded pages
 *-----------------------------------------*/

async function recordedReport(load: (file: string) => Promise<Dict>, args: Args): Promise<boolean> {
  const replay = await load(`${AI}/site-import/fixtures/site-import-fidelity-replay.ts`)
  const fidelity = await load(`${AI}/model/ai-site-import-fidelity.ts`)
  const threshold = fidelity.SITE_IMPORT_FIDELITY_THRESHOLD as number
  const NAMES = [
    ['home', 'Home'],
    ['product', '/product'],
    ['pricing', '/pricing, 10/28'],
    ['livePricing', '/pricing, 11/01'],
    ['contact', '/contact'],
    ['post', 'a blog post'],
    ['blog', '/blog'],
    ['pottery', 'a studio, not ours'],
    ['bakery', 'a bakery’s films, not ours'],
  ] as const
  const forms = (key: string) => (key === 'contact' ? { forms: [{ id: 'form-contact', name: 'Contact' }] } : {})
  const scored = (built: Dict): Dict => fidelity.siteImportFidelity(built.source, built.tree)
  const rows: PageRow[] = NAMES.map(([key, name]) => ({ name, report: scored(replay.siteImportReplayPage(key, forms(key))) }))
  rows.splice(1, 0, { name: 'Home, arranged', report: scored(replay.siteImportReplayPage('home', { answer: replay.SITE_IMPORT_REPLAY_HOME_ANSWER })) })
  const control: PageRow[] = NAMES.map(([key, name]) => ({ name, report: scored(replay.siteImportReplayPage(key, { ...forms(key), layout: false })) }))
  const frames = (
    [
      ['home', 'aglyn.com'],
      ['pottery', 'a studio, not ours'],
    ] as const
  ).map(([key, name]) => {
    const frame = replay.siteImportReplayFrame(key)
    return { name, report: fidelity.siteImportFrameFidelity(frame, frame.tree) as Dict }
  })
  const result = verdict(rows, frames, threshold)
  const groups = groupsTable(rows)
  // Home is on the table twice; what it leaves out is said once.
  const said = notScored(rows.filter(({ name }) => name !== 'Home, arranged'))
  const short = shortOf(rows, frames)
  console.log(
    [
      '# Bring my site: fidelity report, recorded pages',
      '',
      'Each cell is what the built page kept over what the source has. A page holds the bar when its structure',
      `scores ${score(threshold)} or above and its words are exactly whole.`,
      '',
      '## Pages',
      '',
      pagesTable(rows, threshold),
      '',
      ...(groups ? ['## Groups, items kept by kind', '', groups, ''] : []),
      '## Header and footer',
      '',
      framesTable(frames),
      '',
      '## Control: the same pages as the 10/29 import built them',
      '',
      table(
        ['page', 'score', 'lowest', 'words'],
        control.map(({ name, report }) => [name, score(report.score), report.lowest ?? '-', `${report.words.source - report.words.missing}/${report.words.source}`]),
      ),
      '',
      ...(short.length ? ['## Short of the source', '', ...short, ''] : []),
      ...(said ? [said, ''] : []),
      result.line,
    ].join('\n'),
  )
  if (args.json) writeFileSync(args.json, JSON.stringify({ threshold, pages: rows, control, frames }, null, 1))
  return result.ok
}

/*------------------------------------------
 * A site an import built
 *-----------------------------------------*/

interface Reads {
  host: Dict
  orgId: string
  jobId: string
  job: Dict
}

/** The site, and the import that built it: named, or its newest. */
async function readSite(db: Dict, hostId: string, wantedJob: string | null): Promise<Reads> {
  const host = await db.collection('hosts').doc(hostId).get()
  if (!host.exists) throw new Error(`No site hosts/${hostId}.`)
  const orgId = host.get('orgId')
  if (typeof orgId !== 'string' || !orgId) throw new Error(`hosts/${hostId} names no workspace.`)
  const jobs = db.collection('orgs').doc(orgId).collection('aiJobs')
  if (wantedJob) {
    const job = await jobs.doc(wantedJob).get()
    if (!job.exists) throw new Error(`No import job orgs/${orgId}/aiJobs/${wantedJob}.`)
    if (job.get('hostId') !== hostId) throw new Error(`Job ${wantedJob} is for another site.`)
    return { host: host.data(), orgId, jobId: job.id, job: job.data() }
  }
  const found = (await jobs.where('kind', '==', 'import').get()).docs.filter((doc: Dict) => doc.get('hostId') === hostId && doc.get('siteImport'))
  const at = (doc: Dict) => {
    const value = doc.get('createdAt')
    return typeof value?.toMillis === 'function' ? value.toMillis() : Number(new Date(value ?? 0)) || 0
  }
  const newest = found.sort((a: Dict, b: Dict) => at(b) - at(a))[0]
  if (!newest) throw new Error(`No import job for hosts/${hostId} in orgs/${orgId}/aiJobs.`)
  return { host: host.data(), orgId, jobId: newest.id, job: newest.data() }
}

/** A stored tree: a screen's or a layout's current version, its nodes decoded. */
async function storedTree(doc: Dict, decode: (raw: unknown) => Dict | null, treeOf: (nodes: Dict) => Dict): Promise<{ tree: Dict; version: Dict | null } | null> {
  const snapshot = await doc.get()
  if (!snapshot.exists) return null
  const versionId = snapshot.get('versionId')
  const version = typeof versionId === 'string' && versionId ? await doc.collection('versions').doc(versionId).get() : null
  const nodes = decode(version?.exists ? version.get('nodes') : snapshot.get('nodes'))
  return nodes && Object.keys(nodes).length ? { tree: treeOf(nodes), version: version?.exists ? version : snapshot } : null
}

/** The saved files, answering for the source site: an address with no file is not there. */
function savedSite(sources: ReadonlyMap<string, string>) {
  return async (url: string) => {
    const file = sources.get(pathKey(new URL(url).pathname))
    if (!file) return { ok: false, url, text: '', bytes: 0, truncated: false, contentType: '', refusal: 'http-status', status: 404 }
    const text = readFileSync(file, 'utf8')
    return { ok: true, url, text, bytes: Buffer.byteLength(text), truncated: false, contentType: file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8', refusal: null, status: 200 }
  }
}

async function hostReport(load: (file: string) => Promise<Dict>, args: Args): Promise<boolean> {
  const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app')
  const { getFirestore } = require('firebase-admin/firestore')
  const emulator = process.env['FIRESTORE_EMULATOR_HOST'] ?? null
  const projectId = process.env['GCLOUD_PROJECT'] ?? (emulator ? 'demo-aglyn' : PRODUCTION_PROJECT)
  // The default app: the libs take it wherever one exists, and throw on any other.
  const app = initializeApp(emulator ? { projectId } : { credential: applicationDefault(), projectId })
  const db = getFirestore(app)
  try {
    return await hostReportFrom(db, load, args, emulator ? `the emulator at ${emulator} (${projectId})` : `production (${projectId}), read only`)
  } finally {
    await deleteApp(app)
  }
}

async function hostReportFrom(db: Dict, load: (file: string) => Promise<Dict>, args: Args, where: string): Promise<boolean> {
  const fidelity = await load(`${AI}/model/ai-site-import-fidelity.ts`)
  const { siteImportCreditsLine, siteImportCreditsMeasured, siteImportLookLine } = await load(`${AI}/model/ai-site-import-report.ts`)
  const { decodeStoredNodes } = await load('libs/aglyn/src/lib/app-utils/stored-nodes.ts')
  const threshold = fidelity.SITE_IMPORT_FIDELITY_THRESHOLD as number
  const hostId = args.host as string
  const { host, orgId, jobId, job } = await readSite(db, hostId, args.job)
  const state = job.siteImport as Dict | null
  if (!state) throw new Error(`Job ${jobId} has no import.`)
  const hostRef = db.collection('hosts').doc(hostId)

  const all = state.pages as Dict[]
  const wanted = new Set(args.pages)
  const known = new Set(all.map((page) => pathKey(page.path)))
  const unknown = args.pages.filter((path) => !known.has(path))
  const chosen = all.filter((page) => !wanted.size || wanted.has(pathKey(page.path)))

  // What is built of each chosen page, and which ones have a source to score it against.
  const left: Array<{ page: string; why: string }> = unknown.map((path) => ({ page: path, why: 'not a page of this import' }))
  const stored = new Map<string, Dict>()
  const reads = new Map<string, Dict>()
  for (const page of chosen) {
    if (page.refused) {
      left.push({ page: page.path, why: `left out of the import (${page.refused})` })
      continue
    }
    const built = await storedTree(hostRef.collection('screens').doc(page.draftId), decodeStoredNodes, fidelity.siteImportFidelityTreeOf)
    if (!built) {
      left.push({ page: page.path, why: 'not built yet' })
      continue
    }
    stored.set(page.slot, built.tree)
    if (page.read?.blocks?.length && page.read.layout) reads.set(page.slot, page.read)
  }
  const held = reads.size

  // The job empties a read once its page is in: the rest are read again, as a wave reads them.
  const toRead = chosen.filter((page) => stored.has(page.slot) && !reads.has(page.slot))
  let readAt: string | null = null
  if (toRead.length) {
    const { crawlSiteForImport } = await load(`${AI}/site-import/site-import-crawl.ts`)
    const { siteImportWaveReads } = await load(`${AI}/jobs/ai-job-import-step.ts`)
    readAt = new Date().toISOString()
    const crawled = await crawlSiteForImport(
      { domain: state.domain, maxPages: toRead.length, only: toRead.map((page) => page.url), layout: true, timeBudgetMs: SOURCE_READ_MS },
      args.sources.size ? { fetch: savedSite(args.sources), headersFor: () => ({}) } : {},
    )
    if (crawled.refused) throw new Error(`The source ${state.domain} could not be read: ${crawled.refused}.`)
    const again: Map<string, Dict | string> = siteImportWaveReads(toRead, crawled, readAt)
    for (const page of toRead) {
      const read = again.get(page.slot)
      if (read && typeof read !== 'string') reads.set(page.slot, read)
      else left.push({ page: page.path, why: `its source could not be read again (${read ?? crawled.stoppedBy ?? 'not reached'})${args.sources.size ? '' : ': a source this platform serves needs SITE_IMPORT_EDGE_TOKEN, or give the page with --source'}` })
    }
  }

  const rows: PageRow[] = []
  for (const page of chosen) {
    const read = reads.get(page.slot)
    const tree = stored.get(page.slot)
    if (!read || !tree) continue
    if (!read.layout) {
      left.push({ page: page.path, why: 'the read has no layout to score against (too large to keep)' })
      continue
    }
    rows.push({ name: page.path, report: fidelity.siteImportFidelity({ layout: read.layout, blocks: read.blocks ?? [], photos: page.photos?.assets ?? [] }, tree) })
  }

  // The header and footer, wherever the pages render inside them.
  const frames: Array<{ name: string; report: Dict }> = []
  let layoutId: string | null = state.frame?.draftId ?? null
  let frame = layoutId ? await storedTree(hostRef.collection('layouts').doc(layoutId), decodeStoredNodes, fidelity.siteImportFidelityTreeOf) : null
  if (!frame) {
    const home = all.find((page) => page.slug === '/')
    const screen = home ? await storedTree(hostRef.collection('screens').doc(home.draftId), decodeStoredNodes, fidelity.siteImportFidelityTreeOf) : null
    const named = screen?.version?.get('layoutId')
    layoutId = typeof named === 'string' && named ? named : null
    frame = layoutId ? await storedTree(hostRef.collection('layouts').doc(layoutId), decodeStoredNodes, fidelity.siteImportFidelityTreeOf) : null
  }
  if (frame) frames.push({ name: 'this site', report: fidelity.siteImportFrameFidelity({ nav: state.home?.nav ?? null, footer: state.home?.footer ?? null }, frame.tree) })
  else left.push({ page: 'header and footer', why: 'not built yet' })

  const items = (job.items ?? []) as Dict[]
  const frameSpent = items.find((item) => item.op === 'layout' || item.slot === 'frame')?.creditsSpent
  const inNow = all.filter((page) => page.brought).length
  const sourced = readAt ? `${held} from the job's own read, ${reads.size - held} read again at ${readAt}${args.sources.size ? ' from saved files' : ''}` : `${held} from the job's own read`

  const result = verdict(rows, frames, threshold)
  const groups = groupsTable(rows)
  const said = notScored(rows)
  const short = shortOf(rows, frames)
  console.log(
    [
      `# Bring my site: fidelity report, ${host.displayName ?? hostId}`,
      '',
      table(
        ['', ''],
        [
          ['site', `hosts/${hostId}, workspace ${orgId}`],
          ['source', String(state.domain)],
          ['read from', where],
          ['import job', `${jobId}, ${job.status}; ${inNow} of ${all.length} pages in`],
          ['scored', `${rows.length} of ${chosen.length} page${chosen.length === 1 ? '' : 's'} asked for; sources: ${sourced}`],
          ['look', siteImportLookLine(host, state, jobId)],
          ['credits', `${siteImportCreditsLine(siteImportCreditsMeasured(state, items))}${frameSpent !== undefined ? `; header and footer ${frameSpent}` : ''}; job total ${job.creditsSpent ?? 0}`],
        ],
      ),
      '',
      `Each cell is what the built page kept over what the source has. A page holds the bar when its structure scores ${score(threshold)} or above and its words are exactly whole.`,
      '',
      '## Pages',
      '',
      rows.length ? pagesTable(rows, threshold) : 'No page was scored.',
      '',
      ...(groups ? ['## Groups, items kept by kind', '', groups, ''] : []),
      '## Header and footer',
      '',
      frames.length ? framesTable(frames) : 'Not built yet.',
      '',
      ...(short.length ? ['## Short of the source', '', ...short, ''] : []),
      ...(left.length ? ['## Not scored', '', ...left.map(({ page, why }) => `- ${page}: ${why}`), ''] : []),
      '## The ledger',
      '',
      ledgerTable(chosen, items),
      '',
      ...(said ? [said, ''] : []),
      left.length ? `${result.line} ${left.length} not scored.` : result.line,
    ].join('\n'),
  )
  if (args.json) writeFileSync(args.json, JSON.stringify({ threshold, hostId, jobId, pages: rows, frames, notScored: left }, null, 1))
  return result.ok
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2))
  const load = loader()
  const ok = await (args.host ? hostReport(load, args) : recordedReport(load, args))
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(2)
})
