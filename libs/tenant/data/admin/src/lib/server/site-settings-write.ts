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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { SCREEN_ROOT_PATH } from '@aglyn/aglyn/app-utils/screen-route'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'

/**
 * A SITE SETTING SAVED ON THE SERVER, AND THE CACHE DROP IT OWES (AGL-4235).
 *
 * A site's settings live on its host document and the tenant renders them
 * straight off it: there is no draft and no publish step. The console saves
 * them from the browser through `host-document-writes.ts`, which commits a
 * site-wide publish outbox entry beside the write and then drops every cached
 * page of the site. A server writer owes the same two things, and this is the
 * one copy of them: the AI build's settings step and the public API's search
 * listing and business details saves all write through it.
 *
 * 1. In the transaction that read the site: the changed paths, `updatedAt`,
 *    and a site-wide outbox entry (`entireHost`), so the drop is written down
 *    whether or not the process lives to send it.
 * 2. After it commits: {@link settleSiteSettingsCache} drops the site's
 *    cached pages, and releases the entry only when the drop certainly
 *    happened. Anything else leaves it for the console's drain.
 */

/** One change to the host document: a value set at a dotted path, or the path deleted. */
export interface SiteSettingsChange {
  path: string
  value?: unknown
  /** The field is deleted rather than set; `value` is then ignored. */
  remove?: true
}

/** What a transaction stages a site-settings write into. */
export interface SiteSettingsTransaction {
  update(ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>): unknown
  set(ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>): unknown
}

/**
 * Stages the changes on the host and the site-wide outbox entry beside them,
 * in the caller's transaction, and answers the entry's id. `changes` must not
 * be empty: a write that changes nothing owes no drop and should not be made.
 */
export function stageSiteSettingsWrite(
  tx: SiteSettingsTransaction,
  firestore: Firestore,
  input: {
    hostRef: FirebaseFirestore.DocumentReference
    hostId: string
    changes: readonly SiteSettingsChange[]
    now: Date
  },
): string {
  const updates: Record<string, unknown> = { updatedAt: input.now }
  for (const change of input.changes) {
    updates[change.path] = change.remove ? FieldValue.delete() : change.value
  }
  tx.update(input.hostRef, updates)
  // The announce, written down in the save's own transaction: a setting has
  // no address, so it asks for the whole site, as the console's does.
  const outboxRef = firestore.collection('publishOutbox').doc(createResourceUid())
  tx.set(outboxRef, {
    hostId: input.hostId,
    paths: [SCREEN_ROOT_PATH],
    entireHost: true,
    createdAt: FieldValue.serverTimestamp(),
    attempts: 0,
  })
  return outboxRef.id
}

/** A stored value at a dotted path, or `undefined`. */
export function siteSettingAt(data: Record<string, unknown> | null | undefined, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (at, key) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined),
      data ?? undefined,
    )
}

/** Whether a stored value is there: not absent, not null, not a blank string. */
export function siteSettingStored(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === 'string' && value.trim() === '')
}

/** Whether two values are the same setting, compared as stored JSON. */
export function sameSiteSetting(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

/**
 * The host data as it reads once `changes` land: a new object, `data` left
 * as it was. For answering with what a write stored without reading it back.
 */
export function applySiteSettingsChanges(
  data: Record<string, unknown> | null | undefined,
  changes: readonly SiteSettingsChange[],
): Record<string, unknown> {
  // Copied along each changed path only: the rest of the document is shared,
  // and may hold values (timestamps, references) that are not plain data.
  const next: Record<string, unknown> = { ...(data ?? {}) }
  for (const change of changes) {
    const keys = change.path.split('.')
    const leaf = keys.pop() as string
    let node: Record<string, unknown> | null = next
    for (const key of keys) {
      const child: unknown = node[key]
      const isMap = Boolean(child) && typeof child === 'object' && !Array.isArray(child)
      if (!isMap && change.remove) {
        node = null
        break
      }
      const copy: Record<string, unknown> = isMap ? { ...(child as Record<string, unknown>) } : {}
      node[key] = copy
      node = copy
    }
    if (!node) continue
    if (change.remove) delete node[leaf]
    else node[leaf] = change.value
  }
  return next
}

/** What a site-settings save asks of the host it read. */
export type SiteSettingsPlan<R> =
  | { refuse: R }
  | { changes: readonly SiteSettingsChange[] }

export type SiteSettingsWrite<R> =
  | { ok: false; refusal: R }
  | { ok: false; missing: true }
  | {
      ok: true
      /** The host data as it reads now, the write applied. */
      host: Record<string, unknown>
      /** The paths written; empty when nothing differed and nothing was written. */
      changed: string[]
      outboxId: string | null
    }

/**
 * One site-settings save: a transaction that reads the host as it is stored
 * NOW, asks `plan` what to change from that, and writes only those changes
 * with the outbox entry beside them. A plan that changes nothing writes
 * nothing and announces nothing. The caller then settles the cache with
 * {@link settleSiteSettingsCache} when `outboxId` is set.
 */
export async function writeSiteSettings<R>(
  firestore: Firestore,
  input: {
    hostId: string
    now: Date
    plan: (host: Record<string, unknown>, snapshot: FirebaseFirestore.DocumentSnapshot) => SiteSettingsPlan<R>
  },
): Promise<SiteSettingsWrite<R>> {
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  return firestore.runTransaction(async (tx): Promise<SiteSettingsWrite<R>> => {
    const snapshot = await tx.get(hostRef)
    if (!snapshot.exists) return { ok: false, missing: true }
    const host = (snapshot.data() ?? {}) as Record<string, unknown>
    const plan = input.plan(host, snapshot)
    if ('refuse' in plan) return { ok: false, refusal: plan.refuse }
    if (!plan.changes.length) return { ok: true, host, changed: [], outboxId: null }
    const outboxId = stageSiteSettingsWrite(tx, firestore, {
      hostRef,
      hostId: input.hostId,
      changes: plan.changes,
      now: input.now,
    })
    return {
      ok: true,
      host: { ...applySiteSettingsChanges(host, plan.changes), updatedAt: input.now },
      changed: plan.changes.map((change) => change.path),
      outboxId,
    }
  })
}

/**
 * Drops every cached page of the site after a settings write, and releases
 * its outbox entry only when the drop certainly happened. Never throws: the
 * write has landed, and an entry left behind is the drain's to fire.
 */
export async function settleSiteSettingsCache(
  firestore: Firestore,
  input: { hostId: string; outboxId: string; reason: string },
  deps: { dropCache?: typeof dropPluginSiteCache } = {},
): Promise<boolean> {
  const dropCache = deps.dropCache ?? dropPluginSiteCache
  const dropped = await dropCache({ hostIds: [input.hostId], reason: input.reason }).catch(() => ({ complete: false }))
  if (!dropped.complete) return false
  await firestore
    .collection('publishOutbox')
    .doc(input.outboxId)
    .delete()
    .catch(() => undefined)
  return true
}
