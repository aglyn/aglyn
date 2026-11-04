/**
 * @jest-environment node
 *
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
 * Also improve my wording (AGL-4152, lane G), answered by the REAL model:
 * the eight recorded main pages of `site-import/fixtures/site-layout/`
 * brought in under Improve it with the switch on, each through the page
 * step's own design answer and wording answer — the real prompts, tools,
 * ceilings, re-ask and checks — three answers a page. No page is fetched:
 * each is a recording, read by the reader as a wave reads it.
 *
 * Every page is scored against its source with no model
 * (`siteImportFidelity`, `words: 'improved'`), and the run prints a table of
 * what the eval's bar holds (G7):
 *
 *  - `facts`, 1 on every answer: every price, number, date, contact and name
 *    as often as the source says it, and none of its own;
 *  - `invented`, the share of pages left with no invented fact after the
 *    re-ask (a line refused twice for one keeps its words): at least 0.9;
 *  - `meaning`, every reworded line at `SITE_IMPORT_MEANING_FLOOR` or more;
 *  - `copy`, no filler, placeholder or judgment word kept;
 *  - `credits`, each page's design and wording together, whose p90 must be
 *    within the AI page row's (`AI_MEASURED_IMPORT_CREDITS.page.p90`).
 *
 * `AGLYN_LIVE_AI_OUT=<dir>` writes each page's reworded lines beside their
 * source, one Markdown file a page and answer, for a person to read three of
 * them beside their source and say whether they read better.
 *
 * It calls the provider and costs real money (about $0.65 a run of three
 * answers, at list rates), so it runs only when asked: `AGLYN_LIVE_AI=1`
 * with `ANTHROPIC_API_KEY` set, the live launcher's mark so `jest.setup.js`
 * keeps the key read from `.env`, and `AGLYN_AI_REPLAY=refresh` so each of a
 * page's three answers is asked anew rather than replayed from the first:
 *
 *   AGLYN_LIVE_AI=1 AI_EVAL_LIVE=1 AI_EVAL_LIVE_LAUNCHER=tools/ai-eval/record-live.mjs \
 *     AGLYN_AI_REPLAY=refresh AGLYN_LIVE_AI_CAP_USD=0.90 \
 *     node --env-file=.env node_modules/jest/bin/jest.js -c libs/plugins/ai/jest.config.ts \
 *     libs/plugins/ai/src/lib/jobs/ai-site-import-wording-live.spec.ts
 *
 * `AGLYN_LIVE_AI_ANSWERS` sets the answers a page (3); `AGLYN_LIVE_AI_PAGES`
 * names the pages to run, comma-separated; `AGLYN_LIVE_AI_MODEL` names
 * another catalog model.
 *
 * THE CAP: `AGLYN_LIVE_AI_CAP_USD` (default 0.90) is the most the run may
 * spend at the provider's list rates, and `AGLYN_LIVE_AI_SPENT_USD` is what
 * the round's earlier runs already spent (the design eval's
 * `run.liveProviderUsd`, say). No request is sent once the two together come
 * within {@link IN_FLIGHT_MARGIN_USD} of the cap.
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
      mockSpendGuard()
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
    },
  }
})

import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import { AI_MEASURED_IMPORT_CREDITS } from '../model/ai-credit-estimate'
import { SITE_IMPORT_MEANING_FLOOR, siteImportFidelity, siteImportFidelityHolds, type SiteImportFidelityTree } from '../model/ai-site-import-fidelity'
import { aiLiveTimeoutMs } from '../runtime/ai-dev-env'
import { aiLiveRunLedger } from '../runtime/ai-dev-replay'
import { siteImportReplayDocument } from '../site-import/fixtures/site-import-fidelity-replay'
import type { SiteLayoutPageName } from '../site-import/fixtures/site-layout-recordings'
import { estimateAiBilledUsd } from '../providers/catalog'
import { assistCreditsFromUsd } from '../usage/assist-credits'
import { aiRunLayoutPage, aiSiteImportWordingMaxTokens } from './ai-job-page-language'
import { aiImportPageModel, aiSiteImportSectionNames } from './ai-site-import-compile'
import { AI_LAYOUT_IMPORTED_SECTIONS_INPUT, type AiSiteImportDocument } from './ai-site-import-document'
import { AI_SITE_IMPORT_WORDING_TOOL, aiReadWordingAnswer, aiSiteImportWordingHolds, aiSiteImportWordingPage } from './ai-site-import-wording'

/** The run each request is asked for, kept across the awaits of pages run side by side. */
const mockRunTag = new AsyncLocalStorage<string>()

const LIVE = process.env['AGLYN_LIVE_AI'] === '1' && Boolean(process.env['ANTHROPIC_API_KEY'])

/** The most the run may spend, at the provider's list rates. */
const CAP_USD = Number(process.env['AGLYN_LIVE_AI_CAP_USD'] || '0.9')
/** What the round's earlier runs already spent. */
const SPENT_USD = Number(process.env['AGLYN_LIVE_AI_SPENT_USD'] || '0')
/** Room under the cap for the requests already asked when the guard closes. */
const IN_FLIGHT_MARGIN_USD = 0.12

/** No request is sent once what the round spent comes within the margin of its cap. */
function mockSpendGuard(): void {
  const spent = SPENT_USD + aiLiveRunLedger().liveProviderUsd
  if (spent + IN_FLIGHT_MARGIN_USD > CAP_USD) {
    throw new Error(`the round's cap: $${spent.toFixed(4)} spent of $${CAP_USD.toFixed(2)}, so no further request is sent`)
  }
}

/** The recorded main pages: every recording but the blog post, which an import copies as it is. */
const MAIN_PAGES: readonly SiteLayoutPageName[] = ['home', 'product', 'pricing', 'livePricing', 'contact', 'blog', 'pottery', 'bakery']
const PAGES = (process.env['AGLYN_LIVE_AI_PAGES'] ? process.env['AGLYN_LIVE_AI_PAGES'].split(',').map((name) => name.trim()) : MAIN_PAGES) as SiteLayoutPageName[]
const ANSWERS = Math.max(1, Math.floor(Number(process.env['AGLYN_LIVE_AI_ANSWERS'] || '3')))
const MODEL = process.env['AGLYN_LIVE_AI_MODEL'] || aiImportPageModel()

/** The site's own name, which the wording answer is told and every rewrite holds, as each recording's title names it. */
const siteNameOf = (name: SiteLayoutPageName): string => (name === 'pottery' ? 'Tidewater Pottery Studio' : name === 'bakery' ? 'Hearth & Crumb Bakery' : 'Aglyn')

interface WordingRun {
  page: SiteLayoutPageName
  answer: number
  status: string
  words: string | null
  calls: number
  wordingCalls: number
  outputTokens: number
  credits: number
  offered: number
  /** The lines the first wording answer rewrote, and the codes its refused ones broke. */
  firstAnswer: { lines: number; refused: string[] }
  /** The lines refused twice, which kept their words, by the code they broke. */
  kept: string[]
  fidelity: { facts: number | null; lines: number | null; meaningBelow: number; meaningLowest: number | null; reworded: number; holds: boolean; score: number } | null
  stopReasons: Array<string | null>
}

const textOf = (doc: AiSiteImportDocument, line: number): string => {
  const block = doc.blocks[line]
  return block && block.kind !== 'image' ? block.text.replace(/\s+/g, ' ').trim() : ''
}

async function runOne(page: SiteLayoutPageName, answer: number): Promise<WordingRun> {
  const tag = `${page}#${answer}`
  const source = siteImportReplayDocument(page)
  const doc: AiSiteImportDocument = { ...source, finish: 'improve', wording: 'improved' }
  const names = aiSiteImportSectionNames(doc)
  const sectionIds = names.map((_, index) => `sec-${index}`)
  const screen = { title: doc.title, slug: page === 'home' || page === 'pottery' || page === 'bakery' ? '/' : `/${page}`, sections: names.map((section) => ({ name: section, uses: [] as string[], items: 0 })) }
  const siteName = siteNameOf(page)
  const forms = page === 'contact' ? [{ id: 'form-contact', name: 'Contact' }] : []
  const result = await mockRunTag.run(tag, () =>
    aiRunLayoutPage({
      // A job of its own each answer, so each design answer is asked for a seed of its own.
      job: { $id: `job-wording-${page}-${answer}`, brief: '', inputs: { [AI_LAYOUT_IMPORTED_SECTIONS_INPUT]: doc, businessName: siteName } },
      plan: { create: [], screens: [screen], reuse: [], labels: {}, status: 'confirmed' } as never,
      screen: screen as never,
      sectionIds,
      // A page with a form places the site's saved one, as the import rebuilds it first (AGL-4152).
      targets: { pageId: 'p0', pages: [], homeIds: [], forms, formPageId: null, components: [], facts: '' } as never,
      context: { screenIds: doc.links.map((link) => link.id), formIds: forms.map((form) => form.id), componentIds: [], codeBuilt: true },
      reusableComponents: false,
      inventory: null,
      model: MODEL,
    }),
  )
  const calls = mockCalls.filter((call) => call.tag === tag)
  const wordingCalls = calls.filter((call) => call.tools.includes(AI_SITE_IMPORT_WORDING_TOOL.name))
  // The lines the page step offered: as many as its answer's ceiling on this model holds.
  const wordingPage = aiSiteImportWordingPage(doc, { maxTokens: aiSiteImportWordingMaxTokens(MODEL) })
  const first = aiReadWordingAnswer((wordingCalls[0]?.answer ?? null) as Record<string, unknown> | null) ?? []
  const firstHeld = aiSiteImportWordingHolds({ doc, page: wordingPage, siteName }, first)
  const run: WordingRun = {
    page,
    answer,
    status: result.status,
    words: result.status === 'ok' ? (result.value.words ?? null) : null,
    calls: calls.length,
    wordingCalls: wordingCalls.length,
    outputTokens: calls.reduce((sum, call) => sum + Number(call.usage['outputTokens'] ?? 0), 0),
    // At the billed rates on what the page used, as the meter draws it: a batch's half price is the run's, never a customer's.
    credits: assistCreditsFromUsd(estimateAiBilledUsd(result.usage, result.model)),
    offered: wordingPage.lines.length,
    firstAnswer: { lines: first.length, refused: firstHeld.refused.map((refusal) => refusal.code) },
    kept: result.status === 'ok' ? result.value.settled.filter((entry) => entry.what.startsWith('kept as written')).map((entry) => entry.what.replace(/^.*: /, '')) : [],
    fidelity: null,
    stopReasons: calls.map((call) => call.stopReason),
  }
  if (result.status !== 'ok') return run
  const tree: SiteImportFidelityTree = { rootId: CANVAS_ROOT_ELEMENT_ID, nodes: result.value.nodes as unknown as SiteImportFidelityTree['nodes'] }
  // Scored as improved words whether or not its rewrite was kept: a page that kept its words keeps every fact and line too.
  const report = siteImportFidelity({ layout: source.layout as NonNullable<typeof source.layout>, blocks: source.blocks, photos: source.photos }, tree, { finish: 'improve', words: 'improved' })
  run.fidelity = {
    facts: report.facts?.ratio ?? null,
    lines: report.lines?.ratio ?? null,
    meaningBelow: report.meaning?.below ?? 0,
    meaningLowest: report.meaning?.lowest ?? null,
    reworded: report.meaning?.lines ?? 0,
    holds: siteImportFidelityHolds(report),
    score: report.score,
  }
  const out = process.env['AGLYN_LIVE_AI_OUT']
  if (out) {
    // Each reworded line beside its source, as the page kept it: the latest of its answers that held.
    const held = new Map<number, string>()
    for (const call of wordingCalls) {
      const answered = aiReadWordingAnswer(call.answer as Record<string, unknown> | null) ?? []
      for (const [line, text] of aiSiteImportWordingHolds({ doc, page: wordingPage, siteName }, answered).held) held.set(line, text)
    }
    const lines = [...held].map(([line, text]) => `- **${line}** ${textOf(doc, line)}\n  → ${text}`)
    mkdirSync(out, { recursive: true })
    writeFileSync(join(out, `${page}-${answer}.md`), [`# ${page}, answer ${answer}: ${run.words}`, '', ...lines, ''].join('\n'))
  }
  return run
}

/** The value at the share `q` of a sorted list, by nearest rank. */
function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] as number
}

const describeLive = LIVE ? describe : describe.skip

describeLive('Also improve my wording, by the real model, on the recorded main pages (AGL-4152)', () => {
  jest.setTimeout(aiLiveTimeoutMs(20 * 60_000))

  // The run's ledger prints however the run ended: a run that threw before its table still spent what it counts.
  afterAll(() => {
    console.log(`run: ${JSON.stringify({ ...aiLiveRunLedger(), spentBefore: SPENT_USD, capUsd: CAP_USD })}`)
  })

  it(`rewords ${PAGES.length} pages ${ANSWERS} times each: every fact kept, the meaning held, within the page row`, async () => {
    const runs: WordingRun[] = []
    // The pages side by side, each page's answers one after another so each is asked anew.
    await Promise.all(
      PAGES.map(async (page) => {
        for (let answer = 1; answer <= ANSWERS; answer += 1) runs.push(await runOne(page, answer))
      }),
    )
    runs.sort((a, b) => PAGES.indexOf(a.page) - PAGES.indexOf(b.page) || a.answer - b.answer)
    const credits = runs.map((run) => run.credits)
    const summary = {
      runs: runs.length,
      reworded: runs.filter((run) => run.words === 'improved').length,
      invented: runs.filter((run) => !run.kept.includes('wording-invented-fact')).length / Math.max(1, runs.length),
      firstAnswerInvented: runs.filter((run) => run.firstAnswer.refused.includes('wording-invented-fact')).length,
      creditsMedian: quantile(credits, 0.5),
      creditsP90: quantile(credits, 0.9),
      pageRow: AI_MEASURED_IMPORT_CREDITS.page,
    }
    // The whole table, every run, so a red run shows every page's outcome.
    console.log(JSON.stringify({ run: aiLiveRunLedger(), summary, runs }, null, 1))

    expect(aiLiveRunLedger().live).toBeGreaterThan(0)
    // Every page built, its words improved or kept, never a page lost.
    expect(runs.filter((run) => run.status !== 'ok').map((run) => [run.page, run.answer, run.status])).toEqual([])
    // Facts at 1 on every answer, every line placed once, every reworded line's meaning at the floor.
    expect(runs.filter((run) => run.fidelity?.facts !== 1 || run.fidelity?.lines !== 1).map((run) => [run.page, run.answer, run.fidelity])).toEqual([])
    expect(runs.filter((run) => (run.fidelity?.meaningBelow ?? 0) > 0).map((run) => [run.page, run.answer, run.fidelity?.meaningLowest])).toEqual([])
    expect(runs.every((run) => (run.fidelity?.meaningLowest ?? 1) >= SITE_IMPORT_MEANING_FLOOR)).toBe(true)
    // No invented fact left after the re-ask on nine pages in ten, and no filler, placeholder or judgment word kept.
    expect(summary.invented).toBeGreaterThanOrEqual(0.9)
    expect(runs.filter((run) => run.kept.includes('wording-copy')).map((run) => [run.page, run.answer])).toEqual([])
    // Design and wording together within the AI page row a reworded page is quoted on.
    expect(summary.creditsP90).toBeLessThanOrEqual(AI_MEASURED_IMPORT_CREDITS.page.p90)
  })
})
