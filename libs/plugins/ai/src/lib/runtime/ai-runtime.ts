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

import { aiModelCacheMinTokens } from '../providers/catalog'
import {
  AI_IMAGE_MAX_BYTES,
  AI_IMAGE_MEDIA_TYPES,
  AI_REQUEST_MAX_IMAGES,
  AiRequestShapeError,
  aiBase64Bytes,
  aiMessageImages,
  type AiMessage,
  type AiProvider,
  type AiRequestBase,
  type AiResult,
  type AiStreamEvent,
  type AiSystemBlock,
  type AiTool,
} from '../providers/contract'
import { resolveAiProvider, type AiPluginSettings } from '../providers/routing'

export {
  AI_UPSTREAM_FAILURE_COPY,
  AiRequestShapeError,
  AiUpstreamError,
  type AiCompletion,
  type AiEffort,
  type AiImagePart,
  type AiMessage,
  type AiMessagePart,
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
 *
 * The picture rule (AGL-2916) is enforced here too, and for the same reason:
 * a picture on an assistant turn, a picture for a model whose provider does
 * not say it reads one, or a picture past the bounds is refused before any
 * adapter is reached, so no door can send one a provider would reject.
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
 * Whether a provider's model reads a picture in a user turn (AGL-2916): what
 * the provider's own descriptor of the model says. A model the provider does
 * not describe reads none, so an adopter's provider is never sent a picture
 * it did not say it can take.
 */
export function aiModelReadsImages(provider: AiProvider, model: string): boolean {
  return provider
    .models()
    .some((descriptor) => descriptor.id === model && descriptor.capabilities.vision === true)
}

/**
 * Whether a model a door resolved reads pictures on the provider that would
 * serve the request: what a door asks before it attaches one, so a model that
 * does not is sent the text alone rather than refused.
 */
export function aiRouteReadsImages(model: string, settings?: AiPluginSettings): boolean {
  const provider = resolveAiProvider(settings)
  return provider ? aiModelReadsImages(provider, model) : false
}

/** A character standard base64 does not use, outside its padding. */
const NOT_BASE64 = /[^A-Za-z0-9+/]/

/**
 * Whether `data` is standard base64 and nothing else: its alphabet, then at
 * most two `=` of padding; no `data:` prefix, no line breaks.
 *
 * Scanned for a character outside the alphabet rather than matched whole: a
 * picture is megabytes of base64, and a whole-string pattern with a greedy
 * loop can exhaust the regular expression engine's backtrack stack on input
 * that large, which throws a RangeError instead of answering.
 */
function isBareBase64(data: string): boolean {
  const body = data.endsWith('==') ? data.slice(0, -2) : data.endsWith('=') ? data.slice(0, -1) : data
  return body.length > 0 && !NOT_BASE64.test(body)
}

/**
 * The picture guard (AGL-2916), applied to the messages before any adapter
 * sees them. A picture rides only a user turn, only to a model that reads
 * pictures, only in a format every such model takes, as bare base64 within
 * the size a provider accepts, and no more of them than a request may carry.
 * `readsImages` is asked only when a turn carries a picture. Exported so a
 * spec and a door can assert a request's shape without a provider.
 */
export function validateAiMessages(messages: readonly AiMessage[], readsImages: () => boolean): void {
  messages.forEach((message, index) => {
    if (typeof message.content === 'string') return
    if (!Array.isArray(message.content) || message.content.length === 0) {
      throw new AiRequestShapeError(`message ${index} has neither text nor parts`)
    }
    for (const part of message.content) {
      if (part.type === 'text') {
        if (typeof part.text !== 'string') {
          throw new AiRequestShapeError(`message ${index} has a text part with no text`)
        }
        continue
      }
      if (part.type !== 'image') {
        throw new AiRequestShapeError(`message ${index} has a part of an unknown type`)
      }
      if (message.role !== 'user') {
        throw new AiRequestShapeError(`message ${index} is an assistant turn and carries a picture`)
      }
      if (!(AI_IMAGE_MEDIA_TYPES as readonly string[]).includes(part.mediaType)) {
        throw new AiRequestShapeError(`message ${index} carries a picture of an unsupported type`)
      }
      if (typeof part.data !== 'string') {
        throw new AiRequestShapeError(`message ${index} carries a picture that is not bare base64`)
      }
      // The size first: it needs only the length, so an oversized picture is
      // refused without reading its bytes.
      if (aiBase64Bytes(part.data) > AI_IMAGE_MAX_BYTES) {
        throw new AiRequestShapeError(
          `message ${index} carries a picture over ${AI_IMAGE_MAX_BYTES} bytes`,
        )
      }
      if (!isBareBase64(part.data)) {
        throw new AiRequestShapeError(`message ${index} carries a picture that is not bare base64`)
      }
    }
  })
  const images = aiMessageImages(messages).length
  if (images > AI_REQUEST_MAX_IMAGES) {
    throw new AiRequestShapeError(`${images} pictures; a request carries at most ${AI_REQUEST_MAX_IMAGES}`)
  }
  if (images > 0 && !readsImages()) {
    throw new AiRequestShapeError('the request carries a picture and its model does not read pictures')
  }
}

/**
 * Characters to a token when a prompt is measured rather than tokenized
 * (AGL-2937). Four is the high end of English prose, so reading a prefix
 * through it errs LOW on the token count — and a prefix counts as cached
 * only when it clears its model's minimum even at that reading. Erring the
 * other way would let a prompt claim a cache it does not get.
 */
export const AI_CACHE_PREFIX_TOKEN_CHARS = 4

/**
 * The characters inside the cached span of a request: the tools, which a
 * provider renders ahead of the system blocks and which therefore sit in
 * every prefix, plus every system block up to and including the last
 * breakpoint. Zero when the request marks no breakpoint at all.
 */
export function aiCachedPrefixChars(
  system: readonly AiSystemBlock[],
  tools: readonly AiTool[] = [],
): number {
  const lastBreakpoint = system.reduce(
    (last, block, index) => (block.cacheBreakpoint ? index : last),
    -1,
  )
  if (lastBreakpoint < 0) return 0
  const toolChars = tools.reduce((total, tool) => total + JSON.stringify(tool).length, 0)
  return system
    .slice(0, lastBreakpoint + 1)
    .reduce((total, block) => total + block.text.length, toolChars)
}

/**
 * Whether this request's cached span is long enough for the model to cache
 * it at all (AGL-2937). A prefix under the model's `cacheMinTokens` is
 * served with the breakpoints honored and nothing cached — no error, and a
 * usage report that reads as a permanent miss — so a door designed around a
 * cache has to answer this question before it believes its own markers, and
 * `runtime/ai-prompt-cache.spec.ts` answers it for every door at once.
 */
export function aiCachedPrefixCaches(
  model: string,
  system: readonly AiSystemBlock[],
  tools: readonly AiTool[] = [],
): boolean {
  const chars = aiCachedPrefixChars(system, tools)
  return chars / AI_CACHE_PREFIX_TOKEN_CHARS >= aiModelCacheMinTokens(model)
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
  validateAiMessages(input.messages, () => aiModelReadsImages(provider, input.model))
  const { stream, settings: _settings, provider: _provider, ...request } = input
  const providerRequest = { ...request, apiKey }
  return stream ? provider.stream(providerRequest) : provider.complete(providerRequest)
}
