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
 * The host subcollections whose documents may name a campaign.
 *
 * The list a campaign's deletion walks, and the list the assignment surfaces
 * spec reads — so a collection that grows a picker without growing the
 * detach fails the build rather than shipping a campaign whose removal
 * leaves that collection pointing at nothing.
 *
 * `leads` is here for the site rows the lead migration (AGL-3276) has not
 * reached. A live lead is an org row (`orgs/{orgId}/leads/{personKey}`) that
 * carries the field at the top of its document like a form does, and the
 * deletion walks that collection by name beside this list.
 *
 * Contacts are deliberately NOT here. They live on the org
 * (`orgs/{orgId}/contacts`), not the host, and carry the field inside a
 * per-holder facet — so they are detached by their own pass, against a field
 * path that names the group. Nor are another plugin's own members — a
 * sequence and its enrollments live under the org, in collections this
 * plugin does not name — so that plugin registers a detacher
 * (`plugin-manager/plugin-membership-detach.ts`) and the deletion runs it.
 */
export const CAMPAIGN_MEMBER_HOST_COLLECTIONS = ['forms', 'screens', 'leads'] as const
