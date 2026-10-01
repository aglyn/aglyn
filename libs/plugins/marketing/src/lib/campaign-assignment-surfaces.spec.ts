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

/**
 * A CAMPAIGN IS ASSIGNABLE FROM THE RECORD, AND DETACHABLE FROM THE CAMPAIGN.
 *
 * Two halves that have to stay in step, and nothing in the type system holds
 * them together:
 *
 *  1. **Every record kind that can be put in a campaign has a picker.** The
 *     rule this console runs on is that a record is edited on its own page —
 *     so a kind whose only route to a campaign was raw JSON would be a
 *     missing console feature, not a workaround.
 *  2. **Every collection a picker writes to is walked by the delete.** A
 *     form's and a screen's are this plugin's to clear:
 *     `CAMPAIGN_MEMBER_HOST_COLLECTIONS` is what `campaign-manage.ts`
 *     iterates. A lead's and a contact's are the CRM's, cleared by the
 *     membership detacher it registers, which the deletion runs. A picker
 *     added to another collection without either would ship a campaign whose
 *     deletion leaves that collection holding an id nothing resolves — and it
 *     would ship silently, because both sides compile perfectly.
 *
 * Read from the SOURCE rather than restated, so the guard cannot agree with a
 * comment while the code says something else. The surfaces are other
 * plugins' and the console's, read by path: nothing here imports them.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CAMPAIGN_MEMBERSHIP_FIELD,
  CAMPAIGN_MEMBER_HOST_COLLECTIONS,
} from './model/campaign-kind'

const REPO = join(__dirname, '..', '..', '..', '..', '..')

const read = (path: string): string => readFileSync(join(REPO, path), 'utf8')

/**
 * The surface each assignable record kind is edited on.
 *
 * A screen's page is in `apps/console` and a form's is in a plugin library —
 * which is exactly why the picker is the core's generic container picker,
 * handed the `campaign` kind this plugin declares, rather than a component of
 * this plugin: an app may not import a feature plugin, so a control that
 * lived here could never reach the screen page.
 */
const ASSIGNMENT_SURFACES: Record<string, string> = {
  screens:
    'apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view/page.tsx',
  forms: 'libs/plugins/forms/src/lib/components/form-detail-card.tsx',
  // The record page's Relationship card (AGL-2596); the list's drawer that
  // held the picker before is gone.
  contacts: 'libs/plugins/crm/src/lib/components/contact-associations-card.tsx',
  // The lead's page has the contact card's twin (AGL-3274): the record's
  // own Campaigns card, where the filing is read and changed. The drawer
  // that files a lead as it is created (AGL-3254) is covered below on its
  // own, because a kind's page is the surface this list is about.
  leads: 'libs/plugins/crm/src/lib/components/lead-campaigns-card.tsx',
}

/** Where a lead is filed as it is created — a second door, beside its page. */
const LEAD_CREATE_SURFACE = 'libs/plugins/crm/src/lib/components/new-lead-drawer.tsx'

/** Where a campaign's removal walks the members this plugin clears. */
const DELETE_PATH = 'libs/plugins/marketing/src/lib/server/campaign-manage.ts'

/** Where the CRM clears its own: a lead's field and a contact's facet. */
const CRM_DETACH_PATH = 'libs/plugins/crm/src/lib/server/container-detach.ts'

/** The record kinds whose records are the CRM's, cleared by its detacher. */
const CRM_KINDS = ['contacts', 'leads']

describe('every assignable record kind has a picker on its own page', () => {
  it.each(Object.entries(ASSIGNMENT_SURFACES))(
    'a %s is put in a campaign from %s',
    (_kind, path) => {
      const source = read(path)
      /*
       * RENDERED, not merely imported. An import that no JSX reaches is the
       * shape a picker takes when somebody removes the control and leaves the
       * import behind, and a name check alone would call that surface covered.
       */
      expect(source).toMatch(/<ContainerPicker\s+kind="campaign"/)
      /*
       * The SHARED control, by import path. A surface that hand-rolled its
       * own select would satisfy a name check and would be the third way this
       * console edits one stored field.
       */
      expect(source).toContain(
        '@aglyn/tenant-feature-instance/components/container-picker',
      )
    },
  )

  it.each(Object.entries(ASSIGNMENT_SURFACES))(
    'the %s surface writes through the shared value helper',
    (kind, path) => {
      /*
       * `containerMembershipValue` is what turns an empty selection into a
       * stored empty array. A surface writing the picker's raw output would
       * work until somebody cleared the last campaign. A form writes it
       * through `formCampaignFields`, which stamps the Forms list's
       * `inCampaign` beside it (AGL-3330) — asserted to wrap the helper below.
       */
      expect(read(path)).toContain(kind === 'forms' ? 'formCampaignFields' : 'containerMembershipValue')
    },
  )

  it("a form's campaign fields are the shared value helper's, plus the list's flag", () => {
    const forms = read('libs/aglyn/src/lib/app-utils/forms.ts')
    expect(forms).toMatch(/export function formCampaignFields[\s\S]*?containerMembershipValue\(/)
  })

  it('a lead is also filed as it is created, by the same control and helper', () => {
    const source = read(LEAD_CREATE_SURFACE)
    expect(source).toMatch(/<ContainerPicker\s+kind="campaign"/)
    expect(source).toContain(
      '@aglyn/tenant-feature-instance/components/container-picker',
    )
    expect(source).toContain('containerMembershipValue')
  })
})

describe('the campaign’s removal walks every collection a picker writes', () => {
  it('names the host collections the pickers write to, but the CRM’s', () => {
    const hostCollections = Object.keys(ASSIGNMENT_SURFACES).filter(
      (kind) => !CRM_KINDS.includes(kind),
    )
    expect([...CAMPAIGN_MEMBER_HOST_COLLECTIONS].sort()).toEqual(
      hostCollections.sort(),
    )
  })

  it('iterates that list rather than a second copy of it, and asks every plugin', () => {
    const source = read(DELETE_PATH)
    expect(source).toContain('CAMPAIGN_MEMBER_HOST_COLLECTIONS')
    /*
     * The field by its CONSTANT, and the literal nowhere. A hand-typed
     * `'campaignIds'` in the detach is a second copy of the field name, and
     * the copy that goes stale is the one nothing reads back.
     */
    expect(source).toContain('CAMPAIGN_MEMBERSHIP_FIELD')
    expect(source).not.toContain(`'${CAMPAIGN_MEMBERSHIP_FIELD}'`)
    expect(source).toContain('runPluginMembershipDetachers(')
  })

  it('leaves the CRM’s leads and contacts to the detacher the CRM registers', () => {
    const detach = read(CRM_DETACH_PATH)
    // A lead on the org and on the site, by the membership field…
    expect(detach).toMatch(/collection\('leads'\)/)
    // …and a contact inside the site's consent group's facet: a facet path is
    // not a top-level field name.
    expect(detach).toMatch(/collection\('contacts'\)/)
    expect(detach).toContain('contactContainerFieldPath')
    expect(read('libs/plugins/crm/src/lib/declarations.console-server.ts')).toContain(
      'registerPluginMembershipDetacher(',
    )
  })

  it('clears one campaign rather than the whole membership', () => {
    /*
     * `arrayRemove`, never a field delete. A record in two campaigns must
     * lose exactly the one being deleted — the send collection's scalar
     * `emailCampaignId` is the only field here that may be removed outright.
     */
    expect(read(DELETE_PATH)).toContain('arrayRemove')
    expect(read(CRM_DETACH_PATH)).toContain('arrayRemove')
  })
})
