package com.aglyn.screens

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Rewards natively: the program, the store's own Smile.io or Yotpo Loyalty account, members and their history, a balance
 * adjusted by hand, and what one order earned. Each reads the answers the console's loyalty routes give, and sends the
 * bodies the console's cards send.
 */
class LoyaltySpecsTest : SpecTestBase() {
  private val program = """{"enabled":true,"earnPointsPerDollar":5,"pointsPerDollar":100,"minRedeemPoints":100,"welcomePoints":25,"referralsEnabled":true,
    "referrerRewardCents":1000,"refereeRewardCents":1500,"refereeMinimumCents":2500,"emails":true,"connected":%CONNECTED%}"""
  private val totals = """{"members":1250,"outstandingPoints":84000,"outstandingPointsCents":84000,"outstandingCreditCents":4550}"""

  private fun rewards(connected: String = "null", totals: String = this.totals, programJson: String = program, configured: Boolean = true) =
    screen(
      spec("loyalty", "loyalty.rewards"), emptyMap(),
      """{"program":{"program":${programJson.replace("%CONNECTED%", connected)},"totals":$totals},"conn":{"configured":$configured,"connection":null,"attention":[]}}""",
    )

  /** A fields block as the person reads it: the rows that show, label and value. */
  private fun ScreenModel.rows(block: String): List<Pair<String, String>> =
    block(block).raw.jsonObject["rows"]!!.jsonArray.map { it.jsonObject }
      .filter { ScreenValues.condition((it["when"] as? JsonPrimitive)?.content, context) }
      .map { ScreenValues.render((it["label"] as JsonPrimitive).content, context) to ScreenValues.render((it["value"] as JsonPrimitive).content, context) }

  @Test
  fun theProgramShowsWhatMembersHoldAndStartsTheFormFromTheProgram() {
    val model = rewards()
    assertEquals(
      listOf("Rewards" to "On", "Members" to "1,250", "Points held" to "84,000", "Worth" to "$840.00", "Store credit held" to "$45.50"),
      model.rows("totals"),
    )
    val fields = model.fieldsShown("program", """{"referralsEnabled":true}""")
    assertEquals(
      listOf("enabled", "earnPointsPerDollar", "pointsPerDollar", "minRedeemPoints", "welcomePoints", "referralsEnabled", "refereeRewardCents", "refereeMinimumCents", "referrerRewardCents", "emails"),
      fields.map { it.key },
    )
    val started = fields.associate { it.key to ScreenValues.render(it.initial!!, model.context) }
    assertEquals(
      mapOf("enabled" to "true", "earnPointsPerDollar" to "5", "pointsPerDollar" to "100", "minRedeemPoints" to "100", "welcomePoints" to "25", "referralsEnabled" to "true",
        "refereeRewardCents" to "15.00", "refereeMinimumCents" to "25.00", "referrerRewardCents" to "10.00", "emails" to "true"),
      started,
    )
    assertEquals(listOf("Rewards program saved"), listOf(model.form("program").success))
    assertEquals(null, model.shownNotice("unavailable"))
    // The sentence the console's card opens with, over the rates it holds.
    assertEquals(
      "Customers earn points on every order, online and at the register, and spend them like store credit. Today a member gets back 5% of what they spend.",
      ScreenValues.render(model.block("rate").string("text")!!, model.context),
    )
    val tenth = rewards(programJson = program.replace("\"earnPointsPerDollar\":5", "\"earnPointsPerDollar\":3").replace("\"pointsPerDollar\":100", "\"pointsPerDollar\":120"))
    assertTrue(ScreenValues.render(tenth.block("rate").string("text")!!, tenth.context).endsWith("gets back 2.5% of what they spend."))
  }

  @Test
  fun theMembersAreAlwaysOneStepOnAndTheAccountOnlyWhereTheDeploymentCanConnectOne() {
    val links = { model: ScreenModel ->
      model.block("more").raw.jsonObject["items"]!!.jsonArray.map { it.jsonObject }
        .filter { ScreenValues.condition((it["when"] as? JsonPrimitive)?.content, model.context) }.map { (it["screen"] as JsonPrimitive).content }
    }
    assertEquals(listOf("loyalty.connection", "loyalty.members"), links(rewards()))
    assertEquals(listOf("loyalty.members"), links(rewards(configured = false)), "the console draws no account card where it cannot connect one")
  }

  private fun ScreenModel.shownNotice(id: String) = if (id in shown()) id else null

  @Test
  fun theProgramFormKeepsTheBoundsTheConsoleHoldsEveryNumberTo() {
    val fields = rewards().fieldsShown("program", """{"referralsEnabled":true}""").associateBy { it.key }
    fun bounds(key: String) = fields.getValue(key).let { it.min to it.max }
    assertEquals(1.0 to 100.0, bounds("earnPointsPerDollar"))
    assertEquals(10.0 to 10000.0, bounds("pointsPerDollar"))
    assertEquals(0.0 to 100000.0, bounds("minRedeemPoints"))
    assertEquals(0.0 to 100000.0, bounds("welcomePoints"))
    assertEquals(0.0 to 1000.0, bounds("refereeRewardCents"), "a reward in dollars, up to what $100,000 of cents is")
    assertEquals(0.0 to 100000.0, bounds("refereeMinimumCents"))
    assertEquals(0.0 to 1000.0, bounds("referrerRewardCents"))
    for (key in listOf("earnPointsPerDollar", "pointsPerDollar", "minRedeemPoints", "welcomePoints")) assertTrue(fields.getValue(key).integer, "$key takes whole points")
    assertTrue(fields.getValue("earnPointsPerDollar").unmet(JsonPrimitive(101), rewards().context))
    assertTrue(!fields.getValue("earnPointsPerDollar").unmet(JsonPrimitive(100), rewards().context))
  }

  @Test
  fun savingSendsOnlyWhatTheConsoleSendsWithMoneyInWholeCents() {
    val model = rewards()
    val body = model.body(
      model.form("program"),
      """{"enabled":true,"earnPointsPerDollar":8,"pointsPerDollar":200,"minRedeemPoints":0,"welcomePoints":10,"referralsEnabled":true,
          "refereeRewardCents":"12.50","refereeMinimumCents":"0","referrerRewardCents":"7","emails":false}""",
    )
    assertEquals(
      json(
        """{"hostId":"h1","program":{"enabled":true,"earnPointsPerDollar":8,"pointsPerDollar":200,"minRedeemPoints":0,"welcomePoints":10,"referralsEnabled":true,
            "refereeRewardCents":1250,"refereeMinimumCents":0,"referrerRewardCents":700,"emails":false}}""",
      ),
      body,
    )
    assertEquals("/api/loyalty/program", model.form("program").url)
    // A field the screen hid is not sent: the route changes only what a change names.
    val hidden = model.body(model.form("program"), """{"enabled":false,"earnPointsPerDollar":5,"pointsPerDollar":100,"minRedeemPoints":100,"emails":true}""")
    val sent = hidden.jsonObject["program"]!!.jsonObject
    assertTrue("refereeRewardCents" !in sent || sent["refereeRewardCents"] == kotlinx.serialization.json.JsonNull)
  }

  @Test
  fun aConnectedProgramHidesWelcomePointsAndReferralsAsTheConsoleDoes() {
    val model = rewards("\"smile\"")
    assertEquals(
      listOf("enabled", "earnPointsPerDollar", "pointsPerDollar", "minRedeemPoints", "emails"),
      model.fieldsShown("program", """{"referralsEnabled":true}""").map { it.key },
    )
    assertTrue("connected" in model.shown() && "rate" !in model.shown())
    assertEquals(
      "The points are kept in your Smile.io account; these rates decide what each order earns and what points are worth here.",
      ScreenValues.render(model.block("connected").string("text")!!, model.context),
    )
    assertEquals("Points (last read from Smile.io)", model.rows("totals")[2].first)
    // Referral amounts show only while referrals are on.
    assertEquals(
      listOf("enabled", "earnPointsPerDollar", "pointsPerDollar", "minRedeemPoints", "welcomePoints", "referralsEnabled", "emails"),
      rewards().fieldsShown("program", """{"referralsEnabled":false}""").map { it.key },
    )
  }

  @Test
  fun aProgramThatCannotBeReadSaysSoAndNumbersTheRouteCouldNotAddAreNotZeros() {
    val model = screen(spec("loyalty", "loyalty.rewards"), emptyMap(), """{}""")
    assertTrue("unavailable" in model.shown())
    assertEquals("Rewards are not available for this site", ScreenValues.render(model.block("unavailable").string("text")!!, model.context), "the route's own sentence")
    assertTrue("program" !in model.shown())
    val blind = rewards(totals = """{"members":null,"outstandingPoints":null,"outstandingPointsCents":null,"outstandingCreditCents":null}""")
    assertEquals(
      listOf("Rewards" to "On", "Members" to "Unavailable", "Points held" to "Unavailable", "Worth" to "Unavailable", "Store credit held" to "Unavailable"),
      blind.rows("totals"),
    )
    val empty = rewards(totals = """{"members":0,"outstandingPoints":0,"outstandingPointsCents":0,"outstandingCreditCents":0}""")
    assertEquals("0", empty.rows("totals")[1].second, "no members is a real zero")
  }

  // ------------------------------------------------------------------ the store's own account

  private fun connection(data: String) = screen(spec("loyalty", "loyalty.connection"), emptyMap(), """{"conn":$data}""")

  @Test
  fun aDeploymentThatCannotKeepAKeyOffersNothingToConnect() {
    val model = connection("""{"configured":false,"connection":null,"attention":[],"builtInPoints":null}""")
    assertEquals(listOf("notConfigured"), model.shown())
    assertEquals(
      "Connecting a rewards account is not available on this deployment.",
      ScreenValues.render(model.block("notConfigured").string("text")!!, model.context),
    )
  }

  @Test
  fun connectingAsksForTheKeysEachServiceNamesAndSendsThemTheWayTheConsoleDoes() {
    val none = connection("""{"configured":true,"connection":null,"attention":[],"builtInPoints":0}""")
    assertEquals(listOf("intro", "smileNote", "connect"), none.shown())
    assertEquals(listOf("connectSmile", "connectYotpo"), none.actionsShown("connect"))
    val smile = none.action("connect", "connectSmile")
    assertEquals(listOf("apiKey"), smile.prompt.filter { ScreenValues.condition(it.whenCondition, none.context) }.map { it.key }, "no built-in points to set aside, nothing to ask")
    assertEquals(listOf("password"), smile.prompt.filter { it.key == "apiKey" }.map { it.kind })
    assertEquals(
      json("""{"hostId":"h1","action":"connect","provider":"smile","credentials":{"apiKey":"sk_live_abc"}}"""),
      none.body(smile, """{"apiKey":"sk_live_abc"}"""),
    )
    val yotpo = none.action("connect", "connectYotpo")
    assertEquals(listOf("guid", "apiKey"), yotpo.prompt.filter { ScreenValues.condition(it.whenCondition, none.context) }.map { it.key })
    assertEquals(listOf("text", "password"), yotpo.prompt.filter { it.key != "replace" }.map { it.kind })
    assertEquals(
      json("""{"hostId":"h1","action":"connect","provider":"yotpo","credentials":{"apiKey":"k","guid":"g-1"}}"""),
      none.body(yotpo, """{"guid":"g-1","apiKey":"k"}"""),
    )
    val holding = connection("""{"configured":true,"connection":null,"attention":[],"builtInPoints":4200}""")
    val ask = holding.action("connect", "connectSmile").prompt.first { it.key == "replace" }
    assertTrue(ScreenValues.condition(ask.whenCondition, holding.context))
    assertEquals(
      "Use Smile.io balances while connected. The 4,200 built-in points members hold are set aside and come back exactly if you disconnect.",
      ScreenValues.render(ask.label, holding.context),
    )
    assertEquals(
      json("""{"hostId":"h1","action":"connect","provider":"smile","credentials":{"apiKey":"k"},"replaceBalances":true}"""),
      holding.body(holding.action("connect", "connectSmile"), """{"apiKey":"k","replace":true}"""),
    )
  }

  private val connected = """{"configured":true,"connection":{"provider":"smile","label":"Smile.io","accountLabel":"Acme Rewards","keyLast4":"9f2c","connectedAtMs":1791590400000,
    "lastError":%ERROR%,"lastSyncedAtMs":1791600000000},"attention":%ATTENTION%,"builtInPoints":null}"""

  private fun connected(error: String = "null", attention: String = "[]") = connection(connected.replace("%ERROR%", error).replace("%ATTENTION%", attention))

  @Test
  fun aConnectedAccountShowsItsStateAndWhatIsWaitingToReachIt() {
    val all = connected()
    assertEquals(
      listOf("Status" to "Connected", "Account" to "Acme Rewards", "API key" to "ending 9f2c", "Last sent" to "Oct 10, 2026, 2:40 AM"),
      all.rows("status"),
    )
    assertTrue("allSent" in all.shown() && "attention" !in all.shown() && "lastError" !in all.shown())
    assertEquals(listOf("disconnect"), all.actionsShown("manage"))
    val waiting = connected(
      error = "\"Smile.io did not accept that key.\"",
      attention = """[{"id":"h1__earn__ord1","status":"retry","points":120,"email":"ada@example.com","error":"Timed out","orderId":"ord1","attempts":3},
                      {"id":"h1__adjust__x","status":"unmatched","points":-50,"email":"bo@example.com","error":null,"orderId":null,"attempts":1}]""",
    )
    assertEquals("Needs attention", waiting.rows("status").first().second)
    assertTrue("lastError" in waiting.shown() && "attention" in waiting.shown() && "allSent" !in waiting.shown())
    assertEquals(listOf("retry", "disconnect"), waiting.actionsShown("manage"))
    val first = waiting.row("data.conn.attention", 0)
    val list = waiting.block("attention")
    assertEquals("120 points for ada@example.com", ScreenValues.render(list.string("primary")!!, first))
    assertEquals("Not sent yet", ScreenValues.render(list.string("secondary")!!, first))
    assertEquals("Timed out", ScreenValues.render(list.string("tertiary")!!, first))
    val second = waiting.row("data.conn.attention", 1)
    assertEquals("-50 points for bo@example.com", ScreenValues.render(list.string("primary")!!, second))
    assertEquals("Not a member there", ScreenValues.render(list.string("secondary")!!, second))
    assertEquals(json("""{"hostId":"h1","action":"retry"}"""), waiting.body(waiting.action("manage", "retry")))
  }

  @Test
  fun disconnectingSaysWhatItDoesAndConfirmsItOnTheRoute() {
    val model = connected()
    val disconnect = model.action("manage", "disconnect")
    assertTrue(disconnect.destructive)
    val confirm = ScreenValues.render(disconnect.confirm!!, model.context)
    assertEquals(
      "Disconnect Smile.io? Disconnecting turns Rewards off. Points members earned in your connected account stay there. Each member’s built-in points go back to exactly what they were when you connected, and store credit is unchanged.",
      confirm,
    )
    assertEquals(json("""{"hostId":"h1","action":"disconnect","confirm":true}"""), model.body(disconnect))
    assertEquals("Smile.io disconnected", ScreenValues.render(disconnect.success!!, model.context))
  }

  // ------------------------------------------------------------------ members

  @Test
  fun membersAreAskedForAPageAtATimeByTheServersOwnSortAndSearch() {
    val model = screen(spec("loyalty", "loyalty.members"), emptyMap(), """{"members":{"members":[],"next":null}}""")
    val load = model.spec.loads.first { it.key == "members" }
    assertEquals("next", load.cursor)
    assertEquals("after", load.cursorParam)
    assertEquals("/api/loyalty/members?hostId=h1&limit=25&sort=recent&q=", ScreenValues.renderUrl(load.url, model.context))
    val sorted = screen(spec("loyalty", "loyalty.members"), mapOf("sort" to "points"), """{"members":{"members":[]}}""")
    assertEquals("/api/loyalty/members?hostId=h1&limit=25&sort=points&q=", ScreenValues.renderUrl(load.url, sorted.context))
    val found = screen(spec("loyalty", "loyalty.members"), mapOf("q" to "ada@"), """{"members":{"members":[]}}""")
    assertEquals("/api/loyalty/members?hostId=h1&limit=25&sort=recent&q=ada%40", ScreenValues.renderUrl(load.url, found.context))
    assertEquals(listOf("give", "search", "sort"), model.actionsShown("tools"))
    assertEquals(listOf("give", "search"), found.actionsShown("tools"), "a search is by email, so there is nothing to sort")
    val navigate = model.action("tools", "search").navigate!!
    assertEquals("loyalty.members", navigate.screen)
    assertEquals(mapOf("q" to "{form.q}"), navigate.params)
  }

  @Test
  fun aMemberRowReadsLikeTheConsolesAndOpensTheMember() {
    val model = screen(
      spec("loyalty", "loyalty.members"), emptyMap(),
      """{"members":{"members":[{"id":"a1b2","email":"ada@example.com","name":"Ada Lovelace","points":1250,"creditCents":550,"ordersCount":1},
          {"id":"c3d4","email":"bo@example.com","name":null,"points":0,"creditCents":0,"ordersCount":3}]}}""",
    )
    val list = model.block("members")
    val ada = model.row("data.members.members", 0)
    assertEquals("ada@example.com", ScreenValues.render(list.string("primary")!!, ada))
    assertEquals("1,250 points · $5.50 store credit · 1 order", ScreenValues.render(list.string("secondary")!!, ada))
    assertEquals("Ada Lovelace", ScreenValues.render(list.string("tertiary")!!, ada))
    val bo = model.row("data.members.members", 1)
    assertEquals("0 points · $0.00 store credit · 3 orders", ScreenValues.render(list.string("secondary")!!, bo))
    assertEquals("", ScreenValues.render(list.string("tertiary")!!, bo))
    val open = list.raw.jsonObject["open"]!!.jsonObject
    assertEquals("loyalty.member", (open["screen"] as JsonPrimitive).content)
    assertEquals("c3d4", ScreenValues.render(((open["params"] as JsonObject)["memberId"] as JsonPrimitive).content, bo))
  }

  // ------------------------------------------------------------------ adjusting a balance

  private fun member(extra: String = "") =
    screen(
      spec("loyalty", "loyalty.member"), mapOf("memberId" to "a1b2c3"),
      """{"detail":{"member":{"id":"a1b2c3","email":"ada@example.com","name":"Ada Lovelace","points":1250,"creditCents":550,"ordersCount":4,
          "rewardsCode":"RW-7K3P-Q9XZ-2M4D","referralCode":null,"referred":false},
          "ledger":[{"id":"l1","kind":"redeem","points":-120,"creditCents":-500,"note":null,"atMs":1791590400000},
                    {"id":"l2","kind":"earn","points":300,"creditCents":0,"note":"Order 1042","atMs":1791500000000},
                    {"id":"l3","kind":"adjust","points":0,"creditCents":250,"note":"Goodwill","atMs":1791400000000}]$extra}}""",
    )

  @Test
  fun aMemberShowsBalancesCodesAndTheirHistoryInTheConsoleWords() {
    val model = member()
    assertEquals(
      listOf("Email" to "ada@example.com", "Points" to "1,250", "Store credit" to "$5.50", "Orders" to "4", "Rewards code" to "RW-7K3P-Q9XZ-2M4D"),
      model.rows("member"),
      "a referral code shows only when the program gives one",
    )
    assertEquals("Ada Lovelace", ScreenValues.render(model.spec.title, model.context))
    val list = model.block("history")
    fun line(index: Int): List<String> {
      val row = model.row("data.detail.ledger", index)
      val badges = list.raw.jsonObject["badges"]!!.jsonArray.map { it.jsonObject }
        .filter { ScreenValues.condition((it["when"] as JsonPrimitive).content, row) }
        .map { ScreenValues.render((it["text"] as JsonPrimitive).content, row) }
      return listOf(ScreenValues.render(list.string("primary")!!, row)) + badges
    }
    assertEquals(listOf("Spent", "-120 points", "-$5.00 credit"), line(0))
    assertEquals(listOf("Earned", "+300 points"), line(1))
    assertEquals(listOf("Adjusted", "+$2.50 credit"), line(2))
    assertEquals("Goodwill", ScreenValues.render(list.string("tertiary")!!, model.row("data.detail.ledger", 2)))
    val absent = screen(spec("loyalty", "loyalty.member"), mapOf("memberId" to "zz"), """{}""")
    assertEquals(listOf("missing"), absent.shown())
  }

  @Test
  fun anAdjustmentSendsPointsAndCreditTheWayTheConsoleDoesWithAKeyForThePress() {
    val model = member()
    val adjust = model.action("adjust", "adjust")
    assertEquals(mapOf("Idempotency-Key" to "{press}"), adjust.headers, "one key for each press, so the same change twice is two changes")
    assertEquals("/api/loyalty/member", adjust.url)
    assertEquals(listOf("credit", "points", "note", "notify"), adjust.prompt.map { it.key })
    assertEquals(
      json("""{"hostId":"h1","memberId":"a1b2c3","points":-120,"creditCents":-550,"note":"Goodwill","notify":false}"""),
      model.body(adjust, """{"credit":"-5.50","points":-120,"note":"Goodwill","notify":false}"""),
    )
    assertEquals(
      json("""{"hostId":"h1","memberId":"a1b2c3","creditCents":1000,"notify":true}"""),
      model.body(adjust, """{"credit":"10","notify":true}"""),
      "an empty field is left out, which the route reads as nothing to move",
    )
    val toggle = adjust.prompt.first { it.key == "notify" }
    assertEquals("true", toggle.initial)
    val emailed = assertNotNull(adjust.insteadEntry(json("""{"response":{"emailed":true}}""")))
    assertEquals("Saved, and the customer was emailed.", emailed.str("text"))
    assertEquals(null, adjust.insteadEntry(json("""{"response":{"emailed":false}}""")), "otherwise the plain Saved shows")
    assertEquals("Saved", adjust.success)
  }

  @Test
  fun givingStoreCreditEnrollsAnEmailAndTakesTheSameKeyPerPress() {
    val model = screen(spec("loyalty", "loyalty.members"), emptyMap(), """{"members":{"members":[]}}""")
    val give = model.action("tools", "give")
    assertEquals(mapOf("Idempotency-Key" to "{press}"), give.headers)
    assertEquals(listOf("email", "credit", "points", "note", "notify"), give.prompt.map { it.key })
    assertEquals("email", give.prompt.first().kind)
    assertTrue(give.prompt.first().required)
    assertEquals(
      json("""{"hostId":"h1","email":"new@example.com","creditCents":2000,"note":"Welcome","notify":true}"""),
      model.body(give, """{"email":"new@example.com","credit":20,"note":"Welcome","notify":true}"""),
    )
  }

  // ------------------------------------------------------------------ an order

  private fun orderWidget(view: String?) =
    screen(spec("loyalty", "loyalty.order"), mapOf("orderId" to "ord1234567"), if (view == null) "{}" else """{"view":{"order":$view}}""")

  @Test
  fun anOrderSaysWhatItEarnedSpentAndGaveBack() {
    val none = orderWidget("""{"email":null,"memberId":null,"earnedPoints":0,"reversedPoints":0,"spentCents":0,"spentPoints":0,"spentCreditCents":0,"restoredCents":0,"entries":[]}""")
    assertEquals(listOf("none"), none.shown())
    assertEquals(listOf("unavailable"), orderWidget(null).shown())
    val earned = orderWidget("""{"email":"ada@example.com","memberId":"a1","earnedPoints":300,"reversedPoints":120,"spentCents":0,"spentPoints":0,"spentCreditCents":0,"restoredCents":0,"entries":[{"id":"e"}]}""")
    assertEquals(listOf("order"), earned.shown())
    assertEquals(
      listOf("Earned" to "300 points", "For" to "ada@example.com", "Taken back by refunds" to "120 points"),
      earned.rows("order"),
    )
    val spent = orderWidget("""{"email":null,"memberId":null,"earnedPoints":0,"reversedPoints":0,"spentCents":1500,"spentPoints":1000,"spentCreditCents":500,"restoredCents":300,"entries":[]}""")
    assertEquals(
      listOf("Paid with rewards" to "$15.00", "Store credit used" to "$5.00", "Points used" to "1,000 points", "Given back by refunds" to "$3.00"),
      spent.rows("order"),
    )
    assertEquals(listOf("orderDetail"), spent.spec.zones)
    assertNotNull(spent.spec.zones.firstOrNull())
  }

  @Test
  fun theProgramListsItselfInPromotionsOnlyWhereItHasSomethingToSayAndTheOrderWidgetLikewise() {
    assertEquals(listOf("commercePromotions"), spec("loyalty", "loyalty.rewards").zones)
    assertEquals("data.program.program", spec("loyalty", "loyalty.rewards").showWhen)
    for (id in listOf("loyalty.connection", "loyalty.members", "loyalty.member")) assertEquals(emptyList(), spec("loyalty", id).zones, id)
    assertEquals(listOf("orderDetail"), spec("loyalty", "loyalty.order").zones)
    val untouched = screen(spec("loyalty", "loyalty.order"), mapOf("orderId" to "o"), """{"view":{"order":{"earnedPoints":0,"spentCents":0,"entries":[]}}}""")
    assertTrue(!ScreenValues.condition(untouched.spec.showWhen, untouched.context), "an order rewards never touched leaves no row")
    val earned = screen(spec("loyalty", "loyalty.order"), mapOf("orderId" to "o"), """{"view":{"order":{"earnedPoints":30,"spentCents":0,"entries":[]}}}""")
    assertTrue(ScreenValues.condition(earned.spec.showWhen, earned.context))
    assertTrue(!ScreenValues.condition(spec("loyalty", "loyalty.rewards").showWhen, screen(spec("loyalty", "loyalty.rewards"), emptyMap(), "{}").context), "no program, no row")
  }
}
