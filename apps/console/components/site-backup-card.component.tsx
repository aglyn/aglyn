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

import { CONSOLE_WIDGET_SLOTS } from '@aglyn/aglyn'
import {
  PackageExportDialog,
  PackageImportUndo,
  PackageImportWizard,
  type SitePackageClient,
} from '@aglyn/aglyn-transfer-ui'
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useParams } from 'next/navigation'
import { type ComponentProps, type ReactNode, useCallback, useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { hasEntitlement } from '../constants/entitlements'
import useCurrentOrg from '../hooks/use-current-org'
import { createSitePackageHttpClient } from '../utils/site-package-http-client'
import { sitePackagePreviewHref, sitePackageRenderers } from '../utils/site-package-preview'
import { useSlotWidgets } from './plugin-widget-slot.component'

/** Which of the card's dialogs is open. */
type Open = 'import' | 'export' | 'undo' | null

function CardDialog(props: { title: string; id: string; onClose(): void; children: ReactNode }) {
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="lg" fullScreen={narrow} aria-labelledby={props.id}>
      <DialogTitle id={props.id}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="span">
            {props.title}
          </Typography>
          <IconButton aria-label="Close" onClick={props.onClose} edge="end">
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>{props.children}</DialogContent>
    </Dialog>
  )
}

/**
 * The import wizard, with each kind a plugin previews drawn by that plugin.
 * Its own component so the zone's plugins load when the import opens, not
 * whenever the card is on screen.
 */
function SitePackageImport(
  props: Omit<ComponentProps<typeof PackageImportWizard>, 'renderers'> & { hostId: string },
) {
  const { hostId, ...wizard } = props
  const { widgets } = useSlotWidgets([CONSOLE_WIDGET_SLOTS.sitePackageItemPreview])
  // The slot hands a new list each render; what it says is the widgets and
  // the kinds each draws.
  const key = widgets.map((widget) => `${widget.widgetId}:${(widget.itemKinds ?? []).join(',')}`).join('|')
  const renderers = useMemo(
    () => sitePackageRenderers(widgets, hostId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, hostId],
  )
  return <PackageImportWizard {...wizard} renderers={renderers} />
}

/**
 * Site backup and packages (AGL-163, AGL-3533, AGL-3534, AGL-3545): download
 * everything designable as one site package, export the items you pick with
 * what they need, and import a package through the kit's package wizard —
 * each item shown against this site's copy, rendered side by side (a form
 * or a site email by the plugin that previews it, a dataset's or a
 * collection's records as a table) and value by value, with a choice for
 * every changed item and every missing dependency. The last import can be undone from here for as long as the
 * card is open; the route keeps it undoable for seven days. Pro+
 * (`siteExport` flag).
 */
export function SiteBackupCard(props: { hostId: string }) {
  const { hostId } = props
  const { orgSlug = '', host = '' } = useParams<{ orgSlug?: string; host?: string }>() ?? {}
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { org, ready: orgReady } = useCurrentOrg()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Open>(null)
  const [lastImportId, setLastImportId] = useState<string | null>(null)
  // The import the undo dialog is about, held while it is open so the
  // dialog can say what undo did after the card stops offering it.
  const [undoing, setUndoing] = useState<string | null>(null)

  const client: SitePackageClient = useMemo(
    () =>
      createSitePackageHttpClient({
        hostId,
        fetch: (input, init) => authorizedFetch(user, input, init),
      }),
    [hostId, user],
  )
  const previewHref = useMemo(
    () => (orgSlug && host ? sitePackagePreviewHref({ orgSlug, host, hostId }) : undefined),
    [orgSlug, host, hostId],
  )

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

  const handleBackup = useCallback(async () => {
    if (!gate() || busy) return
    setBusy(true)
    try {
      const file = await client.exportPackage({})
      const url = URL.createObjectURL(file.body)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = file.fileName
      anchor.click()
      URL.revokeObjectURL(url)
      enqueueSnackbar('Backup downloaded', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar(error instanceof Error && error.message ? error.message : 'Export failed', {
        variant: 'warning',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [gate, busy, client, enqueueSnackbar])

  const close = useCallback(() => {
    setOpen(null)
    setUndoing(null)
  }, [])
  const openIfAllowed = (which: Exclude<Open, null>) => {
    if (which === 'undo') setUndoing(lastImportId)
    if (which === 'undo' || gate()) setOpen(which)
  }

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
          <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {lastImportId && (
              <Button size="small" color="warning" disabled={busy} onClick={() => openIfAllowed('undo')}>
                {'Undo import'}
              </Button>
            )}
            <Button size="small" disabled={busy} onClick={() => openIfAllowed('import')}>
              {'Import package'}
            </Button>
            <Button size="small" disabled={busy} onClick={() => openIfAllowed('export')}>
              {'Export items'}
            </Button>
            <Button variant="contained" size="small" disabled={busy} onClick={handleBackup}>
              {busy ? 'Working…' : 'Download backup'}
            </Button>
          </Stack>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Typography variant="body2" color="text.secondary">
        {'Download everything designable — pages, layouts, emails, forms, ' +
          'theme, content, data, automations — as one file, or export the items ' +
          'you pick with what they need, and import it here or into another of ' +
          'your sites. An import shows each item against this site’s copy and ' +
          'asks how to handle it before it writes anything.'}
      </Typography>
      {open === 'import' && (
        <CardDialog title="Import a site package" id="site-package-import-title" onClose={close}>
          <SitePackageImport
            hostId={hostId}
            client={client}
            {...(previewHref ? { previewHref } : {})}
            onImported={(answer) => setLastImportId(answer.importId)}
            onUndone={() => setLastImportId(null)}
            onDone={close}
          />
        </CardDialog>
      )}
      {open === 'undo' && undoing && (
        <CardDialog title="Undo the import" id="site-package-undo-title" onClose={close}>
          <PackageImportUndo
            client={client}
            importId={undoing}
            onUndone={() => setLastImportId(null)}
          />
        </CardDialog>
      )}
      <PackageExportDialog open={open === 'export'} onClose={close} client={client} />
    </CardDisplay>
  )
}
SiteBackupCard.displayName = 'SiteBackupCard'

export default SiteBackupCard
