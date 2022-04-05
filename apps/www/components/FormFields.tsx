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

import {GridItems, type GridItemsProps} from '@aglyn/shared-ui-jsx'
import {type GridField} from '../lib/input-fields'


export type Props = GridItemsProps & {
  items: GridField[]
}

function FormFields(props: Props) {
  const {items = [], ...rest} = props

  const itemMapper = (item: GridField) => {
    const {GridItemProps, component: Component, props} = item
    return {children: <Component {...props} />, ...GridItemProps}
  }

  return <GridItems items={items.map(itemMapper)} spacing={2} {...rest} />
}

FormFields.displayName = 'FormFields'
FormFields.aglyn = true

export default FormFields
