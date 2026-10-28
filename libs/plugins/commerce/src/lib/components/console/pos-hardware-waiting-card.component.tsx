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
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Button, Divider, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { EntitlementUpsell, useCommerceEntitlement } from './entitlement-gate.component'
import {
  PosHardwareRequestError,
  posHardwareChooseStore,
  posHardwareMarkSetUp,
  posHardwareWaiting,
  type WaitingReaderOrder,
  type WaitingReaders,
} from './pos/pos-hardware-api'

export interface PosHardwareWaitingCardProps {
  hostId: string
  /**
   * Why the member may not set up devices on this store (`posDevices`), or
   * nothing when they may. Passed in, not resolved here: this card is its own
   * chunk, and reaching into the permissions model from it would pull that
   * eagerly loaded module apart.
   */
  devicesBlockedReason?: string
}

const items = (order: WaitingReaderOrder) => order.lines.map((line) => `${line.quantity} × ${line.name}`).join(', ')

/**
 * Card readers this workspace bought in person, waiting to be set up
 * (AGL-4038). Each says the one thing it still needs, in order:
 *
 *   1. a plan with the point of sale, which registering a reader needs;
 *   2. the store it is for, when nobody chose one at the sale;
 *   3. adding it on that store's POS devices card by the code it shows —
 *      by itself it then moves to Set up when its serial was taken at the
 *      sale, and otherwise "Mark set up" says it is done.
 *
 * Drawn only while there is such a reader. Loaded on its own.
 */
function PosHardwareWaitingCard(props: PosHardwareWaitingCardProps) {
  const { hostId, devicesBlockedReason } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const plan = useCommerceEntitlement(hostId, 'pos')
  const [waiting, setWaiting] = useState<WaitingReaders | null>(null)
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const uid = user?.uid ?? ''

  const load = useCallback(async () => {
    if (!user) return
    try {
      setWaiting(await posHardwareWaiting(user, hostId))
    } catch {
      setWaiting(null)
    }
    // Keyed on the person, not the session object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, hostId])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (orderId: string, run: () => Promise<unknown>, done: string) => {
    setBusy(orderId)
    try {
      await run()
      enqueueSnackbar(done, { variant: 'success', persist: false })
      await load()
    } catch (error) {
      enqueueSnackbar(error instanceof PosHardwareRequestError ? error.message : 'That did not work. Try again.', {
        variant: 'warning',
        persist: false,
      })
    } finally {
      setBusy('')
    }
  }

  if (!user || !waiting?.orders.length) return null
  const devicesReason = devicesBlockedReason || undefined
  const planReason = waiting.posPlan ? undefined : 'Add a plan with the point of sale first.'

  return (
    <CardDisplay
      header={'Card readers to set up'}
      subheader={'Bought in person, ready for your store'}
      help={pluginDocsHelp('posHardware', { anchor: '#card-readers-to-set-up' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2} divider={<Divider flexItem />}>
        {waiting.posPlan ? null : (
          <EntitlementUpsell planLabel={plan.planLabel} upgradeHref={plan.upgradeHref}>
            {'A card reader takes payments at the register, which comes with the point of sale. Add it, then set the reader up here.'}
          </EntitlementUpsell>
        )}
        {waiting.orders.map((order) => {
          const store = waiting.stores.find((candidate) => candidate.hostId === order.hostId)
          const pick = chosen[order.id] ?? waiting.stores[0]?.hostId ?? ''
          return (
            <Stack key={order.id} spacing={1}>
              <Typography variant="subtitle2">{items(order)}</Typography>
              <Typography variant="body2" color="text.secondary">
                {`Order ${order.number} · bought ${new Date(order.createdAtMs).toLocaleDateString()}`}
              </Typography>
              {store ? (
                <>
                  <Typography variant="body2">
                    {order.serialsTaken
                      ? `For ${store.name}. Add it on the POS devices card with the code it shows, and it is set up: we know its serial number.`
                      : `For ${store.name}. Add it on the POS devices card with the code it shows, then mark it set up.`}
                    {store.hasLocation ? '' : ' The first reader asks for the store’s address.'}
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <BlockedControl blocked={Boolean(planReason ?? devicesReason)} reason={planReason ?? devicesReason ?? ''}>
                      <Button variant="contained" size="small" href={store.setupUrl}>
                        {'Open POS devices'}
                      </Button>
                    </BlockedControl>
                    <BlockedControl blocked={Boolean(planReason ?? devicesReason)} reason={planReason ?? devicesReason ?? ''}>
                      <Button
                        size="small"
                        disabled={busy === order.id}
                        onClick={() =>
                          void act(order.id, () => posHardwareMarkSetUp(user, order.hostId, order.id), 'Marked set up')
                        }
                      >
                        {'Mark set up'}
                      </Button>
                    </BlockedControl>
                  </Stack>
                </>
              ) : (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <TextField
                    select
                    size="small"
                    label="Which store is it for?"
                    value={pick}
                    onChange={(event) => setChosen({ ...chosen, [order.id]: event.target.value })}
                    sx={{ minWidth: (theme) => theme.spacing(30) }}
                  >
                    {waiting.stores.map((candidate) => (
                      <MenuItem key={candidate.hostId} value={candidate.hostId}>
                        {candidate.name}
                      </MenuItem>
                    ))}
                  </TextField>
                  <BlockedControl blocked={Boolean(planReason)} reason={planReason ?? ''}>
                    <Button
                      size="small"
                      disabled={!pick || busy === order.id}
                      onClick={() =>
                        void act(order.id, () => posHardwareChooseStore(user, pick, order.id), 'Store chosen')
                      }
                    >
                      {'Choose'}
                    </Button>
                  </BlockedControl>
                </Stack>
              )}
            </Stack>
          )
        })}
      </Stack>
    </CardDisplay>
  )
}

export default PosHardwareWaitingCard
