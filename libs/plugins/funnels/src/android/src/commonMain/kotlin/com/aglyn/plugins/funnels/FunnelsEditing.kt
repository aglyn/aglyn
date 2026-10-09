package com.aglyn.plugins.funnels

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.DropOffAction
import com.aglyn.contracts.FunnelDefinition
import com.aglyn.contracts.FunnelInventory
import com.aglyn.contracts.FunnelPageMatch
import com.aglyn.contracts.FunnelResult
import com.aglyn.contracts.FunnelStep
import com.aglyn.contracts.FunnelStepInput
import com.aglyn.contracts.SiteJourneyStepType
import com.aglyn.contracts.labelStepFromInventory
import com.aglyn.contracts.normalizeFunnelDefinition
import com.aglyn.contracts.stepInventoryProblem
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.boolField
import com.aglyn.core.field
import com.aglyn.core.jsonBody
import com.aglyn.core.publishSiteWideChange
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

/** What a save or an activation answered: the funnel, and whether the site's recording switch moved. */
data class FunnelSaved(val funnelId: String, val recordingChanged: Boolean)

/** "Create with AI": a checked draft, and the steps it had to leave out. */
data class FunnelProposal(val draft: FunnelDefinition, val dropped: List<String>)

/** The automation "Act on this drop-off" drafted, switched off. */
data class DropOffDrafted(val automationId: String, val name: String, val replayed: Boolean)

/** The plugin's console doors (`/api/funnels/…`), every one a POST naming the site. */
interface FunnelsApi {
  suspend fun inventory(): FunnelInventory
  suspend fun result(funnelId: String, from: String, to: String, fresh: Boolean): FunnelResult
  suspend fun save(funnel: FunnelDefinition, funnelId: String?): FunnelSaved
  suspend fun activate(funnelId: String): FunnelSaved
  suspend fun delete(funnelId: String): FunnelSaved
  suspend fun propose(brief: String): FunnelProposal
  suspend fun draftDropOff(funnelId: String, step: Int, afterHours: Int, action: DropOffAction): DropOffDrafted

  /** The published page reads the recording switch from the host document, so its cached pages are dropped. */
  suspend fun announceSiteWide()
}

class ConsoleFunnelsApi(
  private val api: ConsoleApiClient,
  private val writer: FirestoreWriter,
  private val hostId: String,
) : FunnelsApi {
  private suspend fun post(door: String, vararg fields: Pair<String, Any?>): JsonObject {
    val body = jsonBody("hostId" to hostId, *fields)
    return api.request("/api/funnels/$door", ApiMethod.POST, body)?.jsonObject
      ?: throw ConsoleApiError("Something went wrong. Try again.", 0, null)
  }

  private fun definitionJson(funnel: FunnelDefinition): JsonElement =
    ContractJsonFormat.encodeToJsonElement(FunnelDefinition.serializer(), funnel)

  override suspend fun inventory(): FunnelInventory =
    ContractJsonFormat.decodeFromJsonElement(FunnelInventory.serializer(), post("inventory").getValue("inventory"))

  override suspend fun result(funnelId: String, from: String, to: String, fresh: Boolean): FunnelResult =
    ContractJsonFormat.decodeFromJsonElement(FunnelResult.serializer(), post("results", "funnelId" to funnelId, "from" to from, "to" to to, "fresh" to fresh).getValue("result"))

  override suspend fun save(funnel: FunnelDefinition, funnelId: String?): FunnelSaved {
    val fields = buildList<Pair<String, Any?>> {
      add("funnel" to definitionJson(funnel))
      if (funnelId != null) add("funnelId" to funnelId)
    }
    val answer = post("save", *fields.toTypedArray())
    return FunnelSaved(answer.field("funnelId") ?: funnelId.orEmpty(), answer.boolField("recordingChanged") == true)
  }

  override suspend fun activate(funnelId: String): FunnelSaved {
    val answer = post("activate", "funnelId" to funnelId)
    return FunnelSaved(funnelId, answer.boolField("recordingChanged") == true)
  }

  override suspend fun delete(funnelId: String): FunnelSaved {
    val answer = post("delete", "funnelId" to funnelId)
    return FunnelSaved(funnelId, answer.boolField("recordingChanged") == true)
  }

  override suspend fun propose(brief: String): FunnelProposal {
    val answer = post("propose", "brief" to brief)
    val draft = ContractJsonFormat.decodeFromJsonElement(FunnelDefinition.serializer(), answer.getValue("draft"))
    val dropped = (answer["dropped"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
    return FunnelProposal(draft, dropped)
  }

  override suspend fun draftDropOff(funnelId: String, step: Int, afterHours: Int, action: DropOffAction): DropOffDrafted {
    val answer = post("act", "funnelId" to funnelId, "step" to step, "afterHours" to afterHours, "action" to action.raw)
    return DropOffDrafted(answer.field("automationId").orEmpty(), answer.field("name").orEmpty(), answer.boolField("replayed") == true)
  }

  override suspend fun announceSiteWide() = publishSiteWideChange(api, writer, hostId)
}

/** One step as the editor holds it: what is typed, before any check. */
data class StepDraft(
  val type: SiteJourneyStepType = SiteJourneyStepType.PAGE,
  val key: String = "",
  val match: FunnelPageMatch = FunnelPageMatch.EXACT,
  val label: String = "",
) {
  fun toInput() = FunnelStepInput(type.raw, key, match.raw, label)

  companion object {
    fun of(step: FunnelStep) = StepDraft(step.type, step.key, step.match ?: FunnelPageMatch.EXACT, step.label.orEmpty())
  }
}

/** The funnel editor's draft: a name and its steps. [id] is null for a new funnel. */
data class FunnelDraft(val id: String? = null, val name: String = "", val steps: List<StepDraft> = emptyList()) {
  companion object {
    fun of(row: FunnelRow) = FunnelDraft(row.id, row.name, row.steps.map(StepDraft::of))
    fun of(definition: FunnelDefinition, id: String? = null) = FunnelDraft(id, definition.name, definition.steps.map(StepDraft::of))
  }
}

/**
 * What a new step starts on, as the console editor's `blankStep` does: the
 * site's first page for a page step, the email open for an email step, and
 * "any" of the kind for the rest.
 */
fun starterStep(type: SiteJourneyStepType, inventory: FunnelInventory?): StepDraft = when (type) {
  SiteJourneyStepType.PAGE -> StepDraft(type, inventory?.pages?.firstOrNull() ?: "/", FunnelPageMatch.EXACT)
  SiteJourneyStepType.EMAIL -> StepDraft(type, "opened")
  else -> StepDraft(type, "")
}

/** The Funnels screen's state for one site: the editor, the row actions and the dialogs. */
class FunnelsEditor(private val api: FunnelsApi, private val scope: CoroutineScope) {
  var draft by mutableStateOf<FunnelDraft?>(null)
    private set
  var inventory by mutableStateOf<FunnelInventory?>(null)
    private set
  var deleting by mutableStateOf<FunnelRow?>(null)
    private set
  var proposing by mutableStateOf(false)
    private set
  var dropOff by mutableStateOf<DropOffRequest?>(null)
    private set
  var busy by mutableStateOf(false)
    private set
  var error by mutableStateOf<String?>(null)
    private set

  /** What just happened, or what the person can open next. */
  var notice by mutableStateOf<String?>(null)

  /** Bumped when a result should be read again, so a view refreshes. */
  var refreshKey by mutableStateOf(0)
    private set

  /** Whether the next result read skips the server's short cache. */
  val fresh: Boolean get() = refreshKey > 0

  fun refresh() {
    refreshKey += 1
  }

  fun resetRefresh() {
    refreshKey = 0
  }

  /** Loads the site's inventory once; the editor opens when it is in hand. */
  private suspend fun loadedInventory(): FunnelInventory = inventory ?: api.inventory().also { inventory = it }

  fun add() = open(FunnelDraft())

  fun edit(row: FunnelRow) = open(FunnelDraft.of(row))

  /** The editor opened on a proposal, as "Create with AI" does. */
  private fun openProposal(proposal: FunnelProposal) {
    draft = FunnelDraft.of(proposal.draft)
    notice = proposal.dropped.takeIf { it.isNotEmpty() }?.let { "Left out, because the site has no match: ${it.joinToString("; ")}" }
  }

  private fun open(next: FunnelDraft) {
    error = null
    run {
      val known = loadedInventory()
      draft = if (next.id == null && next.steps.isEmpty()) {
        next.copy(steps = listOf(starterStep(SiteJourneyStepType.PAGE, known), starterStep(SiteJourneyStepType.FORM, known)))
      } else {
        next
      }
    }
  }

  fun change(next: FunnelDraft) {
    draft = next
  }

  fun askDelete(row: FunnelRow) {
    error = null
    deleting = row
  }

  fun askPropose() {
    error = null
    proposing = true
  }

  fun askDropOff(request: DropOffRequest) {
    error = null
    dropOff = request
  }

  fun close() {
    if (busy) return
    draft = null
    deleting = null
    proposing = false
    dropOff = null
  }

  /** The save the card makes: the console's own checks first, then the door's. */
  fun save() {
    val asked = draft ?: return
    run {
      val check = normalizeFunnelDefinition(asked.name, asked.steps.map(StepDraft::toInput))
      val funnel = check.funnel
      if (funnel == null) {
        error = check.error
        return@run
      }
      val known = loadedInventory()
      funnel.steps.forEachIndexed { index, step ->
        stepInventoryProblem(step, known)?.let {
          error = "Step ${index + 1}: $it"
          return@run
        }
      }
      val labelled = funnel.copy(steps = funnel.steps.map { labelStepFromInventory(it, known) })
      val saved = api.save(labelled, asked.id)
      if (saved.recordingChanged) api.announceSiteWide()
      draft = null
      notice = "${labelled.name} saved."
      resetRefresh()
    }
  }

  fun activate(row: FunnelRow) = run {
    val activated = api.activate(row.id)
    if (activated.recordingChanged) api.announceSiteWide()
    notice = "${row.name} is live. It is measured from now on."
  }

  fun confirmDelete() {
    val row = deleting ?: return
    run {
      val deleted = api.delete(row.id)
      if (deleted.recordingChanged) api.announceSiteWide()
      deleting = null
      notice = "${row.name} and its results are removed."
    }
  }

  fun propose(brief: String) {
    if (brief.isBlank()) {
      error = "Describe the funnel first."
      return
    }
    run {
      val proposal = api.propose(brief.trim())
      loadedInventory()
      proposing = false
      openProposal(proposal)
    }
  }

  fun draftDropOff(afterHours: Int, action: DropOffAction) {
    val request = dropOff ?: return
    run {
      val drafted = api.draftDropOff(request.funnelId, request.reachedStep, afterHours, action)
      dropOff = null
      notice = "${drafted.name} is drafted, switched off. Switch it on under Automation when it reads right."
    }
  }

  private fun run(block: suspend () -> Unit) {
    if (busy) return
    busy = true
    error = null
    scope.launch {
      try {
        block()
      } catch (failure: Throwable) {
        if (failure is CancellationException) throw failure
        error = when {
          failure is ConsoleApiError && failure.status != 0 -> failure.message
          else -> "That did not go through. Check the connection and try again."
        }
      } finally {
        busy = false
      }
    }
  }
}

/** "Act on this drop-off" asked of the step people reached (1-based), by name. */
data class DropOffRequest(val funnelId: String, val reachedStep: Int, val stepLabel: String, val nextStepLabel: String)

/** How many drop-off waits the card offers, from the contracts. */
fun dropOffWaits(): List<Int> = Contracts.dropOffWaitHours.map { it.toInt() }
