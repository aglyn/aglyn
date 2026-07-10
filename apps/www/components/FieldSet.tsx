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

import { createStyles, makeStyles, type Theme } from '@aglyn/shared-ui-theme'
import { _isArr } from '@aglyn/shared-util-tools'
import { MenuItem, TextField } from '@mui/material'
import Checkbox from '@mui/material/Checkbox'
import ListItem from '@mui/material/ListItem'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import { ChangeEventHandler } from 'react'
import { List, type RowComponentProps } from 'react-window'
import { fieldHasError, type Fields } from '../forms'

const useStyles = makeStyles<Theme, Props>((theme: Theme) =>
  createStyles({
    wrapper: {
      '& $list': {
        width: '100%',
        height: 400,
        // maxWidth: 300,
        backgroundColor: theme.palette.background.paper,
      },
    },
    list: {},
  }),
)

const buildOption = (option: Fields.Option, key?: any) => (
  <MenuItem key={key} value={option.value}>
    {option.label}
  </MenuItem>
)

type CheckboxListRowProps = RowComponentProps<{
  items: Fields.Option[]
  field: Fields.FieldT
  onUpdate: Props['onUpdate']
}>

function CheckboxListRow(props: CheckboxListRowProps) {
  const { index, style, items } = props
  const item = (items ?? [])[index]
  return (
    <ListItem dense button style={style} onClick={() => {}}>
      <ListItemIcon>
        <Checkbox
          edge="start"
          checked={true}
          tabIndex={-1}
          disableRipple
          inputProps={{ 'aria-labelledby': item.label }}
        />
      </ListItemIcon>
      <ListItemText primary={item.label} />
    </ListItem>
  )
}

const getFieldOptions = (
  field: Fields.FieldT,
  fields: Fields.FieldGroup,
): Fields.Option[] => {
  let items = _isArr(field.options) ? field.options : field.options(fields)
  let error = null
  if (!_isArr(items)) {
    items
      .then((i) => {
        items = i
      })
      .catch((err) => {
        error = err
      })
  }
  if (error || !_isArr(items)) {
    return [{ value: null, label: error?.message ?? 'Error loading items' }]
  }
  return items
}

export type Props = {
  fields: Fields.FieldGroup
  loading?: boolean
  onUpdate: (
    fieldId: string,
  ) => ChangeEventHandler<HTMLTextAreaElement | HTMLInputElement>
}

export default function FieldSet(props: Props) {
  const classes = useStyles(props)
  const { fields, loading, onUpdate } = props

  const getTextOrSelect = (field: Fields.FieldT, key?: any) => (
    <TextField
      fullWidth
      key={field?.key ?? field?.id ?? key}
      name={field.id}
      type={field.type ?? 'text'}
      label={field.label}
      variant="outlined"
      margin="normal"
      defaultValue={field.value ?? field.defaultValue}
      // value={field.value ?? ''}
      onChange={onUpdate(field.id)}
      error={fieldHasError(field)}
      disabled={Boolean(loading)}
      helperText={fieldHasError(field) && field.errorMessage}
      required={Boolean(field.required)}
    >
      {field.type !== 'select' ? null : (
        <>
          {buildOption({ label: 'Select an option', value: '' })}
          {getFieldOptions(field, fields).map(buildOption)}
        </>
      )}
    </TextField>
  )

  const getVirtualizedList = (field: Fields.FieldT) => {
    let row
    switch (field.type) {
      case 'checkbox-multi':
        row = CheckboxListRow
        break
      default:
        row = CheckboxListRow
        break
    }
    const items = getFieldOptions(field, fields)
    return (
      <div className={classes.wrapper}>
        <List
          style={{ height: 400, width: '100%' }}
          rowComponent={row}
          rowCount={items.length}
          rowHeight={42}
          rowProps={{ items, field, onUpdate }}
        />
      </div>
    )
  }

  const buildField = (field: Fields.FieldT) => {
    switch (field.type) {
      case 'checkbox-multi':
        return getVirtualizedList(field)
      case 'text':
      case 'select':
      default:
        return getTextOrSelect(field)
    }
  }

  return (
    <div className={classes.root}>{Object.values(fields).map(buildField)}</div>
  )
}
