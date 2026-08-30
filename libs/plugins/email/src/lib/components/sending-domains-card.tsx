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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container, MdiIcon, SrOnly } from '@aglyn/shared-ui-jsx'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { describeSendingDomain } from '../model/sending-domain-status'
import {
  useSendingApi,
  type SendingIdentityView,
} from './use-sending-identity-api'

export interface SendingDomainsCardProps {
  hostId: string
  /** `/…/emails/sending`, so a row can link to the domain's own page. */
  basePath: string
}

/**
 * WHERE A WORKSPACE PROVES IT OWNS THE DOMAIN ITS MAIL LEAVES ON.
 *
 * ## The two halves on one screen, and why they are not one control
 *
 * A domain is proved by the ORG — publishing a DKIM record is a statement
 * about a zone, and an agency running four sites on `client.com` should make
 * it once. Which of the proved domains THIS SITE sends as is a separate,
 * per-site choice, because the `From:` a recipient sees belongs to the site.
 *
 * So the top of this card says what this site sends as right now, and the
 * table below is the org's set of domains. Collapsing them would make one of
 * the two questions unanswerable: with one control per site, four sites would
 * publish the same record four times; with one control per org, an agency
 * could not give two clients two different `From:` lines.
 *
 * ## Every state gets its own sentence
 *
 * Five situations, and `describeSendingDomain` holds four of them — the fifth,
 * a check nobody answered, is deliberately not a state at all. It rides the
 * surface as a transient notice beside whatever the record still says, which
 * is the whole reason the model file exists.
 */
export function SendingDomainsCard(props: SendingDomainsCardProps) {
  const { hostId, basePath } = props
  const call = useSendingApi()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  /*
   * The snackbar held in a REF, for the reason `use-campaign-send-api` holds
   * the user in one: `load` is a dependency of the effect that runs it, so
   * anything whose identity changes per render re-runs the fetch — and a
   * hook returning a fresh object each render turns that into a loop that
   * never settles. Reading it through a ref makes the effect depend on the
   * things that actually identify the request.
   */
  const notifyRef = useRef(enqueueSnackbar)
  notifyRef.current = enqueueSnackbar

  const [view, setView] = useState<SendingIdentityView | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [addingBusy, setAddingBusy] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [addError, setAddError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { response, payload } = await call({
      path: 'sending-identity',
      method: 'GET',
      query: { hostId },
    })
    setLoading(false)
    if (!response.ok) {
      /*
       * The refusal itself, not a generic failure. A reader without the org
       * admin role, or on a plan that does not carry white-label, needs to
       * know which of those it is — "something went wrong" would send them
       * to support for an answer the response already gave.
       */
      setView(null)
      return void notifyRef.current(payload?.error ?? 'Could not read the sending identity', {
        variant: 'warning',
      })
    }
    setView(payload as SendingIdentityView)
  }, [call, hostId])

  useEffect(() => {
    void load()
  }, [load])

  const handleAdd = useCallback(async () => {
      const domain = newDomain.trim()
      if (!domain || addingBusy) return
      setAddError('')
      setAddingBusy(true)
      const { response, payload } = await call({
        path: 'sending-domains',
        method: 'POST',
        body: { orgId: view?.orgId, domain, action: 'request' },
      })
      setAddingBusy(false)
      if (!response.ok) {
        setAddError(payload?.error ?? 'Could not add that domain')
        return
      }
      setAdding(false)
      setNewDomain('')
      /*
       * Straight to the domain's own page, because the thing the person came
       * for is now there: the records to publish. A list row saying
       * "Publish the records" with the records one click further away would
       * make the next step something they have to go looking for.
       */
      router.push(`${basePath}/${encodeURIComponent(payload?.domain ?? domain)}`)
  }, [call, view?.orgId, basePath, router, newDomain, addingBusy])

  const domains = view?.domains ?? []
  const platformOption = view?.options?.find((one) => one.value === 'platform')

  return (
    <CardDisplay
      header="Sending domains"
      help={pluginDocsHelp('emailCampaigns', {
        anchor: '#sending-domains',
      })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: view?.canManage ? (
          <Button
            size="small"
            variant="contained"
            disabled={!view?.entitled || !view?.orgId}
            onClick={() => setAdding(true)}
          >
            {'Add domain'}
          </Button>
        ) : null,
      }}
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'Marketing email from this site leaves on a verified address. ' +
            'Until you prove a domain of your own, that address is on the ' +
            'shared Aglyn domain — which works, and which means this site’s ' +
            'delivery reputation is pooled with every other workspace’s. A ' +
            'domain you own moves that reputation onto a name your recipients ' +
            'already recognize.'}
        </Typography>

        {/*
          WHAT THIS SITE SENDS AS, RIGHT NOW.

          Read from the same resolver the send path calls, so this is the
          answer a campaign would get and not a second opinion assembled from
          the table below. A surface that re-derived it would eventually show
          a healthy address for a send that refuses.
         */}
        {view ? (
          <Alert severity={view.refusal ? 'warning' : 'info'}>
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              {view.refusal ? 'This site cannot send' : 'This site sends as'}
            </Typography>
            <Typography variant="body2">
              {view.refusal?.message ?? view.identity}
            </Typography>
            {view.identitySource === 'platform' && !view.refusal ? (
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {'Recipients see an Aglyn address, and replies still reach ' +
                  'you. What they do not see is your own domain, and your ' +
                  'sending reputation is shared with other workspaces rather ' +
                  'than being yours.'}
              </Typography>
            ) : null}
          </Alert>
        ) : null}

        {view && !view.entitled ? (
          <Alert severity="info">
            {'Custom sending domains are part of the Agency plan. Until then ' +
              'this site sends on the shared Aglyn domain' +
              (platformOption?.from ? ` (${platformOption.from}).` : '.')}
          </Alert>
        ) : null}

        {view && view.entitled && !view.canManage ? (
          <Alert severity="info">
            {'Adding a domain and choosing what this site sends as needs the ' +
              'organization admin role. You can see the current state here.'}
          </Alert>
        ) : null}

        {loading ? (
          <Typography variant="body2" color="text.secondary">
            {'Loading…'}
          </Typography>
        ) : domains.length ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Domain'}</TableCell>
                <TableCell>{'State'}</TableCell>
                <TableCell>{'Used by this site'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {domains.map((record) => {
                const state = describeSendingDomain({
                  status: record.status,
                  // The list read does not carry the provider detail — the
                  // domain's own page does — so `requested` reads here as the
                  // waiting state it usually is, and the page is where the
                  // difference between "no credential" and "the provider
                  // refused" is spelled out.
                  pendingProvider: record.status === 'requested',
                })
                return (
                  <TableRow
                    key={record.domain}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() =>
                      router.push(
                        `${basePath}/${encodeURIComponent(record.domain)}`,
                      )
                    }
                  >
                    <TableCell sx={{ fontFamily: 'monospace' }}>
                      {record.domain}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={state.label}
                        color={state.color}
                        variant={state.sending ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell>
                      {view?.selected === record.domain ? (
                        <Chip size="small" label="Sending as this" color="primary" />
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {'—'}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'No domain has been added yet.'}
          </Typography>
        )}
      </Stack>

      {/*
        Creating is a drawer, the same as every other create in the console.

        Composed from `NavigationDrawerComponent` — the primitive
        `CreateArtifactDrawer` is itself built on — rather than from that
        wrapper, for the reason `suppressions-card.tsx` states beside the same
        choice: the shared schema opens with a required `displayName` labeled
        "Friendly name for internal reference", and a sending domain has no
        such thing. Its identity IS the domain, which is also its document id.
        Offering a name box that the writer ignores would teach the person it
        was used.
       */}
      <NavigationDrawerComponent
        open={adding}
        anchor="right"
        variant="temporary"
        onClose={() => setAdding(false)}
        AppBarProps={{ color: 'surface' }}
        appBarLeft={
          <>
            <IconButton
              color="inherit"
              edge="start"
              onClick={() => setAdding(false)}
              sx={{ mr: 2 }}
            >
              <MdiIcon path={ICON_VARIANT_CLOSE.path} />
              <SrOnly>close drawer</SrOnly>
            </IconButton>
            <Typography variant="h6" component="div">
              {'Add a sending domain'}
            </Typography>
          </>
        }
      >
        <Container gutterY>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {'The domain your mail should come from — the part after the @. ' +
                'Use a domain you control the DNS for; you will be given ' +
                'records to publish on it. Mailbox providers do not delegate ' +
                'sending for their own names, so a Gmail or Outlook address ' +
                'cannot be verified here.'}
            </Typography>
            <TextField
              label="Domain"
              value={newDomain}
              onChange={(event) => setNewDomain(event.target.value)}
              size="small"
              autoFocus
              placeholder="acme.com"
              helperText="For example acme.com — not an address"
            />
            {addError ? <Alert severity="error">{addError}</Alert> : null}
            <Button
              variant="contained"
              disabled={!newDomain.trim() || addingBusy}
              onClick={() => void handleAdd()}
            >
              {addingBusy ? 'Adding…' : 'Add domain'}
            </Button>
          </Stack>
        </Container>
      </NavigationDrawerComponent>
    </CardDisplay>
  )
}
SendingDomainsCard.displayName = 'SendingDomainsCard'

export default SendingDomainsCard
