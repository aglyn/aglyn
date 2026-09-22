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
  STAFF_NOTIFICATION_CATEGORIES,
  type AglynNotificationType,
  type NotificationCategory,
  type NotificationChannel,
} from '@aglyn/aglyn'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import {
  Box,
  Button,
  Chip,
  IconButton,
  Stack,
  Switch,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import { useState } from 'react'

/** The label a notification's type reads as, or the stored type itself. */
const typeLabel = (type: string): string =>
  (NOTIFICATION_TYPE_LABELS as Record<string, string>)[type] ?? type

export interface NotificationCategoryTableProps {
  /** The categories to draw, already filtered to what this reader may set. */
  categories: Array<[NotificationCategory, string]>
  channels: Array<{ key: NotificationChannel; label: string }>
  /** The account layer's effective answer for a whole category. */
  categoryValue: (
    category: NotificationCategory,
    channel: NotificationChannel,
  ) => boolean
  /** The effective answer for one type — its own, or its category's. */
  typeValue: (type: AglynNotificationType, channel: NotificationChannel) => boolean
  /** That type's OWN answer, or undefined when it just follows its category. */
  typePref: (
    type: AglynNotificationType,
    channel: NotificationChannel,
  ) => boolean | undefined
  onCategoryChange: (
    category: NotificationCategory,
    channel: NotificationChannel,
    value: boolean,
  ) => void
  onTypeChange: (
    type: AglynNotificationType,
    channel: NotificationChannel,
    value: boolean,
  ) => void
  /**
   * Drop every answer this type carries, putting it back on its category.
   *
   * ONE callback rather than a `undefined` per channel, and that is a bug fix
   * rather than tidiness: the page rebuilds the whole settings document from
   * the state it closed over, so two clears dispatched in the same tick both
   * read the value from BEFORE either of them, and the second write puts back
   * what the first removed. Caught by the page's own test.
   */
  onTypeReset: (type: AglynNotificationType) => void
}

/**
 * WHAT YOU ARE TOLD ABOUT, and what that actually means (AGL-3251).
 *
 * This was seven bare labels and two switches. Nothing said what a category
 * covered, so silencing `Product & system` meant guessing what was in it;
 * nothing marked `Platform growth` as staff-only, though it is hidden from
 * everyone who is not; and the bucket was the only granularity there was, so
 * quietening one noisy type took its six neighbors with it.
 *
 * Three things fix that, in the order a reader meets them: a line saying what
 * arrives in the category, a badge on the staff ones, and an expander holding
 * the category's individual types with their own switches.
 *
 * ## The type rows show the EFFECTIVE answer
 *
 * A type switch is drawn from what would actually happen — its own answer if
 * it has one, otherwise its category's — because that is the question a person
 * opening this page is asking. The cost is that the switch alone cannot say
 * WHICH of the two it is reading, and a person who cannot see that they set
 * something cannot unset it. So a type carrying its own answer says `Set` and
 * offers `Follow category`, and a type that has never been touched says
 * nothing at all rather than decorating every row with its own inheritance.
 */
export function NotificationCategoryTable(props: NotificationCategoryTableProps) {
  const {
    categories,
    channels,
    categoryValue,
    typeValue,
    typePref,
    onCategoryChange,
    onTypeChange,
    onTypeReset,
  } = props
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (category: string) =>
    setExpanded((previous) => {
      const next = new Set(previous)
      if (!next.delete(category)) next.add(category)
      return next
    })

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
          const types = notificationTypesInCategory(category)
          return [
            <TableRow key={category}>
              <TableCell>
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ alignItems: 'flex-start' }}
                >
                  <IconButton
                    size="small"
                    onClick={() => toggle(category)}
                    aria-expanded={open}
                    aria-label={
                      open
                        ? `Hide what ${label} covers`
                        : `Show what ${label} covers`
                    }
                  >
                    {open ? (
                      <ExpandLessIcon fontSize="small" />
                    ) : (
                      <ExpandMoreIcon fontSize="small" />
                    )}
                  </IconButton>
                  <Stack spacing={0.25} sx={{ minWidth: 0 }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Typography variant="body2">{label}</Typography>
                      {STAFF_NOTIFICATION_CATEGORIES.has(category) ? (
                        // A staff reader otherwise has no way to tell this row
                        // from a product setting — it is already hidden from
                        // everyone else, which is exactly why it looks normal
                        // to the people who can see it.
                        <Chip size="small" variant="outlined" label="Staff only" />
                      ) : null}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {NOTIFICATION_CATEGORY_DESCRIPTIONS[category]}
                    </Typography>
                  </Stack>
                </Stack>
              </TableCell>
              {channels.map((channel) => (
                <TableCell key={channel.key} align="center">
                  <Switch
                    size="small"
                    slotProps={{
                      input: { 'aria-label': `${label} — ${channel.label}` },
                    }}
                    checked={categoryValue(category, channel.key)}
                    onChange={(event) =>
                      onCategoryChange(category, channel.key, event.target.checked)
                    }
                  />
                </TableCell>
              ))}
            </TableRow>,
            ...(open
              ? types.map((type) => {
                  const name = typeLabel(type)
                  /*
                   * A digest composes and sends its OWN email under its own
                   * switch, and the generic channel skips it
                   * (`NOTIFICATION_SELF_SENT_EMAIL_TYPES`) — so an email
                   * switch here would be a control that does nothing. Drawn
                   * disabled with the reason rather than hidden: a missing
                   * switch reads as an oversight, and the person is looking
                   * for the digest's switch, which the Digests card holds.
                   */
                  const selfSent = NOTIFICATION_SELF_SENT_EMAIL_TYPES.has(type)
                  return (
                    <TableRow key={`${category}:${type}`}>
                      <TableCell>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', flexWrap: 'wrap', pl: 5 }}
                        >
                          <Typography variant="body2" color="text.secondary">
                            {name}
                          </Typography>
                          {channels.some(
                            (channel) =>
                              typePref(type, channel.key) !== undefined,
                          ) ? (
                            <>
                              <Chip size="small" color="primary" label="Set" />
                              <Button
                                size="small"
                                onClick={() => onTypeReset(type)}
                              >
                                {'Follow category'}
                              </Button>
                            </>
                          ) : null}
                        </Stack>
                      </TableCell>
                      {channels.map((channel) => {
                        const disabled = selfSent && channel.key === 'email'
                        const control = (
                          <Switch
                            size="small"
                            disabled={disabled}
                            slotProps={{
                              input: {
                                'aria-label': `${name} — ${channel.label}`,
                              },
                            }}
                            checked={!disabled && typeValue(type, channel.key)}
                            onChange={(event) =>
                              onTypeChange(
                                type,
                                channel.key,
                                event.target.checked,
                              )
                            }
                          />
                        )
                        return (
                          <TableCell key={channel.key} align="center">
                            {disabled ? (
                              <Tooltip title="This digest sends its own email, under its switch in Digests.">
                                {/* A disabled control fires no events, so the
                                    tooltip needs an element that does. */}
                                <Box component="span">{control}</Box>
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
NotificationCategoryTable.displayName = 'NotificationCategoryTable'

export default NotificationCategoryTable
