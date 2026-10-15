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
 * The cases the native "Past your plan" screen replays (AGL-3671).
 *
 * The console prices a month of usage past a plan's bands with
 * `estimateMonthlyUsageCost` and words the CRM, API and email overage with
 * `checkCrmRecordsQuota`, `checkApiRequestQuota` and `priceEmailSendOverage`. The
 * app computes the same figures from the entitlements route's quotas and the
 * published rates, in the screen's own arithmetic, so each case here is a month
 * of usage, the quotas the route would answer, and what the console says it
 * costs. Apple and Kotlin render the screen over the usage and must agree to the
 * cent: `generate-native-contracts.mjs` writes them to
 * `libs/native/contracts/billing-estimate-cases.generated.json`.
 */

const GB = 1024 * 1024 * 1024

/** One month of usage across a workspace's sites, in the units the counters are kept in. */
function scenarios(included) {
  const sites = (count, share) =>
    Array.from({ length: count }, (_, index) => ({
      storageBytes: Math.round(share.storageBytes / count),
      pageViews: Math.round(share.pageViews / count),
      forms: Math.round(share.forms / count),
      index,
    }))
  const inside = { storageBytes: 1 * GB, pageViews: 1000, forms: 10 }
  const over = {
    storageBytes: (included.storageGb + 5) * GB,
    pageViews: included.pageViews + 12345,
    forms: included.forms + 777,
  }
  return [
    { name: 'inside every band', sites: sites(2, inside), orgLibraryBytes: 0 },
    { name: 'storage over', sites: sites(3, { ...inside, storageBytes: over.storageBytes }), orgLibraryBytes: 0 },
    { name: 'page views over', sites: sites(2, { ...inside, pageViews: over.pageViews }), orgLibraryBytes: 0 },
    { name: 'forms over', sites: sites(1, { ...inside, forms: over.forms }), orgLibraryBytes: 0 },
    { name: 'all over with a library', sites: sites(2, over), orgLibraryBytes: 3 * GB },
  ]
}

/** The cases, from the console's own functions. */
export function billingEstimateCases({ plans, usage, entitlements }) {
  const month = '2026-10'
  const cases = []
  for (const plan of plans) {
    const org = { plan }
    const { features: _features, ...quotas } = entitlements.resolveOrgEntitlements(org)
    const included = usage.meteredIncludedAllowance(org)
    const forms = included.meters['formSubmissions'] ?? 0
    const finite = (value) => (Number.isFinite(value) ? value : null)
    for (const scenario of scenarios({ storageGb: included.storageGb, pageViews: included.pageViews, forms })) {
      for (const libraryBilled of scenario.orgLibraryBytes ? [true, false] : [true]) {
        const delivered = scenario.sites.map((site) => ({
          storageBytes: site.storageBytes,
          pageViews: site.pageViews,
          meters: { formSubmissions: site.forms },
        }))
        const library = { storageBytes: scenario.orgLibraryBytes, pageViews: 0 }
        const truth = usage.estimateMonthlyUsageCost([...delivered, library], org)
        const billed = libraryBilled ? truth : usage.estimateMonthlyUsageCost(delivered, org)
        cases.push({
          name: `${plan}: ${scenario.name}${scenario.orgLibraryBytes ? (libraryBilled ? ', library billed' : ', library not billed yet') : ''}`,
          plan,
          month,
          quotas: Object.fromEntries(Object.entries(quotas).map(([key, value]) => [key, finite(value)])),
          sites: scenario.sites.map((site) => ({ storageBytes: site.storageBytes, pageViews: site.pageViews, forms: site.forms })),
          orgLibraryBytes: scenario.orgLibraryBytes,
          libraryBilled,
          expect: {
            billed: billed.included.metered,
            billedCents: billed.billedCents,
            storageUsd: billed.billableUsdByMeter.storage,
            pageViewsUsd: billed.billableUsdByMeter.pageViews,
            formsUsd: billed.billableUsdByMeter['formSubmissions'] ?? 0,
          },
        })
      }
    }
  }
  return cases
}

/** The records, API and email captions' figures for a plan at a few counts. */
export function overageCaptionCases({ plans, entitlements }) {
  const cases = []
  for (const plan of plans) {
    const org = { plan }
    const { features: _features, ...quotas } = entitlements.resolveOrgEntitlements(org)
    const finite = (value) => (Number.isFinite(value) ? value : null)
    const q = Object.fromEntries(Object.entries(quotas).map(([key, value]) => [key, finite(value)]))
    for (const extra of [0, 1, 1234, 56789]) {
      const records = quotas.contactsPerHost + extra
      const requests = quotas.apiRequestsPerMonth + extra
      const emails = quotas.emailSendsPerMonth + extra
      const recordsResult = entitlements.checkCrmRecordsQuota(org, records)
      const apiResult = entitlements.checkApiRequestQuota(org, requests)
      const emailOverage = entitlements.emailSendsOverage(emails, quotas.emailSendsPerMonth)
      const emailPrice = entitlements.priceEmailSendOverage(org, emailOverage)
      cases.push({
        name: `${plan}: ${extra} past each band`,
        plan,
        quotas: q,
        records: { total: records, parts: { contacts: Math.round(records / 2), companies: Math.round(records / 4), deals: records - Math.round(records / 2) - Math.round(records / 4) } },
        apiRequests: requests,
        emails,
        expect: {
          recordsOverage: recordsResult.overageRecords,
          recordsRate: recordsResult.overageRateUsd,
          recordsUsd: recordsResult.overageMonthlyUsd,
          apiOverage: apiResult.overageRequests,
          apiRate: apiResult.overageRateUsd,
          apiUsd: apiResult.overageMonthlyUsd,
          emailOverage,
          emailRate: emailPrice.overageRateUsd,
          emailUsd: emailPrice.overageMonthlyUsd,
        },
      })
    }
  }
  return cases
}
