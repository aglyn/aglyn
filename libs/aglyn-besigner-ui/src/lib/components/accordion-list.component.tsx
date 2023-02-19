/**
 * @license
 * Copyright 2023 Aglyn LLC
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
import { MdiIcon } from '@aglyn/shared-ui-mdi-jsx'
import { styled } from '@aglyn/shared-ui-theme'
import {
  Accordion as MuiAccordion,
  AccordionDetails as MuiAccordionDetails,
  type AccordionDetailsProps,
  type AccordionProps,
  AccordionSummary as MuiAccordionSummary,
  type AccordionSummaryProps,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import { useCallback, useState } from 'react'

const Accordion = styled(MuiAccordion)(({ theme }) => ({
  border: `1px solid ${theme.palette.divider}`,
  borderLeft: 0,
  borderRight: 0,
  '&:not(:last-of-type)': {
    borderBottom: 0,
  },
  '&:before': {
    display: 'none',
  },

  '& .MuiAccordionSummary-root': {
    textTransform: 'uppercase',
    backgroundColor: theme.palette.surface.main,
    flexDirection: 'row-reverse',
    minHeight: 38,
    fontSize: theme.typography.pxToRem(14),

    '& .MuiAccordionSummary-expandIconWrapper.Mui-expanded': {
      transform: 'rotate(90deg)',
    },
    '& .MuiAccordionSummary-content': {
      marginLeft: theme.spacing(1),
      marginBottom: theme.spacing(1),
      marginTop: theme.spacing(1),
    },
    '&': {},
  },
  '& .MuiAccordionDetails-root': {
    padding: theme.spacing(2),
    borderTop: `1px solid ${theme.palette.divider}`,
  },
}))

export interface AccordionListProps<T = any> {
  items: T[]
  unique?: boolean
  defaultExpanded?: JSX.Key[]
  AccordionProps?: AccordionProps
  AccordionSummaryProps?: AccordionSummaryProps
  AccordionDetailsProps?: AccordionDetailsProps
  onRenderSummary: (props: { item: T }) => JSX.Children
  onRenderDetail: (props: { item: T }) => JSX.Children
  getItemId: (item: T) => string | number
}

export const AccordionListComponent = observer(
  <T,>(props: AccordionListProps<T>) => {
    const {
      items,
      defaultExpanded,
      onRenderSummary,
      onRenderDetail,
      AccordionProps,
      AccordionSummaryProps,
      AccordionDetailsProps,
      unique,
      getItemId,
    } = props

    const [expanded, setExpanded] = useState<JSX.Key[]>(() => [
      ...(defaultExpanded || []),
    ])
    const handleToggle = useCallback(
      (id: JSX.Key) => (e, expanded: boolean) => {
        setExpanded((prev) => {
          if (unique && expanded) return [id]
          if (unique && !expanded) return []
          const data = [...prev].filter((i) => i !== id)
          if (expanded) data.push(id)
          return data
        })
      },
      [unique],
    )

    return (
      <>
        {items.map((item) => {
          const id = getItemId(item)
          const isExpanded = expanded.some((i) => i === id)
          return (
            <Accordion
              key={id}
              expanded={isExpanded}
              onChange={handleToggle(id)}
              elevation={0}
              disableGutters
              square
              {...AccordionProps}
            >
              <MuiAccordionSummary
                sx={{ position: 'sticky', top: 0 }}
                expandIcon={
                  <MdiIcon
                    path={ICON_VARIANT_COLLAPSIBLE_OPEN.path}
                    sx={{ fontSize: '0.9rem' }}
                  />
                }
                {...AccordionSummaryProps}
              >
                {onRenderSummary({ item })}
              </MuiAccordionSummary>
              <MuiAccordionDetails {...AccordionDetailsProps}>
                {onRenderDetail({ item })}
              </MuiAccordionDetails>
            </Accordion>
          )
        })}
      </>
    )
  },
)
AccordionListComponent.displayName = 'AccordionListComponent'

export default AccordionListComponent
