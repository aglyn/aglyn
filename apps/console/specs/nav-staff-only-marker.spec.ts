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
 * The staff-only marker on release-flagged nav tabs (AGL-1600).
 *
 * The docs screenshot harness signs in as the seeded STAFF account, so every
 * console capture renders the flagged-off tabs a customer never sees — that
 * is how `⚑ CONTACTS` reached published documentation. The harness scrubs
 * them by this attribute before the shutter, which makes the attribute a
 * contract with something outside the app: drop it and the harness quietly
 * captures the leak again.
 *
 * Asserted here, at the DECLARATION. The harness's own guard can only ever
 * check what it can see in a browser, and "the selector matched nothing" and
 * "there was nothing to match" look identical from there.
 */

import { RELEASE_FLAGS } from '@aglyn/aglyn'
import {
  gateNavTabItems,
  STAFF_ONLY_ATTRIBUTE,
} from '../components/secondary-nav-bar.component'

// Literal, not the constant: tools/e2e/lib/staff-only-chrome.mjs cannot
// import TypeScript, so it hard-codes this string. Renaming the attribute
// has to fail here rather than in a screenshot nobody re-reads.
const HARNESS_ATTRIBUTE = 'data-staff-only'

const CONTACTS_TAB = { id: 'nav-tab-contacts', label: 'Contacts', href: '/c' }
const SETUP_TAB = { id: 'nav-tab-setup', label: 'Setup', href: '/s' }

describe('release-flagged nav tabs', () => {
  it('names the attribute the capture harness scrubs on', () => {
    expect(STAFF_ONLY_ATTRIBUTE).toBe(HARNESS_ATTRIBUTE)
  })

  it('marks a flagged-off tab as staff-only, carrying the flag key', () => {
    const [contacts, setup] = gateNavTabItems(
      [CONTACTS_TAB, SETUP_TAB],
      { release_contacts: { released: false } },
      true,
    )

    expect(contacts[HARNESS_ATTRIBUTE]).toBe('release_contacts')
    expect(contacts.icon?.path).toBeTruthy()
    // An ungated tab must NOT carry the marker — a harness that scrubbed
    // every tab would "pass" while capturing an empty strip.
    expect(setup[HARNESS_ATTRIBUTE]).toBeUndefined()
  })

  it('drops the flagged-off tab entirely for a customer', () => {
    const items = gateNavTabItems(
      [CONTACTS_TAB, SETUP_TAB],
      { release_contacts: { released: false } },
      false,
    )

    expect(items.map((item) => item.id)).toEqual(['nav-tab-setup'])
  })

  it('leaves a released tab unmarked even for staff', () => {
    const [contacts] = gateNavTabItems(
      [CONTACTS_TAB],
      { release_contacts: { released: true } },
      true,
    )

    expect(contacts[HARNESS_ATTRIBUTE]).toBeUndefined()
    expect(contacts.icon).toBeUndefined()
  })

  /**
   * The harness's preflight refuses to capture unless it finds at least one
   * staff-only tab on a host page — a check that only means something while
   * some host tab is actually flagged off. When Contacts ships, this test is
   * the one that says so, and the preflight canary has to move with it.
   */
  it('still has a flagged-off host tab for the preflight to find', () => {
    const flaggedOff = RELEASE_FLAGS.filter(
      (definition) => definition.navTabId && !definition.defaultEnabled,
    )

    expect(flaggedOff.map((definition) => definition.key)).toEqual([
      'release_contacts',
    ])
  })
})
