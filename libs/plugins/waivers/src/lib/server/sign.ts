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

import { createHash } from 'crypto'
import { HOST_TOKENS } from '@aglyn/aglyn/app-utils/host-tokens'
import recordCapturedContact from '@aglyn/aglyn/plugin-manager/record-captured-contact'
import {
  WAIVERS_CONTACT_SOURCE,
  waiverPaperPhotoPath,
  waiverSignatureImagePath,
} from '../constants/bundle-common'
import { dayKeyIn, isDayKey, validThroughDayKey, type WaiverTemplate } from '../model/waiver'
import {
  WAIVER_ESIGN_CONSENT,
  nameSearchTokens,
  normalizeSignInput,
  waiverSignedText,
  type StoredWaiverSignature,
  type WaiverMinor,
  type WaiverSignMethod,
} from '../model/waiver-signature'
import { WaiverFileRefusedError, waiversFiles, waiversRefs } from './db'
import { sendWaiverEmail, signedCopyEmail } from './emails'

/*==========================================
 * WRITING A SIGNATURE (AGL-4042), whichever door it came through: a signer
 * online, a tablet staff handed over at the window, or a paper waiver staff
 * recorded. Each is keyed by the signing attempt the form minted, so a
 * retried press stores one signature and sends one email.
 *=========================================*/

export type SignOutcome =
  | { ok: true; signature: StoredWaiverSignature; replayed: boolean }
  | { ok: false; status: number; error: string; code?: string }

export interface SignAudit {
  ip: string | null
  userAgent: string | null
  signedOnHost: string | null
  staffUid: string | null
  staffName: string | null
}

export interface SignContext {
  orgId: string
  hostId: string
  host: Record<string, unknown>
  org: Record<string, unknown> | null
  timeZone: string
  nowMs?: number
}

let nowOverride: (() => number) | null = null

/** Test seam. */
export function setWaiversClockForTests(now: (() => number) | null): void {
  nowOverride = now
}

/** Now, by the clock every waivers route reads. */
export const waiversNow = (): number => (nowOverride ? nowOverride() : Date.now())

const now = (context: SignContext) => context.nowMs ?? waiversNow()

export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** The site's name as its emails and copies print it. */
export function siteBusinessName(host: Record<string, unknown>): string {
  return HOST_TOKENS['businessName']?.resolve(host as never) || String(host['displayName'] ?? '') || 'Your waiver'
}

/** A signing attempt's key as a document id: the same press, the same signature. */
export function signatureIdFor(orgId: string, attemptKey: unknown): string | null {
  const key = String(attemptKey ?? '').trim()
  if (key.length < 8 || key.length > 200) return null
  return sha256Hex(`${orgId}\u0000${key}`).slice(0, 32)
}

/** A live waiver of this site, or the refusal a signer sees. */
export async function readSignableWaiver(
  orgId: string,
  hostId: string,
  waiverId: unknown,
  options: { allowDraft?: boolean } = {},
): Promise<{ ok: true; waiver: WaiverTemplate } | { ok: false; status: number; error: string }> {
  const id = String(waiverId ?? '')
  if (!id || id.includes('/') || id.length > 200) return { ok: false, status: 400, error: 'Choose a waiver to sign.' }
  const snapshot = await waiversRefs.waiver(orgId, id).get()
  const waiver = snapshot.exists ? ({ ...(snapshot.data() as WaiverTemplate), id } as WaiverTemplate) : null
  if (!waiver || waiver.hostId !== hostId) return { ok: false, status: 404, error: 'This waiver is not available.' }
  if (waiver.status !== 'published' && !(options.allowDraft && waiver.status === 'draft')) {
    return { ok: false, status: 404, error: 'This waiver is not taking signatures right now.' }
  }
  return { ok: true, waiver }
}

const PNG_PREFIX = 'data:image/png;base64,'
const JPEG_PREFIX = 'data:image/jpeg;base64,'

/** An image a client sent as a data URL, checked by its own first bytes, or `null`. */
export function decodeImageDataUrl(
  value: unknown,
  options: { maxBytes: number; allowJpeg?: boolean },
): { bytes: Uint8Array; contentType: 'image/png' | 'image/jpeg'; extension: 'png' | 'jpg' } | null {
  const text = String(value ?? '')
  const png = text.startsWith(PNG_PREFIX)
  const jpeg = options.allowJpeg && text.startsWith(JPEG_PREFIX)
  if (!png && !jpeg) return null
  const base64 = text.slice(png ? PNG_PREFIX.length : JPEG_PREFIX.length)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > Math.ceil((options.maxBytes * 4) / 3) + 4) return null
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
  if (!bytes.length || bytes.length > options.maxBytes) return null
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (png && isPng) return { bytes, contentType: 'image/png', extension: 'png' }
  if (jpeg && isJpeg) return { bytes, contentType: 'image/jpeg', extension: 'jpg' }
  return null
}

/** Files the CRM capture, then the signer's copy; neither ever fails the signing. */
async function afterSigning(
  context: SignContext,
  signature: StoredWaiverSignature,
  options: { sendCopy: boolean } = { sendCopy: true },
): Promise<StoredWaiverSignature> {
  let stored = signature
  if (signature.signer?.email) {
    const captured = await recordCapturedContact({
      orgId: context.orgId,
      hostId: context.hostId,
      ...(signature.audit.staffUid ? { actor: { kind: 'member' as const, uid: signature.audit.staffUid } } : {}),
      identity: { email: signature.signer.email, name: signature.signer.name },
      interaction: {
        source: WAIVERS_CONTACT_SOURCE,
        atMs: signature.signedAtMs,
        refId: `waiverSignatures/${signature.id}`,
        summary: `Signed ${signature.waiverTitle}`,
      },
      surface: 'relationship',
      ...(signature.signer.phone ? { profileFill: { phone: signature.signer.phone } } : {}),
    }).catch((): null => null)
    const contactId = captured?.ok && captured.record === 'contact' ? captured.contactId : null
    if (contactId) {
      await waiversRefs.signature(context.orgId, signature.id).update({ contactId })
      stored = { ...stored, contactId }
    }
  }
  // A paper signer agreed to nothing electronic, so they get no email copy.
  const email = options.sendCopy
    ? signedCopyEmail({ signature: stored, org: context.org, businessName: siteBusinessName(context.host) })
    : null
  if (email) await sendWaiverEmail(email).catch(() => false)
  return stored
}

/** A signing online or at the window, by the signer's own hand. */
export async function recordSignature(
  context: SignContext,
  body: Record<string, unknown>,
  options: { method: Exclude<WaiverSignMethod, 'paper'>; audit: SignAudit },
): Promise<SignOutcome> {
  const id = signatureIdFor(context.orgId, body['attemptKey'])
  if (!id) return { ok: false, status: 400, error: 'Reload the page and sign again.' }
  const existing = await waiversRefs.signature(context.orgId, id).get()
  if (existing.exists) {
    const stored = readStoredSignature(existing.data()) as StoredWaiverSignature
    if (stored.hostId !== context.hostId) return { ok: false, status: 409, error: 'Reload the page and sign again.' }
    return { ok: true, signature: stored, replayed: true }
  }
  const found = await readSignableWaiver(context.orgId, context.hostId, body['waiverId'])
  if (found.ok === false) return found
  const waiver = found.waiver
  const signedAtMs = now(context)
  const dayKey = dayKeyIn(signedAtMs, context.timeZone)
  const checked = normalizeSignInput(body, waiver, dayKey, { method: options.method })
  if (checked.ok === false) return { ok: false, status: checked.code === 'version' ? 409 : 400, error: checked.error, ...(checked.code ? { code: checked.code } : {}) }
  const input = checked.input
  let imagePath: string | null = null
  if (input.signature.kind === 'drawn') {
    const image = decodeImageDataUrl(body['signatureImage'], { maxBytes: 300_000 })
    if (image) {
      imagePath = waiverSignatureImagePath(context.orgId, id)
      try {
        await waiversFiles().save(imagePath, image.bytes, image.contentType)
      } catch (caught) {
        if (caught instanceof WaiverFileRefusedError) return { ok: false, status: 400, error: caught.message }
        throw caught
      }
    }
  }
  const signedText = waiverSignedText(waiver, { consent: true })
  const signature: StoredWaiverSignature = {
    id,
    orgId: context.orgId,
    hostId: context.hostId,
    waiverId: waiver.id,
    waiverTitle: waiver.title,
    version: waiver.version,
    signedText,
    signedTextSha256: sha256Hex(signedText),
    signer: input.signer,
    minors: input.minors,
    guardianRelationship: input.guardianRelationship || null,
    checked: input.checked,
    signature:
      input.signature.kind === 'drawn'
        ? { kind: 'drawn', strokes: input.signature.strokes, imagePath }
        : { kind: 'typed', text: input.signature.text },
    consent: { agreed: true, text: WAIVER_ESIGN_CONSENT.text, version: WAIVER_ESIGN_CONSENT.version },
    method: options.method,
    signedAtMs,
    dayKey,
    validThroughDayKey: validThroughDayKey(waiver.validity, dayKey),
    timeZone: context.timeZone,
    audit: options.audit,
    paper: null,
    contactId: null,
    emailLower: input.signer.email.toLowerCase(),
    nameLower: input.signer.name.toLowerCase(),
    nameTokens: nameSearchTokens([input.signer.name, ...input.minors.map((minor) => minor.name)]),
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  }
  try {
    await waiversRefs.signature(context.orgId, id).create(stripStrokesForFirestore(signature))
  } catch (error) {
    // The same press landed twice at once: the first one's record stands.
    const raced = await waiversRefs.signature(context.orgId, id).get()
    if (raced.exists) return { ok: true, signature: readStoredSignature(raced.data()) as StoredWaiverSignature, replayed: true }
    throw error
  }
  return { ok: true, signature: await afterSigning(context, signature), replayed: false }
}

/**
 * Firestore holds no nested arrays, so a drawn signature's strokes are kept as
 * one flat `[x, y, x, y…]` list per stroke, each under an object. Read back
 * through {@link readStoredSignature}.
 */
export function stripStrokesForFirestore(signature: StoredWaiverSignature): Record<string, unknown> {
  if (signature.signature.kind !== 'drawn') return { ...signature }
  return {
    ...signature,
    signature: {
      kind: 'drawn',
      imagePath: signature.signature.imagePath,
      strokes: signature.signature.strokes.map((stroke) => ({ points: stroke.flat() })),
    },
  }
}

/** A stored signature as the model reads it: strokes back to `[x, y]` pairs. */
export function readStoredSignature(data: Record<string, unknown> | undefined): StoredWaiverSignature | null {
  if (!data) return null
  const mark = data['signature'] as Record<string, unknown> | undefined
  if (mark?.['kind'] === 'drawn' && Array.isArray(mark['strokes'])) {
    const strokes = (mark['strokes'] as Array<{ points?: number[] } | number[][]>).map((stroke) => {
      if (Array.isArray(stroke)) return stroke as unknown as Array<[number, number]>
      const flat = Array.isArray(stroke?.points) ? stroke.points : []
      const pairs: Array<[number, number]> = []
      for (let index = 0; index + 1 < flat.length; index += 2) pairs.push([flat[index], flat[index + 1]])
      return pairs
    })
    return { ...(data as unknown as StoredWaiverSignature), signature: { kind: 'drawn', strokes, imagePath: (mark['imagePath'] as string) ?? null } }
  }
  return data as unknown as StoredWaiverSignature
}

/** A paper waiver staff recorded from a clipboard, with a photo of the page. */
export async function recordPaperSignature(
  context: SignContext,
  body: Record<string, unknown>,
  staff: { uid: string; name: string | null },
): Promise<SignOutcome> {
  const id = signatureIdFor(context.orgId, body['attemptKey'])
  if (!id) return { ok: false, status: 400, error: 'Reload the page and record it again.' }
  const existing = await waiversRefs.signature(context.orgId, id).get()
  if (existing.exists) return { ok: true, signature: readStoredSignature(existing.data()) as StoredWaiverSignature, replayed: true }
  const found = await readSignableWaiver(context.orgId, context.hostId, body['waiverId'], { allowDraft: false })
  if (found.ok === false) return found
  const waiver = found.waiver
  const recordedAtMs = now(context)
  const today = dayKeyIn(recordedAtMs, context.timeZone)
  const signedOn = String(body['signedOnDayKey'] ?? today)
  if (!isDayKey(signedOn) || signedOn > today) {
    return { ok: false, status: 400, error: 'Enter the date written on the paper waiver.' }
  }
  // The paper form asks what the online one asks, so the checks are the same
  // ones; the signer's own consent and mark are on the page itself.
  const checked = normalizeSignInput(
    {
      ...body,
      version: waiver.version,
      checked: waiver.checkboxes.map((box) => box.id),
      consent: true,
      signature: { kind: 'typed', text: 'paper' },
    },
    waiver,
    signedOn,
    { method: 'at_window' },
  )
  if (checked.ok === false) return { ok: false, status: 400, error: checked.error }
  const photo = decodeImageDataUrl(body['photo'], { maxBytes: 6_000_000, allowJpeg: true })
  if (!photo) return { ok: false, status: 400, error: 'Add a photo of the signed page.' }
  const photoPath = waiverPaperPhotoPath(context.orgId, id, photo.extension)
  try {
    await waiversFiles().save(photoPath, photo.bytes, photo.contentType)
  } catch (caught) {
    if (caught instanceof WaiverFileRefusedError) return { ok: false, status: 400, error: caught.message }
    throw caught
  }
  const signedText = waiverSignedText(waiver, { consent: false })
  const minors: WaiverMinor[] = checked.input.minors
  const signature: StoredWaiverSignature = {
    id,
    orgId: context.orgId,
    hostId: context.hostId,
    waiverId: waiver.id,
    waiverTitle: waiver.title,
    version: waiver.version,
    signedText,
    signedTextSha256: sha256Hex(signedText),
    signer: checked.input.signer,
    minors,
    guardianRelationship: checked.input.guardianRelationship || null,
    checked: checked.input.checked,
    signature: { kind: 'paper' },
    consent: null,
    method: 'paper',
    signedAtMs: recordedAtMs,
    dayKey: signedOn,
    validThroughDayKey: validThroughDayKey(waiver.validity, signedOn),
    timeZone: context.timeZone,
    audit: { ip: null, userAgent: null, signedOnHost: null, staffUid: staff.uid, staffName: staff.name },
    paper: { photoPath, recordedByUid: staff.uid, recordedByName: staff.name, recordedAtMs },
    contactId: null,
    emailLower: checked.input.signer.email.toLowerCase(),
    nameLower: checked.input.signer.name.toLowerCase(),
    nameTokens: nameSearchTokens([checked.input.signer.name, ...minors.map((minor) => minor.name)]),
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
  }
  await waiversRefs.signature(context.orgId, id).create(stripStrokesForFirestore(signature))
  return { ok: true, signature: await afterSigning(context, signature, { sendCopy: false }), replayed: false }
}
