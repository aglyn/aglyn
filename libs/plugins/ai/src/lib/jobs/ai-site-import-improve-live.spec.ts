/**
 * @jest-environment node
 */
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
 * Improve it, generative (AGL-4152), answered by the REAL model, on sites that
 * do not exist and on recorded pages: each site's one plan, each page's
 * redesign three times over, and each plan's proposed page. No page is fetched,
 * no picture is made, and it runs only when asked.
 *
 * It holds what the eval's bar holds:
 *
 *  - every answer that keeps its redesign holds its kept ledger whole;
 *  - no invented fact left after the one re-ask on at least nine answers in ten;
 *  - the design lines green on at least eight in ten;
 *  - every page inside its ceiling (`AI_SITE_IMPORT_PAGE_CEILING_CREDITS`), its
 *    re-ask included, and a page short enough to show whole within the
 *    reworded row's p90 at the billed rates; the p90 of every page is printed.
 *
 * Generated pictures are off here by the round's own setting, whatever the
 * product's default: no picture is made.
 *
 * A number is not the verdict: an import is judged as a whole site. Each run
 * writes, for a person to read beside its source:
 *
 *  - `tools/ai-eval/cases/page/import-improve-<site>.json`, its plan and answers;
 *  - `AGLYN_LIVE_AI_OUT/<site>-<page>-<answer>.md` (default `import-improve` in the
 *    system's temporary folder), the old page's lines, then the new page section
 *    by section.
 *
 * It costs real money. {@link AI_SITE_IMPORT_IMPROVE_EVAL_COMMAND} is the command,
 * and the run's estimate is printed from the measured rows before any request.
 *
 * THE CAP: `AGLYN_LIVE_AI_CAP_USD` may lower the $5 of provider cost this run may
 * spend, never raise it. `AGLYN_LIVE_AI_SPENT_USD` is what the round's earlier
 * runs spent. A request is sent only with what is spent and what is in flight
 * under the cap; a batch's requests are all in flight until it ends.
 *
 * `AGLYN_LIVE_AI_ANSWERS` sets the answers a page (3); `AGLYN_LIVE_AI_SITES` names
 * the sites to run, comma-separated; `AGLYN_LIVE_AI_MODEL` names another catalog
 * model; `AGLYN_AI_EFFORT_ARM=job.page:medium` compares medium effort with low.
 */

/** Every model call: the run it was asked for, its tool, and what it answered with. */
const mockCalls: Array<{ tag: string; tools: string[]; answer: unknown; stopReason: string | null; usage: Record<string, number> }> = []
jest.mock('../runtime/ai-runtime', () => {
  const actual = jest.requireActual('../runtime/ai-runtime')
  return {
    __esModule: true,
    ...actual,
    runAiRequest: async (input: { tools?: Array<{ name: string }> }) => {
      const tag = mockRunTag.getStore() ?? 'untagged'
      const release = mockSpendGuard()
      try {
        const result = await actual.runAiRequest(input)
        const tools = (input.tools ?? []).map((tool) => tool.name)
        mockCalls.push({
          tag,
          tools,
          answer: (result.toolUse ?? []).find((use: { name: string }) => tools.includes(use.name))?.input ?? null,
          stopReason: result.stopReason ?? null,
          usage: result.usage,
        })
        return result
      } finally {
        release()
      }
    },
  }
})

import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { AI_MEASURED_IMPORT_CREDITS, AI_MEASURED_PAID_SITE_CREDITS } from '../model/ai-credit-estimate'
import { AI_SITE_IMPORT_PAGE_CEILING_CREDITS, AI_SITE_IMPORT_PLAN_CEILING_CREDITS, aiSiteImportPlanIn, type AiSiteImportPage, type AiSiteImportPlan, type AiSiteImportState } from '../model/ai-site-import'
import { siteImportFidelity, type SiteImportFidelityTree } from '../model/ai-site-import-fidelity'
import { estimateAiBilledUsd } from '../providers/catalog'
import { aiLiveTimeoutMs } from '../runtime/ai-dev-env'
import { aiLiveRunLedger } from '../runtime/ai-dev-replay'
import { siteImportReplayDocument, siteImportReplayPlanState, type SiteImportReplayHome, type SiteImportReplayName } from '../site-import/fixtures/site-import-fidelity-replay'
import { assistCreditsFromUsd } from '../usage/assist-credits'
import { aiSiteImportDocumentFor, aiSiteImportMenuPageIds, aiSiteImportSiteLines } from './ai-job-import-step'
import { aiRunLayoutPage } from './ai-job-page-language'
import { aiImportPageModel, aiSiteImportSectionNames } from './ai-site-import-compile'
import { AI_LAYOUT_IMPORTED_SECTIONS_INPUT, type AiSiteImportDocument } from './ai-site-import-document'
import { aiSiteImportImproveLedger, aiSiteImportImproveDestinations, aiSiteImportImproveScope } from './ai-site-import-improve'
import { aiRunSiteImportPlan, aiSiteImportPlanScopeLines } from './ai-site-import-plan'

/** The run each request is asked for, kept across the awaits of pages run side by side. */
const mockRunTag = new AsyncLocalStorage<string>()

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])

/** The hard stop on what this round may spend at the provider's list rates. */
const HARD_CAP_USD = 5
const CAP_USD = Math.min(HARD_CAP_USD, Number(process.env['AGLYN_LIVE_AI_CAP_USD'] || HARD_CAP_USD))
const SPENT_USD = Number(process.env['AGLYN_LIVE_AI_SPENT_USD'] || '0')
/** What one request holds of the cap while it is in flight: well past what a page's answer measured. */
const IN_FLIGHT_USD = 0.1
/** What a credit came to at the provider, as the 11/5 run measured it. */
const PROVIDER_USD_PER_CREDIT = 0.00064

let mockInFlightUsd = 0

/** No request is sent once what the round spent and what is in flight would pass its cap. */
function mockSpendGuard(): () => void {
  const spent = SPENT_USD + aiLiveRunLedger().liveProviderUsd
  if (spent + mockInFlightUsd + IN_FLIGHT_USD > CAP_USD) {
    throw new Error(`the round's cap: $${spent.toFixed(4)} spent and $${mockInFlightUsd.toFixed(2)} in flight of $${CAP_USD.toFixed(2)}, so no further request is sent`)
  }
  mockInFlightUsd += IN_FLIGHT_USD
  return () => {
    mockInFlightUsd -= IN_FLIGHT_USD
  }
}

/** The sites of the round: four basic sites of one page each, and two recorded sites' pages. */
export const AI_SITE_IMPORT_IMPROVE_EVAL_SITES: Readonly<Record<string, { site: SiteImportReplayHome; pages: readonly SiteImportReplayName[]; name: string }>> = {
  'tax-firm': { site: 'tax-firm', pages: ['tax-firm'], name: 'Larkspur Tax Studio' },
  contractor: { site: 'contractor', pages: ['contractor'], name: 'A basic contractor' },
  salon: { site: 'salon', pages: ['salon'], name: 'A basic salon' },
  clinic: { site: 'clinic', pages: ['clinic'], name: 'A basic clinic' },
  aglyn: { site: 'home', pages: ['home', 'product', 'pricing'], name: 'Aglyn' },
  pottery: { site: 'pottery', pages: ['pottery'], name: 'Tidewater Pottery Studio' },
}

const SITES = process.env['AGLYN_LIVE_AI_SITES'] ? process.env['AGLYN_LIVE_AI_SITES'].split(',').map((name) => name.trim()) : Object.keys(AI_SITE_IMPORT_IMPROVE_EVAL_SITES)
const ANSWERS = Math.max(1, Math.floor(Number(process.env['AGLYN_LIVE_AI_ANSWERS'] || '3')))
const MODEL = process.env['AGLYN_LIVE_AI_MODEL'] || aiImportPageModel()

/** The command this round runs by: batch mode at half price, asked anew, under its cap. */
export const AI_SITE_IMPORT_IMPROVE_EVAL_COMMAND = [
  'AGLYN_LIVE_AI=1 AI_EVAL_LIVE=1 AI_EVAL_LIVE_LAUNCHER=tools/ai-eval/record-live.mjs AGLYN_LIVE_AI_BATCH=1',
  `AGLYN_AI_REPLAY=refresh AGLYN_LIVE_AI_CAP_USD=${HARD_CAP_USD}`,
  'node --env-file=.env node_modules/jest/bin/jest.js -c libs/plugins/ai/jest.config.ts',
  'libs/plugins/ai/src/lib/jobs/ai-site-import-improve-live.spec.ts',
].join(' ')

/** What a round is expected to cost, from the measured rows, at the provider and within its ceiling. */
export function aiSiteImportImproveEvalEstimate(input: { sites: readonly string[]; answers: number }): { requests: number; credits: { likely: number; p90: number; ceiling: number }; providerUsd: { likely: number; p90: number; ceiling: number; batched: number } } {
  const pages = input.sites.reduce((sum, site) => sum + (AI_SITE_IMPORT_IMPROVE_EVAL_SITES[site]?.pages.length ?? 0), 0)
  const plans = input.sites.length
  const answers = pages * input.answers
  const { reworded } = AI_MEASURED_IMPORT_CREDITS
  const { plan } = AI_MEASURED_PAID_SITE_CREDITS
  // A proposed page is one more redesign a site.
  const redesigns = answers + plans
  const credits = {
    likely: redesigns * reworded.median + plans * plan.median,
    p90: redesigns * reworded.p90 + plans * plan.p90,
    ceiling: redesigns * AI_SITE_IMPORT_PAGE_CEILING_CREDITS + plans * AI_SITE_IMPORT_PLAN_CEILING_CREDITS,
  }
  const usd = (value: number) => Math.round(value * PROVIDER_USD_PER_CREDIT * 100) / 100
  return { requests: redesigns + plans, credits, providerUsd: { likely: usd(credits.likely), p90: usd(credits.p90), ceiling: usd(credits.ceiling), batched: usd(credits.p90 / 2) } }
}

interface ImproveRun {
  site: string
  page: string
  answer: number
  status: string
  redesign: string | null
  added: string[]
  calls: number
  credits: number
  ledger: Record<string, boolean>
  design: Record<string, boolean>
  invented: string[]
  holds: boolean
  codes: string[]
  /** Whether its ledger folded: a page too long to show whole. */
  long: boolean
}

/**
 * A stored page as a person reads it beside the old page: each section with
 * its ground, each row with its columns, each group with how many items it
 * sets across, and the words in their roles. The first round's flat reading
 * hid its grids; this one shows them.
 */
function renderedLines(nodes: Record<string, { componentId?: string; props?: Record<string, unknown>; nodes?: string[] }>, rootId: string): string[] {
  const out: string[] = []
  const under = (id: string): string[] => (nodes[id]?.nodes ?? []).flatMap((child) => [child, ...under(child)])
  const walk = (id: string, depth: number) => {
    const node = nodes[id]
    if (!node) return
    const props = node.props ?? {}
    const indent = '  '.repeat(depth)
    const words = typeof props['children'] === 'string' ? props['children'] : typeof props['primary'] === 'string' ? props['primary'] : ''
    const children = node.nodes ?? []
    let deeper = depth
    if (node.componentId === 'section') {
      out.push(`${indent}[section${props['colorScheme'] ? ` ${String(props['colorScheme'])}` : ''}]`)
      deeper = depth + 1
    } else if (node.componentId === 'muiGrid' && (props['container'] === true || props['container'] === 'true')) {
      const cards = children.filter((child) => under(child).some((at) => nodes[at]?.componentId === 'muiCard')).length
      const sizes = children.map((child) => String(nodes[child]?.props?.['size'] ?? '').match(/md:(\d+)/)?.[1] ?? '12')
      out.push(`${indent}[${cards >= 2 ? `cards: ${children.length}, ${Math.round(12 / Number(sizes[0] || 12))} across` : `row ${sizes.join('/')}`}]`)
      deeper = depth + 1
    } else if (node.componentId === 'muiAccordion') {
      out.push(`${indent}[question]`)
      deeper = depth + 1
    } else if (node.componentId === 'image') out.push(`${indent}[picture: ${String(props['alt'] ?? '')}${props['src'] ? '' : ', a slot'}]`)
    else if (node.componentId === 'form') out.push(`${indent}[form]`)
    else if (node.componentId === 'video') out.push(`${indent}[film]`)
    else if (node.componentId === 'dataTable') out.push(`${indent}[table]`)
    else if (node.componentId === 'icon') out.push(`${indent}[icon]`)
    else if (node.componentId === 'muiButton') out.push(`${indent}[button ${String(props['variant'] ?? '')}: ${words} -> ${String(props['href'] ?? props['screenId'] ?? props['scrollTo'] ?? '')}]`)
    else if (words) out.push(`${indent}${String(props['variant'] ?? node.componentId)}: ${words}`)
    for (const child of children) walk(child, deeper)
  }
  walk(rootId, 0)
  return out
}

const sourceLines = (doc: AiSiteImportDocument): string[] => doc.blocks.map((block) => (block.kind === 'image' ? `[picture: ${block.alt}]` : `${block.kind}: ${block.text}`))

const OUT = process.env['AGLYN_LIVE_AI_OUT'] || join(tmpdir(), 'import-improve')

async function runPage(site: string, state: AiSiteImportState, plan: AiSiteImportPlan | null, doc: AiSiteImportDocument, name: string, answer: number): Promise<ImproveRun> {
  const tag = `${site}/${name}#${answer}`
  const names = aiSiteImportSectionNames(doc)
  const sectionIds = names.map((_, index) => `sec-${index}`)
  const home = name === AI_SITE_IMPORT_IMPROVE_EVAL_SITES[site]?.site
  const screen = { title: doc.title, slug: home ? '/' : `/${name}`, sections: names.map((section) => ({ name: section, uses: [] as string[], items: 0 })) }
  const forms = doc.blocks.length && (doc.forms?.length || doc.layout?.sections.some((section) => JSON.stringify(section.nodes).includes('"kind":"form"'))) ? [{ id: 'form-basic', name: 'Contact' }] : []
  const siteName = AI_SITE_IMPORT_IMPROVE_EVAL_SITES[site]?.name ?? state.siteName
  const inputs = { [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: doc, businessName: siteName, ...(plan ? { siteKind: plan.site.kind, siteStyle: { seed: 7, planned: { hero: plan.design.hero, group: plan.design.group, bandRhythm: plan.design.rhythm, coverClose: plan.design.cta === 'photo' } } } : { siteKind: 'business', siteStyle: { seed: 7 } }) }
  const job = { $id: `job-improve-${site}-${name}-${answer}`, brief: '', inputs }
  // What each answer missed, by its codes: a page that fell back says why.
  const missed = new Set<string>()
  const result = await mockRunTag.run(tag, () =>
    aiRunLayoutPage({
      job,
      plan: { create: [], screens: [screen], reuse: [], labels: {}, status: 'confirmed' } as never,
      screen: screen as never,
      sectionIds,
      targets: { pageId: 'p0', pages: [], homeIds: [], forms, formPageId: null, components: [], facts: '' } as never,
      context: { screenIds: doc.links.map((link) => link.id), formIds: forms.map((form) => form.id), componentIds: [], codeBuilt: true },
      reusableComponents: false,
      inventory: null,
      model: MODEL,
      observe: (check) => (raw) => {
        const checked = check(raw)
        for (const violation of checked.violations) missed.add(violation.code)
        return checked
      },
    }),
  )
  const calls = mockCalls.filter((call) => call.tag === tag)
  const run: ImproveRun = {
    site,
    page: name,
    answer,
    status: result.status,
    redesign: result.status === 'ok' ? (result.value.redesign?.status ?? null) : null,
    added: result.status === 'ok' ? (result.value.redesign?.added ?? []).map((section) => section.heading) : [],
    calls: calls.length,
    credits: assistCreditsFromUsd(estimateAiBilledUsd(result.usage, result.model)),
    ledger: {},
    design: {},
    invented: [],
    holds: false,
    codes: [...missed],
    long: aiSiteImportImproveLedger(doc).folded,
  }
  if (result.status !== 'ok') return run
  const nodes = result.value.nodes as unknown as Record<string, { componentId?: string; props?: Record<string, unknown>; nodes?: string[] }>
  const tree: SiteImportFidelityTree = { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: nodes as unknown as SiteImportFidelityTree['nodes'] }
  const ledger = aiSiteImportImproveLedger(doc)
  const destinations = aiSiteImportImproveDestinations(doc, ledger)
  const wanted = [...new Set(ledger.links.flatMap((link) => destinations.get(link.ref) ?? []))]
  const source = { layout: doc.layout as NonNullable<typeof doc.layout>, blocks: doc.blocks, photos: doc.photos }
  const scored = doc.layout || !doc.proposed ? siteImportFidelity(source, tree, { finish: 'improve', words: 'improved', improved: { scope: aiSiteImportImproveScope(doc, siteName), destinations: wanted, forms: forms.length, ...(doc.proposed ? { proposed: true } : {}) } }) : null
  const improved = scored?.improved
  if (improved) {
    run.ledger = Object.fromEntries(Object.entries(improved.ledger).map(([key, line]) => [key, line?.ok === true]))
    run.design = Object.fromEntries(Object.entries(improved.design).flatMap(([key, line]) => (line ? [[key, line.ok === true]] : [])))
    run.invented = improved.ledger.invented.found ?? []
    run.holds = improved.holds
  }
  mkdirSync(OUT, { recursive: true })
  writeFileSync(
    join(OUT, `${site}-${name}-${answer}.md`),
    [
      `# ${site}, ${name}, answer ${answer}: ${run.redesign}`,
      '',
      plan ? `Plan: ${plan.site.what} Menu: ${plan.nav.groups.map((group) => group.label).join(', ')}. Button: ${plan.nav.primaryCta?.label ?? '(none)'}.` : 'Plan: none, it did not pass.',
      `New sections: ${run.added.join(', ') || '(none)'}`,
      '',
      '## The old page',
      '',
      ...sourceLines(doc).map((line) => `- ${line}`),
      '',
      '## The new page',
      '',
      '```',
      ...renderedLines(nodes, CANVAS_ROOT_ELEMENT_ID),
      '```',
      '',
    ].join('\n'),
  )
  return run
}

/** The value at the share `q` of a sorted list, by nearest rank. */
function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] as number
}

async function runSite(site: string): Promise<{ plan: AiSiteImportPlan | null; planStatus: string; runs: ImproveRun[] }> {
  const fixture = AI_SITE_IMPORT_IMPROVE_EVAL_SITES[site]
  if (!fixture) throw new Error(`no site ${site}`)
  // No picture is made in a round: generated pictures are off by its own setting, whatever the default.
  const base = { ...siteImportReplayPlanState(fixture.site), siteName: fixture.name, generatedPictures: false }
  const required = aiSiteImportMenuPageIds(base)
  const scope = aiSiteImportPlanScopeLines(base, aiSiteImportSiteLines(base))
  const asked = await mockRunTag.run(`${site}/plan`, () => aiRunSiteImportPlan({ state: base, scope, required, roomForPage: true, model: MODEL }))
  const plan = asked.status === 'ok' ? asked.value : null
  const state = aiSiteImportPlanIn(base, { index: 1 }, plan, 'now', 'draft-new')
  const siteLines = aiSiteImportSiteLines(state)
  const runs: ImproveRun[] = []
  await Promise.all(
    fixture.pages.map(async (page) => {
      const read = siteImportReplayDocument(page)
      const doc: AiSiteImportDocument = { ...read, finish: 'improve', wording: 'improved', generative: true, siteLines, ...(plan ? { plan } : {}), ...(read.layout?.sections.some((section) => JSON.stringify(section.nodes).includes('"kind":"form"')) ? { forms: [{ index: 0, formId: 'form-basic' }] } : {}) }
      for (let answer = 1; answer <= ANSWERS; answer += 1) runs.push(await runPage(site, state, plan, doc, page, answer))
    }),
  )
  // The page its plan proposes, once: new to the site, and written from what it says.
  const proposed = state.pages.find((page): page is AiSiteImportPage => page.origin === 'proposed')
  const doc = proposed ? aiSiteImportDocumentFor(state, proposed) : null
  if (doc) runs.push(await runPage(site, state, plan, doc, proposed?.slug ?? 'new', 1))
  writeFileSync(
    join('tools', 'ai-eval', 'cases', 'page', `import-improve-${site}.json`),
    `${JSON.stringify({ id: `import-improve-${site}`, model: MODEL, planStatus: asked.status, plan, calls: mockCalls.filter((call) => call.tag.startsWith(`${site}/`)), runs }, null, 1)}\n`,
  )
  return { plan, planStatus: asked.status, runs }
}

describe('what a live round of a generative Improve it costs (AGL-4152)', () => {
  it('is under its hard cap at its ceiling, and says the command', () => {
    const estimate = aiSiteImportImproveEvalEstimate({ sites: SITES, answers: ANSWERS })
    console.log(JSON.stringify({ command: AI_SITE_IMPORT_IMPROVE_EVAL_COMMAND, estimate, capUsd: CAP_USD, live: LIVE }, null, 1))
    expect(estimate.providerUsd.ceiling).toBeLessThanOrEqual(HARD_CAP_USD)
    expect(CAP_USD).toBeLessThanOrEqual(HARD_CAP_USD)
  })

  it.each(Object.keys(AI_SITE_IMPORT_IMPROVE_EVAL_SITES))('reads %s as a plan would, with a menu to organize', (site) => {
    const fixture = AI_SITE_IMPORT_IMPROVE_EVAL_SITES[site] as (typeof AI_SITE_IMPORT_IMPROVE_EVAL_SITES)[string]
    const state = siteImportReplayPlanState(fixture.site)
    expect(state.pages.length).toBeGreaterThan(1)
    expect(aiSiteImportMenuPageIds(state).length).toBeGreaterThan(0)
    expect(state.pages[0]?.read?.blocks?.length).toBeGreaterThan(0)
  })
})

;(LIVE ? describe : describe.skip)('a generative Improve it, by the real model, on the eval’s sites (AGL-4152)', () => {
  jest.setTimeout(aiLiveTimeoutMs(45 * 60_000))

  // The run's ledger prints however the run ended: a run that threw before its table still spent what it counts.
  afterAll(() => {
    console.log(`run: ${JSON.stringify({ ...aiLiveRunLedger(), spentBefore: SPENT_USD, capUsd: CAP_USD })}`)
  })

  it(`plans ${SITES.length} sites and redesigns each page ${ANSWERS} times, holding the ledger, the facts and the design lines`, async () => {
    const done = await Promise.all(SITES.map(runSite))
    const runs = done.flatMap((entry) => entry.runs)
    const scored = runs.filter((run) => run.redesign === 'redesigned')
    const share = (test: (run: ImproveRun) => boolean) => scored.filter(test).length / Math.max(1, scored.length)
    const credits = scored.map((run) => run.credits)
    const whole = scored.filter((run) => !run.long).map((run) => run.credits)
    const summary = {
      runs: runs.length,
      plans: done.map((entry, at) => [SITES[at], entry.planStatus]),
      redesigned: scored.length,
      layoutKept: runs.filter((run) => run.redesign === 'layout-kept').length,
      inventedNone: share((run) => !run.invented.length),
      designGreen: share((run) => Object.values(run.design).every(Boolean)),
      creditsMedian: quantile(credits, 0.5),
      creditsP90: quantile(credits, 0.9),
      // A page short enough to show whole, and the most any page spent, its re-ask included.
      wholeP90: quantile(whole, 0.9),
      most: Math.max(0, ...runs.map((run) => run.credits)),
      newSections: share((run) => run.added.length > 0),
      row: AI_MEASURED_IMPORT_CREDITS.reworded,
      readBesideTheSource: OUT,
    }
    console.log(JSON.stringify({ run: aiLiveRunLedger(), summary, runs }, null, 1))

    expect(aiLiveRunLedger().live).toBeGreaterThan(0)
    // Every answer that kept its redesign holds its ledger whole.
    expect(scored.filter((run) => !['facts', 'held', 'links', 'meaning'].every((line) => run.ledger[line])).map((run) => [run.site, run.page, run.answer, run.ledger])).toEqual([])
    expect(summary.inventedNone).toBeGreaterThanOrEqual(0.9)
    expect(summary.designGreen).toBeGreaterThanOrEqual(0.8)
    // The ceiling holds per page, re-ask and fallback included; the row is quoted from pages shown whole.
    expect(summary.most).toBeLessThanOrEqual(AI_SITE_IMPORT_PAGE_CEILING_CREDITS)
    expect(summary.wholeP90).toBeLessThanOrEqual(AI_MEASURED_IMPORT_CREDITS.reworded.p90)
  })
})
