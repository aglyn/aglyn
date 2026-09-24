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
 * The editor edits one group; the route takes the whole next declaration
 * (AGL-3320). These pin the translation: every other group carried over as
 * it stands less the sites the edited one takes, a group left with one site
 * left out (which is how the route reads "dissolved"), and an edit that
 * drops under two sites turned into the dissolve rather than into an invalid
 * form.
 */

import {
  consentGroupDisclosure,
  consentGroupForHost,
} from '@aglyn/aglyn/app-utils/consent-groups'
import {
  buildConsentGroupDeclaration,
  describeConsentGroupDraft,
  draftDisclosure,
  expectedConsentGroups,
  listConsentGroups,
  unusableConsentGroupCount,
  validateConsentGroupDraft,
  type ConsentGroupDraft,
  type ListedConsentGroup,
} from './consent-group-editing'

const ORG = {
  consentGroups: {
    g_home: { name: 'Home goods', hostIds: ['shop', 'blog'] },
    g_acme: { name: 'Acme', hostIds: ['acme-a', 'acme-b', 'acme-c'] },
  },
}
const CURRENT: ListedConsentGroup[] = listConsentGroups(ORG)

const draft = (patch: Partial<ConsentGroupDraft>): ConsentGroupDraft => ({
  mode: 'create',
  groupId: null,
  name: '',
  hostIds: [],
  ...patch,
})

describe('the groups the editor lists', () => {
  it('lists the usable groups by name, with their ids', () => {
    expect(CURRENT).toEqual([
      { id: 'g_acme', name: 'Acme', hostIds: ['acme-a', 'acme-b', 'acme-c'] },
      { id: 'g_home', name: 'Home goods', hostIds: ['blog', 'shop'] },
    ])
  })

  it('leaves out what nothing honors, and counts it', () => {
    const org = {
      consentGroups: {
        ...ORG.consentGroups,
        nameless: { name: ' ', hostIds: ['x', 'y'] },
        lonely: { name: 'Lonely', hostIds: ['z'] },
      },
    }
    expect(listConsentGroups(org).map((group) => group.id)).toEqual([
      'g_acme',
      'g_home',
    ])
    expect(unusableConsentGroupCount(org)).toBe(2)
    expect(unusableConsentGroupCount(ORG)).toBe(0)
    expect(unusableConsentGroupCount({})).toBe(0)
  })

  it('sends the raw declaration it was opened against as `expected`', () => {
    expect(expectedConsentGroups(ORG)).toBe(ORG.consentGroups)
    expect(expectedConsentGroups({})).toBeNull()
    expect(expectedConsentGroups({ consentGroups: ['nope'] })).toBeNull()
  })
})

describe('what signup forms will say', () => {
  it('is character for character what a form on the group’s sites renders', () => {
    const org = {
      consentGroups: { g: { name: 'Acme', hostIds: ['a', 'b', 'c'] } },
    }
    expect(draftDisclosure('Acme', ['a', 'b', 'c'], 'g')).toBe(
      consentGroupDisclosure(consentGroupForHost(org, 'b')),
    )
  })

  it('is nothing until there is a name and two sites', () => {
    expect(draftDisclosure('', ['a', 'b'])).toBeNull()
    expect(draftDisclosure('Acme', ['a'])).toBeNull()
    expect(draftDisclosure('  Acme  ', ['a', 'b'])).toMatch(/from Acme,/)
  })
})

describe('the next declaration', () => {
  it('creates a group from sites on their own, new id minted by the route', () => {
    const { groups, editedIndex } = buildConsentGroupDeclaration(
      CURRENT,
      draft({ name: ' Outdoors ', hostIds: ['camp', 'fish'] }),
    )
    expect(groups).toEqual([
      { id: 'g_acme', name: 'Acme', hostIds: ['acme-a', 'acme-b', 'acme-c'] },
      { id: 'g_home', name: 'Home goods', hostIds: ['blog', 'shop'] },
      { name: 'Outdoors', hostIds: ['camp', 'fish'] },
    ])
    expect(editedIndex).toBe(2)
  })

  it('keeps an edited group’s id, name and sites, last', () => {
    const { groups, editedIndex } = buildConsentGroupDeclaration(
      CURRENT,
      draft({
        mode: 'edit',
        groupId: 'g_home',
        name: 'Home',
        hostIds: ['shop', 'blog', 'deals'],
      }),
    )
    expect(groups[editedIndex as number]).toEqual({
      id: 'g_home',
      name: 'Home',
      hostIds: ['blog', 'deals', 'shop'],
    })
    expect(groups).toHaveLength(2)
  })

  it('takes a moved site out of the group it leaves, which survives with two', () => {
    const { groups } = buildConsentGroupDeclaration(
      CURRENT,
      draft({
        mode: 'edit',
        groupId: 'g_home',
        name: 'Home goods',
        hostIds: ['shop', 'blog', 'acme-c'],
      }),
    )
    expect(groups).toEqual([
      { id: 'g_acme', name: 'Acme', hostIds: ['acme-a', 'acme-b'] },
      { id: 'g_home', name: 'Home goods', hostIds: ['acme-c', 'blog', 'shop'] },
    ])
  })

  it('leaves out a group that a move leaves with one site: it dissolves', () => {
    const { groups } = buildConsentGroupDeclaration(
      CURRENT,
      draft({ name: 'New', hostIds: ['blog', 'camp'] }),
    )
    expect(groups.map((group) => group.id ?? group.name)).toEqual([
      'g_acme',
      'New',
    ])
  })

  it('dissolving leaves every other group exactly as it is', () => {
    const { groups, editedIndex } = buildConsentGroupDeclaration(
      CURRENT,
      draft({ mode: 'dissolve', groupId: 'g_acme', name: 'Acme', hostIds: [] }),
    )
    expect(groups).toEqual([
      { id: 'g_home', name: 'Home goods', hostIds: ['blog', 'shop'] },
    ])
    expect(editedIndex).toBeNull()
  })

  it('an edit left with one site is the dissolve, whatever else was ticked', () => {
    const { groups, editedIndex } = buildConsentGroupDeclaration(
      CURRENT,
      draft({ mode: 'edit', groupId: 'g_home', name: 'Home goods', hostIds: ['acme-a'] }),
    )
    // Nothing is taken from Acme: a dissolve moves no site anywhere.
    expect(groups).toEqual([
      { id: 'g_acme', name: 'Acme', hostIds: ['acme-a', 'acme-b', 'acme-c'] },
    ])
    expect(editedIndex).toBeNull()
  })
})

describe('the change a draft makes', () => {
  it('reads a rename', () => {
    const change = describeConsentGroupDraft(
      CURRENT,
      draft({ mode: 'edit', groupId: 'g_home', name: 'Home', hostIds: ['shop', 'blog'] }),
    )
    expect(change).toMatchObject({
      kind: 'edit',
      renamed: true,
      previousName: 'Home goods',
      added: [],
      removed: [],
      movedIn: [],
      empty: false,
    })
  })

  it('reads an add, a move and a remove apart', () => {
    const change = describeConsentGroupDraft(
      CURRENT,
      draft({
        mode: 'edit',
        groupId: 'g_home',
        name: 'Home goods',
        hostIds: ['shop', 'deals', 'acme-a'],
      }),
    )
    expect(change.added).toEqual(['deals'])
    expect(change.movedIn).toEqual([
      { hostId: 'acme-a', fromGroupId: 'g_acme', fromName: 'Acme' },
    ])
    expect(change.removed).toEqual(['blog'])
    expect(change.donors).toEqual([
      {
        groupId: 'g_acme',
        name: 'Acme',
        losing: ['acme-a'],
        remaining: ['acme-b', 'acme-c'],
        dissolves: false,
        absorbed: false,
      },
    ])
  })

  it('reads a group whose every site moves as merged into the edited one', () => {
    const change = describeConsentGroupDraft(
      CURRENT,
      draft({
        mode: 'edit',
        groupId: 'g_acme',
        name: 'Acme',
        hostIds: ['acme-a', 'acme-b', 'acme-c', 'shop', 'blog'],
      }),
    )
    expect(change.donors[0]).toMatchObject({ groupId: 'g_home', absorbed: true })
  })

  it('reads an edit left with one site as a dissolve, naming the sites unticked', () => {
    const change = describeConsentGroupDraft(
      CURRENT,
      draft({ mode: 'edit', groupId: 'g_acme', name: 'Acme', hostIds: ['acme-b'] }),
    )
    expect(change).toMatchObject({
      kind: 'dissolve',
      tooFewSites: true,
      name: 'Acme',
      removed: ['acme-a', 'acme-b', 'acme-c'],
      unselected: ['acme-a', 'acme-c'],
    })
  })

  it('reads an unchanged edit as empty', () => {
    expect(
      describeConsentGroupDraft(
        CURRENT,
        draft({ mode: 'edit', groupId: 'g_home', name: 'Home goods', hostIds: ['blog', 'shop'] }),
      ).empty,
    ).toBe(true)
  })
})

describe('what the edit step checks before asking', () => {
  it('asks for a name', () => {
    expect(
      validateConsentGroupDraft(CURRENT, draft({ name: '  ', hostIds: ['a', 'b'] })).name,
    ).toMatch(/Give the group a name/)
  })

  it('refuses a name over 80 characters', () => {
    expect(
      validateConsentGroupDraft(
        CURRENT,
        draft({ name: 'x'.repeat(81), hostIds: ['a', 'b'] }),
      ).name,
    ).toMatch(/80 characters/)
    expect(
      validateConsentGroupDraft(
        CURRENT,
        draft({ name: 'x'.repeat(80), hostIds: ['a', 'b'] }),
      ).name,
    ).toBeUndefined()
  })

  it('refuses another group’s name in any case', () => {
    expect(
      validateConsentGroupDraft(CURRENT, draft({ name: 'ACME', hostIds: ['a', 'b'] })).name,
    ).toMatch(/already has this name/)
  })

  it('lets a group keep its own name', () => {
    expect(
      validateConsentGroupDraft(
        CURRENT,
        draft({ mode: 'edit', groupId: 'g_acme', name: 'Acme', hostIds: ['acme-a', 'acme-b'] }),
      ),
    ).toEqual({})
  })

  it('frees the name of a group the change dissolves', () => {
    // Taking one of Home goods' two sites dissolves it, so its name is free.
    expect(
      validateConsentGroupDraft(
        CURRENT,
        draft({ name: 'Home goods', hostIds: ['blog', 'camp'] }),
      ).name,
    ).toBeUndefined()
  })

  it('asks for two sites when creating', () => {
    expect(
      validateConsentGroupDraft(CURRENT, draft({ name: 'New', hostIds: ['a'] })).sites,
    ).toMatch(/at least two sites/)
  })

  it('refuses more sites than one group may name', () => {
    const many = Array.from({ length: 31 }, (_, index) => `site${index}`)
    expect(
      validateConsentGroupDraft(CURRENT, draft({ name: 'Big', hostIds: many })).sites,
    ).toMatch(/at most 30 sites/)
  })

  it('refuses replacing every site of a group, which is a new group', () => {
    expect(
      validateConsentGroupDraft(
        CURRENT,
        draft({ mode: 'edit', groupId: 'g_home', name: 'Home goods', hostIds: ['x', 'y'] }),
      ).sites,
    ).toMatch(/create a new group/)
  })

  it('has nothing to check on a dissolve', () => {
    expect(
      validateConsentGroupDraft(
        CURRENT,
        draft({ mode: 'dissolve', groupId: 'g_home', name: '', hostIds: [] }),
      ),
    ).toEqual({})
  })
})
