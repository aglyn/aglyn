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

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { estimateAiProviderCostUsd } from '../providers/catalog'
import type {
  AiProvider,
  AiProviderRequest,
  AiResult,
  AiStreamEvent,
  AiSystemBlock,
  AiTool,
} from '../providers/contract'
import { AI_REPLAY_DIR_ENV, aiDevReplayMode, type AiDevEnv as Env, type AiDevReplayMode } from './ai-dev-env'

/** The key format's version: bumped when what a key covers changes, so no old answer is read under a new meaning. */
const KEY_VERSION = 1

/**
 * THE DEVELOPMENT REPLAY CACHE (AGL-3660).
 *
 * Almost every dollar the provider bills in a month is a development run: a
 * live eval, the layout screenshots fed by one, a local guided start. Most of
 * the requests in a second run of the same eval are byte-identical to the
 * first — the change under test was to a compiler, a check or one prompt, not
 * to all of them — and each identical request bought the same sample twice.
 *
 * So, outside production only, the runtime keys each request by a hash of
 * everything that decides the answer — the provider, the model, the system
 * blocks, the tools, the messages, the ceiling, thinking and effort — and keeps
 * the provider's answer under `.cache/ai-replay/` (gitignored). The next
 * identical request is answered from disk for nothing; a request whose prompt
 * changed by one byte has a new key and goes to the provider. A replayed answer
 * is a real answer the same model gave to the same bytes, so an eval that
 * passes on replays has still seen every CHANGED prompt answered live: the
 * replay never stands in for a prompt the provider has not answered.
 *
 * `AGLYN_AI_REPLAY`:
 *  - `1` / `on`: replay what is recorded, record what is not.
 *  - `refresh`: every request live, its answer recorded over the old one.
 *  - `off` / `0`: nothing read, nothing written.
 *  - unset: on under the live-eval launcher (`AI_EVAL_LIVE_LAUNCHER`), off
 *    everywhere else, so a dev server or a spec that never asked for it
 *    behaves exactly as before.
 *
 * It never runs in a deployed server. `NODE_ENV=production`, `VERCEL_ENV`
 * of `production` or `preview`, or a Cloud Run service (`K_SERVICE`) turn it
 * off whatever the variable says, and the first request says so in the log:
 * a recorded answer handed to a customer would be another customer's page.
 *
 * Every live eval's table carries `aiDevReplayStats()`, so a run that was
 * all replays reads as one: `live: 0` is not a live pass.
 */

// ── The key ──────────────────────────────────────────────────────────────

/** JSON with every object's keys in sorted order: the same value, the same bytes, whatever built it. */
export function aiCanonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    )
  }
  return value
}

/** What a request's answer depends on. The key, the signal and the cache lifetime are not part of it. */
export interface AiReplayRequest {
  model: string
  system: readonly AiSystemBlock[]
  messages: AiProviderRequest['messages']
  tools?: readonly AiTool[]
  maxTokens: number
  thinking?: AiProviderRequest['thinking']
  effort?: AiProviderRequest['effort']
}

/** The request's replay key: a SHA-256 of everything that decides the answer. */
export function aiDevReplayKey(providerId: string, stream: boolean, request: AiReplayRequest): string {
  return createHash('sha256')
    .update(
      aiCanonicalJson({
        v: KEY_VERSION,
        provider: providerId,
        stream,
        model: request.model,
        // A breakpoint changes no answer, so the key reads the text alone.
        system: request.system.map((block) => block.text),
        tools: request.tools ?? [],
        messages: request.messages,
        maxTokens: request.maxTokens,
        thinking: request.thinking ?? null,
        effort: request.effort ?? null,
      }),
    )
    .digest('hex')
}

/**
 * The prefix a provider caches: the model, the tools and every system block
 * through the last breakpoint. Two requests with the same prefix key read one
 * cache entry; `null` when the request marks no breakpoint.
 */
export function aiCachedPrefixKey(request: Pick<AiReplayRequest, 'model' | 'system' | 'tools'>): string | null {
  const last = request.system.map((block) => Boolean(block.cacheBreakpoint)).lastIndexOf(true)
  if (last < 0) return null
  return createHash('sha256')
    .update(
      aiCanonicalJson({
        model: request.model,
        tools: request.tools ?? [],
        system: request.system.slice(0, last + 1).map((block) => block.text),
      }),
    )
    .digest('hex')
}

// ── The store ────────────────────────────────────────────────────────────

/** The repository root: the nearest directory up from here holding `nx.json`, else the working directory. */
function repositoryRoot(start: string = process.cwd()): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, 'nx.json'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return start
    dir = parent
  }
}

/** Where recorded answers are kept. */
export function aiDevReplayDir(env: Env = process.env): string {
  return env[AI_REPLAY_DIR_ENV] || join(repositoryRoot(), '.cache', 'ai-replay')
}

type Recording =
  | { v: number; key: string; model: string; recordedAt: string; kind: 'result'; result: AiResult }
  | { v: number; key: string; model: string; recordedAt: string; kind: 'stream'; events: AiStreamEvent[] }

function pathFor(dir: string, key: string): string {
  return join(dir, key.slice(0, 2), `${key}.json`)
}

function readRecording(dir: string, key: string): Recording | null {
  const path = pathFor(dir, key)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Recording
    return parsed?.v === KEY_VERSION && parsed.key === key ? parsed : null
  } catch {
    return null
  }
}

function writeRecording(dir: string, recording: Recording): void {
  const path = pathFor(dir, recording.key)
  mkdirSync(dirname(path), { recursive: true })
  // Written aside and renamed, so a run killed mid-write leaves no half file to replay.
  const temp = `${path}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(recording))
  renameSync(temp, path)
}

// ── What a run did ───────────────────────────────────────────────────────

/** How many of this process's requests were sent, and how many were answered from disk. */
export interface AiDevReplayStats {
  mode: AiDevReplayMode
  /** Requests sent to the provider. */
  live: number
  /** Requests answered from a recording. */
  replayed: number
  /** What the live requests cost at the provider's list rates. */
  liveProviderUsd: number
  /** What the replayed ones would have cost, had they been sent. */
  savedProviderUsd: number
}

const stats: AiDevReplayStats = {
  mode: 'off',
  live: 0,
  replayed: 0,
  liveProviderUsd: 0,
  savedProviderUsd: 0,
}

/** This process's count so far: what a live eval prints beside its table. */
export function aiDevReplayStats(env: Env = process.env): AiDevReplayStats {
  return {
    ...stats,
    mode: aiDevReplayMode(env),
    liveProviderUsd: round(stats.liveProviderUsd),
    savedProviderUsd: round(stats.savedProviderUsd),
  }
}

/** Starts the count again; a spec that runs two rounds reports each. */
export function resetAiDevReplayStats(): void {
  stats.live = 0
  stats.replayed = 0
  stats.liveProviderUsd = 0
  stats.savedProviderUsd = 0
}

function round(usd: number): number {
  return Math.round(usd * 1_000_000) / 1_000_000
}

function usageCost(usage: AiResult['usage'], model: string): number {
  return estimateAiProviderCostUsd(usage, model)
}

/** Counts one request a live path sent, at what the provider billed for it; `discount` is a batch's half. */
export function aiDevCountLive(usage: AiResult['usage'], model: string, discount = 1): void {
  stats.live += 1
  stats.liveProviderUsd += usageCost(usage, model) * discount
}

// ── The seam ─────────────────────────────────────────────────────────────

async function* replayEvents(events: readonly AiStreamEvent[]): AsyncGenerator<AiStreamEvent> {
  for (const event of events) yield event
}

/** A live stream passed through as it arrives, and recorded once it is done. */
async function* recordEvents(
  source: AsyncIterable<AiStreamEvent>,
  onDone: (events: AiStreamEvent[]) => void,
): AsyncGenerator<AiStreamEvent> {
  const events: AiStreamEvent[] = []
  let completed = false
  for await (const event of source) {
    events.push(event)
    if (event.type === 'done') completed = true
    yield event
  }
  // A stream cut short, or one that carried a provider error, is not an
  // answer worth keeping: the next run asks again.
  if (completed && !events.some((event) => event.type === 'error')) onDone(events)
}

/**
 * One request through the replay cache: answered from disk when recorded and
 * the mode replays, otherwise sent through `send` and recorded. `send` is the
 * live path — the provider, or the batch queue — and counts its own spend.
 */
export async function aiDevReplayComplete(
  provider: Pick<AiProvider, 'id'>,
  request: AiReplayRequest,
  mode: Exclude<AiDevReplayMode, 'off'>,
  send: () => Promise<AiResult>,
  env: Env = process.env,
): Promise<AiResult> {
  const dir = aiDevReplayDir(env)
  const key = aiDevReplayKey(provider.id, false, request)
  const recorded = mode === 'replay' ? readRecording(dir, key) : null
  if (recorded?.kind === 'result') {
    stats.replayed += 1
    stats.savedProviderUsd += usageCost(recorded.result.usage, request.model)
    return recorded.result
  }
  const result = await send()
  writeRecording(dir, {
    v: KEY_VERSION,
    key,
    model: request.model,
    recordedAt: new Date().toISOString(),
    kind: 'result',
    result,
  })
  return result
}

/** The streaming half of {@link aiDevReplayComplete}. */
export async function aiDevReplayStream(
  provider: Pick<AiProvider, 'id'>,
  request: AiReplayRequest,
  mode: Exclude<AiDevReplayMode, 'off'>,
  send: () => Promise<AsyncIterable<AiStreamEvent>>,
  env: Env = process.env,
): Promise<AsyncIterable<AiStreamEvent>> {
  const dir = aiDevReplayDir(env)
  const key = aiDevReplayKey(provider.id, true, request)
  const recorded = mode === 'replay' ? readRecording(dir, key) : null
  if (recorded?.kind === 'stream') {
    stats.replayed += 1
    const done = recorded.events.find((event) => event.type === 'done')
    if (done?.type === 'done') stats.savedProviderUsd += usageCost(done.usage, request.model)
    return replayEvents(recorded.events)
  }
  const live = await send()
  return recordEvents(live, (events) => {
    const done = events.find((event) => event.type === 'done')
    if (done?.type === 'done') aiDevCountLive(done.usage, request.model)
    writeRecording(dir, {
      v: KEY_VERSION,
      key,
      model: request.model,
      recordedAt: new Date().toISOString(),
      kind: 'stream',
      events,
    })
  })
}

// ── Warming a shared prefix before a fan-out ─────────────────────────────

/**
 * A cache entry is readable only once the request that writes it has started
 * answering, so N requests sent at once over one prefix all pay to write it
 * and none reads it — which is exactly what a live eval's `Promise.all` over
 * its briefs did. In a development run the first request over a prefix goes
 * alone; the others wait for it and then read what it wrote. A prefix
 * answered within the cache's lifetime is not held again.
 *
 * Development only, like everything here: production's beat runs one step at
 * a time, and holding a customer's request behind another's would trade
 * their seconds for our cents.
 */
const warming = new Map<string, Promise<unknown>>()
const warmedAt = new Map<string, number>()

export async function aiDevWarmPrefixFirst<T>(
  prefixKey: string | null,
  ttlMs: number,
  send: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  if (!prefixKey) return send()
  const warmed = warmedAt.get(prefixKey)
  if (warmed !== undefined && now() - warmed < ttlMs) return send()
  const pending = warming.get(prefixKey)
  if (pending) {
    await pending.catch(() => undefined)
    return send()
  }
  const first = send()
  warming.set(prefixKey, first)
  try {
    const result = await first
    warmedAt.set(prefixKey, now())
    return result
  } finally {
    warming.delete(prefixKey)
  }
}

/** Forgets every warmed prefix; for specs. */
export function resetAiDevWarmPrefixes(): void {
  warming.clear()
  warmedAt.clear()
}
