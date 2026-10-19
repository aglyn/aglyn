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

import type { HostActivityActor } from '@aglyn/aglyn/app-utils/activity-presenter'
import { runPluginEventHandlers } from '@aglyn/aglyn/plugin-manager/plugin-events'
import {
  domainProvider,
  domainStateServes,
  type ProjectDomainState,
  type ProjectDomainStatus,
} from './domain-provider'
import firebaseAdmin from './firebase-admin'
import { flagLookalikeCustomDomain } from './hosted-page-review'
import { syncHostProjectionForMembers } from './host-memberships'
import {
  upsertCustomDomainTwin,
  upsertSubdomainRedirect,
} from './custom-domain-redirects'
import { logHostActivity } from './organizations'
import {
  attachProjectDomain,
  detachProjectDomain,
  projectDomainStatus,
} from './workspace-domains'

/**
 * CONNECTING A NAME TO A SITE, as one server function (AGL-3961).
 *
 * This is the sequence `/api/domains/attach` ran inline: claim the name in a
 * transaction, attach it to the tenant deployment, probe what the platform
 * actually did, record the shortfall, point the platform subdomain at it, log
 * it, and tell plugins. It lives here so a caller with no ID token — a plugin
 * that bought the name, a sweeper finishing an order — connects a domain
 * through exactly the same claim the customer's own button uses. A second copy
 * of the claim is how two sites end up holding one name (AGL-743).
 *
 * Authorization is the CALLER's: the route checks the admin role, lockdown and
 * the plan before it gets here, and a plugin checks its own. This function
 * assumes the caller may connect `domain` to `hostId` and that `domain` has
 * already been through `validatePlatformDomain`.
 *
 * ## The twin
 *
 * `twin` is the `www.`/apex partner of the domain, served as a REDIRECT to it
 * (AGL-1311 memo §5.2). It is opt-in, because only a caller that writes the
 * twin's DNS can promise it resolves: a bought domain, or a provider applying
 * a Domain Connect template. The manual card connects one name, as before.
 *
 * The twin is claimed in the SAME transaction as the primary and is checked
 * against every other site's primary AND twin, both ways round. Without that,
 * org B could connect org A's `www.` sibling, the attach would answer
 * `already-exists`, and B would be shown a healthy domain that redirects to
 * A's site.
 */

/** Firestore field holding the redirect twin of `cname`. */
export const HOST_CNAME_TWIN_FIELD = 'cnameTwin'

export interface ConnectHostDomainInput {
  hostId: string
  /** Lowercased and validated by `validatePlatformDomain`. */
  domain: string
  actor: HostActivityActor
  /**
   * The `www.`/apex partner to serve as a redirect to `domain`. Must be
   * `www.<domain>` or the name `domain` is `www.` of.
   */
  twin?: string | null
}

export type ConnectHostDomainResult =
  | {
      ok: 'connected'
      state: ProjectDomainState
      verification: ProjectDomainStatus['verification']
      conflicts: ProjectDomainStatus['conflicts']
      /** The twin this connect claimed, or null. */
      twin: string | null
    }
  | {
      ok: 'refused'
      /** The HTTP status a route should answer with. */
      status: 404 | 409 | 501 | 502
      /** Customer-facing copy, unchanged from the route that owned it. */
      error: string
      code:
        | 'unknown-site'
        | 'taken'
        | 'not-configured'
        | 'attach-failed'
        | 'held-elsewhere'
      state?: ProjectDomainState
    }

const NOT_CONFIGURED =
  'Domain attachment is not configured on this deployment ' +
  '(no domain provider — set AGLYN_DOMAIN_PROVIDER).'

/**
 * The redirect twin a domain may carry: `www.x` ↔ `x`. Null for anything else,
 * because a twin is a name reserved on the site's behalf and a guess in either
 * direction locks another site out of a name it never chose.
 */
export function customDomainTwinOf(domain: string, twin: string): boolean {
  const primary = domain.trim().toLowerCase()
  const other = twin.trim().toLowerCase()
  if (!primary || !other || primary === other) return false
  return other === `www.${primary}` || primary === `www.${other}`
}

/** Every other site that holds `name` as its primary or its twin. */
async function holdersOf(
  tx: FirebaseFirestore.Transaction,
  firestore: FirebaseFirestore.Firestore,
  name: string,
): Promise<string[]> {
  const [asPrimary, asTwin] = await Promise.all([
    tx.get(firestore.collection('hosts').where('cname', '==', name).limit(2)),
    tx.get(
      firestore
        .collection('hosts')
        .where(HOST_CNAME_TWIN_FIELD, '==', name)
        .limit(2),
    ),
  ])
  return [...asPrimary.docs, ...asTwin.docs].map((snapshot) => snapshot.id)
}

/** Claims, attaches and finishes `domain` for `hostId`. Never throws. */
export async function connectHostCustomDomain(
  input: ConnectHostDomainInput,
): Promise<ConnectHostDomainResult> {
  const { hostId, domain, actor } = input
  const twin =
    input.twin && customDomainTwinOf(domain, input.twin)
      ? input.twin.trim().toLowerCase()
      : null
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)
  const hostSnapshot = await hostRef.get()
  if (!hostSnapshot.exists) {
    return {
      ok: 'refused',
      status: 404,
      code: 'unknown-site',
      error: 'Unknown site',
    }
  }
  const orgId = String(hostSnapshot.get('orgId') ?? '')

  // Claiming the domain and persisting `host.cname` happen in ONE
  // transaction (AGL-743). The write used to be a client-side `updateDoc`
  // that ran BEFORE this check, so losing the 409 still left the losing host
  // holding the domain — and `get-host.ts` then resolved the duplicate by
  // Firestore document order, i.e. one org could be served on another org's
  // domain. A cross-document invariant cannot be enforced from the client, so
  // this is the only writer of `cname`.
  const claimed = await firestore.runTransaction(async (tx) => {
    const names = twin ? [domain, twin] : [domain]
    for (const name of names) {
      const holders = await holdersOf(tx, firestore, name)
      if (holders.some((id) => id !== hostId)) return false
    }
    tx.set(
      hostRef,
      {
        cname: domain,
        [HOST_CNAME_TWIN_FIELD]: twin ?? firebaseAdmin.firestore.FieldValue.delete(),
      },
      { merge: true },
    )
    return true
  })
  if (!claimed) {
    return {
      ok: 'refused',
      status: 409,
      code: 'taken',
      error: 'That domain is already connected to another site',
    }
  }
  // Every member's row of this site carries the domain for the Sites list's
  // search and its Custom domain filter (AGL-3321, `membershipRow`), so the
  // rows follow the write. Best-effort, as the rename's re-sync is: a row
  // left behind is re-derived by the next re-sync of this site.
  if (orgId) {
    await syncHostProjectionForMembers(orgId, hostId).catch(() => undefined)
  }
  // A domain that wears a brand (`paypal-secure.com`) goes to staff in the
  // abuse queue — flagged, not refused (AGL-3356). Never throws.
  await flagLookalikeCustomDomain({ hostId, orgId: orgId || null, domain })

  const markPending = () =>
    hostRef
      .set({ cnameAttachmentPending: true }, { merge: true })
      .catch(() => undefined)

  // Ask the provider whether this deployment can register a name at all,
  // rather than testing one vendor's credentials. A self-host behind its own
  // proxy answers yes; a deployment that leaves names to somebody else
  // answers no, and the wizard says so instead of reporting an outage.
  if (!domainProvider().configured('tenant')) {
    // Backfill path (AGL-166): remember the attachment never happened so the
    // wizard can show it honestly and offer a retry.
    await markPending()
    return { ok: 'refused', status: 501, code: 'not-configured', error: NOT_CONFIGURED }
  }

  // The `already-exists` tolerance lives in the provider, not here: a name
  // already registered is success for a create path and a retry alike.
  const attach = await attachProjectDomain(domain, {}, 'tenant')
  if (attach.outcome === 'skipped') {
    // Configured, and still nothing registered — a provider that does not
    // manage this particular name. Same honest answer as no provider at all.
    await markPending()
    return { ok: 'refused', status: 501, code: 'not-configured', error: NOT_CONFIGURED }
  }
  if (attach.outcome === 'failed') {
    await markPending()
    return {
      ok: 'refused',
      status: 502,
      code: 'attach-failed',
      error: attach.detail ?? 'Attach failed at the platform',
    }
  }

  // What the registration said is not what the customer gets (AGL-1913).
  //
  //  - `already-exists` was tolerated above as idempotency, but it is also the
  //    answer when the name is registered to a DIFFERENT deployment.
  //    `projectDomainStatus` asks whether the name is on OUR deployment rather
  //    than inferring it from the tolerated outcome.
  //  - A provider accepts a name whose apex belongs to another account and
  //    then withholds routing and the certificate until a TXT challenge is
  //    answered.
  //
  // `certificate-pending` is NOT serving (AGL-1996): treating it as live
  // registered the edge redirect before a certificate existed, so the site
  // lost BOTH addresses. `admin/finish-domain-attachments` re-probes and
  // completes it without a human (AGL-2010).
  const status = await projectDomainStatus(domain, { scope: 'tenant' })
  const serves = domainStateServes(status.state)
  if (status.state === 'not-attached') {
    await markPending()
    return {
      ok: 'refused',
      status: 409,
      code: 'held-elsewhere',
      error:
        'That domain is already registered to another account on our ' +
        'hosting platform, so it could not be attached. Contact support ' +
        'with the domain name.',
      state: status.state,
    }
  }
  await hostRef
    .set(
      {
        cnameAttachmentPending: serves
          ? firebaseAdmin.firestore.FieldValue.delete()
          : // Not a lie about the attach: it landed. But the field is what
            // `liveCustomDomain` reads to decide whether it is safe to send
            // visitors here, and a domain awaiting an ownership challenge or
            // pointed elsewhere is exactly what that guard exists for.
            true,
      },
      { merge: true },
    )
    .catch(() => undefined)

  // Query-preserving edge redirect from the platform subdomain (AGL-1273),
  // only once the domain actually serves — the edge-level twin of
  // `liveCustomDomain`'s refusal on `cnameAttachmentPending`.
  const subdomain = String(hostSnapshot.get('subdomain') ?? '')
    .trim()
    .toLowerCase()
  if (subdomain && serves) {
    const redirected = await upsertSubdomainRedirect({
      subdomain,
      target: domain,
    }).catch(() => false)
    await hostRef
      .set(
        redirected
          ? { subdomainRedirectPending: firebaseAdmin.firestore.FieldValue.delete() }
          : { subdomainRedirectPending: true },
        { merge: true },
      )
      .catch(() => undefined)
  }

  // The twin forwards to the primary, so it is registered whether or not the
  // primary serves yet: a redirect to a name still issuing its certificate is
  // the same wait the visitor would have on the primary itself.
  if (twin) {
    const twinned = await upsertCustomDomainTwin({ twin, target: domain }).catch(
      () => false,
    )
    await hostRef
      .set(
        twinned
          ? { cnameTwinPending: firebaseAdmin.firestore.FieldValue.delete() }
          : { cnameTwinPending: true },
        { merge: true },
      )
      .catch(() => undefined)
  }

  // The site's public address changed hands (AGL-118). One entry, at the
  // single terminal success.
  await logHostActivity(hostId, actor, 'Attached a custom domain', {
    type: 'host',
    id: hostId,
    name: domain,
  })
  // Plugins that register the domain somewhere of their own — commerce's
  // Stripe payment method domains, so Apple Pay shows on it (AGL-3629).
  // After the claim and the attach, so the name is this site's; isolated, so
  // a plugin that fails cannot fail the connect.
  await runPluginEventHandlers('host.domain.attached', {
    orgId: orgId || null,
    hostId,
    domain,
  })
  return {
    ok: 'connected',
    state: status.state,
    verification: status.verification,
    conflicts: status.conflicts,
    twin,
  }
}

/**
 * Releases a site's twin from the tenant deployment. The primary has its own
 * release in `/api/domains/detach`; the twin rides along so it can never
 * outlive the name it forwards to.
 */
export async function releaseCustomDomainTwin(
  twin: string | null | undefined,
): Promise<boolean> {
  const name = String(twin ?? '').trim().toLowerCase()
  if (!name) return true
  const released = await detachProjectDomain(name, 'tenant')
  return released.outcome !== 'failed'
}
