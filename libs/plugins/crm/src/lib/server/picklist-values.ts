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

import {
  consentGroupForHost,
  CONTACT_FACETS_FIELD,
  CRM_COLLECTIONS,
  CRM_CONTACT_FACET_KEYS_FIELD,
  CRM_LEAD_SOURCE_PICKLIST,
  type CrmPicklist,
  type CrmPicklistDefinition,
  type CrmPicklistId,
  type CrmPicklistObject,
  type CrmPicklistTarget,
  crmContactFacetKeys,
  crmPicklistDefinition,
  crmPicklistKey,
  crmPicklistValueByLabel,
  effectiveCrmPicklist,
  newResourceScopeFields,
  normalizeCrmPicklist,
  ORG_SCOPE_TOKEN,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldPath, FieldValue } from 'firebase-admin/firestore'
import {
  addPicklistValue,
  deletePicklistValue,
  picklistKeepsGroups,
  type PicklistMove,
  type PicklistValuesResponse,
  renamePicklistValue,
  setPicklistValueGroup,
} from '../model/picklist-values'
import { orgHostIds, readCrmRouteScope } from './org-caller'
import { authorizeCrmWriter } from './task-routes'

/** What the suite gate names when a plan without the CRM asks. */
const suiteAct = (definition: CrmPicklistDefinition) =>
  `Editing the organization's ${definition.plural}`

/** The org subcollection each target object's records live in. */
const TARGET_COLLECTIONS: Record<CrmPicklistObject, string> = {
  contact: 'contacts',
  lead: 'leads',
  company: CRM_COLLECTIONS.companies,
  deal: CRM_COLLECTIONS.deals,
  task: CRM_COLLECTIONS.tasks,
}

/** Writes per batch — under Firestore's 500, with room to spare. */
const BATCH_SIZE = 400

/**
 * Set `field` to `to` (or remove it, for `null`) on every document `query`
 * finds holding `from`, a batch at a time, with `beside` written alongside.
 * Answers how many were written.
 *
 * The query is re-run after each batch rather than paged, because each
 * batch moves its documents OUT of the query's answer — the next run finds
 * only what is left, and a run that finds nothing is the end.
 */
async function replaceEverywhere(
  firestore: FirebaseFirestore.Firestore,
  query: FirebaseFirestore.Query,
  field: string | FirebaseFirestore.FieldPath,
  to: string | null,
  beside:
    | Record<string, unknown>
    | ((snapshot: FirebaseFirestore.QueryDocumentSnapshot) => Record<string, unknown>) = {},
): Promise<number> {
  let written = 0
  for (;;) {
    const page = await query.limit(BATCH_SIZE).get()
    if (page.empty) return written
    const batch = firestore.batch()
    for (const snapshot of page.docs) {
      const alongside = typeof beside === 'function' ? beside(snapshot) : beside
      batch.update(
        snapshot.ref,
        field,
        to ?? FieldValue.delete(),
        'updatedAt',
        FieldValue.serverTimestamp(),
        ...Object.entries(alongside).flat(),
      )
    }
    await batch.commit()
    written += page.size
    if (page.size < BATCH_SIZE) return written
  }
}

/**
 * Rewrite an ARRAY target (AGL-3521): every record whose `keyField` lists
 * the old label's key has each entry of `field` holding `from` at
 * `arrayKey` moved to `to` — or the entry's label removed, for `null` —
 * and its `keyField` restamped from the entries as moved. Answers how many
 * records were written.
 *
 * Paged by document id rather than re-run, because a rename that changes
 * only the label's case keeps its key, so a written record can stay in the
 * query's answer.
 */
async function replaceInArrayEverywhere(
  firestore: FirebaseFirestore.Firestore,
  records: FirebaseFirestore.CollectionReference,
  target: CrmPicklistTarget & { arrayKey: string; keyField: string },
  from: string,
  to: string | null,
): Promise<number> {
  const fromKey = crmPicklistKey(from)
  if (!fromKey) return 0
  const query = records
    .where(target.keyField, 'array-contains', fromKey)
    .orderBy(FieldPath.documentId())
    .limit(BATCH_SIZE)
  let written = 0
  let after: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (;;) {
    const page: FirebaseFirestore.QuerySnapshot = await (after ? query.startAfter(after) : query).get()
    if (page.empty) return written
    const batch = firestore.batch()
    let changed = 0
    for (const snapshot of page.docs) {
      const entries = snapshot.get(target.field)
      if (!Array.isArray(entries)) continue
      let moved = false
      const next = entries.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object') return entry
        const row = entry as Record<string, unknown>
        if (row[target.arrayKey] !== from) return entry
        moved = true
        const rest = { ...row }
        delete rest[target.arrayKey]
        return to === null ? rest : { ...rest, [target.arrayKey]: to }
      })
      if (!moved) continue
      const keys = new Set<string>()
      for (const entry of next) {
        const key =
          entry && typeof entry === 'object'
            ? crmPicklistKey((entry as Record<string, unknown>)[target.arrayKey])
            : null
        if (key) keys.add(key)
      }
      batch.update(snapshot.ref, {
        [target.field]: next,
        [target.keyField]: [...keys],
        updatedAt: FieldValue.serverTimestamp(),
      })
      changed += 1
    }
    if (changed) await batch.commit()
    written += changed
    if (page.size < BATCH_SIZE) return written
    after = page.docs[page.docs.length - 1] ?? null
  }
}

/** The group a label is filed under in `picklist` — `null` for none, or a label it does not hold. */
export function picklistGroupOf(picklist: CrmPicklist, label: string | null): string | null {
  return (label === null ? null : crmPicklistValueByLabel(picklist, label)?.group) ?? null
}

/**
 * Rewrite a target's GROUP field (AGL-3577) — a lead's
 * `leadSourceDirection` — on every record holding `label` in any spelling
 * (by its `keyField`) whose group is not `group` already. Answers how many
 * were written. The field is derived, like the list keys a restamp writes,
 * so `updatedAt` is left alone.
 *
 * Paged by document id rather than re-run: a record already holding the
 * group stays in the query's answer.
 */
export async function regroupEverywhere(
  firestore: FirebaseFirestore.Firestore,
  records: FirebaseFirestore.CollectionReference,
  target: CrmPicklistTarget,
  label: string,
  group: string | null,
): Promise<number> {
  const key = crmPicklistKey(label)
  if (!key || !target.keyField || !target.groupField) return 0
  const query = records
    .where(target.keyField, '==', key)
    .orderBy(FieldPath.documentId())
    .limit(BATCH_SIZE)
  let written = 0
  let after: FirebaseFirestore.QueryDocumentSnapshot | null = null
  for (;;) {
    const page: FirebaseFirestore.QuerySnapshot = await (after ? query.startAfter(after) : query).get()
    if (page.empty) return written
    const batch = firestore.batch()
    let changed = 0
    for (const snapshot of page.docs) {
      if (snapshot.get(target.groupField) === group) continue
      batch.update(snapshot.ref, { [target.groupField]: group })
      changed += 1
    }
    if (changed) await batch.commit()
    written += changed
    if (page.size < BATCH_SIZE) return written
    after = page.docs[page.docs.length - 1] ?? null
  }
}

/** A contact as it reads once one holder's facet field holds `to` (or nothing, for `null`). */
function withFacetValue(
  data: Record<string, unknown>,
  groupId: string,
  field: string,
  to: string | null,
): Record<string, unknown> {
  const facets = { ...((data[CONTACT_FACETS_FIELD] as Record<string, unknown> | undefined) ?? {}) }
  const facet = { ...((facets[groupId] as Record<string, unknown> | undefined) ?? {}) }
  if (to === null) delete facet[field]
  else facet[field] = to
  facets[groupId] = facet
  return { ...data, [CONTACT_FACETS_FIELD]: facets }
}

/**
 * `POST crm/picklist-values` — rename a value of one of the CRM's standard
 * picklists, or delete an added one and move its records to another
 * (AGL-3298, AGL-3510). `crm/lead-source-values` is the same route with the
 * picklist fixed to the lead source.
 *
 * Body: `{ hostId | orgId, picklistId, action: 'rename', valueId, label }` or
 * `{ hostId | orgId, picklistId, action: 'delete', valueId, replaceWith: label | null }`,
 * and, on a list whose records keep the value's group (`picklistKeepsGroups`,
 * AGL-3577), `{ …, action: 'group', valueId, group: id | null }` or
 * `{ …, action: 'add', label, group?, meaning? }`.
 * `picklistId` is one of `CRM_PICKLIST_DEFINITIONS`; anything else is refused.
 *
 * ## A value's group on its records
 *
 * A lead keeps its lead source's group as `leadSourceDirection` — the field
 * the Leads list's direction filter asks. Any move can change the group a
 * label has: a regroup, an add of a value records already hold, a rename
 * onto such a label, a delete. So after the move, every target naming a
 * `groupField` has it rewritten on the records holding the old label and
 * the new one, from the list as it now stands.
 *
 * Records store the value's LABEL (see the picklist block in `crm.ts`), so
 * both moves change records as well as the list: every record the
 * definition's `targets` name that holds the old label is rewritten to the
 * new one — or, for a delete with no replacement, cleared. That is
 * Salesforce's Replace, done as part of the move, so a report grouped by
 * the field follows a rename instead of splitting into the old name and
 * the new. A standard value cannot be deleted, and on a definition with
 * meanings a delete's replacement must mean the same (see
 * `deletePicklistValue`).
 *
 * ## The list first, then the records
 *
 * The list is written in a transaction before any record: from that moment
 * no picker offers the old label and no import or API write accepts it, so
 * the sweep that follows cannot be outrun by a new record taking the name
 * it is removing. A sweep interrupted part-way leaves records holding a
 * label the list no longer has, which they show as "(not in the list)"; the
 * same request sent again finishes it, because the rename of a value to its
 * own current label is a no-op on the list and still sweeps.
 *
 * ## Who may
 *
 * Whoever may write the CRM — `authorizeCrmWriter`, the question every CRM
 * route asks — which is who the rules let edit the list itself. The sweep
 * reaches every record in the org whatever the caller's scope: it changes
 * one label to another that the same caller could already have picked, and
 * reveals nothing about the records but their count.
 */
function picklistValuesHandler(fixed?: CrmPicklistId): PluginApiHandler {
  return async (req, res) => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      res.status(405).json({ error: 'Method not allowed' })
      return
    }
    const body = (req.body ?? {}) as Record<string, unknown>
    const scope = readCrmRouteScope(body)
    if (!scope) {
      res.status(400).json({ error: 'Missing hostId' })
      return
    }
    const definition = crmPicklistDefinition(fixed ?? body['picklistId'])
    if (!definition) {
      res.status(400).json({ error: 'Name one of the CRM’s picklists.' })
      return
    }
    const picklistId = definition.id as CrmPicklistId
    const action = body['action']
    const valueId = String(body['valueId'] ?? '').trim().slice(0, 64)
    const regrouping = action === 'group' || action === 'add'
    if (regrouping && !picklistKeepsGroups(definition)) {
      res.status(400).json({ error: `The ${definition.plural} are added and grouped on the Fields page.` })
      return
    }
    if (
      !(action === 'rename' || action === 'delete' || regrouping) ||
      (action === 'add' ? !String(body['label'] ?? '').trim() : !valueId)
    ) {
      res.status(400).json({ error: 'Name a value, and whether to rename or delete it.' })
      return
    }
    const asGroup = (raw: unknown) => (typeof raw === 'string' && raw ? raw : null)
    const replaceWith =
      body['replaceWith'] === null || body['replaceWith'] === undefined
        ? null
        : String(body['replaceWith'])

    try {
      const writer = await authorizeCrmWriter(req, scope, { suiteAct: suiteAct(definition) })
      if (writer.ok === false) {
        res.status(writer.status).json(writer.body)
        return
      }
      const firestore = firebaseAdmin.app().firestore()
      const orgRef = firestore.collection('orgs').doc(writer.orgId)
      const listRef = orgRef.collection(CRM_COLLECTIONS.picklists).doc(picklistId)

      /*
       * THE LIST. Read and written in one transaction, so two admins editing
       * at once cannot each write a list missing the other's change.
       */
      const moved = await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(listRef)
        const before: CrmPicklist = effectiveCrmPicklist(picklistId, snapshot.data())
        const value =
          action === 'add' ? null : before.values.find((entry) => entry.id === valueId)
        if (action !== 'add' && !value) {
          return { ok: false as const, error: 'That value is no longer in the list.' }
        }
        const move: PicklistMove =
          action === 'add'
            ? addPicklistValue(definition, before, String(body['label'] ?? ''), {
                group: asGroup(body['group']),
                meaning: asGroup(body['meaning']),
              })
            : action === 'group'
              ? { ok: true, picklist: setPicklistValueGroup(definition, before, valueId, asGroup(body['group'])) }
              : action === 'rename'
                ? renamePicklistValue(before, valueId, String(body['label'] ?? ''))
                : deletePicklistValue(definition, before, valueId, replaceWith)
        if (move.ok === false) return move
        const created = normalizeCrmPicklist(snapshot.data()) === null
        transaction.set(
          listRef,
          {
            values: move.picklist.values,
            defaultValueId: move.picklist.defaultValueId,
            updatedAt: FieldValue.serverTimestamp(),
            // The stamp every org-wide CRM document carries (see the Fields
            // page), written when this move is what creates the document.
            ...(created
              ? {
                  hostId: scope.hostId || null,
                  createdAt: FieldValue.serverTimestamp(),
                  ...newResourceScopeFields([ORG_SCOPE_TOKEN]),
                }
              : {}),
          },
          { merge: true },
        )
        // A regroup and an add move no label: `from` and `to` are the value's own.
        const own =
          action === 'add'
            ? (move.picklist.values[move.picklist.values.length - 1]?.label ?? '')
            : (value?.label ?? '')
        const to =
          action === 'rename'
            ? (move.picklist.values.find((entry) => entry.id === valueId)?.label ?? null)
            : regrouping
              ? own
              : replaceWith === null
                ? null
                : (move.picklist.values.find(
                    (entry) => entry.label.toLowerCase() === replaceWith.trim().toLowerCase(),
                  )?.label ?? null)
        return { ok: true as const, from: regrouping ? own : (value?.label ?? ''), to, after: move.picklist }
      })
      if (moved.ok === false) {
        res.status(400).json({ error: moved.error })
        return
      }

      /*
       * THE RECORDS, target by target: a record's own field, with its query
       * key moved beside it; for an array target, each entry of a record's
       * list (a deal's contact roles); or, for a facet target, each holder's
       * facet on a contact — one query per consent group the org's sites
       * belong to.
       * A rename to the same label moves nothing, and says so.
       */
      const updated: PicklistValuesResponse['updated'] = {}
      let groupIds: string[] | null = null
      for (const target of definition.targets) {
        updated[target.object] ??= 0
        if (target.groupField && !target.facet && !target.arrayKey) {
          // The group each label now has, on every record holding either (AGL-3577).
          const labels = new Map<string, string>()
          for (const label of [moved.from, moved.to]) {
            const key = label === null ? null : crmPicklistKey(label)
            if (key && label !== null) labels.set(key, label)
          }
          const regroup = async () => {
            for (const label of labels.values()) {
              updated[target.object] =
                (updated[target.object] ?? 0) +
                (await regroupEverywhere(
                  firestore,
                  orgRef.collection(TARGET_COLLECTIONS[target.object]),
                  target,
                  label,
                  picklistGroupOf(moved.after, label),
                ))
            }
          }
          if (moved.from === moved.to) {
            await regroup()
            continue
          }
          updated[target.object] =
            (updated[target.object] ?? 0) +
            (await replaceEverywhere(
              firestore,
              orgRef.collection(TARGET_COLLECTIONS[target.object]).where(target.field, '==', moved.from),
              target.field,
              moved.to,
              {
                ...(target.keyField ? { [target.keyField]: crmPicklistKey(moved.to) } : {}),
                [target.groupField]: picklistGroupOf(moved.after, moved.to),
              },
            ))
          await regroup()
          continue
        }
        if (moved.from === moved.to) continue
        const records = orgRef.collection(TARGET_COLLECTIONS[target.object])
        if (target.arrayKey && target.keyField) {
          updated[target.object] =
            (updated[target.object] ?? 0) +
            (await replaceInArrayEverywhere(
              firestore,
              records,
              { ...target, arrayKey: target.arrayKey, keyField: target.keyField },
              moved.from,
              moved.to,
            ))
          continue
        }
        if (target.facet) {
          if (!groupIds) {
            const hostIds = await orgHostIds(firestore, writer.orgId)
            groupIds = [
              ...new Set(hostIds.map((hostId) => consentGroupForHost(writer.org, hostId).groupId)),
            ].filter(Boolean)
          }
          for (const groupId of groupIds) {
            const path = new FieldPath(CONTACT_FACETS_FIELD, groupId, target.field)
            updated[target.object] =
              (updated[target.object] ?? 0) +
              (await replaceEverywhere(
                firestore,
                records.where(path, '==', moved.from),
                path,
                moved.to,
                // A facet value a contact list filters by is keyed in
                // `facetKeys` (AGL-3511), restamped from the record as moved.
                (snapshot) => ({
                  [CRM_CONTACT_FACET_KEYS_FIELD]: crmContactFacetKeys(
                    withFacetValue(snapshot.data(), groupId, target.field, moved.to),
                  ),
                }),
              ))
          }
          continue
        }
        updated[target.object] =
          (updated[target.object] ?? 0) +
          (await replaceEverywhere(
            firestore,
            records.where(target.field, '==', moved.from),
            target.field,
            moved.to,
            target.keyField ? { [target.keyField]: crmPicklistKey(moved.to) } : {},
          ))
      }
      const answer: PicklistValuesResponse = { ok: true, updated }
      res.status(200).json(answer)
    } catch (error) {
      console.error('[crm] picklist-values failed', error)
      res.status(500).json({ error: `The ${definition.plural} could not be saved.` })
    }
  }
}

/** `POST crm/picklist-values` — any registered picklist, named by `picklistId`. */
export const crmPicklistValuesHandler: PluginApiHandler = picklistValuesHandler()

/** `POST crm/lead-source-values` — the same route with the picklist fixed to the lead source. */
export const crmLeadSourceValuesHandler: PluginApiHandler =
  picklistValuesHandler(CRM_LEAD_SOURCE_PICKLIST)
