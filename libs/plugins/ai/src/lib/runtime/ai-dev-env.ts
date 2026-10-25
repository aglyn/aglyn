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
 * shared breakpoints ask for the hour (a job's own keep five minutes,
 * AGL-4050): the second run reads the prefix the first one wrote instead of
 * writing it again. A deployed server never reads this:
 * `undefined` there, where the lifetime is the route's own
 * (`aiRequestCacheTtl`).
 */
export function aiDevCacheTtl(env: AiDevEnv = process.env): '1h' | undefined {
  if (aiIsDeployedRuntime(env)) return undefined
  const raw = String(env[AI_DEV_CACHE_TTL_ENV] ?? '').trim().toLowerCase()
  if (raw === '1h') return '1h'
  if (raw === '5m') return undefined
  return aiUnderLiveRun(env) ? '1h' : undefined
}

/**
 * The lifetime a request goes out with: the one its door asked for, which a
 * site job's routes set to the hour through their routing rows (AGL-3830),
 * else this process's own. A deployed server sends what the door asked for
 * and nothing else. In development `AGLYN_AI_CACHE_TTL=5m` turns every
 * request back to five minutes, the route's hour included, for a one-off
 * sweep that will not run again within the hour (docs/AI_CACHE_AUDIT_2026-10.md,
 * lever 5).
 */
export function aiRequestCacheTtl(requested: '1h' | undefined, env: AiDevEnv = process.env): '1h' | undefined {
  if (aiIsDeployedRuntime(env)) return requested
  if (String(env[AI_DEV_CACHE_TTL_ENV] ?? '').trim().toLowerCase() === '5m') return undefined
  return requested ?? aiDevCacheTtl(env)
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

/** The variable that bounds how long a live run waits on one batch (AGL-3781). */
export const AI_LIVE_BATCH_WAIT_ENV = 'AGLYN_LIVE_AI_BATCH_WAIT_MS'

/** How long a batch is waited on when the run names no wait. */
export const AI_LIVE_BATCH_DEFAULT_WAIT_MS = 30 * 60_000

/**
 * How long a live run waits on one batch (AGL-3781): what
 * `AGLYN_LIVE_AI_BATCH_WAIT_MS` says, or half an hour. Most batches end in
 * minutes. One that has not by then is canceled, which keeps every answer it
 * already has, and the requests it left unanswered are asked on their own at
 * full price — so a slow batch costs a round part of its discount, never the
 * round.
 */
export function aiLiveBatchWaitMs(env: AiDevEnv = process.env): number {
  const raw = String(env[AI_LIVE_BATCH_WAIT_ENV] ?? '').trim()
  const parsed = raw ? Number(raw) : Number.NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : AI_LIVE_BATCH_DEFAULT_WAIT_MS
}

/**
 * The most a batched live run may take: a run's requests go as a few batches
 * one after another — the answers, their re-asks, the grades — and each is
 * waited on for `aiLiveBatchWaitMs`, then given time to end its cancel and to
 * have what it left asked on its own. A spec that timed out would keep none
 * of the answers it already paid for, so the bound is the worst case.
 */
export const AI_LIVE_BATCH_TIMEOUT_MS = 5 * 60 * 60_000

/** A live spec's timeout: `baseMs`, or the batched run's when this run batches. */
export function aiLiveTimeoutMs(baseMs: number, env: AiDevEnv = process.env): number {
  if (!aiLiveBatchWanted(env)) return baseMs
  // Four batches in a row, each waited on, canceled and finished by hand.
  const longWait = 4 * (aiLiveBatchWaitMs(env) + 20 * 60_000)
  return Math.max(baseMs, AI_LIVE_BATCH_TIMEOUT_MS, longWait)
}

/**
 * The variable an effort A/B names its arm with (AGL-3781): a step kind's
 * effort for this run, as `job.form:medium,job.text:low`, or `*:medium` for
 * every kind. A development run only, so the defaults stay where production
 * runs them until a recorded round shows a lower effort holds.
 */
export const AI_EFFORT_ARM_ENV = 'AGLYN_AI_EFFORT'

const AI_EFFORT_LEVELS: readonly AiEffort[] = ['low', 'medium', 'high']

/**
 * Every step kind this development run's A/B arm names, with its effort, in
 * kind order — `*` for every kind it does not name. A pair whose effort is no
 * level is ignored; a kind named twice keeps its first effort, and `*` its
 * last. Empty when the run names no arm, and in any deployed server.
 */
export function aiDevEffortArm(env: AiDevEnv = process.env): Record<string, AiEffort> {
  if (aiIsDeployedRuntime(env)) return {}
  const raw = String(env[AI_EFFORT_ARM_ENV] ?? '').trim()
  const arm: Record<string, AiEffort> = {}
  for (const pair of raw ? raw.split(',') : []) {
    const [kind, level] = pair.split(':').map((part) => part.trim())
    if (!kind || !AI_EFFORT_LEVELS.includes(level as AiEffort)) continue
    if (kind === '*' || !(kind in arm)) arm[kind] = level as AiEffort
  }
  return Object.fromEntries(Object.entries(arm).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** The effort this development run's A/B arm asks `step` at, or `undefined` for the step's own. */
export function aiDevEffortFor(step: string | undefined, env: AiDevEnv = process.env): AiEffort | undefined {
  const arm = aiDevEffortArm(env)
  return (step !== undefined && step !== '*' ? arm[step] : undefined) ?? arm['*']
}
