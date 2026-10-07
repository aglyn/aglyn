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

import type { HostThemeFont } from '@aglyn/shared-data-types'
import { resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import { useEffect } from 'react'
import type { PreparedFontFace } from './constants'
import { isVariableFace } from './theme-fonts'

/**
 * Draws installed fonts in the console (AGL-3656): the editor's preview and
 * the installer's own sample text name a family, and the console page has no
 * `@font-face` for an uploaded one. Each face is added to `document.fonts`
 * once, from the bytes just prepared or from the library's CDN route on the
 * console's own origin.
 */

const added = new Set<string>()

const descriptors = (face: { weight: number; weightMax?: number; style: 'normal' | 'italic' }): FontFaceDescriptors => ({
  weight: isVariableFace(face) ? `${face.weight} ${face.weightMax}` : String(face.weight),
  style: face.style,
  display: 'swap',
})

function addFace(key: string, make: () => FontFace) {
  if (added.has(key) || typeof document === 'undefined' || typeof FontFace === 'undefined') return
  added.add(key)
  try {
    const face = make()
    document.fonts.add(face)
    face.load().catch(() => added.delete(key))
  } catch {
    added.delete(key)
  }
}

/** Adds a just-prepared face from its WOFF2 bytes. */
export function registerFontFaceBytes(face: PreparedFontFace, woff2: Uint8Array): void {
  addFace(`${face.family}|${face.weight}|${face.weightMax ?? ''}|${face.style}|${face.contentHash}`, () => {
    const buffer = woff2.buffer.slice(woff2.byteOffset, woff2.byteOffset + woff2.byteLength) as ArrayBuffer
    return new FontFace(face.family, buffer, descriptors(face))
  })
}

/** Adds every face of the theme's uploaded families from the media route. */
export function useInstalledFontFaces(hostId: string, fonts: readonly HostThemeFont[]): void {
  const key = JSON.stringify(fonts.map((font) => [font.family, font.faces]))
  useEffect(() => {
    for (const font of fonts) {
      for (const face of font.faces ?? []) {
        const url = resolveMediaSrc(face.src, { hostId, version: face.version })
        if (!url) continue
        addFace(`${font.family}|${face.weight}|${face.weightMax ?? ''}|${face.style}|${face.version ?? url}`, () =>
          new FontFace(font.family, `url(${JSON.stringify(url)}) format('woff2')`, descriptors(face)),
        )
      }
    }
    // `key` stands for `fonts`, whose identity changes on every draft edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, key])
}
