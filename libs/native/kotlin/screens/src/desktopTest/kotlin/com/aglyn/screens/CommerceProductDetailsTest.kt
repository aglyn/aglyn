package com.aglyn.screens

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** A product's details beyond the editor: sent to the product route as the stored product with the edits on top. */
class CommerceProductDetailsTest : SpecTestBase() {
  private val product = """{"name":"Mug","slug":"mug","supplierId":"s1","tags":["gift","kitchen"],"categoryIds":["c2"],"oversellPolicy":"backorder",
    "taxExempt":true,"lowStockThreshold":4,"seo":{"title":"A mug","description":"Holds coffee","imageUrl":"https://x/og.png"},
    "subscription":{"interval":"month","trialDays":7},"subscriptionOptional":true,"variants":[{"id":"default","priceUsd":12}],"createdAtMs":1}"""
  private val loads = """"suppliers":{"items":[{"${'$'}id":"s1","name":"Acme Supply"},{"${'$'}id":"s2","name":"Other"}]},
    "categories":{"items":[{"${'$'}id":"c1","name":"Kitchen"},{"${'$'}id":"c2","name":"Gifts"}]},
    "gifts":{"carried":%GIFTS%,"label":"Business"},"subs":{"carried":%SUBS%,"label":"Pro"}"""

  private fun details(gifts: Boolean = true, subs: Boolean = true, product: String = this.product) = screen(
    spec("commerce", "commerce.productDetails"), mapOf("productId" to "p1"),
    """{"product":$product,${loads.replace("%GIFTS%", gifts.toString()).replace("%SUBS%", subs.toString())}}""",
  )

  @Test
  fun theFormStartsFromTheStoredProduct() {
    val model = details()
    val fields = model.fieldsShown("details")
    assertEquals(
      listOf("slug", "supplierId", "tags", "cat_c1", "cat_c2", "oversellPolicy", "giftCard", "taxExempt", "lowStock", "seoTitle", "seoDescription"),
      fields.map { it.key },
    )
    val started = fields.associate { it.key to ScreenValues.render(it.initial!!, model.context) }
    assertEquals("mug", started["slug"])
    assertEquals("s1", started["supplierId"])
    assertEquals("gift, kitchen", started["tags"], "tags read as a comma list")
    assertEquals("false", started["cat_c1"])
    assertEquals("true", started["cat_c2"])
    assertEquals("backorder", started["oversellPolicy"])
    assertEquals("false", started["giftCard"])
    assertEquals("true", started["taxExempt"])
    assertEquals("4", started["lowStock"])
    assertEquals("A mug", started["seoTitle"])
    assertEquals(listOf("" to "None", "s1" to "Acme Supply", "s2" to "Other"), fields.first { it.key == "supplierId" }.choices(model.context))
    assertEquals(listOf("Category: Kitchen", "Category: Gifts"), fields.filter { it.key.startsWith("cat_") }.map { it.label })
  }

  @Test
  fun aPlanWithoutGiftCardsNeitherOffersNorHidesWhatTheProductAlreadyIs() {
    assertTrue("giftCard" !in details(gifts = false).fieldsShown("details").map { it.key })
    val already = details(gifts = false, product = """{"name":"Card","giftCard":true,"variants":[{"id":"default","priceUsd":25}]}""")
    assertTrue("giftCard" in already.fieldsShown("details").map { it.key }, "a product that is a gift card keeps its switch, as the console keeps its option")
    assertTrue("supplierId" !in screen(spec("commerce", "commerce.productDetails"), mapOf("productId" to "p1"), """{"product":$product,"suppliers":{"items":[]},"categories":{"items":[]},"gifts":{"carried":true},"subs":{"carried":true}}""").fieldsShown("details").map { it.key })
  }

  @Test
  fun savingSendsTheStoredProductWithTheEditsOnTop() {
    val model = details()
    val submit = model.form("details")
    assertEquals("/api/commerce/products/save", submit.url)
    assertEquals("hosts/{site.id}/products/{params.productId}", submit.overlay)
    val stored = """{"name":"Mug","slug":"mug","supplierId":"s1","tags":["gift"],"seo":{"title":"A mug","imageUrl":"https://x/og.png"},"variants":[{"id":"default","priceUsd":12}],"lowStockThreshold":4,"taxExempt":true}"""
    val scope = ScreenContext.with(
      ScreenContext.with(model.context, "overlay", json(stored)), "form",
      json("""{"slug":"Coffee Mug","supplierId":"","tags":"gift, Kitchen ,","cat_c1":true,"cat_c2":false,"oversellPolicy":"deny","giftCard":false,"taxExempt":false,"lowStock":"","seoTitle":"Best mug","seoDescription":"Holds coffee"}"""),
    )
    val sent = ScreenValues.resolveBody(submit.body!!, scope).let { it as kotlinx.serialization.json.JsonObject }
    assertEquals("h1", ScreenValues.text(sent["hostId"]))
    assertEquals("p1", ScreenValues.text(sent["productId"]))
    assertEquals(
      json(
        """{"name":"Mug","slug":"coffee-mug","tags":["gift","Kitchen"],"categoryIds":["c1"],"oversellPolicy":"deny","giftCard":false,"taxExempt":false,
            "seo":{"title":"Best mug","imageUrl":"https://x/og.png","description":"Holds coffee"},"variants":[{"id":"default","priceUsd":12}]}""",
      ),
      sent["product"],
      "the supplier and the low-stock alert are taken off, the search image and the variants stay",
    )
  }

  @Test
  fun billingIsChangedWithTheIntervalAndTrialTheConsoleHas() {
    val model = details()
    assertEquals(listOf("once", "month", "year", "both"), model.actionsShown("billingChange"))
    assertEquals(listOf("trialDays"), model.action("billingChange", "year").prompt.map { it.key })
    assertEquals(listOf("interval", "trialDays"), model.action("billingChange", "both").prompt.map { it.key })
    fun product(action: String, form: String): kotlinx.serialization.json.JsonElement {
      val scope = ScreenContext.with(ScreenContext.with(model.context, "overlay", json("""{"name":"Mug","variants":[],"subscription":{"interval":"year"},"subscriptionOptional":true}""")), "form", json(form))
      return (ScreenValues.resolveBody(model.action("billingChange", action).body!!, scope) as kotlinx.serialization.json.JsonObject)["product"]!!
    }
    assertEquals(json("""{"name":"Mug","variants":[]}"""), product("once", "{}"))
    assertEquals(json("""{"name":"Mug","variants":[],"subscription":{"interval":"month","trialDays":14}}"""), product("month", """{"trialDays":14}"""))
    assertEquals(json("""{"name":"Mug","variants":[],"subscription":{"interval":"year"}}"""), product("year", """{}"""), "no trial, no trial field")
    assertEquals(json("""{"name":"Mug","variants":[],"subscription":{"interval":"month"},"subscriptionOptional":true}"""), product("both", """{"interval":"month"}"""))
    val locked = details(subs = false, product = """{"name":"Mug","variants":[{"id":"default","priceUsd":12}]}""")
    assertEquals(emptyList(), locked.actionsShown("billingChange"), "a one-time product on a plan without subscriptions has nothing to change")
    assertTrue("subsLocked" in locked.shown())
    assertEquals(listOf("once"), details(subs = false).actionsShown("billingChange"), "a subscription already there can be ended but not newly set")
  }

  @Test
  fun aMissingProductSaysSo() {
    val model = screen(spec("commerce", "commerce.productDetails"), mapOf("productId" to "gone"), """{"product":null}""")
    assertEquals(listOf("missing"), model.shown())
  }

  // ---- related products ------------------------------------------------------------------------------------------

  private val catalog = """{"items":[{"${'$'}id":"p1","name":"Mug","status":"active"},{"${'$'}id":"p2","name":"Plate","status":"active"},
    {"${'$'}id":"p3","name":"Bowl","status":"draft"},{"${'$'}id":"p4","name":"Gone","status":"active","deletedAt":1}]}"""

  private fun related(stored: String = """{"name":"Mug","relatedProductIds":["p3"],"variants":[{"id":"default","priceUsd":12}]}""") =
    screen(spec("commerce", "commerce.productRelated"), mapOf("productId" to "p1"), """{"product":$stored,"products":$catalog}""")

  @Test
  fun detailsLinkToTheRelatedProductsOfThatProduct() {
    val link = details().block("related").raw.let { (it as kotlinx.serialization.json.JsonObject)["items"] as kotlinx.serialization.json.JsonArray }.single()
    assertEquals("commerce.productRelated", ScreenValues.text((link as kotlinx.serialization.json.JsonObject)["screen"]))
    assertTrue("related" !in screen(spec("commerce", "commerce.productDetails"), mapOf("productId" to "p1"), """{"product":null}""").shown())
  }

  @Test
  fun anyOtherLiveProductCanBeRelatedAndTheStoredOnesAreOn() {
    val model = related()
    val list = model.block("products")
    val rows = ScreenValues.rows(ScreenValues.lookup("data.products.items", model.context))
      .filter { ScreenValues.condition(list.string("filter"), ScreenContext.withItem(model.context, it)) }
    assertEquals(listOf("Plate", "Bowl"), rows.map { ScreenValues.text(ScreenValues.lookup("name", it)) }, "not itself, not a deleted one")
    val toggle = (list.raw as kotlinx.serialization.json.JsonObject)["toggle"] as kotlinx.serialization.json.JsonObject
    val valueTemplate = (toggle["value"] as kotlinx.serialization.json.JsonPrimitive).content
    val on = rows.map { ScreenValues.truthy(ScreenValues.resolve(valueTemplate, ScreenContext.withItem(model.context, it))) }
    assertEquals(listOf(false, true), on)
    assertEquals(listOf("hint", "products"), model.shown())
    assertEquals(listOf("missing"), screen(spec("commerce", "commerce.productRelated"), mapOf("productId" to "p1"), """{"product":null,"products":$catalog}""").shown())
  }

  @Test
  fun turningOneOnOrOffSavesTheStoredProductWithOnlyTheRelatedListChanged() {
    val model = related()
    val toggle = (model.block("products").raw as kotlinx.serialization.json.JsonObject)["toggle"] as kotlinx.serialization.json.JsonObject
    val on = ActionSpec.parse(toggle["on"])!!
    val off = ActionSpec.parse(toggle["off"])!!
    assertEquals("/api/commerce/products/save", on.url)
    assertEquals("hosts/{site.id}/products/{params.productId}", on.overlay)
    val stored = """{"name":"Mug","relatedProductIds":["p3"],"variants":[{"id":"default","priceUsd":12}]}"""
    fun sent(action: ActionSpec, row: String) =
      ScreenValues.resolveBody(action.body!!, ScreenContext.with(ScreenContext.with(model.context, "overlay", json(stored)), "item", json(row)))
        .let { (it as kotlinx.serialization.json.JsonObject)["product"] }
    assertEquals(json("""{"name":"Mug","relatedProductIds":["p3","p2"],"variants":[{"id":"default","priceUsd":12}]}"""), sent(on, """{"${'$'}id":"p2"}"""))
    assertEquals(json("""{"name":"Mug","relatedProductIds":[],"variants":[{"id":"default","priceUsd":12}]}"""), sent(off, """{"${'$'}id":"p3"}"""))
  }
}
