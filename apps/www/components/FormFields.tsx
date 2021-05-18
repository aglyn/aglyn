import React from 'react'
import GridItems, { Props as GridItemsProps } from '@aglyn/common/components/GridItems'
import { GridField } from '../lib/input-fields'


export type Props = GridItemsProps & {
  items: GridField[]
}

function FormFields(props: Props) {
  const { items = [], ...rest } = props

  const itemMapper = (item: GridField) => {
    const { GridItemProps, component: Component, props } = item
    return ({ children: (<Component {...props} />), ...GridItemProps })
  }

  return (
    <GridItems
      items={items.map(itemMapper)}
      spacing={2}
      {...rest}
    />
  )
}

FormFields.displayName = 'FormFields'

export default FormFields
