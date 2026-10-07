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

import { aiDefaultModelFor } from '../providers/catalog'
import type { AiSystemBlock, AiTool, AiUsage } from '../providers/contract'
import type { AiImageAspectRatio, AiSvgStyle } from '../providers/image-contract'
import { resolveAiProvider } from '../providers/routing'
import { AI_SVG_MAX_BYTES, AI_SVG_VIEWBOX, checkAiSvgMarkup } from '../model/ai-svg'
import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'
import {
  runValidatedGeneration,
  type AiCustomGenerationInput,
  type AiGenerationCheckResult,
  type AiValidatedGeneration,
} from '../runtime/ai-doctrine'

/**
 * Illustrations in Media (AGL-3602): an SVG drawn by the TEXT provider every
 * other AI door uses — the same registry, the same meter, the same data flow
 * the published subprocessor row for the text provider already describes —
 * so this mode needs no new vendor and runs wherever text AI does.
 *
 * One generation per picture, through `runValidatedGeneration`: the answer
 * arrives through a strict tool, `checkAiSvgMarkup` is its check, and an
 * answer with a problem is sent back once with what to fix. A second answer
 * with a problem is not stored and, being our failure, not charged.
 *
 * It runs on the provider's fast tier: an SVG is a few thousand tokens of
 * markup and the door answers inside one request, so the model that writes
 * them quickest is the one that fits.
 */

/** The doctrine kind the generation runs under; it reads no site tree. */
export const AI_MEDIA_SVG_KIND = 'media-svg'

/** The name of the tool the picture arrives through. */
export const AI_MEDIA_SVG_TOOL_NAME = 'submit_svg'

/** The answer ceiling: room for a compact picture and a re-ask's worth of care. */
export const AI_MEDIA_SVG_MAX_TOKENS = 6_000

/** What each kind of illustration is, in the words the model is given. */
const STYLE_BRIEF: Readonly<Record<AiSvgStyle, string>> = {
  illustration:
    'A spot illustration or small scene: flat or lightly shaded vector shapes, clear silhouettes, no photographic detail.',
  icon: 'A single icon: bold, simple geometry centered with even padding, in ONE color, or two tones of the palette at most. Readable at 24 pixels.',
  pattern:
    'A seamless, tileable background pattern: every shape that leaves one edge re-enters at the opposite edge, so tiles join without a seam. Low contrast, suitable behind text.',
  logo: "A simple abstract logo MARK: a symbol made of a few shapes, with no lettering at all. Never a real company's logo, a trademark, a brand's symbol or anything imitating one.",
}

const INSTRUCTIONS = [
  'You draw SVG pictures for a website owner. You receive what to draw, which kind of picture it is, its shape and the colors to use, and you answer through the submit_svg tool.',
  '',
  'The SVG you write must:',
  '- be exactly one <svg> element with xmlns="http://www.w3.org/2000/svg" and the viewBox you are given, and no width or height attributes;',
  '- use only shapes, paths, groups, gradients, clipPaths and masks drawn in the document itself: never <image>, <foreignObject>, <script>, <a>, animation elements, event attributes, or a href or url(...) pointing anywhere but #ids in the same SVG;',
  '- use no web fonts, @import or @font-face; prefer no text at all, and use only generic font families (sans-serif, serif) when text is essential;',
  `- stay compact: well under ${Math.round(AI_SVG_MAX_BYTES / 1024 / 4)} KB, with few paths and coordinates rounded to at most one decimal place;`,
  '- use the colors given, plus white, black and transparency, and no others.',
  '',
  'Write alt text: one plain sentence describing what the picture shows, for someone who cannot see it.',
  '',
  "Decline instead of drawing — set declined to one short sentence and leave svg and alt empty — when you are asked for a real company's or organization's logo, a trademark, a recognizable brand symbol or anything imitating one; for a real, named person; or for anything sexual, hateful, violent or otherwise unsafe. Otherwise set declined to an empty string.",
].join('\n')

export const AI_MEDIA_SVG_INSTRUCTIONS: AiSystemBlock[] = [{ text: INSTRUCTIONS, cacheBreakpoint: true }]

export function aiMediaSvgTool(): AiTool {
  return {
    name: AI_MEDIA_SVG_TOOL_NAME,
    description: 'Submit the SVG picture and its alt text, or decline.',
    strict: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['svg', 'alt', 'declined'],
      properties: {
        svg: { type: 'string', description: 'The whole SVG document, starting with <svg and ending with </svg>.' },
        alt: { type: 'string', description: 'One plain sentence describing the picture.' },
        declined: {
          type: 'string',
          description: 'Empty, or one short sentence saying why this picture is not drawn.',
        },
      },
    },
  }
}

/** The question one picture is asked as. */
export function aiMediaSvgPrompt(input: {
  prompt: string
  style: AiSvgStyle
  aspectRatio: AiImageAspectRatio
  palette: readonly string[]
  variant: number
  count: number
}): string {
  const colors = input.palette.length
    ? `Colors: ${input.palette.join(', ')}.`
    : 'Colors: a restrained palette of three to five colors of your choice.'
  const lines = [
    `Kind: ${input.style}. ${STYLE_BRIEF[input.style]}`,
    `Shape: ${input.aspectRatio}, viewBox="${AI_SVG_VIEWBOX[input.aspectRatio]}".`,
    colors,
  ]
  if (input.count > 1) {
    lines.push(
      `This is version ${input.variant + 1} of ${input.count}: make it a distinct take on the same description.`,
    )
  }
  lines.push('', 'Draw:', input.prompt)
  return lines.join('\n')
}

/** What one picture's answer holds once it is read. */
export type AiMediaSvgAnswer = { svg: string; alt: string } | { declined: string }

/** The check one answer is held to: the SVG gate, or a decline. */
export function checkAiMediaSvgAnswer(
  answer: Record<string, unknown>,
  aspectRatio: AiImageAspectRatio,
  style: AiSvgStyle,
): AiGenerationCheckResult<AiMediaSvgAnswer> {
  const declined = typeof answer['declined'] === 'string' ? answer['declined'].trim() : ''
  if (declined) return { value: { declined: declined.slice(0, 300) }, violations: [] }
  const result = checkAiSvgMarkup(answer['svg'], aspectRatio, style)
  const alt = typeof answer['alt'] === 'string' ? answer['alt'].replace(/\s+/g, ' ').trim().slice(0, 300) : ''
  if (result.svg) return { value: { svg: result.svg, alt }, violations: [] }
  const violations: AiDoctrineViolation[] = result.problems.map((problem) => ({
    rule: null,
    code: `svg-${problem.code}`,
    message: 'The picture could not be drawn safely.',
    detail: problem.detail,
  }))
  return { value: { svg: '', alt }, violations, offending: { svg: '(see the problems listed)' } }
}

/** The model an illustration runs on: the text provider's fast tier. */
export function aiMediaSvgModel(): string | undefined {
  const provider = resolveAiProvider()
  return provider ? aiDefaultModelFor(provider.id, 'fast') : undefined
}

/** One picture's outcome. */
export type AiMediaSvgOutcome =
  | { kind: 'drawn'; svg: string; alt: string; usage: AiUsage; model: string }
  | { kind: 'declined'; reason: string; usage: AiUsage; model: string }
  /** The re-ask still failed the gate, or the model stopped: ours, never charged. */
  | { kind: 'failed'; usage: AiUsage; model: string }

/** Draws one picture. A provider fault propagates for the door to answer. */
export async function generateAiMediaSvg(input: {
  model: string
  prompt: string
  style: AiSvgStyle
  aspectRatio: AiImageAspectRatio
  palette: readonly string[]
  variant: number
  count: number
}): Promise<AiMediaSvgOutcome> {
  const generation: AiCustomGenerationInput<AiMediaSvgAnswer> = {
    model: input.model,
    instructions: AI_MEDIA_SVG_INSTRUCTIONS,
    inventory: undefined,
    messages: [{ role: 'user', content: aiMediaSvgPrompt(input) }],
    tool: aiMediaSvgTool(),
    maxTokens: AI_MEDIA_SVG_MAX_TOKENS,
    check: (answer) => checkAiMediaSvgAnswer(answer, input.aspectRatio, input.style),
  }
  const result = (await runValidatedGeneration(
    AI_MEDIA_SVG_KIND,
    generation,
  )) as AiValidatedGeneration<AiMediaSvgAnswer>
  const spent = { usage: result.usage, model: result.model }
  if (result.status === 'ok') {
    return 'declined' in result.value
      ? { kind: 'declined', reason: result.value.declined, ...spent }
      : { kind: 'drawn', svg: result.value.svg, alt: result.value.alt, ...spent }
  }
  if (result.status === 'refused') {
    return { kind: 'declined', reason: 'The assistant would not draw this.', ...spent }
  }
  return { kind: 'failed', ...spent }
}
