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

import { renderWaiverPdf } from '../model/waiver-pdf'
import {
  WAIVER_METHOD_LABELS,
  signatureWindowLabel,
  type StoredWaiverSignature,
} from '../model/waiver-signature'

/*==========================================
 * A STORED SIGNATURE AS ITS SIGNED COPY (AGL-4042): the PDF the signer is
 * emailed and the console downloads. Built from the record's own snapshot of
 * the text it agreed to, never from the waiver as it reads now.
 *=========================================*/

/** When something happened, in the site's time zone, in plain words. */
export function formatInstant(ms: number, timeZone: string): string {
  try {
    return new Date(ms).toLocaleString('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return new Date(ms).toISOString()
  }
}

/** The snapshot's body: everything between the version line and the checkbox and validity lines. */
function snapshotParts(signature: StoredWaiverSignature): { body: string; boxes: string[]; validity: string } {
  const paragraphs = String(signature.signedText ?? '').split('\n\n')
  // waiverSignedText: title, version, body…, [x] boxes…, validity, [consent].
  const rest = paragraphs.slice(2)
  if (rest.length && rest[rest.length - 1].startsWith('Electronic signature consent:')) rest.pop()
  const validity = rest.pop() ?? ''
  const boxes: string[] = []
  while (rest.length && rest[rest.length - 1].startsWith('[x] ')) boxes.unshift((rest.pop() as string).slice(4))
  return { body: rest.join('\n\n'), boxes, validity }
}

export function signatureNames(signature: StoredWaiverSignature): string[] {
  return [signature.signer?.name, ...(signature.minors ?? []).map((minor) => minor.name)].filter(
    (name): name is string => Boolean(name),
  )
}

export function signaturePdf(signature: StoredWaiverSignature, businessName: string): Uint8Array {
  const parts = snapshotParts(signature)
  const audit: Array<[string, string]> = [
    ['Signed', formatInstant(signature.signedAtMs, signature.timeZone)],
    ['Method', WAIVER_METHOD_LABELS[signature.method] ?? signature.method],
    ['Covers', signatureWindowLabel(signature)],
    ['Signature ID', signature.id],
  ]
  if (signature.method !== 'paper') {
    audit.push(['Signed on', signature.audit?.signedOnHost ?? '—'])
    audit.push(['IP address', signature.audit?.ip ?? '—'])
    audit.push(['Device', signature.audit?.userAgent ?? '—'])
  }
  if (signature.audit?.staffName || signature.audit?.staffUid) {
    audit.push(['Handed over by', signature.audit.staffName ?? signature.audit.staffUid ?? ''])
  }
  if (signature.paper) {
    audit.push(['Recorded by', signature.paper.recordedByName ?? signature.paper.recordedByUid])
    audit.push(['Recorded', formatInstant(signature.paper.recordedAtMs, signature.timeZone)])
  }
  const signer: Array<[string, string]> = [
    ['Name', signature.signer?.name ?? ''],
    ['Date of birth', signature.signer?.dateOfBirth ?? ''],
  ]
  if (signature.signer?.email) signer.push(['Email', signature.signer.email])
  if (signature.signer?.phone) signer.push(['Phone', signature.signer.phone])
  const mark = signature.signature
  return renderWaiverPdf({
    businessName,
    title: signature.waiverTitle,
    version: signature.version,
    bodyText: parts.body,
    checkboxes: parts.boxes,
    validityText: parts.validity,
    signerLines: signer,
    minors: signature.minors ?? [],
    relationship: signature.guardianRelationship,
    signature:
      mark?.kind === 'drawn'
        ? { kind: 'drawn', strokes: mark.strokes }
        : mark?.kind === 'typed'
          ? { kind: 'typed', text: mark.text }
          : { kind: 'paper' },
    consentText: signature.consent?.agreed ? signature.consent.text : null,
    auditLines: audit,
    sha256: signature.signedTextSha256,
    voidedText: signature.voidedAt
      ? `VOIDED ${formatInstant(signature.voidedAt, signature.timeZone)}${signature.voidReason ? `: ${signature.voidReason}` : ''}`
      : null,
  })
}

/** A file name a download keeps: the waiver and the signer, nothing else. */
export function signaturePdfFilename(signature: StoredWaiverSignature): string {
  const slug = `${signature.waiverTitle} ${signature.signer?.name ?? ''} ${signature.dayKey}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
  return `${slug || 'signed-waiver'}.pdf`
}
