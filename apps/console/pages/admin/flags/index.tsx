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

import type { ReleaseFlagKey, ReleaseFlagValue } from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_FLAG } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { NextPageTitle, NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import AuthenticatedLayout from '../../../components/layouts/authenticated.layout'
import DashboardLayout from '../../../components/layouts/dashboard.layout'
import MainLayout from '../../../components/layouts/main.layout'
import adminNavTabItems from '../../../constants/admin-nav-tabs'
import { buildRoute, Route } from '../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../constants/shared'

interface FlagRow {
  key: ReleaseFlagKey
  label: string
  description: string
  value: ReleaseFlagValue
  published: boolean
}

/**
 * Staff release-flag editor (AGL-230): every registered flag with its live
 * Remote Config value — enable toggle, percentage-rollout slider and a
 * staff note, published per flag with etag concurrency. Reads are open to
 * all staff; edits require the super role (enforced server-side too).
 */
const AdminFlags: NextPageWithLayout = () => {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [isStaff, setIsStaff] = useState<boolean | null>(null)
  const [rows, setRows] = useState<FlagRow[]>([])
  const [etag, setEtag] = useState<string | null>(null)
  const [role, setRole] = useState<string>('support')
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const canEdit = role === 'super'

  useEffect(() => {
    let active = true
    void (user as any)
      ?.getIdTokenResult?.()
      .then((result: any) => {
        if (active) setIsStaff(Boolean(result?.claims?.staff))
      })
      .catch(() => {
        if (active) setIsStaff(false)
      })
    return () => {
      active = false
    }
  }, [user])

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

  return (
    <>
      <NextPageTitle screen={'Feature flags – Staff'} />
      <DashboardLayout
        navTabItems={adminNavTabItems()}
        activeTab={buildRoute(Route.ADMIN_FLAGS)}
        breadcrumbItems={[
          { children: 'Staff', href: buildRoute(Route.ADMIN_TENANTS) },
          { children: 'Feature flags', href: buildRoute(Route.ADMIN_FLAGS) },
        ]}
        header={{
          children: 'Feature Flags',
          icon: { path: ICON_VARIANT_SYMBOL_FLAG },
        }}
      >
        <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
          {isStaff === null ? null : !isStaff ? (
            <Alert severity="error">
              {'This area requires the staff role.'}
            </Alert>
          ) : (
            <Stack spacing={2}>
              <Alert severity="warning">
                {
                  'Release flags are global: publishing a change affects every customer immediately (clients refresh within an hour). Staff always see every feature.'
                }
                {canEdit
                  ? ''
                  : ' Your staff role is read-only here — editing requires the super role.'}
              </Alert>
              <CardDisplay
                header={'Release flags'}
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
          )}
        </Container>
      </DashboardLayout>
    </>
  )
}
AdminFlags.displayName = 'Page:AdminFlags'
AdminFlags.layouts = [
  { Component: AuthenticatedLayout },
  { Component: MainLayout, props: { title: 'Feature flags – Staff' } },
]

export default AdminFlags
