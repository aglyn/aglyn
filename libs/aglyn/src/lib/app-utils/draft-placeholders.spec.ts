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
 * Placeholders in a drafted interaction (AGL-2919): a value a person still has
 * to supply, in square brackets where it belongs. The editor highlights them,
 * switching an automation on names them, and a drafted automation's output
 * lists them — all through this one reader, so the three never disagree about
 * what is missing. Which fields are read is the platform's for its client
 * steps and the declaring plugin's for every other (`typedFields`).
 */

import {
  describeInteractionPlaceholder,
  draftPlaceholder,
  draftPlaceholderIn,
  interactionPlaceholders,
} from './draft-placeholders'
import {
  type InteractionStepBase,
  interactionStepTypedFields,
  type SiteInteraction,
} from './site-interactions'

const drafted: SiteInteraction<InteractionStepBase> = {
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
    expect(draftPlaceholderIn('[newsletter]')).toBe('newsletter')
    expect(draftPlaceholderIn('Call us on [your phone number] today')).toBe('your phone number')
    expect(draftPlaceholderIn('No gap here')).toBeNull()
    expect(draftPlaceholderIn(42)).toBeNull()
    expect(draftPlaceholderIn('[   ]')).toBeNull()
  })

  it('does not read a written link, whose brackets are the link text', () => {
    expect(draftPlaceholderIn('See [our menu](https://example.com/menu)')).toBeNull()
  })

  it('writes words as a placeholder on one line, without brackets of their own', () => {
    expect(draftPlaceholder('  the [newsletter]\nlist ')).toBe('[the newsletter list]')
    expect(draftPlaceholder('')).toBe('[to fill in]')
    expect(draftPlaceholder('x'.repeat(300))).toBe(`[${'x'.repeat(100)}]`)
  })
})

describe('the placeholders an interaction holds', () => {
  it('finds them in the trigger’s conditions, then each step’s guard, reference and text', () => {
    expect(interactionPlaceholders(drafted)).toEqual([
      { step: null, field: 'condition', names: 'a condition value', text: 'newsletter sign-up form' },
      { step: 1, field: 'listName', names: 'the list', text: 'newsletter' },
      { step: 3, field: 'body', names: 'the text', text: 'your phone number' },
      { step: 4, field: 'condition', names: 'a condition value', text: 'the plan to match' },
    ])
  })

  it('reads the fields the platform types for its own client steps', () => {
    expect(
      interactionPlaceholders({
        trigger: { event: 'pageView' },
        steps: [
          { type: 'siteAlert', message: 'Ask [the person on duty]' },
          { type: 'showOverlay', overlayName: '[spring sale]' },
        ],
      }),
    ).toEqual([
      { step: 1, field: 'message', names: 'the message', text: 'the person on duty' },
      { step: 2, field: 'overlayName', names: 'the popup or bar', text: 'spring sale' },
    ])
  })

  it('reads a plugin’s step by the fields its declaration types, and none of a step nobody declares', () => {
    expect(interactionStepTypedFields('sendEmail')).toEqual([
      { key: 'subject', names: 'the subject' },
      { key: 'body', names: 'the text' },
    ])
    expect(interactionStepTypedFields('notAStep')).toEqual([])
    expect(
      interactionPlaceholders({ trigger: { event: 'lead' }, steps: [{ type: 'notAStep', words: '[x]' }] }),
    ).toEqual([])
  })

  it('never reads a selector, HTML or a script, where brackets are syntax', () => {
    const interaction: SiteInteraction<InteractionStepBase> = {
      name: 'Menu',
      trigger: { event: 'elementClick', selector: '[data-aglyn="leaf:menu"]' },
      steps: [
        { type: 'toggleElement', selector: '[data-aglyn="leaf:panel"]' },
        { type: 'setAttribute', selector: '[data-x]', name: 'aria-expanded', value: '[true]' },
        { type: 'showHtml', html: '<p>[a note]</p>' },
        { type: 'runJs', code: 'const list = [1, 2]' },
      ],
    }
    expect(interactionPlaceholders(interaction)).toEqual([])
  })

  it('reads the legacy single condition the way the trigger does', () => {
    expect(
      interactionPlaceholders({
        trigger: { event: 'lead', condition: { field: 'source', op: 'equals', value: '[where it came from]' } },
        steps: [],
      }),
    ).toEqual([{ step: null, field: 'condition', names: 'a condition value', text: 'where it came from' }])
  })

  it('names each one where it is and what it stands in for', () => {
    expect(interactionPlaceholders(drafted).map(describeInteractionPlaceholder)).toEqual([
      'The trigger: a condition value (“newsletter sign-up form”)',
      'Step 1: the list (“newsletter”)',
      'Step 3: the text (“your phone number”)',
      'Step 4: a condition value (“the plan to match”)',
    ])
  })

  it('reads nothing of an absent interaction', () => {
    expect(interactionPlaceholders(null)).toEqual([])
    expect(interactionPlaceholders({ trigger: { event: 'lead' }, steps: undefined as never })).toEqual([])
  })
})
