import React from 'react'
import MuiTextField, { OutlinedTextFieldProps as MuiTextFieldProps } from '@material-ui/core/TextField'
import MuiMenuItem, { MenuItemProps as MuiMenuItemProps } from '@material-ui/core/MenuItem'

function FieldSelect(props: Props) {
  const { items = [], ...rest } = props
  return (
    <MuiTextField select {...rest}>
      {items.map((item, key) => (<MuiMenuItem key={key} {...item as any} />))}
    </MuiTextField>
  )
}

FieldSelect.displayName = 'FieldSelect'

export interface Props extends MuiTextFieldProps {
  items: Array<MuiMenuItemProps>
}

export default FieldSelect