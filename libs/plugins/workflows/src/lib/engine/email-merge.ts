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
import { findPluginPerson } from '@aglyn/aglyn/plugin-manager/plugin-person-records'
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
 * contact or the lead the run is about (AGL-3458), so a reply greets the
 * person by name rather than as `{{firstName|there}}`.
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

/**
 * The records a step's email is about, for its merge tags: the person the
 * event names, as the plugin that keeps people holds them — a contact, else
 * the lead a lead-routed form filed — and the site's name, in the shape the
 * one-to-one email's resolver takes (`resolveStepEmailMerge`).
 *
 * Asked through the person-records seam (`findPluginPerson`), narrowed to
 * what this site may see, so the engine opens no record system's storage. A
 * workspace with no record system, or a person nobody holds yet, leaves both
 * records out, and the tags fall back to the name and address the event
 * carried.
 *
 * **Never throws.** A lookup that fails is an email with its fallbacks, never
 * an email that did not leave.
 */
export async function stepEmailMergeContext(input: {
  hostId: string
  /** The address of the person the event is about. */
  email: unknown
  /** The holder group whose facet names a contact: the sending site's. */
  contactGroupId: string
  siteName: string
}): Promise<CrmMergeContext> {
  const context: CrmMergeContext = { site: { name: input.siteName } }
  try {
    const person = await findPluginPerson({
      hostId: input.hostId,
      email: input.email,
      onlyVisibleToSite: true,
      anyKind: true,
    })
    const data = person ? { ...person.data } : null
    if (person?.kind === 'contact') {
      return { ...context, contact: data, contactGroupId: input.contactGroupId }
    }
    if (person?.kind === 'lead') return { ...context, lead: data }
  } catch (error) {
    console.error('[workflow] email merge context could not be read', input.hostId, error)
  }
  return context
}
