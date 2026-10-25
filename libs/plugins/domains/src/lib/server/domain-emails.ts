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
  isAccountBanLockdownReason,
  normalizeOrgLockdown,
} from '@aglyn/aglyn/app-utils/lockdown'
import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import type { NotificationLevel } from '@aglyn/aglyn/app-utils/notifications'
import { DOMAIN_EMAIL_KEYS, sendEmail } from '@aglyn/shared-util-email'
import {
  hostDisplayName,
  listOrgMembers,
  meterPlatformEmail,
  notifyOrgAdmins,
} from '@aglyn/tenant-data-admin'
import { filterSuppressedEmails } from '@aglyn/tenant-data-admin/server/email-suppression'
import {
  orgSystemEmailBrand,
  renderSystemEmailContent,
} from '@aglyn/tenant-data-admin/server/render-system-email'
import type { DomainRegistrationDoc } from '../model/registration'
import { db } from './db'
import type { DomainEmailKind } from './lifecycle'

/*
 * TELLING THE OWNERS (AGL-3962): each lifecycle event as its designed system
 * email (`domain-emails.ts` in the email library) to the workspace's owners
 * and admins, and as a console notification that does not mail them twice.
 *
 * Never throws. An email that fails is logged; the step it reports on has
 * already happened, and a lost email must not undo it or stop the sweep.
 */

interface Wording {
  title: (domain: string, merge: Record<string, string>) => string
  body: (merge: Record<string, string>) => string
  level: NotificationLevel
  /** `billing.paymentFailed` for the one notice that is a failed charge. */
  type: 'billing.domain' | 'billing.paymentFailed'
  /** The Billing page rather than the domain's, for a card to update. */
  linkToBilling?: boolean
}

const WORDING: Record<DomainEmailKind, Wording> = {
  purchased: {
    title: (domain) => `${domain} is yours`,
    body: (merge) =>
      `${merge['domain.whereLine'] ?? ''} Confirm the registrant email when the registrar’s message arrives.`.trim(),
    level: 'success',
    type: 'billing.domain',
  },
  refunded: {
    title: (domain) => `We couldn’t register ${domain}`,
    body: (merge) => `${merge['domain.failure'] ?? ''} ${merge['domain.refund'] ?? ''}`.trim(),
    level: 'warning',
    type: 'billing.domain',
  },
  verifyRegistrant: {
    title: (domain) => `Confirm the email for ${domain}`,
    body: (merge) =>
      `ICANN requires it by ${merge['domain.verifyBy'] || 'the deadline'}, or the domain can be suspended.`,
    level: 'warning',
    type: 'billing.domain',
  },
  renewalNotice: {
    title: (domain, merge) => `${domain} renews on ${merge['domain.renewsOn'] ?? ''}`,
    body: (merge) =>
      `${merge['domain.renewalPrice'] ?? ''} for one year, charged around ${merge['domain.chargeOn'] ?? ''}.`,
    level: 'info',
    type: 'billing.domain',
  },
  renewed: {
    title: (domain) => `${domain} is renewed`,
    body: (merge) => `Registered until ${merge['domain.expiresOn'] ?? ''}.`,
    level: 'success',
    type: 'billing.domain',
  },
  renewalFailed: {
    title: (domain) => `We couldn’t renew ${domain}`,
    body: (merge) =>
      `Update the card on file. We’ll try again on ${merge['domain.nextAttempt'] ?? ''}; it expires on ${merge['domain.expiresOn'] ?? ''} if not renewed.`,
    level: 'critical',
    type: 'billing.paymentFailed',
    linkToBilling: true,
  },
  expiring: {
    title: (domain, merge) => `${domain} expires on ${merge['domain.expiresOn'] ?? ''}`,
    body: (merge) => `${merge['domain.expiryReason'] ?? ''} Renew it to keep the address.`.trim(),
    level: 'warning',
    type: 'billing.domain',
  },
  expired: {
    title: (domain) => `${domain} has expired`,
    body: () => '{site} is back on its free address.',
    level: 'critical',
    type: 'billing.domain',
  },
  transferCode: {
    title: (domain) => `A transfer code was requested for ${domain}`,
    body: (merge) => `Requested by ${merge['domain.requestedBy'] ?? 'a member'}.`,
    level: 'warning',
    type: 'billing.domain',
  },
  transferInCompleted: {
    title: (domain) => `${domain} has moved here`,
    body: (merge) =>
      `It is registered until ${merge['domain.expiresOn'] ?? ''}. Connect it to a site from the Domains page.`,
    level: 'success',
    type: 'billing.domain',
  },
  transferInFailed: {
    title: (domain) => `${domain} couldn’t be moved here`,
    body: (merge) => `${merge['domain.failure'] ?? ''} ${merge['domain.refund'] ?? ''}`.trim(),
    level: 'warning',
    type: 'billing.domain',
  },
}

/**
 * The console path where a name is managed: its site's Custom Domain page,
 * or — for a name no site uses — the workspace's Domains page (AGL-4040).
 */
export async function domainPagePath(
  orgId: string,
  hostId: string | null,
  domain = '',
): Promise<{ manage: string; billing: string; siteName: string; orgName: string }> {
  const firestore = db()
  const [org, host] = await Promise.all([
    firestore.collection('orgs').doc(orgId).get().catch(() => null),
    hostId ? firestore.collection('hosts').doc(hostId).get().catch(() => null) : null,
  ])
  const slug = String(org?.get('slug') ?? '').trim()
  const subdomain = String(host?.get('subdomain') ?? '').trim()
  const base = slug ? `/${slug}` : ''
  return {
    manage:
      slug && subdomain
        ? `${base}/hosts/${subdomain}/admin/domain`
        : slug
          ? `${base}/domains${domain ? `/${encodeURIComponent(domain)}` : ''}`
          : `${base}/sites`,
    billing: `${base}/billing`,
    siteName: host?.exists
      ? hostDisplayName(host.data() as Record<string, unknown>, hostId ?? '')
      : 'your site',
    orgName: String(org?.get('name') ?? '').trim() || 'your workspace',
  }
}

export async function sendDomainEmail(
  kind: DomainEmailKind,
  registration: DomainRegistrationDoc,
  merge: Record<string, string>,
): Promise<void> {
  try {
    // A ban is a ban (AGL-3420): after its notice the account is sent
    // nothing, by any sender — a renewal reminder included.
    const org = await db().collection('orgs').doc(registration.orgId).get().catch(() => null)
    const lock = normalizeOrgLockdown(org?.data() as never)
    if (lock && isAccountBanLockdownReason(lock.reason)) return
    const wording = WORDING[kind]
    const paths = await domainPagePath(registration.orgId, registration.hostId, registration.domain)
    const origin = platformConsoleOrigin()
    const fullMerge: Record<string, string> = {
      'domain.name': registration.domain,
      'site.name': paths.siteName,
      'org.name': paths.orgName,
      'domain.manageUrl': `${origin}${paths.manage}`,
      billingUrl: `${origin}${paths.billing}`,
      // A sentence the lifecycle wrote names the site as `{site}`.
      ...Object.fromEntries(
        Object.entries(merge).map(([key, value]) => [key, value.split('{site}').join(paths.siteName)]),
      ),
    }
    const title = wording.title(registration.domain, fullMerge)
    const body = wording.body(fullMerge).split('{site}').join(paths.siteName)

    const members = await listOrgMembers(registration.orgId)
    const addresses = members
      .filter((member) => member.role === 'owner' || member.role === 'admin')
      .map((member) => String((member as { email?: unknown }).email ?? ''))
      .filter(Boolean)
    const recipients = await filterSuppressedEmails(addresses)
    if (recipients.length) {
      const brand = await orgSystemEmailBrand(registration.orgId)
      const content = await renderSystemEmailContent(
        DOMAIN_EMAIL_KEYS[kind],
        fullMerge,
        brand,
        { subject: title, text: `${title}\n\n${body}\n\n${fullMerge['domain.manageUrl']}` },
      )
      const results = await Promise.all(
        recipients.map((to) =>
          sendEmail({
            to,
            ...content,
            ...(brand.fromName ? { fromName: brand.fromName } : {}),
            context: DOMAIN_EMAIL_KEYS[kind],
          }),
        ),
      )
      await meterPlatformEmail(results.filter((result) => result.sent).length)
    }
    await notifyOrgAdmins(
      registration.orgId,
      {
        type: wording.type,
        title,
        body,
        level: wording.level,
        link: wording.linkToBilling ? paths.billing : paths.manage,
        ...(registration.hostId ? { hostId: registration.hostId } : {}),
      },
      // The designed email above is the email; the notification is the feed.
      { skipEmail: true },
    )
  } catch (error) {
    console.error('[domains] email failed', kind, registration.domain, error)
  }
}
