package com.aglyn.plugins.redirects

import com.aglyn.contracts.HostRedirect
import com.aglyn.core.FirestoreDoc
import com.aglyn.pluginhost.DeepLinks
import com.aglyn.pluginhost.NativeLinkTarget
import com.aglyn.pluginhost.NativePluginManifestEntry
import com.aglyn.pluginhost.NativePluginRegistry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RedirectsNativeTest {
  private val registry = NativePluginRegistry().also { registry ->
    val result = registry.load(
      listOf(
        NativePluginManifestEntry(
          "redirects",
          mapOf(
            "screens" to listOf("redirects.list"),
            "widgets" to listOf("redirects.summary"),
            "quickActions" to listOf("redirects.open"),
            "deepLinks" to listOf("redirects.page"),
          ),
          ::registerRedirectsNative,
        ),
      ),
    )
    assertEquals(listOf("redirects"), result.loaded, result.failed.toString())
  }

  @Test
  fun registersASiteScreenAndItsQuickAction() {
    assertTrue(registry.screen("redirects.list")!!.requiresSite)
    assertEquals(listOf("redirects.open"), registry.quickActions().map { it.id })
  }

  @Test
  fun opensTheConsolesRedirectsPageNatively() {
    assertEquals(
      NativeLinkTarget.Screen("redirects.list", mapOf("orgSlug" to "acme", "hostSlug" to "shop")),
      DeepLinks.resolve("https://app.aglyn.com/acme/hosts/shop/redirects", registry.deepLinks()),
    )
  }

  @Test
  fun ordersByPriorityThenSourceAndDropsSoftDeletedRules() {
    fun row(id: String, source: String, priority: Long? = null, deleted: Boolean = false) =
      RedirectRow(id, HostRedirect(destination = "/x", source = source, statusCode = 301, priority = priority?.toDouble()), deleted)
    assertEquals(
      listOf("c", "b", "a"),
      inEvaluationOrder(listOf(row("a", "/b"), row("b", "/a"), row("c", "/z", 1), row("d", "/c", 1, deleted = true))).map { it.id },
    )
  }

  @Test
  fun readsARuleThroughTheGeneratedContract() {
    val row = RedirectRow.from(
      FirestoreDoc("r1", "hosts/h/redirects/r1", mapOf("source" to "/a", "destination" to "/b", "statusCode" to 301L, "kind" to "prefix", "enabled" to false, "createdAt" to com.aglyn.core.FirestoreTimestamp(1, 0))),
    )!!
    assertEquals("prefix", row.kind)
    assertEquals(false, row.enabled)
    assertEquals(null, RedirectRow.from(FirestoreDoc("x", "hosts/h/redirects/x", mapOf("title" to "not a rule"))))
  }
}
