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

import * as Aglyn from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { type PluginApiHandler } from '@aglyn/aglyn/server'
import * as CommerceModel from '../model'

/*
 * RE-STAMP A SMART COLLECTION'S MEMBERSHIP ON THE PRODUCTS (AGL-3321).
 *
 * The storefront reads a smart collection whose rules no query can express as
 * `collectionIds array-contains <id>`, so the membership lives on each
 * product. Product writers stamp it from the rules as they stand; when the
 * RULES change — a smart collection is created, edited or deleted — every
 * product of the site may move, and this is the one place that moves them.
 * The catalog card calls it after each save and delete.
 *
 * It only ever adds or removes THIS collection's id, and writes only a
 * product whose membership differs, so running it twice changes nothing the
 * second time and a run cut short is finished by the next. A collection that
 * is gone (or no longer smart) is taken off every product still naming it.
 *
 * Bounded per request: it walks the products in document-id order, at most
 * {@link MEMBERSHIP_SCAN_MAX} of them, and answers with a cursor the caller
 * passes back until `done`.
 */

/** Products read (and written) per batch. */
export const MEMBERSHIP_PAGE = 300
/** Products one request walks before it hands back a cursor. */
export const MEMBERSHIP_SCAN_MAX = 3000

export interface MembershipPass {
  done: boolean
  /** Where the next request starts, when not done. */
  after?: string
  scanned: number
  updated: number
}

/**
 * An allowlist (AGL-2372): the roles `/api/hosts/collections` lets edit a
 * collection, since whoever may change the rules may move what they match.
 */
const COLLECTION_EDITORS = new Set(['admin', 'editor', 'author'])

/**
 * One bounded pass: every product from `after` onward, up to the scan cap,
 * given this collection's membership as the rules now say.
 */
export async function restampCollectionMembership(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  collectionId: string,
  after?: string,
): Promise<MembershipPass> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const collectionSnapshot = await hostRef.collection('collections').doc(collectionId).get()
  const data = collectionSnapshot.exists ? collectionSnapshot.data() : undefined
  const smart =
    data && Aglyn.hostCollectionKind(data) === 'catalog' && data['mode'] === 'smart'
      ? (data as CommerceModel.HostCollection)
      : null
  const { FieldValue, FieldPath } = firebaseAdmin.firestore
  const productsRef = hostRef.collection('products')
  let scanned = 0
  let updated = 0

  if (!smart) {
    // Gone, or no longer smart: off every product that still names it.
    for (;;) {
      const page = await productsRef
        .where(CommerceModel.PRODUCT_COLLECTION_IDS, 'array-contains', collectionId)
        .limit(MEMBERSHIP_PAGE)
        .get()
      if (page.empty) break
      const batch = firestore.batch()
      for (const entry of page.docs) {
        batch.update(entry.ref, {
          [CommerceModel.PRODUCT_COLLECTION_IDS]: FieldValue.arrayRemove(collectionId),
        })
      }
      await batch.commit()
      scanned += page.size
      updated += page.size
      if (page.size < MEMBERSHIP_PAGE || scanned >= MEMBERSHIP_SCAN_MAX) {
        return { done: page.size < MEMBERSHIP_PAGE, scanned, updated }
      }
    }
    return { done: true, scanned, updated }
  }

  let cursor = after
  while (scanned < MEMBERSHIP_SCAN_MAX) {
    let pageQuery = productsRef.orderBy(FieldPath.documentId()).limit(MEMBERSHIP_PAGE)
    if (cursor) pageQuery = pageQuery.startAfter(cursor)
    const page = await pageQuery.get()
    if (page.empty) return { done: true, scanned, updated }
    const batch = firestore.batch()
    let writes = 0
    for (const entry of page.docs) {
      const stored = entry.data() as Partial<CommerceModel.HostProduct>
      const member = CommerceModel.smartCollectionMatches(
        CommerceModel.liftLegacyProduct(stored),
        smart,
      )
      const holds = (stored.collectionIds ?? []).includes(collectionId)
      if (member === holds) continue
      batch.update(entry.ref, {
        [CommerceModel.PRODUCT_COLLECTION_IDS]: member
          ? FieldValue.arrayUnion(collectionId)
          : FieldValue.arrayRemove(collectionId),
      })
      writes += 1
    }
    if (writes) await batch.commit()
    scanned += page.size
    updated += writes
    cursor = page.docs[page.docs.length - 1].id
    if (page.size < MEMBERSHIP_PAGE) return { done: true, scanned, updated }
  }
  return { done: false, after: cursor, scanned, updated }
}

/** `POST /api/commerce/collection-membership` — `{ hostId, collectionId, after? }`. */
export const collectionMembershipHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })
  const body =
    typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
  const hostId = String(body.hostId ?? '')
  const collectionId = String(body.collectionId ?? '')
  const after = typeof body.after === 'string' && body.after ? body.after : undefined
  if (!hostId || !collectionId) {
    return res.status(400).json({ error: 'Missing hostId or collectionId' })
  }
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const firestore = firebaseAdmin.app().firestore()
    const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
    if (!hostSnapshot.exists) return res.status(404).json({ error: 'Unknown site' })
    const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
    if (decoded['staff'] !== true && !COLLECTION_EDITORS.has(String(memberRole))) {
      return res.status(403).json({ error: 'Not permitted' })
    }
    const pass = await restampCollectionMembership(firestore, hostId, collectionId, after)
    return res.status(200).json(pass)
  } catch (error) {
    console.error('collection-membership', error)
    return res.status(500).json({ error: 'Collection membership failed' })
  }
}
