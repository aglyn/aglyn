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

// The CRM in aggregate: `/crm/reports` and the two dashboard cards
// (AGL-2610, AGL-2604, AGL-2599).
//
// Every figure on these surfaces is a server aggregate over the same
// `visibleTo` predicate the sections list by, so each one is checked against
// the Admin SDK running the same query — the report must say what the data
// says, not merely say a number.
//
// ## "Dashes until read" is proven by holding the read
//
// A tile draws `—` while its aggregate is pending and a figure once it has
// answered, and a spec that only looked after the page settled could not
// tell that apart from a tile that draws a zero before the read lands. So
// the aggregation RPCs are parked at the network layer on the first paint,
// the dashes are read while they wait, and the RPCs are released — the same
// page, both states, in order.
//
// Prerequisites (see docs/E2E_LOCAL.md): emulators, `npm run seed:e2e`, and a
// console dev server carrying the emulator flags, pointed at by E2E_BASE_URL.
//
//   node tools/e2e/crm-reports.e2e.mjs

import { CRM_FIXTURE, seedCrmFixtures } from '../scripts/lib/crm-fixtures.mjs'
import {
  adminFirestore,
  cardNamed,
  HOST_BASE,
  HOST_ID,
  hostUrl,
  openConsole,
  ORG_ID,
  OWNER_NAME,
  OWNER_UID,
  shot,
  step,
  TEAMMATE_UID,
  TIMEOUT_MS,
  verdicts,
  waitFor,
} from './lib/console-session.mjs'

const DAY_MS = 24 * 60 * 60 * 1000
const READ_TOKENS = ['org', `host:${HOST_ID}`]

const firestore = adminFirestore()
const orgRef = firestore.collection('orgs').doc(ORG_ID)

await seedCrmFixtures({
  firestore,
  orgId: ORG_ID,
  hostId: HOST_ID,
  ownerUid: OWNER_UID,
  ownerName: OWNER_NAME,
  teammateUid: TEAMMATE_UID,
})

/** The same aggregates the cards run, from the Admin side. */
const scoped = (name) =>
  orgRef.collection(name).where('visibleTo', 'array-contains-any', READ_TOKENS)
const expected = {
  contacts: (await scoped('contacts').count().get()).data().count,
  newInDays: async (days) =>
    (
      await scoped('contacts')
        .where('createdAt', '>=', new Date(Date.now() - days * DAY_MS))
        .count()
        .get()
    ).data().count,
  openDeals: (await scoped('deals').where('status', '==', 'open').count().get()).data().count,
  pipelineCents: (
    await scoped('deals').where('status', '==', 'open').get()
  ).docs.reduce((sum, entry) => sum + Number(entry.get('amountCents') ?? 0), 0),
  openTasks: (await scoped('crmTasks').where('status', '==', 'open').count().get()).data().count,
}
const money = (cents) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)

const tally = verdicts()
const session = await openConsole()
const { page } = session

/**
 * The figure under a tile's caption, as text.
 *
 * By structure rather than by nearest container: a `ReportStatTile` is a
 * caption followed by the figure's row, and the caption's words recur
 * elsewhere on the page — "Open tasks" heads the tasks card, "Overdue" heads
 * a table column — so the figure is the first heading after THE caption
 * span, not the first heading inside whatever happens to contain the words.
 */
const tileValue = async (label) => {
  const figure = page.locator(
    `xpath=//span[normalize-space(.)=${JSON.stringify(label)}]/following-sibling::div[1]//h6`,
  )
  return (await figure.first().textContent({ timeout: TIMEOUT_MS }))?.trim() ?? ''
}

// ── Reports: dashes, then figures ───────────────────────────────────────────
await step(tally, page, 'the tiles draw dashes until the aggregates answer', async () => {
  const held = []
  let holding = true
  await page.route('**/*runAggregationQuery*', async (route) => {
    if (holding) held.push(route)
    else await route.continue()
  })
  try {
    await page.goto(hostUrl('/crm/reports'), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
    // The page header and the section's own heading both read "Reports".
    await page.getByRole('heading', { name: 'Reports' }).first().waitFor({ timeout: TIMEOUT_MS })
    // One header per card the section draws, in the section's own order.
    const headers = [
      'Contacts',
      'Sources and lifecycle',
      'Conversion by source',
      'Lead funnel',
      'Pipeline',
      'Won and lost',
      'Activity by teammate',
      'Forecast by close month',
      'Tasks',
    ]
    for (const header of headers) {
      await page.getByText(header, { exact: true }).first().waitFor({ timeout: TIMEOUT_MS })
    }
    tally.pass('the nine cards mount', headers.join(' · '))
    await waitFor(() => Promise.resolve(held.length), (n) => n > 0)
    const pending = await Promise.all(['Total contacts', 'Open deals', 'Open tasks'].map(tileValue))
    tally.check(
      'the tiles draw dashes until the aggregates answer',
      pending.every((value) => value === '—'),
      `${held.length} aggregate reads held; tiles read ${JSON.stringify(pending)}`,
    )
  } finally {
    // Released whatever happened above: a read left parked would hold every
    // later step at a dash and turn one red into five.
    holding = false
    for (const route of held.splice(0)) await route.continue()
    await page.unroute('**/*runAggregationQuery*')
  }
})

await step(tally, page, 'the figures match the data', async () => {
  const figures = await waitFor(
    async () => ({
      total: await tileValue('Total contacts'),
      openDeals: await tileValue('Open deals'),
      pipeline: await tileValue('Pipeline value'),
      openTasks: await tileValue('Open tasks'),
      overdue: await tileValue('Overdue'),
    }),
    (f) => Object.values(f).every((value) => value && value !== '—'),
  )
  tally.check(
    'Total contacts counts every contact this site may see',
    figures.total === String(expected.contacts),
    `${figures.total} vs ${expected.contacts}`,
  )
  tally.check(
    'Open deals and pipeline value are the open deals',
    figures.openDeals === String(expected.openDeals) && figures.pipeline === money(expected.pipelineCents),
    `${figures.openDeals} deals, ${figures.pipeline} vs ${expected.openDeals}, ${money(expected.pipelineCents)}`,
  )
  tally.check(
    'Open tasks and Overdue count the seeded tasks',
    figures.openTasks === String(expected.openTasks) && figures.overdue === '1',
    `${figures.openTasks} open, ${figures.overdue} overdue vs ${expected.openTasks}, 1`,
  )
  await page.getByText(CRM_FIXTURE.dealTitle).first().waitFor({ timeout: TIMEOUT_MS })
  tally.pass('the pipeline card lists the open deal', CRM_FIXTURE.dealTitle)
  await shot(page, 'crm-reports')
})

await step(tally, page, 'the period toggle re-sizes the reads', async () => {
  const thirty = await tileValue('New contacts')
  await page.getByRole('button', { name: 'Last 7 days' }).click()
  const pressed = await page.getByRole('button', { name: 'Last 7 days' }).getAttribute('aria-pressed')
  const expectedWeek = String(await expected.newInDays(7))
  const seven = await waitFor(() => tileValue('New contacts'), (value) => value === expectedWeek)
  tally.check(
    'the period toggle re-sizes the reads',
    pressed === 'true' && seven === expectedWeek && thirty === String(await expected.newInDays(30)),
    `30d ${thirty}, 7d ${seven} (expected ${await expected.newInDays(30)}, ${expectedWeek})`,
  )
})

await step(tally, page, 'a tile links into its section', async () => {
  const link = page
    .locator('xpath=//span[normalize-space(.)="Total contacts"]/following-sibling::div[1]//a')
    .first()
  const href = await link.getAttribute('href')
  await link.click()
  await page.waitForURL((url) => url.pathname.endsWith('/crm/contacts'), { timeout: TIMEOUT_MS })
  tally.check('a tile links into its section', href === `${HOST_BASE}/crm/contacts`, href ?? '(no href)')
})

// ── The site dashboard's two cards ──────────────────────────────────────────
await step(tally, page, 'CRM at a glance counts the same data', async () => {
  await page.goto(hostUrl(''), { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
  await page.getByText('CRM at a glance', { exact: true }).waitFor({ timeout: TIMEOUT_MS })
  const glance = await waitFor(
    async () => ({
      contacts: await tileValue('Contacts'),
      newThisWeek: await tileValue('New this week'),
      pipeline: await tileValue('Open pipeline'),
      tasksDue: await tileValue('Tasks due'),
    }),
    (f) => Object.values(f).every((value) => value && value !== '—'),
  )
  tally.check(
    'CRM at a glance counts the same data',
    glance.contacts === String(expected.contacts) &&
      glance.newThisWeek === String(await expected.newInDays(7)) &&
      glance.pipeline === money(expected.pipelineCents) &&
      glance.tasksDue === '1',
    JSON.stringify(glance),
  )
})

await step(tally, page, 'Tasks due shows the overdue task', async () => {
  const card = cardNamed(page, 'Tasks due')
  await card.getByText(CRM_FIXTURE.overdueTaskTitle).first().waitFor({ timeout: TIMEOUT_MS })
  // The tasks card draws its two counts figure-first: an `h5`, then the
  // caption under it.
  const overdue = await page
    .locator('xpath=//span[normalize-space(.)="Overdue"]/preceding-sibling::h5[1]')
    .first()
    .textContent({ timeout: TIMEOUT_MS })
  tally.check(
    'Tasks due shows the overdue task',
    (overdue ?? '').trim() === '1' && (await card.count()) > 0,
    `Overdue ${overdue?.trim()} · ${CRM_FIXTURE.overdueTaskTitle}`,
  )
  await shot(page, 'crm-dashboard-cards')
})

await step(tally, page, 'the cards link into the hub', async () => {
  await page.getByRole('link', { name: 'View all' }).first().click()
  await page.waitForURL((url) => url.pathname.endsWith('/crm/tasks'), { timeout: TIMEOUT_MS })
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: 'Open CRM' }).first().click({ timeout: TIMEOUT_MS })
  // A bare `/crm` lands on the first section.
  await page.waitForURL((url) => url.pathname.endsWith('/crm/contacts'), { timeout: TIMEOUT_MS })
  tally.pass('the cards link into the hub', 'View all → /crm/tasks · Open CRM → /crm/contacts')
})

await session.close()
process.exit(tally.finish())
