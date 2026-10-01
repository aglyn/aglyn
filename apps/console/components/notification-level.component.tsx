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
  NOTIFICATION_LEVEL_LABELS,
  NOTIFICATION_TYPE_LABELS,
  notificationLevel,
  type NotificationLevel,
} from '@aglyn/aglyn/app-utils/notifications'
import { paletteTokenToAlphaCssVar } from '@aglyn/shared-data-enums'
import {
  mdiAlert,
  mdiAlertOctagon,
  mdiBellOutline,
  mdiCheckCircle,
  mdiInformation,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { Chip, type Theme } from '@mui/material'

/**
 * NOTIFICATION LEVELS, DRAWN (AGL-3437).
 *
 * One vocabulary for the bell and the notifications page, so a fraud signal
 * is the same red in both and a recovery the same green. Every color is a
 * palette token, so a dark console and a white-labelled one follow it.
 *
 * - `critical` is LOUD: a red icon, a solid red chip, a red bar and a red
 *   wash over the row. Fraud and stopped work must not read like routine.
 * - `warning` is a SOFT amber: the same bar and icon, a lighter wash, and a
 *   tinted chip rather than a solid one.
 * - `success` is satisfying without being loud: green icon, bar and chip,
 *   and the faintest wash.
 * - `info` is a blue icon and chip, with no bar or wash, so the feed stays calm.
 * - `neutral` is the grey the feed always had.
 */

/** A palette color a level is drawn in. */
export type NotificationLevelColor = 'error' | 'warning' | 'success' | 'info'

/** Each level's palette color; `neutral` keeps the default grey. */
export const NOTIFICATION_LEVEL_COLORS: Record<
  NotificationLevel,
  NotificationLevelColor | null
> = {
  critical: 'error',
  warning: 'warning',
  success: 'success',
  info: 'info',
  neutral: null,
}

const LEVEL_ICON_PATHS: Record<NotificationLevel, string> = {
  critical: mdiAlertOctagon.path,
  warning: mdiAlert.path,
  success: mdiCheckCircle.path,
  info: mdiInformation.path,
  neutral: mdiBellOutline.path,
}

/**
 * How strongly a row is washed in its color. A wash only where the reader
 * must notice before reading: `info` and `neutral` stay unwashed, so a feed of
 * ordinary notices does not turn into a wall of color.
 */
const ROW_WASH: Record<NotificationLevel, number> = {
  critical: 0.1,
  warning: 0.07,
  success: 0.04,
  info: 0,
  neutral: 0,
}

/** Whether a level draws the colored bar down a row's leading edge. */
const ROW_BAR: Record<NotificationLevel, boolean> = {
  critical: true,
  warning: true,
  success: true,
  info: false,
  neutral: false,
}

/** The palette token at `alpha`, as a `var()` that follows the theme. */
const wash = (theme: Theme, color: NotificationLevelColor, alpha: number) =>
  paletteTokenToAlphaCssVar(`${color}.main`, alpha, theme.palette[color].main)

/**
 * The background, bar and hover a row at `level` is drawn with, or an empty
 * style for a level that draws none.
 */
export function notificationLevelRowStyle(
  theme: Theme,
  level: NotificationLevel,
): Record<string, unknown> {
  const color = NOTIFICATION_LEVEL_COLORS[level]
  if (!color) return {}
  const palette = (theme.vars ?? theme).palette[color]
  const amount = ROW_WASH[level]
  return {
    ...(ROW_BAR[level] ? { boxShadow: `inset 3px 0 0 ${palette.main}` } : {}),
    ...(amount > 0
      ? {
          backgroundColor: wash(theme, color, amount),
          '&:hover': { backgroundColor: wash(theme, color, amount + 0.05) },
        }
      : {}),
  }
}

/** The class a notifications grid row carries for its level. */
export const notificationLevelRowClass = (level: NotificationLevel): string =>
  `notification-level-${level}`

/** The `sx` that paints every level's row class inside a data grid. */
export const notificationLevelGridSx = (
  theme: Theme,
): Record<string, Record<string, unknown>> =>
  Object.fromEntries(
    (Object.keys(NOTIFICATION_LEVEL_COLORS) as NotificationLevel[]).map(
      (level) => [
        `& .MuiDataGrid-row.${notificationLevelRowClass(level)}`,
        notificationLevelRowStyle(theme, level),
      ],
    ),
  )

export interface NotificationLevelIconProps {
  level: NotificationLevel
  /** Spacing the caller places the icon with (`mt`, `ml`, …). */
  sx?: Record<string, number | string>
}

/**
 * The level's icon in its color. Named for assistive technology by the level,
 * because the color alone says nothing to a screen reader.
 */
export function NotificationLevelIcon(props: NotificationLevelIconProps) {
  const { level, sx } = props
  const color = NOTIFICATION_LEVEL_COLORS[level]
  return (
    <MdiIcon
      path={LEVEL_ICON_PATHS[level]}
      titleAccess={NOTIFICATION_LEVEL_LABELS[level]}
      sx={{
        fontSize: 20,
        flexShrink: 0,
        color: color ? `${color}.main` : 'text.disabled',
        ...sx,
      }}
    />
  )
}
NotificationLevelIcon.displayName = 'NotificationLevelIcon'

/**
 * Text in a level's color, a shade darker on a light console and lighter on
 * a dark one, so a caption stays legible over the row's wash. Empty for
 * `neutral`, which keeps the text color it was given.
 */
export const notificationLevelTextSx =
  (level: NotificationLevel) =>
  (theme: Theme) => {
    const color = NOTIFICATION_LEVEL_COLORS[level]
    if (!color) return {}
    return {
      color: `${color}.dark`,
      ...theme.applyStyles('dark', { color: `${color}.light` }),
    }
  }

/** The label a notification's type reads as, or the stored type itself. */
export const notificationTypeLabel = (type: string | undefined): string =>
  (NOTIFICATION_TYPE_LABELS as Record<string, string>)[type ?? ''] ?? type ?? ''

export interface NotificationTypeChipProps {
  notification: { type?: string; level?: unknown }
}

/**
 * The notification's type as a chip in its level's color: solid for
 * `critical`, tinted for the rest, the default grey for `neutral`.
 */
export function NotificationTypeChip(props: NotificationTypeChipProps) {
  const { notification } = props
  const level = notificationLevel(notification)
  const color = NOTIFICATION_LEVEL_COLORS[level]
  const label = notificationTypeLabel(notification.type)
  if (!color) return <Chip size="small" label={label} />
  if (level === 'critical') {
    return <Chip size="small" color={color} label={label} />
  }
  return (
    <Chip
      size="small"
      label={label}
      sx={[
        (theme) => ({ backgroundColor: wash(theme, color, 0.16) }),
        notificationLevelTextSx(level),
      ]}
    />
  )
}
NotificationTypeChip.displayName = 'NotificationTypeChip'
