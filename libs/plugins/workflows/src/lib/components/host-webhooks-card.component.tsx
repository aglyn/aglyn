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
  type AglynOrgBilling,
  checkEntitlement,
  createResourceUid,
  pluginDocsHelp,
  WEBHOOK_MAX_PER_HOST,
  WEBHOOK_URL_PATTERN,
} from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { hostPublicOrigin } from '@aglyn/aglyn/app-utils/host-naming'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
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
import { collection, doc, updateDoc } from 'firebase/firestore'
import { useCallback, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useHostResourceApi,
} from '@aglyn/tenant-feature-instance'
/*
 * The MODULE, not the barrel, for the two PURE helpers — the specs that render
 * this card mock `@aglyn/tenant-feature-instance` wholesale to stage their
 * Firestore hooks, and a query builder imported through that barrel disappears
 * under the mock. Neither of these is a hook.
 */
import {
  ceilingedWindow,
  collectionCeiling,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'

/**
 * How many webhook documents the card reads.
 *
 * Above `WEBHOOK_MAX_PER_HOST` on purpose. The cap counts LIVE hooks and the
 * collection keeps soft-deleted ones, so a site that has created and deleted
 * its five several times holds more documents than it may have hooks.
 */
const WEBHOOK_CEILING = 20

/**
 * How many workflows the inbound-endpoint picker offers.
 *
 * Paid for only while the editor is open, which is what makes a ceiling this
 * size affordable: it is one operator mid-edit rather than every visitor to
 * the page.
 */
const WORKFLOW_OPTION_CEILING = 100

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
export function HostWebhooksCard(props: {
  hostId: string
  org?: Partial<AglynOrgBilling>
}) {
  const { hostId, org } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const createResource = useHostResourceApi()


  const [draft, setDraft] = useState<WebhookDraft | null>(null)
  /**
   * The editor has been opened at least once in this session.
   *
   * A LATCH rather than `draft` itself, because the workflow picker below keys its
   * listeners on it. Tracking the dialog would tear that subscription down
   * on Cancel and pay for them again on the next Edit, so a merchant working
   * through ten actions would buy the same window ten times — worse than
   * the mount-time read this replaces. Latched, a reader who never edits pays
   * nothing and a reader who edits pays once.
   */
  const [editorOpened, setEditorOpened] = useState(false)
  if (draft && !editorOpened) setEditorOpened(true)
  /*
   * ORDERED AND CEILINGED (AGL-2501). A bare `limit` is answered in
   * DOCUMENT-ID order, so an unnamed window is an arbitrary twenty that the
   * `localeCompare` below would arrange alphabetically. `collectionCeiling`
   * does not change WHICH twenty; it NAMES the order, and the probe row it
   * adds is what lets the card say when the ceiling bites.
   */
  const { data: webhookRead } = useFirestoreCollection<any>(
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'webhooks'),
        WEBHOOK_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: readWebhooks, truncated: webhooksTruncated } =
    ceilingedWindow<any>(webhookRead, WEBHOOK_CEILING)
  /*
   * READ WHEN THE EDITOR OPENS, not when the card mounts. The only thing that
   * consumes these rows is the inbound-endpoint select inside the dialog — the
   * table renders a hook's stored `workflowName` — so an unconditional
   * listener would charge every visitor to this page a hundred workflows to
   * fill a control most of them never see, and one that only appears for the
   * inbound half of the form at that.
   */
  const { data: workflowRead } = useFirestoreCollection<any>(
    () =>
      editorOpened
        ? collectionCeiling(
            collection(firestore, 'hosts', hostId, 'workflows'),
            WORKFLOW_OPTION_CEILING,
          )
        : null,
    [firestore, hostId, editorOpened],
    { idField: '$id' },
  )
  const { rows: readWorkflows, truncated: workflowOptionsTruncated } =
    ceilingedWindow<any>(workflowRead, WORKFLOW_OPTION_CEILING)
  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  // Sorting the whole ceiling, not a page of it.
  const webhooks = [...readWebhooks]
    .filter((hook: any) => !hook.deletedAt)
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )
  const workflowNames = readWorkflows
    .filter((workflow: any) => !workflow.deletedAt && workflow.name)
    .map((workflow: any) => workflow.name as string)
    .sort()
  // `hostPublicOrigin` (AGL-2195) — this base is printed into the webhook
  // sample payload an operator copies into a third-party system.
  const siteBase = hostPublicOrigin(host) ?? ''

  const handleAdd = useCallback(() => {
    if (!checkEntitlement(org, 'webhooks')) {
      return void enqueueSnackbar(
        'Webhooks require a Business plan — see Billing to upgrade',
        { variant: 'warning', persist: false },
      )
    }
    // An affordance, NOT the limit (AGL-1360). `webhooks` comes from a
    // Firestore listener and the console runs `persistentLocalCache`, so this
    // count can be arbitrarily stale — it is here to fail fast when it
    // happens to be right, never to authorise the create. The cap that holds
    // is counted server-side in /api/hosts/resources.
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
  }, [org, webhooks.length, enqueueSnackbar])

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
      // Creates go through /api/hosts/resources (AGL-1360), which counts the
      // live webhooks with the Admin SDK before allowing one more; Firestore
      // rules deny client `create` on this collection. The card has no edit
      // path — every save is a create — so there is no update branch here.
      await createResource({
        hostId,
        resource: 'webhook',
        id: createResourceUid(),
        data: {
          name: draft.name.trim().slice(0, 60),
          direction: draft.direction,
          ...(draft.direction === 'outbound'
            ? { url: draft.url.trim() }
            : { workflowName: draft.workflowName.trim() }),
          secret: draft.secret,
          enabled: true,
        },
      })
      setDraft(null)
      enqueueSnackbar('Webhook saved', { variant: 'success', persist: false })
    } catch (error: any) {
      console.error(error)
      // The route's message is the useful one — it names the cap, the
      // entitlement or the role that refused.
      enqueueSnackbar(error?.message || 'An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [draft, createResource, hostId, enqueueSnackbar])

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
    <CardDisplay
      header={'Webhooks'}
      help={pluginDocsHelp('webhooks', { anchor: '#outbound-webhooks' })}
      contentGutterX
      contentGutterY
    >
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
        {webhooksTruncated ? (
          <Alert severity="info">
            {`Showing the first ${WEBHOOK_CEILING} webhook documents on this ` +
              'site, ordered by id. There are more, so a hook may be missing ' +
              'from this list.'}
          </Alert>
        ) : null}
        <Button
          size="small"
          color="primary"
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
              helperText={
                workflowOptionsTruncated
                  ? `Showing ${WORKFLOW_OPTION_CEILING} workflows, ordered ` +
                    'by id. This site has more, so one of them is not ' +
                    'offered here.'
                  : undefined
              }
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
            color="primary"
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
