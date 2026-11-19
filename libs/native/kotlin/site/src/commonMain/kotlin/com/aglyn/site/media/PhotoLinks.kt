// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site.media

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.formatLocalDay
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.jsonValue
import com.aglyn.core.nowMillis
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.QrCodeImage
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.roundToInt

// A site's photo links (the console's `PhotoLinkDialog`, AGL-3957): a one-time address the owner opens on a phone to
// send photos into the site's library with no sign-in. `POST /api/media/photo-links` lists the links that still take
// photos, mints one (its address is answered once and never stored) and stops one. A site library only — the workspace
// library takes no phone photos. The Apple kit's PhotoLinks.swift.

/** The folder a link's photos land in (`PHOTO_LINK_FOLDER_NAME`). */
const val PHOTO_LINK_FOLDER_NAME = "From the owner"

private const val DAY_MS = 24 * 60 * 60 * 1000.0

/** One link that still takes photos, as the route's `list` answers it. */
data class PhotoLinkRow(val id: String, val createdAt: Long, val expiresAt: Long, val uploads: Int, val remainingUploads: Int) {
  /** "Made Nov 16 · 3 photos received". */
  val title: String get() = "Made ${photoLinkDay(createdAt)} · ${photoCount(uploads)} received"

  /** "Works until Nov 23". */
  val until: String get() = "Works until ${photoLinkDay(expiresAt)}"

  companion object {
    fun from(json: JsonElement?): PhotoLinkRow? {
      val obj = json as? JsonObject ?: return null
      val id = obj.string("linkId")?.takeIf { it.isNotEmpty() } ?: return null
      return PhotoLinkRow(id, obj.number("createdAt").toLong(), obj.number("expiresAt").toLong(), obj.number("uploads").toInt(), obj.number("remainingUploads").toInt())
    }
  }
}

/** A link just made: the only time its address is known. */
data class FreshPhotoLink(val id: String, val url: String, val expiresAt: Long)

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
private fun JsonObject.number(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

/** "1 photo", "40 photos". */
fun photoCount(count: Int): String = "$count ${if (count == 1) "photo" else "photos"}"

/** "Nov 16", the console's short date. */
fun photoLinkDay(atMs: Long): String = formatLocalDay(atMs, "MMM d")

/**
 * Under a fresh link's code: "Works for 7 days and takes up to 40 photos. Photos land in the folder “From the owner”."
 * The photo count is left out until the list has the link's row.
 */
fun photoLinkCaption(fresh: FreshPhotoLink, row: PhotoLinkRow?, nowMs: Long): String {
  val days = maxOf(1, ((fresh.expiresAt - nowMs) / DAY_MS).roundToInt())
  val takes = row?.let { " and takes up to ${photoCount(it.remainingUploads)}" }.orEmpty()
  return "Works for $days ${if (days == 1) "day" else "days"}$takes. Photos land in the folder “$PHOTO_LINK_FOLDER_NAME”."
}

/**
 * A refusal of the member themself (signed out, no upload rights, unknown or locked site): no link can be made either,
 * so New link stays off and the message reads as information rather than an error.
 */
fun photoLinksBlocked(status: Int): Boolean = status in setOf(401, 403, 404, 423)

class PhotoLinksApi(private val api: ConsoleApiClient, private val hostId: String) {
  private suspend fun call(vararg fields: Pair<String, Any?>): JsonElement? =
    api.request("/api/media/photo-links", ApiMethod.POST, jsonValue(mapOf("hostId" to hostId) + fields))

  /** The links that still take photos, newest first. */
  suspend fun list(): List<PhotoLinkRow> =
    ((call("action" to "list") as? JsonObject)?.get("links") as? JsonArray).orEmpty().mapNotNull(PhotoLinkRow::from)

  /** Mints a link; its photos are filed in "From the owner", made the first time. */
  suspend fun create(): FreshPhotoLink {
    val answer = call("action" to "create") as? JsonObject
    val url = answer?.string("url")
    val id = answer?.string("linkId")
    if (url == null || id == null) throw ConsoleApiError("The link could not be made", 0, null)
    return FreshPhotoLink(id, url, answer.number("expiresAt").toLong())
  }

  /** Stops a link at once; the photos it already received stay. */
  suspend fun revoke(linkId: String) {
    call("action" to "revoke", "linkId" to linkId)
  }
}

sealed interface PhotoLinkList {
  data object Pending : PhotoLinkList
  data class Ready(val links: List<PhotoLinkRow>) : PhotoLinkList
  data class Failed(val message: String, val blocked: Boolean) : PhotoLinkList
}

class PhotoLinksModel(private val api: PhotoLinksApi) {
  var list by mutableStateOf<PhotoLinkList>(PhotoLinkList.Pending)
    private set
  var fresh by mutableStateOf<FreshPhotoLink?>(null)
    private set

  /** "create", or the id of the link being stopped. */
  var busy by mutableStateOf<String?>(null)
    private set
  var notice by mutableStateOf<Pair<String, StatusTone>?>(null)
    private set

  val blocked: Boolean get() = (list as? PhotoLinkList.Failed)?.blocked == true

  val freshRow: PhotoLinkRow? get() = fresh?.let { made -> (list as? PhotoLinkList.Ready)?.links?.firstOrNull { it.id == made.id } }

  suspend fun refresh() {
    list = try {
      PhotoLinkList.Ready(api.list())
    } catch (error: CancellationException) {
      throw error
    } catch (error: ConsoleApiError) {
      val blocked = photoLinksBlocked(error.status)
      PhotoLinkList.Failed(if (blocked) error.message else "The photo links could not be loaded.", blocked)
    } catch (error: Exception) {
      PhotoLinkList.Failed("The photo links could not be loaded.", false)
    }
  }

  suspend fun create() {
    busy = "create"
    notice = null
    try {
      fresh = api.create()
      refresh()
    } catch (error: CancellationException) {
      throw error
    } catch (error: Exception) {
      notice = (error.message ?: "The link could not be made") to StatusTone.WARNING
    } finally {
      busy = null
    }
  }

  suspend fun revoke(link: PhotoLinkRow) {
    busy = link.id
    notice = null
    try {
      api.revoke(link.id)
      if (fresh?.id == link.id) fresh = null
      notice = "Link revoked" to StatusTone.SUCCESS
      refresh()
    } catch (error: CancellationException) {
      throw error
    } catch (error: Exception) {
      notice = (error.message ?: "The link could not be revoked") to StatusTone.WARNING
    } finally {
      busy = null
    }
  }
}

/** "Get photos from a phone": a new link's QR code and address, and the links still open with Revoke. */
@Composable
fun PhotoLinksDialog(api: PhotoLinksApi, onCopy: (String) -> Unit, onClose: () -> Unit) {
  val model = remember(api) { PhotoLinksModel(api) }
  val scope = rememberCoroutineScope()
  var revoking by remember { mutableStateOf<PhotoLinkRow?>(null) }
  LaunchedEffect(model) { model.refresh() }

  AlertDialog(
    onDismissRequest = { if (model.busy == null) onClose() },
    modifier = Modifier.testTag("photo-links-dialog"),
    title = { Text("Get photos from a phone") },
    text = {
      Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
        Text(
          "The owner scans the code with their phone and picks the photos to send. No sign-in; the photos land in this site's media library.",
          style = MaterialTheme.typography.bodyMedium,
        )
        model.notice?.let { (message, tone) -> NoticeBanner(message, tone) }
        model.fresh?.let { fresh -> PhotoLinkCode(fresh.url, photoLinkCaption(fresh, model.freshRow, nowMillis()), onCopy) }
        HorizontalDivider()
        Text("Open links", style = MaterialTheme.typography.titleSmall)
        when (val list = model.list) {
          PhotoLinkList.Pending -> Text("Checking for open links…", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          is PhotoLinkList.Failed -> NoticeBanner(
            list.message,
            if (list.blocked) StatusTone.INFO else StatusTone.ERROR,
            action = if (list.blocked) null else { { TextButton(onClick = { scope.launch { model.refresh() } }, modifier = Modifier.testTag("photo-links-retry")) { Text("Retry") } } },
          )
          is PhotoLinkList.Ready -> if (list.links.isEmpty()) {
            Text("No open links.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          } else {
            for (link in list.links) {
              Row(Modifier.fillMaxWidth().testTag("photo-link-row"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(2f))) {
                Column(Modifier.weight(1f)) {
                  Text(link.title, style = MaterialTheme.typography.bodyMedium)
                  Text(link.until, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton(onClick = { revoking = link }, enabled = model.busy == null) {
                  Text("Revoke", color = MaterialTheme.colorScheme.error)
                }
              }
            }
          }
        }
        Text(
          "A link's address is shown only once, when it is made. To share one again, make a new link.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    },
    dismissButton = { TextButton(onClick = onClose, enabled = model.busy == null, modifier = Modifier.testTag("photo-links-close")) { Text("Close") } },
    confirmButton = {
      Button(
        onClick = { scope.launch { model.create() } },
        enabled = model.busy == null && !model.blocked && model.list != PhotoLinkList.Pending,
        modifier = Modifier.testTag("photo-links-new"),
      ) {
        Icon(AglynIcons.named("qr_code"), contentDescription = null)
        Text(if (model.busy == "create") "Making…" else "New link", Modifier.padding(start = space(1f)))
      }
    },
  )

  revoking?.let { link ->
    ActionDialog(
      title = "Stop this photo link?",
      confirmLabel = "Revoke",
      body = "The link stops taking photos right away. Photos it already received stay in the library.",
      destructive = true,
      onConfirm = { revoking = null; scope.launch { model.revoke(link) } },
      onDismiss = { revoking = null },
    )
  }
}

/** A link's QR code with its address beside Copy, and what it takes. */
@Composable
private fun PhotoLinkCode(url: String, caption: String, onCopy: (String) -> Unit) {
  var copied by remember(url) { mutableStateOf(false) }
  Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(space(1f))) {
    QrCodeImage(url, size = 200.dp, label = "Photo link QR code")
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text(url, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, fontFamily = FontFamily.Monospace, maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
      TextButton(onClick = { onCopy(url); copied = true }, modifier = Modifier.testTag("photo-link-copy")) {
        Text(if (copied) "Copied" else "Copy link")
      }
    }
    Text(caption, Modifier.fillMaxWidth().testTag("photo-link-caption"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
}
