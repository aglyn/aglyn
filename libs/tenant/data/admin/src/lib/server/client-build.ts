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
  CLIENT_BUILD_COLLECTION,
  CLIENT_BUILD_DOC_ID,
  clientBuildIntent,
  clientBuildPhone,
  clientBuildPreviewText,
  clientBuildSiteAddress,
  EMPTY_CLIENT_BUILD_INTAKE,
  parseClientBuildDomain,
  parseClientBuildIntake,
  readClientBuildIntent,
  type ClientBuildDomain,
  type ClientBuildIntent,
  type ClientBuildRecord,
} from '@aglyn/aglyn/app-utils/client-build'
import { hostPublicOrigin } from '@aglyn/aglyn/app-utils/host-naming'
import { readOrgPlanComp } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  pluginSmsMessaging,
  type PluginSmsSendOutcome,
} from '@aglyn/aglyn/plugin-manager/plugin-sms-messaging'
import type { AglynOrgBilling } from '@aglyn/aglyn/server'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { addAdminAudit } from './admin-audit-write'
import { meterOrgEmail } from './email-metering'
import firebaseAdmin from './firebase-admin'
import { renderSystemEmailContent, systemEmailBrand } from './render-system-email'

/**
 * THE ONE-SCREEN BUILD FOR A CLIENT, ON THE SERVER (AGL-3958).
 *
 * One record per workspace, at `orgs/{orgId}/clientBuild/current`, which the
 * rules open to no client: the owner's phone and email are staff's to hold
 * until the owner joins, and the org document is read by every member. Only
 * `/api/admin/client-build` (staff) calls this module.
 */

const firestore = () => firebaseAdmin.app().firestore()

/** A refusal the route answers with its status. */
export class ClientBuildError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ClientBuildError'
  }
}

function recordRef(orgId: string) {
  return firestore().collection('orgs').doc(orgId).collection(CLIENT_BUILD_COLLECTION).doc(CLIENT_BUILD_DOC_ID)
}

/** A stored record, read back defensively; `null` when the workspace has none. */
export function readClientBuildRecord(raw: unknown): ClientBuildRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const intake = parseClientBuildIntake(source['intake'])
  const domain = source['domain'] ? parseClientBuildDomain(source['domain']) : null
  const intent = readClientBuildIntent(source['intent'])
  const text = (value: unknown) => (typeof value === 'string' && value ? value : null)
  const time = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  return {
    // A stored intake that no longer validates is still the one staff typed.
    intake: typeof intake === 'string' ? { ...EMPTY_CLIENT_BUILD_INTAKE, ...(source['intake'] as object) } : intake,
    domain: typeof domain === 'string' ? null : domain,
    intent: intent ?? clientBuildIntent({ plan: null, domain: typeof domain === 'string' ? null : domain }),
    hostId: text(source['hostId']),
    host: text(source['host']),
    jobId: text(source['jobId']),
    previewSentAt: time(source['previewSentAt']),
    updatedAt: time(source['updatedAt']) ?? 0,
    updatedBy: text(source['updatedBy']) ?? '',
  }
}

/** The workspace's build, or `null` before one was started. */
export async function loadClientBuild(orgId: string): Promise<ClientBuildRecord | null> {
  const snapshot = await recordRef(orgId).get()
  return snapshot.exists ? readClientBuildRecord(snapshot.data()) : null
}

/**
 * The intent the hand-off proposes (AGL-3955, AGL-3956): what the build left
 * for the owner's checkout, or `null` when the workspace was not built here.
 */
export async function loadClientBuildIntent(orgId: string): Promise<ClientBuildIntent | null> {
  return (await loadClientBuild(orgId))?.intent ?? null
}

/** What a save may change; each part left out keeps what is stored. */
export interface ClientBuildPatch {
  intake?: unknown
  domain?: unknown
  hostId?: unknown
  host?: unknown
  jobId?: unknown
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Writes the build, merged over what is stored. The intake and the domain
 * are validated as the screen validated them; the intent is derived, never
 * taken from the body: the plan the workspace was comped on, Site Care, and
 * the domain the Domain step recorded. A site is accepted only when it
 * belongs to this workspace.
 */
export async function saveClientBuild(options: {
  orgId: string
  actorUid: string
  patch: ClientBuildPatch
  now?: number
}): Promise<ClientBuildRecord> {
  const { orgId, actorUid, patch } = options
  const org = await firestore().collection('orgs').doc(orgId).get()
  if (!org.exists) throw new ClientBuildError('Unknown workspace', 404)
  const stored = await loadClientBuild(orgId)

  let intake = stored?.intake ?? null
  if (patch.intake !== undefined) {
    const parsed = parseClientBuildIntake(patch.intake)
    if (typeof parsed === 'string') throw new ClientBuildError(parsed, 400)
    intake = parsed
  }
  if (!intake) throw new ClientBuildError('Missing the business details', 400)

  let domain: ClientBuildDomain | null = stored?.domain ?? null
  if (patch.domain !== undefined) {
    if (patch.domain === null) domain = null
    else {
      const parsed = parseClientBuildDomain(patch.domain)
      if (typeof parsed === 'string') throw new ClientBuildError(parsed, 400)
      domain = parsed
    }
  }

  let hostId = stored?.hostId ?? null
  let host = stored?.host ?? null
  if (patch.hostId !== undefined) {
    const id = String(patch.hostId ?? '')
    if (!ID_PATTERN.test(id)) throw new ClientBuildError('Unknown site', 400)
    const site = await firestore().collection('hosts').doc(id).get()
    if (!site.exists || site.get('orgId') !== orgId) {
      throw new ClientBuildError('That site is not in this workspace', 400)
    }
    hostId = id
    host = typeof site.get('subdomain') === 'string' ? site.get('subdomain') : (patch.host ? String(patch.host) : null)
  }

  let jobId = stored?.jobId ?? null
  if (patch.jobId !== undefined) {
    const id = String(patch.jobId ?? '')
    if (!ID_PATTERN.test(id)) throw new ClientBuildError('Unknown job', 400)
    jobId = id
  }

  const record: ClientBuildRecord = {
    intake,
    domain,
    // Derived on every write, never taken from the body: the plan the
    // workspace was comped on, Site Care, monthly, and the domain above.
    intent: clientBuildIntent({
      plan: readOrgPlanComp(org.data() as Partial<AglynOrgBilling>)?.plan ?? null,
      domain,
    }),
    hostId,
    host,
    jobId,
    previewSentAt: stored?.previewSentAt ?? null,
    updatedAt: options.now ?? Date.now(),
    updatedBy: actorUid,
  }
  await recordRef(orgId).set(record)
  return record
}

/** What sending the preview came to, per channel. */
export interface ClientBuildPreviewOutcome {
  emailed: boolean
  /** The text's outcome; `none` when the intake has no phone to text. */
  text: PluginSmsSendOutcome['status'] | 'none' | 'unavailable'
  previewUrl: string
  siteAddress: string | null
}

/**
 * Sends the owner the preview: a text and an email with the link to the site
 * as it is now and the address it will live at. Only once the site has a
 * published page, since the link would otherwise open an empty site. Each
 * channel is attempted on its own and reported; the send is an Audit Log row.
 */
export async function sendClientBuildPreview(options: {
  orgId: string
  actorUid: string
  now?: number
}): Promise<ClientBuildPreviewOutcome> {
  const { orgId, actorUid } = options
  const record = await loadClientBuild(orgId)
  if (!record?.hostId) throw new ClientBuildError('Build the site first', 409)
  const [orgSnapshot, siteSnapshot] = await Promise.all([
    firestore().collection('orgs').doc(orgId).get(),
    firestore().collection('hosts').doc(record.hostId).get(),
  ])
  if (!siteSnapshot.exists || siteSnapshot.get('orgId') !== orgId) {
    throw new ClientBuildError('That site is not in this workspace', 409)
  }
  const site = siteSnapshot.data() as { screens?: Record<string, unknown>; subdomain?: string; cname?: string }
  if (!Object.keys(site.screens ?? {}).length) {
    throw new ClientBuildError('The site has no published page yet', 409)
  }
  const previewUrl = hostPublicOrigin({ subdomain: site.subdomain ?? null })
  if (!previewUrl) throw new ClientBuildError('The site has no address yet', 409)
  const siteAddress = clientBuildSiteAddress(record.domain, previewUrl)
  const { intake } = record
  const businessName = intake.businessName || 'your business'

  const brand = systemEmailBrand(orgSnapshot.data() as Record<string, unknown>)
  const productName = brand.merge['brand.productName'] || PLATFORM_BRAND_NAME

  let emailed = false
  if (intake.email && isEmailConfigured()) {
    try {
      const content = await renderSystemEmailContent(
        'client-build-preview',
        {
          'business.name': businessName,
          'preview.url': previewUrl,
          'site.address': siteAddress ?? previewUrl,
        },
        brand,
        {
          subject: `Your new website for ${businessName} is ready to look at`,
          text:
            `We built the website for ${businessName} with you today. Open it on your phone and look ` +
            `around: every page, picture and word can still be changed.\n\n${previewUrl}` +
            (siteAddress ? `\n\nIt will live at ${siteAddress}.` : ''),
        },
      )
      const result = await sendEmail({
        to: intake.email,
        subject: content.subject,
        text: content.text,
        ...(content.html ? { html: content.html } : {}),
        ...(brand.fromName ? { fromName: brand.fromName } : {}),
        context: 'client-build-preview',
      })
      emailed = result.sent
      if (result.sent) await meterOrgEmail(orgId)
    } catch (error) {
      console.error('[client-build] the preview email failed', error)
    }
  }

  let text: ClientBuildPreviewOutcome['text'] = 'none'
  const phone = clientBuildPhone(intake)
  if (phone) {
    const sms = pluginSmsMessaging()
    if (!sms?.isConfigured()) text = 'unavailable'
    else {
      const outcome = await sms.send({
        to: phone,
        body: clientBuildPreviewText({ businessName, previewUrl, siteAddress, productName }),
        hostId: record.hostId,
        // Owed to the owner's own request, at the booth or the door, and
        // waited on right now: never held for quiet hours.
        purpose: 'transactional',
        context: 'client-build-preview',
      })
      text = outcome.status
    }
  }

  const sentAt = options.now ?? Date.now()
  if (emailed || text === 'sent') await recordRef(orgId).set({ previewSentAt: sentAt }, { merge: true })
  await addAdminAudit(firestore(), {
    actorUid,
    action: 'client-build.preview-sent',
    target: `orgs/${orgId}`,
    // Which channels went, never the owner's address or number.
    after: { hostId: record.hostId, emailed, text },
    at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
  })
  return { emailed, text, previewUrl, siteAddress }
}
