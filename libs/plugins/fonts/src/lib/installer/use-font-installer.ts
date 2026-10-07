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

import type { HostTheme, HostThemeFontCategory } from '@aglyn/shared-data-types'
import { authorizedFetch, type MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FONT_STORED_CONTENT_TYPE,
  FONTS_PREPARE_ROUTE,
  type PreparedFontFace,
  type PrepareFontResponse,
} from './constants'
import { registerFontFaceBytes } from './font-preview'
import { fontFaceSrc, installCustomFontFace, planFontUpload } from './theme-fonts'

/**
 * The installer's client half (AGL-3656): each file goes to the prepare
 * route, then into the site's media library through the library's own
 * routes — `replace` when the theme already has a face in the same slot,
 * `upload` otherwise — and then into the theme draft.
 *
 * Files are installed ONE AT A TIME, against the draft as the previous file
 * left it. Two files for the same slot dropped together would otherwise both
 * see no face there and store two copies.
 */

export type FontJobStep = 'queued' | 'checking' | 'saving' | 'installed' | 'failed'

export interface FontJob {
  id: string
  fileName: string
  bytes: number
  step: FontJobStep
  face?: PreparedFontFace
  /** Set once stored: whether the library file was replaced in place. */
  replaced?: boolean
  error?: string
}

async function readError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null
  return payload?.error || fallback
}

/** `POST /api/fonts/prepare`: the file's facts and its WOFF2. */
export async function prepareFont(user: MaybeTokenSource, hostId: string, file: Blob): Promise<PrepareFontResponse> {
  const response = await authorizedFetch(user, `/api/${FONTS_PREPARE_ROUTE}?hostId=${encodeURIComponent(hostId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  })
  if (!response.ok) throw new Error(await readError(response, 'The font could not be checked. Try again.'))
  return (await response.json()) as PrepareFontResponse
}

/**
 * Stores a prepared WOFF2 in the site's media library and answers its media
 * reference and version. Replaces the file the theme's face already points
 * at when there is one; a file that has since left the library is uploaded
 * anew.
 */
export async function storeFont(
  user: MaybeTokenSource,
  options: { hostId: string; theme: HostTheme; face: PreparedFontFace; woff2: string },
): Promise<{ src: string; version: string; replaced: boolean }> {
  const { hostId, theme, face, woff2 } = options
  const plan = planFontUpload(theme, face, hostId)
  const body = { hostId, fileName: face.fileName, contentType: FONT_STORED_CONTENT_TYPE, data: woff2 }
  if (plan.mode === 'replace') {
    const response = await authorizedFetch(user, '/api/media/replace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, mediaId: plan.mediaId }),
    })
    if (response.ok) {
      const payload = (await response.json()) as { contentHash?: string }
      return {
        src: fontFaceSrc(hostId, plan.mediaId) as string,
        version: payload.contentHash || face.contentHash,
        replaced: true,
      }
    }
    // The file was deleted from the library since: store it anew.
    if (response.status !== 404) {
      throw new Error(await readError(response, 'The font file could not be replaced in your media library.'))
    }
  }
  const response = await authorizedFetch(user, '/api/media/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await readError(response, 'The font could not be saved to your media library.'))
  const payload = (await response.json()) as { mediaId: string }
  const src = fontFaceSrc(hostId, payload.mediaId)
  if (!src) throw new Error('The media library answered with an id it cannot be addressed by.')
  return { src, version: face.contentHash, replaced: false }
}

const base64Bytes = (base64: string): Uint8Array => {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

let jobSeq = 0

export interface UseFontInstallerOptions {
  hostId: string
  draft: HostTheme
  updateDraft: (update: (draft: HostTheme) => HostTheme) => void
}

export function useFontInstaller(options: UseFontInstallerOptions) {
  const { hostId, draft, updateDraft } = options
  const { data: user } = useUser()
  const [jobs, setJobs] = useState<FontJob[]>([])
  // The draft each install reads: the editor's, plus whatever the installs
  // before it wrote and the editor has not rendered back yet.
  const latest = useRef(draft)
  useEffect(() => {
    latest.current = draft
  }, [draft])
  const queue = useRef<Array<{ id: string; file: File }>>([])
  const running = useRef(false)

  const patch = useCallback((id: string, next: Partial<FontJob>) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, ...next } : job)))
  }, [])

  const run = useCallback(async () => {
    if (running.current) return
    running.current = true
    try {
      for (let item = queue.current.shift(); item; item = queue.current.shift()) {
        const { id, file } = item
        try {
          patch(id, { step: 'checking' })
          const prepared = await prepareFont(user, hostId, file)
          patch(id, { step: 'saving', face: prepared.face })
          const stored = await storeFont(user, { hostId, theme: latest.current, face: prepared.face, woff2: prepared.woff2 })
          // Drawn in the console from the bytes just made, so the preview
          // shows the font before the library's CDN has been asked for it.
          registerFontFaceBytes(prepared.face, base64Bytes(prepared.woff2))
          const install = (theme: HostTheme) => installCustomFontFace(theme, prepared.face, stored)
          latest.current = install(latest.current)
          updateDraft(install)
          patch(id, { step: 'installed', replaced: stored.replaced })
        } catch (error) {
          patch(id, { step: 'failed', error: error instanceof Error ? error.message : String(error) })
        }
      }
    } finally {
      running.current = false
    }
  }, [hostId, patch, updateDraft, user])

  const add = useCallback(
    (files: File[]) => {
      const added = files.map((file) => ({ id: `font-job-${++jobSeq}`, file }))
      setJobs((current) => [
        ...added.map(({ id, file }) => ({ id, fileName: file.name, bytes: file.size, step: 'queued' as const })),
        ...current,
      ])
      queue.current.push(...added)
      void run()
    },
    [run],
  )

  const dismiss = useCallback((id: string) => {
    setJobs((current) => current.filter((job) => job.id !== id))
  }, [])

  /** Rejected by the chooser's `accept`: shown as failed jobs, so the person sees why. */
  const reject = useCallback((files: File[]) => {
    setJobs((current) => [
      ...files.map((file) => ({
        id: `font-job-${++jobSeq}`,
        fileName: file.name,
        bytes: file.size,
        step: 'failed' as const,
        error: 'This is not a font file. Upload a .woff2, .woff, .ttf or .otf file.',
      })),
      ...current,
    ])
  }, [])

  return { jobs, add, dismiss, reject }
}

/** The categories a person can pick for a family, in the order the menu lists them. */
export const FONT_CATEGORY_OPTIONS: ReadonlyArray<{ value: HostThemeFontCategory; label: string }> = [
  { value: 'sans-serif', label: 'Sans serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'display', label: 'Display' },
  { value: 'handwriting', label: 'Handwriting' },
]
