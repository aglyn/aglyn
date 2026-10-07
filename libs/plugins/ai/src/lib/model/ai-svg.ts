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

import { sanitizeSvg } from '@aglyn/aglyn/app-utils/sanitize-svg'
import type { AiImageAspectRatio, AiSvgStyle } from '../providers/image-contract'

/**
 * The SVG an illustration arrives as (AGL-3602), and the one gate it passes
 * before it is stored.
 *
 * A model writes SVG as text, and SVG is a document: it can carry script,
 * event handlers, links out and HTML. The upload route strips all of that
 * from anything it stores (`sanitize-svg`), so a dangerous answer could never
 * be SERVED — but a stripped answer is no longer the picture the model meant,
 * so this does not quietly accept one. Anything the sanitizer would have to
 * remove, and anything a self-contained static picture has no use for, is a
 * problem the model is told about and asked to fix once; a second answer with
 * a problem is not stored at all.
 *
 * A picture that passes is:
 *
 * - one `<svg>` root in the SVG namespace, with a `viewBox` in the shape asked
 *   for, and balanced tags;
 * - at most `AI_SVG_MAX_BYTES`;
 * - self-contained: no `<image>`, no `<foreignObject>`, no `<script>`, no
 *   `<a>`, no event handler, no link or `url(…)` to anything but a `#fragment`
 *   in the same document, no `@import` and no `@font-face`;
 * - static: no `<animate>`, `<set>` or other animation element;
 * - for a logo mark, free of `<text>`: a mark, never a wordmark;
 * - unchanged by `sanitizeSvg`.
 */

/** The largest illustration stored, in bytes of UTF-8. */
export const AI_SVG_MAX_BYTES = 200 * 1024

/** The `viewBox` each shape is drawn in. */
export const AI_SVG_VIEWBOX: Readonly<Record<AiImageAspectRatio, string>> = {
  '1:1': '0 0 512 512',
  '4:3': '0 0 640 480',
  '3:4': '0 0 480 640',
  '16:9': '0 0 960 540',
  '9:16': '0 0 540 960',
}

/** How far a `viewBox`'s proportions may stray from the shape asked for. */
const RATIO_TOLERANCE = 0.03

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

export interface AiSvgProblem {
  /** Stable per finding, for specs and logs. */
  code: string
  /** What the model is told to fix. */
  detail: string
}

export interface AiSvgCheck {
  /** The document to store, or `null` when it has a problem. */
  svg: string | null
  problems: AiSvgProblem[]
}

const FORBIDDEN_ELEMENTS: ReadonlyArray<[RegExp, string, string]> = [
  [/<\s*(?:[\w-]+:)?script\b/i, 'script', 'Remove every <script> element.'],
  [/<\s*(?:[\w-]+:)?foreignObject\b/i, 'foreign-object', 'Remove every <foreignObject> element.'],
  [/<\s*(?:[\w-]+:)?image\b/i, 'image', 'Remove every <image> element: draw with shapes and paths only.'],
  [/<\s*(?:[\w-]+:)?(?:iframe|embed|object|audio|video|canvas)\b/i, 'embed', 'Remove every embedded document or media element.'],
  [/<\s*(?:[\w-]+:)?a\b/i, 'link', 'Remove every <a> element: the picture links nowhere.'],
  [
    /<\s*(?:[\w-]+:)?(?:animate|animateMotion|animateTransform|set|discard)\b/i,
    'animation',
    'Remove every animation element: the picture is static.',
  ],
]

/** The proportions of a `viewBox` value, or `null` when it is not one. */
function viewBoxRatio(value: string): number | null {
  const parts = value.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null
  const [, , width, height] = parts
  return width > 0 && height > 0 ? width / height : null
}

/**
 * Whether every element opened is closed, in order, under ONE root that
 * closes last. Comments and CDATA are skipped.
 */
function tagsBalance(svg: string): boolean {
  const stripped = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
  const stack: string[] = []
  let closedRoot = false
  for (const match of stripped.matchAll(/<(\/?)([A-Za-z][\w:.-]*)[^<>]*?(\/?)>/g)) {
    const [, closing, name, selfClosing] = match
    // Anything after the root closed is a second root.
    if (closedRoot) return false
    if (selfClosing) {
      if (!stack.length) return false
      continue
    }
    if (closing) {
      if (stack.pop() !== name) return false
      if (!stack.length) closedRoot = true
    } else {
      stack.push(name)
    }
  }
  return stack.length === 0 && closedRoot
}

/**
 * The gate. `markup` is the model's answer; the result is the document to
 * store, or the problems to send back.
 */
export function checkAiSvgMarkup(
  markup: unknown,
  aspectRatio: AiImageAspectRatio,
  style: AiSvgStyle,
): AiSvgCheck {
  const problems: AiSvgProblem[] = []
  const svg = String(markup ?? '')
    .trim()
    // An XML declaration is harmless and the sanitizer would drop it.
    .replace(/^<\?xml[^>]*\?>\s*/i, '')
  if (!svg) {
    return { svg: null, problems: [{ code: 'empty', detail: 'Answer with the SVG document itself.' }] }
  }
  const bytes = new TextEncoder().encode(svg).length
  if (bytes > AI_SVG_MAX_BYTES) {
    problems.push({
      code: 'too-large',
      detail: `The SVG is ${Math.round(bytes / 1024)} KB; keep it under ${AI_SVG_MAX_BYTES / 1024} KB with fewer, simpler paths.`,
    })
  }
  const root = /^<svg\b([^>]*)>/i.exec(svg)
  if (!root || !/<\/svg>$/i.test(svg)) {
    problems.push({ code: 'root', detail: 'Answer with exactly one <svg> element and nothing around it.' })
  } else {
    const attributes = root[1]
    if (!new RegExp(`xmlns\\s*=\\s*["']${SVG_NAMESPACE.replace(/[.]/g, '\\.')}["']`).test(attributes)) {
      problems.push({ code: 'namespace', detail: `Give the <svg> element xmlns="${SVG_NAMESPACE}".` })
    }
    const viewBox = /\bviewBox\s*=\s*["']([^"']*)["']/.exec(attributes)
    const expected = viewBoxRatio(AI_SVG_VIEWBOX[aspectRatio]) as number
    const ratio = viewBox ? viewBoxRatio(viewBox[1]) : null
    if (ratio === null) {
      problems.push({
        code: 'viewbox',
        detail: `Give the <svg> element viewBox="${AI_SVG_VIEWBOX[aspectRatio]}".`,
      })
    } else if (Math.abs(ratio - expected) / expected > RATIO_TOLERANCE) {
      problems.push({
        code: 'viewbox-shape',
        detail: `The viewBox is the wrong shape; use viewBox="${AI_SVG_VIEWBOX[aspectRatio]}".`,
      })
    }
  }
  if (root && !tagsBalance(svg)) {
    problems.push({ code: 'malformed', detail: 'The SVG is not well-formed: close every element you open.' })
  }
  for (const [pattern, code, detail] of FORBIDDEN_ELEMENTS) {
    if (pattern.test(svg)) problems.push({ code, detail })
  }
  if (/\son[a-z]+\s*=/i.test(svg)) {
    problems.push({ code: 'event-handler', detail: 'Remove every on… event attribute.' })
  }
  for (const match of svg.matchAll(/\s(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)) {
    if (!match[1].trim().startsWith('#')) {
      problems.push({
        code: 'external-ref',
        detail: 'A href may only point at an element of this same SVG (#id).',
      })
      break
    }
  }
  for (const match of svg.matchAll(/url\(\s*['"]?([^)'"]*)/gi)) {
    if (!match[1].trim().startsWith('#')) {
      problems.push({ code: 'external-url', detail: 'url(…) may only point at an element of this same SVG (#id).' })
      break
    }
  }
  if (/@import\b/i.test(svg) || /@font-face\b/i.test(svg)) {
    problems.push({
      code: 'external-css',
      detail: 'Remove @import and @font-face; use generic font families (sans-serif, serif) if any.',
    })
  }
  if (style === 'logo' && /<\s*(?:[\w-]+:)?text\b/i.test(svg)) {
    problems.push({ code: 'wordmark', detail: 'A logo mark has no lettering: draw it with shapes and paths only.' })
  }
  if (!problems.length) {
    const sanitized = sanitizeSvg(svg)
    if (sanitized.changed) {
      problems.push({
        code: 'unsafe',
        detail: `Remove what an SVG served as an image may not carry: ${sanitized.removed.join(', ')}.`,
      })
    }
  }
  return problems.length ? { svg: null, problems } : { svg, problems }
}

/** A color a person may name: `#rgb` or `#rrggbb`. */
export function isAiSvgColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())
}

/**
 * The colors a site's theme names, in the order a picture reaches for them:
 * the primary and secondary colors first, then the backgrounds and text.
 */
export function aiSvgThemePalette(colors: Readonly<Record<string, string>> | null | undefined): string[] {
  if (!colors) return []
  const order = [
    'primary.main',
    'secondary.main',
    'background.default',
    'background.paper',
    'text.primary',
    'primary.light',
    'primary.dark',
    'secondary.light',
    'secondary.dark',
  ]
  const keys = [...order.filter((key) => key in colors), ...Object.keys(colors).filter((key) => !order.includes(key))]
  const palette: string[] = []
  for (const key of keys) {
    const value = String(colors[key] ?? '').trim().toLowerCase()
    if (isAiSvgColor(value) && !palette.includes(value)) palette.push(value)
    if (palette.length >= 6) break
  }
  return palette
}
