package com.aglyn.plugins.ai

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import com.aglyn.ui.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import com.aglyn.ui.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.Contracts
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.Live
import com.aglyn.core.releaseFlagOn
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.StatsCard
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/*
 * "Ask AI about these numbers" (AGL-4011): the console's tile (ai-insight-card.component.tsx) on a site's Home and
 * Analytics and on the workspace's Home, and its "Ask about your numbers" dialog (ai-insight-dialog.component.tsx). A
 * question starts an `insight` job through the console's own door (`POST /api/ai/jobs`), the dialog follows the job's
 * events and reads the answer through `/api/ai/insights/{jobId}`, with every insight's figures one tap away. On a plan
 * without the AI add-on the same tile opens the add-on's offer. Every word comes from the contracts (ai-insight-ask.ts).
 * The Apple twin is AiInsight.swift.
 */

/** Where a question is asked from: the console's `surface`. */
enum class AiInsightSurface(val key: String) {
  ANALYTICS("analytics"),
  WORKSPACE("workspace"),
}

/** The add-on's offer for the tile (`AI_UPSELL_COPY.insight`, `aiUpsellOffer`), in the console's words. */
internal object AiInsightUpsell {
  const val DOES =
    "Ask a question about the figures on this page and AI answers from them, every answer traced to the figures it is built from. It reads; it changes nothing."

  fun offer(canManageBilling: Boolean): String {
    val feature = Contracts.aiInsightCardCopy.title
    val addon = "${Contracts.platformBrandName} AI"
    return if (canManageBilling) {
      "$feature is switched off for this workspace. It comes with an $addon tier, which you can choose in Billing."
    } else {
      "$feature is switched off for this workspace. It comes with an $addon tier. Ask a workspace owner or admin to choose one in Billing."
    }
  }
}

private fun JsonElement?.obj(): JsonObject? = this as? JsonObject
private fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
private fun JsonElement?.num(): Double? = (this as? JsonPrimitive)?.doubleOrNull
private fun JsonElement?.list(): List<JsonElement> = (this as? JsonArray).orEmpty()

/** The tile: what it answers and "Ask a question"; gated on the workspace's `aiGenerative` and `release_ai_generative`. */
@Composable
fun AiInsightTile(context: NativePluginContext, surface: AiInsightSurface) {
  val orgId = context.orgId ?: return
  var entitled by remember(orgId, context.hostId) { mutableStateOf<Boolean?>(null) }
  LaunchedEffect(orgId, context.hostId) {
    runCatching {
      val query = buildMap { put("orgId", orgId); context.hostId?.let { put("hostId", it) } }
      val body = context.api.request("/api/orgs/entitlements", query = query).obj()
      (body?.get("features").obj()?.get("aiGenerative") as? JsonPrimitive)?.booleanOrNull == true
    }.onSuccess { entitled = it }
  }
  val org by remember(orgId) { context.firestore.observeDoc("orgs/$orgId") }.collectAsState(Live.Loading)
  val orgData = (org as? Live.Ready)?.value?.data ?: return
  if (entitled == null || !releaseFlagOn("release_ai_generative", orgData, orgId, staff = false)) return
  var asking by remember { mutableStateOf(false) }
  var upsell by remember { mutableStateOf(false) }
  val copy = Contracts.aiInsightCardCopy
  StatsCard(Modifier.testTag("ai-insight-tile")) {
    Text(copy.title, style = MaterialTheme.typography.titleMedium)
    Text(if (surface == AiInsightSurface.WORKSPACE) copy.workspace else copy.site, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedButton(onClick = { if (entitled == true) asking = true else upsell = true }, modifier = Modifier.testTag("ai-insight-ask")) {
      Icon(AglynIcons.named("auto_awesome"), contentDescription = null)
      Text(copy.action, Modifier.padding(start = space(1f)))
    }
  }
  if (asking) AiInsightDialog(context, surface) { asking = false }
  if (upsell) {
    val canManage = context.orgRole in setOf("owner", "admin")
    AlertDialog(
      onDismissRequest = { upsell = false },
      title = { Text(copy.title) },
      text = {
        Column(verticalArrangement = Arrangement.spacedBy(space(2f))) {
          Text(AiInsightUpsell.DOES)
          Text(AiInsightUpsell.offer(canManage), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      },
      confirmButton = {
        if (canManage) {
          Button(onClick = { upsell = false; context.navigate("core.billing.addons") }, modifier = Modifier.testTag("ai-insight-upsell-add")) {
            Text("Add ${Contracts.platformBrandName} AI")
          }
        }
      },
      dismissButton = { TextButton(onClick = { upsell = false }) { Text(if (canManage) "Not now" else "Close") } },
      modifier = Modifier.testTag("ai-insight-upsell"),
    )
  }
}

/** A table an insight job read, as `/api/ai/insights/{jobId}` returns it. */
internal class InsightTable(value: JsonObject) {
  val ref = value["ref"].str().orEmpty()
  val title = value["title"].str().orEmpty()
  val periodFrom = value["period"].obj()?.get("from").str()
  val periodTo = value["period"].obj()?.get("to").str()
  val sourceLabel = value["source"].obj()?.get("label").str().orEmpty()
  val sourcePath = value["source"].obj()?.get("path").str()
  val scope = value["scope"].str() ?: "site"
  private val columns = value["columns"].list().mapNotNull { it.obj() }
  private val rows = value["rows"].list().map { it.obj() ?: JsonObject(emptyMap()) }

  /** `aiInsightCellText` (`pluginFigureCellText`): a cell by its column's kind; nothing is "—". */
  private fun cellText(key: String, value: JsonElement?): String {
    if (value == null || value is JsonNull) return "—"
    value.str()?.let { return it.ifEmpty { "—" } }
    val number = value.num() ?: return value.toString()
    val column = columns.firstOrNull { it["key"].str() == key } ?: return plain(number, 2)
    return when (column["kind"].str()) {
      "money" -> {
        val code = column["currency"].str() ?: "USD"
        (if (code == "USD") "$" else "$code ") + grouped(number, 2, fixed = true)
      }
      "percent" -> "${plain(number, 1)}%"
      "change" -> "${if (number > 0) "+" else ""}${plain(number, 1)}%"
      "duration" -> {
        val seconds = kotlin.math.floor(number + 0.5).toLong()
        val minutes = seconds / 60
        when {
          seconds < 60 -> "${seconds}s"
          minutes < 60 -> "${minutes}m ${(seconds % 60).toString().padStart(2, '0')}s"
          else -> "${minutes / 60}h ${(minutes % 60).toString().padStart(2, '0')}m"
        }
      }
      else -> plain(number, 2)
    }
  }

  private fun grouped(number: Double, digits: Int, fixed: Boolean): String {
    val factor = Math10.pow(digits)
    val rounded = kotlin.math.round(kotlin.math.abs(number) * factor) / factor
    val whole = kotlin.math.floor(rounded).toLong().toString().reversed().chunked(3).joinToString(",").reversed()
    val fraction = kotlin.math.round((rounded - kotlin.math.floor(rounded)) * factor).toLong()
    val tail = when {
      fixed -> "." + fraction.toString().padStart(digits, '0')
      fraction == 0L -> ""
      else -> "." + fraction.toString().padStart(digits, '0').trimEnd('0')
    }
    return (if (number < 0) "-" else "") + whole + tail
  }

  private fun plain(number: Double, digits: Int) = grouped(number, digits, fixed = false)

  /** `aiInsightRowText`: one cited row, every column labeled. */
  fun rowText(index: Int): String {
    val row = rows.getOrNull(index) ?: return ""
    return columns.joinToString(" · ") { "${it["label"].str().orEmpty()}: ${cellText(it["key"].str().orEmpty(), row[it["key"].str().orEmpty()])}" }
  }

  /** `aiInsightSourceHref`: the console page the figures come from. */
  fun sourceHref(orgSlug: String?, host: String?): String? {
    val path = sourcePath?.takeIf { it.isNotEmpty() } ?: return null
    if (orgSlug.isNullOrEmpty()) return null
    if (scope == "org") return "/$orgSlug/$path"
    return host?.let { "/$orgSlug/hosts/$it/$path" }
  }
}

private object Math10 {
  fun pow(digits: Int): Double {
    var value = 1.0
    repeat(digits) { value *= 10 }
    return value
  }
}

private enum class InsightPhase { ASK, WORKING, ANSWER }

private val TERMINAL = setOf("done", "failed", "canceled")

/** "Ask about your numbers": the question and its window, the job's progress, then the answer with its figures. */
@Composable
internal fun AiInsightDialog(context: NativePluginContext, surface: AiInsightSurface, onClose: () -> Unit) {
  val copy = Contracts.aiInsightDialogCopy
  val orgId = context.orgId ?: return onClose()
  val scope = rememberCoroutineScope()
  var phase by remember { mutableStateOf(InsightPhase.ASK) }
  var question by remember { mutableStateOf("") }
  var days by remember { mutableStateOf(Contracts.aiInsightDefaultDays.toInt()) }
  var notice by remember { mutableStateOf<String?>(null) }
  var stillWriting by remember { mutableStateOf<String?>(null) }
  var answer by remember { mutableStateOf<JsonObject?>(null) }
  var openCitations by remember { mutableStateOf<Int?>(null) }
  var watching by remember { mutableStateOf<Job?>(null) }
  val user by remember(context.uid) { context.firestore.observeDoc("users/${context.uid}") }.collectAsState(Live.Loading)
  var subscribedOverride by remember { mutableStateOf<Boolean?>(null) }
  val subscribed = subscribedOverride ?: (user as? Live.Ready)?.value?.data?.let { ((it["insightDigests"] as? Map<*, *>)?.get(orgId) as? Boolean) == true }

  suspend fun settle(id: String, status: String, error: String?) {
    if (status != "done") {
      notice = error ?: copy.questionFailed
      phase = InsightPhase.ASK
      return
    }
    runCatching { context.api.request("/api/ai/insights/$id", query = mapOf("orgId" to orgId)).obj()?.get("answer").obj() }
      .onSuccess { read ->
        if (read == null) {
          notice = copy.answerFailed
          phase = InsightPhase.ASK
        } else {
          answer = read
          phase = InsightPhase.ANSWER
        }
      }
      .onFailure { notice = (it as? ConsoleApiError)?.message ?: copy.answerFailed; phase = InsightPhase.ASK }
  }

  /** Follows the job's events until it settles (the console's `follow`), reconnecting when the stream asks to. */
  suspend fun follow(id: String, status: String, error: String?) {
    if (status in TERMINAL) return settle(id, status, error)
    var again = true
    while (again) {
      again = false
      var settled: Pair<String, String?>? = null
      val ok = runCatching {
        context.api.stream("/api/ai/jobs/$id/events", body = null, query = mapOf("orgId" to orgId)) { event ->
          if (event["type"].str() == "reconnect") again = true
          if (event["type"].str() != "state") return@stream
          val job = event["job"].obj() ?: return@stream
          val next = job["status"].str().orEmpty()
          if (next == "needs_input") notice = job["error"].str() ?: copy.cannotRun
          if (next in TERMINAL) settled = next to job["error"].str()
        }
      }.isSuccess
      settled?.let { (s, e) -> return settle(id, s, e) }
      if (!ok) break
    }
    notice = copy.stillWriting
    stillWriting = id
    phase = InsightPhase.ASK
  }

  fun ask() {
    val text = question.trim()
    if (text.isEmpty()) return
    notice = null
    stillWriting = null
    phase = InsightPhase.WORKING
    watching?.cancel()
    watching = scope.launch {
      runCatching {
        val body = buildJsonObject {
          put("orgId", orgId)
          context.hostId?.let { put("hostId", it) } ?: put("hostId", JsonNull)
          put("kind", "insight")
          put("brief", text)
          putJsonObject("inputs") {
            put("surface", surface.key)
            put("days", days)
          }
        }
        context.api.request("/api/ai/jobs", ApiMethod.POST, body).obj()?.get("job").obj()
      }.onSuccess { job ->
        val id = job?.get("id").str()
        if (job == null || id == null) {
          notice = copy.askFailed
          phase = InsightPhase.ASK
        } else {
          follow(id, job["status"].str().orEmpty(), job["error"].str())
        }
      }.onFailure {
        notice = (it as? ConsoleApiError)?.message ?: copy.askFailed
        phase = InsightPhase.ASK
      }
    }
  }

  AlertDialog(
    onDismissRequest = { watching?.cancel(); onClose() },
    title = { Text(copy.title) },
    modifier = Modifier.testTag("ai-insight-dialog"),
    text = {
      Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(2f))) {
        when (phase) {
          InsightPhase.ASK -> {
            OutlinedTextField(
              value = question,
              onValueChange = { question = it.take(Contracts.aiInsightQuestionMaxChars.toInt()) },
              label = { Text(copy.questionLabel) },
              placeholder = { Text(Contracts.aiInsightPlaceholders[surface.key].orEmpty()) },
              minLines = 2,
              modifier = Modifier.fillMaxWidth().testTag("ai-insight-question"),
            )
            Text(copy.windowLabel, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            ChoiceChipRow(
              options = Contracts.aiInsightWindows.map { ChipOption(it.toInt().toString(), "${it.toInt()} days") },
              selected = days.toString(),
              onSelect = { days = it.toInt() },
              modifier = Modifier.testTag("ai-insight-window"),
            )
            Text(copy.promise, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          InsightPhase.WORKING -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1.5f)), modifier = Modifier.testTag("ai-insight-working")) {
            CircularProgressIndicator()
            Text(copy.working)
          }
          InsightPhase.ANSWER -> answer?.let { read -> InsightAnswer(context, read, openCitations) { openCitations = it } }
        }
        notice?.let { message ->
          NoticeBanner(message, StatusTone.WARNING) {
            stillWriting?.let { job -> TextButton(onClick = { onClose(); context.navigate("ai.job", mapOf("jobId" to job)) }) { Text(copy.openJobs) } }
          }
        }
        if (subscribed != null) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Text(copy.digest, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            Switch(
              checked = subscribed,
              onCheckedChange = { next ->
                subscribedOverride = next
                scope.launch {
                  runCatching { context.writer.merge("users/${context.uid}", mapOf("insightDigests" to mapOf(orgId to next))) }
                    .onFailure { subscribedOverride = !next; notice = copy.digestFailed }
                }
              },
              modifier = Modifier.testTag("ai-insight-digest"),
            )
          }
        }
      }
    },
    confirmButton = {
      when (phase) {
        InsightPhase.ASK -> Button(onClick = ::ask, enabled = question.isNotBlank(), modifier = Modifier.testTag("ai-insight-submit")) { Text(copy.ask) }
        InsightPhase.ANSWER -> TextButton(onClick = { answer = null; question = ""; phase = InsightPhase.ASK }) { Text(copy.askAnother) }
        InsightPhase.WORKING -> Unit
      }
    },
    dismissButton = { TextButton(onClick = { watching?.cancel(); onClose() }) { Text(copy.close) } },
  )
}

@Composable
private fun InsightAnswer(context: NativePluginContext, read: JsonObject, openCitations: Int?, setOpen: (Int?) -> Unit) {
  val copy = Contracts.aiInsightDialogCopy
  val tables = read["tables"].list().mapNotNull { it.obj() }.map(::InsightTable)
  val insights = read["insights"].list().mapNotNull { it.obj() }
  Column(Modifier.testTag("ai-insight-answer"), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    Text(read["question"].str().orEmpty(), style = MaterialTheme.typography.titleSmall)
    if (insights.isEmpty()) NoticeBanner(copy.unanswered, StatusTone.INFO)
    insights.forEachIndexed { index, insight ->
      Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        Text("${index + 1}. ${insight["text"].str().orEmpty()}", style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = { setOpen(if (openCitations == index) null else index) }) {
          Text(if (openCitations == index) copy.hideFigures else copy.showFigures)
        }
        if (openCitations == index) {
          Column(Modifier.padding(start = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
            insight["cites"].list().mapNotNull { it.obj() }.forEach { cite ->
              val table = tables.firstOrNull { it.ref == cite["table"].str() } ?: return@forEach
              val period = table.periodFrom?.let { "${table.title} · $it to ${table.periodTo.orEmpty()}" } ?: table.title
              Text(period, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
              table.sourceHref(context.orgSlug, context.hostSlug)?.let { href ->
                TextButton(onClick = { context.openLink(href) }) { Text("Open ${table.sourceLabel}") }
              }
              cite["rows"].list().mapNotNull { it.num()?.toInt() }.forEach { row ->
                Text(table.rowText(row), style = MaterialTheme.typography.bodySmall)
              }
            }
          }
        }
      }
    }
    read["gap"].str()?.takeIf { it.isNotEmpty() }?.let { NoticeBanner(it, StatusTone.INFO) }
    val left = read["left"].num()?.toInt() ?: 0
    if (left > 0) {
      Text(
        "$left ${if (left == 1) "insight was" else "insights were"} left out because ${if (left == 1) "its numbers" else "their numbers"} could not be traced to the figures.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}
