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
 * The addresses a font preview is fetched from (AGL-3656): Google's CSS2 API
 * for only the letters a preview draws, and the font files that stylesheet
 * names. No DOM and no React, so the native apps' font loaders ask for the
 * same files (replayed from function-cases.generated.json).
 */

/** The letters one preview may ask for; Google refuses a very long `text=`. */
const MAX_PREVIEW_LETTERS = 160

/** The distinct letters of a text, in order, capped. */
export function previewLetters(text: string): string {
  return [...new Set([...text.replace(/\s+/g, ' ')])].join('').slice(0, MAX_PREVIEW_LETTERS)
}

/** Google's stylesheet URL for some letters of one face of a family. */
export function previewSheetUrl(
  family: string,
  weight: number,
  style: 'normal' | 'italic',
  text: string,
): string {
  const axis = style === 'italic' ? `ital,wght@1,${weight}` : `wght@${weight}`
  return (
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family.trim()).replace(/%20/g, '+')}:${axis}` +
    `&text=${encodeURIComponent(previewLetters(text))}&display=swap`
  )
}

/** The file URLs a CSS2 stylesheet names, in order. */
export function previewFileUrls(css: string): string[] {
  return [...css.matchAll(/src:\s*url\((['"]?)(https:\/\/fonts\.gstatic\.com\/[^)'"]+)\1\)/g)].map(
    (match) => match[2],
  )
}
