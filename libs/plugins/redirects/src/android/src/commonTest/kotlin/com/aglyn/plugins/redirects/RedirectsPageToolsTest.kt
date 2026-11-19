package com.aglyn.plugins.redirects

import com.aglyn.core.ConsoleApiError
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

private class NoWrites : RedirectsWriteApi {
  override suspend fun check(draft: RedirectDraft): RedirectCheck = throw ConsoleApiError("unused", 500, null)
  override suspend fun create(fields: Map<String, Any?>) {}
  override suspend fun update(id: String, fields: Map<String, Any?>) {}
  override suspend fun setEnabled(id: String, enabled: Boolean) {}
  override suspend fun delete(id: String) {}
  override suspend fun announce(source: String?) {}
}

/** The Redirects page's Import, Export, plan readout and gate, and "Test a path", as the console's page has them. */
class RedirectsPageToolsTest {
  @Test
  fun importOpensTheHubImportOnThisSitesRules() {
    assertEquals("core.settings.data.import", CORE_DATA_IMPORT_SCREEN)
    assertEquals(mapOf("resource" to "redirects", "hostId" to "h1"), redirectsImportParams("h1"))
    assertEquals(mapOf("resource" to "redirects"), redirectsImportParams(null))
  }

  @Test
  fun exportCoversEveryRuleOfTheSite() {
    assertEquals("redirects", REDIRECTS_TRANSFER_RESOURCE)
    assertEquals("Export Redirects", REDIRECTS_EXPORT_TITLE)
    assertEquals(mapOf<String, Any?>("kind" to "all"), REDIRECTS_EXPORT_SCOPE)
  }

  @Test
  fun addIsRefusedAtThePlansCapInThePagesWords() {
    assertEquals("Redirect limit reached (25) — upgrade in Billing", redirectLimitRefusal(true, 25, 25.0))
    assertEquals("Redirect limit reached (0) — upgrade in Billing", redirectLimitRefusal(true, 0, 0.0))
    assertNull(redirectLimitRefusal(true, 24, 25.0))
    // Unlimited, an unknown plan, and an unread count (as none) let it through: the route counts again.
    assertNull(redirectLimitRefusal(true, 900, null))
    assertNull(redirectLimitRefusal(false, 25, 25.0))
    assertNull(redirectLimitRefusal(true, null, 25.0))
  }

  @Test
  fun theReadoutIsThePagesQuotaReadout() {
    assertEquals("3/25 redirects on your plan", redirectQuotaReadout(3, 25.0, true))
    assertEquals("3/∞ redirects on your plan", redirectQuotaReadout(3, null, true))
    assertEquals("1 redirect · checking your plan…", redirectQuotaReadout(1, 25.0, false))
    assertEquals("0 redirects · checking your plan…", redirectQuotaReadout(0, null, false))
  }

  @Test
  fun theEditorShowsTheRefusalInsteadOfTheForm() = runTest {
    val editor = RedirectsEditor(NoWrites(), "u1", this)
    editor.add("Redirect limit reached (25) — upgrade in Billing")
    assertNull(editor.draft)
    assertEquals("Redirect limit reached (25) — upgrade in Billing", editor.warning)
    editor.add()
    assertNotNull(editor.draft)
    assertNull(editor.warning)
  }

  @Test
  fun theTesterAsksTheRouteAndShowsItsLine() {
    assertEquals("/api/redirects/test", REDIRECT_TEST_ROUTE)
    assertEquals(JsonObject(mapOf("hostId" to JsonPrimitive("h1"), "path" to JsonPrimitive("/old-page"))), redirectTestBody("h1", "/old-page"))
    assertEquals("→ /new-page (301)", redirectTestText(JsonObject(mapOf("path" to JsonPrimitive("/old-page"), "text" to JsonPrimitive("→ /new-page (301)")))))
    assertEquals("No rule matches", redirectTestText(JsonObject(mapOf("match" to JsonNull, "text" to JsonPrimitive("No rule matches")))))
    assertNull(redirectTestText(null))
  }
}
