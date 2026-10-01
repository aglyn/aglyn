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

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import {
  type CrmMergeContext,
  type CrmMergeResult,
  resolveCrmMergeFields,
} from '@aglyn/aglyn/app-utils/crm-email-templates'
import { resolveMergeTags } from '@aglyn/shared-util-email/email-merge'

/**
 * The person a step's email is about, as the payload names them when no
 * record does: the `name` and `email` the event carried.
 */
export interface EmailMergePerson {
  name?: string | null
  email?: string | null
}

/** One CRM field's value, through the one-to-one email's own resolver. */
const field = (key: string, context: CrmMergeContext): string =>
  resolveCrmMergeFields(`{{${key}}}`, context).text.trim()

/**
 * A `sendEmail` step's subject or body with its merge tags filled from the
 * contact or the lead the run is about (AGL-3458) — which went out literally
 * before, so a reply greeted somebody as `{{firstName|there}}`.
 *
 * Both spellings a merchant has been shown resolve, because a workflow email
 * is written by the same people who write the other two:
 *
 *  - the CRM's fields, `{{contact.firstName}}`, `{{lead.company}}`,
 *    `{{site.name}}` — `resolveCrmMergeFields`, the one-to-one email's
 *    resolver, run over the record the run resolved;
 *  - the campaign's short tags, `{{firstName|there}}`, `{{name}}`,
 *    `{{email}}` — `resolveMergeTags`, the campaign sender's own resolver, run
 *    over the same person: the contact's name as this site knows it, else
 *    the lead's, else the name the event carried.
 *
 * Both honor `|fallback`, and an unknown tag prints its fallback or nothing,
 * never its braces — a typo must not reach a customer as `{{frstName}}`.
 * Pure; the caller hands over what it read.
 */
export function resolveStepEmailMerge(
  text: string,
  context: CrmMergeContext,
  person: EmailMergePerson | null = null,
): CrmMergeResult {
  const crm = resolveCrmMergeFields(text, context)
  const name =
    field('contact.name', context) ||
    field('lead.name', context) ||
    (typeof person?.name === 'string' ? person.name.trim() : '')
  const email =
    field('contact.email', context) ||
    field('lead.email', context) ||
    (normalizeContactEmail(person?.email) ?? '')
  return {
    text: resolveMergeTags(crm.text, { email, ...(name ? { name } : {}) }),
    unresolved: crm.unresolved,
  }
}
