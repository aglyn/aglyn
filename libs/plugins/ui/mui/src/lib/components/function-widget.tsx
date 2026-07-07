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
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { forwardRef, useCallback, useState } from 'react'
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
   * Injected at tenant compose time (attachFunctionDefinitions) — never
   * authored directly. Editor canvas renders without it (inert preview).
   */
  definition?: Aglyn.HostFunction
}

/**
 * Interactive function widget (Component Builder wiring, AGL-93): renders
 * an input per function parameter and runs the host function client-side
 * through the shared safe evaluator on click — a no-code calculator/logic
 * block (quote estimators, eligibility checks, counters). The definition is
 * injected server-side at compose; in the besigner the widget shows a
 * static preview.
 */
const FunctionWidget = forwardRef<HTMLDivElement, FunctionWidgetProps>(
  (props, ref) => {
    const {
      functionName,
      title,
      buttonLabel,
      resultLabel,
      definition,
      ...rest
    } = props
    const [args, setArgs] = useState<Record<string, string>>({})
    const [result, setResult] = useState<string | null>(null)

    const handleRun = useCallback(() => {
      if (!definition) return
      const run = Aglyn.evaluateHostFunction(definition, args)
      setResult(
        run.ok
          ? `${resultLabel || 'Result'}: ${String(run.value)}`
          : `Error: ${run.error}`,
      )
    }, [definition, args, resultLabel])

    const parameters = definition?.parameters ?? []
    return (
      <Stack ref={ref} spacing={1.5} sx={{ maxWidth: 420 }} {...rest}>
        {title ? <Typography variant="h6">{title}</Typography> : null}
        {definition ? (
          <>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
              {parameters.map((parameter) => (
                <TextField
                  key={parameter.name}
                  label={parameter.name}
                  required={Boolean(parameter.required)}
                  value={args[parameter.name] ?? ''}
                  onChange={(event) =>
                    setArgs((previous) => ({
                      ...previous,
                      [parameter.name]: event.target.value,
                    }))
                  }
                  size="small"
                  sx={{ width: 140 }}
                />
              ))}
            </Stack>
            <Button
              variant="contained"
              onClick={handleRun}
              sx={{ alignSelf: 'flex-start' }}
            >
              {buttonLabel || 'Calculate'}
            </Button>
            {result ? (
              <Alert
                severity={result.startsWith('Error') ? 'warning' : 'success'}
              >
                {result}
              </Alert>
            ) : null}
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
