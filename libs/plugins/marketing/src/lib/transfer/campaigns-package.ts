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

/*==========================================
 * CAMPAIGNS AS PACKAGE ITEMS (AGL-3535).
 *
 * An item is a campaign as it was planned: the container — its name, its
 * dates, the lists it aims at, its topic, the sites it is placed on, its
 * unsubscribe header — and each of its emails' copy: the subject, the
 * preheader and their alternatives, the email design it sends and the site
 * it sends as. Never what was sent, to whom, or how it did: no status, no
 * audience, no send time, no counts — the same things the campaign draft
 * writer will not hold, for the same reason. So an import lands every
 * email as a draft that nobody has aimed at anyone yet.
 *
 * What it names: its sites, its lists (`email.lists`), its topic
 * (`email.topics`), and each email's site and design
 * (`site.email-designs`). A dropped list or site leaves the campaign; a
 * dropped topic leaves it with none; an email whose site or design is
 * dropped is left out.
 *
 * The topic is a package item of the email plugin's (AGL-3550), so a
 * package that carries the campaign can carry its topic too, and a topic
 * kept beside the workspace's own is the one the campaign is pointed at.
 * Email lists are not package items and name no topic, so a list is only
 * ever mapped, left out or skipped.
 *
 * Pure: the server half (`campaigns-package.server.ts`) reads and writes.
 *=========================================*/

import { hostIdsFromScope, hostScopeToken, ORG_SCOPE_TOKEN } from '@aglyn/aglyn/app-utils/scope-tokens'
import type { PackageDependency } from '@aglyn/aglyn/data-transfer/package'
import { remapPackageReference, TRANSFER_SITE_KIND } from '@aglyn/aglyn/data-transfer/package-plan'

/** The resource key, and so the kind every campaign item carries. */
export const CAMPAIGNS_TRANSFER_KEY = 'marketing.campaigns'

/** The kinds a campaign's references are named under. */
export const CAMPAIGN_REFERENCE_KINDS = {
  list: 'email.lists',
  topic: 'email.topics',
  design: 'site.email-designs',
} as const

/** One email's copy, as a package carries it. */
export interface CampaignPackageEmail {
  subject: string
  preheader: string
  subjectVariants: string[]
  preheaderVariants: string[]
  /** The email design it sends: a `kind: 'email'` screen on its site. */
  templateScreenId: string | null
  /** The site it sends as. */
  hostId: string | null
}

/** A campaign as a package carries it. */
export interface CampaignPackageContent {
  name: string
  startAtMs: number | null
  endAtMs: number | null
  listIds: string[]
  topicId: string | null
  visibleTo: string[]
  listUnsubscribe: boolean
  emails: CampaignPackageEmail[]
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const id = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)
const ms = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry)) : []

/** One email's copy from a stored send or an incoming item. */
export function campaignPackageEmail(source: unknown): CampaignPackageEmail {
  const raw = (source && typeof source === 'object' ? source : {}) as Record<string, unknown>
  return {
    subject: text(raw['subject']),
    preheader: text(raw['preheader']),
    subjectVariants: texts(raw['subjectVariants']),
    preheaderVariants: texts(raw['preheaderVariants']),
    templateScreenId: id(raw['templateScreenId']),
    hostId: id(raw['hostId']),
  }
}

/** A campaign's package content from its container and its emails (oldest first), or from an incoming item. */
export function campaignPackageContent(container: unknown, emails?: readonly unknown[]): CampaignPackageContent {
  const raw = (container && typeof container === 'object' ? container : {}) as Record<string, unknown>
  return {
    name: text(raw['name']).trim(),
    startAtMs: ms(raw['startAtMs']),
    endAtMs: ms(raw['endAtMs']),
    listIds: texts(raw['listIds']),
    topicId: id(raw['topicId']),
    visibleTo: texts(raw['visibleTo']),
    listUnsubscribe: raw['listUnsubscribe'] !== false,
    emails: (emails ?? (Array.isArray(raw['emails']) ? raw['emails'] : [])).map(campaignPackageEmail),
  }
}

export function campaignDependencies(content: CampaignPackageContent): PackageDependency[] {
  const deps: PackageDependency[] = []
  const seen = new Set<string>()
  const add = (kind: string, value: string | null) => {
    if (!value || seen.has(`${kind}/${value}`)) return
    seen.add(`${kind}/${value}`)
    deps.push({ kind, id: value })
  }
  for (const hostId of hostIdsFromScope(content.visibleTo)) add(TRANSFER_SITE_KIND, hostId)
  for (const listId of content.listIds) add(CAMPAIGN_REFERENCE_KINDS.list, listId)
  add(CAMPAIGN_REFERENCE_KINDS.topic, content.topicId)
  for (const email of content.emails) {
    add(TRANSFER_SITE_KIND, email.hostId)
    add(CAMPAIGN_REFERENCE_KINDS.design, email.templateScreenId)
  }
  return deps
}

/** The campaign with every reference moved through `idMap` (see the block header for what a dropped one does). */
export function remapCampaignIds(content: CampaignPackageContent, idMap: ReadonlyMap<string, string>): CampaignPackageContent {
  const site = (hostId: string | null) => remapPackageReference(idMap, TRANSFER_SITE_KIND, hostId)
  return {
    ...content,
    visibleTo: content.visibleTo.flatMap((token) => {
      if (token === ORG_SCOPE_TOKEN) return [token]
      const [hostId] = hostIdsFromScope([token])
      if (!hostId) return [token]
      const mapped = site(hostId)
      return mapped ? [hostScopeToken(mapped)] : []
    }),
    listIds: content.listIds
      .map((listId) => remapPackageReference(idMap, CAMPAIGN_REFERENCE_KINDS.list, listId))
      .filter((listId): listId is string => Boolean(listId)),
    topicId: remapPackageReference(idMap, CAMPAIGN_REFERENCE_KINDS.topic, content.topicId),
    emails: content.emails.map((email) => ({
      ...email,
      hostId: site(email.hostId),
      templateScreenId: remapPackageReference(idMap, CAMPAIGN_REFERENCE_KINDS.design, email.templateScreenId),
    })),
  }
}

/** The emails an import can draft: each needs the site it sends as and the design it sends. */
export function draftableCampaignEmails(content: CampaignPackageContent): Array<CampaignPackageEmail & { hostId: string; templateScreenId: string }> {
  return content.emails.filter(
    (email): email is CampaignPackageEmail & { hostId: string; templateScreenId: string } =>
      Boolean(email.hostId && email.templateScreenId),
  )
}

export const CAMPAIGN_PACKAGE_RULES = [
  {
    id: 'drafts',
    label: 'Every imported email is a draft',
    reason:
      'A package carries a campaign’s copy, never an audience or a send time, so nothing is sent until someone picks who it goes to and sends it.',
  },
  {
    id: 'history',
    label: 'What was sent stays behind',
    reason: 'Sends, recipients and results belong to the workspace that sent them, and are never in a package.',
  },
  {
    id: 'replace',
    label: 'Replacing changes the campaign, not its emails',
    reason: 'A campaign you replace takes the package’s name, dates, lists and sites; the emails it already holds — some of them sent — stay as they are.',
  },
] as const
