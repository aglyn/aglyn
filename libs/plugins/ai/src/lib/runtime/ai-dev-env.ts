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

/** Whether this process is a development run that asked for the live provider through the launcher. */
function underLiveLauncher(env: AiDevEnv): boolean {
  return Boolean(env[AI_LIVE_LAUNCHER_ENV])
}

/** The replay mode this process runs under; `off` in any deployed server. */
export function aiDevReplayMode(env: AiDevEnv = process.env): AiDevReplayMode {
  if (aiIsDeployedRuntime(env)) return 'off'
  const raw = String(env[AI_REPLAY_ENV] ?? '').trim().toLowerCase()
  if (raw === 'refresh') return 'refresh'
  if (raw === '1' || raw === 'on' || raw === 'true' || raw === 'replay') return 'replay'
  if (raw === '0' || raw === 'off' || raw === 'false') return 'off'
  return underLiveLauncher(env) ? 'replay' : 'off'
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
  return underLiveLauncher(env) ? '1h' : undefined
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

/** Whether this process batches its live requests. */
export function aiLiveBatchWanted(env: AiDevEnv = process.env): boolean {
  if (aiIsDeployedRuntime(env)) return false
  return /^(?:1|true|yes|on)$/i.test(String(env[AI_LIVE_BATCH_ENV] ?? '').trim())
}
