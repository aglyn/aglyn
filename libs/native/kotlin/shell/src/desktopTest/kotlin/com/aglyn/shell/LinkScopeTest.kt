package com.aglyn.shell

import com.aglyn.core.WorkspaceOrg
import com.aglyn.core.WorkspaceSite
import com.aglyn.core.WorkspaceState
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class LinkScopeTest {
  private val acme = WorkspaceOrg("org-acme", "Acme", "acme", "owner")
  private val beta = WorkspaceOrg("org-beta", "Beta", "beta", "owner")
  private val bakery = WorkspaceSite("host-bakery", "org-acme", "Bakery", "bakery", "admin")
  private val cafe = WorkspaceSite("host-cafe", "org-acme", "Cafe", "cafe", "admin")
  private val market = WorkspaceSite("host-market", "org-beta", "Market", "market", "admin")

  private fun onAcme(site: WorkspaceSite = bakery) =
    WorkspaceState(orgs = listOf(acme, beta), sites = listOf(bakery, cafe), org = acme, site = site, ready = true)

  @Test
  fun aConsoleLinkNamesItsWorkspaceAndSite() {
    assertEquals(LinkScope("org-beta", null, "market"), linkScopeOf("/beta/hosts/market/ai-jobs/j1", onAcme()))
    assertEquals(LinkScope("org-acme", "host-cafe", "cafe"), linkScopeOf("https://app.aglyn.com/acme/hosts/cafe/ai-jobs/j1", onAcme()))
    assertEquals(LinkScope("org-acme"), linkScopeOf("/acme/crm", onAcme()))
  }

  @Test
  fun aStoredLinkNamesTheSiteByItsDocumentId() {
    assertEquals(LinkScope("org-acme", "host-cafe", "cafe"), linkScopeOf("/host-cafe/ai-jobs/j1", onAcme()))
  }

  @Test
  fun aLinkOutsideThePersonsWorkspacesHasNoScope() {
    assertNull(linkScopeOf("/manage/notifications", onAcme()))
    assertNull(linkScopeOf("/someone-else/hosts/x/orders", onAcme()))
  }

  @Test
  fun anotherSitesLinkWaitsForThatSite() {
    val scope = LinkScope("org-acme", "host-cafe", "cafe")
    assertFalse(linkScopeSettled(scope, onAcme()))
    assertEquals("org-acme" to "host-cafe", linkScopePick(scope, onAcme()))
    assertTrue(linkScopeSettled(scope, onAcme(cafe)))
    assertNull(linkScopePick(scope, onAcme(cafe)))
  }

  @Test
  fun anotherWorkspacesSiteIsPickedOnceItsSitesHaveLoaded() {
    val scope = LinkScope("org-beta", null, "market")
    assertEquals("org-beta" to null, linkScopePick(scope, onAcme()))
    // The workspace has switched but its sites are still Acme's: nothing to pick yet, and not settled.
    val switching = onAcme().copy(org = beta, site = null)
    assertFalse(linkScopeSettled(scope, switching))
    assertNull(linkScopePick(scope, switching))
    val loaded = WorkspaceState(orgs = listOf(acme, beta), sites = listOf(market), org = beta, site = null, ready = true)
    assertEquals("org-beta" to "host-market", linkScopePick(scope, loaded))
    assertTrue(linkScopeSettled(scope, loaded.copy(site = market)))
  }

  @Test
  fun aSiteTheWorkspaceDoesNotHoldSettlesOnceItsSitesHaveLoaded() {
    assertTrue(linkScopeSettled(LinkScope("org-acme", null, "gone"), onAcme()))
  }

  @Test
  fun anAiJobNoticeOpensTheJob() {
    assertEquals("/acme/hosts/bakery/ai-jobs/j1", withAiJobPath("/acme/hosts/bakery?aiJob=j1"))
    assertEquals("/host-bakery/ai-jobs/j1", withAiJobPath("/host-bakery?aiJob=j1"))
    assertEquals("/org/ai-jobs/j1?x=1", withAiJobPath("/org?x=1&aiJob=j1"))
    assertEquals("/acme/hosts/bakery/orders?aiJob=j1", withAiJobPath("/acme/hosts/bakery/orders?aiJob=j1"))
    assertEquals("/acme/hosts/bakery/ai-jobs/j1", withAiJobPath("/acme/hosts/bakery/ai-jobs/j1"))
  }
}
