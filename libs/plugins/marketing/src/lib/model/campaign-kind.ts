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

import { containerMembershipField } from '@aglyn/aglyn/app-utils/container-membership'

/**
 * A CAMPAIGN, AS A CONTAINER KIND.
 *
 * This plugin keeps campaigns and declares the kind in `plugins.config.json`
 * (`containers`): the containers are `orgs/{orgId}/emailCampaigns`, and a
 * form, a screen, a lead or a contact is filed under one by carrying its id
 * in `campaignIds` on its own document. The other plugins that file records
 * under a campaign name the kind, never this module; the core derives the
 * field from it (`app-utils/container-membership.ts`).
 */
export const CAMPAIGN_KIND = 'campaign'

/**
 * The field a member holds its campaigns in. Persisted on every filed form,
 * screen and lead, and inside each holder's facet on a contact.
 */
export const CAMPAIGN_MEMBERSHIP_FIELD = containerMembershipField(CAMPAIGN_KIND)

/**
 * The host subcollections whose documents may name a campaign and that this
 * plugin clears when a campaign is deleted: a form's and a screen's, filed
 * from their own pages.
 *
 * The list a campaign's deletion walks, and the list the assignment surfaces
 * spec reads — so a collection that grows a picker without growing the
 * detach fails the build rather than shipping a campaign whose removal
 * leaves that collection pointing at nothing.
 *
 * Another plugin's members are NOT here. A lead and a contact are the CRM's
 * — a lead carries the field at the top of its document, on the org and on
 * the site rows the lead migration has not reached, and a contact inside a
 * per-holder facet — and a sequence and its enrollments are Outreach's. Each
 * of those plugins registers a detacher
 * (`plugin-manager/plugin-membership-detach.ts`) and the deletion runs it.
 */
export const CAMPAIGN_MEMBER_HOST_COLLECTIONS = ['forms', 'screens'] as const
