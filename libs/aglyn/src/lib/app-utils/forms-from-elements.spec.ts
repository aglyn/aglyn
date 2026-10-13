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
 * A FORM BUILT FROM MUI'S OWN FORM ELEMENTS DECLARES ITS FIELDS.
 *
 * Each piece of a field is its own Besigner element — a Form Control holding a
 * Form Label and an Input, a Select of Select Options, a Radio Group of Radios,
 * Checkboxes in Choice Labels, a Rating — so an author styles each piece with
 * the ordinary Styles panel. The form's declared field list, which the submit
 * route, the CRM and the email/consent checks all read, must come out of that
 * tree exactly as it comes out of the all-in-one Form Field.
 */

import type { AglynNodeSchema, NodeId } from '../foundation/definitions/components.types'
import {
  checkFormContract,
  formFieldsCanYieldAnEmail,
  formFieldsCaptureConsent,
} from './form-contract'
import { formFieldDeclsFromNodes } from './forms'

type Nodes = Record<NodeId, AglynNodeSchema>

const n = (
  $id: string,
  componentId: string,
  parentId: string | null,
  props: Record<string, unknown> = {},
  nodes: string[] = [],
): AglynNodeSchema =>
  ({ $id, type: 'node', componentId, parentId, props, nodes }) as never

const tree: Nodes = Object.fromEntries(
  [
    n('form', 'form', null, { formId: 'f1' }, ['fcEmail', 'fcTopic', 'fcPlan', 'ckA', 'ckB', 'fcScore', 'bare']),
    n('fcEmail', 'muiFormControl', 'form', {}, ['lbEmail', 'inEmail']),
    n('lbEmail', 'muiFormLabel', 'fcEmail', { children: 'Work email' }),
    n('inEmail', 'muiInput', 'fcEmail', { name: 'email', type: 'email', required: true, datasetFieldId: 'f_email' }),
    n('fcTopic', 'muiFormControl', 'form', {}, ['lbTopic', 'selTopic']),
    n('lbTopic', 'muiFormLabel', 'fcTopic', { children: 'Topic' }),
    n('selTopic', 'muiSelect', 'fcTopic', { name: 'topic' }, ['o1', 'o2']),
    n('o1', 'muiSelectOption', 'selTopic', { children: 'Sales' }),
    n('o2', 'muiSelectOption', 'selTopic', { children: 'Support', value: 'help' }),
    n('fcPlan', 'muiFormControl', 'form', {}, ['lbPlan', 'rgPlan']),
    n('lbPlan', 'muiFormLabel', 'fcPlan', { children: 'Plan' }),
    n('rgPlan', 'muiRadioGroup', 'fcPlan', { name: 'plan' }, ['clA', 'clB']),
    n('clA', 'muiFormControlLabel', 'rgPlan', { label: 'Free' }, ['rA']),
    n('rA', 'muiRadio', 'clA', { value: 'free' }),
    n('clB', 'muiFormControlLabel', 'rgPlan', { label: 'Pro' }, ['rB']),
    n('rB', 'muiRadio', 'clB', { value: 'pro' }),
    n('ckA', 'muiFormControlLabel', 'form', { label: 'Email me news' }, ['cbA']),
    n('cbA', 'muiCheckbox', 'ckA', { name: 'marketingConsent', value: 'Yes' }),
    n('ckB', 'muiFormControlLabel', 'form', { label: 'And texts' }, ['cbB']),
    n('cbB', 'muiCheckbox', 'ckB', { name: 'marketingConsent', value: 'SMS' }),
    n('fcScore', 'muiFormControl', 'form', {}, ['scr']),
    n('scr', 'muiRating', 'fcScore', { name: 'score' }),
    // No Form Control, no label: named by its accessible label.
    n('bare', 'muiInput', 'form', { name: 'company', ariaLabel: 'Company', placeholder: 'Acme' }),
  ].map((node) => [node.$id, node]),
)

describe('a form built from MUI’s form elements', () => {
  const fields = formFieldDeclsFromNodes(tree, 'form')

  it('declares one field per named input, in reading order', () => {
    expect(fields.map((field) => field.fieldName)).toEqual([
      'email',
      'topic',
      'plan',
      'marketingConsent',
      'score',
      'company',
    ])
  })

  it('takes each field’s type, label and choices from its elements', () => {
    expect(fields).toEqual([
      { fieldName: 'email', fieldType: 'email', label: 'Work email', required: true, datasetFieldId: 'f_email' },
      { fieldName: 'topic', fieldType: 'select', label: 'Topic', options: ['Sales', 'help'] },
      { fieldName: 'plan', fieldType: 'radio', label: 'Plan', options: ['free', 'pro'] },
      // Two Checkboxes sharing a name are one question with two boxes.
      { fieldName: 'marketingConsent', fieldType: 'checkbox', label: 'Email me news', options: ['Yes', 'SMS'] },
      { fieldName: 'score', fieldType: 'rating' },
      { fieldName: 'company', fieldType: 'text', label: 'Company' },
    ])
  })

  it('passes the same email and consent checks as a Form Field form', () => {
    expect(formFieldsCanYieldAnEmail(fields)).toBe(true)
    expect(formFieldsCaptureConsent(fields, 'marketingConsent')).toBe(true)
    expect(
      checkFormContract({
        form: { routing: { lead: true }, consentFieldName: 'marketingConsent' },
        formId: 'f1',
        nodes: tree as never,
        formNodeId: 'form',
      }),
    ).toEqual([])
  })

  it('reports an input with no name, as it does an unnamed Form Field', () => {
    const unnamed: Nodes = {
      ...tree,
      form: { ...tree['form'], nodes: [...(tree['form'].nodes as string[]), 'nameless'] } as never,
      nameless: n('nameless', 'muiInput', 'form', { placeholder: 'Anything' }),
    }
    const violations = checkFormContract({
      form: {},
      formId: 'f1',
      nodes: unnamed as never,
      formNodeId: 'form',
    })
    expect(violations.map((violation) => violation.nodeId)).toContain('nameless')
  })

  it('reads a multi-line Input as a message box', () => {
    const message: Nodes = {
      form: n('form', 'form', null, {}, ['msg']),
      msg: n('msg', 'muiInput', 'form', { name: 'message', multiline: true }),
    }
    expect(formFieldDeclsFromNodes(message, 'form')).toEqual([
      { fieldName: 'message', fieldType: 'textarea' },
    ])
  })
})
