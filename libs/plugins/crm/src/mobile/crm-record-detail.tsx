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

import { CRM_ACTIVITY_KIND_LABELS, type CrmActivityKind, crmLeadStatus, type CrmLeadFields } from '@aglyn/aglyn/app-utils/crm'
import { useLiveDoc } from '@aglyn/mobile-core'
import type { MobilePluginContext } from '@aglyn/mobile-plugin-host'
import { Button, Card, Chip, EmptyState, Field, ListRow, Screen, Skeleton, Text, useMobileTheme } from '@aglyn/mobile-ui'
import { useMemo, useState } from 'react'
import { Alert, Linking, View } from 'react-native'
import { leadPrimaryGroup } from '../lib/model/contact-holder'
import { openStages } from '../lib/model/deal-board-model'
import { CRM_LIST_COLLECTIONS, type CrmListKind } from './crm-lists'
import { CRM_SCOPE_GAP_COPY, type CrmMobileScope, crmCreateStamp, crmMobileCanWrite, crmSuiteIncluded, isCrmMobileScope } from './crm-mobile-scope'
import {
  contactGroupFor,
  crmDate,
  crmFacts,
  crmReach,
  crmStatusLabel,
  crmTitle,
  dialable,
  type CrmPresentContext,
} from './crm-present'
import { CrmSuiteLocked } from './crm-suite-locked'
import { DealLostSheet, LeadStatusSheet, NoteSheet, type LeadStatusPick } from './crm-sheets'
import {
  addCrmNote,
  crmErrorMessage,
  moveDeal,
  setLeadStatus,
  unqualifyLead,
  type CrmNoteLink,
  type DealStageRequest,
} from './crm-writes'
import { CRM_RECORD_SCREENS } from './screen-ids'
import { useCrmActivities } from './use-crm-activities'
import type { CrmRow } from './use-crm-list'
import { useCrmMobileScope } from './use-crm-mobile-scope'
import { useCrmPipelines, useCrmRoster, useLeadStatusPicklist } from './use-crm-reads'

/*
 * ONE CRM RECORD (AGL-3622): what the console's record page heads with —
 * the name, the status or stage, the owner, the ways to reach the person
 * and the dates — the status controls the console offers, the record's
 * activity log under the reader's scope, and a note logged to it. Shared by
 * the phone's pushed screen and the tablet's split detail.
 */

const NOTE_LINK_FIELD: Readonly<Record<CrmListKind, string>> = {
  leads: 'leadId',
  contacts: 'contactId',
  companies: 'companyId',
  deals: 'dealId',
}

/** The record a note is filed against, from the page it is written on. */
export const crmNoteLink = (kind: CrmListKind, id: string): CrmNoteLink =>
  ({ [NOTE_LINK_FIELD[kind]]: id }) as CrmNoteLink

/** The site a record created from this page is captured by: the mounted one, else the record's own. */
function recordHostId(kind: CrmListKind, row: Record<string, unknown>, org: Record<string, unknown> | null): string | null {
  if (kind === 'leads') return leadPrimaryGroup(row, org).hostId || null
  if (kind === 'contacts') return contactGroupFor(row, null, org).hostId || null
  return typeof row['hostId'] === 'string' && row['hostId'] ? row['hostId'] : null
}

export interface CrmRecordDetailProps {
  kind: CrmListKind
  id: string
  context: MobilePluginContext
  /** The site a link named, when it is not the picked one (a notification's `/{hostId}/crm/…`). */
  hostId?: string | null
}

export function CrmRecordDetail({ kind, id, context, hostId: linkedHostId }: CrmRecordDetailProps) {
  const theme = useMobileTheme()
  const hostId = linkedHostId ?? context.hostId
  const { scope, access, org } = useCrmMobileScope(context.firestore, context.orgId, hostId, context.uid)
  // Nothing is read until the plan is known to carry the CRM.
  const included = crmSuiteIncluded(org)
  const ready = isCrmMobileScope(scope) && included === true
  const record = useLiveDoc<Record<string, unknown>>(
    context.firestore,
    context.orgId && included ? ['orgs', context.orgId, CRM_LIST_COLLECTIONS[kind], id] : null,
  )
  const row = record.data as CrmRow | null
  const roster = useCrmRoster(context.api, included ? context.orgId : null, context.uid)
  const statuses = useLeadStatusPicklist(context.firestore, included && kind === 'leads' ? context.orgId : null)
  const crmScope = ready ? (scope as CrmMobileScope) : null
  const readTokens = crmScope ? crmScope.visibleTo : undefined
  const pipelines = useCrmPipelines(context.firestore, kind === 'deals' ? context.orgId : null, readTokens)
  const link = useMemo(() => crmNoteLink(kind, id), [kind, id])
  const activities = useCrmActivities(context.firestore, context.orgId, link, readTokens)
  const canWrite = crmMobileCanWrite(access.role)
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<'status' | 'lost' | 'note' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const present: CrmPresentContext = {
    leadStatuses: statuses.picklist,
    viewing: crmScope ? crmScope.consentGroup : null,
    org,
    pipelineById: pipelines.byId,
    ownerLabel: roster.labelFor,
  }

  if (included === false) return <CrmSuiteLocked context={context} />
  if (!context.orgId || (!isCrmMobileScope(scope) && scope !== 'loading')) {
    const gap = CRM_SCOPE_GAP_COPY[isCrmMobileScope(scope) ? 'loading' : scope]
    return <EmptyState icon="people-outline" title={gap.title} body={gap.body} />
  }
  if (!record.ready) {
    return (
      <View style={{ padding: theme.space(2), gap: theme.space(1.5) }} testID="crm-record-loading">
        <Skeleton height={28} width="60%" />
        <Skeleton height={16} />
        <Skeleton height={16} />
      </View>
    )
  }
  if (record.error || !row) {
    return (
      <EmptyState
        icon="warning-outline"
        title={record.error ? 'This record could not be loaded' : 'This record no longer exists'}
        body={record.error ? 'It may be outside the sites you can open.' : undefined}
      />
    )
  }

  const title = crmTitle(kind, row, present)
  const reach = crmReach(kind, row, present)
  const facts = crmFacts(kind, row, present)
  const site = crmScope ? crmScope.hostId : null
  const consolePath = `/crm/${kind}/${encodeURIComponent(id)}`

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true)
    setNotice(null)
    try {
      await work()
      setSheet(null)
      setNotice(done)
    } catch (error) {
      Alert.alert('Not saved', crmErrorMessage(error, 'The record could not be updated.'))
    } finally {
      setBusy(false)
    }
  }

  const pickLeadStatus = (pick: LeadStatusPick) => {
    const orgId = context.orgId as string
    if (pick.kind === 'unqualify') {
      void run(
        () =>
          unqualifyLead({
            firestore: context.firestore,
            api: context.api,
            orgId,
            hostId: site,
            leadId: id,
            statusLabel: pick.statusLabel,
            reason: pick.reason,
          }),
        `Lead marked ${pick.statusLabel}`,
      )
      return
    }
    const status = pick.choice.status
    if (status === 'unqualified' || status === 'qualified') return
    void run(
      () =>
        setLeadStatus({
          firestore: context.firestore,
          api: context.api,
          orgId,
          hostId: site,
          leadId: id,
          status,
          statusLabel: pick.choice.label,
          current: crmLeadStatus(row as Pick<CrmLeadFields, 'status'>),
        }),
      'Status updated',
    )
  }

  const stageCall = (request: DealStageRequest, done: string) =>
    void run(() => moveDeal({ api: context.api, hostId: site, orgId: context.orgId, deal: row, request }), done)

  const saveNote = (body: string) => {
    const stamp = crmCreateStamp(org, site ?? recordHostId(kind, row, org))
    if (!stamp) {
      Alert.alert('Not saved', 'This record names no site, so a note cannot be filed under it.')
      return
    }
    const self = roster.options.find((option) => option.uid === context.uid)
    void run(
      () =>
        addCrmNote({
          firestore: context.firestore,
          orgId: context.orgId as string,
          link,
          body,
          readTokens: crmScope ? crmScope.visibleTo : null,
          stamp,
          uid: context.uid,
          byName: self?.label ?? null,
        }),
      'Note saved',
    )
  }

  const reachButtons = (
    <View style={{ flexDirection: 'row', gap: theme.space(1) }}>
      {reach.phone ? (
        <Chip
          testID="crm-call"
          icon="call-outline"
          label={reach.doNotCall ? 'Call (asked not to)' : 'Call'}
          tone={reach.doNotCall ? 'warning' : 'default'}
          onPress={() => void Linking.openURL(`tel:${dialable(reach.phone)}`)}
        />
      ) : null}
      {reach.sms ? (
        <Chip
          testID="crm-text"
          icon="chatbubble-outline"
          label="Text"
          onPress={() => void Linking.openURL(`sms:${dialable(reach.sms)}`)}
        />
      ) : null}
      {reach.email ? (
        <Chip
          testID="crm-email"
          icon="mail-outline"
          label="Email"
          onPress={() => void Linking.openURL(`mailto:${reach.email}`)}
        />
      ) : null}
    </View>
  )

  const lead = kind === 'leads' ? (row as CrmRow & CrmLeadFields) : null
  const leadConverted = Boolean(lead?.convertedContactId)
  const deal = kind === 'deals' ? row : null
  const dealPipeline = deal ? pipelines.byId(deal['pipelineId']) : null
  const dealClosed = deal ? deal['status'] === 'won' || deal['status'] === 'lost' : false
  const stages = openStages(dealPipeline)

  return (
    <Screen>
      <Card
        title={title}
        actions={
          kind === 'leads' && canWrite && !leadConverted ? (
            <Button testID="crm-change-status" title="Change status" variant="text" onPress={() => setSheet('status')} />
          ) : null
        }
      >
        {kind !== 'companies' ? (
          <View style={{ flexDirection: 'row' }}>
            <Chip testID="crm-status" label={crmStatusLabel(kind, row, present) || 'No stage'} tone="primary" />
          </View>
        ) : null}
        {reach.phone || reach.email ? reachButtons : null}
        {facts.map((fact) => (
          <Field key={fact.label} label={fact.label} value={fact.value} testID={`crm-fact-${fact.label}`} />
        ))}
        {notice ? (
          <Text testID="crm-notice" tone="accent">
            {notice}
          </Text>
        ) : null}
      </Card>

      {deal ? (
        <Card
          title="Stage"
          actions={
            canWrite && !dealClosed && dealPipeline ? (
              <View style={{ flexDirection: 'row', gap: theme.space(1) }}>
                <Chip testID="deal-won" icon="trophy-outline" label="Won" tone="success" onPress={busy ? undefined : () => stageCall({ dealId: id, status: 'won' }, 'Deal won')} />
                <Chip testID="deal-lost" icon="thumbs-down-outline" label="Lost" tone="error" onPress={busy ? undefined : () => setSheet('lost')} />
              </View>
            ) : null
          }
        >
          {!dealPipeline ? (
            <Text tone="secondary">
              {pipelines.ready ? "This deal's pipeline no longer exists, so it has no stages to move through." : 'Loading the pipeline…'}
            </Text>
          ) : (
            <>
              {dealClosed ? (
                <Text tone="secondary">
                  {canWrite ? 'Reopening puts the deal back in an open stage and tells the automations.' : 'This deal is closed.'}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space(1) }}>
                {stages.map((stage) => (
                  <Chip
                    key={stage.id}
                    testID={`deal-stage-${stage.id}`}
                    label={stage.name}
                    selected={!dealClosed && stage.id === deal['stageId']}
                    onPress={
                      !canWrite || busy || (!dealClosed && stage.id === deal['stageId'])
                        ? undefined
                        : () => stageCall({ dealId: id, stageId: stage.id }, dealClosed ? 'Deal reopened' : `Moved to ${stage.name}`)
                    }
                  />
                ))}
              </View>
            </>
          )}
          {typeof deal['contactId'] === 'string' && deal['contactId'] ? (
            <ListRow
              testID="deal-contact"
              icon="person-outline"
              title="Contact"
              onPress={() => context.navigate(CRM_RECORD_SCREENS.contacts, { recordId: deal['contactId'] as string })}
            />
          ) : null}
          {typeof deal['companyId'] === 'string' && deal['companyId'] ? (
            <ListRow
              testID="deal-company"
              icon="business-outline"
              title="Company"
              onPress={() => context.navigate(CRM_RECORD_SCREENS.companies, { recordId: deal['companyId'] as string })}
            />
          ) : null}
        </Card>
      ) : null}

      <Card
        title="Activity"
        actions={canWrite ? <Button testID="crm-add-note" title="Add note" variant="text" onPress={() => setSheet('note')} /> : null}
      >
        {activities.error ? (
          <Text tone="error">The activity log could not be loaded.</Text>
        ) : !activities.ready ? (
          <Skeleton height={44} />
        ) : !activities.rows.length ? (
          <Text tone="secondary">A call, an email, a meeting or a note about this record goes here.</Text>
        ) : (
          activities.rows.map((activity) => (
            <View key={activity.$id} testID={`crm-activity-${activity.$id}`} style={{ gap: theme.space(0.25) }}>
              <Text variant="caption" tone="secondary">
                {[
                  CRM_ACTIVITY_KIND_LABELS[activity.kind as CrmActivityKind] ?? 'Activity',
                  activity.byName,
                  crmDate(typeof activity.atMs === 'number' ? activity.atMs : null),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <Text numberOfLines={6}>{activity.subject ? `${activity.subject}\n${activity.body}` : activity.body}</Text>
            </View>
          ))
        )}
        {activities.hasMore ? <Button title="Show more" variant="text" onPress={activities.showMore} /> : null}
      </Card>

      <Button
        title="Open in the console"
        variant="outlined"
        icon="open-outline"
        onPress={() => context.openConsolePath(consolePath, site ? 'site' : 'org')}
      />

      {lead ? (
        <LeadStatusSheet
          visible={sheet === 'status'}
          onClose={() => setSheet(null)}
          lead={lead}
          picklist={statuses.picklist}
          busy={busy}
          onPick={pickLeadStatus}
        />
      ) : null}
      {deal ? (
        <DealLostSheet
          visible={sheet === 'lost'}
          onClose={() => setSheet(null)}
          dealTitle={title}
          busy={busy}
          onConfirm={(reason) => stageCall({ dealId: id, status: 'lost', ...(reason ? { lostReason: reason } : {}) }, 'Deal marked lost')}
        />
      ) : null}
      <NoteSheet visible={sheet === 'note'} onClose={() => setSheet(null)} busy={busy} onSave={saveNote} />
    </Screen>
  )
}
