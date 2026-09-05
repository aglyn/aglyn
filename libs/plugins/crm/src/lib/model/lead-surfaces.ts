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

import { formFieldsCanYieldAnEmail } from '@aglyn/aglyn'

/**
 * How many forms the Leads section reads to say which of them create leads.
 *
 * A read WINDOW, and one more than the window is read so the caption can say
 * "and more" as a fact. The Inbox's form picker draws the same window from
 * the same collection.
 */
export const LEAD_SURFACE_FORMS_WINDOW = 50

/** Why a form cannot be made a lead surface, in the author's terms. */
export const LEAD_ROUTING_NEEDS_EMAIL_FIELD =
  'This form has no email field, so a submission could not key a lead. ' +
  'Add one in the besigner first.'

/** One of the site's forms, as the Leads section describes it. */
export interface LeadSurfaceForm {
  $id: string
  displayName: string
  /** `routing.lead` is on: every submission with an address files a lead. */
  routed: boolean
  /** Whether routing may be turned on — the same precondition the publish check applies. */
  canRoute: boolean
  /** Why it may not, when it may not. */
  blocker: string | null
  /** Whether the form names a consent field, which is what makes a lead mailable. */
  hasConsentField: boolean
}

/**
 * The site's forms, sorted, each with its lead-routing verdict (AGL-2612).
 *
 * The Leads section answers "what creates a lead here?" — sign-ups and
 * bookings always do, and a form does only when its author declared
 * `routing.lead`. Nothing in the CRM said which forms had, so the
 * relationship between the Leads list and the Contacts list was invisible:
 * a form's captures landed in Contacts at stage Lead and in Leads only if
 * somebody had flipped a switch on the form's own page.
 *
 * Pure over the raw documents so the verdict is testable without a
 * listener. An archived form is left out: it collects nothing, so whether
 * it would route is not a fact about the site. The email precondition is
 * `formFieldsCanYieldAnEmail`, the same check `checkFormContract` runs at
 * publish, so a switch this section offers is one the publish would honor.
 */
export function leadSurfaceForms(
  docs: ReadonlyArray<Record<string, unknown> & { $id: string }>,
): LeadSurfaceForm[] {
  return docs
    .filter((form) => !form['archivedAt'])
    .map((form) => {
      const fields = Array.isArray(form['fields'])
        ? (form['fields'] as Array<Record<string, unknown>>)
            .filter((field) => field && typeof field === 'object')
            .map((field) => ({
              fieldName: String(field['fieldName'] ?? ''),
              fieldType: String(field['fieldType'] ?? 'text'),
            }))
        : []
      const routing = (form['routing'] ?? {}) as Record<string, unknown>
      const canRoute = formFieldsCanYieldAnEmail(fields)
      return {
        $id: form.$id,
        displayName: String(form['displayName'] ?? '').trim() || form.$id,
        routed: routing['lead'] === true,
        canRoute,
        blocker: canRoute ? null : LEAD_ROUTING_NEEDS_EMAIL_FIELD,
        hasConsentField: Boolean(
          String(form['consentFieldName'] ?? '').trim(),
        ),
      }
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}
