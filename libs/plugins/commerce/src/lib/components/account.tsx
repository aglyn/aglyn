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

import * as Aglyn from '@aglyn/aglyn'
import * as CommerceModel from '../model'
import { mdiAccountCircleOutline } from '@aglyn/shared-data-mdi'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import MuiLink from '@mui/material/Link'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { forwardRef, useCallback, useEffect, useState } from 'react'
import { BUNDLE_ID } from '../constants/bundle-common'
import { generatePresetId } from '../utils/generate-preset-id'

// Component ids are persisted in screen documents; never rename.
export const ID: Aglyn.ComponentId = 'customer-account'

export interface CustomerAccountProps {
  signedOutHeading?: string
}

interface AccountData {
  member: {
    email: string
    displayName: string
    addresses: CommerceModel.OrderAddress[]
  }
  downloads?: Array<{
    orderId: string
    productId: string
    productName: string
    url: string
    licenseKeys?: string[]
  }>
  subscriptions?: Array<{
    id: string
    productName: string
    status: string
    currentPeriodEndMs?: number | null
  }>
  orders: Array<{
    id: string
    number: string
    status: string
    totalCents: number
    createdAtMs: number
    itemsSummary: string
    tracking?: { carrier?: string; trackingNumber?: string }
  }>
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

/**
 * Customer account block (AGL-294): signed-out visitors get sign-in /
 * create-account forms on the AGL-109 membership APIs; signed-in
 * members see their profile, address book, and order history (status +
 * tracking) with sign-out. Session lives in the httpOnly member cookie.
 */
const CustomerAccount = forwardRef<HTMLDivElement, CustomerAccountProps>(
  (props, ref) => {
    const { signedOutHeading, ...rest } = props
    const { hostId } = Aglyn.useSite()
    const [account, setAccount] = useState<AccountData | null | 'anonymous'>(
      null,
    )
    const [tab, setTab] = useState(0)
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [displayName, setDisplayName] = useState('')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [addressDraft, setAddressDraft] = useState<CommerceModel.OrderAddress | null>(
      null,
    )

    const refresh = useCallback(async () => {
      if (!hostId) return
      try {
        const response = await fetch(
          `/api/membership/account?hostId=${encodeURIComponent(hostId)}`,
        )
        if (response.status === 401) return setAccount('anonymous')
        if (response.ok) return setAccount(await response.json())
        setAccount('anonymous')
      } catch {
        setAccount('anonymous')
      }
    }, [hostId])

    useEffect(() => {
      void refresh()
    }, [refresh])

    const handleAuth = useCallback(async () => {
      if (!hostId || busy) return
      setBusy(true)
      setError('')
      try {
        const endpoint =
          tab === 0 ? '/api/membership/login' : '/api/membership/register'
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hostId,
            email,
            password,
            ...(tab === 1 && displayName ? { displayName } : {}),
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          setError(String(payload?.error ?? 'Something went wrong'))
          return
        }
        if (tab === 1) {
          // Register does not set the cookie on every deployment; sign in
          // right after to be safe.
          await fetch('/api/membership/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostId, email, password }),
          }).catch(() => undefined)
        }
        await refresh()
      } finally {
        setBusy(false)
      }
    }, [hostId, busy, tab, email, password, displayName, refresh])

    const handleSignOut = useCallback(async () => {
      if (!hostId) return
      await fetch('/api/membership/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId }),
      }).catch(() => undefined)
      setAccount('anonymous')
    }, [hostId])

    const handleAddressSave = useCallback(async () => {
      if (!hostId || account === 'anonymous' || !account || !addressDraft) {
        return
      }
      const addresses = [...account.member.addresses, addressDraft].slice(-5)
      await fetch('/api/membership/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, addresses }),
      }).catch(() => undefined)
      setAddressDraft(null)
      await refresh()
    }, [hostId, account, addressDraft, refresh])

    if (!hostId) {
      return (
        <Box
          ref={ref}
          {...rest}
          sx={{
            p: 3,
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 1,
            color: 'text.secondary',
            fontSize: 13,
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          {'Customer account — sign-in and order history render here'}
        </Box>
      )
    }
    if (account === null) return <Box ref={ref} {...rest} />

    if (account === 'anonymous') {
      return (
        <Box ref={ref} {...rest} sx={{ maxWidth: 420 }}>
          {signedOutHeading ? (
            <Typography variant="h5" gutterBottom>
              {signedOutHeading}
            </Typography>
          ) : null}
          <Tabs value={tab} onChange={(_event, value) => setTab(value)}>
            <Tab label="Sign in" />
            <Tab label="Create account" />
          </Tabs>
          <Box
            sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 2 }}
          >
            {tab === 1 ? (
              <TextField
                label="Name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                size="small"
              />
            ) : null}
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              size="small"
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              size="small"
              helperText={tab === 1 ? 'At least 8 characters' : undefined}
            />
            {error ? <Alert severity="error">{error}</Alert> : null}
            <Button
              variant="contained"
              color="primary"
              disabled={busy || !email || !password}
              onClick={handleAuth}
            >
              {busy ? 'Working…' : tab === 0 ? 'Sign in' : 'Create account'}
            </Button>
            {tab === 0 ? (
              // Recovery flow (AGL-552): the built-in /recover route (or
              // the host's designated recovery screen) handles the rest.
              <Typography variant="body2">
                <MuiLink href="/recover" underline="hover">
                  {'Forgot password?'}
                </MuiLink>
              </Typography>
            ) : null}
          </Box>
        </Box>
      )
    }

    return (
      <Box ref={ref} {...rest} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="h5" sx={{ flex: 1 }}>
            {account.member.displayName || account.member.email}
          </Typography>
          <Button size="small" onClick={handleSignOut}>
            {'Sign out'}
          </Button>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {account.member.email}
        </Typography>

        <Divider textAlign="left">{'Orders'}</Divider>
        {account.orders.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No orders yet.'}
          </Typography>
        ) : (
          account.orders.map((order) => (
            <Box key={order.id} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {`${order.number} · ${order.itemsSummary || 'Order'}`}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {new Date(order.createdAtMs).toLocaleDateString()}
                  {order.tracking?.trackingNumber
                    ? ` · ${order.tracking.carrier ?? ''} ${order.tracking.trackingNumber}`
                    : ''}
                </Typography>
              </Box>
              <Chip
                label={order.status.replace('_', ' ')}
                size="small"
                variant="outlined"
              />
              <Typography variant="body2">{usd(order.totalCents)}</Typography>
            </Box>
          ))
        )}

        {(account.subscriptions?.length ?? 0) > 0 ? (
          <>
            <Divider textAlign="left">{'Subscriptions'}</Divider>
            {account.subscriptions!.map((subscription) => (
              <Box
                key={subscription.id}
                sx={{ display: 'flex', gap: 1, alignItems: 'center' }}
              >
                <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                  {subscription.productName}
                </Typography>
                <Chip
                  label={subscription.status}
                  size="small"
                  variant="outlined"
                  color={
                    subscription.status === 'active' ? 'success' : 'default'
                  }
                />
                <Button
                  size="small"
                  onClick={async () => {
                    const response = await fetch(
                      '/api/commerce/subscription-portal',
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ hostId }),
                      },
                    ).catch(() => null)
                    const payload = await response?.json().catch(() => ({}))
                    if (payload?.url) window.location.assign(payload.url)
                  }}
                >
                  {'Manage'}
                </Button>
              </Box>
            ))}
          </>
        ) : null}
        {(account.downloads?.length ?? 0) > 0 ? (
          <>
            <Divider textAlign="left">{'Downloads'}</Divider>
            {account.downloads!.map((download) => (
              <Box
                key={`${download.orderId}:${download.productId}`}
                sx={{ display: 'flex', gap: 1, alignItems: 'center' }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap>
                    {download.productName}
                  </Typography>
                  {download.licenseKeys?.map((key) => (
                    <Typography
                      key={key}
                      variant="caption"
                      sx={{ fontFamily: 'monospace', display: 'block' }}
                    >
                      {key}
                    </Typography>
                  ))}
                </Box>
                <Button size="small" href={download.url}>
                  {'Download'}
                </Button>
              </Box>
            ))}
          </>
        ) : null}

        <Divider textAlign="left">{'Addresses'}</Divider>
        {account.member.addresses.map((address, index) => (
          <Typography key={index} variant="body2" color="text.secondary">
            {[
              address.name,
              address.line1,
              address.line2,
              `${address.city ?? ''} ${address.state ?? ''} ${address.postalCode ?? ''}`.trim(),
              address.country,
            ]
              .filter(Boolean)
              .join(', ')}
          </Typography>
        ))}
        {addressDraft ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {(
              [
                ['name', 'Full name'],
                ['line1', 'Address'],
                ['line2', 'Apt / suite'],
                ['city', 'City'],
                ['state', 'State'],
                ['postalCode', 'Postal code'],
                ['country', 'Country (US)'],
              ] as const
            ).map(([field, label]) => (
              <TextField
                key={field}
                label={label}
                value={(addressDraft as any)[field] ?? ''}
                onChange={(event) =>
                  setAddressDraft((prev) =>
                    prev ? { ...prev, [field]: event.target.value } : prev,
                  )
                }
                size="small"
              />
            ))}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" onClick={() => setAddressDraft(null)}>
                {'Cancel'}
              </Button>
              <Button
                size="small"
                variant="contained"
                color="primary"
                disabled={!addressDraft.line1 || !addressDraft.city}
                onClick={handleAddressSave}
              >
                {'Save address'}
              </Button>
            </Box>
          </Box>
        ) : (
          <Button
            size="small"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => setAddressDraft({})}
          >
            {'Add address'}
          </Button>
        )}
      </Box>
    )
  },
)
CustomerAccount.displayName = 'AglynCustomerAccount'

export const schema: Aglyn.ComponentSchema<CustomerAccountProps> = {
  $id: ID,
  pluginId: BUNDLE_ID,
  displayName: 'Customer account',
  category: Aglyn.ComponentCategory.COMMERCE,
  icon: { path: mdiAccountCircleOutline.path, sx: { color: '#2e7d32' } },
  flags: { selfClosing: Aglyn.FEATURE_FLAG.ENABLED },
  attributes: [
    {
      name: 'signedOutHeading',
      label: 'Signed-out heading',
      description: 'Shown above the sign-in form.',
      component: Aglyn.FieldComponentType.TEXT_FIELD,
    },
  ],
}

export const presets: Aglyn.PresetSchema[] = [
  {
    $id: generatePresetId(ID),
    type: Aglyn.NodeType.PRESET,
    displayName: 'Customer account',
    pluginId: BUNDLE_ID,
    description: 'Sign-in/up, profile, addresses, and order history',
    category: Aglyn.ComponentCategory.COMMERCE,
    icon: { path: mdiAccountCircleOutline.path, sx: { color: '#2e7d32' } },
    data: {
      $id: null,
      componentId: ID,
      pluginId: BUNDLE_ID,
      props: { signedOutHeading: 'Your account' },
    },
  },
]

export default CustomerAccount
