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

import { Button, Stack } from '@mui/material'
import { collection, doc, limit, query, where } from 'firebase/firestore'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useOrgPlan,
  useSitePluginConfig,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useCallback, useMemo, useState } from 'react'
import { buildPosReceipt, type PosReceiptOrder } from '../../../model/commerce-pos-ops'
import { posOpsSettings, type PosOpsSettings } from '../../../pos-ops-config'
import { printPosReceipt } from './pos-receipt'

/** The register settings (AGL-3609) for one site, as the console reads them. */
export function usePosOpsSettings(hostId: string): PosOpsSettings {
  // The org is read only once it has landed: before that the settings would
  // resolve against no workspace at all.
  const { org, ready } = useOrgPlan(hostId)
  const orgId = ready
    ? ((org as { $id?: string; id?: string } | null)?.$id ?? (org as { id?: string } | null)?.id)
    : undefined
  const { config } = useSitePluginConfig(orgId, hostId, 'commerce')
  return useMemo(() => posOpsSettings(config), [config])
}

/** Whether a register has a cloud receipt printer (AGL-3619) to send to. */
export function usePosRegisterHasPrinter(hostId: string, registerId: string | undefined): boolean {
  const firestore = useFirestore()
  const { data } = useFirestoreCollection<Record<string, unknown>>(
    () =>
      registerId
        ? query(collection(firestore, 'hosts', hostId, 'printers'), where('registerId', '==', registerId), limit(1))
        : null,
    [firestore, hostId, registerId],
    { idField: '$id' },
  )
  return Boolean(registerId && data?.length)
}

/** What every receipt from this site prints besides the sale. */
export interface PosReceiptStore {
  name: string
  logoUrl?: string
  address?: string
  footer?: string
  returnPolicy?: string
}

/**
 * The store's receipt header and footer, read where the merchant keeps them:
 * the site's name and logo, the receipt footer from the store settings, and
 * the receipt address and return policy from the register settings.
 */
export function usePosReceiptStore(hostId: string): PosReceiptStore {
  const firestore = useFirestore()
  // The org is read only once it has landed: before that the settings would
  // resolve against no workspace at all.
  const { org, ready } = useOrgPlan(hostId)
  const orgId = ready
    ? ((org as { $id?: string; id?: string } | null)?.$id ?? (org as { id?: string } | null)?.id)
    : undefined
  const { config } = useSitePluginConfig(orgId, hostId, 'commerce')
  const { data: host } = useFirestoreDoc<Record<string, any>>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
  )
  const { data: store } = useFirestoreDoc<Record<string, any>>(
    () => doc(firestore, 'hosts', hostId, 'settings', 'store'),
    [firestore, hostId],
  )
  return useMemo(() => {
    const settings = posOpsSettings(config)
    return {
      name: String(host?.['displayName'] ?? '') || 'Receipt',
      ...(host?.['logoUrl'] ? { logoUrl: String(host['logoUrl']) } : {}),
      ...(settings.receiptAddress ? { address: settings.receiptAddress } : {}),
      ...(store?.['receiptFooter'] ? { footer: String(store['receiptFooter']) } : {}),
      ...(settings.returnPolicy ? { returnPolicy: settings.returnPolicy } : {}),
    }
  }, [config, host, store])
}

export interface PosReceiptActionsProps {
  hostId: string
  orderId: string
  order: PosReceiptOrder & { cashierName?: string; registerName?: string; registerId?: string }
  registerName?: string
  size?: 'small' | 'medium'
  /**
   * How the "Receipt printer" button sends to the register's cloud printer:
   * `sale` right after the sale (the customer's receipt), `reprint` later
   * (printed under a REPRINT banner). Shown only when the register has one.
   */
  cloudPrint?: 'sale' | 'reprint'
}

/**
 * Print, or reprint, a sale's thermal receipt — and its gift receipt, which
 * keeps the items and the barcode a recipient returns with and drops every
 * price.
 */
export function PosReceiptActions(props: PosReceiptActionsProps) {
  const { hostId, orderId, order } = props
  const store = usePosReceiptStore(hostId)
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [sending, setSending] = useState(false)
  const hasPrinter = usePosRegisterHasPrinter(hostId, props.cloudPrint ? order.registerId : undefined)
  const sendToPrinter = useCallback(async () => {
    setSending(true)
    try {
      const sale = props.cloudPrint === 'sale'
      const response = await authorizedFetch(user as any, sale ? '/api/commerce/pos-payment' : '/api/commerce/printers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          sale
            ? { hostId, orderId, action: 'receipt', channel: 'print' }
            : { hostId, orderId, action: 'reprint' },
        ),
      })
      const answer = (await response.json().catch(() => ({}))) as { error?: string }
      enqueueSnackbar(response.ok ? 'Sent to the receipt printer' : (answer.error ?? 'Could not print'), {
        variant: response.ok ? 'success' : 'warning',
        persist: false,
      })
    } catch {
      enqueueSnackbar('The register is offline. Check the connection and try again.', {
        variant: 'warning',
        persist: false,
      })
    } finally {
      setSending(false)
    }
  }, [props.cloudPrint, user, hostId, orderId, enqueueSnackbar])
  const print = useCallback(
    (gift: boolean) =>
      printPosReceipt(
        buildPosReceipt({
          orderId,
          order,
          store,
          gift,
          ...(order.cashierName ? { cashierName: order.cashierName } : {}),
          ...(props.registerName || order.registerName
            ? { registerName: props.registerName || order.registerName }
            : {}),
        }),
      ),
    [orderId, order, store, props.registerName],
  )
  return (
    <Stack direction="row" spacing={1}>
      <Button size={props.size ?? 'small'} onClick={() => print(false)}>
        {'Print receipt'}
      </Button>
      <Button size={props.size ?? 'small'} onClick={() => print(true)}>
        {'Gift receipt'}
      </Button>
      {props.cloudPrint && hasPrinter ? (
        <Button size={props.size ?? 'small'} disabled={sending} onClick={() => void sendToPrinter()}>
          {'Receipt printer'}
        </Button>
      ) : null}
    </Stack>
  )
}

PosReceiptActions.displayName = 'PosReceiptActions'

export default PosReceiptActions
