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

import {
  Box,
  Chip,
  Divider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useId, type ReactNode } from 'react'

/**
 * A grouped, searchable list of permissions with three states each (AGL-4047):
 * inherit (the layer below decides), allow, or deny. Drawn by every editor of
 * a permission map — a custom role, one member's overrides, one collaborator's
 * per-site toggles — so they look and behave alike.
 *
 * Presentation only: the caller decides which keys are offered, how they are
 * grouped, what a search keeps and what "inherit" resolves to, and hands the
 * words in. NOT in the `@aglyn/shared-ui-jsx` barrel; subpath-import it
 * (`@aglyn/shared-ui-jsx/components/permission-choice-list.component`).
 */

export type PermissionChoiceValue = 'inherit' | 'grant' | 'deny'

export interface PermissionChoiceItem {
  key: string
  label: string
  description?: string
  choice: PermissionChoiceValue
  /**
   * The verdict the member ends up with and where it came from
   * ("Allowed by the Editor role"), shown under the description.
   */
  effective?: { granted: boolean; source: string }
  /** What inherit resolves to here, when there is one answer ("Editor default: allowed"). */
  inheritHint?: string
  /** A reason the row cannot change, shown as the toggle's tooltip. */
  lockedReason?: string
}

export interface PermissionChoiceSection {
  id: string
  label: string
  items: PermissionChoiceItem[]
}

export interface PermissionChoiceListProps {
  sections: readonly PermissionChoiceSection[]
  /** Sets one key (or, from a group heading, every key of the group) to a choice. */
  onChange: (keys: string[], choice: PermissionChoiceValue) => void
  /** The search box; absent hides it. */
  search?: string
  onSearchChange?: (value: string) => void
  disabled?: boolean
  /** The words for the three states. */
  labels?: Partial<Record<PermissionChoiceValue, string>>
  /** Shown when a search keeps nothing. */
  emptyMessage?: ReactNode
  /** Offer "set the whole group" on each heading. */
  groupActions?: boolean
}

const CHOICES: readonly PermissionChoiceValue[] = ['inherit', 'grant', 'deny']

const DEFAULT_LABELS: Record<PermissionChoiceValue, string> = {
  inherit: 'Inherit',
  grant: 'Allow',
  deny: 'Deny',
}

function ChoiceToggle(props: {
  value: PermissionChoiceValue | null
  onChange: (choice: PermissionChoiceValue) => void
  disabled?: boolean
  labels: Record<PermissionChoiceValue, string>
  ariaLabel: string
}) {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={props.value}
      disabled={props.disabled}
      aria-label={props.ariaLabel}
      onChange={(_event, next: PermissionChoiceValue | null) => {
        if (next) props.onChange(next)
      }}
      sx={{ flexShrink: 0 }}
    >
      {CHOICES.map((choice) => (
        <ToggleButton
          key={choice}
          value={choice}
          color={choice === 'grant' ? 'success' : choice === 'deny' ? 'error' : 'standard'}
          sx={{ px: 1.25, py: 0.25, textTransform: 'none' }}
        >
          {props.labels[choice]}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  )
}

export function PermissionChoiceList(props: PermissionChoiceListProps) {
  const labels = { ...DEFAULT_LABELS, ...props.labels }
  const searchId = useId()
  const visible = props.sections.filter((section) => section.items.length > 0)
  return (
    <Stack spacing={2}>
      {props.onSearchChange ? (
        <TextField
          id={searchId}
          size="small"
          type="search"
          label="Search permissions"
          value={props.search ?? ''}
          onChange={(event) => props.onSearchChange?.(event.target.value)}
        />
      ) : null}
      {visible.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {props.emptyMessage ?? 'No permission matches your search.'}
        </Typography>
      ) : null}
      {visible.map((section) => {
        const granted = section.items.filter((item) => item.choice === 'grant').length
        const denied = section.items.filter((item) => item.choice === 'deny').length
        const shared = section.items.every((item) => item.choice === section.items[0]?.choice)
          ? (section.items[0]?.choice ?? null)
          : null
        const changeable = section.items.filter((item) => !item.lockedReason).map((item) => item.key)
        return (
          <Box key={section.id} component="section" aria-label={section.label}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between', mb: 1 }}
            >
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
                <Typography variant="subtitle2" component="h3">
                  {section.label}
                </Typography>
                {granted ? <Chip size="small" color="success" variant="outlined" label={`${granted} allowed`} /> : null}
                {denied ? <Chip size="small" color="error" variant="outlined" label={`${denied} denied`} /> : null}
              </Stack>
              {props.groupActions && changeable.length > 1 ? (
                <ChoiceToggle
                  value={shared}
                  labels={labels}
                  disabled={props.disabled}
                  ariaLabel={`Set every ${section.label} permission`}
                  onChange={(choice) => props.onChange(changeable, choice)}
                />
              ) : null}
            </Stack>
            <Stack divider={<Divider flexItem />} sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
              {section.items.map((item) => {
                const toggle = (
                  <span>
                    <ChoiceToggle
                      value={item.choice}
                      labels={labels}
                      disabled={props.disabled || Boolean(item.lockedReason)}
                      ariaLabel={item.label}
                      onChange={(choice) => props.onChange([item.key], choice)}
                    />
                  </span>
                )
                return (
                  <Stack
                    key={item.key}
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1.5}
                    sx={{ px: 1.5, py: 1, alignItems: { xs: 'stretch', sm: 'center' }, justifyContent: 'space-between' }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2">{item.label}</Typography>
                      {item.description ? (
                        <Typography variant="caption" color="text.secondary" component="p">
                          {item.description}
                        </Typography>
                      ) : null}
                      {item.effective ? (
                        <Typography
                          variant="caption"
                          component="p"
                          color={item.effective.granted ? 'success.main' : 'text.secondary'}
                        >
                          {`${item.effective.granted ? 'Allowed' : 'Not allowed'} · ${item.effective.source}`}
                        </Typography>
                      ) : null}
                      {item.choice === 'inherit' && item.inheritHint ? (
                        <Typography variant="caption" color="text.secondary" component="p">
                          {item.inheritHint}
                        </Typography>
                      ) : null}
                    </Box>
                    {item.lockedReason ? <Tooltip title={item.lockedReason}>{toggle}</Tooltip> : toggle}
                  </Stack>
                )
              })}
            </Stack>
          </Box>
        )
      })}
    </Stack>
  )
}
PermissionChoiceList.displayName = 'PermissionChoiceList'

export default PermissionChoiceList
