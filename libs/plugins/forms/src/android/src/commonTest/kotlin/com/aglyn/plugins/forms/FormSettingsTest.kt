package com.aglyn.plugins.forms

import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreWriter
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The Apple `FormsTests` cases for the after-send settings, the sign-up switch, the metrics and Preview. */
class FormSettingsTest {
  private fun form(vararg fields: Pair<String, Any?>) = FormRow.from(FirestoreDoc("f", "hosts/h/forms/f", mapOf(*fields)))

  @Test
  fun readsTheAfterSendSettingsAndTheSignUpSwitch() {
    val plain = form()
    assertFalse(plain.optInOnSubmit)
    assertFalse(plain.asksForQuote)
    assertFalse(plain.sendsConfirmation())
    // A confirmation follows the request until it is set by hand (`formSendsConfirmation`).
    val quote = form("request" to mapOf("kind" to "quote"), "optInOnSubmit" to true)
    assertTrue(quote.asksForQuote)
    assertTrue(quote.optInOnSubmit)
    assertTrue(quote.sendsConfirmation())
    assertFalse(form("request" to mapOf("kind" to "quote"), "confirmationEmail" to false).sendsConfirmation())
    val withFields = form("fields" to listOf(mapOf("fieldName" to "workEmail", "fieldType" to "text"), mapOf("fieldName" to "art", "fieldType" to "file")))
    assertTrue(withFields.hasEmailField)
    assertTrue(withFields.hasFileField)
    assertFalse(plain.hasEmailField)
  }

  @Test
  fun theMetricsSeriesAndRatesAreTheConsoles() {
    val f = form(
      "stats" to mapOf(
        "submissions" to 10L,
        "leads" to 4L,
        "periods" to mapOf(
          "2026-09" to mapOf("views" to 50L, "starts" to 20L, "submissions" to 6L),
          "2026-11" to mapOf("views" to 30L, "submissions" to 4L),
          "bogus" to mapOf("views" to 1L),
        ),
      ),
    )
    // The gap month is drawn as a zero between two recorded ones; a key that is not a month is left out.
    assertEquals(listOf("2026-09", "2026-10", "2026-11"), formPeriodSeries(f.periods).map { it.period })
    assertEquals(listOf(6.0, 0.0, 4.0), formPeriodSeries(f.periods).map { it.submissions })
    assertEquals(listOf("2026-10", "2026-11"), formPeriodSeries(f.periods, maxPeriods = 2).map { it.period })
    val rates = FormRates.of(f)
    assertEquals("40.0%", rates.lead?.percent)
    assertEquals("4 of 10 submissions", rates.lead?.detail)
    // Every stored month with views counts, as the console reads them (81 views, 10 submissions); starts in one (20, 6).
    assertEquals("12.3%", rates.completion?.percent)
    assertEquals("70.0%", rates.abandon?.percent)
    assertEquals("14 of 20 starts", rates.abandon?.detail)
    assertNull(FormRates.of(form()).completion)
  }

  @Test
  fun savesOnlyTheAfterSendAnswersThatChanged() = runTest {
    val updates = mutableListOf<Map<String, Any?>>()
    val writer = object : FirestoreWriter {
      override suspend fun merge(path: String, data: Map<String, Any?>) = Unit
      override suspend fun update(path: String, data: Map<String, Any?>) {
        updates += data
      }
    }
    val api = FormsApi(ConsoleApiClient(origin = "https://x.test/", http = HttpClient(MockEngine { respond("{}") }), getIdToken = { "t" }, maxAttempts = 1), writer, "h")
    val f = form("routing" to mapOf("lead" to false))
    api.saveResponses(f, asksForQuote = true, confirms = null)
    assertEquals(mapOf("kind" to "quote"), updates[0]["request"])
    assertFalse("confirmationEmail" in updates[0])
    api.saveResponses(f, asksForQuote = false, confirms = true)
    assertTrue("request" in updates[1] && updates[1]["request"] == null)
    assertEquals(true, updates[1]["confirmationEmail"])
    api.saveRouting(f, lead = false, consentFieldName = null, optInOnSubmit = true)
    assertEquals(true, updates[2]["optInOnSubmit"])
    api.saveRouting(f, lead = false, consentFieldName = null)
    assertFalse("optInOnSubmit" in updates[3])
    assertEquals("/forms/f/versions/v/preview", formBesignerPath("f", "v", preview = true))
  }
}
