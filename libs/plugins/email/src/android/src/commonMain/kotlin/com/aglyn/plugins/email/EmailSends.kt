package com.aglyn.plugins.email

import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryFilter
import com.aglyn.contracts.ListQueryOp
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.firestoreJson
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlin.math.floor

/*
 * A SITE'S EMAILS (the console's Email → Messages): every send under
 * `orgs/{orgId}/campaigns` the site holds (`hostId ==`), by the console's
 * own site declaration, newest first; each send's state and report from the
 * console's own model (`campaignSendDisplay`, `campaignReport`,
 * `sendLinkReport`), ported and replayed against its answers. Every act on a
 * send is `POST /api/campaigns/send`, the composer's own route.
 */

const val EMAILS_PAGE_SIZE = 25
const val CAMPAIGN_SEND_ROUTE = "/api/campaigns/send"

fun campaignSendsPath(orgId: String) = "orgs/$orgId/campaigns"

/** The Status chips: every stored status by its words, after All. */
val SEND_STATUS_FILTERS: List<Pair<String, String>> = listOf("all" to "All") + Contracts.nativeCampaignSendStatuses.map { it.value to it.label }

fun emailsQuery(orgId: String, hostId: String, status: String, search: String, limit: Int): FirestoreQuery = planListQuery(
  Contracts.nativeSiteEmailsQuery,
  ListQueryRequest(
    base = listOf(ListQueryFilter(ListQueryOp.EQUAL, "hostId", JsonPrimitive(hostId))),
    clauses = if (status == "all") emptyList() else listOf(ListFilterRequest("status", "equals", status)),
    search = search.trim().ifEmpty { null }?.let { listOf(it) },
  ),
).toFirestoreQuery(campaignSendsPath(orgId), limit)

/*---------- campaignSendProgress / campaignSendDisplay ----------*/

data class SendProgress(val state: String, val reached: Long, val audience: Long?, val remaining: Long, val batch: Long, val nextAtMs: Long, val label: String)

data class SendDisplay(val state: String, val label: String, val progress: SendProgress)

private fun count(raw: Any?): Long {
  val value = (raw as? Number)?.toDouble()?.let { floor(it) } ?: return 0
  return if (value.isFinite() && value > 0) value.toLong() else 0
}

/** A whole number as `toLocaleString` writes it in English: `1,200`. */
fun grouped(value: Long): String = value.toString().reversed().chunked(3).joinToString(",").reversed().replace("-,", "-")

@Suppress("UNCHECKED_CAST")
fun campaignSendProgress(send: Map<String, Any?>?): SendProgress {
  val status = (send?.get("status") as? String) ?: "sent"
  val stats = send?.get("stats") as? Map<String, Any?>
  val reached = count(stats?.get("sent"))
  val rawAudience = stats?.get("audienceSize")
  val audience = if (rawAudience == null) null else count(rawAudience)
  val resume = send?.get("resume") as? Map<String, Any?>
  val remaining = count(resume?.get("remaining"))
  val batch = count(resume?.get("batch"))
  val nextAtMs = count(resume?.get("nextAtMs"))
  val of = audience?.let { " of ${grouped(it)}" } ?: ""
  return when {
    remaining > 0 && nextAtMs > 0 && (status == "scheduled" || status == "sending") ->
      SendProgress("sending", reached, audience, remaining, batch, nextAtMs, "Sending — reached ${grouped(reached)}$of")
    (status == "scheduled" || status == "sending") && reached == 0L ->
      SendProgress("pending", 0, audience, remaining, batch, 0, if (status == "sending") "Sending" else "Scheduled")
    remaining > 0 -> {
      val why = when (status) { "canceled" -> "canceled"; "failed" -> "stopped by an error"; else -> "stopped" }
      SendProgress("stopped", reached, audience, remaining, batch, 0, "Reached ${grouped(reached)}$of — $why with ${grouped(remaining)} not addressed")
    }
    else -> SendProgress("sent", reached, audience, 0, batch, 0, if (batch > 1) "Sent to ${grouped(reached)}$of over $batch runs" else "Sent to ${grouped(reached)}$of")
  }
}

@Suppress("UNCHECKED_CAST")
fun campaignSendHeld(send: Map<String, Any?>?): Boolean {
  val status = send?.get("status") as? String ?: ""
  return (send?.get("staffReview") as? Map<String, Any?>)?.get("state") == "held" && (status == "scheduled" || status == "draft")
}

fun campaignSendDisplay(send: Map<String, Any?>?): SendDisplay {
  val progress = campaignSendProgress(send)
  return when {
    campaignSendHeld(send) -> SendDisplay("held", "Held for review", progress)
    send?.get("status") == "draft" -> SendDisplay("draft", "Draft", progress)
    else -> SendDisplay(progress.state, progress.label, progress)
  }
}

/*---------- campaignReport / sendRate / sendLinkReport ----------*/

data class SendRate(val value: Double, val numerator: Double, val denominator: Double, val denominatorLabel: String)

fun sendRate(numerator: Number?, denominator: Number?, label: String): SendRate? {
  val top = numerator?.toDouble() ?: 0.0
  val bottom = denominator?.toDouble() ?: 0.0
  if (!top.isFinite() || !bottom.isFinite() || bottom <= 0) return null
  return SendRate(top / bottom, top, bottom, label)
}

data class Population(val id: String, val label: String, val count: Long, val ofLabel: String, val of: Long)

data class Caveat(val id: String, val message: String)

data class CampaignReport(
  val sent: Long,
  val recipients: Long,
  val delivered: Long?,
  val opens: Long,
  val clicks: Long,
  val uniqueOpens: Long?,
  val uniqueClicks: Long?,
  val bounced: Long,
  val complained: Long,
  val unsubscribes: Long,
  val rates: Map<String, SendRate?>,
  val populations: List<Population>,
  val caveats: List<Caveat>,
)

fun campaignReport(stats: Map<String, Any?>?): CampaignReport {
  val s = stats.orEmpty()
  fun n(key: String) = (s[key] as? Number)?.toLong() ?: 0L
  fun opt(key: String) = if (key !in s || s[key] == null) null else (s[key] as? Number)?.toLong() ?: 0L
  val sent = n("sent")
  val recipients = n("recipients")
  val delivered = opt("delivered")
  val uniqueOpens = opt("uniqueOpens")
  val uniqueClicks = opt("uniqueClicks")
  val clickTrackable = s["clickTracked"] == true
  val rates = linkedMapOf(
    "delivery" to delivered?.let { sendRate(it, sent, "sent") },
    "open" to sendRate(uniqueOpens, delivered, "delivered"),
    "click" to if (clickTrackable) sendRate(uniqueClicks, delivered, "delivered") else null,
    "clickToOpen" to if (clickTrackable) sendRate(uniqueClicks, uniqueOpens, "unique openers") else null,
    "bounce" to sendRate(n("bounced"), sent, "sent"),
    "complaint" to sendRate(n("complained"), delivered, "delivered"),
    "unsubscribe" to sendRate(n("unsubscribes"), delivered, "delivered"),
  )
  val audienceSize = n("audienceSize")
  val populations = listOf(
    Triple("consented", "Had a consent basis", "audience"),
    Triple("consentedByOperator", "Consent asserted by an operator", "audience"),
    Triple("grandfathered", "Reachable only because consent is not enforced retroactively", "audience"),
    Triple("consentWithheld", "Withheld by the consent rule", "audience"),
    Triple("suppressed", "Already suppressed", "addressed"),
    Triple("cadenceHeld", "Asked for mail less often than this", "addressed"),
    Triple("noMailServer", "Excluded: no mail server", "addressed"),
    Triple("gatewayHeld", "Excluded: behind a gateway that refused this sender", "addressed"),
  ).mapNotNull { (id, label, of) ->
    opt(id)?.let { Population(id, label, it, of, if (of == "audience") audienceSize else recipients) }
  }
  val caveats = buildList {
    if (delivered == null) add(Caveat("delivery-unrecorded", "No delivery events have been recorded for this campaign, so open, click, complaint and unsubscribe rates cannot be computed — every one of them is taken over delivered. Counts below are still real."))
    if (!clickTrackable) add(Caveat("click-tracking-unrecorded", "This send did not record carrying an HTML part. Click tracking rewrites links in the HTML, so a send without one reports zero clicks whatever recipients did. The click count is shown; no click rate is computed from it."))
    if (s["audienceSizeTruncated"] == true) add(Caveat("audience-truncated", "Audience resolution stopped at its read ceiling, so the audience size is a floor — the real audience is at least this large, and every share taken over it is at most the figure shown."))
    if (n("deferred") > 0) add(Caveat("send-deferred", "${n("deferred")} recipients were held back by the hourly send governor and never received this campaign. They are counted in addressed, not in sent."))
  }
  return CampaignReport(sent, recipients, delivered, n("opens"), n("clicks"), uniqueOpens, uniqueClicks, n("bounced"), n("complained"), n("unsubscribes"), rates, populations, caveats)
}

data class LinkRow(val url: String, val clicks: Long, val share: SendRate?)

data class LinkReport(val rows: List<LinkRow>, val attributedClicks: Long, val overflowClicks: Long, val unattributedClicks: Long, val truncated: Boolean)

@Suppress("UNCHECKED_CAST")
fun sendLinkReport(rollup: Map<String, Any?>?): LinkReport {
  val entries = (rollup?.get("links") as? Map<String, Any?>).orEmpty().values.mapNotNull { raw ->
    val entry = raw as? Map<String, Any?> ?: return@mapNotNull null
    val url = entry["url"] as? String ?: ""
    val clicks = (entry["clicks"] as? Number)?.toLong() ?: 0L
    if (url.isEmpty()) null else url to clicks
  }
  val attributed = entries.sumOf { it.second }
  val rows = entries.sortedWith(compareByDescending<Pair<String, Long>> { it.second }.thenBy { it.first })
    .map { (url, clicks) -> LinkRow(url, clicks, sendRate(clicks, attributed, "link clicks counted")) }
  val overflow = (rollup?.get("overflowClicks") as? Number)?.toLong() ?: 0L
  return LinkReport(rows, attributed, overflow, (rollup?.get("unattributedClicks") as? Number)?.toLong() ?: 0L, entries.size >= 50 || overflow > 0)
}

fun percent(rate: SendRate?): String = rate?.let { r -> "${(kotlin.math.round(r.value * 1000) / 10.0)}%" } ?: "—"

/*---------- rows ----------*/

data class EmailSend(
  val id: String,
  val subject: String,
  val display: SendDisplay,
  val status: String,
  val audience: String?,
  val listName: String?,
  val createdAtMs: Long?,
  val sendAtMs: Long?,
  val data: Map<String, Any?>,
) {
  val held: Boolean get() = display.state == "held"
  val midFlight: Boolean get() = display.state == "sending"
  /** The controls the console's email page offers (the RN lane's `campaignSendControls`, from the same display). */
  val canSendNow: Boolean get() = !held && (status == "draft" || status == "scheduled") && !midFlight
  val canStop: Boolean get() = !held && midFlight
  val canFollowUp: Boolean get() = !held && status == "sent"
  val canCancel: Boolean get() = status == "scheduled" && !midFlight
  val canCompose: Boolean get() = (status == "draft" || status == "scheduled") && !midFlight && !held
}

fun millisOf(raw: Any?): Long? = when (raw) {
  is FirestoreTimestamp -> raw.epochMillis
  is Number -> raw.toLong()
  else -> null
}

fun emailSendOf(doc: FirestoreDoc) = EmailSend(
  id = doc.id,
  subject = doc.string("subject")?.takeIf { it.isNotBlank() } ?: doc.string("displayName") ?: "(No subject)",
  display = campaignSendDisplay(doc.data),
  status = doc.string("status") ?: "sent",
  audience = doc.string("audience"),
  listName = doc.string("listName"),
  createdAtMs = millisOf(doc.data["createdAtMs"]),
  sendAtMs = millisOf(doc.data["sendAtMs"]),
  data = doc.data,
)

fun audienceLabel(send: EmailSend): String = when (send.audience) {
  "leads" -> "Leads"
  "members" -> "Site members"
  "manual" -> "Typed addresses"
  "segment" -> "A segment"
  "list" -> send.listName?.let { "List: $it" } ?: "A list"
  else -> send.audience ?: "—"
}

/*---------- the composer's route ----------*/

data class Proofs(val recipients: List<String>, val personas: List<Pair<String, String>>)

/** Every act on a send, as the composer posts it to `/api/campaigns/send`. */
class CampaignSendApi(private val api: ConsoleApiClient, private val hostId: String) {
  private suspend fun post(fields: Map<String, Any?>): JsonObject? =
    api.request(CAMPAIGN_SEND_ROUTE, ApiMethod.POST, firestoreJson((fields + ("hostId" to hostId)).filterValues { it != null }))?.jsonObject

  private fun JsonObject?.number(vararg keys: String): Long? = keys.firstNotNullOfOrNull { (this?.get(it) as? JsonPrimitive)?.longOrNull }

  /** How many a send now would reach (the route's dry run). */
  suspend fun sendNowCount(campaignId: String): Long? = post(mapOf("action" to "sendNow", "campaignId" to campaignId, "dryRun" to true)).number("sendable", "sent")

  suspend fun sendNow(campaignId: String) { post(mapOf("action" to "sendNow", "campaignId" to campaignId)) }

  suspend fun followUpCount(campaignId: String): Long? = post(mapOf("action" to "followUp", "campaignId" to campaignId, "dryRun" to true)).number("sendable", "sent")

  suspend fun followUp(campaignId: String) { post(mapOf("action" to "followUp", "campaignId" to campaignId)) }

  suspend fun cancel(campaignId: String) { post(mapOf("action" to "cancel", "campaignId" to campaignId)) }

  suspend fun rename(campaignId: String, displayName: String) { post(mapOf("action" to "update", "campaignId" to campaignId, "displayName" to displayName)) }

  suspend fun proofOptions(): Proofs {
    val answer = post(mapOf("action" to "proofOptions"))
    val recipients = (answer?.get("recipients") as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull ?: ((it as? JsonObject)?.get("email") as? JsonPrimitive)?.contentOrNull }
    val personas = (answer?.get("personas") as? JsonArray).orEmpty().mapNotNull { entry ->
      val o = entry as? JsonObject ?: return@mapNotNull null
      val email = (o["email"] as? JsonPrimitive)?.contentOrNull ?: return@mapNotNull null
      email to ((o["name"] as? JsonPrimitive)?.contentOrNull ?: email)
    }
    return Proofs(recipients, personas)
  }

  /** A test of what the send would say, to one address, as one persona; records nothing. */
  suspend fun test(message: Map<String, Any?>, to: String, personaEmail: String?) {
    post(message + mapOf("action" to "test", "to" to to, "personaEmail" to personaEmail))
  }

  /** Saves the composer's copy as a draft, schedules it, or sends it now. */
  suspend fun compose(action: String, message: Map<String, Any?>): String? {
    val answer = post(message + ("action" to action))
    return (answer?.get("campaignId") as? JsonPrimitive)?.contentOrNull ?: (answer?.get("id") as? JsonPrimitive)?.contentOrNull
  }
}

/** The message a test sends, from the stored send (the RN lane's `testMessageFromRecord`). */
fun testMessageOf(send: EmailSend): Map<String, Any?> {
  fun text(key: String) = (send.data[key] as? String)?.trim().orEmpty()
  val template = text("templateScreenId")
  return buildMap {
    put("subject", text("subject").ifEmpty { "Test send" })
    put("body", if (template.isNotEmpty()) "" else (send.data["body"] as? String).orEmpty())
    put("fromName", text("fromName"))
    put("replyTo", text("replyTo"))
    put("preheader", text("preheader"))
    text("senderId").takeIf { it.isNotEmpty() }?.let { put("senderId", it) }
    if (template.isNotEmpty()) {
      put("templateScreenId", template)
      (send.data["plainText"] as? String)?.takeIf { it.isNotEmpty() }?.let { put("plainText", it) }
    }
    text("emailCampaignId").takeIf { it.isNotEmpty() }?.let { put("emailCampaignId", it) }
  }
}

private fun JsonArray?.orEmpty(): List<JsonElement> = this ?: emptyList()
