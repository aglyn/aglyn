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

// The two CRM contact events, from the trigger picker to the tag on the
// person (AGL-2610, AGL-2605).
//
// An action on *Contact created* that tags the contact `website`, built in
// the Actions editor; then a person added by hand from the contacts list,
// which goes through the capture door and fires the event; then the run in
// the action's Runs dialog and the tag on the facet. The same again for
// *Contact changed stage*, fired two ways: by the `crm/contact-stage` route
// called directly, and by the stage control on the contact's own page —
// which the docs promise fires it ("from the contact's page"), and which is
// the only path a person actually uses.
//
// Re-runnable: the two actions are removed by name and the person by
// address before the run, so the capture is a creation and the event fires.
//
// Prerequisites (see docs/E2E_LOCAL.md): emulators, `npm run seed:e2e`, and a
// console dev server carrying the emulator flags, pointed at by E2E_BASE_URL.
//
//   node tools/e2e/crm-automation.e2e.mjs

import { removeContactsAtAddress } from '../scripts/lib/crm-fixtures.mjs'
import {
  adminFirestore,
  cardNamed,
  expectSnackbar,
  HOST_ID,
  hostUrl,
  openConsole,
  ORG_ID,
  OWNER_UID,
  pickSelect,
  postAsUser,
  shot,
  step,
  TIMEOUT_MS,
  verdicts,
  waitFor,
} from './lib/console-session.mjs'

const PERSON = { email: 'rosa@fernwoodbistro.com', name: 'Rosa Lindqvist' }
const CREATED_ACTION = { name: 'Tag website inquiries', tag: 'website' }
const STAGED_ACTION = { name: 'Welcome new customers', tag: 'customer-welcome' }

const firestore = adminFirestore()
const hostRef = firestore.collection('hosts').doc(HOST_ID)
const orgRef = firestore.collection('orgs').doc(ORG_ID)

// ── Fixture reset ───────────────────────────────────────────────────────────
for (const action of [CREATED_ACTION, STAGED_ACTION]) {
  const stale = await hostRef.collection('actions').where('name', '==', action.name).get()
  for (const entry of stale.docs) await entry.ref.delete()
}
await removeContactsAtAddress(firestore, ORG_ID, PERSON.email)

const tally = verdicts()
const session = await openConsole()
const { page } = session

/** The person's document, by address, and this site's facet on it. */
const person = async () => {
  const found = await orgRef.collection('contacts').where('email', '==', PERSON.email).limit(1).get()
  const doc = found.docs[0]
  return doc ? { id: doc.id, facet: doc.get(`facets.${HOST_ID}`) ?? {} } : null
}
/**
 * The action document by name, once the create has landed WHOLE — the
 * editor's "Action saved" and the row in the list can both precede the
 * document a read from Node sees, and the create lands its name before its
 * trigger and steps, so the read is polled until the trigger is there.
 */
const storedAction = (name) =>
  waitFor(
    async () => (await hostRef.collection('actions').where('name', '==', name).limit(1).get()).docs[0]?.data() ?? null,
    (action) => Boolean(action?.trigger?.event),
  )
/** How many runs of an action succeeded, read off the host's activity feed. */
const succeededRuns = async (name) => {
  const action = (await hostRef.collection('actions').where('name', '==', name).limit(1).get()).docs[0]
  if (!action) return 0
  const runs = await hostRef.collection('activity').where('target.id', '==', action.id).get()
  return runs.docs.filter((entry) => entry.get('result') === 'succeeded').length
}

const addAction = async ({ name, tag }, trigger) => {
  await page.getByRole('button', { name: 'Add action' }).click({ timeout: TIMEOUT_MS })
  const dialog = page.getByRole('dialog', { name: 'Add action' })
  await dialog.getByLabel('Name').fill(name)
  await pickSelect(page, 'Trigger event', trigger, dialog)
  await pickSelect(page, 'Do', 'Tag the contact', dialog)
  await dialog.getByLabel('Tag').fill(tag)
  return dialog
}

await step(tally, page, 'an action on Contact created is saved', async () => {
  await page.goto(hostUrl('/automation/actions'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  const dialog = await addAction(CREATED_ACTION, 'Contact created')
  await shot(page, 'crm-automation-add-action')
  await dialog.getByRole('button', { name: 'Save action' }).click()
  await expectSnackbar(page, 'Action saved')
  await page.getByText(CREATED_ACTION.name, { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  const stored = await storedAction(CREATED_ACTION.name)
  tally.check(
    'an action on Contact created is saved',
    stored?.trigger?.event === 'contactCreated' &&
      stored?.steps?.[0]?.type === 'addContactTag' &&
      stored?.steps?.[0]?.tag === CREATED_ACTION.tag,
    JSON.stringify({ trigger: stored?.trigger?.event, steps: stored?.steps }),
  )
})

await step(tally, page, 'an action on Contact changed stage is saved', async () => {
  const dialog = await addAction(STAGED_ACTION, 'Contact changed stage')
  await dialog.getByRole('button', { name: 'Save action' }).click()
  await expectSnackbar(page, 'Action saved')
  await page.getByText(STAGED_ACTION.name, { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  const stored = await storedAction(STAGED_ACTION.name)
  tally.check(
    'an action on Contact changed stage is saved',
    stored?.trigger?.event === 'contactStageChanged' && stored?.steps?.[0]?.tag === STAGED_ACTION.tag,
    JSON.stringify({ trigger: stored?.trigger?.event, steps: stored?.steps }),
  )
})

await step(tally, page, 'a contact added by hand fires Contact created', async () => {
  await page.goto(hostUrl('/crm/contacts'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.getByRole('button', { name: 'New contact' }).click({ timeout: TIMEOUT_MS })
  const drawer = page.getByRole('dialog').last()
  // The required field's label carries the asterisk ("Email *"), and the
  // consent checkbox's label also says "email", so both are prefix matches
  // on the textbox role rather than label lookups.
  await drawer.getByRole('textbox', { name: /^Email/ }).fill(PERSON.email)
  await drawer.getByRole('textbox', { name: /^Name/ }).fill(PERSON.name)
  await drawer.getByRole('button', { name: 'Add contact' }).click()
  await expectSnackbar(page, 'Contact added')
  const tagged = await waitFor(person, (found) => (found?.facet?.tags ?? []).includes(CREATED_ACTION.tag))
  tally.check(
    'a contact added by hand fires Contact created',
    tagged?.facet?.tags?.includes(CREATED_ACTION.tag),
    `tags ${JSON.stringify(tagged?.facet?.tags)}`,
  )
  // The console opens the person it just added.
  await page.waitForURL((url) => /\/crm\/contacts\/[^/]+$/.test(url.pathname), { timeout: TIMEOUT_MS })
  await page.getByRole('heading', { name: PERSON.name }).first().waitFor({ timeout: TIMEOUT_MS })
  tally.pass('Add contact lands on the new record', new URL(page.url()).pathname)
})

await step(tally, page, 'Runs shows the run as Succeeded', async () => {
  await page.goto(hostUrl('/automation/actions'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  const row = page.locator('div', { hasText: CREATED_ACTION.name }).filter({ has: page.getByRole('button', { name: 'Runs' }) }).last()
  await row.getByRole('button', { name: 'Runs' }).click({ timeout: TIMEOUT_MS })
  const dialog = page.getByRole('dialog', { name: `Runs — ${CREATED_ACTION.name}` })
  await dialog.getByText('Succeeded', { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
  tally.check('Runs shows the run as Succeeded', (await succeededRuns(CREATED_ACTION.name)) >= 1)
  await shot(page, 'crm-automation-runs')
  await dialog.getByRole('button', { name: 'Close' }).click()
})

await step(tally, page, 'crm/contact-stage fires Contact changed stage', async () => {
  const found = await person()
  const moved = await postAsUser(OWNER_UID, '/api/crm/contact-stage', {
    hostId: HOST_ID,
    contactId: found?.id,
    lifecycleStage: 'customer',
  })
  const tagged = await waitFor(person, (p) => (p?.facet?.tags ?? []).includes(STAGED_ACTION.tag))
  tally.check(
    'crm/contact-stage fires Contact changed stage',
    moved.status === 200 && moved.body.changed === true && tagged?.facet?.lifecycleStage === 'customer',
    `${moved.status} ${JSON.stringify(moved.body)} · tags ${JSON.stringify(tagged?.facet?.tags)}`,
  )
  const runs = await succeededRuns(STAGED_ACTION.name)
  tally.check('the stage action ran once for the route', runs === 1, `${runs} succeeded run(s)`)
})

await step(tally, page, "the contact page's stage control fires Contact changed stage", async () => {
  const found = await person()
  const before = await succeededRuns(STAGED_ACTION.name)
  await page.goto(hostUrl(`/crm/contacts/${found.id}`), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.getByRole('heading', { name: PERSON.name }).first().waitFor({ timeout: TIMEOUT_MS })
  const properties = cardNamed(page, 'Properties')
  await pickSelect(page, 'Lifecycle stage', 'Evangelist', properties)
  await properties.getByRole('button', { name: 'Save', exact: true }).click()
  await expectSnackbar(page, 'Contact saved')
  const stage = await waitFor(person, (p) => p?.facet?.lifecycleStage === 'evangelist')
  tally.check('the stage lands on the facet', stage?.facet?.lifecycleStage === 'evangelist', stage?.facet?.lifecycleStage)
  const after = await waitFor(() => succeededRuns(STAGED_ACTION.name), (n) => n > before, { timeoutMs: 15_000 }).catch(
    () => before,
  )
  tally.check(
    "the contact page's stage control fires Contact changed stage",
    after === before + 1,
    `${before} → ${after} succeeded run(s) of "${STAGED_ACTION.name}"`,
  )
})

await session.close()
process.exit(tally.finish())
