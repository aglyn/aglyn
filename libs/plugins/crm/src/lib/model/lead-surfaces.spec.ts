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
 * The Leads section's verdict on each form (AGL-2612) has to agree with the
 * publish check: a switch it offers is one `checkFormContract` will honor,
 * and a form it refuses is one the publish would refuse too.
 */

import {
  LEAD_ROUTING_NEEDS_CONSENT_FIELD,
  LEAD_ROUTING_NEEDS_EMAIL_FIELD,
  leadSurfaceForms,
} from './lead-surfaces'

describe('leadSurfaceForms', () => {
  it('says which forms route, which could, and why one cannot', () => {
    const forms = leadSurfaceForms([
      {
        $id: 'contact',
        displayName: 'Contact',
        routing: { lead: true },
        consentFieldName: 'optIn',
        fields: [
          { fieldName: 'name', fieldType: 'text' },
          { fieldName: 'email', fieldType: 'email' },
        ],
      },
      {
        $id: 'quote',
        displayName: 'Ask for a quote',
        fields: [{ fieldName: 'workEmail', fieldType: 'text' }],
      },
      {
        $id: 'newsletter',
        displayName: 'Newsletter',
        fields: [
          { fieldName: 'email', fieldType: 'email' },
          { fieldName: 'subscribe', fieldType: 'checkbox' },
        ],
      },
      {
        $id: 'poll',
        displayName: 'Poll',
        fields: [{ fieldName: 'answer', fieldType: 'text' }],
      },
    ])
    expect(forms.map((form) => form.$id)).toEqual([
      'quote',
      'contact',
      'newsletter',
      'poll',
    ])
    expect(forms.find((form) => form.$id === 'contact')).toEqual(
      expect.objectContaining({ routed: true, canRoute: true, blocker: null }),
    )
    // An email-shaped field NAME is enough for the address, as it is for the
    // publish check — and with nothing recording consent the publish would
    // refuse, so this section does too, for the same reason.
    expect(forms.find((form) => form.$id === 'quote')).toEqual(
      expect.objectContaining({
        routed: false,
        canRoute: false,
        blocker: LEAD_ROUTING_NEEDS_CONSENT_FIELD,
      }),
    )
    // An undeclared opt-in the route reads by name counts, as it does there.
    expect(forms.find((form) => form.$id === 'newsletter')).toEqual(
      expect.objectContaining({ routed: false, canRoute: true, blocker: null }),
    )
    // No address at all is the first gate, and the only one reported.
    expect(forms.find((form) => form.$id === 'poll')).toEqual(
      expect.objectContaining({
        routed: false,
        canRoute: false,
        blocker: LEAD_ROUTING_NEEDS_EMAIL_FIELD,
      }),
    )
  })

  it('leaves an archived form out and names an unnamed one by its id', () => {
    const forms = leadSurfaceForms([
      { $id: 'old', displayName: 'Old', archivedAt: 1, fields: [] },
      { $id: 'unnamed', fields: [] },
    ])
    expect(forms).toHaveLength(1)
    expect(forms[0]).toEqual(
      expect.objectContaining({ $id: 'unnamed', displayName: 'unnamed' }),
    )
  })
})
