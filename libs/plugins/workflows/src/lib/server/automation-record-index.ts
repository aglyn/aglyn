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

import type {
  PluginIndexedRecord,
  PluginRecordIndex,
} from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import {
  AUTOMATION_COLLECTIONS,
  automationIndexedRecord,
  type AutomationRecordKind,
} from '../model/automation-record'

/**
 * The workflows plugin's record indexes (AGL-3080): a site's workflows,
 * webhooks and actions, as another surface reads them — an AI job drafting an
 * automation that names a workflow, the "Used by" scan asking which workflows
 * call a function — without knowing where they are stored or what a deleted
 * one looks like.
 *
 * All three are a SITE's (`hostId` required; an org-only scope answers
 * nothing). Each record is `automationIndexedRecord`'s
 * (`model/automation-record.ts`), which leaves out a deleted record and
 * documents the facts each kind shares.
 */

function hostCollection(hostId: string, kind: AutomationRecordKind) {
  return firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection(AUTOMATION_COLLECTIONS[kind])
}

function indexOf(kind: AutomationRecordKind): PluginRecordIndex {
  return {
    async list({ hostId, limit }) {
      if (!hostId || limit <= 0) return { records: [], truncated: false }
      // One more than asked, so `truncated` is a fact rather than a guess;
      // deleted and unnamed records are filtered after the read.
      const snapshot = await hostCollection(hostId, kind).limit(limit + 1).get()
      const records = snapshot.docs
        .map((doc) => automationIndexedRecord(kind, doc.id, doc.data()))
        .filter((record): record is PluginIndexedRecord => record !== null)
      return { records: records.slice(0, limit), truncated: snapshot.size > limit }
    },
    async get({ hostId, id }) {
      if (!hostId || !id) return null
      const snapshot = await hostCollection(hostId, kind).doc(id).get()
      return snapshot.exists ? automationIndexedRecord(kind, snapshot.id, snapshot.data()) : null
    },
  }
}

export const workflowRecordIndex = indexOf('workflow')
export const webhookRecordIndex = indexOf('webhook')
export const actionRecordIndex = indexOf('action')
