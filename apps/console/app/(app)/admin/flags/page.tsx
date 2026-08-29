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
  PLAN_LABELS,
  pluginForReleaseFlag,
  RELEASE_FLAG_PLAN_LADDER,
  releaseFlagPlansAtOrAbove,
  type OrgPlan,
  type ReleaseFlagKey,
  type ReleaseFlagValue,
} from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_FLAG } from '@aglyn/shared-data-enums'
import { CardDisplay, Container, HelpTip } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  ListItemText,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../../components/layouts/authenticated.layout'
import StaffOnly from '../../../../components/staff-only.component'
import { useIsStaff } from '../../../../hooks/use-is-staff'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MainLayout from '../../../../components/layouts/main.layout'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'

interface FlagRow {
  key: ReleaseFlagKey
  label: string
  description: string
  value: ReleaseFlagValue
  published: boolean
}

/**
 * How an unrestricted flag reads, everywhere on this page (AGL-2486).
 *
 * No tier list means EVERY tier — the same reading the evaluator takes, and
 * the one an operator has to be able to see without inferring it from an
 * empty control. A blank multi-select that silently meant "nobody" is the
 * inversion this label exists to make impossible to ship.
 */
const ALL_TIERS_LABEL = 'All tiers'

const tiersOf = (value: ReleaseFlagValue): OrgPlan[] => value.plans ?? []

/** "Pro, Business, Scale…" or the every-tier label. */
const describeTiers = (plans: OrgPlan[]): string =>
  plans.length === 0
    ? ALL_TIERS_LABEL
    : plans.map((plan) => PLAN_LABELS[plan]).join(', ')

/**
 * Staff release-flag editor (AGL-230): every registered flag with its live
 * Remote Config value — enable toggle, percentage-rollout slider and a
 * staff note, published per flag with etag concurrency. Reads are open to
 * all staff; edits require the super role (enforced server-side too).
 */
const AdminFlags: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const isStaff = useIsStaff()
  const [rows, setRows] = useState<FlagRow[]>([])
  const [etag, setEtag] = useState<string | null>(null)
  const [role, setRole] = useState<string>('support')
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const canEdit = role === 'super'

  const refresh = useCallback(async () => {
    const idToken = await (user as any)?.getIdToken?.()
    if (!idToken) return
    setLoading(true)
    try {
      const response = await fetch('/api/admin/flags', {
        headers: { Authorization: `Bearer ${idToken}` },
      })
      if (!response.ok) throw new Error(`Load failed (${response.status})`)
      const payload = await response.json()
      setRows(payload.flags ?? [])
      setEtag(payload.etag ?? null)
      setRole(payload.role ?? 'support')
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Loading feature flags failed', { variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [user, enqueueSnackbar])

  useEffect(() => {
    if (isStaff) void refresh()
  }, [isStaff, refresh])

  const updateRow = (key: ReleaseFlagKey, patch: Partial<ReleaseFlagValue>) => {
    setRows((previous) =>
      previous.map((row) =>
        row.key === key ? { ...row, value: { ...row.value, ...patch } } : row,
      ),
    )
  }

  const save = async (row: FlagRow) => {
    const idToken = await (user as any)?.getIdToken?.()
    if (!idToken) return
    setSavingKey(row.key)
    try {
      const response = await fetch('/api/admin/flags', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: row.key,
          enabled: row.value.enabled,
          rolloutPercent: row.value.rolloutPercent ?? 0,
          // Always sent, even empty (AGL-2486). The route only touches
          // targeting for a caller that sends the key, so omitting it here
          // when nothing is selected would make "clear the tier list" the one
          // edit this page could not perform.
          plans: tiersOf(row.value),
          note: row.value.note ?? '',
          etag,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (response.status === 409) {
        enqueueSnackbar(
          'Flags changed in another session — reloaded the latest values',
          { variant: 'warning' },
        )
        await refresh()
        return
      }
      if (!response.ok) {
        throw new Error(payload.error ?? `Save failed (${response.status})`)
      }
      setEtag(payload.etag ?? null)
      enqueueSnackbar(`Published ${row.label}`, { variant: 'success' })
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Saving the flag failed', {
        variant: 'error',
      })
    } finally {
      setSavingKey(null)
    }
  }

  const statusChip = (row: FlagRow) => {
    if (row.value.enabled) {
      return <Chip label="On" color="success" size="small" />
    }
    if ((row.value.rolloutPercent ?? 0) > 0) {
      return (
        <Chip
          label={`${row.value.rolloutPercent}% rollout`}
          color="warning"
          size="small"
        />
      )
    }
    return <Chip label="Off" size="small" />
  }

  /**
   * The tier restriction, beside the on/rollout chip (AGL-2486).
   *
   * Rendered for a targeted flag whether it is fully ON or mid-rollout,
   * because the filter binds both — an "On" chip alone would read as "every
   * customer has this" for a flag only Enterprise can see.
   */
  const tierChip = (row: FlagRow) => {
    const plans = tiersOf(row.value)
    if (plans.length === 0) return null
    return (
      <Chip
        label={`Tiers: ${describeTiers(plans)}`}
        size="small"
        color="info"
        variant="outlined"
      />
    )
  }

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Feature flags', href: buildRoute(Route.ADMIN_FLAGS) },
      ]}
      help="featureFlags"
      header={{
        children: 'Feature Flags',
        icon: { path: ICON_VARIANT_SYMBOL_FLAG.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={2}>
            <Alert severity="warning">
              {
                'Release flags are global: publishing a change affects every customer immediately (clients refresh within an hour). Staff always see every feature.'
              }
              {canEdit
                ? ''
                : ' Your staff role is read-only here — editing requires the super role.'}
              <HelpTip
                {...docsHelp('featureFlags', { anchor: '#how-gating-behaves' })}
                sx={{ fontSize: '0.8em', my: -0.5 }}
              />
            </Alert>
            <CardDisplay
              header={'Release flags'}
              help={docsHelp('featureFlags', {
                anchor: '#managing-flags',
                excerpt:
                  'Toggle a flag or stage a percentage rollout, leave a note, and publish — customers pick up changes within an hour. Editing requires the super staff role.',
              })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={3}>
                {loading && rows.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {'Loading flags…'}
                  </Typography>
                ) : (
                  rows.map((row) => (
                    <Stack
                      key={row.key}
                      spacing={1}
                      sx={{
                        borderBottom: 1,
                        borderColor: 'divider',
                        pb: 2,
                        '&:last-of-type': { borderBottom: 0, pb: 0 },
                      }}
                    >
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Typography variant="subtitle2">
                          {row.label}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: 'monospace' }}
                          color="text.secondary"
                        >
                          {row.key}
                        </Typography>
                        {statusChip(row)}
                        {tierChip(row)}
                        {/* AGL-422: flags mapped to a first-party plugin
                            gate its whole LOADER (console, sites, API),
                            not just nav — surface that blast radius. */}
                        {pluginForReleaseFlag(row.key) ? (
                          <Chip
                            label={`Gates plugin: ${pluginForReleaseFlag(row.key)?.label}`}
                            size="small"
                            variant="outlined"
                            color="warning"
                          />
                        ) : null}
                        {row.published ? null : (
                          <Chip
                            label="Not in template (code default)"
                            size="small"
                            variant="outlined"
                          />
                        )}
                        <Switch
                          checked={row.value.enabled}
                          disabled={!canEdit}
                          onChange={(event) =>
                            updateRow(row.key, {
                              enabled: event.target.checked,
                            })
                          }
                          sx={{ ml: 'auto' }}
                          slotProps={{
                            input: { 'aria-label': `${row.label} enabled` },
                          }}
                        />
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {row.description}
                      </Typography>
                      {row.value.enabled ? null : (
                        <Stack
                          direction="row"
                          spacing={2}
                          sx={{ alignItems: 'center', maxWidth: 480 }}
                        >
                          <Typography variant="caption" sx={{ width: 120 }}>
                            {`Rollout: ${row.value.rolloutPercent ?? 0}%`}
                          </Typography>
                          <Slider
                            size="small"
                            value={row.value.rolloutPercent ?? 0}
                            disabled={!canEdit}
                            min={0}
                            max={100}
                            step={5}
                            onChange={(_event, percent) =>
                              updateRow(row.key, {
                                rolloutPercent: percent as number,
                              })
                            }
                            aria-label={`${row.label} rollout percent`}
                          />
                        </Stack>
                      )}
                      {/* Tier targeting (AGL-2486). Shown for an ON flag too:
                          the tier filter gates the fully-enabled path as well
                          as the rollout, so hiding it behind the percentage
                          would make "launch to Enterprise and Agency" — the
                          thing actually asked for — unreachable. */}
                      <Stack
                        direction="row"
                        spacing={2}
                        sx={{ alignItems: 'center', maxWidth: 480 }}
                      >
                        <Typography variant="caption" sx={{ width: 120 }}>
                          {'Tiers'}
                        </Typography>
                        <Select
                          multiple
                          size="small"
                          displayEmpty
                          disabled={!canEdit}
                          value={tiersOf(row.value)}
                          onChange={(event) =>
                            updateRow(row.key, {
                              plans: (typeof event.target.value === 'string'
                                ? []
                                : event.target.value) as OrgPlan[],
                            })
                          }
                          renderValue={(selected) =>
                            describeTiers(selected as OrgPlan[])
                          }
                          inputProps={{
                            'aria-label': `${row.label} tiers`,
                          }}
                          sx={{ flexGrow: 1 }}
                        >
                          {RELEASE_FLAG_PLAN_LADDER.map((plan) => (
                            <MenuItem key={plan} value={plan}>
                              <Checkbox
                                size="small"
                                checked={tiersOf(row.value).includes(plan)}
                              />
                              <ListItemText primary={PLAN_LABELS[plan]} />
                            </MenuItem>
                          ))}
                        </Select>
                        {/* Fills in every tier above the cheapest one already
                            picked — "Pro" becomes "Pro and above" in a click.
                            It expands to an EXPLICIT list rather than storing
                            a threshold, so inserting a tier into the middle of
                            the ladder later (pricing v3 did exactly that) can
                            never re-aim a flag that is already live. */}
                        <Button
                          size="small"
                          disabled={
                            !canEdit || tiersOf(row.value).length === 0
                          }
                          onClick={() =>
                            updateRow(row.key, {
                              plans: releaseFlagPlansAtOrAbove(
                                tiersOf(row.value)[0],
                              ),
                            })
                          }
                        >
                          {'and above'}
                        </Button>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {tiersOf(row.value).length === 0
                          ? 'Every tier. Pick tiers to restrict who this flag can reach.'
                          : `Only ${describeTiers(tiersOf(row.value))}. ` +
                            (row.value.enabled
                              ? 'Every workspace on those tiers.'
                              : `The ${row.value.rolloutPercent ?? 0}% rollout is drawn from those tiers — ` +
                                'the bucket is the org id, so changing this list never reshuffles who already has it.') +
                            ' A per-org override on /admin/orgs still wins over this.'}
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center' }}
                      >
                        <TextField
                          size="small"
                          label="Note"
                          value={row.value.note ?? ''}
                          disabled={!canEdit}
                          onChange={(event) =>
                            updateRow(row.key, { note: event.target.value })
                          }
                          sx={{ flexGrow: 1, maxWidth: 480 }}
                        />
                        <Button
                          size="small"
                          variant="contained"
                          disabled={!canEdit || savingKey === row.key}
                          onClick={() => void save(row)}
                        >
                          {savingKey === row.key ? 'Publishing…' : 'Publish'}
                        </Button>
                      </Stack>
                    </Stack>
                  ))
                )}
              </Stack>
            </CardDisplay>
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminFlags.displayName = 'Page:AdminFlags'

export default AdminFlags
