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

import type { AnthropicCrmAssistanceWording } from './catalog'

/**
 * CRM assistance as `/legal/subprocessors` published it until October 5,
 * 2026: the disclosed fields of a record, with addresses and numbers in its
 * text replaced. It is still what production sends while
 * `release_crm_assist_whole_record` is off, which the published wording
 * covers: the row describes what the CRM can send, not who has it on.
 *
 * Kept beside the catalog rather than in it: nothing the console runs reads
 * it, and the client barrel exports the whole catalog, so a record of what was
 * published would load on every console page (AGL-3781).
 */
export const ANTHROPIC_CRM_ASSISTANCE_DISCLOSED: AnthropicCrmAssistanceWording = {
  record:
    "For CRM assistance, the opened contact, company, deal or lead as the CRM shows it: its name and, by kind, job title, company, lifecycle stage, tags, capture history and counts, domain, industry, headcount, pipeline stages, status, amount, dates, lost reason, parties and lead status, with its notes, newest timeline entries and open tasks and deals. Email addresses and phone numbers in that text are replaced, and no email, phone or postal field, marketing consent, custom field value, team member or record id is sent.",
  never: 'No account identifiers, email addresses or authentication tokens.',
}
