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
'use client'

import { PageHeaderRecord } from '@aglyn/aglyn'
import { AppLink, CardDisplay, type CardDisplayProps } from '@aglyn/shared-ui-jsx'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { Button, Chip, type ChipProps, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

export interface CrmRecordHeaderProps {
  /** What the record is — the lead card's heading: Contact, Company, Deal, Lead. */
  kind: string
  /**
   * The record's own name, published to the page heading and the trail.
   * Undefined until it has loaded, so the route's heading stands meanwhile.
   */
  title: string | undefined
  /** The one line under the heading — an address, a domain, a pipeline and stage. */
  subtitle?: ReactNode
  /** The record's facts as chips: a stage, a status, an owner. */
  chips?: ReactNode
  /** The way back to the section the record lives in. */
  backHref: string
  backLabel: string
  /** The primary controls, beside the menu. */
  actions?: ReactNode
  /** Everything else, behind the overflow — the destructive act lives here. */
  menuItems?: RowActionsMenuItem[]
  help?: CardDisplayProps['help']
  /** The record is still on its way; the chip row says so rather than sitting empty. */
  loading?: boolean
  /** What the card holds under the chips — a properties list, or a refusal. */
  children?: ReactNode
}

/**
 * THE HEADER EVERY CRM RECORD PAGE OPENS ON (AGL-2614).
 *
 * A contact, a company, a deal and a lead each had a lead card of their own
 * and no two agreed: one kept its controls in the card header and one at the
 * card's foot, one put the way back in a caption under the properties, one
 * offered Delete as a red button beside Edit and one behind a menu, and the
 * page heading was published by the page on three of them and never on the
 * fourth. A reader moving between the four records of one sale was reading
 * four products.
 *
 * ## The grammar
 *
 * ```
 *   [ page heading and trail: the record's name ]
 *   Kind                           [ Back to … ] [ primary ] [ ⋮ ]
 *   subtitle line
 *   [ chip ] [ chip ] [ chip ]
 *   children
 * ```
 *
 * The page heading is the record's NAME — published from here, once, by
 * whichever component loaded the record, so the shell's heading and the
 * card read one document. The card is then free to say what the record IS
 * (`kind`) rather than repeating the name, and its subtitle carries the one
 * fact that identifies the record beyond its name: the address, the domain,
 * the pipeline and stage.
 *
 * Controls sit in the card HEADER, never at its foot: the header is where a
 * reader looks for what they can do to the thing they just opened, and a
 * foot of controls scrolls away under a long properties list. The way back
 * leads, because the record is the trail's last crumb and the crumb is not a
 * link. The primary act — Edit, Convert, Add to list — is a button; every
 * other act, and the destructive one in particular, is a menu item, so that
 * a delete is never one mis-click from the button beside it.
 */
export function CrmRecordHeader(props: CrmRecordHeaderProps) {
  const {
    kind,
    title,
    subtitle,
    chips,
    backHref,
    backLabel,
    actions,
    menuItems,
    help,
    loading,
    children,
  } = props
  const hasChipRow = Boolean(chips) || Boolean(loading)
  return (
    <>
      <PageHeaderRecord title={title} />
      <CardDisplay
        header={kind}
        subheader={subtitle}
        help={help}
        contentGutterX
        contentGutterY
        HeaderProps={{
          action: (
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
            >
              <Button
                component={AppLink as any}
                {...({ componentVariant: 'naked', nativeButton: false } as any)}
                href={backHref}
                size="small"
                color="primary"
              >
                {backLabel}
              </Button>
              {actions}
              {menuItems?.length ? (
                <RowActionsMenu label={title || kind} items={menuItems} />
              ) : null}
            </Stack>
          ),
        }}
      >
        {hasChipRow || children ? (
          <Stack spacing={2}>
            {hasChipRow ? (
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
              >
                {chips}
                {loading ? (
                  <Typography variant="body2" color="text.secondary">
                    {'Loading…'}
                  </Typography>
                ) : null}
              </Stack>
            ) : null}
            {children}
          </Stack>
        ) : null}
      </CardDisplay>
    </>
  )
}
CrmRecordHeader.displayName = 'CrmRecordHeader'

export interface CrmRecordChipProps {
  /** What the fact is — Owner, Industry, Amount. */
  label: string
  /** The fact. Nothing is rendered without one, so a caller can pass it blindly. */
  value?: ReactNode
  color?: ChipProps['color']
  variant?: ChipProps['variant']
}

/**
 * One fact on the chip row, in the `Label: value` form every record uses.
 *
 * A chip with no value renders nothing rather than a bare label, so a
 * record page lists every fact it might have and the row shows the ones
 * this record does.
 */
export function CrmRecordChip(props: CrmRecordChipProps) {
  const { label, value, color, variant = 'outlined' } = props
  if (value === null || value === undefined || value === '') return null
  return (
    <Chip
      size="small"
      variant={variant}
      color={color}
      label={
        <>
          <Typography component="span" variant="inherit" color="text.secondary">
            {`${label}: `}
          </Typography>
          {value}
        </>
      }
    />
  )
}
CrmRecordChip.displayName = 'CrmRecordChip'

export default CrmRecordHeader
