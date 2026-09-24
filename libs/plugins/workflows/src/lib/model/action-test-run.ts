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

/**
 * THE ACTIONS CARD'S TEST RUN (AGL-3309), as both ends of it spell it.
 *
 * Pure and client-safe: the card posts to the path, and the console route
 * registers at it and builds the payload the action's steps see.
 */

/** The console door, under the plugin's `automations` API prefix. */
export const ACTION_TEST_RUN_API_ROUTE = 'automations/actions/test-run'

/** The page a test run reports when the caller names none. */
export const ACTION_TEST_RUN_PATH = '/console-test'

/** A payload field name: an identifier, as the page runtime's dispatch takes one. */
const PAYLOAD_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/

/** How many of the caller's fields are read. */
const PAYLOAD_MAX_FIELDS = 20

/** How long one field's value may be. */
const PAYLOAD_MAX_VALUE_LENGTH = 500

/**
 * The payload a test run's steps see.
 *
 * The caller's fields, bounded as the page runtime's dispatch bounds a
 * visitor's — identifier names, twenty at most, each value cut to 500
 * characters — over a sample `path`, and `test: 'true'` whatever the caller
 * sent, so a filter, a condition or a step's template can tell a test from a
 * visitor and nothing can pass one off as the other.
 */
export function actionTestRunPayload(raw: unknown): Record<string, string> {
  const payload: Record<string, string> = { path: ACTION_TEST_RUN_PATH }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw).slice(0, PAYLOAD_MAX_FIELDS)) {
      if (PAYLOAD_KEY.test(key)) {
        payload[key] = String(value).slice(0, PAYLOAD_MAX_VALUE_LENGTH)
      }
    }
  }
  payload['test'] = 'true'
  return payload
}
