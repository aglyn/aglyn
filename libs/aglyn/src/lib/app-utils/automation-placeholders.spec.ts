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
 * Placeholders in an automation (AGL-2919): a value a person still has to
 * supply, in square brackets where it belongs. The editor highlights them,
 * switching an automation on names them, and a drafted automation's output
 * lists them — all through this one reader, so the three never disagree about
 * what is missing.
 */

import { type HostAction, validateHostAction } from './actions'
import {
  automationPlaceholder,
  automationPlaceholderIn,
  automationPlaceholders,
  describeAutomationPlaceholder,
} from './automation-placeholders'

const drafted: HostAction = {
  name: 'Welcome newsletter sign-ups',
  trigger: {
    event: 'formSubmission',
    conditions: [{ field: 'formName', op: 'equals', value: '[newsletter sign-up form]' }],
    combinator: 'and',
  },
  steps: [
    { type: 'enrollList', listName: '[newsletter]' },
    { type: 'setContactStage', lifecycleStage: 'lead' },
    {
      type: 'sendEmail',
      subject: 'Welcome aboard',
      body: 'Thanks for joining. Call us on [your phone number] with any question.',
    },
    {
      type: 'createCrmTask',
      title: 'Call the new lead',
      kind: 'call',
      dueInDays: 1,
      when: { conditions: [{ field: 'plan', op: 'equals', value: '[the plan to match]' }] },
    },
  ],
  enabled: false,
}

describe('what counts as a placeholder', () => {
  it('reads the words inside the first bracketed phrase of a value', () => {
    expect(automationPlaceholderIn('[newsletter]')).toBe('newsletter')
    expect(automationPlaceholderIn('Call us on [your phone number] today')).toBe('your phone number')
    expect(automationPlaceholderIn('No gap here')).toBeNull()
    expect(automationPlaceholderIn(42)).toBeNull()
    expect(automationPlaceholderIn('[   ]')).toBeNull()
  })

  it('does not read a written link, whose brackets are the link text', () => {
    expect(automationPlaceholderIn('See [our menu](https://example.com/menu)')).toBeNull()
  })

  it('writes words as a placeholder on one line, without brackets of their own', () => {
    expect(automationPlaceholder('  the [newsletter]\nlist ')).toBe('[the newsletter list]')
    expect(automationPlaceholder('')).toBe('[to fill in]')
    expect(automationPlaceholder('x'.repeat(300))).toBe(`[${'x'.repeat(100)}]`)
  })
})

describe('the placeholders an automation holds', () => {
  it('finds them in the trigger’s conditions, then each step’s guard, reference and text', () => {
    expect(automationPlaceholders(drafted)).toEqual([
      { step: null, field: 'condition', text: 'newsletter sign-up form' },
      { step: 1, field: 'list', text: 'newsletter' },
      { step: 3, field: 'body', text: 'your phone number' },
      { step: 4, field: 'condition', text: 'the plan to match' },
    ])
  })

  it('never reads a selector, HTML or a script, where brackets are syntax', () => {
    const interaction: HostAction = {
      name: 'Menu',
      trigger: { event: 'elementClick', selector: '[data-aglyn="leaf:menu"]' },
      steps: [
        { type: 'toggleElement', selector: '[data-aglyn="leaf:panel"]' },
        { type: 'setAttribute', selector: '[data-x]', name: 'aria-expanded', value: '[true]' },
        { type: 'showHtml', html: '<p>[a note]</p>' },
        { type: 'runJs', code: 'const list = [1, 2]' },
      ],
    }
    expect(automationPlaceholders(interaction)).toEqual([])
  })

  it('reads the legacy single condition the way the trigger does', () => {
    expect(
      automationPlaceholders({
        trigger: { event: 'lead', condition: { field: 'source', op: 'equals', value: '[where it came from]' } },
        steps: [],
      }),
    ).toEqual([{ step: null, field: 'condition', text: 'where it came from' }])
  })

  it('names each one where it is and what it stands in for', () => {
    expect(automationPlaceholders(drafted).map(describeAutomationPlaceholder)).toEqual([
      'The trigger: a condition value (“newsletter sign-up form”)',
      'Step 1: the list (“newsletter”)',
      'Step 3: the text (“your phone number”)',
      'Step 4: a condition value (“the plan to match”)',
    ])
  })

  it('is storable: an automation holding placeholders passes the editor’s own validator', () => {
    // A draft that could not name its list is still a document the Actions
    // editor opens; the placeholder is the value a person replaces there.
    expect(validateHostAction(drafted)).toBeNull()
  })

  it('reads nothing of an absent automation', () => {
    expect(automationPlaceholders(null)).toEqual([])
    expect(automationPlaceholders({ trigger: { event: 'lead' }, steps: undefined as never })).toEqual([])
  })
})
