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
 * Who is in each document of an org, for list and detail rows (AGL-2486).
 *
 *
 * ## Why a server summary and not a subscription per row
 *
 * The RTDB rules let a client read exactly ONE room. Measured in the browser
 * against the live rules: one room `ALLOWED`, the docType subtree
 * `Permission denied`, the org subtree `Permission denied`. So a list of fifty
 * screens would need fifty subscriptions, and the presence tree is SPARSE —
 * measured on production, 2 occupied rooms against a largest host of 69
 * documents — so about 97% of those listeners would exist to learn that nobody
 * is there. This runs once, server-side, over one read.
 *
 * ## It is a DISPLAY ARTIFACT, not a presence row
 *
 * The output object is BUILT, never filtered down from the stored row, so a
 * field added to presence later cannot leak here by default. Cursors in
 * particular never leave the editor: `cursorX`/`cursorY` update at up to 16/s
 * and say where someone is pointing, which a list has no business knowing and
 * no way to draw.
 *
 * ## Staleness is stricter here than in a room
 *
 * A row on a list is read at a glance and believed. The reaper's 30-minute
 * threshold is for deleting rows in a room you are IN, where a heartbeat is
 * running to compare against; a list has no such context, so it uses the same
 * window the avatar stack uses to DRAW someone, and anything older simply is
 * not reported.
 */

/** One presence row, as the room holds it. Only what this file reads. */
interface StoredEntry {
  displayName?: unknown
  photoURL?: unknown
  lastSeenAt?: unknown
}

/**
 * How stale a row may be and still be reported as present.
 *
 * The DISPLAY window, matching `PRESENCE_STALE_MS` in `use-presence.ts` — a
 * list must not claim someone is editing a document when the editor itself
 * would have stopped drawing them. Duplicated rather than imported because
 * that module is `'use client'` and this one runs on the server;
 * `presence-summary.spec.ts` fails if the two numbers drift apart.
 */
export const PRESENCE_SUMMARY_STALE_MS = 150_000

/** One person in a document. Deliberately the smallest useful identity. */
export interface PresentPerson {
  uid: string
  displayName: string
  /** Absent for every SSO identity; the avatar draws initials instead. */
  photoURL?: string
}

/** `{ [docType]: { [docId]: PresentPerson[] } }` */
export type PresenceSummary = Record<string, Record<string, PresentPerson[]>>

/**
 * Collapse one org's presence tree to "who is in each document".
 *
 * Rolled up to the DOCUMENT, across versions, and deduplicated by uid, because
 * that is the question a list row asks: is anyone in this at all, before I
 * open it. Someone in two versions, or in three tabs, is one person and one
 * avatar. The per-VERSION detail belongs in the editor, where the room already
 * answers it live.
 *
 * Tolerates both room shapes: version-scoped rooms under the `v` literal, and
 * the legacy document-scoped rows beside them, which are still readable while
 * old clients drain.
 */
export function summarizeOrgPresence(
  tree: Record<string, unknown> | null | undefined,
  now: number,
  staleMs: number = PRESENCE_SUMMARY_STALE_MS,
): PresenceSummary {
  const summary: PresenceSummary = {}
  const cutoff = now - staleMs

  const take = (docType: string, docId: string, uid: string, raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const entry = raw as StoredEntry
    // A row without a usable name is not a person — the same guard the room
    // projection applies, and the reason a `?` avatar cannot appear here.
    if (typeof entry.displayName !== 'string' || !entry.displayName) return
    const lastSeenAt = entry.lastSeenAt
    if (typeof lastSeenAt !== 'number' || !Number.isFinite(lastSeenAt)) return
    if (lastSeenAt < cutoff) return
    const byDoc = (summary[docType] ??= {})
    const people = (byDoc[docId] ??= [])
    if (people.some((person) => person.uid === uid)) return
    // BUILT, not spread: every field is named here, so nothing a presence row
    // gains later — a cursor, a selection, anything — rides along by accident.
    people.push({
      uid,
      displayName: entry.displayName.slice(0, 80),
      ...(typeof entry.photoURL === 'string' && entry.photoURL
        ? { photoURL: entry.photoURL.slice(0, 512) }
        : {}),
    })
  }

  const eachSession = (
    docType: string,
    docId: string,
    room: Record<string, unknown> | null | undefined,
  ) => {
    for (const [uid, sessions] of Object.entries(room ?? {})) {
      if (!sessions || typeof sessions !== 'object') continue
      for (const entry of Object.values(sessions as Record<string, unknown>)) {
        take(docType, docId, uid, entry)
      }
    }
  }

  for (const [docType, byDoc] of Object.entries(tree ?? {})) {
    if (!byDoc || typeof byDoc !== 'object') continue
    for (const [docId, document] of Object.entries(
      byDoc as Record<string, unknown>,
    )) {
      if (!document || typeof document !== 'object') continue
      for (const [key, value] of Object.entries(
        document as Record<string, unknown>,
      )) {
        if (!value || typeof value !== 'object') continue
        if (key === 'v') {
          for (const room of Object.values(value as Record<string, unknown>)) {
            eachSession(docType, docId, room as Record<string, unknown>)
          }
          continue
        }
        // Legacy, document-scoped: `key` is a uid, its children are sessions.
        eachSession(docType, docId, { [key]: value })
      }
    }
  }
  return summary
}
