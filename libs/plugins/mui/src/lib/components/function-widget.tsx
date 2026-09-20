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
import { mdiFunctionVariant } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { forwardRef, useCallback, useContext, useMemo, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'functionWidget'

export interface FunctionWidgetProps {
  /** Name of the host function to run (Functions card on the dashboard). */
  functionName?: string
  title?: string
  buttonLabel?: string
  resultLabel?: string
  /**
   * Several named results instead of one (AGL-3202): one per line, as
   * `name | Label`, where the name is a parameter or variable of the
   * function. Empty shows the return value alone, as it always has.
   */
  outputs?: string
  /** Recompute as the visitor types; no button (AGL-3202). */
  autoRun?: boolean
  /**
   * Injected at tenant compose time (attachFunctionDefinitions) — never
   * authored directly. Editor canvas renders without it (inert preview).
   */
  definition?: Aglyn.HostFunction
  /**
   * The site variables this function reads, by name (AGL-3202). Injected
   * beside `definition`, and only the ones its expressions name.
   */
  globals?: Record<string, number | string | boolean>
}

/** One row of the `outputs` attribute. */
export interface FunctionWidgetOutput {
  name: string
  label: string
}

/**
 * `name | Label` per line. A line with no bar labels the row with the name,
 * and a name may appear once: the second copy of a row is a typo, not a
 * second result.
 */
export function parseFunctionWidgetOutputs(
  text: string | undefined,
): FunctionWidgetOutput[] {
  const rows: FunctionWidgetOutput[] = []
  const seen = new Set<string>()
  for (const line of String(text ?? '').split('\n')) {
    const [rawName, ...rest] = line.split('|')
    const name = rawName.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    rows.push({ name, label: rest.join('|').trim() || name })
  }
  return rows
}

/** What each input starts with: the parameter's own default, or nothing. */
function initialArguments(
  definition: Aglyn.HostFunction | undefined,
): Record<string, string> {
  const args: Record<string, string> = {}
  for (const parameter of definition?.parameters ?? []) {
    if (parameter.defaultValue != null && parameter.defaultValue !== '') {
      args[parameter.name] = String(parameter.defaultValue)
    } else if (parameter.options?.length) {
      // A select always shows a choice, so the function has to receive the
      // one on screen — not an empty string the visitor never saw.
      args[parameter.name] = String(parameter.options[0].value)
    }
  }
  return args
}

function displayValue(value: number | string | boolean | undefined): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return value == null ? '' : String(value)
}

/**
 * Interactive function widget (Component Builder wiring, AGL-93): renders
 * an input per function parameter and runs the host function client-side
 * through the shared safe evaluator — a no-code calculator/logic block
 * (quote estimators, eligibility checks, counters). The definition is
 * injected server-side at compose; in the besigner the widget shows a
 * static preview.
 *
 * WHAT A REAL CALCULATOR NEEDED (AGL-3202). The first one built on this
 * compared five platforms, and the widget could ask for nothing but free
 * text, labeled with the parameter's identifier, and could answer with
 * nothing but one line. So a parameter now renders as what it IS — a number
 * box, a yes/no switch, a choice list — under the label its author wrote;
 * `outputs` lists several named results; and `autoRun` recomputes as the
 * visitor types. All three are opt-in: a widget that sets none of them
 * renders and behaves exactly as it did.
 */
const FunctionWidget = forwardRef<HTMLDivElement, FunctionWidgetProps>(
  (props, ref) => {
    const {
      functionName,
      title,
      buttonLabel,
      resultLabel,
      outputs,
      autoRun,
      definition,
      globals,
      ...rest
    } = props
    const { suppressNavigation } = useContext(Aglyn.ScreenLinkContext)
    const [args, setArgs] = useState<Record<string, string>>(() =>
      initialArguments(definition),
    )
    // Button mode answers for what was typed WHEN the button was pressed, so
    // the line under it does not change while the visitor edits a number.
    const [submitted, setSubmitted] = useState<Record<string, string> | null>(
      null,
    )
    const outputRows = useMemo(
      () => parseFunctionWidgetOutputs(outputs),
      [outputs],
    )
    const live = Boolean(autoRun)
    const evaluated = live ? args : submitted
    const run = useMemo(
      () =>
        definition && evaluated
          ? Aglyn.evaluateHostFunction(definition, evaluated, { globals })
          : null,
      [definition, evaluated, globals],
    )
    const handleRun = useCallback(() => {
      if (!definition) return
      setSubmitted({ ...args })
    }, [definition, args])
    const setArgument = useCallback((name: string, value: string) => {
      setArgs((previous) => ({ ...previous, [name]: value }))
    }, [])
    // With no definition there is nothing to run, and the line drawn in its
    // place is addressed to the author: a published page renders the bare
    // element.
    if (!definition && !suppressNavigation) return <Stack ref={ref} {...rest} />
    const parameters = definition?.parameters ?? []
    // Typing toward a valid answer is not a mistake. In live mode a required
    // input that is still empty shows nothing rather than a warning that
    // fires on the first keystroke of every visit.
    const waiting =
      live &&
      run?.ok === false &&
      parameters.some(
        (parameter) =>
          parameter.required &&
          !String(args[parameter.name] ?? '').trim() &&
          !parameter.defaultValue,
      )
    return (
      <Stack ref={ref} spacing={1.5} sx={{ maxWidth: 420 }} {...rest}>
        {title ? <Typography variant="h6">{title}</Typography> : null}
        {definition ? (
          <>
            <Stack
              direction="row"
              spacing={1}
              sx={{ flexWrap: 'wrap', rowGap: 1.5, alignItems: 'center' }}
            >
              {parameters.map((parameter) => {
                const label = parameter.label?.trim() || parameter.name
                const value = args[parameter.name] ?? ''
                if (parameter.options?.length) {
                  return (
                    <TextField
                      key={parameter.name}
                      select
                      label={label}
                      required={Boolean(parameter.required)}
                      value={value}
                      onChange={(event) =>
                        setArgument(parameter.name, event.target.value)
                      }
                      size="small"
                      // Native: a portal-mounted menu is one more thing a
                      // sandboxed or transformed ancestor can misplace, and
                      // on a phone the platform picker is the better control.
                      slotProps={{ select: { native: true } }}
                      sx={{ minWidth: 200 }}
                    >
                      {parameter.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label?.trim() || option.value}
                        </option>
                      ))}
                    </TextField>
                  )
                }
                if (parameter.type === 'boolean') {
                  return (
                    <FormControlLabel
                      key={parameter.name}
                      label={label}
                      control={
                        <Switch
                          checked={value === 'true'}
                          onChange={(event) =>
                            setArgument(
                              parameter.name,
                              event.target.checked ? 'true' : 'false',
                            )
                          }
                        />
                      }
                    />
                  )
                }
                return (
                  <TextField
                    key={parameter.name}
                    label={label}
                    required={Boolean(parameter.required)}
                    value={value}
                    onChange={(event) =>
                      setArgument(parameter.name, event.target.value)
                    }
                    size="small"
                    {...(parameter.type === 'number'
                      ? {
                          type: 'number',
                          slotProps: { htmlInput: { inputMode: 'decimal' } },
                        }
                      : {})}
                    sx={{ width: parameter.label ? 200 : 140 }}
                  />
                )
              })}
            </Stack>
            {live ? null : (
              <Button
                variant="contained"
                onClick={handleRun}
                sx={{ alignSelf: 'flex-start' }}
              >
                {buttonLabel || 'Calculate'}
              </Button>
            )}
            <Stack spacing={1} aria-live="polite">
              {run && run.ok === false && !waiting ? (
                <Alert severity="warning">{`Error: ${run.error}`}</Alert>
              ) : null}
              {run && run.ok && outputRows.length ? (
                <>
                  <Stack divider={<Divider flexItem />} spacing={0.75}>
                    {outputRows.map((row) => (
                      <Stack
                        key={row.name}
                        direction="row"
                        spacing={2}
                        sx={{ justifyContent: 'space-between' }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          {row.label}
                        </Typography>
                        <Typography
                          variant="body2"
                          data-aglyn-function-output={row.name}
                          sx={{ fontWeight: 600, textAlign: 'right' }}
                        >
                          {displayValue(run.scope[row.name])}
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                  {definition.returnValue && displayValue(run.value) ? (
                    <Typography
                      variant="body2"
                      data-aglyn-function-output="returnValue"
                    >
                      {resultLabel
                        ? `${resultLabel}: ${displayValue(run.value)}`
                        : displayValue(run.value)}
                    </Typography>
                  ) : null}
                </>
              ) : null}
              {run && run.ok && !outputRows.length ? (
                <Alert severity="success">
                  {`${resultLabel || 'Result'}: ${String(run.value)}`}
                </Alert>
              ) : null}
            </Stack>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {functionName
              ? `Function widget "${functionName}" — interactive on the published site.`
              : 'Function widget — set the Function name attribute to a function from your dashboard.'}
          </Typography>
        )}
      </Stack>
    )
  },
)
FunctionWidget.displayName = 'AglynFunctionWidget'

export const schema: Aglyn.ComponentSchema<FunctionWidgetProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Function Widget',
  description:
    'Runs one of your no-code functions and shows the result — calculators, quotes.',
  category: Aglyn.ComponentCategory.INPUT,
  icon: { path: mdiFunctionVariant.path, sx: { color: '#7b1fa2' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'functionName',
      description:
        'Name of a function from the dashboard Functions card to run.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Function name',
    },
    {
      name: 'title',
      description: 'Heading shown above the inputs.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Title',
    },
    {
      name: 'buttonLabel',
      description: 'Label on the run button.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Button label',
    },
    {
      name: 'resultLabel',
      description: 'Prefix shown before the result value.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      label: 'Result label',
    },
    {
      name: 'outputs',
      description:
        'Show several results instead of one. One per line, as ' +
        '"name | Label": the name of a parameter or variable of the ' +
        'function, then what visitors should read beside it. Leave empty ' +
        'to show only the function’s return value.',
      component: Aglyn.FieldComponentType.TEXTAREA,
      label: 'Results to show',
    },
    {
      name: 'autoRun',
      description:
        'If true, the results update as the visitor types and the button ' +
        'is not shown.',
      component: Aglyn.FieldComponentType.SWITCH,
      label: 'Update as the visitor types?',
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Function Widget',
    pluginId: BUNDLE_ID,
    description: 'Run a no-code function — calculators, quotes, checks',
    category: Aglyn.ComponentCategory.INPUT,
    icon: { path: mdiFunctionVariant.path, sx: { color: '#7b1fa2' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { buttonLabel: 'Calculate' },
    },
  },
]

export default FunctionWidget
