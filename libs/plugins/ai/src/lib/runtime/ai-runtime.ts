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

import {
  AiRequestShapeError,
  type AiProvider,
  type AiRequestBase,
  type AiResult,
  type AiStreamEvent,
  type AiSystemBlock,
} from '../providers/contract'
import { resolveAiProvider, type AiPluginSettings } from '../providers/routing'

export {
  AI_UPSTREAM_FAILURE_COPY,
  AiRequestShapeError,
  AiUpstreamError,
  type AiCompletion,
  type AiEffort,
  type AiMessage,
  type AiRefusal,
  type AiRequestBase,
  type AiResult,
  type AiStreamEvent,
  type AiSystemBlock,
  type AiThinking,
  type AiTool,
  type AiToolUse,
  type AiUsage,
} from '../providers/contract'

/**
 * The one runtime every AI door calls (AGL-2903), provider-generic since
 * AGL-2939.
 *
 * `/api/assist/chat` and `/api/ai/assist` each carried their own `fetch` to
 * one vendor, their own SSE parser and their own usage extraction, and a
 * third door would have been a third copy. This module owns the request
 * shape, the cache-prefix rule, the provider resolution and the error
 * boundary; an adapter owns one vendor's wire protocol; a door owns its
 * prompt, its gate ladder and its wire format.
 *
 * The cache-prefix rule (AGL-2352) is enforced HERE, before any adapter:
 * a block marked `volatile` may not sit at or before the last
 * `cacheBreakpoint`, and more breakpoints than any provider caches are
 * refused. A provider without a cache ignores the markers and keeps the
 * order, so a request that is right for the caching adapter is right for
 * every adapter.
 */

/** The most `cacheBreakpoint` markers a request may carry. */
export const AI_MAX_CACHE_BREAKPOINTS = 4

/**
 * The acceptable-use rules every generation prompt carries (AGL-2925).
 *
 * ONE constant, appended to each door's STATIC system text — inside the
 * cached prefix on the console chat, ahead of the mode prompt on the copy
 * assistant — so the rules the model is held to are the same at every
 * door and carry no per-org byte. The Free taste is what makes them worth
 * stating: a generated page that nobody paid for is the cheapest phishing
 * kit there is, and the model declining it is the first line, ahead of the
 * abuse-report route and the lockdown key.
 *
 * The categories are the platform's own Acceptable Use Policy, restated in
 * the second person for the model. A decline from the model's safety layer
 * arrives as a refusal, which the meter counts against the account's daily
 * pause and never against its credits.
 */
export const AI_ACCEPTABLE_USE_BLOCK = `Acceptable use — decline these rather than write them, and say briefly why:
- Pages, emails or copy that harvest credentials, payment details or personal data by deception (phishing, fake sign-in or checkout pages, fake "verify your account" notices).
- Impersonating a real business, brand, public body or person you were not told the user represents — their name, logo, sign-in page or voice — or copy that claims an endorsement, certification or partnership that was not given to you as a fact.
- Content that promotes or sells prohibited goods and services: weapons, illegal drugs, counterfeit goods, malware or deceptive downloads, unlicensed gambling, or adult content involving minors.
- Scams and fraud: fake investment or crypto schemes, advance-fee offers, tech-support scams, fake charities, deceptive "you have won" pages, or copy built to defraud.
- Harassment, threats, or hateful content targeting a person or a group.
- Spam farms: bulk near-duplicate pages or copy whose only purpose is to game search engines or send unsolicited mail.
When a brief is ordinary business content, write it well and do not lecture.`

/** A door's request, with the org's settings when the door knows the org. */
interface AiRuntimeOptions {
  /** The org's resolved `pluginSettings/ai`, for its provider and model choices. */
  settings?: AiPluginSettings
  /** A provider chosen by the caller, ahead of every setting; specs use it. */
  provider?: AiProvider
}

export interface AiRequest extends AiRequestBase, AiRuntimeOptions {
  stream: false
}

export interface AiStreamRequest extends AiRequestBase, AiRuntimeOptions {
  stream: true
}

/**
 * The cache guard, applied to the system blocks before any adapter sees
 * them. Exported so a spec and a door can assert a prompt's shape without
 * a provider.
 */
export function validateAiSystemBlocks(system: readonly AiSystemBlock[]): void {
  const breakpoints = system.filter((block) => block.cacheBreakpoint)
  if (breakpoints.length > AI_MAX_CACHE_BREAKPOINTS) {
    throw new AiRequestShapeError(
      `${breakpoints.length} cache breakpoints; at most ${AI_MAX_CACHE_BREAKPOINTS} are cached`,
    )
  }
  // Caching is a prefix match, so the LAST breakpoint decides what is
  // cached, and every block at or before it is inside the cached prefix. A
  // volatile block anywhere in that span — including one that is itself
  // the breakpoint — puts a per-request byte into the prefix (AGL-2352).
  const lastBreakpoint = system.reduce(
    (last, block, index) => (block.cacheBreakpoint ? index : last),
    -1,
  )
  system.forEach((block, index) => {
    if (block.volatile && index <= lastBreakpoint) {
      throw new AiRequestShapeError(
        `system block ${index} is volatile but sits inside the cached prefix (last breakpoint at block ${lastBreakpoint})`,
      )
    }
  })
}

/**
 * Whether a provider is configured to answer: registered, and its key
 * present. Every door asks this before it spends a reservation, and
 * answers 501 (or the docs fallback) when it is false.
 */
export function aiProviderReady(settings?: AiPluginSettings): boolean {
  return Boolean(resolveAiProvider(settings)?.readApiKey())
}

/** The provider that would answer, for a door that names it in its logs or its inventory. */
export function aiActiveProvider(settings?: AiPluginSettings): AiProvider | undefined {
  return resolveAiProvider(settings)
}

function providerFor(input: AiRuntimeOptions): { provider: AiProvider; apiKey: string } {
  const provider = input.provider ?? resolveAiProvider(input.settings)
  if (!provider) throw new Error('no AI provider is registered')
  const apiKey = provider.readApiKey()
  if (!apiKey) {
    // Every door gates on `aiProviderReady` before it gets here, so this is
    // a wiring fault rather than a customer path.
    throw new Error(`${provider.apiKeyEnv} is not set`)
  }
  return { provider, apiKey }
}

/**
 * Send one request through the resolved provider.
 *
 * Streaming: resolves once the provider has ACCEPTED the request — after
 * the headers, before the first token — with an iterator of simplified
 * events the caller wraps in its own wire format. A non-2xx answer rejects
 * with `AiUpstreamError` before the iterator exists, so a door can still
 * send a plain error status and hand back its reservation.
 *
 * Non-streaming: resolves with the parsed result, a decline typed as
 * `AiRefusal` rather than thrown.
 */
export async function runAiRequest(
  input: AiStreamRequest,
): Promise<AsyncIterable<AiStreamEvent>>
export async function runAiRequest(input: AiRequest): Promise<AiResult>
export async function runAiRequest(
  input: AiRequest | AiStreamRequest,
): Promise<AsyncIterable<AiStreamEvent> | AiResult> {
  validateAiSystemBlocks(input.system)
  const { provider, apiKey } = providerFor(input)
  const { stream, settings: _settings, provider: _provider, ...request } = input
  const providerRequest = { ...request, apiKey }
  return stream ? provider.stream(providerRequest) : provider.complete(providerRequest)
}
