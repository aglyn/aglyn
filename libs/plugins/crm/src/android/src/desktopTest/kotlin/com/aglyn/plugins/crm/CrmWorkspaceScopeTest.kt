package com.aglyn.plugins.crm

import androidx.compose.ui.graphics.vector.PathParser
import com.aglyn.contracts.Contracts
import com.aglyn.core.FirestoreDoc
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.FieldOption
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The workspace's own CRM (AGL-3946): every record, base fields, the routes scoped to the workspace, a site only when the org keeps them apart (AGL-4124). */
class CrmWorkspaceScopeTest {
  private val owner = mapOf("role" to "owner")

  @Test
  fun theWholeWorkspaceListsEveryRecord() {
    val scope = crmScopeOf("o1", null, "u1", emptyMap(), owner)
    assertTrue(scope.workspaceWide)
    assertNull(scope.readTokens)
    assertTrue(scopedQuery(scope, "contacts").filters.none { it.field == "visibleTo" })
    assertEquals(mapOf("orgId" to "o1"), scope.routeScope)
  }

  @Test
  fun aWorkspaceLevelCreateNeedsASiteOnlyWhenTheOrgKeepsThemApart() {
    val shared = crmScopeOf("o1", null, "u1", emptyMap(), owner)
    assertEquals(listOf("org"), shared.createTokens)
    assertFalse(shared.createNeedsSite)
    assertEquals(listOf("org"), shared.forSite("h1").createTokens)

    val apart = crmScopeOf("o1", null, "u1", mapOf("crm" to mapOf("defaultRecordScope" to "host")), owner)
    assertTrue(apart.createTokens.isEmpty())
    assertTrue(apart.createNeedsSite)
    assertEquals(listOf("host:h1"), apart.forSite("h1").createTokens)
  }

  @Test
  fun nothingIsPickedSilently() {
    assertNull(crmCreateHost(null, listOf("h1", "h2")))
    assertEquals("h2", crmCreateHost("h2", listOf("h1", "h2")))
    assertNull(crmCreateHost("gone", listOf("h1", "h2")))
    assertEquals("h1", crmCreateHost(null, listOf("h1")))
    assertNull(crmCreateHost(null, emptyList()))
  }

  @Test
  fun theSiteFieldAsksOnlyWhatTheOrgNeeds() {
    val sites = listOf(FieldOption("h1", "One"), FieldOption("h2", "Two"))
    val shared = crmScopeOf("o1", null, "u1", emptyMap(), owner)
    val apart = crmScopeOf("o1", null, "u1", mapOf("crm" to mapOf("defaultRecordScope" to "host")), owner)
    assertEquals("Source site", crmSiteField(CrmKind.DEAL, shared, sites)?.spec?.label)
    assertEquals(false, crmSiteField(CrmKind.DEAL, shared, sites)?.spec?.required)
    assertEquals("None", crmSiteField(CrmKind.DEAL, shared, sites)?.spec?.emptyLabel)
    assertEquals("Site", crmSiteField(CrmKind.DEAL, apart, sites)?.spec?.label)
    assertEquals(true, crmSiteField(CrmKind.DEAL, apart, sites)?.spec?.required)
    // A lead is private to one site, whatever the org keeps.
    assertEquals(true, crmSiteField(CrmKind.LEAD, shared, sites)?.spec?.required)
    assertNull(crmSiteField(CrmKind.DEAL, shared, sites.take(1)))
    assertNull(crmSiteField(CrmKind.DEAL, shared.forSite("h1"), sites))
    // The field picks; it is never a field of the record.
    assertTrue(createdFields(listOfNotNull(crmSiteField(CrmKind.DEAL, shared, sites)), mapOf(CRM_SITE_FIELD_KEY to "h1")).isEmpty())
  }

  @Test
  fun aTaskStartsFiledWhereTheOrgFilesIt() {
    val shared = crmScopeOf("o1", null, "u1", emptyMap(), owner)
    val apart = crmScopeOf("o1", null, "u1", mapOf("crm" to mapOf("defaultRecordScope" to "host")), owner)
    assertEquals(CRM_ORGANIZATION_CHOICE, taskSiteStart(shared, listOf("h1", "h2"), null))
    assertEquals("h2", taskSiteStart(shared, listOf("h1", "h2"), "h2"))
    assertEquals("", taskSiteStart(apart, listOf("h1", "h2"), null))
  }

  @Test
  fun aRecordsOwnPageWorksInTheSiteItCameFrom() {
    val shared = crmScopeOf("o1", null, "u1", emptyMap(), owner)
    fun doc(vararg fields: Pair<String, Any?>) = FirestoreDoc("r1", "orgs/o1/deals/r1", mapOf(*fields))
    assertEquals("h1", recordScope(shared, doc("hostId" to "h1")).hostId)
    assertNull(recordScope(shared, doc("hostId" to "h1")).readTokens)
    assertEquals("h2", recordScope(shared, doc("capturedByHostIds" to listOf("h2", "h3"))).hostId)
    val noSite = recordScope(shared, doc("hostId" to null, "visibleTo" to listOf("org")))
    assertNull(noSite.hostId)
    assertEquals(listOf("org"), noSite.createTokens)
    assertEquals(listOf("host:h9"), recordScope(shared, doc("visibleTo" to listOf("host:h9"))).createTokens)
  }

  @Test
  fun anOrgHeldContactReadsItsOwnFacet() {
    val data = mapOf("name" to "Base", "facets" to mapOf("org" to mapOf("phone" to "+1 555 0100"), "g1" to mapOf("phone" to "+1 555 0199")))
    assertEquals("+1 555 0100", contactView(data, "")["phone"])
    assertEquals("+1 555 0100", contactView(data, "g2")["phone"])
    assertEquals("+1 555 0199", contactView(data, "g1")["phone"])
  }

  @Test
  fun anActivityReadsAsTheConsoleReadsIt() {
    val message = crmActivityLine(mapOf("kind" to "whatsapp", "direction" to "outbound", "body" to "Sent the proposal\nThey asked about hosting"))
    assertEquals("Outbound WhatsApp message", message.chip)
    assertEquals("Sent the proposal", message.heading)
    assertEquals("They asked about hosting", message.detail)
    assertNull(message.state)
    val inbound = crmActivityLine(mapOf("kind" to "messenger", "direction" to "inbound", "body" to "Thanks"))
    assertEquals("Inbound Messenger message", inbound.chip)
    assertNull(inbound.detail)
    assertEquals("Instagram", crmActivityLine(mapOf("kind" to "instagram", "body" to "Liked it")).chip)
    val titled = crmActivityLine(mapOf("kind" to "linkedin", "direction" to "outbound", "subject" to "Intro", "body" to "Hello"))
    assertEquals("Intro", titled.heading)
    assertEquals("Hello", titled.detail)
    // A stored kind outside the list reads as Other, as the console draws it.
    assertEquals("Other", crmActivityLine(mapOf("kind" to "telegram", "body" to "x")).chip)
    // A message the platform carried names the kind alone, and says it was sent or received.
    val sent = crmActivityLine(mapOf("kind" to "email", "direction" to "outbound", "messageId" to "m1", "subject" to "Hi", "body" to "Hello"))
    assertEquals("Email", sent.chip)
    assertEquals("Sent", sent.state)
    assertEquals("Received", crmActivityLine(mapOf("kind" to "email", "direction" to "inbound", "messageId" to "m2", "body" to "Hello")).state)
  }

  @Test
  fun everyActivityKindHasItsOwnIcon() {
    val paths = Contracts.nativeCrmActivityIconPaths
    assertEquals(setOf("whatsapp", "messenger", "instagram", "linkedin"), paths.keys)
    paths.values.forEach { assertTrue(PathParser().parsePathString(it).toNodes().isNotEmpty()) }
    assertEquals("sms", crmActivityIconName("text"))
    assertTrue(AglynIcons.has(crmActivityIconName("text")))
    assertTrue(AglynIcons.has(crmActivityIconName("other")))
  }

  @Test
  fun aSiteScopeStillNarrowsItsReads() {
    val scope = crmScopeOf("o1", "h1", "u1", emptyMap(), owner)
    assertEquals(listOf("org", "host:h1"), scopedQuery(scope, "contacts").filters.single { it.field == "visibleTo" }.value)
  }

  @Test
  fun aNewRecordIsMadeOnThePickedSite() {
    val site = crmScopeOf("o1", null, "u1", emptyMap(), owner).forSite("h1")
    assertEquals("h1", site.hostId)
    assertEquals(listOf("org", "host:h1"), site.readTokens)
    assertEquals(listOf("org"), site.createTokens)
  }
}
