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
 * Console smoke suite (replacing the Nx scaffold stub). Authenticated
 * flows can't run against local emulators (known auth race), so this
 * covers what broke in practice: every page shell must compile and
 * render without Next's error overlay, and every API route must answer
 * JSON — a stale-cache/module failure turns them into HTML 500s, which
 * is exactly the regression these assertions catch.
 */

// Org- and host-scoped pages live under /[orgSlug]/… and
// /[orgSlug]/hosts/[host]/… now (AGL-621/622). The seed provisions org slug
// `e2e-bakery` with host subdomain `demo`.
const ORG = '/e2e-bakery'
const HOST = '/e2e-bakery/hosts/demo'
const PAGES = [
  '/signin',
  '/signup',
  `${ORG}/hosts`,
  ORG, // org home → redirects to its sites
  `${ORG}/team`,
  `${ORG}/media`,
  `${ORG}/billing`,
  `${ORG}/community`,
  `${ORG}/support`,
  `${ORG}/settings`,
  '/admin/flags',
  '/admin/overview',
  '/admin/orgs',
  '/admin/tenants', // legacy redirect to /admin/orgs
  `${HOST}/media`,
  `${HOST}/components`,
  `${HOST}/content`,
]

// route → expected status for an unauthenticated GET.
const API_ROUTES: Array<[string, number]> = [
  ['/api/admin/flags', 401],
  ['/api/auth/session', 401],
  ['/api/orgs/members?orgId=x', 401],
  ['/api/orgs/invites?orgId=x', 401],
  ['/api/orgs/create', 405],
  ['/api/orgs/media', 405],
  ['/api/orgs/settings', 405],
  ['/api/admin/org-usage?orgId=x', 401],
  ['/api/admin/audit-archive', 405],
  ['/api/media/folders', 405],
  ['/api/hosts/create', 405],
  ['/api/hosts/members?hostId=x', 401],
  ['/api/support/tickets', 401],
  ['/api/community/install-plugin', 405],
  ['/api/billing/checkout', 405],
]

describe('console page shells', () => {
  for (const page of PAGES) {
    it(`${page} renders without a build error`, () => {
      cy.request({ url: page, failOnStatusCode: false })
        .its('status')
        .should('eq', 200)
      cy.visit(page, { failOnStatusCode: false })
      // Next dev/prod error overlays and build failures.
      cy.get('#__next_error__').should('not.exist')
      cy.contains(/Application error|Failed to compile|Module not found/).should(
        'not.exist',
      )
      cy.get('#__next').should('exist')
    })
  }
})

describe('sign-in page', () => {
  it('shows the auth form', () => {
    cy.visit('/signin')
    cy.get('input[type="email"], input[name="email"]', {
      timeout: 20000,
    }).should('exist')
  })
})

describe('API health (JSON, never HTML 500s)', () => {
  for (const [route, expected] of API_ROUTES) {
    it(`${route} answers ${expected} as JSON`, () => {
      cy.request({ url: route, failOnStatusCode: false }).then((response) => {
        expect(response.status).to.eq(expected)
        expect(String(response.headers['content-type'])).to.include(
          'application/json',
        )
        expect(response.body).to.have.property('error')
      })
    })
  }
})
