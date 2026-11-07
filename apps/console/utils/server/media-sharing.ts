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

import {
  hostIdsFromScope,
  isOrgWideScope,
  normalizeVisibleTo,
  type ScopeSharingChoice,
  type ScopeSharingFields,
  sharingFromChoice,
} from '@aglyn/aglyn/app-utils/scope-tokens'
import { fieldsToWrite, orgHostIdsFromDoc } from '@aglyn/tenant-data-admin/server/scope-sharing-sweep'

/**
 * WHO A MEDIA FILE OR FOLDER IS SHARED WITH, WRITTEN BY THE SERVER (AGL-4047).
 *
 * The workspace library's sharing used to be a client write of `visibleTo`.
 * "All sites except…" adds a marker beside it, `scopeMode` and `scopeExcept`,
 * which only the server writes (the rules' `scopeMarkerUnchanged`), and on a
 * marked document `visibleTo` is the server's too. So every sharing change, on
 * one file, a selection or a folder and what is inside it, comes through
 * `POST /api/media/folders` and lands here.
 *
 * The same shape as the datasets' `set-sharing`: the workspace's sites are read
 * in the transaction that writes, so a site being created either lands first and
 * is on the list, or lands after and its sweep finds the document; a site the
 * workspace doesn't hold is dropped from a choice, never stored; and removing a
 * marker is a field delete.
 */

/** The most site ids one sharing choice may name: far past any workspace. */
const SHARING_CHOICE_MAX_IDS = 1000

/**
 * Documents one transaction writes. Each re-reads the workspace's sites, so a
 * long selection or a large folder never writes from a list read long before.
 */
export const MEDIA_SHARING_TRANSACTION_DOCS = 250

/** A sharing choice off the wire, or null for anything else. Ids are checked against the workspace after. */
export function mediaSharingChoiceFrom(value: unknown): ScopeSharingChoice | null {
  const choice = (value ?? {}) as { mode?: unknown; hostIds?: unknown; exceptHostIds?: unknown }
  const ids = (list: unknown): string[] | null =>
    Array.isArray(list) &&
    list.length <= SHARING_CHOICE_MAX_IDS &&
    list.every((id) => typeof id === 'string' && /^[^:/]+$/.test(id))
      ? (list as string[])
      : null
  if (choice.mode === 'all') return { mode: 'all' }
  if (choice.mode === 'selected') {
    const hostIds = ids(choice.hostIds)
    return hostIds && { mode: 'selected', hostIds }
  }
  if (choice.mode === 'allExcept') {
    const exceptHostIds = ids(choice.exceptHostIds)
    return exceptHostIds && { mode: 'allExcept', exceptHostIds }
  }
  return null
}

/**
 * The choice an older client's `set-scope` means: its `visibleTo` is All sites
 * or the sites it names. Null for a scope that can't be stored. Read as a choice
 * so the write removes a marker the document carries, rather than leaving one
 * that describes sharing it no longer has.
 */
export function mediaSharingChoiceFromScope(visibleTo: unknown): ScopeSharingChoice | null {
  const scope = normalizeVisibleTo(Array.isArray(visibleTo) ? (visibleTo as string[]) : [])
  if (!scope) return null
  if (isOrgWideScope(scope)) return { mode: 'all' }
  return { mode: 'selected', hostIds: hostIdsFromScope(scope) }
}

/**
 * What a choice writes given the workspace's sites, or why it can't be. A chosen
 * site the workspace doesn't hold is dropped first, as the datasets' route does.
 */
export function mediaSharingFields(
  choice: ScopeSharingChoice,
  orgHostIds: readonly string[],
): ReturnType<typeof sharingFromChoice> {
  return sharingFromChoice(
    choice.mode === 'selected'
      ? { mode: 'selected', hostIds: choice.hostIds.filter((id) => orgHostIds.includes(id)) }
      : choice,
    orgHostIds,
  )
}

export type MediaSharingWrite =
  | { ok: false; problem: string }
  | {
      ok: true
      problem: null
      /** The ids of the documents written. */
      writtenIds: string[]
      /** Asked for and not there, or deleted: nothing to share. */
      missingIds: string[]
      fields: ScopeSharingFields | null
    }

/**
 * Writes one sharing choice onto media and folder documents of the workspace
 * library, `MEDIA_SHARING_TRANSACTION_DOCS` at a time.
 *
 * Nothing is written when the choice can't be: "Selected sites" with none left,
 * nothing left out, or everything left out. That answer is the same for every
 * document, so it comes from the first transaction, before any write.
 */
export async function writeMediaSharing(options: {
  firestore: FirebaseFirestore.Firestore
  orgRef: FirebaseFirestore.DocumentReference
  refs: readonly FirebaseFirestore.DocumentReference[]
  choice: ScopeSharingChoice
}): Promise<MediaSharingWrite> {
  const { firestore, orgRef, refs, choice } = options
  const writtenIds: string[] = []
  const missingIds: string[] = []
  let written: ScopeSharingFields | null = null
  for (let index = 0; index < Math.max(refs.length, 1); index += MEDIA_SHARING_TRANSACTION_DOCS) {
    const chunk = refs.slice(index, index + MEDIA_SHARING_TRANSACTION_DOCS)
    const answer = await firestore.runTransaction(async (tx) => {
      const [org, ...docs] = await tx.getAll(orgRef, ...chunk)
      const shared = mediaSharingFields(choice, orgHostIdsFromDoc(org.data()))
      if (!shared.fields) return { problem: shared.problem, written: [], missing: [], fields: null }
      const done: string[] = []
      const gone: string[] = []
      for (const snapshot of docs) {
        if (!snapshot.exists || snapshot.get('deletedAt')) {
          gone.push(snapshot.id)
          continue
        }
        tx.update(snapshot.ref, fieldsToWrite(shared.fields))
        done.push(snapshot.id)
      }
      return { problem: null, written: done, missing: gone, fields: shared.fields }
    })
    if (answer.problem) return { ok: false, problem: answer.problem }
    writtenIds.push(...answer.written)
    missingIds.push(...answer.missing)
    written = answer.fields
  }
  return { ok: true, problem: null, writtenIds, missingIds, fields: written }
}
