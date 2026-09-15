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

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { AI_STEP_TIERS } from '../providers/catalog'
import { AI_ROUTING_TABLE } from '../providers/routing'
import {
  AI_EVAL_KINDS,
  readAiEvalCase,
  readAiEvalRecording,
  scoreAiEvalCandidate,
  scoreAiEvalControl,
  summarizeAiEval,
  summarizeAiEvalPlans,
  type AiEvalCase,
} from './ai-eval'

/**
 * The eval harness, offline (AGL-2937): every golden brief under
 * `tools/ai-eval/cases`, every answer scored, every kind held to its floor,
 * and every control made to fail the checks it names — a scorer that passes
 * everything would otherwise pass here too. `npm run test:ai-eval` runs this
 * file in CI; nothing here reaches a provider.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const CASES_DIR = join(REPO_ROOT, 'tools', 'ai-eval', 'cases')
/** What a live run recorded (`npm run eval:ai-live`); none until one has run. */
const RECORDINGS_DIR = join(REPO_ROOT, 'tools', 'ai-eval', 'recordings')

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
  const name = relative(REPO_ROOT, file)
  const recording = readAiEvalRecording(JSON.parse(readFileSync(file, 'utf8')), name)
  const evalCase = cases.find((entry) => entry.id === recording.caseId)
  if (!evalCase) throw new Error(`${name}: no golden brief has the id ${recording.caseId}`)
  evalCase.candidates.push(recording.candidate)
}

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
      const score = scoreAiEvalCandidate(evalCase, candidate)
      expect({ pass: score.pass, checks: score.checks, findings: score.findings }).toEqual({
        pass: true,
        checks: {
          readable: (candidate.scope ?? 'full') === 'full' ? true : null,
          rules: (candidate.scope ?? 'full') === 'full' ? true : null,
          budget: (candidate.scope ?? 'full') === 'full' ? true : null,
          plan: evalCase.expected?.plan ? true : null,
          rubric: true,
        },
        findings: [],
      })
    },
  )

  it.each(evalCase.controls.map((control) => [control.why, control] as const))(
    'control fails: %s',
    (_why, control) => {
      const failed = scoreAiEvalControl(evalCase, control)
      expect(control.fails.filter((check) => !failed.includes(check))).toEqual([])
    },
  )
})

describe('the floors', () => {
  it('holds every kind at or above its floor', () => {
    const summary = summarizeAiEval(
      cases.flatMap((evalCase) =>
        evalCase.candidates.map((candidate) => scoreAiEvalCandidate(evalCase, candidate)),
      ),
    )
    expect(summary.filter((kind) => kind.belowFloor)).toEqual([])
  })

  it('holds every plan a brief expects to its shape', () => {
    const plans = summarizeAiEvalPlans(
      cases.flatMap((evalCase) =>
        evalCase.candidates.map((candidate) => scoreAiEvalCandidate(evalCase, candidate)),
      ),
    )
    expect(plans.plans).toBeGreaterThan(0)
    expect(plans.passRate).toBe(1)
  })
})

describe('the routing table (AGL-2937)', () => {
  const scores = cases.flatMap((evalCase) =>
    evalCase.candidates.map((candidate) => scoreAiEvalCandidate(evalCase, candidate)),
  )

  it.each(Object.entries(AI_ROUTING_TABLE))(
    '%s carries the eval score its briefs hold, at or above the floor',
    (_step, row) => {
      const own = scores.filter((score) => row.eval.kinds.includes(score.kind))
      expect(row.eval.source).toBe(own.some((score) => score.source === 'recorded') ? 'recorded' : 'authored')
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
      const answers = own.filter((score) => score.scope === 'full')
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
