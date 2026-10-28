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

import { createHash } from 'node:crypto'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import { emailUnverifiedResponse, firebaseAdmin, isImpersonationSession } from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import {
  POS_READER_SPLASH_FAMILIES,
  POS_READER_SPLASH_MAX_BYTES,
  posReaderSplashFamily,
  posReaderSplashImageProblem,
} from '../model/pos-reader-splash'
import {
  applyPosReaderSplashToStores,
  platformSplashReady,
  platformSplashRef,
  posReaderSplashBucket,
  readPlatformSplash,
  type PlatformSplashDoc,
  type PlatformSplashImage,
} from './pos-reader-splash'
import { posReaderSplashImageFacts } from './pos-reader-splash-render'

/*==========================================
 * `/api/commerce/admin/reader-splash` (AGL-4048): the platform's default
 * card reader start-up screen, for Staff → Reader start-up screen.
 *
 *   GET                       each family's screen, as metadata
 *   GET  ?preview={family}    that family's image itself
 *   POST upload    { family, contentType, dataBase64 }
 *   POST remove    { family }
 *   POST apply                put the current default on every store that
 *                             uses it (the page calls it after a change)
 *
 * The artwork is designed separately and uploaded here; none is kept in
 * the repository. Each image is checked against Stripe's rules for its
 * family before it is stored: PNG or JPEG, under 2 MB, exactly the reader's
 * screen. The S700/S710 screen is the one that turns the default on; the
 * WisePOS E screen is drawn from it when staff upload none.
 *
 * Staff only. Reading is open to every staff role; every write is `super`,
 * because it changes what every non-white-label store's readers show. Every
 * write is an `adminAudit` row. The images live in storage under
 * `platform/commerce/pos-reader-splash/`, which no client rule opens.
 *=========================================*/

const WRITE_ROLES = ['super']

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

function view(doc: PlatformSplashDoc) {
  return {
    ready: platformSplashReady(doc),
    families: POS_READER_SPLASH_FAMILIES.map((family) => {
      const image = doc.families?.[family.id]
      return {
        id: family.id,
        label: family.label,
        width: family.width,
        height: family.height,
        image: image
          ? {
              contentType: image.contentType,
              bytes: image.bytes,
              sha256: image.sha256,
              uploadedAtMs: image.uploadedAtMs,
            }
          : null,
      }
    }),
    updatedAtMs: doc.updatedAtMs ?? null,
  }
}

export type StaffReaderSplashView = ReturnType<typeof view>

/**
 * An uploaded screen's format and size, read here where this process can
 * draw, else by the images function (AGL-4048), which ships `sharp`.
 */
async function uploadedImageFacts(body: Buffer): Promise<{ contentType: string; width: number; height: number } | null> {
  const images = await import('./pos-reader-splash-images')
  const origin = images.posReaderSplashImagesOrigin()
  if (!origin) {
    const { loadSharp } = await import('./pos-reader-splash-server')
    return posReaderSplashImageFacts((await loadSharp()) as any, body)
  }
  try {
    const answer = await images.requestPosReaderSplashImages<{
      facts: { contentType: string; width: number; height: number } | null
    }>(origin, { op: 'facts', dataBase64: body.toString('base64') })
    return answer.facts
  } catch (error) {
    if (error instanceof images.PosReaderSplashImagesRefusal) return null
    throw error
  }
}

async function upload(
  doc: PlatformSplashDoc,
  input: Record<string, unknown>,
  uid: string,
): Promise<{ error: string; status: number } | { image: PlatformSplashImage; familyId: string }> {
  const family = posReaderSplashFamily(input['family'])
  if (!family) return { error: 'Unknown reader family', status: 400 }
  const raw = String(input['dataBase64'] ?? '')
  // A base64 body is 4/3 of the file; anything longer cannot be under 2 MB.
  if (!raw || raw.length > Math.ceil((POS_READER_SPLASH_MAX_BYTES * 4) / 3) + 4) {
    return { error: 'Use an image under 2 MB.', status: 400 }
  }
  const body = Buffer.from(raw, 'base64')
  const facts = await uploadedImageFacts(body)
  if (!facts) return { error: 'That image could not be read.', status: 400 }
  // The bytes decide the type, never the name or the browser's claim.
  const problem = posReaderSplashImageProblem({ ...facts, bytes: body.length }, family)
  if (problem) return { error: problem, status: 400 }
  const sha256 = createHash('sha256').update(body).digest('hex')
  const extension = facts.contentType === 'image/png' ? 'png' : 'jpg'
  const storagePath = `platform/commerce/pos-reader-splash/${family.id}-${sha256.slice(0, 16)}.${extension}`
  await posReaderSplashBucket()
    .file(storagePath)
    .save(body, { contentType: facts.contentType, resumable: false })
  const previous = doc.families?.[family.id]
  if (previous?.storagePath && previous.storagePath !== storagePath) {
    await posReaderSplashBucket().file(previous.storagePath).delete().catch(() => undefined)
  }
  return {
    familyId: family.id,
    image: {
      storagePath,
      sha256,
      contentType: facts.contentType as PlatformSplashImage['contentType'],
      bytes: body.length,
      uploadedAtMs: Date.now(),
      uploadedBy: uid,
    },
  }
}

/**
 * Every store with a Location, its screen brought up to the current default.
 * One `apply` reaches `POS_READER_SPLASH_SWEEP_WINDOW` stores; staff
 * press it again for the rest.
 */
async function applyToEveryStore() {
  return applyPosReaderSplashToStores({ platform: await readPlatformSplash() })
}

async function handler(request: Request): Promise<Response> {
  const { method, query, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
  if (!idToken) return json({ error: 'Unauthenticated' }, 401)

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) return emailUnverifiedResponse()
    if (!decoded['staff']) return json({ error: 'Staff only' }, 403)
    // A missing role claim reads as the least one, never as super.
    const role = String(decoded['staffRole'] ?? 'support')
    const firestore = firebaseAdmin.app().firestore()
    const doc = await readPlatformSplash()

    if (method === 'GET') {
      const preview = String(query?.['preview'] ?? '')
      if (preview) {
        const family = posReaderSplashFamily(preview)
        const image = family ? doc.families?.[family.id] : undefined
        if (!image) return json({ error: 'No image' }, 404)
        const [bytes] = (await posReaderSplashBucket().file(image.storagePath).download()) as [Buffer]
        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: { 'Content-Type': image.contentType, 'Cache-Control': 'no-store' },
        })
      }
      return json({ ...view(doc), canWrite: WRITE_ROLES.includes(role) })
    }

    if (method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    if (!WRITE_ROLES.includes(role)) {
      return json({ error: 'Changing the reader start-up screen requires the super staff role.' }, 403)
    }
    const input = (body ?? {}) as Record<string, unknown>
    const action = String(input['action'] ?? '')
    const actor = { actorUid: decoded.uid, actorEmail: decoded.email ? String(decoded.email) : null }

    if (action === 'apply') return json({ ok: true, ...(await applyToEveryStore()) })

    if (action === 'upload' || action === 'remove') {
      let next: PlatformSplashDoc
      let familyId: string
      if (action === 'upload') {
        const outcome = await upload(doc, input, decoded.uid)
        if ('error' in outcome) return json({ error: outcome.error }, outcome.status)
        familyId = outcome.familyId
        next = { families: { ...(doc.families ?? {}), [familyId]: outcome.image }, updatedAtMs: Date.now() }
      } else {
        const family = posReaderSplashFamily(input['family'])
        if (!family) return json({ error: 'Unknown reader family' }, 400)
        familyId = family.id
        const families = { ...(doc.families ?? {}) }
        const previous = families[family.id]
        delete families[family.id]
        if (previous?.storagePath) {
          await posReaderSplashBucket().file(previous.storagePath).delete().catch(() => undefined)
        }
        next = { families, updatedAtMs: Date.now() }
      }
      await platformSplashRef().set(next)
      await addAdminAudit(firestore, {
        action: `pos-reader-splash-${action}`,
        ...actor,
        scope: 'posReaderSplash',
        target: `platformSettings/posReaderSplash`,
        before: { family: familyId, sha256: doc.families?.[familyId as keyof typeof doc.families]?.sha256 ?? null },
        after: { family: familyId, sha256: next.families?.[familyId as keyof typeof next.families]?.sha256 ?? null },
        at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      })
      return json({ ok: true, ...view(next), canWrite: true })
    }
    return json({ error: 'Unknown action' }, 400)
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[pos-reader-splash-admin]', error)
    return json({ error: 'The reader start-up screen could not be updated' }, 500)
  }
}

export { handler as posReaderSplashAdmin }
