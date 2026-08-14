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
  SCREEN_KIND_EMAIL,
  SCREEN_KIND_TEMPLATE,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  getLockdownVerdict,
  isImpersonationSession,
  lockdownJsonResponse,
} from '@aglyn/tenant-data-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import { COLLECTION_TEMPLATE_SCREEN_FIELDS } from '../../../../constants/collection-templates'

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

/**
 * The pointers that designate an ENTRY template — the screens that are not
 * pages of the site (AGL-1400).
 *
 * `listScreenId` is deliberately absent. `/{collectionSlug}` renders a list
 * template as an ordinary designed page (AGL-1387), so it stays `kind: 'page'`,
 * stays billable, and stays served. That also closes by ARITHMETIC the door
 * AGL-1390 had to close by refusal: a `listScreenId` on a catalog-kind or
 * slugless collection — where AGL-1387's condition stopped — now excuses
 * nothing at all, because it converts nothing.
 */
const ENTRY_TEMPLATE_FIELDS = ['entryScreenId', 'templateScreenId'] as const

/**
 * Assigning, moving or clearing a collection's template screens — and where a
 * page becomes a template (AGL-1400).
 *
 * Until AGL-1400 this route was the second enforcement point for
 * `screensPerHost`: the pointer was what excused a screen from the count, so
 * pointing it lowered the count and clearing it raised one, and AGL-1390 had to
 * evaluate every write against the state it would leave and REFUSE the raise.
 * The refusal was correct and it was also the wrong shape — it could tell
 * somebody they were not allowed to stop using a template until they deleted a
 * page.
 *
 * The pointer is a pointer again. What the write now does is stamp the SCREEN:
 * designating an entry template demotes it to `kind: 'template'`, which is a
 * property of its own document, and from then on nothing about the collection
 * decides what the site pays. Consequences worth stating:
 *
 *  - **No cap check here, in either direction.** Demotion lowers the count;
 *    clearing or moving a pointer changes nothing, because the screen let go of
 *    stays a template. Promotion — the one write that raises the count — is the
 *    deliberate act on /api/hosts/screens, checked exactly like a create.
 *  - **A cleared pointer leaves an orphan template**, not a page. That is the
 *    asymmetry on purpose: nobody is refused a pointer edit, and getting the
 *    page back is one explicit click that meets the same gate a create does.
 *  - **An email document is never converted.** Overwriting `kind` there would
 *    move it off the Emails page — a destructive edit dressed as a quota one.
 */
async function writeTemplatePointers(options: {
  firestore: FirebaseFirestore.Firestore
  hostRef: FirebaseFirestore.DocumentReference
  collectionId: string
  write: PointerWrite
}): Promise<Response> {
  const { firestore, hostRef, collectionId, write } = options
  const collectionRef = hostRef.collection('collections').doc(collectionId)
  const [screensSnapshot, target] = await Promise.all([
    hostRef.collection('screens').select('kind', 'deletedAt', 'displayName').get(),
    collectionRef.get(),
  ])
  if (!target.exists) {
    return Response.json({ error: 'Unknown collection' }, { status: 404 })
  }

  const screenKinds = new Map(
    screensSnapshot.docs.map((screen) => [screen.id, screen.get('kind')]),
  )
  // A pointer at a screen this host does not have designates nothing, so it
  // would leave a dangling reference the tenant runtime resolves to a 404.
  // Rejected rather than stored.
  for (const [field, value] of Object.entries(write)) {
    if (value && !screenKinds.has(value)) {
      return Response.json({
        error: `No screen ${value} on this site (${field})`,
      }, { status: 400 })
    }
  }

  const update: Record<string, unknown> = { updatedAt: Timestamp.now() }
  for (const [field, value] of Object.entries(write)) {
    update[field] = value ?? FieldValue.delete()
  }

  const demote = new Set<string>()
  for (const field of ENTRY_TEMPLATE_FIELDS) {
    const screenId = write[field]
    if (!screenId) continue
    const kind = screenKinds.get(screenId)
    if (kind === SCREEN_KIND_EMAIL || kind === SCREEN_KIND_TEMPLATE) continue
    demote.add(screenId)
  }

  const batch = firestore.batch()
  batch.update(collectionRef, update)
  for (const screenId of demote) {
    batch.update(hostRef.collection('screens').doc(screenId), {
      kind: SCREEN_KIND_TEMPLATE,
      updatedAt: Timestamp.now(),
    })
  }
  await batch.commit()
  return Response.json({
    ok: true,
    id: collectionId,
    ...(demote.size ? { converted: [...demote] } : {}),
  }, { status: 200 })
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
 * pointers — see {@link writeTemplatePointers}. It arrived as an enforcement
 * point (AGL-1390: the pointer was an input to `screensPerHost`) and AGL-1400
 * took that job away from it; what it still owns is the CONVERSION that goes
 * with designating an entry template, which is a fact about the screen and so
 * must be stamped server-side.
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
    const hostSnapshot = await hostRef.get()
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
      const orgData = orgId
        ? (await firestore.collection('orgs').doc(orgId).get()).data()
        : undefined
      // Lockdown verdict (AGL-1501): subsumes the old bare `suspendedAt`
      // check — same reads, plus platform/host/user scopes and the distinct
      // 423 body. This branch is non-staff only, so no bypass flag needed.
      //
      // Audited for read-only (AGL-1625) and left deriving from the method.
      // Three actions reach this point — `create`, `update`, `templates` —
      // and all three mutate (the first two through the slug transaction,
      // the third through `writeTemplatePointers`). Any fourth value is
      // refused as unknown before the verdict runs, so the branch below the
      // verdict cannot be a read.
      const lockdown = await getLockdownVerdict({
        request,
        uid: decoded.uid,
        org: orgData,
        host: hostSnapshot.data(),
      })
      if (lockdown) return lockdownJsonResponse(lockdown)
    }

    if (action === 'templates') {
      const collectionId = String(body?.id ?? '')
      if (!collectionId) {
        return Response.json({ error: 'Missing id' }, { status: 400 })
      }
      return await writeTemplatePointers({
        firestore,
        hostRef,
        collectionId,
        write: pointerWrite,
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
