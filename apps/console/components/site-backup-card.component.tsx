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
import { Alert, Button, Stack, Typography } from '@mui/material'
import { type ChangeEvent, useCallback, useRef, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { docsHelp } from '../constants/docs-links'
import { hasEntitlement } from '../constants/entitlements'
import useCurrentOrg from '../hooks/use-current-org'

/** One item of the import plan, as the route answers it. */
interface PlanItem {
  key: string
  status: 'new' | 'identical' | 'differs' | 'missingDependency'
  comparison: 'new' | 'identical' | 'differs'
  choices: string[]
}

/** The import route's plan answer, as far as this card reads it. */
interface PlanAnswer {
  plan: {
    items: PlanItem[]
    counts: Record<PlanItem['status'], number>
  }
  capRefusal: string | null
  warningsTotal: number
  unknownKinds: string[]
  notSent: string[]
}

/** A plan waiting on the person: the file it came from, and what it says. */
interface PendingImport {
  file: unknown
  fileName: string
  answer: PlanAnswer
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/**
 * Site backup (AGL-163, AGL-3533): download everything designable as one
 * site package, and import one into this site. An import is planned before
 * it is written: the card shows how many items are new, unchanged and
 * changed, and imports the new ones — or, when asked, replaces the changed
 * ones too, each as a new version where it has versions. The import can be
 * undone from here for as long as the card is open (the import route keeps
 * it undoable for seven days). Choosing item by item is the import wizard's
 * (AGL-3534). Pro+ (`siteExport` flag).
 */
export function SiteBackupCard(props: { hostId: string }) {
  const { hostId } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { org, ready: orgReady } = useCurrentOrg()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [lastImportId, setLastImportId] = useState<string | null>(null)

  const gate = useCallback(() => {
    // AGL-1380: an undefined `org` — in flight, or a failed read — checks as
    // the FREE tier, so both export and restore refused a paying Pro site
    // with an upgrade prompt during the billing window. Refuse without the
    // plan claim instead, and say why.
    if (!orgReady) {
      enqueueSnackbar('Checking your plan — try again in a moment', {
        variant: 'info',
        persist: false,
      })
      return false
    }
    if (hasEntitlement('siteExport', org)) return true
    enqueueSnackbar('Site backups require a Pro plan — see Billing to upgrade', {
      variant: 'warning',
      persist: false,
    })
    return false
  }, [org, orgReady, enqueueSnackbar])

  const failed = useCallback(
    (error: unknown) => {
      console.error(error)
      enqueueSnackbar(error instanceof SyntaxError ? 'That file is not a valid backup' : 'An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    },
    [enqueueSnackbar],
  )

  const post = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await authorizedFetch(user, '/api/hosts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, ...body }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Import failed', { variant: 'warning', allowDuplicate: true })
        return null
      }
      return payload
    },
    [user, hostId, enqueueSnackbar],
  )

  const handleExport = useCallback(async () => {
    if (!gate() || busy) return
    setBusy(true)
    try {
      const response = await authorizedFetch(user, `/api/hosts/export?hostId=${encodeURIComponent(hostId)}`)
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
      anchor.download = `aglyn-${hostId}-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      enqueueSnackbar('Backup downloaded', { variant: 'success', persist: false })
    } catch (error) {
      failed(error)
    } finally {
      setBusy(false)
    }
  }, [gate, busy, user, hostId, enqueueSnackbar, failed])

  const handleImportFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file || busy) return
      setBusy(true)
      try {
        const parsed = JSON.parse(await file.text())
        const answer = (await post({ action: 'plan', package: parsed })) as PlanAnswer | null
        if (answer) setPending({ file: parsed, fileName: file.name, answer })
      } catch (error) {
        failed(error)
      } finally {
        setBusy(false)
      }
    },
    [busy, post, failed],
  )

  /** Applies the plan: the proposed decisions, or with every changed item replaced. */
  const handleApply = useCallback(
    async (replaceChanged: boolean) => {
      if (!pending || busy) return
      if (replaceChanged) {
        const confirmed = await confirm({
          title: 'Replace the changed items?',
          description:
            'Each item that differs from this site’s copy is replaced by the ' +
            'file’s. Pages, layouts and emails keep the version they had in ' +
            'their history. You can undo the import afterwards.',
          confirmationText: 'Replace',
          confirmationButtonProps: { color: 'warning' },
        })
          .then(() => true)
          .catch(() => false)
        if (!confirmed) return
      }
      const decisions = replaceChanged
        ? Object.fromEntries(
            pending.answer.plan.items
              .filter((item) => item.comparison === 'differs' && item.choices.includes('replace'))
              .map((item) => [item.key, 'replace']),
          )
        : {}
      setBusy(true)
      try {
        const result = await post({ action: 'apply', package: pending.file, decisions })
        if (!result) return
        setPending(null)
        setLastImportId(result.importId ?? null)
        enqueueSnackbar(`Imported ${plural(result.written ?? 0, 'document')}`, {
          variant: 'success',
          persist: false,
        })
      } catch (error) {
        failed(error)
      } finally {
        setBusy(false)
      }
    },
    [pending, busy, confirm, post, enqueueSnackbar, failed],
  )

  const handleUndo = useCallback(async () => {
    if (!lastImportId || busy) return
    setBusy(true)
    try {
      const plan = await post({ action: 'undoPlan', importId: lastImportId })
      if (!plan) return
      const conflicts: number = plan.counts?.conflict ?? 0
      const confirmed = await confirm({
        title: 'Undo this import?',
        description:
          `Items the import replaced are put back and items it added are ` +
          `removed.${conflicts ? ` ${plural(conflicts, 'item has', 'items have')} been edited since and will be left as they are.` : ''}`,
        confirmationText: 'Undo import',
        confirmationButtonProps: { color: 'warning' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      const result = await post({ action: 'undo', importId: lastImportId })
      if (!result) return
      setLastImportId(null)
      enqueueSnackbar(`Undid the import (${plural(result.reverted ?? 0, 'item')})`, {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      failed(error)
    } finally {
      setBusy(false)
    }
  }, [lastImportId, busy, post, confirm, enqueueSnackbar, failed])

  const counts = pending?.answer.plan.counts
  const changed = counts ? counts.differs : 0

  return (
    <CardDisplay
      header={'Backup & restore'}
      help={docsHelp('siteBackupAndPackages', {
        excerpt:
          'Download the whole site — pages, emails, forms, theme, content, ' +
          'data — as one package, and import a package here or into another site.',
      })}
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1}>
            {pending ? (
              <>
                <Button size="small" disabled={busy} onClick={() => setPending(null)}>
                  {'Cancel'}
                </Button>
                {changed > 0 && (
                  <Button size="small" color="warning" disabled={busy || Boolean(pending.answer.capRefusal)} onClick={() => handleApply(true)}>
                    {'Replace changed too'}
                  </Button>
                )}
                <Button
                  variant="contained"
                  size="small"
                  disabled={busy || Boolean(pending.answer.capRefusal)}
                  onClick={() => handleApply(false)}
                >
                  {busy ? 'Working…' : 'Import new items'}
                </Button>
              </>
            ) : (
              <>
                {lastImportId && (
                  <Button size="small" color="warning" disabled={busy} onClick={handleUndo}>
                    {'Undo import'}
                  </Button>
                )}
                <Button size="small" disabled={busy} onClick={() => gate() && inputRef.current?.click()}>
                  {'Import from file'}
                </Button>
                <Button variant="contained" size="small" disabled={busy} onClick={handleExport}>
                  {busy ? 'Working…' : 'Download backup'}
                </Button>
              </>
            )}
          </Stack>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1.5}>
        {pending && counts ? (
          <>
            <Typography variant="body2">
              {`${pending.fileName}: ${plural(counts.new, 'new item')}, ` +
                `${plural(counts.identical, 'item')} already on this site unchanged, ` +
                `${plural(counts.differs, 'item')} that differ from this site’s copy` +
                (counts.missingDependency
                  ? `, and ${plural(counts.missingDependency, 'item')} that need something neither the file nor this site holds.`
                  : '.')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {changed
                ? 'Import new items adds what this site lacks and leaves the changed items as they are; replace them too to take the file’s versions.'
                : 'Import new items adds what this site lacks.'}
            </Typography>
            {pending.answer.capRefusal && <Alert severity="warning">{pending.answer.capRefusal}</Alert>}
            {pending.answer.warningsTotal > 0 && (
              <Alert severity="info">
                {`${plural(pending.answer.warningsTotal, 'reference')} will point at something this site does not hold until it does.`}
              </Alert>
            )}
            {pending.answer.unknownKinds.length > 0 && (
              <Alert severity="info">
                {`This site cannot read ${pending.answer.unknownKinds.join(', ')} items — switch on the plugin that keeps them to import them.`}
              </Alert>
            )}
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'Download everything designable — pages, layouts, emails, forms, ' +
              'theme, content, data, automations — as one file, and import it ' +
              'here or into another of your sites. An import shows what is new ' +
              'and what has changed before it writes anything.'}
          </Typography>
        )}
        <input ref={inputRef} type="file" accept="application/json" hidden onChange={handleImportFile} />
      </Stack>
    </CardDisplay>
  )
}
SiteBackupCard.displayName = 'SiteBackupCard'

export default SiteBackupCard
