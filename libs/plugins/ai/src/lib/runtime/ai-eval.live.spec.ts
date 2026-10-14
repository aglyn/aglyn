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

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { readAiEvalCase, scoreAiEvalCandidate, type AiEvalCase } from './ai-eval'
import {
  aiEvalCasesNamed,
  aiEvalEffortArm,
  aiEvalLiveAllowed,
  aiEvalRecordingBody,
  aiEvalRecordingFileName,
  aiEvalScoreLine,
  recordAiEvalLive,
} from './ai-eval-live'
import { aiLiveTimeoutMs } from './ai-dev-env'
import { aiLiveRunLedger } from './ai-dev-replay'
import { aiActiveProvider, aiProviderReady } from './ai-runtime'

/**
 * THE LIVE RUN (AGL-2937). Skipped unless `AI_EVAL_LIVE=1` names it — it asks
 * the provider for real answers and spends real money — and started by
 * `AI_EVAL_LIVE=1 npm run eval:ai-live`, never by CI. Each recording is
 * written under `tools/ai-eval/recordings/<kind>/`, where the offline
 * harness scores it beside the authored answers. `AI_EVAL_CASES` names the
 * briefs to record by id, so one brief can be recorded alone.
 *
 * THE CHEAP VERIFICATION LADDER (AGL-3660; docs/AI_JOBS.md, "Verifying a
 * prompt change"). Climb it in order and stop at the first rung that can
 * see the mistake:
 *
 *   1. unit tests — the step's own spec on golden answers, and
 *      `runtime/ai-prompt-cache.spec.ts` for the cached bytes: free;
 *   2. replay — this run again: under the launcher every request whose
 *      bytes were answered before is replayed from `.cache/ai-replay` for
 *      nothing, and only a CHANGED prompt goes to the provider;
 *   3. one live run per plan (Free, then `AGLYN_LIVE_AI_ORG_PLAN=business`)
 *      for the prompts you changed — read `run.live` in the table: 0 means
 *      nothing new was asked and the run proves nothing;
 *   4. the full live sweep, only before landing: `AGLYN_AI_REPLAY=refresh`
 *      asks every request again; the launcher sends the round as Message
 *      Batches at half price (minutes, not seconds) unless
 *      `AGLYN_LIVE_AI_BATCH=0` (AGL-3781).
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const CASES_DIR = join(REPO_ROOT, 'tools', 'ai-eval', 'cases')
const RECORDINGS_DIR = join(REPO_ROOT, 'tools', 'ai-eval', 'recordings')
/** The files a case's media names, such as a product's photo (AGL-3074). */
const FIXTURES_DIR = join(REPO_ROOT, 'tools', 'ai-eval', 'fixtures')

/** A fixture's bytes, read only from inside the fixtures folder. */
async function readFixture(file: string): Promise<Buffer> {
  const path = resolve(FIXTURES_DIR, file)
  if (!path.startsWith(`${FIXTURES_DIR}${sep}`)) throw new Error(`${file} is not a file under tools/ai-eval/fixtures`)
  return readFile(path)
}

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith('.json') ? [join(dir, entry.name)] : [],
  )

const live = aiEvalLiveAllowed(process.env)


;(live ? describe : describe.skip)('the live eval run', () => {
  // The run's ledger prints however the run ended (AGL-3781): a run that
  // threw before its table still spent what the ledger counts.
  afterAll(() => {
    console.log(`run: ${JSON.stringify(aiLiveRunLedger())}`)
  })

  it(
    'records and grades an answer for every brief a recorder covers',
    async () => {
      // A key removed before the run reads as "not set" at the first request,
      // which sends the operator looking for a key they did pass (AGL-3038).
      // Say what happened before anything is asked.
      if (!aiProviderReady()) {
        throw new Error(
          `No ${aiActiveProvider()?.apiKeyEnv ?? 'provider key'} reached this run. Start it with ` +
            '`AI_EVAL_LIVE=1 npm run eval:ai-live` and the key in the environment: the shared jest ' +
            'setup removes every value the repo-root .env also defines from a run that launcher did not start.',
        )
      }
      const cases: AiEvalCase[] = aiEvalCasesNamed(
        files(CASES_DIR).map((file) => readAiEvalCase(JSON.parse(readFileSync(file, 'utf8')), file)),
        process.env,
      )
      // An effort A/B arm (AGL-3781) records beside the defaults' answers, not
      // over them, under a short tag — the recording holds the arm's efforts —
      // and its score lines pair with the defaults' by brief, so two runs compare.
      const arm = aiEvalEffortArm(process.env)
      if (arm) console.log(`arm ${arm.tag}: ${JSON.stringify(arm.efforts)}`)
      const report = await recordAiEvalLive(cases, { env: process.env, readFixture })
      // One recording that cannot be written does not take the others with it.
      const unwritten: string[] = []
      for (const entry of report.recorded) {
        const { caseId, kind, candidate } = entry
        try {
          const dir = join(RECORDINGS_DIR, kind)
          mkdirSync(dir, { recursive: true })
          writeFileSync(
            join(dir, aiEvalRecordingFileName(caseId, candidate.model, arm)),
            aiEvalRecordingBody(caseId, candidate, arm),
          )
        } catch (error) {
          unwritten.push(`${caseId} (${kind}): ${error instanceof Error ? error.message : String(error)}`)
        }
        const evalCase = cases.find((brief) => brief.id === caseId)
        const score = evalCase ? scoreAiEvalCandidate(evalCase, candidate) : null
        console.log(aiEvalScoreLine(entry, score?.pass ?? null, arm))
      }
      // Live against replayed (AGL-3660): a recording whose request was
      // replayed is the answer an earlier run already got, not a new sample.
      // The ledger itself prints after the run, in `afterAll`.
      console.log(
        `recorded ${report.recorded.length}; skipped ${report.skipped.length}: ${report.skipped
          .map((entry) => `${entry.caseId} (${entry.why})`)
          .join('; ')}`,
      )
      // The recordings are already on disk by here (AGL-3143), so a brief the
      // provider refused costs this run only its own answer. What it threw is
      // named beside the case, so the failure can be read without the console
      // scrollback, and the suite fails so the run exits non-zero.
      if (report.failed.length) {
        console.error(
          `failed ${report.failed.length}:\n${report.failed
            .map(
              (entry) =>
                `  ${entry.caseId} (${entry.kind}) at ${entry.step}${
                  entry.requestId ? ` [request ${entry.requestId}]` : ''
                }: ${entry.error}`,
            )
            .join('\n')}`,
        )
      }
      if (unwritten.length) console.error(`unwritten ${unwritten.length}:\n  ${unwritten.join('\n  ')}`)
      expect(report.recorded.length).toBeGreaterThan(0)
      expect(report.failed).toEqual([])
      expect(unwritten).toEqual([])
    },
    aiLiveTimeoutMs(30 * 60_000),
  )
})
