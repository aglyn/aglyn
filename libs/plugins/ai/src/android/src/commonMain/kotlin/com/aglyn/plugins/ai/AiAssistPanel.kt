package com.aglyn.plugins.ai

import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ButtonDefaults
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp
import com.aglyn.screens.ScreenValues
import com.aglyn.ui.LocalAccent
import com.aglyn.ui.LocalAglynPalette
import com.aglyn.ui.LocalThemeSurfaces
import com.aglyn.ui.radius
import com.aglyn.ui.shellMetrics
import com.aglyn.ui.space
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
      // The footer's parenthesis (Figma 273:20323): "(1,240 left this month)".
      when {
        (answer?.get("unlimited") as? JsonPrimitive)?.contentOrNull == "true" -> "(not capped on this workspace)"
        standing != null -> "(${ScreenValues.grouped(standing.str("remaining")?.toDoubleOrNull() ?: 0.0)} left this month)"
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

  val m = if (shellMetrics.compact) CompactAssist else TouchAssist
  val canSend = question.isNotBlank() && !busy
  val hairline = MaterialTheme.colorScheme.outlineVariant
  Column(Modifier.fillMaxSize().testTag("assist-panel")) {
    looking?.takeIf { it.isNotBlank() }?.let { ContextChip(m, it, params["icon"]) }
    LazyColumn(
      Modifier.weight(1f).fillMaxWidth(),
      state = listState,
      contentPadding = PaddingValues(horizontal = m.edge, vertical = if (turns.isEmpty()) space(0f) else space(1f)),
      verticalArrangement = Arrangement.spacedBy(space(1.75f)),
    ) {
      itemsIndexed(turns) { i, turn ->
        TurnView(m, turn, typing = busy && i == turns.lastIndex, tag = "assist-turn-$i") { href -> context.openLink(href) }
      }
    }
    if (turns.isEmpty() || m.suggestionsStay) {
      val place = params["place"].orEmpty()
      Column(
        Modifier.fillMaxWidth().padding(start = m.edge, end = m.edge, top = space(0.75f)),
        verticalArrangement = Arrangement.spacedBy(m.suggestionGap),
      ) {
        Text(
          if (m.suggestionsStay && place.isNotEmpty()) "Suggestions for $place" else "Try",
          style = m.text(m.caption, m.captionWeight),
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        for (suggestion in assistSuggestions(route)) Suggestion(m, suggestion, enabled = !busy) { ask(suggestion) }
      }
    }
    quota?.let { q ->
      Text(
        "${q.remaining} of ${q.limit} free messages left ${if (q.period == "day") "today" else "this month"}",
        style = m.text(m.caption),
        color = assistTertiaryText(),
        modifier = Modifier.fillMaxWidth().padding(start = m.edge, end = m.edge, top = space(0.75f)).testTag("assist-quota"),
      )
    }
    // The field and its Send, and under them what questions and builds cost.
    Column(
      Modifier.fillMaxWidth().then(
        if (m.suggestionsStay) {
          // The desktop's composer sits on its own band under a hairline (Figma 18:540).
          Modifier.padding(top = space(0.75f)).drawBehind { drawLine(hairline, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }
            .padding(start = m.edge, end = m.edge, top = space(1.5f), bottom = space(1.75f))
        } else {
          Modifier.padding(start = m.edge, end = m.edge, top = space(0.75f), bottom = space(1.25f))
        },
      ),
      verticalArrangement = Arrangement.spacedBy(space(0.75f)),
    ) {
      Row(
        Modifier.fillMaxWidth().heightIn(min = m.composer)
          .background(assistSunken(), RoundedCornerShape(m.composerRadius))
          .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(m.composerRadius))
          .padding(start = m.composerLeading, end = space(0.75f)),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(space(1.25f)),
      ) {
        val prompt = params["scope"]?.takeIf { it.isNotBlank() }?.let { "Ask about $it" }
          ?: context.hostId?.let { "Ask about this site" } ?: "Ask about this workspace"
        val style = m.text(m.body).copy(color = MaterialTheme.colorScheme.onSurface)
        BasicTextField(
          question,
          onValueChange = { question = it },
          textStyle = style,
          maxLines = 4,
          cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
          keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
          keyboardActions = KeyboardActions(onSend = { ask(question) }),
          modifier = Modifier.weight(1f).padding(vertical = space(1f)).testTag("assist-field"),
          decorationBox = { field ->
            Box(contentAlignment = Alignment.CenterStart) {
              if (question.isEmpty()) Text(prompt, style = style, color = assistTertiaryText(), maxLines = 1, overflow = TextOverflow.Ellipsis)
              field()
            }
          },
        )
        // Send: the accent's fill with a white paper plane (Figma Send 273:20321).
        Box(
          Modifier.size(m.send).alpha(if (canSend) 1f else 0.4f).clip(RoundedCornerShape(m.sendRadius))
            .background(MaterialTheme.colorScheme.primary)
            .clickable(enabled = canSend, role = Role.Button) { ask(question) }
            .semantics { contentDescription = "Send" }
            .testTag("assist-send"),
          contentAlignment = Alignment.Center,
        ) {
          Icon(AglynIcons.named("send"), null, Modifier.size(m.sendIcon), tint = MaterialTheme.colorScheme.onPrimary)
        }
      }
      Text(
        listOfNotNull("Questions are free · builds and edits use credits", credits).joinToString(" "),
        style = m.text(m.caption),
        color = assistTertiaryText(),
        modifier = Modifier.testTag("assist-credits"),
      )
    }
  }
}

/** The panel's sizes, from Figma: one structure, two sets of numbers (the Apple panel's AssistMetrics, value for value). */
private class AssistMetrics(
  val chipText: TextUnit,
  val chipWeight: FontWeight,
  val chipPadding: PaddingValues,
  /** Questions, answers and the field. */
  val body: TextUnit,
  val suggestion: TextUnit,
  val suggestionIcon: Dp,
  val suggestionHeight: Dp,
  val suggestionPadding: Dp,
  val suggestionRadius: Dp,
  val suggestionGap: Dp,
  val suggestionIconGap: Dp,
  /** "Try" and the footer. */
  val caption: TextUnit,
  val captionWeight: FontWeight,
  val composer: Dp,
  val composerRadius: Dp,
  val composerLeading: Dp,
  val send: Dp,
  val sendRadius: Dp,
  val sendIcon: Dp,
  val bubbleRadius: Dp,
  val action: TextUnit,
  val actionHeight: Dp,
  val actionRadius: Dp,
  /** The desktop keeps its suggestions under the thread (18:485); a phone gives the thread the room once it starts. */
  val suggestionsStay: Boolean,
) {
  /** The one content edge: chip, thread, suggestions, field and footer all start and end on it. */
  val edge = space(2f)

  /** The brand face at a size (the theme's own family). */
  @Composable
  fun text(size: TextUnit, weight: FontWeight = FontWeight.Normal): TextStyle =
    MaterialTheme.typography.bodyMedium.copy(fontSize = size, fontWeight = weight, lineHeight = size * 1.34f)
}

/** Touch, on phones and tablets: Figma Android / Sheet / AI 273:20299 and iPhone / Sheet / AI 21:314. */
private val TouchAssist = AssistMetrics(
  chipText = 13.sp, chipWeight = FontWeight.Normal, chipPadding = PaddingValues(start = space(1.25f), end = space(1.5f), top = space(0.625f), bottom = space(0.625f)),
  body = 15.sp, suggestion = 15.sp, suggestionIcon = space(2f), suggestionHeight = space(5.75f), suggestionPadding = space(1.75f), suggestionRadius = radius(3f),
  suggestionGap = space(0.75f), suggestionIconGap = space(1.25f), caption = 13.sp, captionWeight = FontWeight.Normal, composer = space(6.5f), composerRadius = radius(3f),
  composerLeading = space(1.75f), send = space(5f), sendRadius = radius(2f), sendIcon = space(2f), bubbleRadius = radius(3f), action = 15.sp, actionHeight = space(4.5f),
  actionRadius = radius(2f), suggestionsStay = false,
)

/** Compact, on the desktop: Figma AI panel 18:485. */
private val CompactAssist = AssistMetrics(
  chipText = 12.sp, chipWeight = FontWeight.SemiBold, chipPadding = PaddingValues(start = space(1f), end = space(1.25f), top = space(0.5f), bottom = space(0.5f)),
  body = 14.sp, suggestion = 13.sp, suggestionIcon = space(1.75f), suggestionHeight = space(4.5f), suggestionPadding = space(1.25f), suggestionRadius = radius(1.5f),
  suggestionGap = space(1.75f), suggestionIconGap = space(1f), caption = 12.sp, captionWeight = FontWeight.SemiBold, composer = space(5.5f), composerRadius = radius(2.5f),
  composerLeading = space(1.5f), send = space(4f), sendRadius = radius(1.5f), sendIcon = space(1.75f), bubbleRadius = radius(2.5f), action = 13.sp, actionHeight = space(3.5f),
  actionRadius = radius(1.5f), suggestionsStay = true,
)

/** Captions and the field's placeholder: the theme's tertiary text. */
@Composable
private fun assistTertiaryText(): Color = LocalThemeSurfaces.current?.textTertiary ?: LocalAglynPalette.current.textDisabled

/** A recessed ground: the field, and your question in the thread. */
@Composable
private fun assistSunken(): Color = LocalThemeSurfaces.current?.sunken ?: MaterialTheme.colorScheme.surfaceVariant

/** The accent as an icon (3:1): the chip's and the suggestions' marks. */
@Composable
private fun assistAccentIcon(): Color = LocalAccent.current?.icon ?: MaterialTheme.colorScheme.primary

/** What the panel reads: the place's own icon and name on the accent's soft wash. */
@Composable
private fun ContextChip(m: AssistMetrics, looking: String, icon: String?) {
  Row(
    Modifier.padding(start = m.edge, end = m.edge, top = space(0.5f), bottom = space(0.75f))
      .background(LocalAccent.current?.soft ?: MaterialTheme.colorScheme.primaryContainer, CircleShape)
      .padding(m.chipPadding)
      .semantics(mergeDescendants = true) {}
      .testTag("assist-context"),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(space(0.75f)),
  ) {
    Icon(AglynIcons.named(icon?.takeIf { AglynIcons.has(it) } ?: "visibility"), null, Modifier.size(space(1.75f)), tint = assistAccentIcon())
    Text("Looking at: $looking", style = m.text(m.chipText, m.chipWeight), color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
  }
}

/** A question that fits the screen: an outlined card with ✦. */
@Composable
private fun Suggestion(m: AssistMetrics, text: String, enabled: Boolean, onClick: () -> Unit) {
  val shape = RoundedCornerShape(m.suggestionRadius)
  Row(
    Modifier.fillMaxWidth().heightIn(min = m.suggestionHeight).clip(shape)
      .border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)
      .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
      .padding(horizontal = m.suggestionPadding, vertical = space(0.75f))
      .testTag("assist-suggestion"),
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.spacedBy(m.suggestionIconGap),
  ) {
    Icon(AglynIcons.named("auto_awesome"), null, Modifier.size(m.suggestionIcon), tint = assistAccentIcon())
    Text(text, style = m.text(m.suggestion), color = MaterialTheme.colorScheme.onSurface)
  }
}

/** One turn: your question on the sunken fill, the answer as plain text, then what it points to as outlined buttons. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TurnView(m: AssistMetrics, turn: AssistTurn, typing: Boolean, tag: String, open: (String) -> Unit) {
  val mine = turn.role == "user"
  Column(
    Modifier.fillMaxWidth()
      .then(if (mine) Modifier.background(assistSunken(), RoundedCornerShape(m.bubbleRadius)).padding(horizontal = space(1.5f), vertical = space(1.25f)) else Modifier)
      .testTag(tag)
      .semantics { if (!mine) liveRegion = LiveRegionMode.Polite },
    verticalArrangement = Arrangement.spacedBy(space(1f)),
  ) {
    Text(turn.text.ifEmpty { if (typing) "…" else "" }, style = m.text(m.body), color = MaterialTheme.colorScheme.onSurface)
    if (turn.proposal != null || turn.docs.isNotEmpty()) {
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        turn.proposal?.let { (label, href) -> AssistAction(m, label, null, "assist-proposal") { open(href) } }
        turn.docs.forEach { (title, url) -> AssistAction(m, title, "article", "assist-doc") { open(url) } }
      }
    }
  }
}

/** An answer's next step or document: Figma Button, Secondary, Small (surface, border/strong, primary text), touch-sized on a phone. */
@Composable
private fun AssistAction(m: AssistMetrics, label: String, icon: String?, tag: String, onClick: () -> Unit) {
  androidx.compose.material3.OutlinedButton(
    onClick = onClick,
    modifier = Modifier.height(m.actionHeight).testTag(tag),
    shape = RoundedCornerShape(m.actionRadius),
    colors = ButtonDefaults.outlinedButtonColors(
      containerColor = LocalThemeSurfaces.current?.surface ?: MaterialTheme.colorScheme.surfaceContainerLowest,
      contentColor = MaterialTheme.colorScheme.onSurface,
    ),
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    contentPadding = PaddingValues(horizontal = space(1.25f)),
  ) {
    icon?.let { Icon(AglynIcons.named(it), null, Modifier.size(space(2f))); Spacer(Modifier.width(space(0.75f))) }
    Text(label, style = m.text(m.action, FontWeight.SemiBold), maxLines = 1, overflow = TextOverflow.Ellipsis)
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
