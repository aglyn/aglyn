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

import { type PluginApiHandler } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  PUBLISHER_AGREEMENT_CONSENT_LABEL,
  PUBLISHER_AGREEMENT_TITLE,
  publisherAgreementConsentRefusal,
} from '../model/publisher-agreement'
import {
  isValidPublisherHandle,
  validatePublisherProfileContent,
} from '../model/marketplace'
import {
  canActAsPublisher,
  claimPublisherHandle,
  PublisherHandleTakenError,
  PUBLISHER_PROFILES,
} from './publisher-profile'
import {
  listingSubmissionRefusal,
  publisherIdentityImpersonation,
} from './listing-screen'
import {
  publisherAgreementNote,
  recordPublisherAgreementAcceptance,
} from './publisher-agreement-acceptance'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import type { DecodedIdToken } from 'firebase-admin/auth'

/**
 * Save an org's publisher profile (AGL-652).
 *
 * The handle has to be claimed transactionally, and a client can't do that —
 * a read-then-write uniqueness check lets two orgs racing for the same handle
 * both succeed, and the loser silently loses its marketplace URL. So the
 * handle is server-owned here, exactly like the host subdomain (AGL-642), and
 * the rules freeze it against client writes.
 *
 * Manager-only: the profile is the org's public identity and its payout
 * anchor, so it follows the same gate as the profile rules.
 */
export const publisherProfileSaveHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  // Accepting the agreement once per organization (AGL-1077) is retired
  // (AGL-4105): every save agrees to it on its own, ticked in the form. An app
  // from before that still sends this, and is told what to do instead rather
  // than having it read as a profile save with no name.
  if (req.body?.action === 'accept-agreement') {
    return res.status(410).json({
      error:
        `The ${PUBLISHER_AGREEMENT_TITLE} is now agreed to on each save: tick ` +
        `'${PUBLISHER_AGREEMENT_CONSENT_LABEL}' above Save or Publish.`,
    })
  }
  const orgId = String(req.body?.orgId ?? '')
  const handle = String(req.body?.handle ?? '').trim().toLowerCase()
  const displayName = String(req.body?.displayName ?? '').trim().slice(0, 80)
  if (!orgId) return res.status(400).json({ error: 'Missing orgId' })
  if (!displayName) {
    return res.status(400).json({ error: 'A display name is required' })
  }
  if (!isValidPublisherHandle(handle)) {
    return res.status(400).json({
      error:
        'Handles are 3–30 characters: lowercase letters, numbers and ' +
        'hyphens, starting and ending alphanumeric.',
    })
  }
  // The publisher agreement, agreed to on this save (AGL-4105).
  const agreementRefusal = publisherAgreementConsentRefusal(req.body?.agreement)
  if (agreementRefusal) {
    return res.status(agreementRefusal.status).json(agreementRefusal.body)
  }

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return res.status(401).json({ error: 'Unauthenticated' })

  let decoded: DecodedIdToken
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  } catch (error) {
    // Only a refused credential is the caller's 401; failing to check it is
    // ours and keeps the dispatcher's 5xx (AGL-2852).
    if (!isRefusedIdToken(error)) throw error
    return res.status(401).json({ error: 'Unauthenticated' })
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    if (!(await canActAsPublisher(firestore, decoded.uid, orgId))) {
      return res.status(403).json({
        error: 'Only an organization owner or admin can edit the publisher profile',
      })
    }

    // The publisher's public identity, screened before the handle is claimed
    // (AGL-3365): a name or handle that wears the platform's name or speaks
    // for a brand is refused, and the name, bio and links are read by the
    // same phishing screen as a listing — the profile is what every one of
    // its listings says it is from.
    const official = decoded['staff'] === true
    const impersonation = publisherIdentityImpersonation({ displayName, handle, official })
    if (impersonation) {
      return res.status(422).json({ error: impersonation, code: 'impersonation' })
    }
    const text = (key: string) =>
      typeof req.body?.[key] === 'string' ? (req.body[key] as string) : null
    const screened = await listingSubmissionRefusal({
      publisherOrgId: orgId,
      content: {
        publisherName: displayName,
        description: text('bio'),
        urls: [text('website'), text('supportUrl'), text('supportEmail')],
      },
      official,
    })
    if (screened) return res.status(screened.status).json(screened.body)

    const ref = firestore.collection(PUBLISHER_PROFILES).doc(orgId)
    const previousHandle = (await ref.get()).get('handle') as string | undefined

    // The agreement this save was sent with, recorded before anything is
    // claimed or written (AGL-4105). The profile's note of it rides the
    // profile write below, which may be the one that creates the profile.
    const acceptance = await recordPublisherAgreementAcceptance({
      firestore,
      request: req,
      orgId,
      uid: decoded.uid,
      staff: official,
      action: 'save-profile',
      targetId: orgId,
      noteOnProfile: false,
    })

    // Claim first: if the handle is taken there must be no profile write, or
    // the org would show a handle it doesn't actually hold.
    try {
      await claimPublisherHandle(firestore, orgId, handle, previousHandle)
    } catch (error) {
      if (error instanceof PublisherHandleTakenError) {
        return res.status(409).json({ error: 'That handle is already taken' })
      }
      throw error
    }

    // PRESENT-AND-EMPTY CLEARS; ABSENT LEAVES ALONE.
    //
    // The write below is a merge, and `bio` was spread in only when truthy, so
    // an empty one was a no-op and the stored bio survived every attempt to
    // remove it. The publisher could rewrite it but never take it down — while
    // every URL field in this same write has cleared on empty since AGL-1009.
    //
    // Presence is what separates "clear this" from "this request is not about
    // the bio": `req.body.bio` absent must not delete a bio the caller never
    // mentioned, which a bare `?? ''` would do to any client that omits it.
    const bioProvided = req.body?.bio !== undefined
    const bio = String(req.body?.bio ?? '').trim().slice(0, 500)
    // Logo, support contact and social links (AGL-1009): validated here on
    // the save route — the same server-owned discipline as the handle — and
    // through `validatePublisherProfileContent`, which shares the listing
    // validator's https-only rule rather than growing a second URL parser.
    const extras = validatePublisherProfileContent(req.body ?? {})
    if (!extras.ok) {
      return res.status(400).json({ error: extras.error })
    }
    const extraWrites: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(extras.content ?? {})) {
      // An explicit empty string clears the stored field — otherwise a
      // publisher could add a link but never take one down.
      extraWrites[key] =
        value === '' ? firebaseAdmin.firestore.FieldValue.delete() : value
    }
    await ref.set(
      {
        handle,
        displayName,
        ...(bioProvided
          ? {
              bio: bio
                ? bio
                : firebaseAdmin.firestore.FieldValue.delete(),
            }
          : {}),
        ...extraWrites,
        publisherAgreement: publisherAgreementNote(acceptance),
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return res.status(200).json({ ok: true, handle })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Could not save the profile' })
  }
}
