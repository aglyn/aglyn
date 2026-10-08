package com.aglyn.core

import com.aglyn.contracts.NotificationCatalog
import com.aglyn.contracts.NotificationCatalogCategory
import com.aglyn.contracts.NotificationCatalogType
import com.aglyn.contracts.Notifications
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NotificationPushSettingsTest {
  private val catalog = NotificationCatalog(
    categories = listOf(
      NotificationCatalogCategory(
        "content", "Forms & bookings",
        listOf(
          NotificationCatalogType("content.order", "New order", consoleDefault = true, level = "success"),
          NotificationCatalogType("content.lowStock", "Low stock", consoleDefault = true, level = "warning"),
        ),
      ),
      NotificationCatalogCategory("billing", "Billing", listOf(NotificationCatalogType("billing.usage", "Usage threshold", consoleDefault = false))),
      NotificationCatalogCategory("empty", "Nothing", emptyList()),
    ),
  )

  private fun rows(data: Map<String, Any?>?, pending: Map<String, Boolean> = emptyMap()) =
    pushSwitchCategories(catalog, data, pending).flatMap { it.rows }.associateBy { it.type }

  @Test
  fun anUnansweredTypeFollowsTheCatalogDefault() {
    val rows = rows(null)
    assertTrue(rows.getValue("content.order").enabled)
    assertFalse(rows.getValue("billing.usage").enabled)
    assertFalse(rows.getValue("content.order").ownAnswer)
    assertEquals(listOf("content", "billing"), pushSwitchCategories(catalog, null).map { it.id })
  }

  @Test
  fun storedAnswersResolveTypeThenCategoryThenConsoleThenLegacy() {
    val data = mapOf(
      NOTIFICATION_SETTINGS_FIELD to mapOf(
        "accountTypes" to mapOf("content.order" to mapOf("push" to false)),
        "account" to mapOf("billing" to mapOf("console" to true)),
      ),
      LEGACY_NOTIFICATION_PREFS_FIELD to mapOf("content" to false),
    )
    val rows = rows(data)
    assertFalse(rows.getValue("content.order").enabled)
    assertTrue(rows.getValue("content.order").ownAnswer)
    // No push or console answer for low stock: the legacy category mute holds.
    assertFalse(rows.getValue("content.lowStock").enabled)
    assertTrue(rows.getValue("billing.usage").enabled)
  }

  @Test
  fun aMalformedSettingsMapReadsAsUnanswered() {
    val rows = rows(mapOf(NOTIFICATION_SETTINGS_FIELD to mapOf("accountTypes" to "nonsense")))
    assertTrue(rows.getValue("content.order").enabled)
  }

  @Test
  fun aPendingAnswerWinsUntilTheDocumentAgrees() {
    val before = mapOf<String, Any?>()
    assertFalse(rows(before, mapOf("content.order" to false)).getValue("content.order").enabled)
    val after = mapOf(NOTIFICATION_SETTINGS_FIELD to mapOf("accountTypes" to mapOf("content.order" to mapOf("push" to false))))
    assertEquals(mapOf("content.order" to false), settlePending(mapOf("content.order" to false), before))
    assertEquals(emptyMap(), settlePending(mapOf("content.order" to false), after))
  }

  @Test
  fun theWriteIsOneLeafOnTheOwnUserDocument() = runTest {
    val writes = mutableListOf<Pair<String, Map<String, Any?>>>()
    val writer = object : FirestoreWriter {
      override suspend fun merge(path: String, data: Map<String, Any?>) {
        writes += path to data
      }
    }
    writeAccountPush(writer, "u1", "content.order", false)
    val (path, data) = writes.single()
    assertEquals("users/u1", path)
    assertEquals(listOf("notificationSettings.accountTypes.`content.order`.push"), mergeFieldPaths(data))
  }

  @Test
  fun fieldPathsQuoteSegmentsThatAreNotIdentifiers() {
    assertEquals(
      listOf("a.b", "a.`c-d`", "`x.y`.`1`", "e"),
      mergeFieldPaths(mapOf("a" to mapOf("b" to 1, "c-d" to true), "x.y" to mapOf("1" to null), "e" to emptyMap<String, Any>())),
    )
    assertEquals("`a\\`b`", quoteFieldPathSegment("a`b"))
  }

  @Test
  fun theBundledCatalogHasEveryCategoryWithTypes() {
    assertTrue(Notifications.categories.isNotEmpty())
    assertTrue(Notifications.categories.all { it.types.isNotEmpty() })
    assertTrue(Notifications.categories.flatMap { it.types }.any { it.type == "content.order" })
  }
}
