package com.aglyn.plugins.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AssistChip
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.Live
import com.aglyn.pluginhost.LocalSlotParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.NeedsYouLine
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** The slot the shell docks the AI panel's widget in (right on wide windows, a sheet on phones). */
const val ASSIST_PANEL_SLOT = "assistPanel"

/** How many turns of the thread ride with each question, as the console's panel sends them. */
private const val ASSIST_HISTORY_TURNS = 12

/** One turn of the thread. */
private data class AssistTurn(val role: String, val text: String, val docs: List<Pair<String, String>> = emptyList(), val proposal: Pair<String, String>? = null)

/** The day's or month's message standing (`quota` on the chat's answer). */
private data class AssistQuota(val period: String, val used: Long, val limit: Long, val remaining: Long)

private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/** A few questions that fit where the person is, by the console path the shell reports. */
internal fun assistSuggestions(route: String): List<String> = when {
  "/orders" in route -> listOf("Which orders need me today?", "Draft a reply about a late order", "How do I refund one item?")
  "/products" in route -> listOf("Write a description for a product", "Which products are low on stock?", "How do I add variants?")
  "/crm" in route -> listOf("Who should I follow up with this week?", "Draft a follow-up email", "How do deal stages work?")
  "/inbox" in route -> listOf("Summarize today's messages", "Draft a friendly reply", "How do I add someone to a list?")
  "/screens" in route || "/pages" in route -> listOf("Add a section to this page", "Write a headline for my home page", "How do I publish a page?")
  "/hosts/" in route -> listOf("What needs me on this site?", "Build me a page", "How do I change my site's colors?")
  else -> listOf("What can Assist do here?", "Build me a new page", "How do I invite my team?")
}

/**
 * The AI panel (`ai.assist-panel`, the console's Assist): a chat that reads the page the person is on, its context chip
 * saying what it reads, a few questions that fit the screen, the credits strip and the day's free limit. Answers stream
 * from `/api/assist/chat`, the console's own route; a proposal opens where it points, a build goes through Create with
 * AI. With no model on a deployment the route answers from the docs, or says so.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AssistPanel(context: NativePluginContext) {
  val orgId = context.orgId ?: return
  val params = LocalSlotParams.current
  val route = params["route"].orEmpty()
  val looking = params["title"]
  val turns = remember(orgId) { mutableStateListOf<AssistTurn>() }
  var question by remember { mutableStateOf("") }
  var busy by remember { mutableStateOf(false) }
  var quota by remember(orgId) { mutableStateOf<AssistQuota?>(null) }
  var credits by remember(orgId) { mutableStateOf<String?>(null) }
  val scope = rememberCoroutineScope()
  val listState = rememberLazyListState()
  LaunchedEffect(orgId) {
    credits = runCatching {
      val answer = context.api.request("/api/ai/billing/credits", ApiMethod.GET, query = mapOf("orgId" to orgId)) as? JsonObject
      val standing = answer?.get("credits") as? JsonObject
      when {
        (answer?.get("unlimited") as? JsonPrimitive)?.contentOrNull == "true" -> "AI credits are not capped on this workspace"
        standing != null -> "${standing.str("remaining") ?: "0"} credits left this month"
        else -> null
      }
    }.getOrNull()
  }
  LaunchedEffect(turns.size, turns.lastOrNull()?.text?.length) { if (turns.isNotEmpty()) runCatching { listState.scrollToItem(turns.lastIndex) } }

  fun ask(text: String) {
    val asked = text.trim()
    if (asked.isEmpty() || busy) return
    val history = turns.takeLast(ASSIST_HISTORY_TURNS).filter { it.text.isNotBlank() }
    turns += AssistTurn("user", asked)
    turns += AssistTurn("assistant", "")
    question = ""
    busy = true
    val index = turns.lastIndex
    scope.launch {
      try {
        val body = buildJsonObject {
          put("orgId", orgId)
          put("question", asked)
          put("history", buildJsonArray { history.forEach { add(buildJsonObject { put("role", it.role); put("text", it.text) }) } })
          put("context", buildJsonObject { put("route", route); put("hostId", context.hostId.orEmpty()); put("orgSlug", context.orgSlug.orEmpty()) })
        }
        context.api.stream("/api/assist/chat", body) { event ->
          when (event.str("type")) {
            "delta" -> event.str("text")?.let { delta -> turns[index] = turns[index].copy(text = turns[index].text + delta) }
            "done" -> {
              val docs = (event["docs"] as? JsonArray).orEmpty().mapNotNull { doc ->
                (doc as? JsonObject)?.let { d -> (d.str("title") ?: d.str("label") ?: return@let null) to (d.str("url") ?: d.str("href") ?: return@let null) }
              }
              val proposal = (event["proposal"] as? JsonObject)?.let { p -> (p.str("label") ?: "Open it") to (p.str("href") ?: return@let null) }
              turns[index] = turns[index].copy(docs = docs, proposal = proposal)
              (event["quota"] as? JsonObject)?.let { q ->
                quota = AssistQuota(q.str("period") ?: "day", (q["used"] as? JsonPrimitive)?.longOrNull ?: 0, (q["limit"] as? JsonPrimitive)?.longOrNull ?: 0, (q["remaining"] as? JsonPrimitive)?.longOrNull ?: 0)
              }
            }
          }
        }
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        val said = when ((failure as? ConsoleApiError)?.status) {
          501 -> "I could not find anything in the documentation about that, and Assist is not switched on here yet. Try asking in different words."
          else -> failure.message ?: "The assistant request failed. Try again."
        }
        turns[index] = turns[index].copy(text = listOf(turns[index].text, said).filter { it.isNotBlank() }.joinToString("\n\n"))
      } finally {
        busy = false
      }
    }
  }

  Column(Modifier.fillMaxSize().testTag("assist-panel")) {
    // What it reads: the context chip.
    looking?.let {
      Row(Modifier.padding(horizontal = space(2f), vertical = space(1f)), verticalAlignment = Alignment.CenterVertically) {
        AssistChip(onClick = {}, label = { Text("Looking at: $it", maxLines = 1) }, leadingIcon = { Icon(AglynIcons.named("visibility"), null, Modifier.size(16.dp)) }, modifier = Modifier.testTag("assist-context"))
      }
    }
    LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState) {
      if (turns.isEmpty()) {
        item {
          Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
            Text("Try", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            for (suggestion in assistSuggestions(route)) {
              TextButton(onClick = { ask(suggestion) }, modifier = Modifier.testTag("assist-suggestion")) {
                Icon(AglynIcons.named("auto_awesome"), null, Modifier.size(16.dp))
                Text(suggestion, Modifier.padding(start = space(1f)))
              }
            }
          }
        }
      }
      itemsIndexed(turns) { i, turn ->
        val mine = turn.role == "user"
        Box(Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(0.5f)), contentAlignment = if (mine) Alignment.CenterEnd else Alignment.CenterStart) {
          Column(
            Modifier.widthIn(max = 520.dp)
              .background(if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh, RoundedCornerShape(com.aglyn.ui.shellMetrics.cardRadius))
              .padding(space(1.5f))
              .testTag("assist-turn-$i")
              .semantics { if (!mine) liveRegion = LiveRegionMode.Polite },
            verticalArrangement = Arrangement.spacedBy(space(0.5f)),
          ) {
            Text(turn.text.ifEmpty { if (busy && i == turns.lastIndex) "…" else "" }, style = MaterialTheme.typography.bodyMedium)
            turn.proposal?.let { (label, href) -> TextButton(onClick = { context.openLink(href) }, modifier = Modifier.testTag("assist-proposal")) { Text(label) } }
            if (turn.docs.isNotEmpty()) {
              FlowRow(horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
                turn.docs.forEach { (title, url) -> AssistChip(onClick = { context.openLink(url) }, label = { Text(title, maxLines = 1) }) }
              }
            }
          }
        }
      }
    }
    // The credits strip and the day's free limit.
    val standing = listOfNotNull(
      quota?.let { q -> "${q.remaining} of ${q.limit} free messages left ${if (q.period == "day") "today" else "this month"}" },
      credits,
    ).joinToString(" · ")
    if (standing.isNotEmpty()) {
      Text(standing, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = space(2f)).testTag("assist-credits"))
    }
    Row(Modifier.fillMaxWidth().padding(space(1.5f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedTextField(
        question,
        onValueChange = { question = it },
        placeholder = { Text(context.hostId?.let { "Ask about this site" } ?: "Ask about this workspace") },
        modifier = Modifier.weight(1f).testTag("assist-field"),
        maxLines = 4,
        shape = RoundedCornerShape(com.aglyn.ui.shellMetrics.cardRadius),
      )
      FilledIconButton(onClick = { ask(question) }, enabled = question.isNotBlank() && !busy, modifier = Modifier.testTag("assist-send").semantics { contentDescription = "Send" }) {
        Icon(AglynIcons.named("send"), null)
      }
    }
    Text(
      "Questions are free; builds and edits use credits.",
      style = MaterialTheme.typography.labelSmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.padding(start = space(2f), end = space(2f), bottom = space(1f)),
    )
  }
}

/**
 * Home's "Needs you" line for AI (`ai.needs-you`): jobs that finished in the last day and jobs waiting on the person's
 * input or review, the one job when there is one, else AI jobs.
 */
@Composable
fun AiNeedsYouWidget(context: NativePluginContext) {
  val orgId = context.orgId ?: return
  val hostId = context.hostId ?: return
  var jobs by remember(orgId, hostId) { mutableStateOf<Live<List<JsonObject>>>(Live.Loading) }
  LaunchedEffect(orgId, hostId) {
    jobs = runCatching {
      val answer = context.api.request("/api/ai/jobs", ApiMethod.GET, query = mapOf("orgId" to orgId, "hostId" to hostId, "limit" to 20)) as? JsonObject
      Live.Ready((answer?.get("jobs") as? JsonArray).orEmpty().mapNotNull { it as? JsonObject })
    }.getOrElse { Live.Failed(it) }
  }
  val rows = (jobs as? Live.Ready)?.value ?: return
  val dayAgo = com.aglyn.core.nowMillis() - 24 * 60 * 60 * 1000L
  fun at(job: JsonObject) = job.str("updatedAt")?.let { com.aglyn.core.isoInstantMillis(it) } ?: 0L
  val waiting = rows.filter { it.str("status") in setOf("needs_input", "needs_review") }
  val finished = rows.filter { it.str("status") == "done" && at(it) >= dayAgo }
  fun open(list: List<JsonObject>) {
    val only = list.singleOrNull()?.str("id")
    if (only != null) context.navigate("ai.job", mapOf("jobId" to only)) else context.navigate("ai.jobs")
  }
  if (waiting.isNotEmpty()) {
    val one = waiting.singleOrNull()?.str("brief")
    NeedsYouLine(
      "ai-waiting", "auto_awesome",
      one?.let { "AI is waiting on you: $it" } ?: "${waiting.size} AI jobs are waiting on you", "AI jobs",
      onClick = { open(waiting) }, tone = StatusTone.WARNING,
    )
  }
  if (finished.isNotEmpty()) {
    val one = finished.singleOrNull()?.str("brief")
    NeedsYouLine(
      "ai-finished", "auto_awesome",
      one?.let { "AI finished: $it" } ?: "${finished.size} AI jobs finished today", "AI jobs",
      onClick = { open(finished) },
    )
  }
}
