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
'use client'

import {
  publisherAgreementIsPublished,
  publisherAgreementState,
  type PublisherAgreementAcceptance,
} from '@aglyn/aglyn/app-utils/publisher-agreement'
import { useFirestore, useFirestoreDoc } from '@aglyn/tenant-feature-instance'
import { doc } from 'firebase/firestore'
import {
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  publisherAgreementRefusalOf,
  type PublisherAgreementRefusal,
} from '../model/publisher-agreement-refusal'
import PublisherAgreementDialog from './publisher-agreement-dialog.component'

/** A gated request's outcome: the response the caller should read. */
export interface PublisherAgreementGatedResult {
  response: Response
  /** The response body, already read — the response's own body is spent. */
  payload: any
  /**
   * The agreement was presented and closed without accepting. The dialog has
   * already said why the action cannot go ahead, so the caller need not say
   * it again.
   */
  declined: boolean
}

export interface PublisherAgreementGate {
  /**
   * Send a request, and when it is refused for the agreement, present the
   * agreement; once accepted, send the SAME request again and answer with
   * that response instead.
   *
   * @param request makes the request. Called a second time for the retry, so
   *   it must build the same body — a closure over the values already sent,
   *   not over state the dialog may have changed.
   */
  send: (request: () => Promise<Response>) => Promise<PublisherAgreementGatedResult>
  /** Presents the agreement with no request waiting on it. */
  review: () => void
  /** The dialog; render it once, anywhere in the caller's tree. */
  dialog: ReactElement | null
}

interface Open {
  orgId: string
  standing: Pick<PublisherAgreementRefusal, 'state' | 'accepted'>
  /** Settles a waiting `send`; absent when nothing is waiting. */
  settle?: (accepted: boolean) => void
}

/**
 * The one way a publish surface meets the publisher agreement (AGL-3407).
 *
 * Every publish route refuses through `publishPreconditionRefusal` with a
 * structured `agreement` beside the prose. A surface that sends through
 * `send` never reads that refusal itself: the agreement opens over the form,
 * and accepting sends the request again with the payload the person already
 * filled in, so nothing is lost and nothing has to be redone.
 *
 * ── Offered before the form is filled, where the standing is known ────────
 *
 * With `offer` and an `orgId`, the gate reads the org's publisher profile
 * and presents the agreement as soon as it shows the acceptance missing or
 * stale — once per mount, and only for an org that HAS a profile: without
 * one the publish is refused for the profile first, and asking for an
 * agreement to a profile that does not exist would put the steps out of
 * order. Closing it is allowed; the submit still meets the gate.
 *
 * @param options.orgId the org, when the surface knows it. A refusal names
 *   its own org and wins over this, because a host-scoped publish is decided
 *   by the host's org, not by whatever the page assumed.
 * @param options.continueWith the verb accepting continues — "publish".
 */
export function usePublisherAgreementGate(options: {
  orgId?: string | null
  offer?: boolean
  continueWith?: string
}): PublisherAgreementGate {
  const { orgId, offer = false, continueWith = 'publish' } = options
  const firestore = useFirestore()
  const [open, setOpen] = useState<Open | null>(null)
  // The latest standing the gate has seen, from the profile or a refusal, so
  // `review` can reopen the agreement after a decline.
  const lastStanding = useRef<Open | null>(null)

  const { data: profile } = useFirestoreDoc<any>(
    () =>
      offer && orgId ? doc(firestore, 'publisherProfiles', orgId) : null,
    [firestore, orgId, offer],
  )
  // Once per opening of the surface: a surface that stays mounted and is
  // opened again (a dialog drawn through a zone) offers again, because the
  // person has come back to publish something new.
  const offered = useRef(false)
  useEffect(() => {
    if (!offer) {
      offered.current = false
      return
    }
    if (!orgId || offered.current || !profile?.handle) return
    // An unpublished document is not the publisher's to fix, and the refusal
    // on submit already says so; offering a dialog with no accept in it
    // before they have done anything would only be in the way.
    if (!publisherAgreementIsPublished()) return
    const acceptance = profile.publisherAgreement as
      | PublisherAgreementAcceptance
      | undefined
    const state = publisherAgreementState(acceptance)
    if (state === 'current') return
    offered.current = true
    const standing: Open = {
      orgId,
      standing: {
        state,
        accepted:
          typeof acceptance?.version === 'string' && acceptance.version
            ? acceptance.version
            : null,
      },
    }
    lastStanding.current = standing
    setOpen(standing)
  }, [offer, orgId, profile])

  const send = useCallback(
    async (
      request: () => Promise<Response>,
    ): Promise<PublisherAgreementGatedResult> => {
      const response = await request()
      const payload = await response.json().catch(() => ({}))
      const refusal = response.ok ? null : publisherAgreementRefusalOf(payload)
      const refusedOrg = refusal?.orgId ?? orgId ?? ''
      if (!refusal || !refusedOrg) {
        return { response, payload, declined: false }
      }
      const accepted = await new Promise<boolean>((settle) => {
        const next: Open = {
          orgId: refusedOrg,
          standing: { state: refusal.state, accepted: refusal.accepted },
          settle,
        }
        lastStanding.current = { orgId: next.orgId, standing: next.standing }
        setOpen(next)
      })
      if (!accepted) return { response, payload, declined: true }
      // The same request, built by the same closure: what the person filled
      // in is exactly what goes again. A second refusal is returned as it
      // stands rather than asked about in a loop.
      const retried = await request()
      const retriedPayload = await retried.json().catch(() => ({}))
      return { response: retried, payload: retriedPayload, declined: false }
    },
    [orgId],
  )

  const review = useCallback(() => {
    if (lastStanding.current) setOpen({ ...lastStanding.current })
  }, [])

  const close = useCallback(
    (accepted: boolean) => {
      open?.settle?.(accepted)
      if (accepted) lastStanding.current = null
      setOpen(null)
    },
    [open],
  )

  const dialog = open ? (
    <PublisherAgreementDialog
      open
      orgId={open.orgId}
      standing={open.standing}
      // Offered before anything was attempted, accepting continues nothing,
      // so the button says what it does rather than "Accept and publish".
      continueWith={open.settle ? continueWith : undefined}
      onAccepted={() => close(true)}
      onClose={() => close(false)}
    />
  ) : null

  return { send, review, dialog }
}

export default usePublisherAgreementGate
