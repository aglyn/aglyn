package com.aglyn.plugins.commerce.products

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.formatMediaRef
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.site.media.ChosenMedia
import com.aglyn.site.media.MediaApi
import com.aglyn.site.media.MediaChooserDialog
import com.aglyn.site.media.MediaScope
import com.aglyn.core.mediaPreviewUrl
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.ui.EmptyTone
import com.aglyn.ui.LocalMediaPicker
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.PickSource
import com.aglyn.ui.PickedFile
import com.aglyn.ui.RemoteImage
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.pickSourceLabel
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.roundToInt
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/*
 * A PRODUCT'S IMAGES AND DIGITAL DELIVERY, FROM THE AGLYN APP (AGL-3652). ProductMedia.swift, line for line.
 *
 * The console's product editor keeps a product's pictures (`mediaUrls`, the first is the main one), and for a digital product
 * its paid downloads (`digitalFiles`), their download limit and its members videos (`gatedVideos`). A picture is any library
 * file; a download or a video is a PRIVATE one (PaidMedia.kt). Like every product write here, a change sends the whole stored
 * product with the one list changed, so nothing the app does not show is lost.
 */

const val COMMERCE_PRODUCT_MEDIA_SCREEN = "commerce.productMedia"

/** A file a buyer downloads. */
data class DigitalFileEntry(val index: Int, val url: String, val fileName: String, val version: String)

/** A members-only film. */
data class MembersVideoEntry(val index: Int, val url: String, val title: String)

private fun JsonElement?.text(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonElement?.list(): List<JsonElement> = (this as? JsonArray)?.toList().orEmpty()

/** What a product's media and delivery lists hold, read from the stored product. */
data class ProductMediaDraft(
  val type: String,
  val images: List<String>,
  val files: List<DigitalFileEntry>,
  val videos: List<MembersVideoEntry>,
  val downloadLimit: Int?,
) {
  val isDigital: Boolean get() = type == "digital"
}

fun productMediaDraftOf(stored: JsonObject): ProductMediaDraft = ProductMediaDraft(
  type = stored["type"].text() ?: "physical",
  images = stored["mediaUrls"].list().mapNotNull { it.text() },
  files = stored["digitalFiles"].list().withIndex().mapNotNull { (index, entry) ->
    val file = entry as? JsonObject ?: return@mapNotNull null
    val url = file["url"].text() ?: return@mapNotNull null
    DigitalFileEntry(index, url, file["fileName"].text() ?: "download", file["version"].text().orEmpty())
  },
  videos = stored["gatedVideos"].list().withIndex().mapNotNull { (index, entry) ->
    val video = entry as? JsonObject ?: return@mapNotNull null
    val url = video["url"].text() ?: return@mapNotNull null
    MembersVideoEntry(index, url, video["title"].text().orEmpty())
  },
  downloadLimit = (stored["downloadLimit"] as? JsonPrimitive)?.doubleOrNull?.roundToInt(),
)

sealed interface ProductMediaEdit {
  data class AddImages(val references: List<String>) : ProductMediaEdit
  data class RemoveImage(val index: Int) : ProductMediaEdit
  data class AddFile(val url: String, val fileName: String) : ProductMediaEdit
  data class SetVersion(val index: Int, val version: String) : ProductMediaEdit
  data class RemoveFile(val index: Int) : ProductMediaEdit
  data class AddVideo(val url: String, val title: String) : ProductMediaEdit
  data class RemoveVideo(val index: Int) : ProductMediaEdit

  /** Attempts per order; null is unlimited. */
  data class SetDownloadLimit(val limit: Int?) : ProductMediaEdit
}

/**
 * The product a save sends: the stored product with one list changed, as the console's editor changes it. A file's other keys
 * stay as they are; a version is cut to 20 characters; a download limit is at least one.
 */
fun productMediaSaveJson(stored: Map<String, Any?>, edit: ProductMediaEdit): JsonObject {
  val product = storedProductJson(stored).toMutableMap()
  fun list(key: String): List<JsonElement> = product[key].list()
  fun without(key: String, index: Int) {
    product[key] = JsonArray(list(key).filterIndexed { at, _ -> at != index })
  }
  when (edit) {
    is ProductMediaEdit.AddImages -> product["mediaUrls"] = JsonArray(list("mediaUrls") + edit.references.map(::JsonPrimitive))
    is ProductMediaEdit.RemoveImage -> without("mediaUrls", edit.index)
    is ProductMediaEdit.AddFile ->
      product["digitalFiles"] = JsonArray(list("digitalFiles") + JsonObject(mapOf("url" to JsonPrimitive(edit.url), "fileName" to JsonPrimitive(edit.fileName))))
    is ProductMediaEdit.SetVersion ->
      product["digitalFiles"] = JsonArray(
        list("digitalFiles").mapIndexed { at, file ->
          if (at == edit.index && file is JsonObject) JsonObject(file + ("version" to JsonPrimitive(edit.version.take(20)))) else file
        },
      )
    is ProductMediaEdit.RemoveFile -> without("digitalFiles", edit.index)
    is ProductMediaEdit.AddVideo ->
      product["gatedVideos"] = JsonArray(list("gatedVideos") + JsonObject(mapOf("url" to JsonPrimitive(edit.url), "title" to JsonPrimitive(edit.title))))
    is ProductMediaEdit.RemoveVideo -> without("gatedVideos", edit.index)
    is ProductMediaEdit.SetDownloadLimit -> edit.limit?.let { product["downloadLimit"] = JsonPrimitive(maxOf(1, it)) } ?: product.remove("downloadLimit")
  }
  return JsonObject(product)
}

/** A download limit typed in the field: blank is none, a number is at least one, anything else is not a limit. */
sealed interface LimitText {
  data object Unlimited : LimitText
  data class Count(val attempts: Int) : LimitText
}

fun downloadLimitFromText(text: String): LimitText? {
  val raw = text.trim()
  if (raw.isEmpty()) return LimitText.Unlimited
  val number = raw.toDoubleOrNull()?.takeIf { it.isFinite() } ?: return null
  return LimitText.Count(maxOf(1, kotlin.math.floor(number + 0.5).toInt()))
}

/** A question put to the person before a file is made private; the dialog answers it. */
class PaidMediaQuestion(val title: String, val message: String)

/**
 * Makes a file private for paid delivery, as the console's `usePaidMediaAttach` does: where else it is used, the author's
 * confirmation in the console's words, then the library's own private switch.
 */
class PaidMediaProtector {
  var question by mutableStateOf<PaidMediaQuestion?>(null)
    private set

  /** A refusal or a warning the person should read. */
  var note by mutableStateOf<String?>(null)
  private var answer: CompletableDeferred<Boolean>? = null

  private suspend fun ask(next: PaidMediaQuestion): Boolean {
    val pending = CompletableDeferred<Boolean>()
    answer = pending
    question = next
    return pending.await()
  }

  fun respond(yes: Boolean) {
    question = null
    answer?.complete(yes)
    answer = null
  }

  private fun body(scope: String, fields: Map<String, JsonElement>): JsonObject =
    JsonObject(paidMediaScopeBody(scope).mapValues { JsonPrimitive(it.value) as JsonElement } + fields)

  /** Asks where else the file is used: the places beside this product, and how far the scan got. */
  private suspend fun uses(scope: String, mediaId: String, hostId: String, productId: String, api: ConsoleApiClient): Pair<List<PaidMediaReference>, PaidMediaUsageCheck> =
    try {
      val answer = api.request("/api/media/references", ApiMethod.POST, body(scope, mapOf("mediaId" to JsonPrimitive(mediaId)))) as? JsonObject
      val all = answer?.get("references").list().mapNotNull { it as? JsonObject }.map { entry ->
        PaidMediaReference(
          kind = entry["kind"].text().orEmpty(),
          id = entry["id"].text().orEmpty(),
          name = entry["name"].text().orEmpty(),
          hostId = entry["hostId"].text().orEmpty(),
          collectionId = entry["collectionId"].text(),
        )
      }
      usesBesideProduct(all, hostId, productId) to if ((answer?.get("complete") as? JsonPrimitive)?.booleanOrNull == true) PaidMediaUsageCheck.FULL else PaidMediaUsageCheck.PARTIAL
    } catch (error: CancellationException) {
      throw error
    } catch (_: Throwable) {
      // Said in the confirmation instead: "we could not check" is not "nothing uses it".
      emptyList<PaidMediaReference>() to PaidMediaUsageCheck.FAILED
    }

  /** True when the file is private now. [adding] is whether it is on its way into the product, for the words of a refusal. */
  suspend fun protect(scope: String, mediaId: String, kind: PaidMediaKind, adding: Boolean, hostId: String, productId: String, api: ConsoleApiClient): Boolean {
    note = null
    val (others, checked) = uses(scope, mediaId, hostId, productId, api)
    if (!ask(PaidMediaQuestion(kind.title, paidMediaConfirmation(others, checked, kind)))) return false
    return try {
      val answer = api.request(
        "/api/media/folders",
        ApiMethod.POST,
        body(scope, mapOf("action" to JsonPrimitive("set-private"), "mediaId" to JsonPrimitive(mediaId), "private" to JsonPrimitive(true))),
      ) as? JsonObject
      if ((answer?.get("rawUrlCleared") as? JsonPrimitive)?.booleanOrNull == false) {
        note = "The video is private, but an old public download link to it could not be confirmed dead. Make it private again from the media library to retry."
      }
      true
    } catch (error: CancellationException) {
      throw error
    } catch (failure: Throwable) {
      val reason = (failure as? ConsoleApiError)?.message ?: "Could not make the video private"
      note = "$reason. ${if (adding) kind.notAdded else kind.unusable}"
      false
    }
  }
}

/** Sends the stored product with [edit] applied; null when it went, else why not. */
@OptIn(ExperimentalUuidApi::class)
suspend fun saveProductMedia(api: ProductWriteApi, productId: String, stored: Map<String, Any?>, edit: ProductMediaEdit): String? =
  try {
    api.save(productId, false, productMediaSaveJson(stored, edit), Uuid.random().toString())
    null
  } catch (error: CancellationException) {
    throw error
  } catch (failure: Throwable) {
    (failure as? ConsoleApiError)?.takeIf { it.status in 1..499 }?.message
      ?: "It is not known whether that went through. Trying again is safe; it will not happen twice."
  }

private enum class Choice(val kind: String?, val allowPrivate: Boolean, val paid: PaidMediaKind?) {
  IMAGE("image", false, null),
  FILE(null, true, PaidMediaKind.DOWNLOAD),
  VIDEO("video", true, PaidMediaKind.VIDEO),
}

/** A product's images and, for a digital product, its paid downloads and members videos: the console's editor sections. */
@Composable
fun ProductMediaScreen(context: NativePluginContext, productId: String) {
  val hostId = context.hostId ?: return
  val flow = remember(hostId, productId, context.firestore) { context.firestore.observeDoc("${productsPath(hostId)}/$productId") }
  val live by flow.collectAsState(Live.Loading)
  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this product", body = "Check the connection and try again.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
    is Live.Ready -> {
      val doc = value.value
      if (doc == null || doc.data["deletedAt"] != null) {
        EmptyState("This product is gone", body = "It may have been deleted.", icon = AglynIcons.named("inventory"))
      } else {
        ProductMediaContent(context, hostId, productId, doc.data)
      }
    }
  }
}

@Composable
private fun ProductMediaContent(context: NativePluginContext, hostId: String, productId: String, stored: Map<String, Any?>) {
  val draft = productMediaDraftOf(storedProductJson(stored))
  val coroutines = rememberCoroutineScope()
  val api = remember(context.api, hostId) { ConsoleProductWriteApi(context.api, hostId) }
  val protector = remember { PaidMediaProtector() }
  val picker = LocalMediaPicker.current
  var busy by remember { mutableStateOf(false) }
  var message by remember { mutableStateOf<String?>(null) }
  var working by remember { mutableStateOf<String?>(null) }
  var choice by remember { mutableStateOf<Choice?>(null) }
  var versionEdit by remember { mutableStateOf<Pair<Int, String>?>(null) }
  var limitText by remember(draft.downloadLimit) { mutableStateOf(draft.downloadLimit?.toString().orEmpty()) }

  fun apply(edit: ProductMediaEdit, after: () -> Unit = {}) {
    coroutines.launch {
      busy = true
      message = saveProductMedia(api, productId, stored, edit)
      busy = false
      if (message == null) after()
    }
  }

  fun commitLimit() {
    val parsed = downloadLimitFromText(limitText)
    if (parsed == null) {
      limitText = draft.downloadLimit?.toString().orEmpty()
      return
    }
    val next = (parsed as? LimitText.Count)?.attempts
    if (next != draft.downloadLimit) apply(ProductMediaEdit.SetDownloadLimit(next))
  }

  /** Photos taken or picked on the device go to this site's library by the library's own upload route, then onto the product. */
  fun upload(source: PickSource) {
    val device = picker ?: return
    coroutines.launch {
      val files: List<PickedFile> = runCatching { device.pick(source, multiple = source != PickSource.CAMERA) }.getOrDefault(emptyList())
      if (files.isEmpty()) return@launch
      val library = MediaApi(context.api, MediaScope.Site(hostId))
      val references = mutableListOf<String>()
      for ((index, file) in files.withIndex()) {
        if (!file.mimeType.lowercase().startsWith("image/")) {
          message = "${file.name} is not a picture, so it was not added."
          continue
        }
        working = if (files.size == 1) "Uploading ${file.name}…" else "Uploading ${index + 1} of ${files.size}…"
        try {
          library.upload(file, null)?.let { id -> formatMediaRef(hostId, id) }?.let(references::add)
        } catch (error: CancellationException) {
          throw error
        } catch (failure: Throwable) {
          message = (failure as? ConsoleApiError)?.message ?: "${file.name} could not be uploaded."
          break
        }
      }
      working = null
      if (references.isNotEmpty()) apply(ProductMediaEdit.AddImages(references))
    }
  }

  /** A file picked from the library: an image goes in as it is, a download or a video is made private first. */
  fun choose(which: Choice, chosen: ChosenMedia) {
    val kind = which.paid
    if (kind == null) {
      apply(ProductMediaEdit.AddImages(listOf(chosen.reference)))
      return
    }
    val reference = formatMediaRef(chosen.scope.cdnScope, chosen.item.id)
    if (reference == null) {
      message = kind.choose
      return
    }
    coroutines.launch {
      if (!chosen.item.private) {
        val madePrivate = protector.protect(chosen.scope.cdnScope, chosen.item.id, kind, true, hostId, productId, context.api)
        if (!madePrivate) return@launch
      }
      apply(if (which == Choice.FILE) ProductMediaEdit.AddFile(reference, chosen.item.fileName) else ProductMediaEdit.AddVideo(reference, chosen.item.fileName))
    }
  }

  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("product-media"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    (message ?: protector.note)?.let { NoticeBanner(it, StatusTone.WARNING) }
    working?.let { NoticeBanner(it, StatusTone.INFO) }
    SectionCard("Images") {
      draft.images.forEachIndexed { index, reference ->
        Row(Modifier.fillMaxWidth().testTag("product-image-$index"), horizontalArrangement = Arrangement.spacedBy(space(2f)), verticalAlignment = Alignment.CenterVertically) {
          RemoteImage(mediaPreviewUrl(reference, context.api.origin, context.hostId, 160), null, Modifier.size(56.dp).clip(MaterialTheme.shapes.small), icon = "image")
          Text(if (index == 0) "Main image" else "Image ${index + 1}", Modifier.weight(1f))
          WithTooltip("Remove image ${index + 1}") { IconButton(
            onClick = { apply(ProductMediaEdit.RemoveImage(index)) },
            enabled = !busy,
            modifier = Modifier.semantics { contentDescription = "Remove image ${index + 1}" }.testTag("remove-image-$index"),
          ) { Icon(AglynIcons.named("close"), contentDescription = null) } }
        }
      }
      var menu by remember { mutableStateOf(false) }
      Box {
        OutlinedButton(onClick = { menu = true }, enabled = !busy && working == null, modifier = Modifier.testTag("product-add-image")) {
          Icon(AglynIcons.named("add"), contentDescription = null)
          Text("Add image", Modifier.padding(start = space(1f)))
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
          for (source in picker?.sources.orEmpty()) {
            val (label, icon) = pickSourceLabel(source)
            DropdownMenuItem(
              text = { Text(label) },
              leadingIcon = { Icon(AglynIcons.named(icon), null) },
              onClick = { menu = false; upload(source) },
              modifier = Modifier.testTag("product-image-${source.name.lowercase()}"),
            )
          }
          DropdownMenuItem(
            text = { Text("Choose from media") },
            leadingIcon = { Icon(AglynIcons.named("photo_library"), null) },
            onClick = { menu = false; choice = Choice.IMAGE },
            modifier = Modifier.testTag("product-image-library"),
          )
        }
      }
      Text(
        "The first image is the product's main one. New pictures are added to this site's media library.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
    if (draft.isDigital) {
      SectionCard("Digital delivery") {
        draft.files.forEach { file ->
          Column(Modifier.fillMaxWidth().testTag("product-file-${file.index}"), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
              Text(if (file.version.isEmpty()) file.fileName else "${file.fileName} · v${file.version}", Modifier.weight(1f), maxLines = 1)
              PaidMediaChip(context, file.url) { asset ->
                coroutines.launch { protector.protect(asset.scope, asset.mediaId, PaidMediaKind.DOWNLOAD, false, hostId, productId, context.api) }
              }
            }
            Row {
              TextButton(onClick = { versionEdit = file.index to file.version }, enabled = !busy) { Text("Version") }
              TextButton(onClick = { apply(ProductMediaEdit.RemoveFile(file.index)) }, enabled = !busy) { Text("Remove") }
            }
          }
        }
        OutlinedButton(onClick = { choice = Choice.FILE }, enabled = !busy, modifier = Modifier.testTag("product-add-file")) { Text("Add file (media library)") }
        OutlinedTextField(
          value = limitText,
          onValueChange = { limitText = it },
          label = { Text("Download limit") },
          placeholder = { Text("Unlimited") },
          supportingText = { Text("Attempts per order") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
          modifier = Modifier.fillMaxWidth().testTag("product-download-limit"),
        )
        TextButton(onClick = ::commitLimit, enabled = !busy && downloadLimitFromText(limitText) != null) { Text("Save download limit") }
        Text(
          "Buyers always download the current files — uploading a new version re-delivers to everyone.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      SectionCard("Members videos") {
        draft.videos.forEach { video ->
          Row(Modifier.fillMaxWidth().testTag("product-video-${video.index}"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            Icon(AglynIcons.named("video_library"), contentDescription = null)
            Text(video.title.ifEmpty { video.url }, Modifier.weight(1f), maxLines = 1)
            PaidMediaChip(context, video.url) { asset ->
              coroutines.launch { protector.protect(asset.scope, asset.mediaId, PaidMediaKind.VIDEO, false, hostId, productId, context.api) }
            }
            WithTooltip("Remove video") { IconButton(
              onClick = { apply(ProductMediaEdit.RemoveVideo(video.index)) },
              enabled = !busy,
              modifier = Modifier.semantics { contentDescription = "Remove video" },
            ) { Icon(AglynIcons.named("close"), contentDescription = null) } }
          }
        }
        OutlinedButton(onClick = { choice = Choice.VIDEO }, enabled = !busy, modifier = Modifier.testTag("product-add-video")) { Text("Add members video") }
      }
    }
  }

  choice?.let { which ->
    MediaChooserDialog(context, onChoose = { chosen -> choice = null; choose(which, chosen) }, onDismiss = { choice = null }, kind = which.kind, allowPrivate = which.allowPrivate)
  }
  protector.question?.let { question ->
    ActionDialog(
      title = question.title,
      body = question.message,
      icon = "lock",
      confirmLabel = "Make private",
      dismissLabel = "Cancel",
      onConfirm = { protector.respond(true) },
      onDismiss = { protector.respond(false) },
      modifier = Modifier.testTag("make-private"),
    )
  }
  versionEdit?.let { (index, text) ->
    var typed by remember(index) { mutableStateOf(text) }
    ActionDialog(
      title = "Version",
      confirmLabel = "Save",
      dismissLabel = "Cancel",
      onConfirm = { versionEdit = null; apply(ProductMediaEdit.SetVersion(index, typed)) },
      onDismiss = { versionEdit = null },
    ) {
      OutlinedTextField(typed, { typed = it.take(20) }, label = { Text("Version") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("product-version"))
    }
  }
}

/** Whether a stored paid file can be delivered, with the button that fixes a public one (the console's `PaidMediaProtection`). */
@Composable
private fun PaidMediaChip(context: NativePluginContext, value: String, onMakePrivate: (PaidMediaSource.Asset) -> Unit) {
  when (val source = paidMediaSource(value)) {
    PaidMediaSource.External -> StatusChip("Hosted elsewhere")
    PaidMediaSource.Malformed -> StatusChip("Cannot be played", StatusTone.ERROR)
    is PaidMediaSource.Asset -> {
      val flow = remember(source, context.firestore) { context.firestore.observeDoc(paidMediaDocumentPath(source.scope, source.mediaId)) }
      val live by flow.collectAsState(Live.Loading)
      val ready = live as? Live.Ready ?: return
      val doc = ready.value
      when {
        doc == null || doc.data["deletedAt"] != null -> StatusChip("Not in the media library", StatusTone.ERROR)
        doc.data["private"] == true -> StatusChip("Private", StatusTone.SUCCESS)
        else -> Row(verticalAlignment = Alignment.CenterVertically) {
          StatusChip("Public", StatusTone.WARNING)
          TextButton(onClick = { onMakePrivate(source) }, modifier = Modifier.testTag("make-private-button")) { Text("Make private") }
        }
      }
    }
  }
}
