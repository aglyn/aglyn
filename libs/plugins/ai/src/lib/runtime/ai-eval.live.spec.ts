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
import { join } from 'node:path'
import { readAiEvalCase, type AiEvalCase } from './ai-eval'
import { aiEvalCasesNamed, aiEvalLiveAllowed, recordAiEvalLive } from './ai-eval-live'

/**
 * THE LIVE RUN (AGL-2937). Skipped unless `AI_EVAL_LIVE=1` names it — it asks
 * the provider for real answers and spends real money — and started by
 * `AI_EVAL_LIVE=1 npm run eval:ai-live`, never by CI. Each recording is
 * written under `tools/ai-eval/recordings/<kind>/`, where the offline
 * harness scores it beside the authored answers. `AI_EVAL_CASES` names the
 * briefs to record by id, so one brief can be recorded alone.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const CASES_DIR = join(REPO_ROOT, 'tools', 'ai-eval', 'cases')
const RECORDINGS_DIR = join(REPO_ROOT, 'tools', 'ai-eval', 'recordings')

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : entry.name.endsWith('.json') ? [join(dir, entry.name)] : [],
  )

const live = aiEvalLiveAllowed(process.env)

;(live ? describe : describe.skip)('the live eval run', () => {
  it(
    'records and grades an answer for every brief a recorder covers',
    async () => {
      const cases: AiEvalCase[] = aiEvalCasesNamed(
        files(CASES_DIR).map((file) => readAiEvalCase(JSON.parse(readFileSync(file, 'utf8')), file)),
        process.env,
      )
      const report = await recordAiEvalLive(cases, { env: process.env })
      for (const { caseId, kind, candidate } of report.recorded) {
        const dir = join(RECORDINGS_DIR, kind)
        mkdirSync(dir, { recursive: true })
        writeFileSync(
          join(dir, `${caseId}.${candidate.model ?? 'unknown'}.json`),
          `${JSON.stringify({ caseId, candidate }, null, 2)}\n`,
        )
      }
      console.log(
        `recorded ${report.recorded.length}; skipped ${report.skipped.length}: ${report.skipped
          .map((entry) => `${entry.caseId} (${entry.why})`)
          .join('; ')}`,
      )
      expect(report.recorded.length).toBeGreaterThan(0)
    },
    30 * 60_000,
  )
})
