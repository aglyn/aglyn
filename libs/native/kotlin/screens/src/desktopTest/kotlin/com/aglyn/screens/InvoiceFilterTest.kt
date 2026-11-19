package com.aglyn.screens

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * The Invoices list's filters, as the console plans them (`planInvoiceQuery`): one status, a whole invoice number, and
 * the Date as local-day bounds in Unix seconds, each left off when empty.
 */
class InvoiceFilterTest {
  private val root: File = generateSequence(File("").absoluteFile) { it.parentFile }
    .first { File(it, "libs/native/screens").isDirectory }
  private val spec = ScreenSpec.parseFile(File(root, "libs/native/screens/billing.screens.json").readText()).first { it.id == "core.billing.invoices" }

  private fun midnight(year: Int, month: Int, day: Int): Long = LocalDate.of(year, month, day).atStartOfDay(ZoneId.systemDefault()).toEpochSecond()

  @Test
  fun aDayIsItsLocalMidnightAndTheNextOnesForTheEnd() {
    assertEquals(midnight(2026, 11, 1).toString(), ScreenValues.formatted(JsonPrimitive("2026-11-01"), "dayseconds", JsonNull))
    assertEquals(midnight(2026, 12, 1).toString(), ScreenValues.formatted(JsonPrimitive("2026-11-30"), "dayseconds/end", JsonNull))
    assertEquals("", ScreenValues.formatted(JsonPrimitive(""), "dayseconds", JsonNull))
    assertEquals("", ScreenValues.formatted(null, "dayseconds/end", JsonNull))
  }

  @Test
  fun theInvoicesLoadAsksForWhatWasPicked() {
    val load = spec.loads.first { it.key == "invoices" }
    val picked = Json.parseToJsonElement(
      """{"org":{"id":"o1"},"params":{"status":"open","number":"A-1 2","from":"2026-11-01","to":"2026-11-30"}}""",
    )
    assertEquals(
      "/api/billing/invoices?orgId=o1&status=open&number=A-1%202&createdGte=${midnight(2026, 11, 1)}&createdLt=${midnight(2026, 12, 1)}",
      ScreenValues.renderUrl(load.url, picked),
    )
    assertEquals(
      "/api/billing/invoices?orgId=o1&status=&number=&createdGte=&createdLt=",
      ScreenValues.renderUrl(load.url, Json.parseToJsonElement("""{"org":{"id":"o1"}}""")),
    )
    assertNotNull(spec.actions.firstOrNull { it.id == "filter" })
  }
}
