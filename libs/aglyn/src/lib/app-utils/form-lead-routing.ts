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

import { type FormDocument, isFormArchived } from './forms'
import { checkEntitlement } from './plan-entitlements'

/** What a form submission's lead verdict reads off the stored form document. */
export type FormLeadRoutingInput = Pick<FormDocument, 'routing' | 'archivedAt'>

/**
 * WHETHER A FORM SUBMISSION FILES A LEAD (AGL-2790).
 *
 * Every submission that carries an email address updates the person in
 * Contacts. A LEAD is filed beside the contact only by a lead surface, and
 * which forms are lead surfaces is a question of the owning org's plan:
 *
 * - **With the CRM suite**, a form is a lead surface when its author declared
 *   `routing.lead` on the form document. A `Form` node with no form document
 *   declares nothing, so it files no lead.
 * - **Without the suite**, every live form is a lead surface. Leads is the
 *   one section of the CRM such a plan opens, read-only, so what the site
 *   captures has to land there. That includes a `Form` node with no form
 *   document — the only kind of form Free can place, because the saved-form
 *   catalog rides `reusableComponents`, which starts at Starter.
 *
 * Asked at capture time of the org's EFFECTIVE plan, through
 * `checkEntitlement`: a per-org grant or revocation of `features.crm`, a paid
 * plan whose subscription has died, an upgrade and a downgrade each answer
 * from the next submission on, and nothing stored has to be migrated.
 *
 * A retired form files nothing on any plan. The submit route refuses one
 * before it asks, and this answers the same for any other caller.
 */
export function submissionFilesLead(input: {
  /**
   * The verified form document the submission is bound to, or `null` for a
   * submission from a `Form` node with no form document.
   */
  form: FormLeadRoutingInput | null | undefined
  /** The owning org's billing document, as every plan gate reads it. */
  org: Parameters<typeof checkEntitlement>[0]
}): boolean {
  const { form, org } = input
  if (isFormArchived(form)) return false
  if (!checkEntitlement(org, 'crm')) return true
  return form?.routing?.lead === true
}
