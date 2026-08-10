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
  createResourceUid,
  hostCollectionKind,
  pluginRequestFromWeb,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  billableScreenIds,
  type BillableScreenSource,
} from '../resources/count-billable-screens'
import {
  COLLECTION_TEMPLATE_SCREEN_FIELDS,
  type CollectionTemplateSource,
} from '../../../../constants/collection-templates'

/** Roles allowed to write host content — mirrors canWriteHostContent(). */
const HOST_WRITER_ROLES = new Set(['admin', 'editor'])

/** Keys the client may set; everything else is dropped rather than trusted. */
const CONTENT_KEYS = new Set(['displayName', 'slug'])
const CATALOG_KEYS = new Set([
  'name',
  'slug',
  'description',
  'mode',
  'productIds',
  'rules',
  'matchAll',
  'imageUrl',
  'order',
])

/**
 * A template-pointer write, normalized: screen id to set, or `null` to clear.
 * A key absent from the request is left alone — the entry select sends two
 * (`entryScreenId` plus the superseded `templateScreenId`), the list select
 * sends one, and neither should disturb the other.
 */
type PointerWrite = Record<string, string | null>

function readPointerWrite(data: Record<string, unknown>): PointerWrite {
  const write: PointerWrite = {}
  for (const field of COLLECTION_TEMPLATE_SCREEN_FIELDS) {
    if (!(field in data)) continue
    const value = data[field]
    // `''` has meant "cleared" in older documents, and `deleteField()` is what
    // the console used to send; both arrive here as an intent to clear.
    write[field] = typeof value === 'string' && value.trim() ? value.trim() : null
  }
  return write
}

/** The pointers a collection document holds after `write` is applied. */
function applyPointerWrite(
  existing: CollectionTemplateSource,
  write: PointerWrite,
): CollectionTemplateSource {
  const next: CollectionTemplateSource = { ...existing }
  for (const [field, value] of Object.entries(write)) {
    ;(next as Record<string, unknown>)[field] = value ?? undefined
  }
  return next
}

/**
 * Assigning, moving or clearing a collection's template screens — and the
 * second place `screensPerHost` is enforced (AGL-1390).
 *
 * The console wrote these three fields with a client `updateDoc`, and they are
 * the last exclusion `countBillableScreens` makes that the metered party can
 * both apply and REVERSE. Pointing `entryScreenId` at a live screen drops it
 * from the count; creating a screen then passes the create-time gate; clearing
 * the pointer leaves the screen counted and the host permanently one over. The
 * loop is unbounded, and collections cost nothing to create.
 *
 * Freezing the field — AGL-1383's answer for `kind` and `deletedAt` — is not
 * available, because re-pointing a collection at a different template screen is
 * something the product legitimately offers. Freezing it against a DIRECT write
 * is: `slug` and `kind` on this same document have been frozen since AGL-978
 * and AGL-954 while this route renames collections every day. So the console
 * keeps its select, and the write changes transport.
 *
 * The test is on the POST state, not on the verb. "Clear" is not a special
 * case: a lateral move from one screen to another is correctly neutral (the
 * screen let go of starts counting, the screen taken up stops), and a move onto
 * a screen that was already billable correctly costs one.
 *
 * A write that does not RAISE the count is always allowed, even when the host
 * is already over its cap. That matters: an org can end up over by legitimate
 * means — a plan downgrade, or a site import — and refusing every template edit
 * until they are back under would punish them for the wrong thing. What is
 * refused is only the raise itself, and the refusal names the screen and the
 * arithmetic, because "this screen becomes a page again" is the fact the person
 * clicking needs and the one the old silent write hid.
 */
async function writeTemplatePointers(options: {
  hostRef: FirebaseFirestore.DocumentReference
  routingMap: unknown
  orgData: Record<string, unknown> | null
  collectionId: string
  write: PointerWrite
  /** Staff bypass the cap: they already bypass the rules on this document,
   * and the gate exists against the party being metered, not against us. */
  isStaff: boolean
}): Promise<Response> {
  const { hostRef, routingMap, orgData, collectionId, write, isStaff } = options
  const collectionRef = hostRef.collection('collections').doc(collectionId)
  const [screensSnapshot, collectionsSnapshot, target] = await Promise.all([
    hostRef.collection('screens').select('kind', 'deletedAt', 'displayName').get(),
    hostRef
      .collection('collections')
      .select('slug', 'kind', ...COLLECTION_TEMPLATE_SCREEN_FIELDS)
      .get(),
    collectionRef.get(),
  ])
  if (!target.exists) {
    return Response.json({ error: 'Unknown collection' }, { status: 404 })
  }

  const screens: BillableScreenSource[] = screensSnapshot.docs.map((screen) => ({
    id: screen.id,
    kind: screen.get('kind'),
    deletedAt: screen.get('deletedAt'),
  }))
  const screenNames = new Map(
    screensSnapshot.docs.map((screen) => [
      screen.id,
      String(screen.get('displayName') ?? screen.id),
    ]),
  )
  // A pointer at a screen this host does not have designates nothing, so it
  // would silently excuse no screen and leave a dangling reference the tenant
  // runtime resolves to a 404. Rejected rather than stored.
  for (const [field, value] of Object.entries(write)) {
    if (value && !screenNames.has(value)) {
      return Response.json({
        error: `No screen ${value} on this site (${field})`,
      }, { status: 400 })
    }
  }

  const priorRows: Array<CollectionTemplateSource & { id: string }> =
    collectionsSnapshot.docs.map((row) => ({
      id: row.id,
      slug: row.get('slug'),
      kind: row.get('kind'),
      listScreenId: row.get('listScreenId'),
      entryScreenId: row.get('entryScreenId'),
      templateScreenId: row.get('templateScreenId'),
    }))
  const nextRows = priorRows.map((row) =>
    row.id === collectionId ? applyPointerWrite(row, write) : row,
  )

  const prior = billableScreenIds(screens, priorRows, routingMap as any)
  const next = billableScreenIds(screens, nextRows, routingMap as any)
  const limit = resolveOrgEntitlements(orgData as any).screensPerHost
  if (!isStaff && next.size > prior.size && next.size > limit) {
    const becamePages = [...next].filter((id) => !prior.has(id))
    const named = becamePages
      .map((id) => `“${screenNames.get(id) ?? id}”`)
      .join(', ')
    return Response.json({
      error:
        `${named || 'That screen'} becomes a page again, which puts this ` +
        `site at ${next.size} of ${limit} screens. Delete it instead, or ` +
        'upgrade in Billing.',
    }, { status: 403 })
  }

  const update: Record<string, unknown> = { updatedAt: Timestamp.now() }
  for (const [field, value] of Object.entries(write)) {
    update[field] = value ?? FieldValue.delete()
  }
  await collectionRef.update(update)
  return Response.json({ ok: true, id: collectionId }, { status: 200 })
}

/**
 * Collection create/rename with a transactional slug claim (AGL-978).
 *
 * A collection's slug is its public address — `/{slug}` for content,
 * `/collections/{slug}` for catalog — and it was only ever checked in the
 * browser against the list on screen (AGL-957). Two editors naming the same
 * thing at once both won, and the loser became unreachable with no error
 * anywhere. The site subdomain has the same property and is claimed
 * server-side for the same reason (AGL-642).
 *
 * Uniqueness is per host AND per kind: the two kinds have separate URL
 * namespaces (AGL-954), so `/blog` and `/collections/blog` may coexist.
 * The read and the write share one transaction, so a concurrent create
 * cannot slip between them.
 *
 * A third action, `templates`, owns the collection's three template-screen
 * pointers (AGL-1390) — see {@link writeTemplatePointers}. Same reason the
 * other two live here: the field decides something the client must not decide
 * for itself. There it was the collection's public address; here it is how
 * much of the plan's screen allowance the site has spent.
 */
async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  const hostId = String(body?.hostId ?? '')
  const action = String(body?.action ?? '')
  const kind = String(body?.kind ?? '')
  const data = (body?.data ?? {}) as Record<string, unknown>
  if (!hostId) return Response.json({ error: 'Missing hostId' }, { status: 400 })
  if (action !== 'create' && action !== 'update' && action !== 'templates') {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }
  // `templates` names no new document, so it carries neither a kind nor a
  // slug — both are frozen on this document anyway, and this action is the
  // one that must never touch them.
  const pointerWrite = action === 'templates' ? readPointerWrite(data) : {}
  let slug = ''
  if (action === 'templates') {
    if (!Object.keys(pointerWrite).length) {
      return Response.json({
        error: 'No template pointer in the request',
      }, { status: 400 })
    }
  } else {
    if (kind !== 'content' && kind !== 'catalog') {
      return Response.json({ error: 'Unknown collection kind' }, { status: 400 })
    }
    slug = String(data.slug ?? '').trim().toLowerCase()
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return Response.json({
        error: 'Slug must be lowercase letters, numbers, and dashes',
      }, { status: 400 })
    }
  }

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)

    const isStaff = decoded['staff'] === true
    // Read once and share: the `templates` action needs the host's routing map
    // and the owning org's entitlements, which are the same two documents the
    // role and suspension gates already look at.
    const hostSnapshot = await hostRef.get()
    let orgData: Record<string, unknown> | null = null
    if (!isStaff) {
      if (!hostSnapshot.exists) {
        return Response.json({ error: 'Unknown site' }, { status: 404 })
      }
      const memberRole = (hostSnapshot.get('memberRoles') ?? {})[decoded.uid]
      if (!HOST_WRITER_ROLES.has(String(memberRole))) {
        return Response.json({
          error: 'Editing collections requires the editor role',
        }, { status: 403 })
      }
      const orgId = hostSnapshot.get('orgId') as string | undefined
      if (orgId) {
        const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
        if (orgSnapshot.get('suspendedAt')) {
          return Response.json({
            error: 'This workspace is suspended',
          }, { status: 403 })
        }
        orgData = (orgSnapshot.data() ?? null) as Record<string, unknown> | null
      }
    }

    if (action === 'templates') {
      const collectionId = String(body?.id ?? '')
      if (!collectionId) {
        return Response.json({ error: 'Missing id' }, { status: 400 })
      }
      return await writeTemplatePointers({
        hostRef,
        routingMap: hostSnapshot.get('screens'),
        orgData,
        collectionId,
        write: pointerWrite,
        isStaff,
      })
    }

    const id = action === 'create' ? createResourceUid() : String(body?.id ?? '')
    if (action === 'update' && !id) {
      return Response.json({ error: 'Missing id' }, { status: 400 })
    }

    const allowed = kind === 'content' ? CONTENT_KEYS : CATALOG_KEYS
    const fields: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (allowed.has(key) && value !== undefined) fields[key] = value
    }
    fields.slug = slug
    fields.kind = kind

    const collectionsRef = hostRef.collection('collections')
    const result = await firestore.runTransaction(async (transaction) => {
      // The claim: same host, same slug, same kind, different document. Read
      // and write share the transaction, so a concurrent create that would
      // collide is retried rather than admitted.
      const sameSlug = await transaction.get(
        collectionsRef.where('slug', '==', slug).limit(10),
      )
      const clash = sameSlug.docs.find(
        (docSnapshot) =>
          docSnapshot.id !== id &&
          hostCollectionKind(docSnapshot.data()) === kind,
      )
      if (clash) return { taken: true as const }

      const docRef = collectionsRef.doc(id)
      if (action === 'create') {
        transaction.create(docRef, { ...fields, createdAt: Timestamp.now() })
      } else {
        const existing = await transaction.get(docRef)
        if (!existing.exists) return { missing: true as const }
        // A rename must not silently change what the document IS.
        if (hostCollectionKind(existing.data()) !== kind) {
          return { wrongKind: true as const }
        }
        transaction.set(
          docRef,
          { ...fields, updatedAt: Timestamp.now() },
          { merge: true },
        )
      }
      return { ok: true as const }
    })

    if ('taken' in result) {
      return Response.json({
        error:
          kind === 'content'
            ? `Another collection already serves /${slug}`
            : `Another collection already serves /collections/${slug}`,
      }, { status: 409 })
    }
    if ('missing' in result) {
      return Response.json({ error: 'Unknown collection' }, { status: 404 })
    }
    if ('wrongKind' in result) {
      return Response.json({
        error: 'That collection belongs to a different part of the console',
      }, { status: 409 })
    }
    return Response.json({ ok: true, id }, { status: 200 })
  } catch (error) {
    console.error(error)
    return Response.json({ error: 'Collection save failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as POST }
