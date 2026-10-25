package com.aglyn.plugins.email

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import java.io.File
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Replays the console's own answers (function-cases.generated.json) through the Email plugin's ports. */
class EmailCasesTest {
  private val functions = Json.parseToJsonElement(
    File("../../../../native/contracts/function-cases.generated.json").readText(),
  ).jsonObject.getValue("functions").jsonObject

  private fun cases(name: String) = functions.getValue(name).jsonObject.getValue("cases").jsonArray.map {
    it.jsonObject.getValue("args").jsonArray to it.jsonObject.getValue("result")
  }

  private fun plain(element: JsonElement?): Any? = when (element) {
    null, JsonNull -> null
    is JsonObject -> element.mapValues { plain(it.value) }
    is JsonArray -> element.map(::plain)
    is JsonPrimitive -> if (element.isString) element.content else element.booleanOrNull ?: element.longOrNull ?: element.doubleOrNull
  }

  @Suppress("UNCHECKED_CAST")
  private fun map(element: JsonElement?) = plain(element) as? Map<String, Any?>

  @Test
  fun sendDisplayCases() = cases("campaignSendDisplay").forEach { (args, result) ->
    val got = campaignSendDisplay(map(args[0]))
    val want = result.jsonObject
    val progress = want.getValue("progress").jsonObject
    assertEquals((want["state"] as JsonPrimitive).content, got.state, args.toString())
    assertEquals((want["label"] as JsonPrimitive).content, got.label, args.toString())
    assertEquals((progress["label"] as JsonPrimitive).content, got.progress.label, args.toString())
    assertEquals((progress["reached"] as JsonPrimitive).longOrNull, got.progress.reached.toLong(), args.toString())
  }

  @Test
  fun reportCases() = cases("campaignReport").forEach { (args, result) ->
    val got = campaignReport(map(args[0]))
    val want = result.jsonObject
    val caveats = want["caveats"]?.jsonArray.orEmpty().map { (it.jsonObject["id"] as JsonPrimitive).content }
    assertEquals(caveats, got.caveats.map { it.id }, args.toString())
    val rates = want["rates"]?.jsonObject.orEmpty()
    for ((key, rate) in rates) {
      val gotRate = got.rates[key]
      if (rate is JsonNull) {
        assertNull(gotRate, "$args $key")
      } else {
        val value = (rate.jsonObject["value"] as JsonPrimitive).doubleOrNull!!
        assertTrue(gotRate != null && abs(gotRate.value - value) < 1e-9, "$args $key")
      }
    }
  }

  @Test
  fun linkReportCases() = cases("sendLinkReport").forEach { (args, result) ->
    val got = sendLinkReport(map(args[0]))
    val want = result.jsonObject
    assertEquals(want["rows"]?.jsonArray.orEmpty().map { (it.jsonObject["url"] as JsonPrimitive).content }, got.rows.map { it.url }, args.toString())
    assertEquals((want["attributedClicks"] as JsonPrimitive).longOrNull, got.attributedClicks.toLong(), args.toString())
  }

  @Test
  fun newDesignCases() {
    cases("emailDesignStarterNodes").forEach { (args, result) ->
      val ids = args[0].jsonObject
      val got = emailDesignStarterNodes((ids["sectionId"] as JsonPrimitive).content, (ids["textId"] as JsonPrimitive).content)
      assertEquals(plain(result), got, args.toString())
    }
    cases("emailDesignDocuments").forEach { (args, result) ->
      val input = args[0].jsonObject
      val (screen, version) = emailDesignDocuments(
        (input["screenId"] as JsonPrimitive).content,
        (input["versionId"] as JsonPrimitive).content,
        (input["displayName"] as JsonPrimitive).content,
        map(input["nodes"])!!,
      )
      assertEquals(plain(result.jsonObject["screen"]), screen, args.toString())
      assertEquals(plain(result.jsonObject["version"]), version, args.toString())
    }
  }

  @Test
  fun audiencePickSplitsOnce() {
    assertEquals("list", AudiencePick("list:abc").kind)
    assertEquals("abc", AudiencePick("list:abc").listId)
    assertEquals("s1", AudiencePick("segment:s1").segmentId)
    assertEquals("list:L", AudiencePick.stored(mapOf("audience" to "list", "listId" to "L"))?.raw)
    assertEquals(listOf("a@x.test", "b@x.test", "c@x.test"), addressesIn("a@x.test, b@x.test;\nc@x.test"))
  }

  @Test
  fun aListRowNamesAStoppedSendWithTheDetailsWord() {
    fun word(data: Map<String, Any?>) = sendChipWord(emailSendOf(com.aglyn.core.FirestoreDoc("e1", "orgs/o/emails/e1", data)))
    assertEquals("Canceled", word(mapOf("status" to "canceled")))
    assertEquals("Failed", word(mapOf("status" to "failed")))
    assertEquals("Draft", word(mapOf("status" to "draft")))
    assertEquals("Sent", word(mapOf("status" to "sent", "stats" to mapOf("sent" to 3))))
  }

  @Test
  fun aCanceledEmailThatNeverWentOutSaysSoAndNamesWhatAnAbsentSenderMeans() {
    val canceled = mapOf<String, Any?>("status" to "canceled")
    assertEquals("Canceled before it was sent", campaignSendDisplay(canceled).label)
    assertEquals("Not sent", sentAsMissing(canceled))
    assertEquals("This email was not sent to anybody, so there is nothing to report.", deliveryPlaceholder(canceled))
    assertNull(emailSentAs(canceled))
    assertEquals("Not sent yet", sentAsMissing(mapOf("status" to "scheduled")))
    // Sent before sends recorded their sender.
    val old = mapOf<String, Any?>("status" to "sent", "stats" to mapOf("sent" to 12))
    assertEquals("Not recorded", sentAsMissing(old))
    assertNull(deliveryPlaceholder(old))
    // A recorded sender with no display name or reply address: the address alone, replies to it.
    assertEquals(SentAs("news@bakery.test", null, null), emailSentAs(old + ("sentAs" to mapOf("from" to " news@bakery.test ", "fromName" to "", "replyTo" to null))))
    // A canceled send that reached some is a report, not a never-sent email.
    val partly = mapOf<String, Any?>("status" to "canceled", "stats" to mapOf("sent" to 10), "resume" to mapOf("remaining" to 30))
    assertEquals("Reached 10 — canceled with 30 not addressed", campaignSendDisplay(partly).label)
    assertNull(deliveryPlaceholder(partly))
  }

  /** The plan's answer as the preview route sends it (AGL-4055): drawn as it comes, with the plan named after the notice. */
  @Test
  fun planLockReadsFromAnAnswerOrARefusal() {
    val free = Json.parseToJsonElement(
      """{"sendable":0,"planLock":{"kind":"not-on-plan","planLabel":"Pro","reason":"Campaign email is included from Pro.","notice":"Your plan does not include campaign email."}}""",
    )
    val lock = CampaignPlanLock.from(free)
    assertEquals("not-on-plan", lock?.kind)
    assertEquals("Campaign email is included from Pro.", lock?.reason)
    assertEquals("Your plan does not include campaign email. Included from Pro.", lock?.message)
    assertNull(CampaignPlanLock.from(Json.parseToJsonElement("""{"sendable":3,"planLock":null}""")))
    assertNull(CampaignPlanLock.from(Json.parseToJsonElement("""{"sendable":3}""")))
    assertNull(CampaignPlanLock.from(null))
    val unnamed = Json.parseToJsonElement("""{"error":"x","planLock":{"kind":"allowance-spent","planLabel":null,"reason":"r","notice":"n"}}""")
    assertEquals("n", CampaignPlanLock.from(unnamed)?.message)
  }
}
