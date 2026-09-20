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

import * as Aglyn from '@aglyn/aglyn'
import {
  mdiCalculatorVariantOutline,
  mdiEyeOutline,
  mdiFormTextbox,
  mdiFunctionVariant,
} from '@aglyn/shared-data-mdi'
import Box from '@mui/material/Box'
import {
  createContext,
  forwardRef,
  Fragment,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'
import {
  FUNCTION_CONTROL_KINDS,
  FunctionParameterControl,
  displayFunctionValue,
  initialFunctionArguments,
  isFunctionValueTruthy,
  type FunctionControlKind,
} from './function-controls'

/**
 * A CALCULATOR AN AUTHOR LAYS OUT (AGL-3202).
 *
 * The Function Widget draws a whole calculator itself: inputs in a row, a
 * button, a result. That is the right block for "a quote in a sidebar" and
 * the wrong one for the page that prompted this — a comparison with a number
 * box AND quick picks on the same value, two questions asked as lists, a
 * table of five rows where four can be filtered away, one row highlighted, a
 * sentence under it and a footnote that changes with the choices. No amount
 * of options on one block reaches that, and it should not have to: laying
 * things out is what the canvas is for.
 *
 * So the pieces are separate elements, and one function binds them:
 *
 * - **Calculator** (`functionScope`) holds the function, the visitor's
 *   answers and the live result, and is an ordinary container.
 * - **Calculator Input** (`functionInput`) asks ONE parameter, as a number
 *   box, a list, a switch or a row of quick-pick chips. Two inputs may ask
 *   the same parameter; they stay in step because the answer lives above
 *   them.
 * - **Calculator Result** (`functionOutput`) shows one named value, styled
 *   like any text.
 * - **Show When** (`functionShow`) is a container that appears only while a
 *   named value is truthy — a table row a filter can remove.
 *
 * Everything between them is whatever the author builds: stacks, grids,
 * headings, borders. The design is theirs and the arithmetic is the site's
 * function, reading the site's variables.
 */

// Component ids are persisted in screen documents; never rename.
export const SCOPE_ID: Aglyn.ComponentId = 'functionScope'
export const INPUT_ID: Aglyn.ComponentId = 'functionInput'
export const OUTPUT_ID: Aglyn.ComponentId = 'functionOutput'
export const SHOW_ID: Aglyn.ComponentId = 'functionShow'

interface FunctionScopeValue {
  definition?: Aglyn.HostFunction
  args: Record<string, string>
  setArgument: (name: string, value: string) => void
  run: Aglyn.FunctionRunResult | null
}

const FunctionScopeContext = createContext<FunctionScopeValue | null>(null)

// ── Calculator ─────────────────────────────────────────────────────────────

export interface FunctionScopeProps {
  /** Name of the site function every element inside is bound to. */
  functionName?: string
  children?: ReactNode
  /** Injected at compose (attachFunctionDefinitions); never authored. */
  definition?: Aglyn.HostFunction
  /** The site variables the function names; injected beside `definition`. */
  globals?: Record<string, number | string | boolean>
}

const FunctionScope = forwardRef<HTMLDivElement, FunctionScopeProps>(
  (props, ref) => {
    const { functionName: _functionName, children, definition, globals, ...rest } = props
    const [args, setArgs] = useState<Record<string, string>>(() =>
      initialFunctionArguments(definition),
    )
    const setArgument = useCallback((name: string, value: string) => {
      setArgs((previous) => ({ ...previous, [name]: value }))
    }, [])
    // Always live: a calculator laid out on a page has no single place a
    // "Calculate" button would obviously go, and every result can be on
    // screen at once. The Function Widget is the block with a button.
    const run = useMemo(
      () =>
        definition
          ? Aglyn.evaluateHostFunction(definition, args, { globals })
          : null,
      [definition, args, globals],
    )
    const value = useMemo(
      () => ({ definition, args, setArgument, run }),
      [definition, args, setArgument, run],
    )
    return (
      <FunctionScopeContext.Provider value={value}>
        <Box ref={ref} {...rest}>
          {children}
        </Box>
      </FunctionScopeContext.Provider>
    )
  },
)
FunctionScope.displayName = 'AglynFunctionScope'

// ── Calculator Input ───────────────────────────────────────────────────────

export interface FunctionInputProps {
  /** The function parameter this control asks. */
  parameter?: string
  control?: FunctionControlKind
  /** Overrides the parameter's own label. */
  label?: string
  hideLabel?: boolean
  /**
   * Overrides the parameter's own choices, as `value: Label, value: Label`.
   * This is how quick picks are given: `10, 25, 50, 100` beside a number box.
   */
  choices?: string
}

const FunctionInput = forwardRef<HTMLDivElement, FunctionInputProps>(
  (props, ref) => {
    const { parameter, control, label, hideLabel, choices, ...rest } = props
    const scope = useContext(FunctionScopeContext)
    const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
    const name = String(parameter ?? '').trim()
    const declared = scope?.definition?.parameters?.find(
      (candidate) => candidate.name === name,
    )
    const ownChoices = useMemo(
      () => Aglyn.parseFunctionParameterOptions(choices),
      [choices],
    )
    const options = ownChoices.length ? ownChoices : (declared?.options ?? [])
    // No function to ask on behalf of: the besigner, or a page whose function
    // was deleted. In the besigner the control is still DRAWN, from its own
    // attributes, so a calculator can be designed before it works. On a
    // published page a control that can set nothing is residue, not a
    // question, and a visitor is shown nothing.
    const inert = !scope?.definition || !declared
    if (inert && !suppressNavigation) return null
    return (
      <Box ref={ref} {...rest}>
        <FunctionParameterControl
          name={name || 'parameter'}
          type={declared?.type}
          required={declared?.required}
          control={control}
          label={label?.trim() || declared?.label}
          hideLabel={Boolean(hideLabel)}
          options={options}
          value={inert ? '' : (scope?.args[name] ?? '')}
          onChange={(next) => scope?.setArgument(name, next)}
          disabled={inert}
          width="100%"
        />
      </Box>
    )
  },
)
FunctionInput.displayName = 'AglynFunctionInput'

// ── Calculator Result ──────────────────────────────────────────────────────

export interface FunctionOutputProps {
  /** A parameter or variable of the function; empty is its return value. */
  name?: string
  /** What the besigner shows in the result's place, e.g. `$625`. */
  placeholder?: string
  /** Read a change aloud. One result per calculator, usually the sentence. */
  announce?: boolean
  element?: 'div' | 'p' | 'span'
}

const OUTPUT_ELEMENTS = ['div', 'p', 'span'] as const

/**
 * `**like this**` becomes emphasis, and nothing else is markup. The value is
 * text a function built — often from what a visitor typed — so it is split
 * into React nodes and never parsed as HTML.
 */
export function renderFunctionEmphasis(text: string): ReactNode {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <strong key={index}>{part}</strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  )
}

const FunctionOutput = forwardRef<HTMLElement, FunctionOutputProps>(
  (props, ref) => {
    const { name, placeholder, announce, element, ...rest } = props
    const scope = useContext(FunctionScopeContext)
    const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
    const key = String(name ?? '').trim()
    const run = scope?.run
    let text = ''
    if (run?.ok) {
      text = displayFunctionValue(key ? run.scope[key] : run.value)
    } else if (suppressNavigation || !scope?.definition) {
      // Designing: show what will stand here. On a published page a missing
      // function shows nothing rather than a placeholder dressed as a price.
      text = suppressNavigation ? placeholder || (key ? `{${key}}` : '{result}') : ''
    }
    if (!text) return null
    const tag = OUTPUT_ELEMENTS.includes(element as (typeof OUTPUT_ELEMENTS)[number])
      ? element
      : 'div'
    return (
      <Box
        ref={ref}
        component={tag}
        {...(announce ? { 'aria-live': 'polite' as const } : {})}
        {...rest}
      >
        {renderFunctionEmphasis(text)}
      </Box>
    )
  },
)
FunctionOutput.displayName = 'AglynFunctionOutput'

// ── Show When ──────────────────────────────────────────────────────────────

export interface FunctionShowProps {
  /** A parameter or variable of the function. */
  when?: string
  /** Show while the value is NOT truthy instead. */
  invert?: boolean
  children?: ReactNode
}

const FunctionShow = forwardRef<HTMLDivElement, FunctionShowProps>(
  (props, ref) => {
    const { when, invert, children, ...rest } = props
    const scope = useContext(FunctionScopeContext)
    const key = String(when ?? '').trim()
    const run = scope?.run
    // With nothing to decide on — no function, a failed run, no name — the
    // contents SHOW. Hiding is the exceptional state, and a designer has to
    // be able to see the row they are laying out.
    const decided = Boolean(run?.ok && key)
    const truthy = run?.ok ? isFunctionValueTruthy(run.scope[key]) : true
    if (decided && truthy === Boolean(invert)) return null
    return (
      <Box ref={ref} {...rest}>
        {children}
      </Box>
    )
  },
)
FunctionShow.displayName = 'AglynFunctionShow'

// ── Schemas ────────────────────────────────────────────────────────────────

const ICON_COLOR = '#7b1fa2'

const CONTROL_LABELS: Record<FunctionControlKind, string> = {
  auto: 'Automatic',
  number: 'Number box',
  text: 'Text box',
  select: 'List',
  chips: 'Quick picks',
  switch: 'Switch',
}

export const schema: Aglyn.ComponentSchema<FunctionScopeProps> = {
  $id: SCOPE_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Calculator',
  description:
    'A container bound to one of your functions. Put Calculator Inputs and ' +
    'Calculator Results anywhere inside it and lay them out however you like.',
  category: Aglyn.ComponentCategory.INPUT,
  icon: { path: mdiCalculatorVariantOutline.path, sx: { color: ICON_COLOR } },
  attributes: [
    {
      name: 'functionName',
      description:
        'Name of a function from the site’s Functions card. Every input and ' +
        'result inside this container reads it.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Function name',
    },
  ],
}

export const functionInputSchema: Aglyn.ComponentSchema<FunctionInputProps> = {
  $id: INPUT_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Calculator Input',
  description:
    'Asks one parameter of the Calculator it sits in: a number box, a list, ' +
    'a switch, or quick-pick chips.',
  category: Aglyn.ComponentCategory.INPUT,
  icon: { path: mdiFormTextbox.path, sx: { color: ICON_COLOR } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'parameter',
      description: 'The function parameter this control sets.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Parameter',
    },
    {
      name: 'control',
      description:
        'Automatic follows the parameter: a list when it has choices, a ' +
        'number box for a number, a switch for a true/false. Quick picks ' +
        'are buttons that set the value, for beside a number box.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Ask as',
      options: FUNCTION_CONTROL_KINDS.map((kind) => ({
        value: kind,
        label: CONTROL_LABELS[kind],
      })),
    },
    {
      name: 'choices',
      description:
        'The choices for a list or quick picks, as "value: Label, value: ' +
        'Label" — or just "10, 25, 50, 100". Leave empty to use the ' +
        'choices the function gives the parameter.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Choices',
    },
    {
      name: 'label',
      description: 'Shown above the control instead of the parameter’s own label.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Label',
    },
    {
      name: 'hideLabel',
      description:
        'If true, the label is not drawn. It is still read to assistive ' +
        'technology, so give one either way.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Hide the label?',
    },
  ],
}

export const functionOutputSchema: Aglyn.ComponentSchema<FunctionOutputProps> = {
  $id: OUTPUT_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Calculator Result',
  description:
    'Shows one value from the Calculator it sits in, updated as the visitor ' +
    'answers. Style it like any text.',
  category: Aglyn.ComponentCategory.INPUT,
  icon: { path: mdiFunctionVariant.path, sx: { color: ICON_COLOR } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'name',
      description:
        'A parameter or variable of the function. Leave empty for the ' +
        'function’s return value. Text the function wraps in **two ' +
        'asterisks** is emphasized; nothing appears while the value is empty.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Value',
    },
    {
      name: 'placeholder',
      description: 'What the besigner shows here, e.g. $625. Visitors never see it.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Placeholder',
    },
    {
      name: 'element',
      description: 'The HTML element. Use span inside a line of text.',
      component: Aglyn.FieldComponentType.SELECT,
      label: 'Element',
      options: [
        { value: 'div', label: 'Block (div)' },
        { value: 'p', label: 'Paragraph (p)' },
        { value: 'span', label: 'Inline (span)' },
      ],
    },
    {
      name: 'announce',
      description:
        'If true, a screen reader reads each change. Turn it on for one ' +
        'result per calculator — usually the sentence, not every number.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Read changes aloud?',
    },
  ],
}

export const functionShowSchema: Aglyn.ComponentSchema<FunctionShowProps> = {
  $id: SHOW_ID,
  pluginId: BUNDLE_ID,
  displayName: 'Show When',
  description:
    'A container inside a Calculator that appears only while one of the ' +
    'function’s values is true, non-zero or non-empty.',
  category: Aglyn.ComponentCategory.INPUT,
  icon: { path: mdiEyeOutline.path, sx: { color: ICON_COLOR } },
  attributes: [
    {
      name: 'when',
      description:
        'A parameter or variable of the function. The contents show while ' +
        'it is true, a number other than zero, or text that is not empty.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Show when',
    },
    {
      name: 'invert',
      description: 'If true, the contents show while the value is NOT true.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Show when it is not?',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(SCOPE_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Calculator',
    pluginId: BUNDLE_ID,
    description: 'A container bound to a function — lay out inputs and results inside',
    category: Aglyn.ComponentCategory.INPUT,
    icon: { path: mdiCalculatorVariantOutline.path, sx: { color: ICON_COLOR } },
    data: { $id: null, componentId: SCOPE_ID, pluginId: BUNDLE_ID, props: {} },
  },
]

export const functionInputPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(INPUT_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Calculator Input',
    pluginId: BUNDLE_ID,
    description: 'Asks one parameter of the Calculator it sits in',
    category: Aglyn.ComponentCategory.INPUT,
    icon: { path: mdiFormTextbox.path, sx: { color: ICON_COLOR } },
    data: { $id: null, componentId: INPUT_ID, pluginId: BUNDLE_ID, props: { control: 'auto' } },
  },
]

export const functionOutputPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(OUTPUT_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Calculator Result',
    pluginId: BUNDLE_ID,
    description: 'Shows one value from the Calculator it sits in',
    category: Aglyn.ComponentCategory.INPUT,
    icon: { path: mdiFunctionVariant.path, sx: { color: ICON_COLOR } },
    data: { $id: null, componentId: OUTPUT_ID, pluginId: BUNDLE_ID, props: {} },
  },
]

export const functionShowPresets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(SHOW_ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Show When',
    pluginId: BUNDLE_ID,
    description: 'Appears only while a Calculator value is true',
    category: Aglyn.ComponentCategory.INPUT,
    icon: { path: mdiEyeOutline.path, sx: { color: ICON_COLOR } },
    data: { $id: null, componentId: SHOW_ID, pluginId: BUNDLE_ID, props: {} },
  },
]

export { FunctionInput, FunctionOutput, FunctionShow }
export default FunctionScope
