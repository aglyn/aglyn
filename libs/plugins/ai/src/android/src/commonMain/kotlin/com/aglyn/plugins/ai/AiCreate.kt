package com.aglyn.plugins.ai

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.ListCreateZone
import com.aglyn.pluginhost.LocalSlotPlacement
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.SlotPlacement
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.CountedTextField
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlin.time.TimeSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put

/** The screen Create with AI opens: the brief, then the job it started, followed live. */
const val AI_CREATE_SCREEN = "ai.create"

/** How often a moving job is read again; the console follows the job's event stream, which the apps poll instead. */
const val AI_CREATE_POLL_MILLIS = 2500L

/** How long a list's door answer is reused before it is asked again. */
private const val AI_CREATE_DOOR_MILLIS = 30_000L

/** The lists Create with AI sits on, beside their own create action, and the zone each hosts (the console's names). */
enum class AiCreateKind(val key: String, val slot: String) {
  PAGE("page", ListCreateZone.PAGES),
  TEMPLATE("template", ListCreateZone.TEMPLATES),
  LAYOUT("layout", ListCreateZone.LAYOUTS),
  FORM("form", ListCreateZone.FORMS),
  COMPONENT("component", ListCreateZone.COMPONENTS),
  ;

  /** The entry's widget id, as plugins.config.json declares it. */
  val widgetId: String get() = "ai.create-$key"

  companion object {
    fun of(key: String?): AiCreateKind? = entries.firstOrNull { it.key == key }
  }
}

// ── What the door and the follow view answer ─────────────────────────────

private fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull
private fun JsonElement?.bool(): Boolean = (this as? JsonPrimitive)?.booleanOrNull ?: false
private fun JsonElement?.obj(): JsonObject? = this as? JsonObject
private fun JsonElement?.list(): List<JsonElement> = (this as? JsonArray).orEmpty()

/** `/api/ai/create`: whether a list draws Create with AI, as what, and every word its brief says. */
data class AiCreateDoor(
  val kind: String,
  val door: String,
  val label: String,
  val copy: Copy?,
  val briefMaxChars: Int,
  val choices: List<Choice>,
  val collections: Collections?,
  val credits: Credits?,
  val building: String?,
  val upsell: Upsell?,
) {
  data class Copy(val title: String, val briefLabel: String, val placeholder: String, val next: String, val submit: String, val started: String, val failed: String)
  data class Option(val id: String, val label: String)
  data class Choice(val key: String, val label: String, val required: Boolean, val options: List<Option>)
  data class CollectionOption(val id: String, val name: String)
  data class Collections(val `when`: String, val label: String, val options: List<CollectionOption>, val helper: String)
  data class Credits(val text: String, val exhausted: Boolean)
  data class Upsell(val title: String, val does: String, val offer: String, val canManageBilling: Boolean, val action: String?, val dismiss: String)

  val drawn: Boolean get() = door == "create" || door == "upsell"
}

/** The door's answer, or null when it is not one. */
fun aiCreateDoorOf(json: JsonElement?): AiCreateDoor? {
  val o = json.obj() ?: return null
  val kind = o["kind"].str() ?: return null
  val door = o["door"].str() ?: return null
  val copy = o["copy"].obj()?.let { c ->
    AiCreateDoor.Copy(
      c["title"].str().orEmpty(), c["briefLabel"].str().orEmpty(), c["placeholder"].str().orEmpty(), c["next"].str().orEmpty(),
      c["submit"].str().orEmpty(), c["started"].str().orEmpty(), c["failed"].str().orEmpty(),
    )
  }
  return AiCreateDoor(
    kind = kind,
    door = door,
    label = o["label"].str() ?: "Create with AI",
    copy = copy,
    briefMaxChars = (o["briefMaxChars"] as? JsonPrimitive)?.intOrNull ?: 4_000,
    choices = o["choices"].list().mapNotNull { it.obj() }.map { c ->
      AiCreateDoor.Choice(
        c["key"].str().orEmpty(), c["label"].str().orEmpty(), c["required"].bool(),
        c["options"].list().mapNotNull { it.obj() }.map { AiCreateDoor.Option(it["id"].str().orEmpty(), it["label"].str().orEmpty()) },
      )
    },
    collections = o["collections"].obj()?.let { c ->
      AiCreateDoor.Collections(
        c["when"].str().orEmpty(), c["label"].str().orEmpty(),
        c["options"].list().mapNotNull { it.obj() }.map { AiCreateDoor.CollectionOption(it["id"].str().orEmpty(), it["name"].str().orEmpty()) },
        c["helper"].str().orEmpty(),
      )
    },
    credits = o["credits"].obj()?.let { AiCreateDoor.Credits(it["text"].str().orEmpty(), it["exhausted"].bool()) },
    building = o["building"].str(),
    upsell = o["upsell"].obj()?.let { u ->
      AiCreateDoor.Upsell(
        u["title"].str().orEmpty(), u["does"].str().orEmpty(), u["offer"].str().orEmpty(), u["canManageBilling"].bool(),
        u["action"].str(), u["dismiss"].str() ?: "Close",
      )
    },
  )
}

/** `/api/ai/create/:jobId`: the job as the console's follow card reads it. */
data class AiFollowView(
  val id: String,
  val kind: String,
  val status: String,
  val hostId: String?,
  val phase: String,
  val phaseLabel: String,
  val tone: StatusTone,
  val line: String,
  val moving: Boolean,
  val settled: Boolean,
  val steps: String?,
  val planHeading: String?,
  val planLines: List<String>,
  val findings: List<String>,
  val detail: String?,
  val estimate: String?,
  val retryRefusal: String?,
  val confirmLabel: String?,
  val confirmEnabled: Boolean,
  val building: String?,
  val problem: String?,
  val spent: String?,
  val open: Open?,
) {
  data class Open(val label: String, val detail: String, val besigner: String?)
}

private fun toneOf(name: String?): StatusTone = when (name) {
  "success" -> StatusTone.SUCCESS
  "warning" -> StatusTone.WARNING
  "error" -> StatusTone.ERROR
  else -> StatusTone.INFO
}

/** The follow route's answer (`{ job, view }`), read for its view; null when it is not one. */
fun aiFollowViewOf(json: JsonElement?): AiFollowView? {
  val v = json.obj()?.get("view").obj() ?: return null
  val line = v["line"].obj()
  val plan = v["plan"].obj()
  val confirm = v["confirm"].obj()
  return AiFollowView(
    id = v["id"].str() ?: return null,
    kind = v["kind"].str().orEmpty(),
    status = v["status"].str().orEmpty(),
    hostId = v["hostId"].str(),
    phase = v["phase"].str().orEmpty(),
    phaseLabel = v["phaseLabel"].str().orEmpty(),
    tone = toneOf(line?.get("tone").str()),
    line = line?.get("text").str().orEmpty(),
    moving = v["moving"].bool(),
    settled = v["settled"].bool(),
    steps = v["steps"].str(),
    planHeading = plan?.get("heading").str(),
    planLines = plan?.get("lines").list().mapNotNull { it.str() },
    findings = v["findings"].list().mapNotNull { it.str() },
    detail = v["detail"].str(),
    estimate = v["estimate"].str(),
    retryRefusal = v["retryRefusal"].str(),
    confirmLabel = confirm?.get("label").str(),
    confirmEnabled = confirm?.get("enabled").bool() ?: false,
    building = v["building"].str(),
    problem = v["problem"].str(),
    spent = v["spent"].str(),
    open = v["open"].obj()?.let { o ->
      val detail = o["detail"].str() ?: return@let null
      AiFollowView.Open(o["label"].str().orEmpty(), detail, o["besigner"].str())
    },
  )
}

// ── The request the brief sends ──────────────────────────────────────────

/**
 * The job's `inputs` for what was picked, or null while a required pick is missing (the console's `aiBriefJobInputs`):
 * a page's optional type, a template's required subject and, for a collection entry's page, its collection.
 */
fun aiCreateInputs(door: AiCreateDoor, picks: Map<String, String>, collectionId: String?): Map<String, String>? {
  val inputs = linkedMapOf<String, String>()
  for (choice in door.choices) {
    val picked = picks[choice.key]
    if (picked != null && choice.options.any { it.id == picked }) {
      inputs[choice.key] = picked
    } else if (choice.required) {
      return null
    }
  }
  val collections = door.collections
  if (collections != null && picks["subject"] == collections.`when`) {
    if (collectionId == null || collections.options.none { it.id == collectionId }) return null
    inputs["collectionId"] = collectionId
  }
  return inputs
}

/** The body `POST /api/ai/jobs` takes, as the console's dialog sends it. */
fun aiCreateJobBody(orgId: String, hostId: String, kind: AiCreateKind, brief: String, inputs: Map<String, String>): JsonObject =
  buildJsonObject {
    put("orgId", orgId)
    put("hostId", hostId)
    put("kind", kind.key)
    put("brief", brief.trim())
    put("inputs", buildJsonObject { inputs.forEach { (key, value) -> put(key, value) } })
  }

/** The brief as the box keeps it: never past the door's limit. */
fun aiCreateClamped(brief: String, max: Int): String = if (brief.length > max) brief.take(max) else brief

/** Whether a refusal is the month's credits running out (the jobs ladder's `reason: quota`, a 402 or a 429). */
fun aiCreateOutOfCredits(error: Throwable): Boolean {
  if (error !is ConsoleApiError || (error.status != 402 && error.status != 429)) return false
  val reason = error.body.obj()?.get("reason").str()
  return if (reason != null) reason == "quota" else error.status == 402
}

// ── The door, read once per list ─────────────────────────────────────────

/** The door answers lists read, kept briefly so a list's header and its empty state ask once. */
object AiCreateDoors {
  private val answers = HashMap<String, Pair<TimeSource.Monotonic.ValueTimeMark, AiCreateDoor>>()

  suspend fun door(context: NativePluginContext, kind: AiCreateKind, fresh: Boolean = false): AiCreateDoor? {
    val orgId = context.orgId ?: return null
    val hostId = context.hostId ?: return null
    val key = "$orgId/$hostId/${kind.key}"
    val kept = answers[key]
    if (!fresh && kept != null && kept.first.elapsedNow().inWholeMilliseconds < AI_CREATE_DOOR_MILLIS) return kept.second
    val door = aiCreateDoorOf(
      context.api.request("/api/ai/create", ApiMethod.GET, query = mapOf("orgId" to orgId, "hostId" to hostId, "kind" to kind.key)),
    ) ?: return null
    answers[key] = TimeSource.Monotonic.markNow() to door
    return door
  }
}

/**
 * The job a create screen was following when it opened something on top of itself (the draft, the Besigner, AI jobs,
 * credits). The shell disposes a screen that is not on top, so coming back would otherwise show an empty brief: the
 * screen takes its job back from here. A list's entry clears it, so a new Create with AI starts from a new brief.
 */
object AiCreateFollowed {
  private val leaving = HashMap<String, String>()

  fun leave(key: String, jobId: String) {
    leaving[key] = jobId
  }

  fun take(key: String): String? = leaving.remove(key)

  fun forget(key: String) {
    leaving.remove(key)
  }
}

private fun followKey(context: NativePluginContext, kind: AiCreateKind?) = "${context.orgId}/${context.hostId}/${kind?.key}"

// ── The entry beside a list's create action ──────────────────────────────

/**
 * "Create with AI" in a list's zone (the console's `ai-describe-*` widgets): drawn where the door says, opening the
 * brief, or the add-on's offer on a plan that could buy it. An icon in a list's crowded header, a button in its empty state.
 */
@Composable
fun AiCreateButton(context: NativePluginContext, kind: AiCreateKind) {
  val placement = LocalSlotPlacement.current
  val key = "${context.orgId}/${context.hostId}/${kind.key}"
  var door by remember(key) { mutableStateOf<AiCreateDoor?>(null) }
  LaunchedEffect(key) {
    door = try {
      AiCreateDoors.door(context, kind)
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      null
    }
  }
  val shown = door?.takeIf { it.drawn } ?: return
  val open = {
    AiCreateFollowed.forget(followKey(context, kind))
    context.navigate(AI_CREATE_SCREEN, mapOf("kind" to kind.key))
  }
  if (placement == SlotPlacement.HEADER) {
    FilledTonalIconButton(
      onClick = open,
      modifier = Modifier.testTag("ai-create-${kind.key}").semantics { contentDescription = shown.label },
    ) { Icon(AglynIcons.named("auto_awesome"), contentDescription = shown.label) }
  } else {
    OutlinedButton(onClick = open, modifier = Modifier.testTag("ai-create-${kind.key}")) {
      Icon(AglynIcons.named("auto_awesome"), contentDescription = null)
      Text(shown.label, Modifier.padding(start = space(1f)))
    }
  }
}

// ── The brief, then the job ──────────────────────────────────────────────

/**
 * Create with AI (the console's brief dialog and its follow card): one question and its box, the kind's chips, the
 * month's credits, then the job it started — planning, the plan with its estimated cost and Confirm, building, and the
 * draft to open, in its native page or in the Besigner. Starting, confirming and canceling are the console's own
 * requests. Leaving stops following; the job carries on in AI jobs.
 */
@Composable
fun AiCreateScreen(context: NativePluginContext, kind: AiCreateKind?, initialJobId: String?, initialBrief: String? = null) {
  val scope = rememberCoroutineScope()
  var door by remember { mutableStateOf<AiCreateDoor?>(null) }
  var loadError by remember { mutableStateOf<String?>(null) }
  // Home's one-line prompt hands over what was typed; nothing starts until it is sent from here.
  var brief by remember { mutableStateOf(initialBrief.orEmpty()) }
  val picks = remember { mutableStateMapOf<String, String>() }
  var collectionId by remember { mutableStateOf<String?>(null) }
  var busy by remember { mutableStateOf(false) }
  var notice by remember { mutableStateOf<String?>(null) }
  var outOfCredits by remember { mutableStateOf(false) }
  val followed = remember { followKey(context, kind) }
  var jobId by remember { mutableStateOf(initialJobId ?: AiCreateFollowed.take(followed)) }
  var view by remember { mutableStateOf<AiFollowView?>(null) }
  var following by remember { mutableStateOf<Job?>(null) }
  DisposableEffect(Unit) { onDispose { following?.cancel() } }

  suspend fun loadDoor(fresh: Boolean) {
    loadError = null
    if (kind == null) {
      loadError = "Create with AI needs a list to create into."
      return
    }
    try {
      door = AiCreateDoors.door(context, kind, fresh) ?: run {
        loadError = "Pick a site first."
        null
      }
    } catch (error: Throwable) {
      if (error is CancellationException) throw error
      loadError = (error as? ConsoleApiError)?.message ?: "Create with AI could not be loaded. Try again."
    }
  }

  /** Reads the job now, then again on a short beat while it moves. */
  fun follow(id: String) {
    following?.cancel()
    following = scope.launch {
      val orgId = context.orgId ?: return@launch
      while (true) {
        val next = try {
          aiFollowViewOf(context.api.request("/api/ai/create/$id", ApiMethod.GET, query = mapOf("orgId" to orgId)))
        } catch (error: Throwable) {
          if (error is CancellationException) throw error
          if (view == null) notice = (error as? ConsoleApiError)?.message ?: "The job could not be read. Try again."
          null
        }
        if (next != null) {
          view = next
          if (!next.moving) break
        }
        delay(AI_CREATE_POLL_MILLIS)
      }
    }
  }

  fun start(current: AiCreateDoor, copy: AiCreateDoor.Copy) {
    val createKind = kind ?: return
    val orgId = context.orgId ?: return
    val hostId = context.hostId ?: return
    val inputs = aiCreateInputs(current, picks, collectionId) ?: return
    busy = true
    notice = null
    outOfCredits = false
    scope.launch {
      try {
        val answer = context.api.request("/api/ai/jobs", ApiMethod.POST, aiCreateJobBody(orgId, hostId, createKind, brief, inputs))
        val id = answer.obj()?.get("job").obj()?.get("id").str()
        if (id == null) {
          notice = copy.failed
        } else {
          brief = ""
          picks.clear()
          collectionId = null
          jobId = id
          follow(id)
        }
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        outOfCredits = aiCreateOutOfCredits(error)
        notice = (error as? ConsoleApiError)?.message ?: copy.failed
      } finally {
        busy = false
      }
    }
  }

  /** Confirm the plan (or try a refused step again), or cancel: the same requests the console's follow card sends. */
  fun decide(id: String, cancel: Boolean) {
    val orgId = context.orgId ?: return
    busy = true
    notice = null
    scope.launch {
      try {
        val body = buildJsonObject {
          put("orgId", orgId)
          if (!cancel) (view?.hostId ?: context.hostId)?.let { put("hostId", it) }
        }
        context.api.request("/api/ai/jobs/$id/${if (cancel) "cancel" else "resume"}", ApiMethod.POST, body)
      } catch (error: Throwable) {
        if (error is CancellationException) throw error
        notice = (error as? ConsoleApiError)?.message
          ?: if (cancel) "The job could not be canceled — try again." else "The job could not be resumed — try again."
      } finally {
        busy = false
      }
      follow(id)
    }
  }

  LaunchedEffect(Unit) {
    // The door's words frame a followed job too (its title and what was started).
    jobId?.let { follow(it) }
    loadDoor(false)
  }

  @Composable
  fun CreditActions() {
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedButton(onClick = { context.navigate("ai.credits") }, modifier = Modifier.testTag("ai-create-credits")) { Text("AI credits") }
      OutlinedButton(onClick = { context.navigate("core.billing.plans") }, modifier = Modifier.testTag("ai-create-billing")) { Text("Plans and billing") }
    }
  }

  Box(Modifier.fillMaxSize().testTag("ai-create"), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = com.aglyn.ui.paneInset(), vertical = space(2f)),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      val currentJob = jobId
      val current = door
      when {
        currentJob != null -> FollowSections(
          context, currentJob, current?.copy, view, busy, notice,
          onLeave = { AiCreateFollowed.leave(followed, currentJob) },
          onConfirm = { decide(currentJob, cancel = false) },
          onCancel = { decide(currentJob, cancel = true) },
        )
        loadError != null -> SectionCard(null) {
          NoticeBanner(loadError.orEmpty(), StatusTone.ERROR)
          TextButton(onClick = { scope.launch { loadDoor(true) } }) { Text("Try again") }
        }
        current == null -> SkeletonList(rows = 4)
        current.door == "upsell" && current.upsell != null -> {
          val upsell = current.upsell
          // The console's AiUpsellDialog as the add-on's promo card (Figma Promo/Add-on card 121:18655): its title, what the
          // entry does, the offer, then the dismissal (Close for a member who cannot buy it) and the add-on's action.
          com.aglyn.ui.AddOnPromoCard(
            title = upsell.title,
            does = upsell.does,
            offer = upsell.offer,
            dismissTitle = upsell.dismiss,
            actionTitle = upsell.action,
            onDismiss = { context.back() },
            onAction = { context.navigate("core.billing.addons") },
          )
        }
        current.door == "create" && current.copy != null -> {
          val copy = current.copy
          Text(copy.title, style = MaterialTheme.typography.titleLarge)
          current.credits?.let { credits ->
            NoticeBanner(credits.text, if (credits.exhausted) StatusTone.WARNING else StatusTone.INFO)
            if (credits.exhausted) CreditActions()
          }
          CountedTextField(
            label = copy.briefLabel,
            value = brief,
            onValue = { brief = aiCreateClamped(it, current.briefMaxChars) },
            modifier = Modifier.testTag("ai-create-brief"),
            max = current.briefMaxChars,
            multiline = true,
            minLines = 4,
            enabled = !busy,
            placeholder = copy.placeholder,
          )
          current.choices.forEach { choice ->
            Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
              Text(choice.label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
              FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
                choice.options.forEach { option ->
                  val selected = picks[choice.key] == option.id
                  FilterChip(
                    selected = selected,
                    enabled = !busy,
                    onClick = {
                      // An optional pick clears when pressed again; a required one stays.
                      if (selected) {
                        if (!choice.required) picks.remove(choice.key)
                      } else {
                        picks[choice.key] = option.id
                      }
                    },
                    label = { Text(option.label) },
                    modifier = Modifier.testTag("ai-create-${choice.key}-${option.id}"),
                  )
                }
              }
            }
          }
          val collections = current.collections
          if (collections != null && picks["subject"] == collections.`when`) {
            SelectField(
              label = collections.label,
              options = collections.options.map { SelectOption(it.id, it.name) },
              selected = collectionId,
              onSelect = { collectionId = it },
              modifier = Modifier.fillMaxWidth().testTag("ai-create-collection"),
              enabled = !busy && collections.options.isNotEmpty(),
              noneLabel = "Pick a collection",
              supporting = collections.helper,
            )
          }
          Text(copy.next, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          current.building?.let { NoticeBanner(it, StatusTone.INFO) }
          notice?.let {
            NoticeBanner(it, StatusTone.WARNING)
            // Where more credits come from, unless the credits line above already offers it.
            if (outOfCredits && current.credits?.exhausted != true) CreditActions()
          }
          Button(
            onClick = { start(current, copy) },
            enabled = !busy && brief.isNotBlank() && aiCreateInputs(current, picks, collectionId) != null,
            modifier = Modifier.fillMaxWidth().testTag("ai-create-submit"),
          ) {
            if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            Text(copy.submit, Modifier.padding(start = if (busy) space(1f) else 0.dp))
          }
        }
        else -> EmptyState(
          "Create with AI is not available here",
          body = "Your role, your plan or this site’s settings do not include it.",
          icon = AglynIcons.named("auto_awesome"),
        )
      }
    }
  }
}

@Composable
private fun FollowSections(
  context: NativePluginContext,
  jobId: String,
  copy: AiCreateDoor.Copy?,
  view: AiFollowView?,
  busy: Boolean,
  notice: String?,
  onLeave: () -> Unit,
  onConfirm: () -> Unit,
  onCancel: () -> Unit,
) {
  copy?.let {
    Text(it.title, style = MaterialTheme.typography.titleLarge)
    Text(it.started, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
  if (view == null) {
    if (notice != null) NoticeBanner(notice, StatusTone.WARNING) else SkeletonList(rows = 3)
  } else {
    SectionCard(null, Modifier.fillMaxWidth().testTag("ai-create-phase")) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        if (view.moving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        StatusChip(view.phaseLabel, view.tone)
        view.steps?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      }
      NoticeBanner(view.line, view.tone)
      view.spent?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      view.open?.let { open ->
        Button(
          onClick = {
            onLeave()
            context.openLink(open.detail)
          },
          modifier = Modifier.fillMaxWidth().testTag("ai-create-open"),
        ) { Text(open.label) }
        open.besigner?.let { path ->
          OutlinedButton(
            onClick = {
              onLeave()
              context.openBesigner(path, ConsoleScope.ABSOLUTE)
            },
            modifier = Modifier.fillMaxWidth().testTag("ai-create-besigner"),
          ) { Text("Edit in the Besigner") }
        }
      }
    }
    if (view.planHeading != null) {
      SectionCard(view.planHeading, Modifier.fillMaxWidth().testTag("ai-create-plan")) {
        view.planLines.forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
        view.estimate?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      }
    }
    if (view.findings.isNotEmpty() || view.detail != null) {
      SectionCard("Building rules broken", Modifier.fillMaxWidth()) {
        view.findings.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
        view.detail?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      }
    }
    if (view.confirmLabel != null || !view.settled) {
      Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
        view.retryRefusal?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        view.building?.let { NoticeBanner(it, StatusTone.INFO) }
        notice?.let { NoticeBanner(it, StatusTone.WARNING) }
        view.confirmLabel?.let { label ->
          Button(
            onClick = onConfirm,
            enabled = !busy && view.confirmEnabled,
            modifier = Modifier.fillMaxWidth().testTag("ai-create-confirm"),
          ) { Text(label) }
        }
        if (!view.settled) {
          TextButton(onClick = onCancel, enabled = !busy, modifier = Modifier.testTag("ai-create-cancel")) {
            Text("Cancel job", color = MaterialTheme.colorScheme.error)
          }
        }
      }
    }
  }
  TextButton(
    onClick = {
      onLeave()
      context.navigate("ai.job", mapOf("jobId" to jobId))
    },
    modifier = Modifier.testTag("ai-create-jobs"),
  ) {
    Text("Open AI jobs")
  }
}
