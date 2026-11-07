package com.aglyn.plugins.commerce.orders

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.HostOrder
import com.aglyn.contracts.PickedUpload
import com.aglyn.contracts.QUOTE_MAX_PROOFS
import com.aglyn.contracts.QUOTE_STAGE_LABELS
import com.aglyn.contracts.QuoteCustomerResponse
import com.aglyn.contracts.QuoteCustomerResponseAction
import com.aglyn.contracts.QuoteStage
import com.aglyn.contracts.VISITOR_UPLOAD_MAX_BYTES
import com.aglyn.contracts.checkVisitorUploadSelection
import com.aglyn.contracts.currentQuoteProofs
import com.aglyn.contracts.deviceTimeZone
import com.aglyn.contracts.formatReceiptTime
import com.aglyn.contracts.formatVisitorUploadBytes
import com.aglyn.contracts.isUnpaidQuote
import com.aglyn.contracts.latestQuoteResponse
import com.aglyn.contracts.permissionRefusalText
import com.aglyn.contracts.quoteIsProofOnly
import com.aglyn.contracts.quoteLibraryProofProblem
import com.aglyn.contracts.quoteNoProofsMessage
import com.aglyn.contracts.quoteProofChangeRefusal
import com.aglyn.contracts.quoteProofsExplanation
import com.aglyn.contracts.quoteResponseHeadline
import com.aglyn.contracts.visitorUploadIsInline
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.DownloadedFile
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.rememberMemberPermissions
import com.aglyn.site.media.ChosenMedia
import com.aglyn.site.media.MediaChooserDialog
import com.aglyn.ui.LocalFileExporter
import com.aglyn.ui.LocalMediaPicker
import com.aglyn.ui.PickedFile
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.decodeImageBytes
import com.aglyn.ui.pickSourceLabel
import com.aglyn.ui.space
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/*
 * A quote's proofs and revisions (AGL-4096, AGL-4184), as the console's QuoteProofsSection has them: the current
 * revision's proofs (a picture for an image, a row naming anything else; both download), Add proof from this device
 * and From media library, what the customer last said with any files they sent, "Start revision N+1", and every earlier
 * revision as it was kept. Then the files a quote's request came with (QuoteRequestFilesSection). The server keeps the
 * files and hands them out (`POST /api/commerce/quote` proof-ticket, proof-finalize, proof-from-media, proof-remove,
 * start-revision, revisions, file). The Apple kit's QuoteProofs.swift.
 */

/** A file the quote lists: a proof, or one the customer sent. Never its storage path. */
data class QuoteListedFile(val id: String, val name: String, val contentType: String, val size: Long) {
  companion object {
    fun of(value: JsonElement?): QuoteListedFile? {
      val fields = value as? JsonObject ?: return null
      val id = (fields["id"] as? JsonPrimitive)?.contentOrNull ?: return null
      return QuoteListedFile(
        id, (fields["name"] as? JsonPrimitive)?.contentOrNull.orEmpty(), (fields["contentType"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
        (fields["size"] as? JsonPrimitive)?.doubleOrNull?.toLong() ?: 0,
      )
    }
  }
}

/** An earlier revision as the route lists it. */
data class QuoteRevisionView(
  val revision: Int, val stage: String, val closedAtMs: Double, val proofs: List<QuoteListedFile>,
  val responses: List<Pair<QuoteCustomerResponse, List<QuoteListedFile>>>,
)

private fun quoteTime(ms: Double): String = formatReceiptTime(ms.toLong(), deviceTimeZone())

private fun JsonElement?.errorText(): String? = ((this as? JsonObject)?.get("error") as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }

/** One of the quote's files, fetched with the member's token (`file`); null when it is refused. */
suspend fun fetchQuoteFile(context: NativePluginContext, quoteId: String, fileId: String, revision: Int?): DownloadedFile? = try {
  context.api.download(
    QUOTE_ROUTE,
    JsonObject(
      buildMap {
        put("action", JsonPrimitive("file"))
        put("hostId", JsonPrimitive(context.hostId.orEmpty()))
        put("quoteId", JsonPrimitive(quoteId))
        put("fileId", JsonPrimitive(fileId))
        if (revision != null) put("revision", JsonPrimitive(revision))
      },
    ),
  )
} catch (error: Throwable) {
  if (error is kotlinx.coroutines.CancellationException) throw error
  null
}

/** The Proofs section, the earlier revisions and the request's files. */
@Composable
fun QuoteProofsSection(context: NativePluginContext, order: HostOrder, quoteId: String, onNotice: (String, StatusTone) -> Unit) {
  val quote = order.quote
  val revision = maxOf(1, quote?.revision?.toInt() ?: 1)
  val proofs = currentQuoteProofs(quote)
  val proofOnly = quoteIsProofOnly(order)
  val canEdit = rememberMemberPermissions(context).can(QUOTE_EDIT_PERMISSION)
  val addRefusal = quoteProofChangeRefusal(order, adding = true)
  // A quote with no lines keeps its last proof, so it offers no way to remove it.
  val removable = quoteProofChangeRefusal(order, adding = false) == null && !(proofOnly && proofs.size == 1)
  val picker = LocalMediaPicker.current
  val exporter = LocalFileExporter.current
  val scope = rememberCoroutineScope()
  var sending by remember { mutableStateOf<Pair<Int, Int>?>(null) }
  var busy by remember { mutableStateOf(false) }
  var choosingSource by remember { mutableStateOf(false) }
  var choosingFromLibrary by remember { mutableStateOf(false) }
  var confirmingRevision by remember { mutableStateOf(false) }
  var history by remember { mutableStateOf<List<QuoteRevisionView>?>(null) }
  var historyError by remember { mutableStateOf<String?>(null) }

  suspend fun post(action: String, extra: Map<String, JsonElement> = emptyMap()): JsonObject? =
    context.api.request(
      QUOTE_ROUTE, ApiMethod.POST,
      JsonObject(mapOf("action" to JsonPrimitive(action), "hostId" to JsonPrimitive(context.hostId.orEmpty()), "quoteId" to JsonPrimitive(quoteId)) + extra),
    ) as? JsonObject

  fun reason(error: Throwable, fallback: String) = (error as? ConsoleApiError)?.body.errorText() ?: fallback

  suspend fun loadHistory() {
    historyError = null
    history = try {
      (post("revisions")?.get("revisions") as? JsonArray).orEmpty().mapNotNull { raw ->
        val entry = raw as? JsonObject ?: return@mapNotNull null
        val number = (entry["revision"] as? JsonPrimitive)?.doubleOrNull ?: return@mapNotNull null
        QuoteRevisionView(
          revision = number.toInt(),
          stage = (entry["stage"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
          closedAtMs = (entry["closedAtMs"] as? JsonPrimitive)?.doubleOrNull ?: 0.0,
          proofs = (entry["proofs"] as? JsonArray).orEmpty().mapNotNull(QuoteListedFile::of),
          responses = (entry["responses"] as? JsonArray).orEmpty().mapNotNull { item ->
            val fields = item as? JsonObject ?: return@mapNotNull null
            // The listed files carry no storage path, so they are read apart.
            val response = runCatching {
              ContractJsonFormat.decodeFromJsonElement(QuoteCustomerResponse.serializer(), JsonObject(fields - "files"))
            }.getOrNull() ?: return@mapNotNull null
            response to (fields["files"] as? JsonArray).orEmpty().mapNotNull(QuoteListedFile::of)
          },
        )
      }
    } catch (error: Throwable) {
      if (error is kotlinx.coroutines.CancellationException) throw error
      historyError = reason(error, "Earlier revisions could not be loaded.")
      null
    }
  }

  // Earlier revisions are read when there are some, and again after one is added.
  LaunchedEffect(revision) { if (revision > 1) loadHistory() }

  fun download(file: QuoteListedFile, fromRevision: Int?) {
    scope.launch {
      val fetched = fetchQuoteFile(context, quoteId, file.id, fromRevision)
      if (fetched == null) {
        val fromRequest = fromRevision == null && quote?.requestFiles.orEmpty().any { it.id == file.id }
        onNotice(
          if (fromRequest) "The file could not be downloaded. The request may have been deleted from the Inbox." else "The file could not be downloaded",
          StatusTone.ERROR,
        )
        return@launch
      }
      exporter?.export(file.name.ifEmpty { file.id }, file.contentType.ifEmpty { fetched.contentType }, fetched.bytes)
    }
  }

  fun addProofs(files: List<PickedFile>) {
    checkVisitorUploadSelection(files.map { PickedUpload(it.name, it.mimeType, it.size) }, proofs.size)?.let { return onNotice(it, StatusTone.ERROR) }
    scope.launch {
      sending = 0 to files.size
      try {
        files.forEachIndexed { index, file ->
          val ticket = post(
            "proof-ticket",
            mapOf("file" to JsonObject(mapOf("name" to JsonPrimitive(file.name), "contentType" to JsonPrimitive(file.mimeType), "size" to JsonPrimitive(file.size)))),
          )
          val id = (ticket?.get("ticket") as? JsonPrimitive)?.contentOrNull
          val upload = ticket?.get("upload") as? JsonObject
          val url = (upload?.get("url") as? JsonPrimitive)?.contentOrNull
          if (id == null || url == null) return@launch onNotice("The file could not be sent. Check your connection and try again.", StatusTone.ERROR)
          val fields = (upload["fields"] as? JsonObject).orEmpty().mapNotNull { (key, value) -> (value as? JsonPrimitive)?.contentOrNull?.let { key to it } }.toMap()
          context.api.postSignedForm(url, fields, file.name, file.mimeType, file.bytes)
          post("proof-finalize", mapOf("ticket" to JsonPrimitive(id)))
          sending = index + 1 to files.size
        }
      } catch (error: Throwable) {
        if (error is kotlinx.coroutines.CancellationException) throw error
        onNotice(reason(error, "The proof could not be kept"), StatusTone.ERROR)
      } finally {
        sending = null
      }
    }
  }

  /** A file from the media library: the server copies its bytes into the quote's private proofs. */
  fun addFromLibrary(chosen: ChosenMedia) {
    quoteLibraryProofProblem(chosen.item.fileName, chosen.item.contentType, chosen.item.id, chosen.scope.cdnScope)?.let { return onNotice(it, StatusTone.ERROR) }
    scope.launch {
      sending = 0 to 1
      try {
        post("proof-from-media", mapOf("media" to JsonObject(mapOf("mediaScope" to JsonPrimitive(chosen.scope.cdnScope), "mediaId" to JsonPrimitive(chosen.item.id)))))
      } catch (error: Throwable) {
        if (error is kotlinx.coroutines.CancellationException) throw error
        onNotice(reason(error, "The proof could not be added"), StatusTone.ERROR)
      } finally {
        sending = null
      }
    }
  }

  fun act(action: String, extra: Map<String, JsonElement>, fallback: String, done: (JsonObject?) -> Unit = {}) {
    scope.launch {
      busy = true
      try {
        done(post(action, extra))
      } catch (error: Throwable) {
        if (error is kotlinx.coroutines.CancellationException) throw error
        onNotice(reason(error, fallback), StatusTone.ERROR)
      } finally {
        busy = false
      }
    }
  }

  val refusal = if (!canEdit) permissionRefusalText(QUOTE_EDIT_PERMISSION) else addRefusal
  SectionCard("Proofs · Revision $revision") {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Text(quoteProofsExplanation(order), color = MaterialTheme.colorScheme.onSurfaceVariant)
      latestQuoteResponse(quote)?.let { latest ->
        ResponseNote(latest, latest.files.orEmpty().map { QuoteListedFile(it.id, it.name, it.contentType, it.size.toLong()) }) { file -> FileRow(context, quoteId, file, null, ::download) }
      }
      if (proofs.isEmpty()) {
        Text(quoteNoProofsMessage(order), color = MaterialTheme.colorScheme.onSurfaceVariant)
      } else {
        proofs.forEach { proof ->
          val file = QuoteListedFile(proof.id, proof.name, proof.contentType, proof.size.toLong())
          FileRow(context, quoteId, file, null, ::download, onRemove = if (removable) ({
            if (canEdit) act("proof-remove", mapOf("proofId" to JsonPrimitive(file.id)), "The proof could not be removed")
            else onNotice(permissionRefusalText(QUOTE_EDIT_PERMISSION), StatusTone.INFO)
          }) else null)
        }
      }
      if (isUnpaidQuote(order)) {
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
          Box {
            OutlinedButton(onClick = { if (refusal != null) onNotice(refusal, StatusTone.INFO) else choosingSource = true }, enabled = !busy && sending == null,
              modifier = Modifier.testTag("quote-add-proof")) {
              Text(sending?.let { (done, total) -> "Sending ${done + 1} of $total…" } ?: "Add proof")
            }
            DropdownMenu(expanded = choosingSource, onDismissRequest = { choosingSource = false }) {
              picker?.sources.orEmpty().forEach { source ->
                DropdownMenuItem(text = { Text(pickSourceLabel(source).first) }, onClick = {
                  choosingSource = false
                  scope.launch { picker?.pick(source)?.takeIf { it.isNotEmpty() }?.let(::addProofs) }
                })
              }
            }
          }
          OutlinedButton(onClick = { if (refusal != null) onNotice(refusal, StatusTone.INFO) else choosingFromLibrary = true }, enabled = !busy && sending == null,
            modifier = Modifier.testTag("quote-proof-library")) { Text("From media library") }
          TextButton(onClick = { if (canEdit) confirmingRevision = true else onNotice(permissionRefusalText(QUOTE_EDIT_PERMISSION), StatusTone.INFO) },
            enabled = !busy && sending == null, modifier = Modifier.testTag("quote-start-revision")) { Text("Start revision ${revision + 1}") }
        }
        Text("Up to $QUOTE_MAX_PROOFS files, ${formatVisitorUploadBytes(VISITOR_UPLOAD_MAX_BYTES.toLong())} each.", style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
  }

  if (revision > 1) {
    SectionCard("Earlier revisions") {
      Column(verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
        historyError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (history == null && historyError == null) CircularProgressIndicator(Modifier.size(20.dp))
        history.orEmpty().filter { it.revision < revision }.reversed().forEach { entry ->
          Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
            Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
              Text("Revision ${entry.revision}", fontWeight = FontWeight.SemiBold)
              StatusChip(QuoteStage.entries.firstOrNull { it.raw == entry.stage }?.let { QUOTE_STAGE_LABELS[it] } ?: entry.stage)
              Text("Replaced ${quoteTime(entry.closedAtMs)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (entry.proofs.isEmpty()) Text("No proofs.", color = MaterialTheme.colorScheme.onSurfaceVariant)
            entry.proofs.forEach { FileRow(context, quoteId, it, entry.revision, ::download) }
            entry.responses.forEach { (response, files) -> ResponseNote(response, files) { file -> FileRow(context, quoteId, file, entry.revision, ::download) } }
          }
        }
      }
    }
  }

  quote?.request?.let { request ->
    val files = quote.requestFiles.orEmpty().map { QuoteListedFile(it.id, it.name, it.contentType, it.size.toLong()) }
    val whenSent = request.receivedAtMs?.let { " on ${quoteTime(it)}" }.orEmpty()
    SectionCard("From the request") {
      Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
        Text("Sent through “${request.formName}”$whenSent." + if (files.isEmpty()) " They sent no files." else " The files they sent:", color = MaterialTheme.colorScheme.onSurfaceVariant)
        files.forEach { FileRow(context, quoteId, it, null, ::download) }
      }
    }
  }

  if (choosingFromLibrary) {
    MediaChooserDialog(context, onChoose = { chosen ->
      choosingFromLibrary = false
      addFromLibrary(chosen)
    }, onDismiss = { choosingFromLibrary = false }, kind = null, allowPrivate = true)
  }
  if (confirmingRevision) {
    AlertDialog(
      onDismissRequest = { if (!busy) confirmingRevision = false },
      title = { Text("Start revision ${revision + 1}?") },
      text = {
        Text("Revision $revision is kept as it is now, with its proofs and the customer’s answers. Revision ${revision + 1} starts with no proofs, ready for new ones and any changes to the quote.")
      },
      confirmButton = {
        TextButton(onClick = {
          act("start-revision", emptyMap(), "The revision could not be started") { answer ->
            confirmingRevision = false
            val next = (answer?.get("revision") as? JsonPrimitive)?.doubleOrNull?.toInt() ?: (revision + 1)
            onNotice("Revision $next started", StatusTone.SUCCESS)
          }
        }, enabled = !busy, modifier = Modifier.testTag("quote-start-revision-confirm")) { Text("Start revision ${revision + 1}") }
      },
      dismissButton = { TextButton(onClick = { confirmingRevision = false }, enabled = !busy) { Text("Cancel") } },
    )
  }
}

/** A file: a picture for an image, its name and size for anything else; both download it. */
@Composable
private fun FileRow(
  context: NativePluginContext, quoteId: String, file: QuoteListedFile, fromRevision: Int?, onDownload: (QuoteListedFile, Int?) -> Unit,
  onRemove: (() -> Unit)? = null,
) {
  Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    if (visitorUploadIsInline(file.contentType)) {
      val picture by produceState<ImageBitmap?>(null, file.id, fromRevision) {
        value = fetchQuoteFile(context, quoteId, file.id, fromRevision)?.bytes?.let(::decodeImageBytes)
      }
      Box(
        Modifier.size(128.dp, 96.dp).clip(RoundedCornerShape(8.dp)).background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
      ) {
        picture?.let { Image(it, file.name, Modifier.fillMaxWidth(), contentScale = ContentScale.Fit) } ?: CircularProgressIndicator(Modifier.size(20.dp))
      }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
      TextButton(onClick = { onDownload(file, fromRevision) }) { Text("${file.name} · ${formatVisitorUploadBytes(file.size)}") }
      onRemove?.let { TextButton(onClick = it) { Text("Remove", color = MaterialTheme.colorScheme.error) } }
    }
  }
}

/** What the customer said, with any files they sent (the console's QuoteResponseNote). */
@Composable
private fun ResponseNote(response: QuoteCustomerResponse, files: List<QuoteListedFile>, fileRow: @Composable (QuoteListedFile) -> Unit) {
  val approved = response.action == QuoteCustomerResponseAction.APPROVE
  val tone = if (approved) StatusTone.SUCCESS else StatusTone.WARNING
  Column(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
      .background(if (approved) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.4f) else MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.4f))
      .padding(space(1.5f)).testTag("quote-response-${tone.name.lowercase()}"),
    verticalArrangement = Arrangement.spacedBy(space(0.5f)),
  ) {
    Text(quoteResponseHeadline(response) { quoteTime(it) })
    if (approved) {
      response.confirmed?.takeIf { it.isNotEmpty() }?.let { confirmed ->
        Text("They confirmed:")
        confirmed.forEach { Text("• $it") }
      }
      listOfNotNull(response.ip?.let { "From $it" }, response.userAgent).filter { it.isNotEmpty() }.joinToString(" · ").takeIf { it.isNotEmpty() }?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    } else {
      Text(response.comment.orEmpty())
      files.forEach { fileRow(it) }
    }
  }
}
