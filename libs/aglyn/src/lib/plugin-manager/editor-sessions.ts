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
 * The editor a person has open, as another surface may act on it.
 *
 * A console editor — the besigner on a screen, a component or a layout —
 * holds state no plugin can reach: which element is selected, whether the
 * version it has open is the one the live site serves, the dialog that makes
 * a new version, and form fields that sit beside the canvas rather than on
 * it (a screen's search title). A plugin mounted in a shell zone that wants
 * to help with that document — a translation, a review comment, a proposed
 * edit — would otherwise have to import the console page, which the package
 * map forbids, or write the stored document itself, which skips the editor's
 * guards and the author's review.
 *
 * So the editor registers a SESSION while it is open, and a plugin reads it.
 * Every capability is the editor's own:
 *
 *  - `selectedNodeId` and `isLiveVersion` are answered when asked, so a
 *    caller never holds an answer from registration time;
 *  - `createVersion` starts the editor's own new-version flow, with its
 *    entitlement check, its refusal to copy an unsaved canvas and its name
 *    dialog — nothing here creates a version;
 *  - `fields` are the setters the editor's own form reads, so a staged value
 *    is exactly what typing it would have been: an unsaved edit, stored only
 *    when the author saves with the editor's own control. There is no save
 *    here, by construction.
 *
 * One editor is open at a time in a console tab, but a remount registers
 * before the previous mount's cleanup runs, so registrations stack: the
 * newest session answers, and an unregister removes only the registration
 * it was returned for.
 */

export interface EditorSession {
  /** The kind of document open, as the editor's route names it: `screen`, `component`, `layout`. */
  documentKind: string
  /** The id of the document open. */
  documentId: string
  /** The id of the version open. */
  versionId: string
  /** Whether the open version is the one the live site serves. */
  isLiveVersion: () => boolean
  /** The element the author has selected, or null. */
  selectedNodeId?: () => string | null
  /**
   * Starts the editor's own new-version flow. Whether a version results is
   * the flow's decision — the plan, an unsaved canvas and the author's own
   * dialog can each stop it — and a created version opens in the editor the
   * way the editor's own button opens it.
   */
  createVersion?: () => void
  /**
   * Fields beside the canvas another surface may stage, keyed as the editor
   * names them (`seo.title`), each with the setter the editor's own form
   * reads.
   */
  fields?: Readonly<Record<string, (value: string) => void>>
  /** Brings the staged fields into view, so the author sees them before saving. */
  revealFields?: () => void
}

/** What a staging call did: the keys it staged, and the keys the editor lacks. */
export interface EditorFieldStageResult {
  staged: string[]
  unknown: string[]
}

const sessions: EditorSession[] = []
const listeners = new Set<() => void>()
let revision = 0

function notify(): void {
  revision += 1
  for (const listener of [...listeners]) listener()
}

/**
 * Registers the open editor. Returns the unregister function, which removes
 * only this registration.
 */
export function registerEditorSession(session: EditorSession): () => void {
  const documentKind = String(session?.documentKind ?? '').trim()
  const documentId = String(session?.documentId ?? '').trim()
  const versionId = String(session?.versionId ?? '').trim()
  if (!documentKind || !documentId || !versionId) {
    throw new Error(
      'an editor session needs a document kind, a document id and a version id',
    )
  }
  if (typeof session.isLiveVersion !== 'function') {
    throw new Error('an editor session needs isLiveVersion')
  }
  const entry: EditorSession = { ...session, documentKind, documentId, versionId }
  sessions.push(entry)
  notify()
  return () => {
    const index = sessions.indexOf(entry)
    if (index < 0) return
    sessions.splice(index, 1)
    notify()
  }
}

/** The newest open editor session, or `undefined` when no editor is open. */
export function openEditorSession(): EditorSession | undefined {
  return sessions[sessions.length - 1]
}

/**
 * Calls `listener` whenever a session opens or closes, or its editor reports
 * that an answer changed. Returns the unsubscribe function.
 */
export function subscribeEditorSessions(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * A number that moves on every notification — the snapshot a React
 * subscriber compares, since the open session itself stays the same object
 * when only one of its answers changes.
 */
export function editorSessionsRevision(): number {
  return revision
}

/**
 * Tells subscribers that an open session's answers changed — the version it
 * holds went live, or stopped being live — without registering it again.
 */
export function notifyEditorSessionChanged(): void {
  notify()
}

/**
 * Stages `values` into the session's own fields, and reveals them when any
 * was staged. Nothing is saved.
 */
export function stageEditorSessionFields(
  session: EditorSession,
  values: Readonly<Record<string, string>>,
): EditorFieldStageResult {
  const staged: string[] = []
  const unknown: string[] = []
  for (const [key, value] of Object.entries(values ?? {})) {
    const set = session.fields?.[key]
    if (typeof set !== 'function') {
      unknown.push(key)
      continue
    }
    set(String(value))
    staged.push(key)
  }
  if (staged.length) session.revealFields?.()
  return { staged, unknown }
}

/** Closes every session and drops every subscriber. Specs only. */
export function resetEditorSessionsForTests(): void {
  sessions.length = 0
  listeners.clear()
  revision = 0
}
