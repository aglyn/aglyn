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

import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useRef } from 'react'
import {
  describeCallFailure,
  resolveIdToken,
  type TokenSource,
} from '@aglyn/shared-util-http/authorized-token'

/** What one call answered with. `payload` is `{}` on an unparseable body. */
export interface SendingApiResult {
  response: Response
  payload: Record<string, any>
}

/**
 * A refusal the caller reads the same way it reads the route's own.
 *
 * `401` because that is what the request would have been answered with had it
 * gone out, and the reason travels in `payload.error`, which is the field
 * every caller already renders.
 */
const refusedForCaller = (message: string): SendingApiResult => ({
  response: {
    ok: false,
    status: 401,
    json: async () => ({ error: message }),
  } as unknown as Response,
  payload: { error: message },
})

/** One DNS record, exactly as the server issued it. */
export interface SendingDnsRecordView {
  type: 'TXT' | 'MX'
  name: string
  value: string
  priority?: number
  purpose: 'spf' | 'dkim' | 'return-path' | 'dmarc'
  required: boolean
  note: string
}

/** One org sending domain, as the domains route reports it. */
export interface SendingDomainView {
  domain: string
  status: 'requested' | 'records-issued' | 'verified' | 'failed'
  records?: SendingDnsRecordView[]
  lines?: string[]
  lastMissing?: string[] | null
  lastIssueError?: string | null
  verifiedAtMs?: number | null
  lastCheckedAtMs?: number | null
  dmarc?: {
    policy: 'reject' | 'quarantine' | 'none' | 'absent'
    record: string | null
    consequence: string
  } | null
  dmarcSuggestion?: SendingDnsRecordView | null
  pendingProvider?: boolean
  providerDetail?: string | null
}

/**
 * One sender this site holds — `hosts/{hostId}/senders/{senderId}`.
 *
 * `from` is the whole address, assembled by the server for the reason
 * `IdentityOption.from` is: a surface that built `${localPart}@${domain}`
 * itself would be a second derivation of the address, and the two would
 * disagree the first time either moved. It is `null` for a row whose mailbox
 * is not in effect — a site on the pooled Aglyn address has one fixed mailbox,
 * shared with the other sites on it.
 */
export interface HostSenderView {
  id: string
  localPart: string
  fromName: string | null
  replyTo: string | null
  /** Whether an email that names no sender goes out as this one. */
  isDefault: boolean
  from: string | null
}

/** What this site sends as, and what it is allowed to send as. */
export interface SendingIdentityView {
  orgId: string | null
  selected: string
  /**
   * The site's own provisioned domain inside the platform mail apex, or `''`
   * when it has none and its transactional mail rides the shared pool.
   */
  platformDomain: string
  /**
   * The plan that carries sending as a domain the CUSTOMER owns, and the plan
   * that carries a domain the platform provisions for the site — as names
   * ready to print, `null` when no plan carries that gate.
   *
   * Both come from the server because both are derived from the entitlement
   * tables there. A tier name written into this component would be pricing
   * copy that keeps rendering after the gate beneath it moves.
   */
  customDomainPlan: string | null
  dedicatedDomainPlan: string | null
  /** The mailbox this site sends as — the part before the `@`. */
  localPart: string
  /**
   * Whether that mailbox is the one actually in use.
   *
   * False for a site on the pooled Aglyn address, whose mailbox is fixed. The
   * stored value is real and is kept; it takes effect when the site has a
   * domain of its own, and until then the card says so rather than showing a
   * name that no recipient will see.
   */
  localPartInUse: boolean
  /** The site's default sender name, or null. Composers start from it. */
  fromName: string | null
  /** The site's default reply address, or null. */
  replyTo: string | null
  /**
   * Every sender this site may send as, the default among them.
   *
   * Never empty: a site with no `senders` subcollection has exactly one
   * sender, and the server synthesizes it from the three fields the host
   * document has always carried rather than reporting an absence.
   */
  senders: HostSenderView[]
  identity: string
  /**
   * `'custom'` for a domain this site has verified, `'shared'` for the pooled
   * Aglyn address a site uses until it has one, `null` when the send is
   * refused. `'platform'` is in the union because the resolver can return it,
   * and never reaches this view: it is Aglyn's own `aglyn.com` identity, which
   * a host-scoped resolution cannot produce.
   */
  identitySource: 'custom' | 'shared' | 'platform' | null
  refusal: {
    code: string
    domain: string | null
    message: string
    missing: string[]
  } | null
  options: {
    value: string
    from: string | null
    selectable: boolean
    status: string
  }[]
  domains: {
    domain: string
    status: SendingDomainView['status']
    verifiedAtMs: number | null
    lastCheckedAtMs: number | null
    /**
     * Why the last attempt to issue a key produced none, or `null`.
     *
     * Carried in the LIST and not only on the domain's own page, because one
     * of its values is not a fault: a claim held at the mail provider's domain
     * allowance is `requested` with a reason, and a list that could not see
     * the reason would label it "Waiting on a signing key" — a state whose
     * whole instruction is to press a button that will not move it.
     */
    lastIssueError?: string | null
  }[]
  canManage: boolean
  entitled: boolean
  /**
   * The OFFER of a platform sending domain — never the fact of having one,
   * which `platformDomain` above answers.
   *
   * A dedicated subdomain is no longer issued on upgrade: it costs a provider
   * domain slot and three records in Aglyn's own zone, so it is requested by
   * somebody who wants it rather than handed to every paying site.
   *
   * Optional because a console deployment can be older than the field. A
   * surface reading it must treat its absence as "no offer to show", never as
   * "the offer was refused".
   */
  dedicated?: {
    /** The plan carries one and this site has none. */
    available: boolean
    /** The name a request would most likely take. Not a reservation. */
    proposed: string | null
  }
}

/**
 * ONE AUTHORIZED CALL TO THE SENDING-IDENTITY AND SENDING-DOMAIN ROUTES.
 *
 * The same shape as `useCampaignSendApi`, including why the user is held in a
 * ref: this callback is a dependency of effects that load on open, and the
 * user object is a new object on most renders, so depending on it directly
 * would re-issue the request on every render of the surface. The token is
 * fetched at call time either way.
 *
 * The two paths are fixed here rather than taken as an argument, for the
 * reason the campaign hook gives: a hook that accepted a URL from a component
 * would be a way to post the console's credentials somewhere the console does
 * not own.
 *
 * The token is obtained under a deadline, for the reason `useCampaignApi`
 * gives: it is awaited in front of the request, so an unbounded refresh is a
 * call that never reaches `fetch` and never reports anything.
 *
 * ## An unobtainable token ANSWERS here rather than throwing
 *
 * Unlike the campaign hook, whose callers must tell a send that never left
 * the browser apart from one the route refused. Everything on this side reads
 * or edits a configuration surface, where both are the same news to the
 * reader — and every caller already renders `payload.error` on a refusal, so
 * answering in that shape is what puts the real reason on screen and leaves
 * the button that started the call usable.
 */
export function useSendingApi() {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user

  return useCallback(
    async (options: {
      path: 'sending-identity' | 'sending-domains'
      method: 'GET' | 'POST' | 'DELETE'
      query?: Record<string, string>
      body?: Record<string, unknown>
    }): Promise<SendingApiResult> => {
      let idToken: string
      try {
        idToken = await resolveIdToken(
          userRef.current as TokenSource | null | undefined,
        )
      } catch (error) {
        return refusedForCaller(
          describeCallFailure(error, 'Your sign-in could not be confirmed'),
        )
      }
      const search = new URLSearchParams(options.query ?? {}).toString()
      const response = await fetch(
        `/api/email/${options.path}${search ? `?${search}` : ''}`,
        {
          method: options.method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        },
      )
      const json = await response.json().catch(() => ({}))
      return { response, payload: json as Record<string, any> }
    },
    [],
  )
}
