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
 * SEQUENCES AS PACKAGE ITEMS (AGL-3535) — what a sequence carries in a
 * workspace package, what it names, and how a reference moves.
 *
 * An item is the sequence as the editor holds it (`OutreachSequenceDraft`):
 * its name, site, mailbox, steps, settings and campaigns. Never its status,
 * its counters or anyone enrolled in it — a package carries how a sequence
 * reads, not who it reached — so a sequence exported and imported back is
 * `identical`, and an import never brings sending with it.
 *
 * What it names: its site (`site`), its mailbox (`outreach.mailboxes`, a
 * kind no package carries: mailboxes are connected, never imported), its
 * campaigns (`marketing.campaigns`) and each email step's CRM template
 * (`crm.emailTemplates`). A reference the person drops leaves the site and
 * mailbox empty, the campaign off the list and the step on its own subject
 * and body.
 *
 * Pure: the server half (`sequences-package.server.ts`) reads and writes.
 *=========================================*/

import type { PackageDependency } from '@aglyn/aglyn/data-transfer/package'
import { remapPackageReference, TRANSFER_SITE_KIND } from '@aglyn/aglyn/data-transfer/package-plan'
import { readOutreachSequenceDraft, type OutreachSequenceDraft } from '../model/sequence-draft'

/** The resource key, and so the kind every sequence item carries. */
export const OUTREACH_SEQUENCES_TRANSFER_KEY = 'outreach.sequences'

/** The kind a sequence's mailbox is named under; the workspace's connected mailboxes answer it. */
export const OUTREACH_MAILBOX_REFERENCE_KIND = 'outreach.mailboxes'

/** The marketing plugin's campaigns resource, which a sequence's campaigns name. */
export const OUTREACH_CAMPAIGN_REFERENCE_KIND = 'marketing.campaigns'

/** The CRM's email templates resource, which an email step's template names. */
export const OUTREACH_TEMPLATE_REFERENCE_KIND = 'crm.email-templates'

/** A sequence as a package carries it. */
export type OutreachSequencePackageContent = OutreachSequenceDraft

/** The package content of a stored sequence (or anything shaped like one): the editor's draft, nothing else. */
export function outreachSequencePackageContent(source: unknown): OutreachSequencePackageContent {
  return readOutreachSequenceDraft(source)
}

/** What a sequence names. */
export function outreachSequenceDependencies(content: OutreachSequencePackageContent): PackageDependency[] {
  const deps: PackageDependency[] = []
  const seen = new Set<string>()
  const add = (kind: string, id: string | null | undefined) => {
    if (!id || seen.has(`${kind}/${id}`)) return
    seen.add(`${kind}/${id}`)
    deps.push({ kind, id })
  }
  add(TRANSFER_SITE_KIND, content.hostId)
  add(OUTREACH_MAILBOX_REFERENCE_KIND, content.mailboxId)
  for (const mailboxId of content.mailboxIds ?? []) add(OUTREACH_MAILBOX_REFERENCE_KIND, mailboxId)
  for (const campaignId of content.campaignIds ?? []) add(OUTREACH_CAMPAIGN_REFERENCE_KIND, campaignId)
  for (const step of content.steps ?? []) {
    if (step.kind === 'email') add(OUTREACH_TEMPLATE_REFERENCE_KIND, step.templateId)
  }
  return deps
}

/** The sequence with every reference moved through `idMap`; a dropped one is emptied. */
export function remapOutreachSequenceIds(
  content: OutreachSequencePackageContent,
  idMap: ReadonlyMap<string, string>,
): OutreachSequencePackageContent {
  return {
    ...content,
    hostId: remapPackageReference(idMap, TRANSFER_SITE_KIND, content.hostId) ?? '',
    mailboxId: remapPackageReference(idMap, OUTREACH_MAILBOX_REFERENCE_KIND, content.mailboxId) ?? '',
    ...(content.mailboxIds?.length
      ? {
          mailboxIds: content.mailboxIds
            .map((id) => remapPackageReference(idMap, OUTREACH_MAILBOX_REFERENCE_KIND, id))
            .filter((id): id is string => Boolean(id)),
        }
      : {}),
    campaignIds: (content.campaignIds ?? [])
      .map((id) => remapPackageReference(idMap, OUTREACH_CAMPAIGN_REFERENCE_KIND, id))
      .filter((id): id is string => Boolean(id)),
    steps: (content.steps ?? []).map((step) =>
      step.kind === 'email'
        ? { ...step, templateId: remapPackageReference(idMap, OUTREACH_TEMPLATE_REFERENCE_KIND, step.templateId) }
        : step,
    ),
  }
}

/** The rules an import of sequences keeps, shown with their reasons. */
export const OUTREACH_SEQUENCE_PACKAGE_RULES = [
  {
    id: 'draft',
    label: 'An imported sequence arrives as a draft',
    reason:
      'A sequence emails people only once someone activates it, and an import never does. A sequence you replace keeps the status it already had.',
  },
  {
    id: 'noEnrollments',
    label: 'Nobody enrolled moves with it',
    reason: 'A package carries how a sequence reads: its steps and settings. Who was enrolled and what they were sent stay where they happened.',
  },
  {
    id: 'mailbox',
    label: 'It sends from a mailbox connected here',
    reason: 'A mailbox is connected by the person who sends from it, so an imported sequence is pointed at one of this workspace’s mailboxes.',
  },
] as const
