'use client'

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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import { useClientPagination } from '@aglyn/shared-ui-jsx/hooks/use-client-pagination'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Alert, Button, List, ListItem, ListItemText, Stack, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { zapierHookEventSpec, type ZapierHookView } from '../model/hook-events'
import { useZapierApi, type ZapierApi, type ZapierCardState } from './zapier-api'

/** What the `hostSettings` zone hands a widget. */
export interface ZapierCardProps {
  hostId: string
  /** Test seam: the API; the route by default. */
  api?: ZapierApi
}

const eventsSentence = (hook: ZapierHookView): string =>
  hook.events.map((event) => zapierHookEventSpec(event)?.label ?? event).join(', ')

const formatTime = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : 'Nothing sent yet')

/**
 * ZAPIER (AGL-3643): which Zaps take this site's records, and the way to
 * stop one. Each row is one Aglyn trigger of a Zap the merchant built in
 * their own Zapier account: what it takes, the API key it connected with,
 * and how its last delivery went. Draws nothing until the deployment
 * publishes the app (`ZAPIER_APP_URL`), and nothing for a member who
 * cannot read the site.
 */
export function ZapierCard(props: ZapierCardProps) {
  const routeApi = useZapierApi(props.hostId)
  const api = props.api ?? routeApi
  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()
  const [state, setState] = useState<ZapierCardState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const pagination = useClientPagination(state?.hooks ?? [])

  const refresh = useCallback(async () => {
    try {
      setState(await api.list())
    } catch {
      setState({ configured: false, appUrl: null, canManage: false, hooks: [] })
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const disconnect = useCallback(
    async (hook: ZapierHookView) => {
      const confirmed = await confirm({
        title: 'Disconnect this Zap?',
        description: `It stops receiving ${eventsSentence(hook)} from this site. Turn the Zap on again in Zapier to reconnect it.`,
        confirmationText: 'Disconnect',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      setBusy(hook.id)
      setError(null)
      try {
        await api.disconnect(hook.id)
        setState((current) =>
          current ? { ...current, hooks: current.hooks.filter((entry) => entry.id !== hook.id) } : current,
        )
        enqueueSnackbar('The Zap is disconnected.', { variant: 'success', persist: false })
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setBusy(null)
      }
    },
    [api, confirm, enqueueSnackbar],
  )

  if (!state?.configured || !state.appUrl) return null

  return (
    <CardDisplay
      variant="outlined"
      header="Zapier"
      help={pluginDocsHelp('zapier', {
        anchor: '#see-and-disconnect-your-zaps',
        excerpt:
          'The Zaps that take this site’s records — what each takes and the API key it connected with — and the way to stop one.',
      })}
      subheader={`Send this site’s orders, bookings, contacts and form submissions to thousands of apps, and act on ${PLATFORM_BRAND_NAME} from them.`}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button size="small" variant="contained" href={state.appUrl} target="_blank" rel="noopener noreferrer">
            Open in Zapier
          </Button>
        ),
      }}
    >
      <Stack spacing={1.5}>
        {error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
        {state.hooks.length ? (
          <>
            <List dense disablePadding aria-label="Connected Zaps">
              {pagination.pageItems.map((hook) => (
                <ListItem
                  key={hook.id}
                  divider
                  disableGutters
                  secondaryAction={
                    state.canManage ? (
                      <Button
                        size="small"
                        color="error"
                        disabled={busy === hook.id}
                        onClick={() => void disconnect(hook)}
                      >
                        Disconnect
                      </Button>
                    ) : undefined
                  }
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                        <span>{eventsSentence(hook)}</span>
                        {hook.lastDeliveryStatus ? (
                          <StatusChip
                            label={hook.lastDeliveryStatus === 'delivered' ? 'Delivering' : 'Last delivery failed'}
                            tone={hook.lastDeliveryStatus === 'delivered' ? 'success' : 'warning'}
                            variant="outlined"
                          />
                        ) : null}
                      </Stack>
                    }
                    secondary={`${hook.keyName ? `API key “${hook.keyName}” · ` : ''}Last sent: ${formatTime(hook.lastDeliveryAt)}`}
                  />
                </ListItem>
              ))}
            </List>
            <ListPagination {...pagination.paginationProps} />
          </>
        ) : (
          <EmptyStateComponent compact label="No Zaps take this site’s records yet." />
        )}
        <Typography variant="body2" color="text.secondary">
          {`Connect with an API key from your organization’s settings, holding the scopes your Zaps read: orders, bookings, contacts or form submissions.`}
        </Typography>
      </Stack>
    </CardDisplay>
  )
}

export default ZapierCard
