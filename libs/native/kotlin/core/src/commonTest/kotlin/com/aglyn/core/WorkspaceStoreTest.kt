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
  fun readsMembershipRowsTheWayTheConsoleWritesThem() {
    assertEquals(WorkspaceOrg("o", "acme", "acme", ""), WorkspaceStore.orgFromMembership("o", mapOf("slug" to "acme")))
    assertEquals(
      WorkspaceSite("h", "o", "shop", "shop", "admin"),
      WorkspaceStore.siteFromMembership("h", mapOf("orgId" to "o", "subdomain" to "shop", "role" to "admin")),
    )
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
