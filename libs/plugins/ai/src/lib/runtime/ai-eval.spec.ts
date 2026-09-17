/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { AI_STEP_TIERS } from '../providers/catalog'
import { AI_ROUTING_TABLE } from '../providers/routing'
import { aiDeviceAuditFindings, type AiDeviceAudit } from './ai-device-audit'
import {
  AI_EVAL_KINDS,
  aiEvalAnswerTree,
  aiEvalRendersAtDeviceWidths,
  readAiEvalCase,
  readAiEvalRecording,
  scoreAiEvalCandidate,
  scoreAiEvalControl,
  summarizeAiEval,
  summarizeAiEvalPlans,
  type AiEvalAudits,
  type AiEvalCase,
} from './ai-eval'

/**
 * The eval harness, offline (AGL-2937): every golden brief under
 * `tools/ai-eval/cases`, every answer scored, every kind held to its floor,
 * and every control made to fail the checks it names — a scorer that passes
 * everything would otherwise pass here too. `npm run test:ai-eval` runs this
 * file in CI; nothing here reaches a provider.
 *
 * A document a site renders is scored against its recorded device audit
 * (AGL-3020): `tools/scripts/record-ai-page-axe.mts` renders every readable
 * answer of such a kind at the besigner switcher's widths and writes what the
 * browser measured beside the cases, and beside the recordings of a live run.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const CASES_DIR = join(REPO_ROOT, 'tools', 'ai-eval', 'cases')
/** What a live run recorded (`npm run eval:ai-live`); none until one has run. */
const RECORDINGS_DIR = join(REPO_ROOT, 'tools', 'ai-eval', 'recordings')
/** The device audit of the cases' answers, and of a live run's where one has run. */
const WIDTHS_FILES = [
  join(REPO_ROOT, 'tools', 'ai-eval', 'widths.generated.json'),
  join(RECORDINGS_DIR, 'widths.generated.json'),
]

function caseFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? caseFiles(join(dir, entry.name))
      : entry.name.endsWith('.json')
        ? [join(dir, entry.name)]
        : [],
  )
}

const cases: AiEvalCase[] = caseFiles(CASES_DIR).map((file) => {
  const name = relative(REPO_ROOT, file)
  const evalCase = readAiEvalCase(JSON.parse(readFileSync(file, 'utf8')), name)
  // The folder names the kind, so a case filed under the wrong one is caught.
  expect([name, file.split('/').slice(-2, -1)[0]]).toEqual([name, evalCase.kind])
  return evalCase
})

// Each recording joins its brief's candidates, scored like any other answer.
for (const file of existsSync(RECORDINGS_DIR) ? caseFiles(RECORDINGS_DIR) : []) {
  // The recordings' device audit sits beside them, and is not one.
  if (basename(file) === 'widths.generated.json') continue
  const name = relative(REPO_ROOT, file)
  const recording = readAiEvalRecording(JSON.parse(readFileSync(file, 'utf8')), name)
  const evalCase = cases.find((entry) => entry.id === recording.caseId)
  if (!evalCase) throw new Error(`${name}: no golden brief has the id ${recording.caseId}`)
  evalCase.candidates.push(recording.candidate)
}

interface RecordedAnswer extends AiDeviceAudit {
  caseId: string
  of: string
  answer: string
}

const recordedAnswers: RecordedAnswer[] = WIDTHS_FILES.filter((file) => existsSync(file)).flatMap(
  (file) => (JSON.parse(readFileSync(file, 'utf8')) as { answers: RecordedAnswer[] }).answers,
)

/** The fingerprint the recorder writes for an answer, computed the same way it computes it. */
const fingerprint = (answer: unknown): string =>
  createHash('sha256').update(JSON.stringify(answer)).digest('hex').slice(0, 16)

const audits: AiEvalAudits = (evalCase, answer) =>
  recordedAnswers.find((entry) => entry.caseId === evalCase.id && entry.answer === fingerprint(answer)) ?? null

describe('the golden briefs', () => {
  it('hold at least one case for every kind, with unique ids', () => {
    expect(AI_EVAL_KINDS.filter((kind) => !cases.some((evalCase) => evalCase.kind === kind))).toEqual([])
    const ids = cases.map((evalCase) => evalCase.id)
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([])
  })
})

describe.each(cases.map((evalCase) => [evalCase.id, evalCase] as const))('%s', (_id, evalCase) => {
  it.each(evalCase.candidates.map((candidate, index) => [index, candidate] as const))(
    'candidate %i passes every check',
    (_index, candidate) => {
      const score = scoreAiEvalCandidate(evalCase, candidate, audits)
      expect({ pass: score.pass, checks: score.checks, findings: score.findings }).toEqual({
        pass: true,
        checks: {
          readable: (candidate.scope ?? 'full') === 'full' ? true : null,
          rules: (candidate.scope ?? 'full') === 'full' ? true : null,
          budget: (candidate.scope ?? 'full') === 'full' ? true : null,
          plan: evalCase.expected?.plan ? true : null,
          responsive: (candidate.scope ?? 'full') === 'full' && aiEvalRendersAtDeviceWidths(evalCase.kind) ? true : null,
          rubric: true,
        },
        findings: [],
      })
    },
  )

  it.each(evalCase.controls.map((control) => [control.why, control] as const))(
    'control fails: %s',
    (_why, control) => {
      const failed = scoreAiEvalControl(evalCase, control, audits)
      expect(control.fails.filter((check) => !failed.includes(check))).toEqual([])
    },
  )
})

describe('the floors', () => {
  it('holds every kind at or above its floor', () => {
    const summary = summarizeAiEval(
      cases.flatMap((evalCase) =>
        evalCase.candidates.map((candidate) => scoreAiEvalCandidate(evalCase, candidate, audits)),
      ),
    )
    expect(summary.filter((kind) => kind.belowFloor)).toEqual([])
  })

  it('holds a kind under its floor when one of its pages only works on desktop (AGL-3020)', () => {
    // The crew page with its quotes in a Stack that stays a row on a phone:
    // every check of the tree passes and the grade is the reference's own.
    const crew = cases.find((evalCase) => evalCase.id === 'page-meet-the-crew') as AiEvalCase
    const desktopOnly = crew.controls.find((control) => control.fails.includes('responsive'))
    expect(desktopOnly).toBeDefined()
    const [reference] = crew.candidates
    const candidate = { ...reference, answer: desktopOnly?.answer }
    const score = scoreAiEvalCandidate(crew, candidate, audits)
    expect(score.checks).toMatchObject({ readable: true, rules: true, budget: true, responsive: false })
    expect(score.findings).toEqual(['band-not-broken-down:words-row'])
    const pages = cases
      .filter((evalCase) => evalCase.kind === 'page')
      .flatMap((evalCase) => evalCase.candidates.map((entry) => scoreAiEvalCandidate(evalCase, entry, audits)))
    const floor = (scores: typeof pages) => summarizeAiEval(scores).find((kind) => kind.kind === 'page')?.belowFloor
    expect([floor(pages), floor([...pages, score])]).toEqual([false, true])
  })

  it('holds every plan a brief expects to its shape', () => {
    const plans = summarizeAiEvalPlans(
      cases.flatMap((evalCase) =>
        evalCase.candidates.map((candidate) => scoreAiEvalCandidate(evalCase, candidate, audits)),
      ),
    )
    expect(plans.plans).toBeGreaterThan(0)
    expect(plans.passRate).toBe(1)
  })
})

describe('the device audit of the answers a site renders (AGL-3020)', () => {
  it('has recorded every readable answer of a rendered kind, from the answer it holds now', () => {
    const unrecorded = cases
      .filter((evalCase) => aiEvalRendersAtDeviceWidths(evalCase.kind))
      .flatMap((evalCase) =>
        [
          ...evalCase.candidates.filter((candidate) => (candidate.scope ?? 'full') === 'full').map((candidate) => candidate.answer),
          ...evalCase.controls.map((control) => control.answer),
        ]
          .filter((answer) => aiEvalAnswerTree(evalCase, answer) !== null && !audits(evalCase, answer))
          .map(() => evalCase.id),
      )
    // Re-record with: node tools/scripts/record-ai-page-axe.mts
    expect(unrecorded).toEqual([])
  })

  it('records nothing the cases no longer hold', () => {
    const committed = JSON.parse(readFileSync(WIDTHS_FILES[0], 'utf8')) as { answers: RecordedAnswer[] }
    const stale = committed.answers.filter((entry) => {
      const evalCase = cases.find((candidate) => candidate.id === entry.caseId)
      const answers = evalCase ? [...evalCase.candidates.map((c) => c.answer), ...evalCase.controls.map((c) => c.answer)] : []
      return !answers.some((answer) => fingerprint(answer) === entry.answer)
    })
    expect(stale.map((entry) => `${entry.caseId} ${entry.of}`)).toEqual([])
  })

  it('fails a control on each thing it measures: a page wider than a phone, and a band that keeps its columns on one', () => {
    const findings = cases.flatMap((evalCase) =>
      evalCase.controls
        .filter((control) => control.fails.includes('responsive'))
        .flatMap((control) => aiDeviceAuditFindings(audits(evalCase, control.answer) ?? { devices: [], rows: [] })),
    )
    expect(findings.some((finding) => finding.startsWith('overflow:XS:'))).toBe(true)
    expect(findings.some((finding) => finding.startsWith('band-not-broken-down:'))).toBe(true)
  })
})

describe('the routing table (AGL-2937)', () => {
  const scores = cases.flatMap((evalCase) =>
    evalCase.candidates.map((candidate) => scoreAiEvalCandidate(evalCase, candidate, audits)),
  )

  it.each(Object.entries(AI_ROUTING_TABLE))(
    '%s carries the eval score its briefs hold, at or above the floor',
    (_step, row) => {
      const own = scores.filter((score) => row.eval.kinds.includes(score.kind))
      // A row's provenance is the provenance of the scores the row carries,
      // not of every candidate its kinds hold (AGL-3022). A live run that
      // records the plans a page is built from leaves `job.page` scoring the
      // authored references still, so the row goes on saying `authored`;
      // only `job.plan`, which scores those plans, turns over.
      const scored = own.filter((score) =>
        row.eval.scores === 'plans' ? score.checks.plan !== null : score.scope === 'full',
      )
      expect(row.eval.source).toBe(
        scored.some((score) => score.source === 'recorded') ? 'recorded' : 'authored',
      )
      if (row.eval.scores === 'plans') {
        const plans = summarizeAiEvalPlans(own)
        expect(plans.plans).toBeGreaterThan(0)
        expect({ passRate: plans.passRate, meanScore: null }).toEqual({
          passRate: row.eval.passRate,
          meanScore: row.eval.meanScore,
        })
        expect(row.eval.passRate).toBe(1)
        return
      }
      const answers = scored
      expect(answers.length).toBeGreaterThan(0)
      const passRate = answers.filter((score) => score.pass).length / answers.length
      const meanScore =
        Math.round((answers.reduce((sum, score) => sum + score.score, 0) / answers.length) * 10_000) / 10_000
      expect({ passRate, meanScore }).toEqual({ passRate: row.eval.passRate, meanScore: row.eval.meanScore })
      for (const kind of summarizeAiEval(answers).filter((entry) => row.eval.kinds.includes(entry.kind))) {
        expect([kind.kind, kind.belowFloor]).toEqual([kind.kind, false])
      }
    },
  )

  it.each(Object.entries(AI_ROUTING_TABLE))(
    '%s holds every reference answer under its ceiling, at three characters a token',
    (_step, row) => {
      for (const evalCase of cases.filter((entry) => row.eval.kinds.includes(entry.kind))) {
        for (const candidate of evalCase.candidates) {
          const written = row.eval.scores === 'plans' ? candidate.plan : candidate.answer
          if (written === null || written === undefined) continue
          const chars = typeof written === 'string' ? written.length : JSON.stringify(written).length
          expect({ id: evalCase.id, fits: Math.ceil(chars / 3) <= row.maxTokens }).toEqual({
            id: evalCase.id,
            fits: true,
          })
        }
      }
    },
  )

  it('asks no fast-tier step for thinking or effort, which that tier refuses', () => {
    for (const [step, row] of Object.entries(AI_ROUTING_TABLE)) {
      if (AI_STEP_TIERS[step as keyof typeof AI_STEP_TIERS] !== 'fast') continue
      expect([step, row.thinking, row.effort]).toEqual([step, null, null])
    }
  })
})
