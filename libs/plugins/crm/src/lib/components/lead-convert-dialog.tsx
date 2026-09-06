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

import * as Aglyn from '@aglyn/aglyn'
import type { CrmDealStage, CrmLeadFields } from '@aglyn/aglyn'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreCollection,
  useUser,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  documentId,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  dollarsToCents,
  suggestCompanyForLead,
} from '../model/lead-company-suggestion'
import { crmRoutes } from '../model/crm-routes'
import type { LeadConvertRequest, LeadConvertResponse } from '../server/lead-convert'
import type { OrgMemberOptions } from '../hooks/use-org-member-options'
import { LeadOwnerSelect } from './lead-owner-select'

/**
 * How many companies the picker loads. Ordered by name, so a bigger org sees
 * its first two hundred alphabetically and the domain match still finds the
 * right one when it is among them; past that the converter creates and the
 * route dedupes by domain server-side, which is the backstop this ceiling
 * relies on.
 */
const COMPANY_OPTIONS_CEILING = 200

type CompanyMode = 'none' | 'existing' | 'new'

export interface LeadConvertDialogProps {
  open: boolean
  onClose: () => void
  hostId: string
  orgId: string | null
  org: Record<string, unknown> | null | undefined
  leadId: string
  lead: Record<string, unknown> & CrmLeadFields
  basePath: string
  roster: OrgMemberOptions
}

/**
 * Convert a lead into a contact, and optionally a company and a deal
 * (AGL-2608).
 *
 * The dialog collects the decisions and posts ONE request to
 * `crm/lead-convert`; it writes nothing itself, because the contact can only
 * come from the server's dedupe door and the rest of the conversion has to
 * follow it in order. What it does own is the suggestion: the company the
 * lead's email domain implies, matched against the companies this reader can
 * see, so the common case is a glance and a click.
 *
 * Both reads open only while the dialog is — a converter who never opens it
 * pays for neither the company list nor the pipeline.
 */
export function LeadConvertDialog(props: LeadConvertDialogProps) {
  const { open, onClose, hostId, orgId, org, leadId, lead, basePath, roster } = props
  const firestore = useFirestore()
  const router = useRouter()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()

  /*
   * The scope this reader may see — the same tokens every CRM listener
   * filters on, and the rules refuse a list without them.
   */
  const visibleToTokens = useMemo(() => {
    const group = Aglyn.consentGroupForHost(org ?? {}, hostId)
    return [
      Aglyn.ORG_SCOPE_TOKEN,
      ...group.hostIds.map((id) => Aglyn.hostScopeToken(id)),
    ].slice(0, Aglyn.MAX_SCOPE_HOSTS)
  }, [org, hostId])
  const tokensKey = visibleToTokens.join(',')

  const { data: companies, status: companiesStatus } = useFirestoreCollection<
    Record<string, unknown> & { $id: string; name?: string; domain?: string }
  >(
    () =>
      open && orgId
        ? query(
            collection(firestore, 'orgs', orgId, Aglyn.CRM_COLLECTIONS.companies),
            where('visibleTo', 'array-contains-any', visibleToTokens),
            orderBy('nameLower'),
            limit(COMPANY_OPTIONS_CEILING),
          )
        : null,
    [firestore, orgId, open, tokensKey],
    { idField: '$id' },
  )
  const { data: pipelines } = useFirestoreCollection<
    Record<string, unknown> & { $id: string; isDefault?: boolean; stages?: CrmDealStage[] }
  >(
    () =>
      open && orgId
        ? query(
            collection(firestore, 'orgs', orgId, Aglyn.CRM_COLLECTIONS.pipelines),
            where('visibleTo', 'array-contains-any', visibleToTokens),
            orderBy(documentId()),
            limit(20),
          )
        : null,
    [firestore, orgId, open, tokensKey],
    { idField: '$id' },
  )
  /*
   * The pipeline the deal will open in — the route's own choice, mirrored so
   * the stage picker offers the stages the deal will really have: the flagged
   * default, else the first by id, else the stages the route will seed.
   */
  const pipeline = pipelines.find((entry) => entry.isDefault) ?? pipelines[0]
  const stages = useMemo(
    () =>
      [...(pipeline?.stages ?? Aglyn.DEFAULT_DEAL_STAGES)]
        .filter((stage) => stage.kind === 'open')
        .sort((a, b) => a.order - b.order),
    [pipeline],
  )

  const email = String(lead['email'] ?? '')
  const leadLabel = String(lead['name'] || email || leadId)

  const [ownerUid, setOwnerUid] = useState('')
  const [companyMode, setCompanyMode] = useState<CompanyMode>('none')
  const [companyId, setCompanyId] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [companyDomain, setCompanyDomain] = useState('')
  const [dealOn, setDealOn] = useState(false)
  const [dealTitle, setDealTitle] = useState('')
  const [dealAmount, setDealAmount] = useState('')
  const [dealCurrency, setDealCurrency] = useState('usd')
  const [dealStageId, setDealStageId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The labels' ids, so the two comboboxes are named "Company" and "Stage"
  // rather than after whatever they show — see `LeadOwnerSelect`.
  const companyLabelId = useId()
  const stageLabelId = useId()

  /*
   * Reset on every open, and seed the company step ONCE per open when the
   * company list has answered — not on every snapshot, or a converter who
   * changed their mind would have the suggestion put back under them.
   */
  const seededFor = useRef<string | null>(null)
  useEffect(() => {
    if (!open) {
      seededFor.current = null
      return
    }
    setOwnerUid(String(lead.ownerUid ?? user?.uid ?? ''))
    setDealOn(false)
    setDealTitle(leadLabel)
    setDealAmount('')
    setDealCurrency('usd')
    setDealStageId('')
    setError(null)
    setCompanyMode('none')
    setCompanyId('')
    setCompanyName('')
    setCompanyDomain('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadId])
  useEffect(() => {
    if (!open || companiesStatus !== 'success') return
    if (seededFor.current === leadId) return
    seededFor.current = leadId
    const suggestion = suggestCompanyForLead(email, companies)
    setCompanyMode(suggestion.mode)
    if (suggestion.mode === 'existing') setCompanyId(suggestion.companyId)
    if (suggestion.mode === 'new') {
      setCompanyName(suggestion.name)
      setCompanyDomain(suggestion.domain)
    }
  }, [open, companiesStatus, companies, email, leadId])

  const amountCents = dollarsToCents(dealAmount)
  const amountInvalid = amountCents === undefined
  const submittable =
    !busy &&
    (companyMode !== 'new' || companyName.trim().length > 0) &&
    (companyMode !== 'existing' || Boolean(companyId)) &&
    (!dealOn || (dealTitle.trim().length > 0 && !amountInvalid))

  const submit = async () => {
    if (!submittable) return
    setBusy(true)
    setError(null)
    const body: LeadConvertRequest = {
      hostId,
      leadId,
      ...(ownerUid ? { ownerUid } : {}),
      ...(companyMode === 'existing' ? { companyId } : {}),
      ...(companyMode === 'new'
        ? {
            createCompany: {
              name: companyName.trim(),
              ...(companyDomain.trim() ? { domain: companyDomain.trim() } : {}),
            },
          }
        : {}),
      ...(dealOn
        ? {
            deal: {
              title: dealTitle.trim(),
              ...(typeof amountCents === 'number' ? { amountCents } : {}),
              currency: dealCurrency.trim().toLowerCase() || 'usd',
              ...(dealStageId ? { stageId: dealStageId } : {}),
            },
          }
        : {}),
    }
    try {
      const response = await authorizedFetch(user, '/api/crm/lead-convert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const answer = (await response.json().catch(() => ({}))) as
        | LeadConvertResponse
        | { error?: string }
      if (!response.ok || !('ok' in answer)) {
        setError(
          String((answer as { error?: string }).error ?? 'The lead could not be converted.'),
        )
        return
      }
      enqueueSnackbar(
        answer.alreadyConverted
          ? 'This lead was already converted — opening the contact'
          : 'Lead converted',
        { variant: 'success', persist: false },
      )
      onClose()
      router.push(crmRoutes(basePath).contact(answer.contactId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The lead could not be converted.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{`Convert ${leadLabel}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <Stack spacing={1}>
            <Typography variant="subtitle2">{'Contact'}</Typography>
            <Typography variant="body2" color="text.secondary">
              {`${email} becomes a contact at the Sales qualified stage — or ` +
                'joins the one this address already has.'}
            </Typography>
            <LeadOwnerSelect value={ownerUid} onChange={setOwnerUid} roster={roster} />
          </Stack>
          <Divider />
          <Stack spacing={1}>
            <Typography variant="subtitle2">{'Company'}</Typography>
            <RadioGroup
              value={companyMode}
              onChange={(event) => setCompanyMode(event.target.value as CompanyMode)}
            >
              <FormControlLabel value="none" control={<Radio size="small" />} label="No company" />
              <FormControlLabel
                value="existing"
                control={<Radio size="small" />}
                label="Link an existing company"
                disabled={companies.length === 0}
              />
              <FormControlLabel
                value="new"
                control={<Radio size="small" />}
                label="Create a company"
              />
            </RadioGroup>
            {companyMode === 'existing' ? (
              <FormControl size="small" fullWidth>
                <InputLabel id={companyLabelId}>{'Company'}</InputLabel>
                <Select
                  labelId={companyLabelId}
                  label="Company"
                  value={companyId}
                  onChange={(event) => setCompanyId(String(event.target.value))}
                >
                  {companies.map((company) => (
                    <MenuItem key={company.$id} value={company.$id}>
                      {String(company.name ?? company.$id)}
                      {company.domain ? (
                        <Typography
                          component="span"
                          variant="caption"
                          color="text.secondary"
                          sx={{ ml: 1 }}
                        >
                          {String(company.domain)}
                        </Typography>
                      ) : null}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : null}
            {companyMode === 'new' ? (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                  size="small"
                  label="Company name"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 120 } }}
                />
                <TextField
                  size="small"
                  label="Domain"
                  value={companyDomain}
                  onChange={(event) => setCompanyDomain(event.target.value)}
                  helperText="Used to match future contacts to this company"
                  fullWidth
                />
              </Stack>
            ) : null}
          </Stack>
          <Divider />
          <Stack spacing={1}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={dealOn}
                  onChange={(event) => setDealOn(event.target.checked)}
                />
              }
              label={<Typography variant="subtitle2">{'Open a deal'}</Typography>}
            />
            {dealOn ? (
              <Stack spacing={1}>
                <TextField
                  size="small"
                  label="Deal title"
                  value={dealTitle}
                  onChange={(event) => setDealTitle(event.target.value)}
                  fullWidth
                  slotProps={{ htmlInput: { maxLength: 200 } }}
                />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <TextField
                    size="small"
                    label="Amount"
                    value={dealAmount}
                    onChange={(event) => setDealAmount(event.target.value)}
                    error={amountInvalid}
                    helperText={amountInvalid ? 'Enter an amount like 1200 or 1,200.50' : ' '}
                    fullWidth
                  />
                  <TextField
                    size="small"
                    label="Currency"
                    value={dealCurrency}
                    onChange={(event) => setDealCurrency(event.target.value)}
                    helperText=" "
                    sx={{ width: { sm: 140 } }}
                    slotProps={{ htmlInput: { maxLength: 3 } }}
                  />
                </Stack>
                <FormControl size="small" fullWidth>
                  {/* `shrink`, because `displayEmpty` below draws the "First
                      stage" placeholder where an empty value would leave the
                      field blank — and a label that has not shrunk sits on
                      top of it. */}
                  <InputLabel id={stageLabelId} shrink>
                    {'Stage'}
                  </InputLabel>
                  <Select
                    labelId={stageLabelId}
                    label="Stage"
                    notched
                    value={dealStageId}
                    onChange={(event) => setDealStageId(String(event.target.value))}
                    displayEmpty
                  >
                    <MenuItem value="">
                      <em>{stages[0] ? `First stage (${stages[0].name})` : 'First stage'}</em>
                    </MenuItem>
                    {stages.map((stage) => (
                      <MenuItem key={stage.id} value={stage.id}>
                        {stage.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                {!pipeline ? (
                  <Typography variant="caption" color="text.secondary">
                    {'This workspace has no pipeline yet — a Sales pipeline ' +
                      'with the default stages is created with the deal.'}
                  </Typography>
                ) : null}
              </Stack>
            ) : null}
          </Stack>
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={!submittable}>
          {busy ? 'Converting…' : 'Convert'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
LeadConvertDialog.displayName = 'LeadConvertDialog'

export default LeadConvertDialog
