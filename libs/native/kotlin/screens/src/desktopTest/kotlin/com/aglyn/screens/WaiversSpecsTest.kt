package com.aglyn.screens

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Waivers page (AGL-4042) as the console's cards draw it: the site's waivers with how long a signature lasts and
 * the share link, writing one (the exact body the templates route takes), publishing it, and the signatures searched,
 * exported, opened, voided and downloaded.
 */
class WaiversSpecsTest : SpecTestBase() {
  private fun waiver(id: String, status: String, validity: String) =
    """{"id":"$id","title":"Rider release","status":"$status","version":3,"validity":$validity,"updatedAtMs":1760000000000,
       "body":"Ride at your own risk.","checkboxes":[{"id":"read","label":"I have read it."},{"id":"box-2","label":"I can ride."}],"allowMinors":false,"adultAge":19}"""

  private val sig =
    """{"id":"g1","waiverId":"w1","waiverTitle":"Rider release","version":3,"signerName":"Pat Lee","email":"pat@example.com","phone":"",
       "minors":[{"name":"Sam Lee","dateOfBirth":"2015-04-02"}],"method":"at_window","signedAtMs":1760000000000,"dayKey":"2025-10-09",
       "validThroughDayKey":"2025-10-09","voided":false,"retainedUntilMs":null}"""

  private fun home(origin: String? = "https://shop.example.com") = screen(
    spec("waivers", "waivers.home"), emptyMap(),
    """{"list":{"waivers":[${waiver("w1", "published", """{"kind":"days","days":365}""")},${waiver("w2", "draft", """{"kind":"season","endDayKey":"2026-12-31"}""")},${waiver("w3", "retired", """{"kind":"visit"}""")}],
        "signPageOrigin":${origin?.let { "\"$it\"" } ?: "null"},"businessContact":null},"sigs":{"signatures":[$sig],"next":null}}""",
  )

  private fun ScreenModel.line(block: String, key: String, row: JsonElement): String? = rowLine(block(block).raw.jsonObject[key]!!, row)

  @Test
  fun theWaiversSayHowLongASignatureLastsAndShareTheStoresOwnLink() {
    val model = home()
    assertEquals(listOf("noContact", "signaturesTools", "signatures", "waivers"), model.shown())
    val rows = (0..2).map { model.row("data.list.waivers", it) }
    assertEquals(listOf("Good for a year", "Good through Dec 31, 2026", "Good for one visit (the day it is signed)"), rows.map { model.line("waivers", "secondary", it) })
    assertEquals(listOf("share"), model.rowActions("waivers").map { it.id })

    // Share for signing: the store's own signing page, its QR code and Copy link; a draft says to publish first.
    val share = spec("waivers", "waivers.share")
    fun shareOf(origin: String?, status: String) = screen(
      share, mapOf("waiverId" to "w1"),
      """{"list":{"waivers":[${waiver("w1", status, """{"kind":"visit"}""")}],"signPageOrigin":${origin?.let { "\"$it\"" } ?: "null"}}}""",
    )
    val own = shareOf("https://shop.example.com", "published")
    assertEquals(listOf("ownSite", "link", "code", "copy"), own.shown())
    assertEquals("https://shop.example.com/sign-waiver?waiver=w1", ScreenValues.render(own.block("code").string("value")!!, own.context))
    assertEquals(listOf("copyLink"), own.actionsShown("copy"))
    val bare = shareOf(null, "draft")
    assertEquals(listOf("draft", "consoleSite", "link", "codeConsole", "copy"), bare.shown())
    assertEquals("https://console.test/kiosk/waivers/sign?host=h1&waiver=w1", ScreenValues.render(bare.block("codeConsole").string("value")!!, bare.context))
  }

  @Test
  fun signaturesAreSearchedPagedExportedAndRead() {
    val model = home()
    val row = model.row("data.sigs.signatures")
    assertEquals("Pat Lee · Sam Lee", model.line("signatures", "primary", row))
    assertTrue(model.line("signatures", "secondary", row)!!.endsWith("Rider release (v3) · At the window"))
    val sigs = spec("waivers", "waivers.signatures")
    val load = sigs.loads.first { it.key == "sigs" }
    val filtered = screen(sigs, mapOf("q" to "lee", "waiverId" to "w1"), """{"list":{"waivers":[${waiver("w1", "published", """{"kind":"visit"}""")}]},"sigs":{"signatures":[]}}""")
    assertEquals("/api/waivers/signatures?hostId=h1&limit=25&q=lee&waiverId=w1", ScreenValues.render(load.url!!, filtered.context))
    assertEquals("/api/waivers/signatures?hostId=h1&format=csv&q=lee&waiverId=w1", ScreenValues.render(filtered.action("signaturesTools", "export").url!!, filtered.context))
    val day = screen(sigs, mapOf("q" to "lee", "day" to "2025-10-09"), """{"list":{"waivers":[]},"sigs":{"signatures":[]}}""")
    assertEquals("/api/waivers/signatures?hostId=h1&limit=25&q=2025-10-09&waiverId=", ScreenValues.render(load.url!!, day.context))

    val detail = spec("waivers", "waivers.signature")
    val record = """{"sig":{"signature":{"id":"g1","waiverTitle":"Rider release","version":3,"dayKey":"2025-10-09","validThroughDayKey":"2026-10-08",
      "method":"online","adultAge":19,"signer":{"name":"Pat Lee","dateOfBirth":"1990-01-02","email":"pat@example.com"},"minors":[],
      "signature":{"kind":"typed","text":"Pat Lee"},"signedAtMs":1760000000000,"audit":{"ip":"1.2.3.4"},"signedTextSha256":"abc"}}}"""
    val one = screen(detail, mapOf("signatureId" to "g1"), record)
    val covers = one.block("waiver").raw.jsonObject["rows"]!!.jsonArray.map { it.jsonObject }.filter { ScreenValues.condition((it["when"] as? JsonPrimitive)?.content, one.context) }
    assertEquals("Good Oct 9, 2025 through Oct 8, 2026", ScreenValues.render((covers[1]["value"] as JsonPrimitive).content, one.context))
    assertEquals(listOf("pdf", "void"), one.actionsShown("record"))
    assertEquals(json("""{"hostId":"h1","signatureId":"g1","action":"void","reason":"Wrong rider"}"""), one.body(one.action("record", "void"), """{"reason":"Wrong rider"}"""))
  }

  @Test
  fun aWaiverIsSavedInTheShapeTheTemplatesRouteTakes() {
    val editor = spec("waivers", "waivers.waiver")
    val model = screen(editor, mapOf("waiverId" to "w1"), """{"w":{"waiver":${waiver("w1", "draft", """{"kind":"days","days":30}""")},"versions":[{"version":3,"title":"Rider release","savedAtMs":1760000000000}]}}""")
    assertEquals(listOf("publish", "retire"), model.actionsShown("status"))
    val fields = model.fieldsShown("edit", """{"kind":"days"}""").associateBy { it.key }
    assertEquals("I have read it.\nI can ride.", ScreenValues.text(ScreenValues.resolve(fields.getValue("checkboxes").initial!!, model.context)).let { _ ->
      (ScreenValues.resolve(fields.getValue("checkboxes").initial!!, model.context) as kotlinx.serialization.json.JsonArray).joinToString("\n") { ScreenValues.text(it) }
    })
    assertEquals("false", ScreenValues.text(ScreenValues.resolve(fields.getValue("allowMinors").initial!!, model.context)))
    assertEquals(
      json("""{"hostId":"h1","waiverId":"w1","waiver":{"title":"Rider release","body":"Ride.","checkboxes":[{"id":"read","label":"I have read it."},{"label":"Helmet on."}],
        "adultAge":19.0,"allowMinors":true,"validity":{"kind":"days","days":30.0}}}"""),
      model.body(model.form("edit"), """{"title":"Rider release","body":"Ride.","checkboxes":["I have read it.","Helmet on."],"adultAge":"19","allowMinors":true,"kind":"days","days":30}"""),
    )
    val fresh = screen(editor, mapOf("waiverId" to ""), "{}")
    val season = fresh.body(fresh.form("create"), """{"title":"T","body":"B","checkboxes":[],"adultAge":"18","allowMinors":false,"kind":"season","endDayKey":"2026-12-31"}""").jsonObject
    assertTrue("waiverId" !in season)
    assertEquals(json("""{"kind":"season","endDayKey":"2026-12-31"}"""), season.getValue("waiver").jsonObject.getValue("validity"))
    assertTrue("edit" !in fresh.shown() && "create" in fresh.shown() && fresh.form("create").back, "a new waiver goes back to the list it now heads")
    val newFields = fresh.fieldsShown("create").associateBy { it.key }
    assertEquals("true", ScreenValues.text(ScreenValues.resolve(newFields.getValue("allowMinors").initial!!, fresh.context)))
    assertEquals("Version 3 · (current)", model.line("versions", "primary", model.row("data.w.versions")))
  }
}

/** A day key is a calendar day, not a moment: it reads the same in every time zone (the console's `formatDayKey`). */
class CalendarDayFormatTest {
  @Test
  fun aDayKeyIsTheSameDayWhereverTheDeviceIs() {
    val before = ScreenValues.timeZone
    try {
      ScreenValues.timeZone = "America/Chicago"
      assertEquals("Nov 15, 2027", ScreenValues.render("{item.day:date}", kotlinx.serialization.json.Json.parseToJsonElement("""{"item":{"day":"2027-11-15"}}""")))
      assertEquals("Nov 15, 2027", ScreenValues.render("{item.at:date}", kotlinx.serialization.json.Json.parseToJsonElement("""{"item":{"at":1826301600000}}""")))
    } finally {
      ScreenValues.timeZone = before
    }
  }
}
