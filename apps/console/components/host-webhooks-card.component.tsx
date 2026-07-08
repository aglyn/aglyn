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
  createResourceUid,
  WEBHOOK_MAX_PER_HOST,
  WEBHOOK_URL_PATTERN,
} from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollectionData,
  useFirestoreDocData,
} from 'reactfire'
import { hasEntitlement } from '../constants/entitlements'
import useCurrentTenant from '../hooks/use-current-tenant'

function generateSecret(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
}

interface WebhookDraft {
  id: string | null
  name: string
  direction: 'outbound' | 'inbound'
  url: string
  workflowName: string
  secret: string
}

/**
 * Webhooks manager (AGL-149): outbound targets (used by the actions
 * builder's "Send a webhook" step, HMAC-signed) and inbound endpoints
 * (`/api/hooks/{hostId}/{hookId}`, secret-verified, run a workflow with
 * the payload in scope). Business tier.
 */
export function HostWebhooksCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { tenant } = useCurrentTenant()

  const { data: webhookDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'webhooks'), limit(20)),
    { idField: '$id' },
  )
  const { data: workflowDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'workflows'), limit(100)),
    { idField: '$id' },
  )
  const { data: host } = useFirestoreDocData<any>(
    doc(firestore, 'hosts', hostId),
    { idField: '$id' },
  )
  const webhooks = [...(webhookDocs ?? [])]
    .filter((hook: any) => !hook.deletedAt)
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )
  const workflowNames = (workflowDocs ?? [])
    .filter((workflow: any) => !workflow.deletedAt && workflow.name)
    .map((workflow: any) => workflow.name as string)
    .sort()
  const siteBase = host?.cname
    ? `https://${host.cname}`
    : host?.subdomain
      ? `https://${host.subdomain}.aglyn.app`
      : ''

  const [draft, setDraft] = useState<WebhookDraft | null>(null)

  const handleAdd = useCallback(() => {
    if (!hasEntitlement('webhooks', tenant)) {
      return void enqueueSnackbar(
        'Webhooks require a Business plan — see Billing to upgrade',
        { variant: 'warning', persist: false },
      )
    }
    if (webhooks.length >= WEBHOOK_MAX_PER_HOST) {
      return void enqueueSnackbar(
        `Webhooks are capped at ${WEBHOOK_MAX_PER_HOST} per site`,
        { variant: 'warning', persist: false },
      )
    }
    setDraft({
      id: null,
      name: '',
      direction: 'outbound',
      url: '',
      workflowName: '',
      secret: generateSecret(),
    })
  }, [tenant, webhooks.length, enqueueSnackbar])

  const handleSave = useCallback(async () => {
    if (!draft || !draft.name.trim()) return
    if (draft.direction === 'outbound') {
      if (!WEBHOOK_URL_PATTERN.test(draft.url.trim())) {
        return void enqueueSnackbar(
          'Outbound URLs must be public https addresses',
          { variant: 'warning', persist: false },
        )
      }
    } else if (!draft.workflowName.trim()) {
      return void enqueueSnackbar('Pick the workflow this endpoint runs', {
        variant: 'warning',
        persist: false,
      })
    }
    try {
      const id = draft.id ?? createResourceUid()
      await setDoc(
        doc(firestore, 'hosts', hostId, 'webhooks', id),
        {
          name: draft.name.trim().slice(0, 60),
          direction: draft.direction,
          ...(draft.direction === 'outbound'
            ? { url: draft.url.trim() }
            : { workflowName: draft.workflowName.trim() }),
          secret: draft.secret,
          enabled: true,
          updatedAt: Timestamp.now(),
          ...(draft.id ? {} : { createdAt: Timestamp.now() }),
        },
        { merge: true },
      )
      setDraft(null)
      enqueueSnackbar('Webhook saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [draft, firestore, hostId, enqueueSnackbar])

  const handleDelete = useCallback(
    (hook: any) => async () => {
      const confirmed = await confirm({
        title: 'Delete this webhook?',
        description: `"${hook.name}" stops ${
          hook.direction === 'outbound' ? 'delivering' : 'accepting calls'
        } immediately.`,
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await updateDoc(doc(firestore, 'hosts', hostId, 'webhooks', hook.$id), {
        deletedAt: Timestamp.now(),
      })
    },
    [confirm, firestore, hostId],
  )

  return (
    <CardDisplay header={'Webhooks'} contentGutterX contentGutterY>
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {'Send signed JSON to outside systems from the actions builder, ' +
            'or accept calls that run a workflow. Business plans.'}
        </Typography>
        {webhooks.map((hook: any) => (
          <Stack
            key={hook.$id}
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center' }}
          >
            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {hook.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {hook.direction === 'outbound'
                  ? `outbound · ${hook.url}`
                  : `inbound · ${siteBase}/api/hooks/${hostId}/${hook.$id}` +
                    ` → ${hook.workflowName}`}
              </Typography>
            </Stack>
            {hook.direction === 'inbound' ? (
              <Button
                size="small"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    `${siteBase}/api/hooks/${hostId}/${hook.$id}`,
                  )
                  enqueueSnackbar(
                    'Endpoint URL copied — send the secret in x-aglyn-secret',
                    { variant: 'success', persist: false },
                  )
                }}
              >
                {'Copy URL'}
              </Button>
            ) : null}
            <Button
              size="small"
              onClick={() => {
                void navigator.clipboard.writeText(hook.secret ?? '')
                enqueueSnackbar('Secret copied', {
                  variant: 'success',
                  persist: false,
                })
              }}
            >
              {'Secret'}
            </Button>
            <Button size="small" color="error" onClick={handleDelete(hook)}>
              {'Delete'}
            </Button>
          </Stack>
        ))}
        <Button
          size="small"
          color="secondary"
          sx={{ alignSelf: 'flex-start' }}
          onClick={handleAdd}
        >
          {'Add webhook'}
        </Button>
      </Stack>

      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'Add webhook'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            label="Name"
            value={draft?.name ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            select
            label="Direction"
            value={draft?.direction ?? 'outbound'}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, direction: event.target.value as any }
                  : prev,
              )
            }
            size="small"
          >
            <MenuItem value="outbound">
              {'Outbound — send data to a URL'}
            </MenuItem>
            <MenuItem value="inbound">
              {'Inbound — receive data, run a workflow'}
            </MenuItem>
          </TextField>
          {draft?.direction === 'outbound' ? (
            <TextField
              label="Delivery URL"
              placeholder="https://example.com/hooks/aglyn"
              value={draft?.url ?? ''}
              onChange={(event) =>
                setDraft((prev) =>
                  prev ? { ...prev, url: event.target.value } : prev,
                )
              }
              size="small"
            />
          ) : (
            <TextField
              select
              label="Workflow to run"
              value={draft?.workflowName ?? ''}
              onChange={(event) =>
                setDraft((prev) =>
                  prev ? { ...prev, workflowName: event.target.value } : prev,
                )
              }
              size="small"
            >
              {workflowNames.map((name) => (
                <MenuItem key={name} value={name}>
                  {name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            label="Secret"
            helperText={
              draft?.direction === 'outbound'
                ? 'Signs deliveries (X-Aglyn-Signature, HMAC-SHA256)'
                : 'Callers send this in the x-aglyn-secret header'
            }
            value={draft?.secret ?? ''}
            size="small"
            slotProps={{ input: { readOnly: true } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!draft?.name.trim()}
            onClick={handleSave}
          >
            {'Save webhook'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostWebhooksCard.displayName = 'HostWebhooksCard'

export default HostWebhooksCard
