package com.aglyn.screens

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The Commerce plugin's own management screens (returns, stock history, catalog, promotions, reservations, queues
 * and settings), run against the store's documents and the routes' answers in the console's shapes: what each one
 * shows in each state, and the exact request or write each action makes.
 */
class CommerceAuditSpecsTest : SpecTestBase() {
  // ---- returns -----------------------------------------------------------------------------------------------------

  private val id = "${'$'}id"

  private fun returnDoc(status: String, extra: String = "") =
    """{"$id":"r1","orderId":"o9","orderNumber":"#1042","customerEmail":"a@b.co","customerName":"Ada","status":"$status","requestedBy":"buyer","customerNote":"Too small",
       "lines":[{"lineItemId":0,"quantity":2,"reason":"size_or_fit","name":"Tee"},{"lineItemId":1,"quantity":1,"reason":"damaged","name":"Mug"}],
       "timeline":[{"atMs":1760000000000,"event":"requested","detail":"By the buyer"}],"createdAtMs":1760000000000,"updatedAtMs":1760000000000$extra}"""

  private fun ret(status: String, extra: String = "") =
    screen(spec("commerce", "commerce.return"), mapOf("returnId" to "r1"),
      """{"ret":${returnDoc(status, extra)},"store":{"currency":"USD"},"locations":{"items":[{"${'$'}id":"L1","name":"Main"},{"${'$'}id":"L2","name":"Spare"}]}}""")

  @Test
  fun returnsListNewestFirstAndByStatus() {
    val all = spec("commerce", "commerce.returns")
    val load = all.loads.first()
    assertEquals("returns", load.key)
    val model = screen(all, emptyMap(), """{"returns":{"items":[${returnDoc("requested")}]}}""")
    assertEquals(listOf("filters", "returns"), model.shown())
    val row = model.row("data.returns.items")
    assertEquals("#1042 · Ada", ScreenValues.render(model.block("returns").string("primary")!!, row))
    assertEquals("Tee, Mug · Requested Oct 9, 2025", ScreenValues.render(model.block("returns").string("secondary")!!, row))
    assertEquals("Requested", ScreenValues.render("{const.statuses[id=item.status].label}", row))
    val links = model.block("filters").raw.jsonObject["items"]!!.jsonArray.map { it.jsonObject }
    assertEquals(listOf("requested", "approved", "declined", "received", "refunded", "closed"), links.take(6).map { (it["params"]!!.jsonObject["status"] as JsonPrimitive).content })
    val byStatus = spec("commerce", "commerce.returnsByStatus")
    val query = byStatus.loads.first().query!!.jsonObject
    assertEquals("""[["status","==","{params.status}"]]""", query["where"]!!.jsonArray.toString().replace(" ", ""))
    assertEquals("Approved returns", ScreenValues.render(byStatus.title, screen(byStatus, mapOf("status" to "approved"), """{"returns":{"items":[]}}""").context))
  }

  @Test
  fun aRequestedReturnIsApprovedOrDeclinedWithANote() {
    val model = ret("requested")
    assertEquals(listOf("approve", "decline"), model.actionsShown("decide"))
    assertEquals(listOf("close", "order"), model.actionsShown("progress"))
    assertEquals(
      json("""{"hostId":"h1","returnId":"r1","action":"approve","merchantNote":"Send it back","notify":true}"""),
      model.body(model.action("decide", "approve"), """{"merchantNote":"Send it back","notify":true}"""),
    )
    assertEquals("decline", ScreenValues.text(model.body(model.action("decide", "decline")).jsonObject["action"]))
    assertTrue("decide" !in ret("approved").shown())
    assertEquals("/api/commerce/returns", model.action("decide", "approve").url)
  }

  @Test
  fun anApprovedReturnIsReceivedWithAQuantityPerLineAndRefundedInDollars() {
    val model = ret("approved")
    assertEquals(listOf("receive", "refund", "close", "order"), model.actionsShown("progress"))
    val receive = model.action("progress", "receive")
    val fields = receive.inputs(model.context)
    assertEquals(listOf("restock_0", "restock_1", "locationId"), fields.map { it.key })
    assertEquals("Restock: Tee (of 2)", fields[0].label)
    assertEquals(ScreenValues.text(ScreenValues.resolve(fields[0].initial!!, ScreenContext.withItem(model.context, model.context.jsonObject["data"]!!.jsonObject["ret"]!!.jsonObject["lines"]!!.jsonArray[0]))), "2", "starts at everything that came back")
    assertTrue(fields[0].unmet(JsonPrimitive(3), model.context) && !fields[0].unmet(JsonPrimitive(2), model.context), "no more than came back")
    assertEquals(listOf("L1", "L2"), fields[2].choices(model.context).map { it.first })
    assertEquals(
      json("""{"hostId":"h1","returnId":"r1","action":"receive","restock":[{"lineItemId":0,"quantity":1},{"lineItemId":1,"quantity":0}],"locationId":"L2"}"""),
      model.body(receive, """{"restock_0":1,"restock_1":0,"locationId":"L2","note":"x"}"""),
    )
    val refund = model.action("progress", "refund")
    assertEquals(json("""{"hostId":"h1","returnId":"r1","action":"refund","amountCents":2550}"""), model.body(refund, """{"amount":"25.50"}"""))
    assertEquals(listOf("refund", "close", "order"), ret("received").actionsShown("progress"))
    assertEquals(listOf("close", "order"), ret("refunded", ""","refundedAtMs":1760000000000,"refundCents":2550""").actionsShown("progress"))
    assertEquals(listOf("order"), ret("closed").actionsShown("progress"))
  }

  @Test
  fun aReturnShowsItsLabelRestockRefundAndTimelineAndSavesTheNote() {
    val model = ret(
      "refunded",
      ""","returnLabel":{"carrier":"USPS","trackingNumber":"9400","labelUrl":"https://l/x.pdf","trackingUrl":"https://t/9400","attachedAtMs":1},
         "restock":{"lines":[{"lineItemId":1,"quantity":1}],"locationId":"L1","atMs":1760000000000},"refundedAtMs":1760000000000,"refundCents":4200,"merchantNote":"Boxed" """,
    )
    assertEquals(listOf("summary", "lines", "label", "labelLinks", "restocked", "refunded", "progress", "note", "timeline", "zone"), model.shown())
    assertEquals(listOf("printLabel", "track"), model.actionsShown("labelLinks"))
    assertEquals("https://l/x.pdf", ScreenValues.render(model.action("labelLinks", "printLabel").link!!, model.context))
    assertEquals("1× Mug", ScreenValues.render(model.block("restocked").string("primary")!!, model.row("data.ret.restock.lines")))
    assertEquals("$42.00", ScreenValues.render("{data.ret.refundCents:cents/data.store.currency}", model.context))
    assertEquals(json("""{"hostId":"h1","returnId":"r1","action":"note","merchantNote":"Boxed in tissue"}"""), model.body(model.form("note"), """{"merchantNote":"Boxed in tissue"}"""))
    assertEquals("Requested", ScreenValues.render("{data.ret.timeline.0.event:title}", model.context))
  }

  @Test
  fun startingAReturnPicksAQuantityAndAReasonPerOrderLine() {
    val model = screen(spec("commerce", "commerce.startReturn"), mapOf("orderId" to "o9"),
      """{"order":{"lineItems":[{"name":"Tee","variantLabel":"M","quantity":3},{"name":"Mug","quantity":1}]}}""")
    val fields = model.fieldsShown("start")
    assertEquals(listOf("qty_0", "reason_0", "qty_1", "reason_1", "note", "notify"), fields.map { it.key }, "each line's fields sit together")
    assertEquals("Tee M · ordered 3", fields[0].label)
    assertTrue(fields[0].unmet(JsonPrimitive(4), model.context) && !fields[0].unmet(JsonPrimitive(3), model.context))
    assertEquals(listOf("damaged", "wrong_item", "not_as_described", "size_or_fit", "no_longer_needed", "other"), fields[1].choices(model.context).map { it.first })
    assertEquals(
      json("""{"hostId":"h1","action":"create","orderId":"o9","lines":[{"lineItemId":0,"quantity":2,"reason":"size_or_fit"}],"note":"Gift","notify":true}"""),
      model.body(model.form("start"), """{"qty_0":2,"reason_0":"size_or_fit","qty_1":0,"reason_1":"other","note":"Gift","notify":true}"""),
    )
  }

  @Test
  fun theReturnSettingsReadTheStoresDefaultsAndWriteThemBackWithTheSiteRefreshed() {
    val fresh = screen(spec("commerce", "commerce.returnSettings"), emptyMap(), """{"store":{}}""")
    val fields = fresh.fieldsShown("settings")
    fun initial(key: String) = ScreenValues.truthy(ScreenValues.resolve(fields.first { it.key == key }.initial!!, fresh.context)).toString()
    assertEquals(listOf("true", "false", "false"), listOf(initial("enabled"), initial("digital"), initial("service")))
    assertEquals("true", initial("physical"), "physical is the default until the store says otherwise")
    val saved = screen(spec("commerce", "commerce.returnSettings"), emptyMap(), """{"store":{"returns":{"enabled":false,"windowDays":14,"eligibleTypes":["digital"]}}}""")
    val savedFields = saved.fieldsShown("settings")
    fun savedInitial(key: String) = ScreenValues.resolve(savedFields.first { it.key == key }.initial!!, saved.context)
    assertFalse(ScreenValues.truthy(savedInitial("enabled")))
    assertEquals("14", ScreenValues.text(savedInitial("windowDays")))
    assertEquals(listOf(false, true, false), listOf("physical", "digital", "service").map { ScreenValues.truthy(savedInitial(it)) })
    val submit = saved.form("settings")
    assertEquals("hosts/h1/settings/store", ScreenValues.render(submit.write!!.jsonObject["doc"]!!.let { (it as JsonPrimitive).content }, saved.context))
    assertTrue((submit.write!!.jsonObject["siteWide"] as JsonPrimitive).content == "true")
    assertEquals(
      json("""{"returns":{"enabled":true,"windowDays":30,"eligibleTypes":["digital","physical"]}}"""),
      ScreenValues.resolveBody(submit.write!!.jsonObject["fields"]!!, ScreenContext.with(saved.context, "form", json("""{"enabled":true,"windowDays":30,"physical":true,"digital":true,"service":false}"""))),
    )
    val days = fields.first { it.key == "windowDays" }
    assertTrue(days.unmet(JsonPrimitive(366), fresh.context) && days.unmet(JsonPrimitive(-1), fresh.context) && !days.unmet(JsonPrimitive(0), fresh.context))
  }

  // ---- stock movements ---------------------------------------------------------------------------------------------

  private fun movement(delta: Int, reason: String, extra: String = "") =
    """{"$id":"m1","productId":"p1","variantId":"default","delta":$delta,"reason":"$reason","atMs":1760000000000$extra}"""

  private fun ledger(vararg rows: String) =
    screen(spec("commerce", "commerce.stockMovements"), emptyMap(), """{"movements":{"items":[${rows.joinToString(",")}]},"products":{"items":[{"$id":"p1","name":"Desk lamp"}]}}""")

  @Test
  fun theStockLedgerNamesProductsSignsChangesAndSaysWhenACountCouldNotMoveAsFarAsAsked() {
    val model = ledger(movement(-3, "sale", ""","appliedDelta":0,"orderId":"o7","locationId":"L1","source":"Ada""""), movement(5, "restock"))
    assertEquals(listOf("filters", "byOrder", "movements"), model.shown())
    val block = model.block("movements")
    val sale = model.row("data.movements.items", 0)
    assertEquals("Desk lamp default", ScreenValues.render(block.string("primary")!!, sale))
    assertEquals("Sale · Oct 9, 2025, 8:53 AM", ScreenValues.render(block.string("secondary")!!, sale))
    fun badges(row: kotlinx.serialization.json.JsonElement) = block.raw.jsonObject["badges"]!!.jsonArray.filter { ScreenValues.condition((it.jsonObject["when"] as JsonPrimitive).content, row) }.map { ScreenValues.render((it.jsonObject["text"] as JsonPrimitive).content, row) }
    assertEquals(listOf("Removed", "Only 0 applied", "Order o7", "At L1", "Counted by Ada"), badges(sale))
    assertEquals(listOf("Added"), badges(model.row("data.movements.items", 1)))
    val links = model.block("filters").raw.jsonObject["items"]!!.jsonArray.map { it.jsonObject }
    assertEquals(listOf("sale", "refund", "restock", "correction", "damage", "cancellation", "sync"), links.take(7).map { (it["params"]!!.jsonObject["reason"] as JsonPrimitive).content })
    assertEquals("Order canceled", ScreenValues.render("{const.reasons[id=item.reason].label}", ScreenContext.with(model.context, "item", json("""{"reason":"cancellation"}"""))))
  }

  @Test
  fun eachNarrowingScreenQueriesTheLedgerByOneEqualityNewestFirst() {
    fun where(id: String) = spec("commerce", id).loads.first { it.key == "movements" }.query!!.jsonObject
    assertEquals("""[["reason","==","{params.reason}"]]""", where("commerce.stockMovementsReason")["where"]!!.toString().replace(" ", ""))
    assertEquals("""[["productId","==","{params.productId}"]]""", where("commerce.stockMovementsProduct")["where"]!!.toString().replace(" ", ""))
    assertEquals("""[["orderId","==","{params.orderId}"]]""", where("commerce.stockMovementsOrder")["where"]!!.toString().replace(" ", ""))
    assertEquals("""[["locationId","==","{params.locationId}"]]""", where("commerce.stockMovementsLocation")["where"]!!.toString().replace(" ", ""))
    assertEquals("atMs desc", ScreenValues.text(where("commerce.stockMovements")["orderBy"]))
    val order = ledger().action("byOrder", "order")
    assertEquals("commerce.stockMovementsOrder", order.navigate!!.screen)
    assertEquals(mapOf("orderId" to "{form.orderId}"), order.navigate!!.params)
    val products = screen(spec("commerce", "commerce.stockMovementsProducts"), emptyMap(), """{"products":{"items":[{"$id":"p1","name":"Desk lamp"}]}}""")
    assertEquals("p1", ScreenValues.render(products.block("products").raw.jsonObject["open"]!!.jsonObject["params"]!!.jsonObject["productId"]!!.let { (it as JsonPrimitive).content }, products.row("data.products.items")))
  }

  // ---- catalog organization ----------------------------------------------------------------------------------------

  private val categories = """{"categories":{"items":[
    {"$id":"c1","name":"Brakes","slug":"brakes"},{"$id":"c2","name":"Pads","slug":"pads","parentId":"c1"},{"$id":"c3","name":"Rotors","slug":"rotors","parentId":"c1"}]}}"""

  @Test
  fun categoriesAreWrittenToTheStoresDocumentsAsTheConsoleWritesThem() {
    val writer = RecordingWriter()
    val model = withWriter(spec("commerce", "commerce.categories"), emptyMap(), categories, writer)
    val list = model.block("categories")
    assertEquals(listOf("In Brakes"), list.raw.jsonObject["badges"]!!.jsonArray.map { it.jsonObject }.let { badges ->
      val row = model.row("data.categories.items", 1)
      badges.filter { ScreenValues.condition((it["when"] as JsonPrimitive).content, row) }.map { ScreenValues.render((it["text"] as JsonPrimitive).content, row) }
    })
    val edit = model.rowActions("categories").first { it.id == "edit" }
    val pads = model.row("data.categories.items", 1)
    assertEquals(listOf("c1", "c3"), edit.prompt.last().choices(pads).map { it.first }.filter { it.isNotEmpty() }.filter { it != "c2" }, "a category cannot sit inside itself")
    kotlinx.coroutines.runBlocking { model.run(edit, ScreenContext.with(pads, "form", json("""{"name":"Brake pads","parentId":""}"""))) }
    assertEquals(listOf("merge hosts/h1/productCategories/c2 {name=Brake pads,parentId=null,slug=brake-pads,updatedAt=now}"), writer.calls.map { it.replace(", ", ",") })
    writer.calls.clear()
    val delete = model.rowActions("categories").first { it.id == "delete" }
    kotlinx.coroutines.runBlocking { model.run(delete, model.row("data.categories.items", 0)) }
    assertEquals(
      listOf("merge hosts/h1/productCategories/c2 {parentId=null}", "merge hosts/h1/productCategories/c3 {parentId=null}", "delete hosts/h1/productCategories/c1"),
      writer.calls,
      "its children move to the top level, then it goes",
    )
    writer.calls.clear()
    val add = model.action("add", "addCategory")
    kotlinx.coroutines.runBlocking { model.run(add, ScreenContext.with(model.context, "form", json("""{"name":"Café Latte","parentId":"c1"}"""))) }
    assertEquals("add hosts/h1/productCategories {createdAt=now,name=Café Latte,order=0,parentId=c1,slug=cafe-latte,updatedAt=now}", writer.calls.single().replace(", ", ","))
  }

  private fun collection(doc: String) =
    screen(spec("commerce", "commerce.collection"), mapOf("collectionId" to "k1"), """{"col":$doc}""")

  private val smart = """{"name":"Sale","slug":"sale","mode":"smart","matchAll":false,"rules":[{"field":"tag","op":"eq","value":"sale"},{"field":"priceUsd","op":"lt","value":"20"}]}"""
  private val manual = """{"name":"Summer","slug":"summer","mode":"manual","productIds":["p1","p2"],"description":"Hot"}"""

  @Test
  fun collectionsListOnlyTheCatalogOnesAndSaveThroughTheConsolesRoute() {
    val list = screen(spec("commerce", "commerce.collections"), emptyMap(), """{"collections":{"items":[{"$id":"k1","name":"Sale","slug":"sale","mode":"smart","rules":[{}]},{"$id":"k2","displayName":"Blog posts"}]}}""")
    val filter = list.block("collections").string("filter")!!
    assertTrue(ScreenValues.condition(filter, list.row("data.collections.items", 0)) && !ScreenValues.condition(filter, list.row("data.collections.items", 1)), "content collections are not catalog ones")
    val create = list.action("add", "addCollection")
    assertEquals(
      json("""{"hostId":"h1","action":"create","kind":"catalog","data":{"name":"Summer sale","slug":"summer-sale","mode":"manual"}}"""),
      list.body(create, """{"name":"Summer sale","mode":"manual"}"""),
    )
    assertEquals("commerce.collection", create.navigate!!.screen)
    assertEquals("/api/commerce/collection-membership", create.then!!.url)
    val model = collection(manual)
    assertEquals(listOf("summary", "parts", "edit", "manage"), model.shown())
    assertEquals(
      json("""{"hostId":"h1","action":"update","kind":"catalog","id":"k1","data":{"name":"Summer 26","slug":"summer","mode":"manual","description":"Hot","productIds":["p1","p2"]}}"""),
      model.body(model.form("edit"), """{"name":"Summer 26","mode":"manual"}"""),
    )
    assertEquals(json("""{"scope":"hosts","scopeId":"h1","kind":"collections","id":"k1","collectionKind":"catalog"}"""), model.body(model.action("manage", "delete")))
    assertTrue(model.action("manage", "delete").back)
  }

  @Test
  fun aManualCollectionHoldsTheProductsSwitchedOnAndASmartOneItsRules() {
    val products = screen(spec("commerce", "commerce.collectionProducts"), mapOf("collectionId" to "k1"),
      """{"col":$manual,"products":{"items":[{"$id":"p1","name":"Mug","status":"active"},{"$id":"p3","name":"Tee","status":"active"},{"$id":"p9","name":"Gone","deletedAt":1}]}}""")
    val toggle = products.block("products").raw.jsonObject["toggle"]!!.jsonObject
    fun item(index: Int) = products.row("data.products.items", index)
    assertEquals("p1", ScreenValues.render((toggle["value"] as JsonPrimitive).content, item(0)))
    assertEquals("", ScreenValues.render((toggle["value"] as JsonPrimitive).content, item(1)))
    assertEquals(listOf("p1", "p2", "p3"), ScreenValues.resolveBody(ActionSpec.parse(toggle["on"])!!.body!!, item(1)).jsonObject["data"]!!.jsonObject["productIds"]!!.jsonArray.map { (it as JsonPrimitive).content })
    assertEquals(listOf("p2"), ScreenValues.resolveBody(ActionSpec.parse(toggle["off"])!!.body!!, item(0)).jsonObject["data"]!!.jsonObject["productIds"]!!.jsonArray.map { (it as JsonPrimitive).content })
    assertFalse(ScreenValues.condition(products.block("products").string("filter"), item(2)), "a deleted product is not offered")

    val rules = screen(spec("commerce", "commerce.collectionRules"), mapOf("collectionId" to "k1"), """{"col":$smart,"categories":{"items":[{"$id":"c1","name":"Brakes"}]}}""")
    assertEquals(listOf("match", "rules", "add"), rules.shown())
    assertEquals("Price below 20", ScreenValues.render(rules.block("rules").string("primary")!!, rules.row("data.col.rules", 1)))
    assertFalse(ScreenValues.truthy(ScreenValues.resolve(rules.fieldsShown("match").first().initial!!, rules.context)), "this collection matches any rule")
    fun rulesOf(body: kotlinx.serialization.json.JsonElement) = body.jsonObject["data"]!!.jsonObject["rules"]!!.jsonArray.map { it.jsonObject }
    val edit = rules.rowActions("rules").first { it.id == "edit" }
    val edited = ScreenValues.resolveBody(edit.body!!, ScreenContext.with(rules.row("data.col.rules", 1), "form", json("""{"field":"priceUsd","op":"lt","valueText":"15"}""")))
    assertEquals(listOf("sale", "15"), rulesOf(edited).map { ScreenValues.text(it["value"]) })
    val remove = rules.rowActions("rules").first { it.id == "remove" }
    assertEquals(1, rulesOf(ScreenValues.resolveBody(remove.body!!, rules.row("data.col.rules", 0))).size)
    val added = ScreenValues.resolveBody(rules.action("add", "addRule").body!!, ScreenContext.with(rules.context, "form", json("""{"field":"categoryId","op":"eq","valueCategory":"c1"}""")))
    assertEquals("c1", ScreenValues.text(rulesOf(added).last()["value"]))
    val pick = rules.action("add", "addRule").prompt
    assertEquals(listOf("field", "op", "valueText"), pick.filter { ScreenValues.condition(it.whenCondition, ScreenContext.with(rules.context, "form", json("""{"field":"tag"}"""))) }.map { it.key })
    assertEquals(listOf("field", "op", "valueCategory"), pick.filter { ScreenValues.condition(it.whenCondition, ScreenContext.with(rules.context, "form", json("""{"field":"categoryId"}"""))) }.map { it.key })
  }
}
