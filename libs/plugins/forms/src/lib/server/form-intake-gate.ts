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
  checkFormSubmissionAbuseCeiling,
  checkFormSubmissionQuota,
  isHostPluginEnabled,
  submissionMonthKey,
} from '@aglyn/aglyn/server'
import type { PluginIntakeGate } from '@aglyn/aglyn/plugin-manager/plugin-intake-gates'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { BUNDLE_ID } from '../constants/bundle-common'

/**
 * The form door, asked without writing (AGL-2586, AGL-3080).
 *
 * The gates `POST /api/forms/submit` clears before its first write that are
 * this plugin's, in the order it clears them, through the same functions: the
 * site's Forms switch (AGL-3029), the plan's monthly allowance (a wall on
 * Free, a meter on the plans that carry the infra pass-through, AGL-1280) and
 * the ceiling that contains a flood (AGL-1655), the last two over the month's
 * count the route reads. The funnel probe on `/api/health/funnel` asks this
 * through `plugin-intake-gates`, so its verdict is the route's predicates
 * about the real documents, and it writes nothing.
 *
 * The door is judged by this plugin's switch alone: the probe asks about a
 * form, and a Marketing popup's capture through the same door is the route's
 * to judge by its own plugin.
 */
export const formIntakeGate: PluginIntakeGate = async ({ hostId, host, org }) => {
  if (!isHostPluginEnabled(org as never, host as never, BUNDLE_ID)) return 'switched-off'
  const counter = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('counters')
    .doc('formSubmissions')
    .get()
  const used = Number(counter.get(submissionMonthKey()) ?? 0)
  if (!checkFormSubmissionQuota(org as never, used).allowed) return 'plan-exhausted'
  if (checkFormSubmissionAbuseCeiling(org as never, used).exceeded) return 'flood-ceiling'
  return 'open'
}
