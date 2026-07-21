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
 * Ported from `@data-driven-forms/mui-component-mapper` (Apache-2.0) and
 * updated for the current MUI Grid API.
 */

import { memo, useReducer } from 'react'

import {
  Button,
  type ButtonProps,
  FormControl,
  type FormControlProps,
  FormHelperText,
  type FormHelperTextProps,
  Grid,
  type GridProps,
  IconButton,
  type IconButtonProps,
  Typography,
  type TypographyProps,
} from '@mui/material'
import { styled } from '@mui/material/styles'

import RedoIcon from '@mui/icons-material/Redo'
import UndoIcon from '@mui/icons-material/Undo'

import clsx from 'clsx'

import { isEqual } from 'lodash-es'

import {
  FieldArray,
  useFieldApi,
  useFormApi,
} from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'
import type { BaseFieldProps } from './types'

const PREFIX = 'DynamicArray'

const classes = {
  formControl: `${PREFIX}-formControl`,
  centerText: `${PREFIX}-centerText`,
  buttonsToEnd: `${PREFIX}-buttonsToEnd`,
  header: `${PREFIX}-header`,
  label: `${PREFIX}-label`,
  fieldArrayGroup: `${PREFIX}-fieldArrayGroup`,
}

const StyledFormFieldGrid = styled(FormFieldGrid)({
  [`& .${classes.formControl}`]: {
    width: '100%',
  },
  [`& .${classes.centerText}`]: {
    display: 'flex',
    justifyContent: 'center',
  },
  [`& .${classes.buttonsToEnd}`]: {
    display: 'flex',
    justifyContent: 'flex-end',
  },
  [`& .${classes.header}`]: {
    display: 'flex',
  },
  [`& .${classes.label}`]: {
    flexGrow: 1,
  },
  [`&.${classes.fieldArrayGroup}`]: {
    marginBottom: 32,
  },
})

interface ArrayItemProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields: (Record<string, any> & { name?: string; component: string })[]
  fieldIndex: number
  name: string
  remove: (index: number) => void
  length: number
  minItems: number
  removeLabel: string
  FieldContainerProps?: GridProps
  FieldGroupGridProps?: GridProps
  RemoveButtonGridProps?: GridProps
  RemoveButtonProps?: ButtonProps
}

const ArrayItem = memo<ArrayItemProps>(
  ({
    fields,
    fieldIndex,
    name,
    remove,
    length,
    minItems,
    removeLabel,
    FieldContainerProps = {},
    FieldGroupGridProps = {},
    RemoveButtonGridProps = {},
    RemoveButtonProps = {},
  }) => {
    const { renderForm } = useFormApi()

    const editedFields = fields.map((field, index) => {
      const computedName = field.name ? `${name}.${field.name}` : name
      return { ...field, name: computedName, key: `${computedName}-${index}` }
    })

    return (
      <Grid container spacing={3} {...FieldContainerProps}>
        <Grid size={{ xs: 12 }} {...FieldGroupGridProps}>
          <Grid container spacing={3}>
            {renderForm(editedFields)}
          </Grid>
        </Grid>
        <Grid
          size={{ xs: 12 }}
          className={classes.buttonsToEnd}
          {...RemoveButtonGridProps}
        >
          <Button
            color="secondary"
            onClick={() => remove(fieldIndex)}
            disabled={length <= minItems}
            {...RemoveButtonProps}
          >
            {removeLabel}
          </Button>
        </Grid>
      </Grid>
    )
  },
  ({ remove: _prevRemove, ...prev }, { remove: _nextRemove, ...next }) =>
    isEqual(prev, next),
)

interface ButtonLabels {
  add?: string
  remove?: string
}

const defaultButtonLabels: Required<ButtonLabels> = {
  add: 'ADD',
  remove: 'REMOVE',
}

interface HistoryAction {
  action: 'remove'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any
}

interface HistoryState {
  index: number
  history: HistoryAction[]
}

type ReducerAction =
  | { type: 'redo' }
  | { type: 'undo' }
  | { type: 'action'; action: HistoryAction }
  | { type: 'resetHistory' }

const initialState: HistoryState = {
  index: 0,
  history: [],
}

export const reducer = (
  state: HistoryState,
  actionObj: ReducerAction,
): HistoryState => {
  switch (actionObj.type) {
    case 'redo':
      return {
        ...state,
        index: state.index + 1,
      }
    case 'action':
      return {
        index: state.index + 1,
        history: [...state.history.slice(0, state.index), actionObj.action],
      }
    case 'undo':
      return {
        ...state,
        index: state.index - 1,
      }
    case 'resetHistory':
      return {
        ...state,
        history: state.history.slice(0, state.index),
      }
    default:
      return state
  }
}

export interface FieldArrayProps extends BaseFieldProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arrayValidator?: (value: any[]) => string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields: Record<string, any>[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  defaultItem?: any
  minItems?: number
  maxItems?: number
  noItemsMessage?: string
  buttonLabels?: ButtonLabels
  FormFieldGridProps?: FormFieldGridProps
  FormControlProps?: FormControlProps
  GridContainerProps?: GridProps
  HeaderGridProps?: GridProps
  HeaderProps?: TypographyProps
  UndoButtonProps?: IconButtonProps
  RedoButtonProps?: IconButtonProps
  AddButtonProps?: ButtonProps
  DescriptionGridProps?: GridProps
  DescriptionProps?: TypographyProps
  BodyGridProps?: GridProps
  NoItemsProps?: TypographyProps
  FormHelperTextGridProps?: GridProps
  FormHelperTextProps?: FormHelperTextProps
  FieldContainerProps?: GridProps
  FieldGroupGridProps?: GridProps
  RemoveButtonGridProps?: GridProps
  RemoveButtonProps?: ButtonProps
}

export const DynamicArray = (props: FieldArrayProps) => {
  const {
    arrayValidator,
    label,
    description,
    fields: formFields,
    defaultItem,
    meta,
    minItems = 0,
    maxItems = Infinity,
    noItemsMessage = 'No items added',
    help,
    FormFieldGridProps = {},
    FormControlProps = {},
    buttonLabels,
    GridContainerProps = {},
    HeaderGridProps = {},
    HeaderProps = {},
    UndoButtonProps = {},
    RedoButtonProps = {},
    AddButtonProps = {},
    DescriptionGridProps = {},
    DescriptionProps = {},
    BodyGridProps = {},
    NoItemsProps = {},
    FormHelperTextGridProps = {},
    FormHelperTextProps = {},
    FieldContainerProps = {},
    FieldGroupGridProps = {},
    RemoveButtonGridProps = {},
    RemoveButtonProps = {},
    ...rest
  } = useFieldApi(props)
  const [state, dispatch] = useReducer(reducer, initialState)

  const combinedButtonLabels = {
    ...defaultButtonLabels,
    ...buttonLabels,
  }

  const { dirty, submitFailed, error, submitError } = meta
  const isError = (dirty || submitFailed) && error && typeof error === 'string'

  return (
    <StyledFormFieldGrid
      help={help}
      {...FormFieldGridProps}
      className={clsx(classes.fieldArrayGroup, FormFieldGridProps.className)}
    >
      <FormControl
        component="fieldset"
        error={isError || submitError}
        {...FormControlProps}
        className={clsx(classes.formControl, FormControlProps.className)}
      >
        <FieldArray
          key={rest.input.name}
          name={rest.input.name}
          validate={arrayValidator}
        >
          {({ fields: { map, value = [], push, remove } }) => {
            const pushWrapper = () => {
              dispatch({ type: 'resetHistory' })
              push(defaultItem)
            }

            const removeWrapper = (index: number) => {
              dispatch({
                type: 'action',
                action: { action: 'remove', value: value[index] },
              })
              remove(index)
            }

            const undo = () => {
              push(state.history[state.index - 1].value)
              dispatch({ type: 'undo' })
            }

            const redo = () => {
              remove(value.length - 1)
              dispatch({ type: 'redo' })
            }

            return (
              <Grid container spacing={3} {...GridContainerProps}>
                <Grid
                  size={{ xs: 12 }}
                  className={classes.header}
                  {...HeaderGridProps}
                >
                  {label && (
                    <Typography
                      variant="h6"
                      className={classes.label}
                      {...HeaderProps}
                    >
                      {label}
                    </Typography>
                  )}
                  <IconButton
                    color="primary"
                    aria-label="undo"
                    component="span"
                    disabled={state.index === 0}
                    onClick={undo}
                    {...UndoButtonProps}
                    size="large"
                  >
                    <UndoIcon />
                  </IconButton>
                  <IconButton
                    color="primary"
                    aria-label="redo"
                    component="span"
                    disabled={state.index === state.history.length}
                    onClick={redo}
                    {...RedoButtonProps}
                    size="large"
                  >
                    <RedoIcon />
                  </IconButton>
                  <Button
                    color="primary"
                    onClick={pushWrapper}
                    disabled={value.length >= maxItems}
                    {...AddButtonProps}
                  >
                    {combinedButtonLabels.add}
                  </Button>
                </Grid>
                {description && (
                  <Grid size={{ xs: 12 }} {...DescriptionGridProps}>
                    <Typography variant="subtitle1" {...DescriptionProps}>
                      {description}
                    </Typography>
                  </Grid>
                )}
                <Grid size={{ xs: 12 }} {...BodyGridProps}>
                  {value.length <= 0 ? (
                    <Typography
                      variant="body1"
                      gutterBottom
                      className={classes.centerText}
                      {...NoItemsProps}
                    >
                      {noItemsMessage}
                    </Typography>
                  ) : (
                    map((name, index) => (
                      <ArrayItem
                        key={name}
                        fields={formFields}
                        name={name}
                        fieldIndex={index}
                        remove={removeWrapper}
                        length={value.length}
                        minItems={minItems}
                        removeLabel={combinedButtonLabels.remove}
                        FieldContainerProps={FieldContainerProps}
                        FieldGroupGridProps={FieldGroupGridProps}
                        RemoveButtonGridProps={RemoveButtonGridProps}
                        RemoveButtonProps={RemoveButtonProps}
                      />
                    ))
                  )}
                </Grid>
                {(isError || submitError) && (
                  <Grid size={{ xs: 12 }} {...FormHelperTextGridProps}>
                    <FormHelperText {...FormHelperTextProps}>
                      {error || submitError}
                    </FormHelperText>
                  </Grid>
                )}
              </Grid>
            )
          }}
        </FieldArray>
      </FormControl>
    </StyledFormFieldGrid>
  )
}

export default DynamicArray
