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
'use client'

import { useEffect, useState } from 'react'

/**
 * A family's preview in the font picker (AGL-3656): only the letters the
 * preview draws, fetched from Google's CSS2 API with its `text=` parameter,
 * so a card costs a few kilobytes rather than the family's files.
 *
 * Each preview is registered under a name of its own (`Font Preview …`),
 * never the family's: a face that holds a handful of letters, registered as
 * `Inter`, would be picked by the editor's canvas for the site's own Inter
 * text and draw every other letter in the fallback. Nothing registered here
 * is ever removed, so nothing the canvas has loaded is unloaded either.
 *
 * Console only: nothing on a published page imports this module.
 */

const PREVIEW_PREFIX = 'Font Preview'

/** The letters one preview may ask for; Google refuses a very long `text=`. */
const MAX_PREVIEW_LETTERS = 160

const previews = new Map<string, Promise<string | null>>()

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

function hash(text: string): string {
  let value = 0
  for (const char of text) value = (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return value.toString(36)
}

/**
 * Loads one face of a family for some text and answers the name to draw it
 * with, or null when it could not be loaded (the preview then draws in the
 * fallback face, and says nothing worse).
 */
export function loadFontPreview(
  family: string,
  options: { weight?: number; style?: 'normal' | 'italic'; text: string },
): Promise<string | null> {
  const weight = options.weight ?? 400
  const style = options.style ?? 'normal'
  const letters = previewLetters(options.text)
  const key = `${family.toLowerCase()}|${weight}|${style}|${letters}`
  const known = previews.get(key)
  if (known) return known
  const loading = (async () => {
    if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
      return null
    }
    const name = `${PREVIEW_PREFIX} ${family.trim()} ${hash(letters)}`
    try {
      const response = await fetch(previewSheetUrl(family, weight, style, letters))
      if (!response.ok) return null
      const [url] = previewFileUrls(await response.text())
      if (!url) return null
      const face = new FontFace(name, `url(${url})`, { weight: String(weight), style })
      await face.load()
      document.fonts.add(face)
      return name
    } catch {
      return null
    }
  })()
  previews.set(key, loading)
  // A failure is forgotten, so the card asks again the next time it is shown.
  void loading.then((name) => {
    if (!name) previews.delete(key)
  })
  return loading
}

export type FontPreviewState = { status: 'idle' | 'loading' | 'failed'; family?: undefined } | { status: 'ready'; family: string }

/**
 * A preview's face once `enabled` (the card is on screen): `ready` with the
 * name to draw with, `loading` meanwhile, `failed` when it could not load.
 */
export function useFontPreview(
  family: string | null | undefined,
  options: { weight?: number; style?: 'normal' | 'italic'; text: string; enabled?: boolean },
): FontPreviewState {
  const { weight = 400, style = 'normal', text, enabled = true } = options
  const [state, setState] = useState<FontPreviewState>({ status: 'idle' })
  useEffect(() => {
    if (!family || !enabled || !text) return undefined
    let active = true
    setState({ status: 'loading' })
    void loadFontPreview(family, { weight, style, text }).then((name) => {
      if (!active) return
      setState(name ? { status: 'ready', family: name } : { status: 'failed' })
    })
    return () => {
      active = false
    }
  }, [family, weight, style, text, enabled])
  return state
}

/** A CSS stack that draws a preview, falling back to the family's category. */
export function previewStack(state: FontPreviewState, fallback: string): string {
  return state.status === 'ready' ? `"${state.family}", ${fallback}` : fallback
}
