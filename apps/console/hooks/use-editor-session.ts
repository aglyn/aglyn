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

import {
  notifyEditorSessionChanged,
  registerEditorSession,
} from '@aglyn/aglyn/plugin-manager/editor-sessions'
import { useEffect, useRef, type RefObject } from 'react'
import type { BesignerVersionsActions } from '../components/besigner-versions.component'

export interface EditorSessionInput {
  documentKind: 'screen' | 'component' | 'layout'
  documentId: string | undefined
  versionId: string | undefined
  /** Whether the open version is the one the live site serves. */
  live: boolean
  /** The element the author has selected, read when asked. */
  selectedNodeId: () => string | null
  /** The versions panel's actions, whose new-version flow a session may start. */
  versionsActions?: RefObject<BesignerVersionsActions | null>
  /** Unsaved fields beside the canvas, each with the setter the page's form reads. */
  fields?: Readonly<Record<string, (value: string) => void>>
  /** Opens the panel holding `fields`. */
  revealFields?: () => void
}

/**
 * Registers the open besigner document as an editor session, so a plugin in
 * a shell zone can read the selection and the live pointer, start this
 * editor's own new-version flow and stage its unsaved fields — through the
 * core seam (`plugin-manager/editor-sessions`), never by importing the page.
 *
 * Registered once per document and version. Every answer is read through a
 * ref when asked, so the session never holds one from an earlier render, and
 * a change to the live pointer is announced without registering again.
 */
export function useEditorSession(input: EditorSessionInput): void {
  const latest = useRef(input)
  latest.current = input
  const { documentKind, documentId, versionId, live } = input
  const hasVersions = Boolean(input.versionsActions)
  const fieldKeys = Object.keys(input.fields ?? {}).sort().join('\n')

  useEffect(() => {
    if (!documentId || !versionId) return undefined
    const fields: Record<string, (value: string) => void> = {}
    for (const key of fieldKeys ? fieldKeys.split('\n') : []) {
      fields[key] = (value) => latest.current.fields?.[key]?.(value)
    }
    return registerEditorSession({
      documentKind,
      documentId,
      versionId,
      isLiveVersion: () => latest.current.live,
      selectedNodeId: () => latest.current.selectedNodeId(),
      ...(hasVersions
        ? { createVersion: () => latest.current.versionsActions?.current?.createVersion() }
        : {}),
      ...(fieldKeys
        ? { fields, revealFields: () => latest.current.revealFields?.() }
        : {}),
    })
  }, [documentKind, documentId, versionId, hasVersions, fieldKeys])

  useEffect(() => {
    notifyEditorSessionChanged()
  }, [live])
}
