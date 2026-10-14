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
 * Which development layers this process runs (AGL-3660): the replay cache,
 * the hour-long prompt cache and batch mode, each read from the environment.
 * Kept apart from `ai-dev-replay.ts`, which reads and writes files, so the
 * runtime asks these questions on every request without loading a file
 * system module into a server that will never use one. Every answer is `off`
 * in a deployed server.
 */

import type { AiEffort } from '../providers/contract'

export type AiDevReplayMode = 'off' | 'replay' | 'refresh'

/** The variable that turns the replay cache on, off, or to refresh. */
export const AI_REPLAY_ENV = 'AGLYN_AI_REPLAY'
/** Where the answers are kept, when not under the repository's `.cache/ai-replay`. */
export const AI_REPLAY_DIR_ENV = 'AGLYN_AI_REPLAY_DIR'
/** The prompt-cache lifetime a development run asks for: `1h` or `5m`. */
export const AI_DEV_CACHE_TTL_ENV = 'AGLYN_AI_CACHE_TTL'
/** The mark the live-eval launcher leaves, which `jest.setup.js` also reads. */
export const AI_LIVE_LAUNCHER_ENV = 'AI_EVAL_LIVE_LAUNCHER'

export type AiDevEnv = Readonly<Record<string, string | undefined>>

/** Whether this process is a deployed server, where no development layer may run. */
export function aiIsDeployedRuntime(env: AiDevEnv = process.env): boolean {
  return (
    env['NODE_ENV'] === 'production' ||
    env['VERCEL_ENV'] === 'production' ||
    env['VERCEL_ENV'] === 'preview' ||
    Boolean(env['K_SERVICE'])
  )
}

/** The variable every live spec is started with. */
export const AI_LIVE_RUN_ENV = 'AGLYN_LIVE_AI'

/**
 * Whether this process is a development run that asked for the live
 * provider: through the launcher, or a live spec started with
 * `AGLYN_LIVE_AI=1` (AGL-3781). Every development layer is on by default in
 * such a run — a live spec started without the launcher's mark used to send
 * every request again, at the five-minute cache and full price — and each can
 * still be turned off by its own variable.
 */
export function aiUnderLiveRun(env: AiDevEnv = process.env): boolean {
  if (aiIsDeployedRuntime(env)) return false
  return Boolean(env[AI_LIVE_LAUNCHER_ENV]) || String(env[AI_LIVE_RUN_ENV] ?? '').trim() === '1'
}

/** The replay mode this process runs under; `off` in any deployed server. */
export function aiDevReplayMode(env: AiDevEnv = process.env): AiDevReplayMode {
  if (aiIsDeployedRuntime(env)) return 'off'
  const raw = String(env[AI_REPLAY_ENV] ?? '').trim().toLowerCase()
  if (raw === 'refresh') return 'refresh'
  if (raw === '1' || raw === 'on' || raw === 'true' || raw === 'replay') return 'replay'
  if (raw === '0' || raw === 'off' || raw === 'false') return 'off'
  return aiUnderLiveRun(env) ? 'replay' : 'off'
}

/**
 * The prompt-cache lifetime a development run asks for. An agent re-runs a
 * live eval every ten to forty minutes while it iterates, which is past the
 * default five-minute entry and inside an hour, so under the launcher the
 * breakpoints ask for the hour: the second run reads the prefix the first one
 * wrote instead of writing it again. Production keeps the default — its
 * steps run a minute apart on the beat, inside five minutes — and never reads
 * this: `undefined` there.
 */
export function aiDevCacheTtl(env: AiDevEnv = process.env): '1h' | undefined {
  if (aiIsDeployedRuntime(env)) return undefined
  const raw = String(env[AI_DEV_CACHE_TTL_ENV] ?? '').trim().toLowerCase()
  if (raw === '1h') return '1h'
  if (raw === '5m') return undefined
  return aiUnderLiveRun(env) ? '1h' : undefined
}

/** A deployed server that was handed the variable says so once, and runs without it. */
let warnedDeployed = false
export function aiWarnIfReplayAskedInDeployment(env: AiDevEnv = process.env): void {
  if (warnedDeployed || !aiIsDeployedRuntime(env)) return
  if (!env[AI_REPLAY_ENV] && !env[AI_DEV_CACHE_TTL_ENV]) return
  warnedDeployed = true
  console.error(
    `[ai] ${AI_REPLAY_ENV} / ${AI_DEV_CACHE_TTL_ENV} are development-only and are ignored in a deployed server`,
  )
}

/** The variable that turns batch mode on (`runtime/ai-live-batch.ts`). */
export const AI_LIVE_BATCH_ENV = 'AGLYN_LIVE_AI_BATCH'

/**
 * Whether this process batches its live requests: what `AGLYN_LIVE_AI_BATCH`
 * says, and in a live run that says nothing, yes (AGL-3781). Nobody waits on
 * an eval's answers, and a batch is half price on every token, cache reads
 * and writes included; `AGLYN_LIVE_AI_BATCH=0` is for the quick single run an
 * iteration wants back in seconds.
 */
export function aiLiveBatchWanted(env: AiDevEnv = process.env): boolean {
  if (aiIsDeployedRuntime(env)) return false
  const raw = String(env[AI_LIVE_BATCH_ENV] ?? '').trim()
  if (/^(?:1|true|yes|on)$/i.test(raw)) return true
  if (/^(?:0|false|no|off)$/i.test(raw)) return false
  return aiUnderLiveRun(env)
}

/**
 * The most a batched live run may take: the adapter waits up to an hour on
 * each batch, and a run's requests go as a few batches one after another —
 * the answers, their re-asks, the grades. A spec that timed out would keep
 * none of the answers it already paid for, so the bound is the worst case.
 */
export const AI_LIVE_BATCH_TIMEOUT_MS = 5 * 60 * 60_000

/** A live spec's timeout: `baseMs`, or the batched run's when this run batches. */
export function aiLiveTimeoutMs(baseMs: number, env: AiDevEnv = process.env): number {
  return aiLiveBatchWanted(env) ? Math.max(baseMs, AI_LIVE_BATCH_TIMEOUT_MS) : baseMs
}

/**
 * The variable an effort A/B names its arm with (AGL-3781): a step kind's
 * effort for this run, as `job.form:medium,job.text:low`, or `*:medium` for
 * every kind. A development run only, so the defaults stay where production
 * runs them until a recorded round shows a lower effort holds.
 */
export const AI_EFFORT_ARM_ENV = 'AGLYN_AI_EFFORT'

const AI_EFFORT_LEVELS: readonly AiEffort[] = ['low', 'medium', 'high']

/** The effort this development run's A/B arm asks `step` at, or `undefined` for the step's own. */
export function aiDevEffortFor(step: string | undefined, env: AiDevEnv = process.env): AiEffort | undefined {
  if (aiIsDeployedRuntime(env)) return undefined
  const raw = String(env[AI_EFFORT_ARM_ENV] ?? '').trim()
  if (!raw) return undefined
  let fallback: AiEffort | undefined
  for (const pair of raw.split(',')) {
    const [kind, level] = pair.split(':').map((part) => part.trim())
    if (!AI_EFFORT_LEVELS.includes(level as AiEffort)) continue
    if (kind === step) return level as AiEffort
    if (kind === '*') fallback = level as AiEffort
  }
  return fallback
}
