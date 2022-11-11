/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { ICON_VARIANT_COLLAPSIBLE_OPEN } from '@aglyn/shared-data-enums'
import type { AnyObj } from '@aglyn/shared-data-types'
import { MdiIcon } from '@aglyn/shared-ui-mdi-jsx'
import { styled } from '@aglyn/shared-ui-theme'
import { _isArrEmpty, _isUndOrNull } from '@aglyn/shared-util-guards'
import {
  Accordion as MuiAccordion,
  AccordionDetails as MuiAccordionDetails,
  type AccordionDetailsProps as MuiAccordionDetailsProps,
  type AccordionProps as MuiAccordionProps,
  AccordionSummary as MuiAccordionSummary,
  type AccordionSummaryProps as MuiAccordionSummaryProps,
} from '@mui/material'
import { Fragment, useCallback, useState } from 'react'

const Accordion = styled((props: MuiAccordionProps) => {
  const { children, ...rest } = props
  return (
    <MuiAccordion disableGutters elevation={0} square {...rest}>
      {children}
    </MuiAccordion>
  )
})<Partial<MuiAccordionProps>>(({ theme }) => ({
  border: `1px solid ${theme.palette.divider}`,
  borderLeft: 0,
  borderRight: 0,
  '&:not(:last-child)': {
    borderBottom: 0,
  },
  '&:before': {
    display: 'none',
  },
}))
export interface AccordionSummaryProps
  extends Partial<MuiAccordionSummaryProps> {
  dense?: boolean
}
const AccordionSummary = styled(
  (props: MuiAccordionSummaryProps) => (
    <MuiAccordionSummary
      expandIcon={
        <MdiIcon
          path={ICON_VARIANT_COLLAPSIBLE_OPEN.path}
          sx={{ fontSize: '0.9rem' }}
        />
      }
      {...props}
    />
  ),
  {
    shouldForwardProp(propName: PropertyKey) {
      return propName !== 'dense'
    },
  },
)<AccordionSummaryProps>(({ theme, dense }) => ({
  textTransform: 'uppercase',
  backgroundColor: theme.palette.surface.main,
  flexDirection: 'row-reverse',
  '& .MuiAccordionSummary-expandIconWrapper.Mui-expanded': {
    transform: 'rotate(90deg)',
  },
  '& .MuiAccordionSummary-content': {
    marginLeft: theme.spacing(1),
  },
  ...(dense
    ? {
        '&': {
          minHeight: 38,
          fontSize: theme.typography.pxToRem(14),
        },
        '& .MuiAccordionSummary-content': {
          marginBottom: theme.spacing(1),
          marginTop: theme.spacing(1),
        },
      }
    : {}),
}))
export interface AccordionDetailsProps
  extends Partial<MuiAccordionDetailsProps> {}
const AccordionDetails = styled(MuiAccordionDetails)<AccordionDetailsProps>(
  ({ theme }) => ({
    padding: theme.spacing(2),
    borderTop: '1px solid rgba(0, 0, 0, .125)',
  }),
)

export interface AccordionListItem extends AnyObj {
  id?: JSX.Key
  key?: JSX.Key
}
export interface AccordionRenderProps<
  T extends AccordionListItem = AccordionListItem,
> extends AnyObj {
  id: JSX.Key
  item: T
  isOpen: boolean
  openItems: JSX.Key[]
}

export interface AccordionListProps<
  T extends AccordionListItem = AccordionListItem,
> {
  items: T[]
  unique?: boolean
  defaultExpanded?: JSX.Key[]
  SummaryContentComponent?: JSX.ElementType<AccordionRenderProps<T>>
  DetailsContentComponent?: JSX.ElementType<AccordionRenderProps<T>>
  AccordionSummaryProps?: Partial<AccordionSummaryProps>
  AccordionDetailsProps?: Partial<AccordionDetailsProps>
}

const AccordionListComponent = <T extends AccordionListItem>(
  props: AccordionListProps<T>,
) => {
  const {
    items,
    defaultExpanded: initial,
    SummaryContentComponent,
    DetailsContentComponent,
    AccordionSummaryProps,
    AccordionDetailsProps,
    unique,
  } = props
  const [openItems, setOpenItems] = useState<JSX.Key[]>(() => {
    if (!_isArrEmpty(initial)) return [...initial]
    const first = items[0]
    if (!_isUndOrNull(first?.id)) return [first?.id]
    if (!_isUndOrNull(first?.key)) return [first?.key]
    return []
  })
  const handleToggle = useCallback(
    (id: JSX.Key) => (event: any, expand: boolean) => {
      setOpenItems((prev) => {
        const exists = prev.indexOf(id) >= 0
        if (expand && unique) return [id]
        if (!expand && unique) return []
        if (expand && exists) return prev
        if (expand && !exists) return [...prev, id]
        if (!expand && exists) return prev.filter((i) => i !== id)
        return prev
      })
    },
    [unique],
  )

  function getItemId(item: AccordionListItem, index: number) {
    return item?.key ?? item?.id ?? index
  }

  function isOpen(id: JSX.Key) {
    return unique
      ? openItems[openItems.length - 1] === id
      : openItems.indexOf(id) >= 0
  }

  return (
    <Fragment>
      {items.map((item, index) => {
        const itemId = getItemId(item, index)
        const itemOpen = isOpen(itemId)
        const onToggle = handleToggle(itemId)
        return (
          <Accordion key={itemId} expanded={itemOpen} onChange={onToggle}>
            <AccordionSummary {...AccordionSummaryProps}>
              <SummaryContentComponent
                id={itemId}
                isOpen={itemOpen}
                item={item}
                openItems={openItems}
              />
            </AccordionSummary>
            <AccordionDetails {...AccordionDetailsProps}>
              <DetailsContentComponent
                id={itemId}
                isOpen={itemOpen}
                item={item}
                openItems={openItems}
              />
            </AccordionDetails>
          </Accordion>
        )
      })}
    </Fragment>
  )
}
AccordionListComponent.displayName = 'AccordionListComponent'
AccordionListComponent.aglyn = true
AccordionListComponent.defaultProps = {
  unique: false,
  RenderSummaryComponent: (({ id }) => id) as any,
  RenderDetailsComponent: (({ id }) => id) as any,
}

export { AccordionListComponent }
export default AccordionListComponent
