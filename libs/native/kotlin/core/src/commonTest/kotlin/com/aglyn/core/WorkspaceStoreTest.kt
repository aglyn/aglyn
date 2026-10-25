package com.aglyn.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class WorkspaceStoreTest {
  private val orgs = listOf(WorkspaceOrg("a", "Acme", "acme", "owner"), WorkspaceOrg("b", "Beta", "beta", "admin"))
  private val sites = listOf(WorkspaceSite("s1", "a", "Shop", "shop", "admin"), WorkspaceSite("s2", "a", "Blog", "blog", "editor"))

  @Test
  fun keepsAPickThatStillExists() {
    assertEquals(WorkspacePick("a", "s2"), WorkspaceStore.reconcilePick(WorkspacePick("a", "s2"), orgs, sites))
  }

  @Test
  fun healsAStaleSiteToTheFirstSite() {
    assertEquals(WorkspacePick("a", "s1"), WorkspaceStore.reconcilePick(WorkspacePick("a", "gone"), orgs, sites))
  }

  @Test
  fun keepsTheSiteUntilTheSitesArrive() {
    assertEquals(WorkspacePick("a", "s2"), WorkspaceStore.reconcilePick(WorkspacePick("a", "s2"), orgs, null))
  }

  @Test
  fun aFallenBackWorkspaceDropsTheRememberedSite() {
    assertEquals(WorkspacePick("a", null), WorkspaceStore.reconcilePick(WorkspacePick("gone", "s2"), orgs, null))
    assertEquals(WorkspacePick("a", "s1"), WorkspaceStore.reconcilePick(WorkspacePick(null, null), orgs, sites))
    assertEquals(WorkspacePick(null, null), WorkspaceStore.reconcilePick(WorkspacePick("a", "s1"), emptyList(), null))
  }

  @Test
  fun aDeletedSiteOnScreenIsRemovedNotReplaced() {
    // s2 was on screen and is gone from the loaded list (deleted): the shell leaves for the workspace's Sites.
    val afterDelete = WorkspaceState(orgs = orgs, sites = sites.take(1), org = orgs[0], site = sites[0], ready = true)
    assertTrue(WorkspaceStore.shownSiteRemoved("a", "s2", afterDelete))
    // Still listed, nothing on screen, the sites still loading, or another workspace now shown: nothing was removed.
    assertFalse(WorkspaceStore.shownSiteRemoved("a", "s1", afterDelete))
    assertFalse(WorkspaceStore.shownSiteRemoved("a", null, afterDelete))
    assertFalse(WorkspaceStore.shownSiteRemoved("a", "s2", afterDelete.copy(sites = emptyList(), ready = false)))
    assertFalse(WorkspaceStore.shownSiteRemoved("b", "s2", afterDelete))
    // The last site deleted leaves an empty, loaded list: removed too.
    assertTrue(WorkspaceStore.shownSiteRemoved("a", "s1", afterDelete.copy(sites = emptyList(), site = null, wholeWorkspace = true)))
  }

  @Test
  fun readsMembershipRowsTheWayTheConsoleWritesThem() {
    assertEquals(WorkspaceOrg("o", "acme", "acme", ""), WorkspaceStore.orgFromMembership("o", mapOf("slug" to "acme")))
    assertEquals(
      WorkspaceSite("h", "o", "shop", "shop", "admin"),
      WorkspaceStore.siteFromMembership("h", mapOf("orgId" to "o", "subdomain" to "shop", "role" to "admin")),
    )
  }

  @Test
  fun aSiteCarriesItsFaviconAndAWorkspaceDocumentItsLogos() {
    // The membership row mirrors the host's `seo.favicon` as `favicon`, the console's HostIcon reads it there.
    assertEquals(
      "media:h/fav",
      WorkspaceStore.siteFromMembership("h", mapOf("orgId" to "o", "subdomain" to "shop", "favicon" to "media:h/fav")).favicon,
    )
    assertEquals(null, WorkspaceStore.siteFromMembership("h", mapOf("favicon" to " ")).favicon)
    // A site's rows show its custom domain once the membership row mirrors it, else its platform address.
    assertEquals("example.com", WorkspaceStore.siteFromMembership("h", mapOf("subdomain" to "shop", "cname" to "example.com")).address)
    assertEquals("shop.aglyn.app", WorkspaceStore.siteFromMembership("h", mapOf("subdomain" to "shop", "cname" to "")).address)
    // The host's own cname wins over the row's copy, which may lag behind it.
    val mirrored = WorkspaceStore.siteFromMembership("h", mapOf("subdomain" to "shop", "cname" to "old.example.com"))
    assertEquals("example.com", mirrored.addressWith("example.com"))
    assertEquals("old.example.com", mirrored.addressWith(" "))
    // A workspace's logos live on its own document; the membership index carries none.
    assertEquals(
      WorkspaceOrgLogo("/api/media/cdn/org:o/logo", null, plan = "free"),
      WorkspaceOrgLogo.from(mapOf("logoUrl" to "/api/media/cdn/org:o/logo", "logoDarkUrl" to "")),
    )
    assertEquals(WorkspaceOrgLogo(null, null), WorkspaceOrgLogo.from(null))
    val state = WorkspaceState(org = orgs[0], orgLogos = mapOf("a" to WorkspaceOrgLogo("l", "d")))
    assertEquals(WorkspaceOrgLogo("l", "d"), state.orgLogo)
  }

  @Test
  fun orgAccessFollowsTheConsolePredicate() {
    assertTrue(OrgAccess.isOrgWideMember(mapOf("role" to "editor")))
    assertFalse(OrgAccess.isOrgWideMember(mapOf("role" to "editor", "hostAccess" to mapOf("h1" to "editor"))))
    assertFalse(OrgAccess.isOrgWideMember(mapOf("role" to "editor", "allHosts" to false)))
    assertTrue(OrgAccess.isOrgWideMember(mapOf("role" to "viewer", "allHosts" to true)))
    assertEquals(listOf("org", "host:h1"), OrgAccess.memberScopeTokens(mapOf("role" to "editor", "hostAccess" to mapOf("h1" to "editor"))))
    assertEquals(listOf("org", "host:x"), OrgAccess.memberScopeTokens(mapOf("scopeTokens" to listOf("org", "host:x"))))
    val access = OrgAccess.fromMember(FirestoreDoc("u", "orgs/o/members/u", mapOf("role" to "admin")))
    assertEquals(OrgRole.ADMIN, access.role)
    assertTrue(access.orgWide)
    assertFalse(OrgAccess.fromMember(null).orgWide)
  }
}
