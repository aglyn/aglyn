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
 *  2. **Every HOST collection a picker writes to is walked by the delete.**
 *     `CAMPAIGN_MEMBER_HOST_COLLECTIONS` is what `campaign-manage.ts`
 *     iterates. A picker added to a fourth collection without adding the name
 *     there would ship a campaign whose deletion leaves that collection
 *     holding an id nothing resolves — and it would ship silently, because
 *     both sides compile perfectly.
 *
 * Read from the SOURCE rather than restated, so the guard cannot agree with a
 * comment while the code says something else.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CAMPAIGN_MEMBERSHIP_FIELD,
  CAMPAIGN_MEMBER_HOST_COLLECTIONS,
} from '@aglyn/aglyn'

const REPO = join(__dirname, '..', '..', '..')

const read = (path: string): string => readFileSync(join(REPO, path), 'utf8')

/**
 * The surface each assignable record kind is edited on.
 *
 * A screen's page is in `apps/console` and a form's is in a plugin library —
 * which is exactly why the picker is a presentational component in a shared
 * ui lib rather than a marketing-plugin one: an app may not import a feature
 * plugin, so a control that lived there could never reach the screen page.
 */
const ASSIGNMENT_SURFACES: Record<string, string> = {
  screens:
    'apps/console/app/(editor)/[orgSlug]/hosts/[host]/screens/[screenId]/versions/[versionId]/view/page.tsx',
  forms: 'libs/plugins/forms/src/lib/components/form-detail-card.tsx',
  contacts:
    'libs/plugins/contacts/src/lib/components/contacts-console-page.tsx',
}

/** The one place a campaign's removal walks its members. */
const DELETE_PATH = 'libs/plugins/marketing/src/lib/server/campaign-manage.ts'

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
      expect(source).toContain('<CampaignPicker')
      /*
       * The SHARED control, by import path. A surface that hand-rolled its
       * own select would satisfy a name check and would be the third way this
       * console edits one stored field.
       */
      expect(source).toContain(
        '@aglyn/shared-ui-email-campaigns/components/campaign-picker.component',
      )
    },
  )

  it.each(Object.entries(ASSIGNMENT_SURFACES))(
    'the %s surface writes through the shared value helper',
    (_kind, path) => {
      /*
       * `campaignMembershipValue` is what turns an empty selection into a
       * stored empty array. A surface writing the picker's raw output would
       * work until somebody cleared the last campaign.
       */
      expect(read(path)).toContain('campaignMembershipValue')
    },
  )
})

describe('the campaign’s removal walks every collection a picker writes', () => {
  it('names the host collections the pickers write to', () => {
    const hostCollections = Object.keys(ASSIGNMENT_SURFACES).filter(
      // Contacts live on the ORG, not the host, and are detached by their own
      // pass against a facet path rather than by this list.
      (kind) => kind !== 'contacts',
    )
    expect([...CAMPAIGN_MEMBER_HOST_COLLECTIONS].sort()).toEqual(
      hostCollections.sort(),
    )
  })

  it('iterates that list rather than a second copy of it', () => {
    const source = read(DELETE_PATH)
    expect(source).toContain('CAMPAIGN_MEMBER_HOST_COLLECTIONS')
    /*
     * The field by its CONSTANT, and the literal nowhere. A hand-typed
     * `'campaignIds'` in the detach is a second copy of the field name, and
     * the copy that goes stale is the one nothing reads back.
     */
    expect(source).toContain('CAMPAIGN_MEMBERSHIP_FIELD')
    expect(source).not.toContain(`'${CAMPAIGN_MEMBERSHIP_FIELD}'`)
    // The contact pass is separate and must stay separate: a facet path is
    // not a top-level field name.
    expect(source).toContain('contactCampaignFieldPath')
  })

  it('clears one campaign rather than the whole membership', () => {
    /*
     * `arrayRemove`, never a field delete. A record in two campaigns must
     * lose exactly the one being deleted — the send collection's scalar
     * `emailCampaignId` is the only field here that may be removed outright.
     */
    expect(read(DELETE_PATH)).toContain('arrayRemove')
  })
})
