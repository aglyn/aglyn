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

import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Button, Stack, Typography } from '@mui/material'
import { type ChangeEvent, useCallback, useRef, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { hasEntitlement } from '../constants/entitlements'
import useCurrentTenant from '../hooks/use-current-tenant'

/**
 * Site backup (AGL-163): one-click export of everything designable as a
 * JSON bundle, and restore/import into this host. The competitive angle:
 * HubSpot has no whole-site backup and reviewers cite the lock-in
 * constantly. Pro+ (`siteExport` flag).
 */
export function SiteBackupCard(props: { hostId: string }) {
  const { hostId } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { tenant } = useCurrentTenant()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const gate = useCallback(() => {
    if (hasEntitlement('site-export', tenant)) return true
    enqueueSnackbar(
      'Site backups require a Pro plan — see Billing to upgrade',
      { variant: 'warning', persist: false },
    )
    return false
  }, [tenant, enqueueSnackbar])

  const handleExport = useCallback(async () => {
    if (!gate() || busy) return
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch(
        `/api/hosts/export?hostId=${encodeURIComponent(hostId)}`,
        { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
      )
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        return void enqueueSnackbar(payload?.error ?? 'Export failed', {
          variant: 'warning',
          allowDuplicate: true,
        })
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `aglyn-${hostId}-${new Date()
        .toISOString()
        .slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      enqueueSnackbar('Backup downloaded', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [gate, busy, user, hostId, enqueueSnackbar])

  const handleImportFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file || busy) return
      const confirmed = await confirm({
        title: 'Restore this backup?',
        description:
          'Screens, layouts, theme, content, and data from the backup ' +
          'overwrite matching items on this site. Domain, members, and ' +
          'inbox are untouched.',
        confirmationText: 'Restore',
        confirmationButtonProps: { color: 'warning' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      setBusy(true)
      try {
        const bundle = JSON.parse(await file.text())
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/hosts/import', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ hostId, bundle }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'Restore failed', {
            variant: 'warning',
            allowDuplicate: true,
          })
        }
        enqueueSnackbar(`Restored ${payload.written} documents`, {
          variant: 'success',
          persist: false,
        })
      } catch (error) {
        console.error(error)
        enqueueSnackbar(
          error instanceof SyntaxError
            ? 'That file is not a valid backup'
            : 'An error has occurred',
          { variant: 'error', allowDuplicate: true },
        )
      } finally {
        setBusy(false)
      }
    },
    [busy, confirm, user, hostId, enqueueSnackbar],
  )

  return (
    <CardDisplay header={'Backup & restore'} contentGutterX contentGutterY>
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'Download everything designable — screens, layouts, theme, ' +
            'content, data, automations — as one file, and restore it ' +
            'here (or import it into another of your sites).'}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            variant="contained"
            color="secondary"
            size="small"
            disabled={busy}
            onClick={handleExport}
          >
            {busy ? 'Working…' : 'Download backup'}
          </Button>
          <Button
            size="small"
            disabled={busy}
            onClick={() => gate() && inputRef.current?.click()}
          >
            {'Restore from file'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json"
            hidden
            onChange={handleImportFile}
          />
        </Stack>
      </Stack>
    </CardDisplay>
  )
}
SiteBackupCard.displayName = 'SiteBackupCard'

export default SiteBackupCard
