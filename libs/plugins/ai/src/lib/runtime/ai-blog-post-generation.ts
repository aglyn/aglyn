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

import type { AiStepKind } from '../providers/catalog'
import type { AiProvider } from '../providers/contract'
import { AI_ROUTING_TABLE, type AiPluginSettings } from '../providers/routing'
import {
  AI_BLOG_POST_LIMITS,
  AI_BLOG_POST_TOOL,
  AI_BLOG_POST_TOOL_NAME,
  checkAiBlogPost,
  type AiBlogPost,
} from '../tools/ai-blog-post-tool'
import { runValidatedGeneration, type AiValidatedGeneration } from './ai-doctrine'
import type { AiSystemBlock } from './ai-runtime'

/**
 * A SITE'S FIRST POSTS (AGL-3676): one post a generation, through the
 * doctrine's generation call and the strict `write_blog_post` tool.
 *
 * Routed as `copy.blog`, the row the entry editor's own "write this post"
 * already asks — its ceiling is one post body in markdown-lite, which is
 * what one pass writes. The rules are cached and byte-identical; the site's
 * words, the posts already written and which post this is ride in the user
 * turn, so no byte of a site sits in the cached prefix.
 */

/** The step a post is routed as. */
export const AI_BLOG_POST_STEP: AiStepKind = 'copy.blog'

/** One post's answer ceiling: the routing row's. */
export const AI_BLOG_POST_MAX_TOKENS = AI_ROUTING_TABLE[AI_BLOG_POST_STEP].maxTokens

/** The generation kind a post is asked under, which the doctrine scopes. */
export const AI_BLOG_POST_KIND = 'blog-post'

/** The rules for one post. Byte-identical on every request. */
export const AI_BLOG_POST_INSTRUCTIONS: AiSystemBlock[] = [
  {
    text:
      'You write one of the first posts of a new blog, published as the site’s own words the day the site goes live.\n\n' +
      `Answer by calling ${AI_BLOG_POST_TOOL_NAME} exactly once. A reply in prose cannot be used.\n\n` +
      'Rules:\n' +
      [
        'Write about the subject the brief gives, for the readers it names: advice, an explanation, or how the writer approaches it — useful on its own, in general terms where the brief gives no specifics.',
        'Never invent a fact about the writer or the business: no name, date, place, number, price, rating, review, testimonial, client, award or credential the brief does not give. Say less rather than make one up.',
        'Never say anything cures, treats, heals or prevents anything, and never promise a health, financial or legal result.',
        `The body is markdown-lite of ${AI_BLOG_POST_LIMITS.bodyMin} to ${AI_BLOG_POST_LIMITS.bodyMax} characters: short paragraphs, ## subheadings, - lists and **bold**. No title line, since the title renders on its own; no links, images, HTML, emoji or square brackets.`,
        `The title is plain and specific, at most ${AI_BLOG_POST_LIMITS.titleMax} characters, and about something no post already written covers.`,
        `The excerpt says in one or two sentences what the post covers, at most ${AI_BLOG_POST_LIMITS.excerptMax} characters; the search description says it in one.`,
        'Write in the voice the brief asks for, in the language of the brief.',
      ]
        .map((rule) => `- ${rule}`)
        .join('\n'),
    cacheBreakpoint: true,
  },
]

export interface AiBlogPostPromptInput {
  /** The site's words: the brief and its answers, as a unit's brief carries them. */
  brief: string
  /** The titles of the posts already written for this blog. */
  earlierTitles: readonly string[]
  /** Which post this is, from 1, of how many. */
  index: number
  total: number
}

/** The user turn: the site's words, the posts already written, and which post this is. */
export function aiBlogPostPrompt(input: AiBlogPostPromptInput): string {
  return [
    'Brief:',
    input.brief.trim(),
    `Posts already written: ${input.earlierTitles.length ? input.earlierTitles.map((title) => `“${title}”`).join(', ') : '(none)'}`,
    `Write post ${input.index} of ${input.total}.`,
  ].join('\n')
}

export interface GenerateAiBlogPostInput extends AiBlogPostPromptInput {
  /** What a claim or a price may be quoted from: the brief and the site's answers. */
  merchantWords: string
  settings?: AiPluginSettings
  model?: string
  maxTokens?: number
  signal?: AbortSignal
  provider?: AiProvider
}

/** Write one post. It writes nothing to the site. */
export function generateAiBlogPost(input: GenerateAiBlogPostInput): Promise<AiValidatedGeneration<AiBlogPost>> {
  const row = AI_ROUTING_TABLE[AI_BLOG_POST_STEP]
  return runValidatedGeneration(AI_BLOG_POST_KIND, {
    step: AI_BLOG_POST_STEP,
    ...(input.settings ? { settings: input.settings } : {}),
    ...(input.model ? { model: input.model } : {}),
    instructions: AI_BLOG_POST_INSTRUCTIONS,
    messages: [{ role: 'user', content: aiBlogPostPrompt(input) }],
    tool: AI_BLOG_POST_TOOL,
    maxTokens: input.maxTokens ?? AI_BLOG_POST_MAX_TOKENS,
    ...(row.thinking ? { thinking: row.thinking } : {}),
    ...(row.effort ? { effort: row.effort } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.provider ? { provider: input.provider } : {}),
    check: (answer) =>
      checkAiBlogPost(answer, { merchantWords: input.merchantWords, earlierTitles: input.earlierTitles }),
  })
}
