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

import {
  NOTIFICATION_CATEGORY_DESCRIPTIONS,
  NOTIFICATION_SELF_SENT_EMAIL_TYPES,
  NOTIFICATION_TYPE_LABELS,
  notificationTypesInCategory,
  type AglynNotificationType,
  type NotificationCategory,
  type NotificationChannel,
} from '@aglyn/aglyn'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import {
  IconButton,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState } from 'react'

const typeLabel = (type: string): string =>
  (NOTIFICATION_TYPE_LABELS as Record<string, string>)[type] ?? type

/** `undefined` is Inherit — the tri-state the scope card is built on. */
const asValue = (value: boolean | undefined) =>
  value === undefined ? 'inherit' : String(value)

export interface NotificationScopeTableProps {
  /**
   * The categories this scope may answer for. Staff categories are the
   * caller's to exclude — see the page, and `notificationChannelEnabled`,
   * which refuses to read a scope layer for them at all.
   */
  categories: Array<[NotificationCategory, string]>
  /**
   * The workspace or site on screen, for the expander's accessible name.
   *
   * The account card carries the same expanders, so without this BOTH read
   * "Show what Billing covers" and a screen-reader user has no way to tell
   * which card they are in — two identical controls doing different things.
   */
  scopeLabel: string
  channels: Array<{ key: NotificationChannel; label: string }>
  /** This scope's own category answer, with no inheritance applied. */
  categoryPref: (
    category: NotificationCategory,
    channel: NotificationChannel,
  ) => boolean | undefined
  /** This scope's own answer for one type, with no inheritance applied. */
  typePref: (
    type: AglynNotificationType,
    channel: NotificationChannel,
  ) => boolean | undefined
  onCategoryChange: (
    category: NotificationCategory,
    channel: NotificationChannel,
    value: boolean | undefined,
  ) => void
  onTypeChange: (
    type: AglynNotificationType,
    channel: NotificationChannel,
    value: boolean | undefined,
  ) => void
}

/**
 * ONE WORKSPACE OR ONE SITE, down to the individual notification (AGL-3267).
 *
 * The scope card answered for whole CATEGORIES only, which put the fine grain
 * in the one place it is least useful. "Quiet this down on this one busy
 * site" is what a scope override is FOR, and the thing being quietened is
 * almost always one kind of notification rather than the six around it.
 *
 * Tri-state throughout, unlike the account card's plain switches, because a
 * scope inherits: `undefined` is Inherit and is the only way to say "I have
 * not answered", which is what every row starts as and what a person needs to
 * get back to. A type row that says Inherit follows its own category at THIS
 * scope, and that category, if it also says Inherit, follows the scope above.
 *
 * The types stay folded until asked for. That is what keeps ~30 rows per
 * scope usable, and it is the same gesture the account card uses.
 */
export function NotificationScopeTable(props: NotificationScopeTableProps) {
  const {
    categories,
    scopeLabel,
    channels,
    categoryPref,
    typePref,
    onCategoryChange,
    onTypeChange,
  } = props
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (category: string) =>
    setExpanded((previous) => {
      const next = new Set(previous)
      if (!next.delete(category)) next.add(category)
      return next
    })

  const group = (
    label: string,
    channel: { key: NotificationChannel; label: string },
    value: boolean | undefined,
    onChange: (next: boolean | undefined) => void,
    disabled?: boolean,
  ) => (
    <ToggleButtonGroup
      exclusive
      size="small"
      disabled={disabled}
      value={asValue(value)}
      onChange={(_event, next) => {
        // `null` is the group refusing to deselect — a re-click on the
        // active button, which must change nothing.
        if (next === null) return
        onChange(next === 'inherit' ? undefined : next === 'true')
      }}
      aria-label={`${label} — ${channel.label}`}
    >
      <ToggleButton value="inherit">{'Inherit'}</ToggleButton>
      <ToggleButton value="true">{'On'}</ToggleButton>
      <ToggleButton value="false">{'Off'}</ToggleButton>
    </ToggleButtonGroup>
  )

  return (
    <ScrollTable size="small">
      <TableHead>
        <TableRow>
          <TableCell>{'Category'}</TableCell>
          {channels.map((channel) => (
            <TableCell key={channel.key} align="center">
              {channel.label}
            </TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {categories.map(([category, label]) => {
          const open = expanded.has(category)
          return [
            <TableRow key={category}>
              <TableCell>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                  <IconButton
                    size="small"
                    onClick={() => toggle(category)}
                    aria-expanded={open}
                    aria-label={
                      open
                        ? `Hide what ${label} covers for ${scopeLabel}`
                        : `Show what ${label} covers for ${scopeLabel}`
                    }
                  >
                    {open ? (
                      <ExpandLessIcon fontSize="small" />
                    ) : (
                      <ExpandMoreIcon fontSize="small" />
                    )}
                  </IconButton>
                  <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                    <Typography variant="body2">{label}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {NOTIFICATION_CATEGORY_DESCRIPTIONS[category]}
                    </Typography>
                  </Stack>
                </Stack>
              </TableCell>
              {channels.map((channel) => (
                <TableCell key={channel.key} align="center">
                  {group(label, channel, categoryPref(category, channel.key), (next) =>
                    onCategoryChange(category, channel.key, next),
                  )}
                </TableCell>
              ))}
            </TableRow>,
            ...(open
              ? notificationTypesInCategory(category).map((type) => {
                  const name = typeLabel(type)
                  // A digest sends its own mail under its own switch, so an
                  // email control here could never fire — the same refusal
                  // the account card makes, for the same reason.
                  const selfSent = NOTIFICATION_SELF_SENT_EMAIL_TYPES.has(type)
                  return (
                    <TableRow key={`${category}:${type}`}>
                      <TableCell>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ pl: 5 }}
                        >
                          {name}
                        </Typography>
                      </TableCell>
                      {channels.map((channel) => {
                        const disabled = selfSent && channel.key === 'email'
                        const control = group(
                          name,
                          channel,
                          typePref(type, channel.key),
                          (next) => onTypeChange(type, channel.key, next),
                          disabled,
                        )
                        return (
                          <TableCell key={channel.key} align="center">
                            {disabled ? (
                              <Tooltip title="This digest sends its own email, under its switch in Digests.">
                                <span>{control}</span>
                              </Tooltip>
                            ) : (
                              control
                            )}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  )
                })
              : []),
          ]
        })}
      </TableBody>
    </ScrollTable>
  )
}
NotificationScopeTable.displayName = 'NotificationScopeTable'

export default NotificationScopeTable
