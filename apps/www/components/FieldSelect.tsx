/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import MuiTextField, { OutlinedTextFieldProps as MuiTextFieldProps } from '@mui/material/TextField'
import MuiMenuItem, { MenuItemProps as MuiMenuItemProps } from '@mui/material/MenuItem'


export interface FieldSelectProps extends MuiTextFieldProps {
  items: MuiMenuItemProps[]
}

function FieldSelect(props: FieldSelectProps) {
  const {items = [], ...rest} = props
  return (
    <MuiTextField select {...rest}>
      {items.map((item, key) => (
        <MuiMenuItem key={item.id ?? key} {...item} />)
      )}
    </MuiTextField>
  )
}

FieldSelect.displayName = 'FieldSelect'
export { FieldSelect }
export default FieldSelect
