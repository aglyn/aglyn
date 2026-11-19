package com.aglyn.screens

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import java.io.ByteArrayInputStream
import java.security.MessageDigest
import javax.imageio.ImageIO
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Waivers, part two (AGL-4042): a waiver signed at the window on staff's own device, with a drawn signature in the shape
 * the console's pad sends, and a waiver signed on paper recorded with a photo of the page. The new field kinds
 * (`signature`, `photo`, `group`) and the `text` block are checked here as well.
 */
class WaiversSignSpecsTest : SpecTestBase() {
  private val case: SignatureStrokes = listOf(listOf(100 to 100, 200 to 300, 400 to 500), listOf(900 to 900), listOf(0 to 0, 1000 to 1000))

  @Test
  fun aDrawnSignatureIsTakenAsTheConsolesPadTakesIt() {
    // Points are whole numbers from 0 to 1000, rounded half up and kept on the pad.
    assertEquals(500 to 250, SignatureInk.at(150f, 25f, 300f, 100f))
    assertEquals(1000 to 0, SignatureInk.at(400f, -5f, 300f, 100f))
    assertEquals(2 to 0, SignatureInk.at(0.5f, 0f, 300f, 100f))
    // A point under 3 away from the last is skipped; a press always starts a stroke.
    val started = SignatureInk.begin(emptyList(), 10 to 10)
    assertNull(SignatureInk.extend(started, 11 to 11))
    assertEquals(listOf(listOf(10 to 10, 12 to 11)), SignatureInk.extend(started, 12 to 11))
    // Past 3,900 points in all, a stroke takes no more.
    val full = listOf(List(SignatureInk.MAX_POINTS) { (it % 1000) to 0 })
    assertNull(SignatureInk.extend(full, 500 to 500))
    assertEquals(2, SignatureInk.begin(full, 1 to 1).size)
  }

  @Test
  fun theSignatureIsKeptAsStrokesAndAOneBitPng() {
    val png = SignatureInk.png(case)
    // The same bytes the Apple kit makes (bin/signature-png-ref.py computes them independently).
    assertEquals(60468, png.size)
    assertEquals("f213b44458fca0eabc3f5b4e5bb5da81c4ded6a7295d51769990f2ea259514a3", MessageDigest.getInstance("SHA-256").digest(png).joinToString("") { "%02x".format(it) })
    val image = assertNotNull(ImageIO.read(ByteArrayInputStream(png)))
    assertEquals(1200 to 400, image.width to image.height)
    fun ink(x: Int, y: Int) = image.getRGB(x, y) and 0xFFFFFF == 0
    assertTrue(ink(120, 40), "the first stroke starts at (100, 100) of 1000")
    assertTrue(ink(1080, 360), "a single tap is a dot")
    assertTrue(!ink(1100, 40), "the rest of the pad stays white")

    val stored = SignatureInk.encode(case)
    val value = Json.parseToJsonElement(stored).jsonObject
    assertEquals(Json.parseToJsonElement("[[[100,100],[200,300],[400,500]],[[900,900]],[[0,0],[1000,1000]]]"), value["strokes"])
    assertTrue((value["png"] as JsonPrimitive).content.startsWith("data:image/png;base64,iVBORw0KGgo"))
    assertEquals(case, SignatureInk.strokesOf(stored))
    assertEquals("", SignatureInk.encode(emptyList()))
    assertEquals(JsonNull, SignatureInk.json(""))
    assertEquals(value, SignatureInk.json(stored))
    assertEquals(value, fieldJson(FieldSpec.parse(json("""{"key":"drawn","label":"Signature","kind":"signature"}"""))!!, FieldValue.Text(stored)))
  }

  @Test
  fun aPagePhotoIsShrunkToSixteenHundredPixelsAndNeverGrown() {
    val big = PagePhoto.plan(4032, 3024)
    assertEquals(1600 to 1200, big.width to big.height)
    assertEquals(4032 to 3024, big.cropW to big.cropH)
    assertTrue(!big.png)
    val tall = PagePhoto.plan(1000, 3000)
    assertEquals(533 to 1600, tall.width to tall.height)
    val small = PagePhoto.plan(800, 600)
    assertEquals(800 to 600, small.width to small.height)
    val url = PagePhoto.dataUrl(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 1))
    assertEquals("data:image/jpeg;base64,/9j/AQ==", url)
    assertEquals(listOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 1), PagePhoto.bytesOf(url)!!.toList())
    assertNull(PagePhoto.bytesOf("not a photo"))
    assertEquals(listOf(com.aglyn.ui.PickSource.PHOTOS, com.aglyn.ui.PickSource.CAMERA), pagePhotoSources(com.aglyn.ui.PickSource.entries))
    assertEquals(listOf(com.aglyn.ui.PickSource.FILES), pagePhotoSources(listOf(com.aglyn.ui.PickSource.FILES)))
  }

  @Test
  fun aGroupStartsWithItsMinimumAndSendsEachSetTrimmed() {
    val field = FieldSpec.parse(
      json("""{"key":"minors","label":"","kind":"group","min":1,"max":10,"fields":[{"key":"name","label":"Minor’s full name","kind":"text"},{"key":"dateOfBirth","label":"Minor’s date of birth","kind":"date"}]}"""),
    )!!
    val start = initialValue(field, JsonObject(emptyMap()))
    assertEquals(FieldValue.Text("""[{}]"""), start)
    val typed = FieldGroups.encode(listOf(mapOf("name" to " Sam Lee "), mapOf("name" to "Kim", "dateOfBirth" to "2016-02-03")))
    assertEquals(listOf(mapOf("name" to " Sam Lee "), mapOf("name" to "Kim", "dateOfBirth" to "2016-02-03")), FieldGroups.items(typed))
    assertEquals(
      Json.parseToJsonElement("""[{"name":"Sam Lee","dateOfBirth":""},{"name":"Kim","dateOfBirth":"2016-02-03"}]"""),
      fieldJson(field, FieldValue.Text(typed)),
    )
    val none = FieldSpec.parse(json("""{"key":"minors","label":"","kind":"group","min":0,"fields":[]}"""))!!
    assertEquals(FieldValue.Text("[]"), initialValue(none, JsonObject(emptyMap())))
  }

  private fun waiver(id: String, status: String, allowMinors: Boolean = true) =
    """{"id":"$id","title":"Rider release $id","status":"$status","version":3,"validity":{"kind":"visit"},"allowMinors":$allowMinors,
       "checkboxes":[{"id":"read","label":"I have read it."}]}"""

  private val public = """{"w":{"site":{"name":"Hill Track","contact":"help@example.com"},
    "waiver":{"id":"w1","version":3,"title":"Rider release","body":"Ride at **your own** risk.","checkboxes":[{"id":"read","label":"I have read it."},{"id":"b2","label":"I can ride."}],
      "allowMinors":true,"validityText":"Good for the day it is signed"},
    "consent":{"heading":"Signing electronically","text":"I agree to sign electronically.","version":2},"adultAge":19}}"""

  private fun withPermissions(spec: ScreenSpec, params: Map<String, String>, data: String, permissions: Map<String, Boolean>): ScreenModel {
    val session = ScreenSession(orgName = "Acme", orgRole = "member", siteName = "Shop", origin = "https://console.test", orgPermissions = permissions, sitePermissions = permissions)
    val model = ScreenModel(spec, session.context(Site(), params), null)
    model.seed(Json.parseToJsonElement(data))
    return model
  }

  @Test
  fun signAtWindowAndRecordPaperWaiverAreReachedAsTheConsoleReachesThem() {
    val home = spec("waivers", "waivers.home")
    val data = """{"list":{"waivers":[${waiver("w1", "published")},${waiver("w2", "draft")}],"signPageOrigin":null,"businessContact":"help@example.com"},"sigs":{"signatures":[]}}"""
    val owner = screen(home, emptyMap(), data)
    val sign = owner.rowActions("waivers").first { it.id == "signAtWindow" }
    assertTrue(ScreenValues.condition(sign.whenCondition, owner.row("data.list.waivers", 0)))
    assertTrue(!ScreenValues.condition(sign.whenCondition, owner.row("data.list.waivers", 1)), "a draft takes no signatures")
    assertEquals("waivers.sign", sign.navigate?.screen)
    assertEquals(listOf("find", "paper", "export"), owner.actionsShown("signaturesTools"))
    // Without Collect waivers (or Manage waivers), neither shows.
    val viewer = withPermissions(home, emptyMap(), data, emptyMap())
    assertTrue(!ScreenValues.condition(sign.whenCondition, viewer.row("data.list.waivers", 0)))
    assertTrue("signaturesTools" !in viewer.shown())
    val collector = withPermissions(home, emptyMap(), data, mapOf("collectWaivers" to true))
    assertTrue(ScreenValues.condition(sign.whenCondition, collector.row("data.list.waivers", 0)))
  }

  @Test
  fun aSigningAtTheWindowSendsWhatTheConsolesFormSends() {
    val spec = spec("waivers", "waivers.sign")
    assertEquals("/api/waivers/public?hostId=h1&waiverId=w1", ScreenValues.render(spec.loads.first { it.key == "w" }.url!!, screen(spec, mapOf("waiverId" to "w1"), "{}").context))
    val model = screen(spec, mapOf("waiverId" to "w1"), public)
    assertEquals(listOf("handOver", "about", "contact", "words", "sign"), model.shown())
    assertEquals("Hill Track", ScreenValues.render(model.block("about").title!!, model.context))
    assertEquals("Questions about this waiver? Contact Hill Track at help@example.com.", ScreenValues.render(model.block("contact").string("source")!!, model.context))
    val fields = model.fieldsShown("sign", """{"method":"drawn"}""").map { it.key }
    assertEquals(listOf("aboutYou", "name", "email", "phone", "dateOfBirth", "forMinors", "checked", "consentHeading", "consent", "signatureHeading", "method", "drawn"), fields)
    assertEquals("I’m also signing for people under 19", ScreenValues.render(model.fieldsShown("sign").first { it.key == "forMinors" }.label, model.context))
    assertEquals(
      listOf("guardian", "minors", "relationship"),
      model.fieldsShown("sign", """{"forMinors":true,"method":"typed"}""").map { it.key }.filter { it in setOf("aboutYou", "guardian", "minors", "relationship") },
    )
    assertTrue("typed" in model.fieldsShown("sign", """{"method":"typed"}""").map { it.key })

    val drawn = SignatureInk.encode(case)
    val form = model.form("sign")
    assertEquals("/api/waivers/sign-at-window", form.url)
    val sent = model.body(
      form,
      """{"name":"Pat Lee","email":"","phone":"","dateOfBirth":"1990-01-02","forMinors":true,
          "minors":[{"name":"Sam Lee","dateOfBirth":"2015-04-02"}],"relationship":"Parent","checked":["read","b2"],"consent":true,
          "method":"drawn","drawn":$drawn}""",
    ).jsonObject
    assertEquals(
      Json.parseToJsonElement(
        """{"hostId":"h1","waiverId":"w1","version":3.0,"signer":{"name":"Pat Lee","email":"","phone":"","dateOfBirth":"1990-01-02"},
          "minors":[{"name":"Sam Lee","dateOfBirth":"2015-04-02"}],"guardianRelationship":"Parent","checked":["read","b2"],
          "signature":{"kind":"drawn","strokes":[[[100,100],[200,300],[400,500]],[[900,900]],[[0,0],[1000,1000]]]},
          "signatureImage":"${SignatureInk.dataUrl(case)}","consent":true,"website":""}""",
      ),
      JsonObject(sent - "attemptKey"),
    )
    assertTrue("attemptKey" in form.body.toString() && "{attempt}" in form.body.toString(), "one key per signing, kept by its retry")
    val typed = model.body(form, """{"name":"Pat","dateOfBirth":"1990-01-02","forMinors":false,"consent":true,"method":"typed","typed":"Pat Lee"}""").jsonObject
    assertEquals(Json.parseToJsonElement("""{"kind":"typed","text":"Pat Lee"}"""), typed["signature"])
    assertTrue("signatureImage" !in typed, "a typed signature sends no picture, as the console sends none")
    assertEquals(JsonArray(emptyList()), typed["minors"])
    assertEquals(JsonPrimitive(""), typed["guardianRelationship"])

    // A signing that lands moves the hidden seed (the form starts empty for the next signer) and opens Signed.
    val seed = FieldSpec.parseAll(model.block("sign").raw.jsonObject["fields"] as JsonArray, model.context).first { it.key == "signed" }
    assertEquals("{stash.waiverSigned}", seed.initial)
    assertTrue("signed" !in model.fieldsShown("sign").map { it.key }, "never shown, so never sent")
    assertEquals(mapOf("waiverSigned" to "{response.signature.id}"), (form.stash as JsonObject).mapValues { (it.value as JsonPrimitive).content })
    assertEquals("waivers.signed", form.navigate?.screen)
    val answer = Json.parseToJsonElement(
      """{"signature":{"id":"g1","signerName":"Pat Lee","minors":[{"name":"Sam Lee"},{"name":"Kim Lee"}],"dayKey":"2026-11-16","validThroughDayKey":"2026-11-16","email":"pat@example.com"},
          "copyUrl":"/api/waivers/signed-copy?hostId=h1&signatureId=g1&token=t"}""",
    )
    val after = ScreenContext.with(model.context, "response", answer)
    val params = form.navigate!!.params.mapValues { ScreenValues.render(it.value, after) }
    assertEquals(
      mapOf("title" to "Rider release", "signer" to "Pat Lee", "minors" to "Sam Lee, Kim Lee", "dayKey" to "2026-11-16", "through" to "2026-11-16", "emailed" to "true", "copyUrl" to "/api/waivers/signed-copy?hostId=h1&signatureId=g1&token=t"),
      params,
    )

    // No Collect waivers: the console's own sentence, and no form.
    val viewer = withPermissions(spec, mapOf("waiverId" to "w1"), public, emptyMap())
    assertEquals(listOf("noCollect"), viewer.shown())
  }

  @Test
  fun signedSaysWhoAndForWhichDaysThenOffersTheNextSigner() {
    val spec = spec("waivers", "waivers.signed")
    fun text(params: Map<String, String>): List<String> {
      val model = screen(spec, params, "{}")
      return model.shown().filter { model.block(it).type == "notice" }.map { ScreenValues.render(model.block(it).string("text")!!, model.context) }
    }
    val base = mapOf("title" to "Rider release", "signer" to "Pat Lee", "minors" to "", "dayKey" to "2026-11-16", "through" to "2026-11-16", "emailed" to "false", "copyUrl" to "")
    assertEquals(listOf("Signed. Thank you! Rider release is signed for Pat Lee. Good for Nov 16, 2026."), text(base))
    assertEquals(
      listOf("Signed. Thank you! Rider release is signed for Pat Lee, Sam Lee. Good Nov 16, 2026 through Nov 15, 2027.", "A signed copy is on its way to your email."),
      text(base + mapOf("minors" to "Sam Lee", "through" to "2027-11-15", "emailed" to "true")),
    )
    val withCopy = screen(spec, base + ("copyUrl" to "/api/waivers/signed-copy?token=t"), "{}")
    assertTrue("copy" in withCopy.shown())
    assertEquals("https://console.test/api/waivers/signed-copy?token=t", ScreenValues.render(withCopy.block("copy").string("value")!!, withCopy.context))
    assertTrue("copy" !in screen(spec, base, "{}").shown())
    assertTrue(withCopy.action("next", "nextSigner").back)
  }

  @Test
  fun aPaperWaiverIsRecordedWithItsPhotoAsTheConsoleRecordsIt() {
    val spec = spec("waivers", "waivers.paper")
    val none = screen(spec, emptyMap(), """{"list":{"waivers":[${waiver("w2", "draft")}]}}""")
    assertEquals(listOf("nonePublished", "record"), none.shown())
    val model = screen(spec, emptyMap(), """{"list":{"waivers":[${waiver("w1", "published")},${waiver("w2", "draft")},${waiver("w3", "published", allowMinors = false)}]}}""")
    assertEquals(listOf("record"), model.shown())
    val waiverField = model.fieldsShown("record").first { it.key == "waiverId" }
    assertEquals(listOf("w1" to "Rider release w1", "w3" to "Rider release w3"), waiverField.choices(model.context))
    assertTrue(waiverField.required)
    assertEquals(listOf("waiverId", "signedOn", "name", "email", "phone", "dateOfBirth", "photo"), model.fieldsShown("record", """{"waiverId":"w3"}""").map { it.key })
    assertEquals(listOf("waiverId", "signedOn", "name", "email", "phone", "dateOfBirth", "minors", "photo"), model.fieldsShown("record", """{"waiverId":"w1","minors":[]}""").map { it.key })
    assertTrue("relationship" in model.fieldsShown("record", """{"waiverId":"w1","minors":[{"name":"Sam"}]}""").map { it.key })
    val photo = model.fieldsShown("record").first { it.key == "photo" }
    assertEquals("photo", photo.kind)
    assertTrue(photo.required && model.fieldsShown("record").first { it.key == "name" }.required)

    val form = model.form("record")
    assertEquals("/api/waivers/paper", form.url)
    assertTrue(form.back)
    val sent = model.body(
      form,
      """{"waiverId":"w1","signedOn":"2026-11-15","name":"Riley Park","email":"","phone":"","dateOfBirth":"1985-01-01",
          "minors":[{"name":"Sam Park","dateOfBirth":"2016-03-04"}],"relationship":"Parent","photo":"data:image/jpeg;base64,/9j/AQ=="}""",
    ).jsonObject
    assertEquals(
      Json.parseToJsonElement(
        """{"hostId":"h1","waiverId":"w1","signedOnDayKey":"2026-11-15","signer":{"name":"Riley Park","email":"","phone":"","dateOfBirth":"1985-01-01"},
          "minors":[{"name":"Sam Park","dateOfBirth":"2016-03-04"}],"guardianRelationship":"Parent","photo":"data:image/jpeg;base64,/9j/AQ=="}""",
      ),
      JsonObject(sent - "attemptKey"),
    )
    val alone = model.body(form, """{"waiverId":"w3","signedOn":"2026-11-15","name":"Riley Park","photo":"data:image/jpeg;base64,/9j/AQ=="}""").jsonObject
    assertEquals(JsonArray(emptyList()), alone["minors"])
    assertEquals(JsonPrimitive(""), alone["guardianRelationship"])
  }
}
