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

import { useCallback, useEffect, useState } from 'react'
import {
  Checkbox,
  Chip,
  FormControlLabel,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  Typography,
  type SelectChangeEvent,
} from '@mui/material'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  readUsageLevel,
  USAGE_LEVEL_COLORS,
  USAGE_LEVEL_DESCRIPTIONS,
  USAGE_LEVEL_LABELS,
  USAGE_LEVELS,
  type UsageLevel,
  type UsageLevelTarget,
} from '@aglyn/aglyn/app-utils/usage-level'

/*
 * THE STAFF USAGE LEVEL, ON SCREEN (AGL-4228).
 *
 * How much an account, a workspace or a site actually uses the platform, as
 * staff judged it (`@aglyn/aglyn/app-utils/usage-level`). The staff lists
 * show and set it in their Usage level column, so a reviewer can go down a
 * list and categorize as they go; the detail pages carry the card, with the
 * meaning of each level and the carry to the workspace and its owner.
 * Every change goes through `/api/admin/usage-level`, which audits it.
 */

/**
 * A stored time as epoch milliseconds: a Firestore `Timestamp` read live, the
 * `{ seconds }` a staff route serializes, or a number. Null for anything else.
 */
export function timestampMs(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis()
  }
  const seconds = (value as { seconds?: unknown } | null)?.seconds
  return typeof seconds === 'number' ? seconds * 1000 : null
}

/** Which carries a change may ask for: see the route. */
export type UsageLevelCarry = 'org' | 'owner'

/** The level as a chip, in its color. */
export function UsageLevelChip({ level }: { level: unknown }) {
  const value = readUsageLevel(level)
  return (
    <Chip
      size="small"
      label={USAGE_LEVEL_LABELS[value]}
      color={USAGE_LEVEL_COLORS[value]}
      variant={value === 'unreviewed' ? 'outlined' : 'filled'}
      title={USAGE_LEVEL_DESCRIPTIONS[value]}
    />
  )
}

/** POSTs one change; resolves to whether it took. */
function useSetUsageLevel() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  return useCallback(
    async (
      target: UsageLevelTarget,
      id: string,
      level: UsageLevel,
      also: readonly UsageLevelCarry[] = [],
    ): Promise<boolean> => {
      try {
        const response = await authorizedFetch(user, '/api/admin/usage-level', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target, id, level, also }),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error ?? 'Usage level failed')
        const carried = Array.isArray(payload?.set) ? payload.set.length - 1 : 0
        enqueueSnackbar(
          `Usage level set to ${USAGE_LEVEL_LABELS[level]}` +
            (carried > 0 ? ` (and ${carried} more)` : ''),
          { variant: 'success' },
        )
        return true
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Could not set the usage level', { variant: 'error' })
        return false
      }
    },
    [user, enqueueSnackbar],
  )
}

export interface StaffUsageLevelSelectProps {
  target: UsageLevelTarget
  id: string
  level: unknown
  /** Carries the change asks for, if any. */
  also?: readonly UsageLevelCarry[]
  /** Called with the new level once it is saved. */
  onChanged?: (level: UsageLevel) => void
}

/**
 * The level as a compact select, for a list row: the chip is the value, and
 * picking another saves it. Clicks stay inside the cell so the row's own
 * click (open the detail page) does not fire.
 */
export function StaffUsageLevelSelect({
  target,
  id,
  level,
  also,
  onChanged,
}: StaffUsageLevelSelectProps) {
  const setUsageLevel = useSetUsageLevel()
  const [value, setValue] = useState<UsageLevel>(readUsageLevel(level))
  const [saving, setSaving] = useState(false)
  useEffect(() => setValue(readUsageLevel(level)), [level])
  const handleChange = useCallback(
    async (event: SelectChangeEvent<UsageLevel>) => {
      const next = event.target.value as UsageLevel
      if (next === value) return
      const previous = value
      setValue(next)
      setSaving(true)
      const ok = await setUsageLevel(target, id, next, also)
      setSaving(false)
      if (ok) onChanged?.(next)
      else setValue(previous)
    },
    [value, setUsageLevel, target, id, also, onChanged],
  )
  return (
    <Select<UsageLevel>
      size="small"
      variant="standard"
      disableUnderline
      value={value}
      disabled={saving}
      onChange={handleChange}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      renderValue={(selected) => <UsageLevelChip level={selected} />}
      inputProps={{ 'aria-label': 'Usage level' }}
      sx={{ '& .MuiSelect-select': { display: 'flex', alignItems: 'center', py: 0 } }}
    >
      {USAGE_LEVELS.map((option) => (
        <MenuItem key={option} value={option}>
          <ListItemText
            primary={USAGE_LEVEL_LABELS[option]}
            secondary={USAGE_LEVEL_DESCRIPTIONS[option]}
          />
        </MenuItem>
      ))}
    </Select>
  )
}

export interface StaffUsageLevelFieldProps {
  target: UsageLevelTarget
  id: string
  level: unknown
  /** When it was last set, if ever (milliseconds). */
  setAtMs?: number | null
  /** The carries this page offers as checkboxes. */
  carries?: readonly UsageLevelCarry[]
  onChanged?: (level: UsageLevel) => void
}

const CARRY_LABELS: Readonly<Record<UsageLevelCarry, string>> = {
  org: 'Also set its workspace',
  owner: 'Also set the workspace owner',
}

/**
 * The level for a detail page: the select with every level's meaning, when
 * it was last set, and the carries as checkboxes (on by default — a site
 * someone runs their business on says the same of its workspace and its
 * owner; the route never lowers a higher level by a carry).
 */
export function StaffUsageLevelField({
  target,
  id,
  level,
  setAtMs,
  carries = [],
  onChanged,
}: StaffUsageLevelFieldProps) {
  const [also, setAlso] = useState<UsageLevelCarry[]>([...carries])
  const value = readUsageLevel(level)
  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <StaffUsageLevelSelect
          target={target}
          id={id}
          level={value}
          also={also}
          onChanged={onChanged}
        />
        <Typography variant="body2" color="text.secondary">
          {USAGE_LEVEL_DESCRIPTIONS[value]}
        </Typography>
      </Stack>
      {setAtMs ? (
        <Typography variant="caption" color="text.secondary">
          {`Last set ${new Date(setAtMs).toLocaleString()}`}
        </Typography>
      ) : null}
      {carries.length ? (
        <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
          {carries.map((carry) => (
            <FormControlLabel
              key={carry}
              control={
                <Checkbox
                  size="small"
                  checked={also.includes(carry)}
                  onChange={(event) =>
                    setAlso((current) =>
                      event.target.checked
                        ? [...current, carry]
                        : current.filter((entry) => entry !== carry),
                    )
                  }
                />
              }
              label={<Typography variant="body2">{CARRY_LABELS[carry]}</Typography>}
            />
          ))}
        </Stack>
      ) : null}
    </Stack>
  )
}

export default StaffUsageLevelSelect
