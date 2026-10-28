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

import { csvDocument } from '@aglyn/aglyn/app-utils/csv-import'
import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import { contactIdentityForGroup } from '@aglyn/aglyn/app-utils/contacts'
import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import { readPluginPeople } from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import { WAIVERS_PERMISSIONS } from '../constants/bundle-common'
import { dayKeyIn, isDayKey } from '../model/waiver'
import {
  WAIVER_SIGNATURE_CSV_HEADER,
  parseSignatureSearch,
  signatureCsvRow,
  signatureRow,
  waiverDayStatus,
  waiverStatusLabel,
  type StoredWaiverSignature,
} from '../model/waiver-signature'
import { WAIVER_NOT_MATCHED_LABEL, waiverMatchName, waiverNameDobKey } from '../model/waiver-match'
import { isDocumentId, waiversFiles, waiversRefs } from './db'
import { signaturePdf, signaturePdfFilename } from './documents'
import { json, refuse, waiversGate, type WaiversStaff } from './gate'
import { readStoredSignature, recordPaperSignature, recordSignature, siteBusinessName, waiversNow } from './sign'

/*==========================================
 * A SITE'S SIGNATURES (AGL-4042): personal data, so every route here needs
 * `collectWaivers` (or `manageWaivers`, which may void). Each list is a
 * Firestore query with its own index: by day, by email, by any word of a
 * signer's or a minor's name, each optionally narrowed to one waiver,
 * newest first.
 *=========================================*/

const READERS = [WAIVERS_PERMISSIONS.collect, WAIVERS_PERMISSIONS.manage] as const
const PAGE = 200
const CSV_MAX = 5000

function signaturesQuery(staff: WaiversStaff, params: URLSearchParams) {
  let query = waiversRefs.signatures(staff.orgId).where('hostId', '==', staff.hostId) as FirebaseFirestore.Query
  const waiverId = params.get('waiverId')
  if (waiverId && isDocumentId(waiverId)) query = query.where('waiverId', '==', waiverId)
  const search = parseSignatureSearch(params.get('q'))
  if (search.kind === 'email') query = query.where('emailLower', '==', search.value)
  if (search.kind === 'day') query = query.where('dayKey', '==', search.value)
  if (search.kind === 'name') query = query.where('nameTokens', 'array-contains', search.value)
  return query.orderBy('signedAtMs', 'desc')
}

/** `GET waivers/signatures?hostId=&q=&waiverId=&limit=&after=` (`format=csv` for the whole match as a spreadsheet). */
export async function signaturesRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return refuse(405, 'Method not allowed')
  const staff = await waiversGate(request, { permission: READERS })
  if (staff instanceof Response) return staff
  const params = new URL(request.url).searchParams
  const base = signaturesQuery(staff, params)
  if (params.get('format') === 'csv') {
    const rows: string[][] = []
    let cursor: number | null = null
    while (rows.length < CSV_MAX) {
      const page = await (cursor === null ? base : base.where('signedAtMs', '<', cursor)).limit(500).get()
      for (const doc of page.docs) {
        const signature = readStoredSignature(doc.data()) as StoredWaiverSignature
        rows.push(signatureCsvRow(signature, staff.timeZone))
      }
      if (page.size < 500) break
      cursor = Number(page.docs[page.docs.length - 1].get('signedAtMs'))
    }
    const day = dayKeyIn(waiversNow(), staff.timeZone)
    return new Response(csvDocument(WAIVER_SIGNATURE_CSV_HEADER, rows), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="waiver-signatures-${day}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }
  // Paged by the last row's document, so two signatures in the same
  // millisecond are neither skipped nor repeated.
  const size = Math.min(PAGE, Math.max(5, Math.trunc(Number(params.get('limit')) || 25)))
  const after = params.get('after')
  let query = base
  if (after && isDocumentId(after)) {
    const cursor = await waiversRefs.signature(staff.orgId, after).get()
    if (cursor.exists && cursor.get('hostId') === staff.hostId) query = query.startAfter(cursor)
  }
  const snapshot = await query.limit(size + 1).get()
  const docs = snapshot.docs.slice(0, size)
  return json({
    signatures: docs.map((doc) => signatureRow(readStoredSignature(doc.data()) as StoredWaiverSignature)),
    next: snapshot.size > size ? docs[docs.length - 1].id : null,
    timeZone: staff.timeZone,
  })
}

async function readSiteSignature(staff: WaiversStaff, signatureId: unknown): Promise<StoredWaiverSignature | null> {
  if (!isDocumentId(signatureId)) return null
  const snapshot = await waiversRefs.signature(staff.orgId, signatureId).get()
  const signature = snapshot.exists ? readStoredSignature(snapshot.data()) : null
  return signature && signature.hostId === staff.hostId ? signature : null
}

/** What the detail view shows: everything but the stored file paths. */
function detail(signature: StoredWaiverSignature) {
  return {
    ...signature,
    signature:
      signature.signature.kind === 'drawn'
        ? { kind: 'drawn', strokes: signature.signature.strokes, hasImage: Boolean(signature.signature.imagePath) }
        : signature.signature,
    paper: signature.paper
      ? { ...signature.paper, photoPath: undefined, hasPhoto: Boolean(signature.paper.photoPath) }
      : null,
  }
}

/** `GET waivers/signature?hostId=&signatureId=`: one record. `POST {action: 'void', reason}`: void it. */
export async function signatureRoute(request: Request): Promise<Response> {
  if (request.method === 'GET') {
    const staff = await waiversGate(request, { permission: READERS })
    if (staff instanceof Response) return staff
    const signature = await readSiteSignature(staff, new URL(request.url).searchParams.get('signatureId'))
    if (!signature) return refuse(404, 'Unknown signature')
    return json({ signature: detail(signature), timeZone: staff.timeZone })
  }
  if (request.method !== 'POST') return refuse(405, 'Method not allowed')
  const staff = await waiversGate(request, { permission: WAIVERS_PERMISSIONS.manage })
  if (staff instanceof Response) return staff
  if (staff.body['action'] !== 'void') return refuse(400, 'Unknown action')
  const signature = await readSiteSignature(staff, staff.body['signatureId'])
  if (!signature) return refuse(404, 'Unknown signature')
  if (signature.voidedAt) return json({ signature: detail(signature) })
  const reason = String(staff.body['reason'] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
  if (!reason) return refuse(400, 'Say why it is being voided, so the record explains itself.')
  const voided = { voidedAt: waiversNow(), voidedBy: staff.uid, voidReason: reason }
  await waiversRefs.signature(staff.orgId, signature.id).update(voided)
  return json({ signature: detail({ ...signature, ...voided }) })
}

/** `GET waivers/signature-pdf?hostId=&signatureId=`: the signed copy. */
export async function signaturePdfRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return refuse(405, 'Method not allowed')
  const staff = await waiversGate(request, { permission: READERS })
  if (staff instanceof Response) return staff
  const signature = await readSiteSignature(staff, new URL(request.url).searchParams.get('signatureId'))
  if (!signature) return refuse(404, 'Unknown signature')
  const bytes = signaturePdf(signature, siteBusinessName(staff.host))
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${signaturePdfFilename(signature)}"`,
      'Cache-Control': 'no-store',
    },
  })
}

/** `GET waivers/signature-file?hostId=&signatureId=&kind=signature|paper`: the drawn signature or the paper photo. */
export async function signatureFileRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return refuse(405, 'Method not allowed')
  const staff = await waiversGate(request, { permission: READERS })
  if (staff instanceof Response) return staff
  const params = new URL(request.url).searchParams
  const signature = await readSiteSignature(staff, params.get('signatureId'))
  if (!signature) return refuse(404, 'Unknown signature')
  const path =
    params.get('kind') === 'paper'
      ? signature.paper?.photoPath
      : signature.signature.kind === 'drawn'
        ? signature.signature.imagePath
        : null
  if (!path) return refuse(404, 'No file is kept for this signature')
  const bytes = await waiversFiles().read(path)
  if (!bytes) return refuse(404, 'No file is kept for this signature')
  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': path.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
      'Cache-Control': 'private, no-store',
    },
  })
}

/** Where a request was made: the address its page was served on. */
export function requestAudit(request: Request) {
  const headers = request.headers
  const host = String(headers.get('x-forwarded-host') ?? headers.get('host') ?? '').split(',')[0].trim()
  const origin = headers.get('origin')
  const originHost = (() => {
    try {
      return origin ? new URL(origin).host : null
    } catch {
      return null
    }
  })()
  return {
    ip: readClientIp(headers) ?? null,
    userAgent: (headers.get('user-agent') ?? '').slice(0, 400) || null,
    signedOnHost: (originHost || host || null)?.slice(0, 200) ?? null,
  }
}

/** `POST waivers/sign-at-window`: a signer signs on a tablet staff handed over. */
export async function signAtWindowRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return refuse(405, 'Method not allowed')
  const staff = await waiversGate(request, { permission: READERS })
  if (staff instanceof Response) return staff
  const outcome = await recordSignature(staff, staff.body, {
    method: 'at_window',
    audit: { ...requestAudit(request), staffUid: staff.uid, staffName: staff.name ?? staff.email },
  })
  if (outcome.ok === false) return json({ error: outcome.error, ...(outcome.code ? { code: outcome.code } : {}) }, outcome.status)
  // The signer's own copy, as a code to scan from the tablet (AGL-4042).
  const copyUrl = await (await import('./signed-copy'))
    .signedCopyPath({ orgId: staff.orgId, hostId: staff.hostId, signature: outcome.signature })
    .catch(() => null)
  return json({ signature: signatureRow(outcome.signature), copyUrl }, outcome.replayed ? 200 : 201)
}

/** `POST waivers/paper`: record a waiver signed on paper, with a photo of the page. */
export async function paperRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return refuse(405, 'Method not allowed')
  const staff = await waiversGate(request, { permission: READERS })
  if (staff instanceof Response) return staff
  const outcome = await recordPaperSignature(staff, staff.body, { uid: staff.uid, name: staff.name ?? staff.email })
  if (outcome.ok === false) return refuse(outcome.status, outcome.error)
  return json({ signature: signatureRow(outcome.signature) }, outcome.replayed ? 200 : 201)
}

/**
 * Who a contact is to this site (AGL-4042): the name and birthdate its own
 * holder keeps, read through core's person-records seam from whichever
 * plugin keeps people — never the CRM's collections — and core's reader of
 * a contact's holder facet, so no other site's record of them is read.
 * Null when no plugin keeps people here, or the contact is gone.
 */
async function contactIdentity(
  staff: Pick<WaiversStaff, 'orgId' | 'hostId' | 'org'>,
  contactId: string,
): Promise<{ name: string | null; birthdate: string | null } | null> {
  const [person] = (await readPluginPeople({ orgId: staff.orgId, records: [{ kind: 'contact', id: contactId }] })) ?? []
  if (!person) return null
  return contactIdentityForGroup(person.data as Record<string, unknown>, consentGroupForHost(staff.org, staff.hostId).groupId)
}

/**
 * `GET waivers/status?hostId=&dayKey=&email=|contactId=&name=&dateOfBirth=&people=`:
 * whether one person's waiver covers a day, the names it covers, and how
 * they were matched (AGL-4042).
 *
 * Email (else the CRM contact) first. When that matches no signature
 * covering the day, and the caller knows the rider's name AND date of birth,
 * the signature whose `nameDobKeys` holds that person — the signer, or a
 * minor a guardian listed — answers instead. With no date of birth from the
 * caller, a customer the register names by their CRM contact is matched by
 * the name and birth date the site's own record of that contact keeps
 * ({@link contactIdentity}; AGL-4042), so staff need not ask. A name alone never matches:
 * with no email match and no date of birth the answer is "not matched",
 * with the name to search by, rather than a guess. Each is one query, newest
 * first and bounded, on its own index.
 */
export async function statusRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return refuse(405, 'Method not allowed')
  const staff = await waiversGate(request, { permission: READERS })
  if (staff instanceof Response) return staff
  const params = new URL(request.url).searchParams
  const dayKey = params.get('dayKey') || dayKeyIn(waiversNow(), staff.timeZone)
  if (!isDayKey(dayKey)) return refuse(400, 'Choose a day')
  const email = String(params.get('email') ?? '').trim().toLowerCase()
  const contactId = params.get('contactId')
  const name = String(params.get('name') ?? '').trim().slice(0, 120)
  const dateOfBirth = String(params.get('dateOfBirth') ?? '').trim()
  const contactKnown = Boolean(contactId && isDocumentId(contactId))
  const byContact = Boolean(!email && contactKnown)
  if (!email && !byContact && !waiverMatchName(name)) return refuse(400, 'Name the person by email, contact or name')
  const site = waiversRefs.signatures(staff.orgId).where('hostId', '==', staff.hostId) as FirebaseFirestore.Query
  const read = async (query: FirebaseFirestore.Query) =>
    (await query.orderBy('signedAtMs', 'desc').limit(50).get()).docs.map(
      (doc) => readStoredSignature(doc.data()) as StoredWaiverSignature,
    )

  let matchedBy: 'email' | 'contact' | 'nameDob' | null = null
  let signatures: StoredWaiverSignature[] = []
  if (email || byContact) {
    signatures = await read(email ? site.where('emailLower', '==', email) : site.where('contactId', '==', contactId))
    if (signatures.length) matchedBy = email ? 'email' : 'contact'
  }
  // No birth date from the caller: the one the site's record of the contact
  // keeps, with its name when the caller gave none (AGL-4042).
  let birthDateFrom: 'caller' | 'contact' | null = isDayKey(dateOfBirth) ? 'caller' : null
  let matchName = name
  let matchDob = dateOfBirth
  if (!birthDateFrom && contactKnown && !waiverDayStatus(signatures, dayKey).signed) {
    const identity = await contactIdentity(staff, String(contactId)).catch(() => null)
    if (identity?.birthdate && (matchName || identity.name)) {
      matchName = matchName || String(identity.name)
      matchDob = identity.birthdate
      birthDateFrom = 'contact'
    }
  }
  const nameDobKey = waiverNameDobKey(matchName, matchDob)
  if (nameDobKey && !waiverDayStatus(signatures, dayKey).signed) {
    const byNameDob = await read(site.where('nameDobKeys', 'array-contains', nameDobKey))
    if (byNameDob.length && (!matchedBy || waiverDayStatus(byNameDob, dayKey).signed)) {
      signatures = byNameDob
      matchedBy = 'nameDob'
    }
  }
  const status = waiverDayStatus(signatures, dayKey)
  // No email match, and no birth date to match the name with: say so.
  if (!matchedBy && waiverMatchName(matchName) && !birthDateFrom) {
    return json({ dayKey, ...status, matched: false, matchedBy, searchName: matchName, label: WAIVER_NOT_MATCHED_LABEL })
  }
  const expected = Number(params.get('people'))
  return json({
    dayKey,
    ...status,
    matched: matchedBy !== null,
    matchedBy,
    // Where the birth date a name-and-birth-date match used came from.
    ...(matchedBy === 'nameDob' ? { birthDateFrom } : {}),
    searchName: null,
    label: waiverStatusLabel(status, Number.isInteger(expected) && expected > 0 ? expected : undefined),
  })
}
