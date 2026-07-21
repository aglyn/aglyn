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

import { ICON_VARIANT_COLLAPSIBLE_OPEN } from '@aglyn/shared-data-enums'
import { HelpTip, type HelpTipContent, MdiIcon } from '@aglyn/shared-ui-jsx'
import { styled } from '@aglyn/shared-ui-theme'
import {
  Accordion as MuiAccordion,
  AccordionDetails as MuiAccordionDetails,
  type AccordionDetailsProps as MuiAccordionDetailsProps,
  AccordionProps as MuiAccordionProps,
  AccordionSummary as MuiAccordionSummary,
  type AccordionSummaryProps as MuiAccordionSummaryProps,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import { forwardRef, useCallback, useState } from 'react'

const StyledAccordion = styled(MuiAccordion)(({ theme }) => {
  // In CSS vars mode, theme.palette.* is always the static light values.
  // Use (theme.vars || theme) so these become live CSS custom-property refs.
  const tv = (theme as any).vars || theme
  return {
  border: `1px solid ${tv.palette.divider}`,
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
    backgroundColor: tv.palette.surface.main,
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
    borderTop: `1px solid ${tv.palette.divider}`,
  },
}}) as typeof MuiAccordion

export interface AccordionProps extends MuiAccordionProps {
  AccordionSummaryProps?: MuiAccordionSummaryProps
  AccordionDetailsProps?: MuiAccordionDetailsProps
  summary?: JSX.Children
  /** Contextual help affordance rendered after the summary label (AGL-600). */
  help?: HelpTipContent
}

export const Accordion = forwardRef<any, AccordionProps>((props, ref) => {
  const {
    expanded: expandedProp,
    onChange,
    AccordionSummaryProps,
    AccordionDetailsProps,
    summary,
    help,
    children,
    ...rest
  } = props
  // Always a boolean so MUI sees a controlled Accordion from the first
  // render — seeding with an omitted (undefined) prop rendered it
  // uncontrolled until the first toggle flipped it controlled (AGL-590).
  const [expanded, setExpanded] = useState(Boolean(expandedProp))
  const handleToggle = useCallback(
    (e, expanded: boolean) => {
      setExpanded(Boolean(expanded))
      onChange?.(e, expanded)
    },
    [onChange],
  )

  return (
    <StyledAccordion
      ref={ref}
      onChange={handleToggle}
      elevation={0}
      expanded={expanded}
      disableGutters
      square
      {...rest}
    >
      <MuiAccordionSummary
        sx={{ position: 'sticky', top: 0, zIndex: 5 }}
        expandIcon={
          <MdiIcon
            path={ICON_VARIANT_COLLAPSIBLE_OPEN.path}
            sx={{ fontSize: '0.9rem' }}
          />
        }
        {...AccordionSummaryProps}
      >
        {summary}
        {help && (
          <HelpTip
            {...help}
            sx={{ fontSize: '0.8em', ml: 0.5, my: -0.5 }}
            onClick={(event) => event.stopPropagation()}
          />
        )}
      </MuiAccordionSummary>
      <MuiAccordionDetails sx={{ zIndex: 1 }} {...AccordionDetailsProps}>
        {children}
      </MuiAccordionDetails>
    </StyledAccordion>
  )
})

export interface AccordionListProps<T = any> {
  items: T[]
  unique?: boolean
  defaultExpanded?: JSX.Key[]
  AccordionProps?: MuiAccordionProps
  AccordionSummaryProps?: MuiAccordionSummaryProps
  AccordionDetailsProps?: MuiAccordionDetailsProps
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
              summary={onRenderSummary({ item })}
              AccordionSummaryProps={AccordionSummaryProps}
              AccordionDetailsProps={AccordionDetailsProps}
              {...AccordionProps}
            >
              {onRenderDetail({ item })}
            </Accordion>
          )
        })}
      </>
    )
  },
)
AccordionListComponent.displayName = 'AccordionListComponent'

export default AccordionListComponent
