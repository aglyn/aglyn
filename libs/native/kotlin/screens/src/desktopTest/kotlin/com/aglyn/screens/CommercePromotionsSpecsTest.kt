package com.aglyn.screens

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Discounts, coupons and gift cards as the console's cards have them: what each row says, which form fields show,
 * and the exact document or request each action makes.
 */
class CommercePromotionsSpecsTest : SpecTestBase() {
  private val id = "${'$'}id"

  private fun badges(model: ScreenModel, block: String, path: String, index: Int): List<String> {
    val row = model.row(path, index)
    return model.block(block).raw.jsonObject["badges"]!!.jsonArray.map { it.jsonObject }
      .filter { ScreenValues.condition((it["when"] as? JsonPrimitive)?.content, row) }
      .map { ScreenValues.render((it["text"] as JsonPrimitive).content, row) }
  }

  private val soon = "4102444800000"

  private fun discounts(writer: RecordingWriter = RecordingWriter()) = withWriter(
    spec("commerce", "commerce.discounts"), emptyMap(),
    """{"discounts":{"items":[
      {"$id":"d1","code":"SAVE10","kind":"percent","valuePct":10,"enabled":true,"redemptions":3,"maxRedemptions":100,"holds":{"a":{"expiresAtMs":$soon},"b":{"expiresAtMs":1000}}},
      {"$id":"d2","name":"Summer","kind":"fixed","valueCents":1250,"minSubtotalCents":5000,"productIds":["p1","p2"],"enabled":false,"redemptions":0},
      {"$id":"d3","name":"Ship free","kind":"free_shipping","redemptions":7}]}}""",
    writer,
  )

  @Test
  fun eachDiscountSaysWhatItTakesOffWhatItCoversAndHowMuchOfItIsSpoken() {
    val model = discounts()
    val list = model.block("discounts")
    assertEquals(listOf("SAVE10", "Summer", "Ship free"), (0..2).map { ScreenValues.render(list.string("primary")!!, model.row("data.discounts.items", it)) })
    assertEquals(listOf("10% off", "Store-wide", "3/100 used", "1 held in checkout"), badges(model, "discounts", "data.discounts.items", 0))
    assertEquals(listOf("${'$'}12.50 off", "2 products only", "Min ${'$'}50.00", "0 used", "Disabled"), badges(model, "discounts", "data.discounts.items", 1))
    assertEquals(listOf("Free shipping", "Store-wide", "7 used"), badges(model, "discounts", "data.discounts.items", 2))
  }

  @Test
  fun aDiscountIsWrittenToTheStoresDocumentAsTheConsoleWritesIt() {
    val writer = RecordingWriter()
    val model = discounts(writer)
    val add = model.action("add", "addDiscount")
    val shown = { form: String -> add.prompt.filter { ScreenValues.condition(it.whenCondition, ScreenContext.with(model.context, "form", json(form))) }.map { it.key } }
    assertEquals(listOf("code", "name", "kind", "valuePct", "minDollars", "maxRedemptions", "starts", "ends"), shown("""{"kind":"percent"}"""))
    assertEquals(listOf("code", "kind", "valueDollars", "minDollars", "maxRedemptions", "starts", "ends"), shown("""{"code":"x","kind":"fixed"}"""))
    assertEquals(listOf("code", "name", "kind", "minDollars", "maxRedemptions", "starts", "ends"), shown("""{"kind":"free_shipping"}"""))
    runBlocking {
      model.run(
        add,
        ScreenContext.with(model.context, "form", json("""{"code":" save-20! ","kind":"fixed","valueDollars":12.5,"minDollars":"50","starts":"2026-11-01","ends":"2026-11-30"}""")),
      )
    }
    assertEquals(
      "add hosts/h1/discounts {code=SAVE-20,enabled=true,endAtMs=1796083199000,kind=fixed,maxRedemptions=null,minSubtotalCents=5000,redemptions=0,startAtMs=1793491200000,valueCents=1250}",
      writer.calls.single().replace(", ", ","),
    )
    writer.calls.clear()
    val edit = model.rowActions("discounts").first { it.id == "edit" }
    val first = model.row("data.discounts.items", 1)
    assertEquals("12.50", ScreenValues.text(ScreenValues.resolve(edit.prompt.first { it.key == "valueDollars" }.initial!!, first)))
    assertEquals("50.00", ScreenValues.text(ScreenValues.resolve(edit.prompt.first { it.key == "minDollars" }.initial!!, first)))
    runBlocking { model.run(edit, ScreenContext.with(first, "form", json("""{"name":"Summer","kind":"fixed","valueDollars":15,"maxRedemptions":""}"""))) }
    assertEquals(
      "merge hosts/h1/discounts/d2 {code=null,endAtMs=null,kind=fixed,maxRedemptions=null,minSubtotalCents=null,name=Summer,startAtMs=null,valueCents=1500}",
      writer.calls.single().replace(", ", ","),
      "the live counter and the switch are not rewritten by an edit; a blank clears what it names",
    )
    writer.calls.clear()
    runBlocking { model.run(model.rowActions("discounts").first { it.id == "delete" }, model.row("data.discounts.items", 2)) }
    assertEquals(listOf("delete hosts/h1/discounts/d3"), writer.calls)
  }

  private fun coupons(writer: RecordingWriter = RecordingWriter()) = withWriter(
    spec("commerce", "commerce.coupons"), emptyMap(),
    """{"coupons":{"items":[
      {"$id":"LAUNCH20","percentOff":20,"enabled":true,"redemptions":4,"maxRedemptions":50,"expiresAtMs":$soon},
      {"$id":"OLD","percentOff":5,"enabled":false,"redemptions":0,"expiresAtMs":1000}]}}""",
    writer,
  )

  @Test
  fun couponsSayUsageAndExpiryAndSwitchOnAndOff() {
    val writer = RecordingWriter()
    val model = coupons(writer)
    assertEquals(listOf("4/50 used", "Expires Jan 1, 2100"), badges(model, "coupons", "data.coupons.items", 0))
    assertEquals(listOf("0 used", "Expired", "Disabled"), badges(model, "coupons", "data.coupons.items", 1))
    val active = model.row("data.coupons.items", 0)
    val off = model.row("data.coupons.items", 1)
    val actions = model.rowActions("coupons")
    assertEquals(listOf("disable"), actions.filter { ScreenValues.condition(it.whenCondition, active) }.map { it.id })
    assertEquals(listOf("enable"), actions.filter { ScreenValues.condition(it.whenCondition, off) }.map { it.id })
    runBlocking { model.run(actions.first { it.id == "enable" }, off) }
    assertEquals(listOf("merge hosts/h1/coupons/OLD {enabled=true}"), writer.calls)
  }

  @Test
  fun aCouponIsKeyedByItsCodeAndExpiresAtTheEndOfTheDayOnTheDevicesClock() {
    val writer = RecordingWriter()
    val model = coupons(writer)
    runBlocking {
      model.run(model.action("add", "addCoupon"), ScreenContext.with(model.context, "form", json("""{"code":"launch 20!","percentOff":20,"maxRedemptions":"","expiresOn":"2026-11-30"}""")))
    }
    val endOfDay = LocalDateTime.of(2026, 11, 30, 23, 59, 59, 999_000_000).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
    assertEquals(
      "merge hosts/h1/coupons/LAUNCH20 {createdAt=now,enabled=true,expiresAtMs=$endOfDay,maxRedemptions=null,percentOff=20,redemptions=0}",
      writer.calls.single().replace(", ", ","),
    )
    assertEquals(
      "AVERYLONGCODE".repeat(4).take(40),
      ScreenValues.render("{form.code:code/40}", ScreenContext.with(model.context, "form", json("""{"code":"${"averylongcode".repeat(4)}"}"""))),
      "a code is cut at forty characters, as the console cuts it",
    )
  }

  private fun cards(carried: Boolean) = screen(
    spec("commerce", "commerce.giftCards"), emptyMap(),
    """{"gate":{"carried":$carried,"label":"Business"},
       "cards":{"items":[
         {"$id":"AAAA-1111","balanceCents":2500,"initialCents":5000,"recipientEmail":"a@b.co","orderId":"o1"},
         {"$id":"BBBB-2222","balanceCents":1000,"initialCents":1000,"frozenAtMs":5},
         {"$id":"CCCC-3333","balanceCents":0,"initialCents":1000,"voidedAtMs":9,"voidedReason":"refund"}]},
       "live":{"items":[],"count":2,"sum":3500},"issued":{"items":[],"count":3}}""",
  )

  @Test
  fun aWorkspaceWithoutGiftCardsReadsWhatTheyAreAndWhichPlanHasThem() {
    val locked = cards(false)
    assertEquals(listOf("locked"), locked.shown())
    assertTrue(ScreenValues.render(locked.block("locked").string("text")!!, locked.context).endsWith("Included from Business."))
    assertEquals(listOf("totals", "manage", "cards"), cards(true).shown())
  }

  @Test
  fun giftCardTotalsComeFromTheServersSumAndEachCardOffersOnlyWhatItCanDo() {
    val model = cards(true)
    val rows = model.block("totals").raw.jsonObject["rows"]!!.jsonArray.map { it.jsonObject }
    assertEquals(listOf("${'$'}35.00", "2", "3"), rows.map { ScreenValues.render((it["value"] as JsonPrimitive).content, model.context) })
    val unavailable = screen(spec("commerce", "commerce.giftCards"), emptyMap(), """{"gate":{"carried":true},"cards":{"items":[]},"live":{"items":[]},"issued":{"items":[]}}""")
    assertEquals("Unavailable", ScreenValues.render((unavailable.block("totals").raw.jsonObject["rows"]!!.jsonArray[0].jsonObject["value"] as JsonPrimitive).content, unavailable.context))
    val actions = model.block("cards").raw.jsonObject["actions"]!!.jsonArray.mapNotNull { ActionSpec.parse(it) }
    fun offered(index: Int) = actions.filter { ScreenValues.condition(it.whenCondition, model.row("data.cards.items", index)) }.map { it.id }
    assertEquals(listOf("void"), offered(0))
    assertEquals(listOf("release", "void"), offered(1))
    assertEquals(emptyList(), offered(2))
    assertEquals(listOf("Issued by hand", "On hold: payment questioned"), badges(model, "cards", "data.cards.items", 1))
    assertEquals(listOf("Voided: order refunded"), badges(model, "cards", "data.cards.items", 2).filter { it.startsWith("Voided") })
    val void = actions.first { it.id == "void" }
    assertEquals(json("""{"hostId":"h1","action":"void","code":"AAAA-1111"}"""), ScreenValues.resolveBody(void.body!!, model.row("data.cards.items", 0)))
    assertEquals("/api/commerce/gift-cards", void.url)
    val issue = model.action("manage", "issue")
    assertEquals(
      json("""{"hostId":"h1","action":"issue","amountCents":2550,"recipientEmail":"x@y.co"}"""),
      model.body(issue, """{"amount":25.5,"email":"x@y.co"}"""),
    )
    assertEquals(json("""{"hostId":"h1","action":"issue","amountCents":10000,"recipientEmail":""}"""), model.body(issue, """{"amount":"100","email":""}"""), "the console sends the address even when it is blank")
  }

  @Test
  fun searchingGiftCardsQueriesTheTokensTheCardWritersStamp() {
    val search = spec("commerce", "commerce.giftCardsSearch")
    val query = search.loads.first().query!!.jsonObject
    assertEquals("""[["searchTokens","array-contains","{params.q:token}"]]""", query["where"]!!.toString().replace(" ", ""))
    assertEquals("createdAtMs desc", ScreenValues.text(query["orderBy"]))
    assertEquals("ada", ScreenValues.render("{params.q:token}", screen(search, mapOf("q" to "Ada Lovelace"), """{"cards":{"items":[]}}""").context))
    val aggregate = spec("commerce", "commerce.giftCards").loads.first { it.key == "live" }.query!!.jsonObject
    assertEquals("""[["balanceCents",">",0]]""", aggregate["where"]!!.toString().replace(" ", ""))
    assertFalse(aggregate["aggregate"]!!.jsonObject.isEmpty())
  }
}
