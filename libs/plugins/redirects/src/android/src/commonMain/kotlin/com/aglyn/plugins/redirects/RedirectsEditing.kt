package com.aglyn.plugins.redirects

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.FirestoreWriter
import com.aglyn.core.firestoreNow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

const val REDIRECT_CHECK_ROUTE = "/api/redirects/check"
const val HOST_RESOURCES_ROUTE = "/api/hosts/resources"
const val REVALIDATE_ROUTE = "/api/screens/revalidate"

/** The page's status codes, in its order, with what each means to a person. */
val REDIRECT_STATUS_CHOICES = listOf(
  301L to "301 Permanent",
  302L to "302 Temporary",
  307L to "307 Temporary, same method",
  308L to "308 Permanent, same method",
)

/** The page's match modes. */
val REDIRECT_KIND_CHOICES = listOf("exact" to "Exact path", "prefix" to "Path and below", "regex" to "Pattern")

/** What the editor asks to save. */
data class RedirectDraft(
  val id: String? = null,
  val kind: String = "exact",
  val source: String = "",
  val destination: String = "",
  val statusCode: Long = 302,
  val priority: String = "",
  val enabled: Boolean = true,
) {
  companion object {
    fun of(row: RedirectRow) = RedirectDraft(
      id = row.id,
      kind = row.kind ?: "exact",
      source = row.source,
      destination = row.destination,
      statusCode = row.statusCode,
      priority = row.priority?.toString().orEmpty(),
      enabled = row.enabled,
    )
  }
}

/** The server's answer: the page's refusal, or the rule as the page stores it. */
sealed interface RedirectCheck {
  data class Refused(val problem: String) : RedirectCheck
  data class Ready(val source: String, val destination: String, val statusCode: Long, val kind: String, val notice: String?) : RedirectCheck
}

/** Whether a destination leaves the platform: anything that is not a site path (`/…`, not `//…`). */
fun isExternalRedirectDestination(destination: String): Boolean {
  val value = destination.trim()
  return !(value.startsWith("/") && !value.startsWith("//"))
}

/**
 * A rule's writes, as the Redirects page makes them: the save checks through
 * the console's `redirects/check`, a new rule through `/api/hosts/resources`
 * (which counts it against the plan and stamps an outside destination's
 * approval), and an edit, a switch or a delete as the same Firestore writes
 * the page makes, which the rules hold to a publishing role. Every change is
 * announced to the site's cache, as the page announces it.
 */
interface RedirectsWriteApi {
  suspend fun check(draft: RedirectDraft): RedirectCheck
  suspend fun create(fields: Map<String, Any?>)
  suspend fun update(id: String, fields: Map<String, Any?>)
  suspend fun setEnabled(id: String, enabled: Boolean)
  suspend fun delete(id: String)
  suspend fun announce(source: String?)
}

class ConsoleRedirectsWriteApi(
  private val api: ConsoleApiClient,
  private val writer: FirestoreWriter,
  private val hostId: String,
) : RedirectsWriteApi {
  private fun path(id: String) = "hosts/$hostId/redirects/$id"

  override suspend fun check(draft: RedirectDraft): RedirectCheck {
    val answer = api.request(
      REDIRECT_CHECK_ROUTE,
      ApiMethod.POST,
      JsonObject(
        buildMap {
          put("hostId", JsonPrimitive(hostId))
          draft.id?.let { put("id", JsonPrimitive(it)) }
          put("kind", JsonPrimitive(draft.kind))
          put("source", JsonPrimitive(draft.source))
          put("destination", JsonPrimitive(draft.destination))
          put("statusCode", JsonPrimitive(draft.statusCode))
        },
      ),
    )?.jsonObject ?: throw ConsoleApiError("The redirect could not be checked.", 0, null)
    fun text(key: String) = (answer[key] as? JsonPrimitive)?.contentOrNull
    return if ((answer["ok"] as? JsonPrimitive)?.booleanOrNull == true) {
      RedirectCheck.Ready(
        source = text("source").orEmpty(),
        destination = text("destination").orEmpty(),
        statusCode = (answer["statusCode"] as? JsonPrimitive)?.longOrNull ?: 302,
        kind = text("kind") ?: draft.kind,
        notice = text("notice"),
      )
    } else {
      RedirectCheck.Refused(text("problem") ?: "That redirect can't be saved.")
    }
  }

  override suspend fun create(fields: Map<String, Any?>) {
    api.request(
      HOST_RESOURCES_ROUTE,
      ApiMethod.POST,
      JsonObject(mapOf("hostId" to JsonPrimitive(hostId), "resource" to JsonPrimitive("redirect"), "data" to jsonOf(fields))),
    )
  }

  override suspend fun update(id: String, fields: Map<String, Any?>) = writer.merge(path(id), fields + ("updatedAt" to firestoreNow()))

  override suspend fun setEnabled(id: String, enabled: Boolean) =
    writer.merge(path(id), mapOf("enabled" to enabled, "updatedAt" to firestoreNow()))

  override suspend fun delete(id: String) = writer.merge(path(id), mapOf("deletedAt" to firestoreNow(), "enabled" to false))

  override suspend fun announce(source: String?) {
    val redirectPath = source?.takeIf { it.startsWith("/") } ?: "/"
    runCatching {
      api.request(REVALIDATE_ROUTE, ApiMethod.POST, JsonObject(mapOf("hostId" to JsonPrimitive(hostId), "redirectPath" to JsonPrimitive(redirectPath))))
    }
  }

  private fun jsonOf(fields: Map<String, Any?>) = JsonObject(
    fields.mapValues { (_, value) ->
      when (value) {
        is Boolean -> JsonPrimitive(value)
        is Number -> JsonPrimitive(value)
        else -> JsonPrimitive(value?.toString())
      }
    },
  )
}

/** The page's default when a rule names no priority. */
fun priorityOf(text: String): Long = text.trim().toLongOrNull() ?: REDIRECT_DEFAULT_PRIORITY

/**
 * The fields a save writes, as the page builds them: the checked source,
 * destination, status code and mode, the priority, and whether it is on
 * (an edit keeps what the rule was; a new rule is on). An edit also carries
 * the approval stamp for an outside destination, or clears it.
 */
fun redirectSaveFields(draft: RedirectDraft, checked: RedirectCheck.Ready, uid: String): Map<String, Any?> = buildMap {
  put("source", checked.source)
  put("destination", checked.destination)
  put("statusCode", checked.statusCode)
  put("kind", checked.kind)
  put("priority", priorityOf(draft.priority))
  put("enabled", draft.enabled)
  if (draft.id != null) {
    put("externalDestinationApprovedBy", if (isExternalRedirectDestination(checked.destination)) uid else FirestoreDelete)
  }
}

/** The editor and the row actions' state, for one site. */
class RedirectsEditor(private val api: RedirectsWriteApi, private val uid: String, private val scope: CoroutineScope) {
  var draft by mutableStateOf<RedirectDraft?>(null)
    private set
  var deleting by mutableStateOf<RedirectRow?>(null)
    private set
  var busy by mutableStateOf(false)
    private set
  var error by mutableStateOf<String?>(null)
    private set

  /** What just happened, or a warning that did not stop the save. */
  var notice by mutableStateOf<String?>(null)

  fun add() = open(RedirectDraft())

  fun edit(row: RedirectRow) = open(RedirectDraft.of(row))

  fun change(next: RedirectDraft) {
    draft = next
  }

  fun askDelete(row: RedirectRow) {
    error = null
    deleting = row
  }

  fun close() {
    if (busy) return
    draft = null
    deleting = null
  }

  private fun open(next: RedirectDraft) {
    error = null
    draft = next
  }

  fun save() {
    val asked = draft ?: return
    run {
      when (val checked = api.check(asked)) {
        is RedirectCheck.Refused -> error = checked.problem
        is RedirectCheck.Ready -> {
          val fields = redirectSaveFields(asked, checked, uid)
          if (asked.id == null) api.create(fields) else api.update(asked.id, fields)
          api.announce(checked.source)
          if (asked.id != null && asked.source != checked.source) api.announce(asked.source)
          draft = null
          notice = checked.notice ?: "Redirect saved. It is live within about 30 seconds."
        }
      }
    }
  }

  fun toggle(row: RedirectRow, enabled: Boolean) = run {
    api.setEnabled(row.id, enabled)
    api.announce(row.source)
  }

  fun confirmDelete() {
    val row = deleting ?: return
    run {
      api.delete(row.id)
      api.announce(row.source)
      deleting = null
      notice = "${row.source} no longer redirects."
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
          failure.message.orEmpty().contains("permission", ignoreCase = true) ->
            "Changing a redirect needs a publishing role — ask an editor or admin"
          else -> "That did not go through. Check the connection and try again."
        }
      } finally {
        busy = false
      }
    }
  }
}
