package com.aglyn.contracts

import kotlin.math.floor
import kotlin.math.max

/*
 * The console's rules for a quote's proofs and revisions (AGL-4096, AGL-4184) and the file kinds a proof may be,
 * ported once from libs/plugins/commerce/src/lib/model/commerce-quote-proofs.ts,
 * libs/aglyn/src/lib/app-utils/visitor-upload.ts and components/console/quote-proofs.component.tsx, as the Swift kit's
 * QuoteProofRules.swift. Held to the console's own spec cases in QuoteProofRulesTest.
 */

/** The most proofs a revision holds (`QUOTE_MAX_PROOFS`). */
const val QUOTE_MAX_PROOFS = 10

/** The largest file a proof may be (`VISITOR_UPLOAD_MAX_BYTES`). */
const val VISITOR_UPLOAD_MAX_BYTES = 25 * 1024 * 1024

/** A kind of file a proof may be (`VisitorUploadType`). [inline]: shown as a picture; everything else downloads. */
data class VisitorUploadType(val contentType: String, val extensions: List<String>, val label: String, val inline: Boolean, val aliases: List<String> = emptyList())

/** Every kind a proof may be (`VISITOR_UPLOAD_TYPES`). */
val VISITOR_UPLOAD_TYPES: List<VisitorUploadType> = listOf(
  VisitorUploadType("image/png", listOf(".png"), "PNG", true),
  VisitorUploadType("image/jpeg", listOf(".jpg", ".jpeg"), "JPEG", true, listOf("image/jpg", "image/pjpeg")),
  VisitorUploadType("image/webp", listOf(".webp"), "WebP", true),
  VisitorUploadType("image/gif", listOf(".gif"), "GIF", true),
  VisitorUploadType("application/pdf", listOf(".pdf"), "PDF", false, listOf("application/x-pdf")),
  VisitorUploadType("image/svg+xml", listOf(".svg"), "SVG", false),
  VisitorUploadType("application/illustrator", listOf(".ai"), "AI", false, listOf("application/postscript", "application/pdf", "application/vnd.adobe.illustrator")),
  VisitorUploadType("application/postscript", listOf(".eps"), "EPS", false, listOf("application/eps", "image/eps", "image/x-eps", "application/x-eps")),
  VisitorUploadType("image/vnd.adobe.photoshop", listOf(".psd"), "PSD", false, listOf("application/x-photoshop", "application/photoshop", "application/psd", "image/psd", "image/x-photoshop")),
  VisitorUploadType("image/tiff", listOf(".tif", ".tiff"), "TIFF", false, listOf("image/x-tiff")),
)

private val UNKNOWN_UPLOAD_TYPES = setOf("", "application/octet-stream", "binary/octet-stream", "application/unknown")

/** The kind a stored content type is (`visitorUploadTypeOf`). */
fun visitorUploadTypeOf(contentType: String): VisitorUploadType? = VISITOR_UPLOAD_TYPES.firstOrNull { it.contentType == contentType }

/** Whether a file is shown as a picture (`visitorUploadIsInline`). */
fun visitorUploadIsInline(contentType: String): Boolean = visitorUploadTypeOf(contentType)?.inline == true

/** The kind a picked file is taken as, by its name and the type the device reported (`resolveVisitorUploadType`). */
fun resolveVisitorUploadType(name: String, reportedType: String): VisitorUploadType? {
  val dot = name.lastIndexOf('.')
  val ext = if (dot > 0) name.substring(dot).lowercase() else ""
  val reported = reportedType.split(';').first().trim().lowercase()
  val byName = VISITOR_UPLOAD_TYPES.firstOrNull { ext in it.extensions } ?: return null
  if (reported in UNKNOWN_UPLOAD_TYPES || reported == byName.contentType) return byName
  return if (reported in byName.aliases) byName else null
}

private fun jsRound(value: Double): Double = floor(value + 0.5)

/** `340 KB`, `2.5 MB`, `25 MB` (`formatVisitorUploadBytes`). */
fun formatVisitorUploadBytes(bytes: Long): String {
  if (bytes <= 0) return "0 KB"
  if (bytes < 1024 * 1024) return "${max(1L, jsRound(bytes / 1024.0).toLong())} KB"
  val mb = bytes / (1024.0 * 1024.0)
  if (mb >= 10) return "${jsRound(mb).toLong()} MB"
  val tenths = jsRound(mb * 10) / 10
  return if (tenths == floor(tenths)) "${tenths.toLong()} MB" else "$tenths MB"
}

/** What is wrong with one picked file, or null (`checkVisitorUploadRequest`). */
fun checkVisitorUploadRequest(name: String, contentType: String, size: Long): String? {
  val shown = name.split('/', '\\').last().trim().ifEmpty { "This file" }
  if (resolveVisitorUploadType(name, contentType) == null) {
    val labels = VISITOR_UPLOAD_TYPES.map { it.label }
    return "$shown can't be sent. Send a ${labels.dropLast(1).joinToString(", ")} or ${labels.last()} file."
  }
  if (size <= 0) return "$shown is empty."
  if (size > VISITOR_UPLOAD_MAX_BYTES) {
    return "$shown is ${formatVisitorUploadBytes(size)}. Files can be up to ${formatVisitorUploadBytes(VISITOR_UPLOAD_MAX_BYTES.toLong())}."
  }
  return null
}

/** One picked file as the checks read it. */
data class PickedUpload(val name: String, val contentType: String, val size: Long)

/** What is wrong with the files picked to add to the [already] there, or null (`checkVisitorUploadSelection`). */
fun checkVisitorUploadSelection(files: List<PickedUpload>, already: Int, maxFiles: Int = QUOTE_MAX_PROOFS): String? {
  if (already + files.size > maxFiles) return if (maxFiles == 1) "Send one file." else "Send up to $maxFiles files at a time."
  return files.firstNotNullOfOrNull { checkVisitorUploadRequest(it.name, it.contentType, it.size) }
}

/** Whether the customer has answered the current revision (`quoteRevisionAnswered`). */
fun quoteRevisionAnswered(quote: OrderQuote?): Boolean = latestQuoteResponse(quote) != null

/**
 * Why the proofs can't be added to or removed from now, as the console says it (`quoteProofChangeRefusal` and
 * `quoteProofRefusalMessage`); null when they can.
 */
fun quoteProofChangeRefusal(order: HostOrder?, adding: Boolean): String? {
  val quote = order?.quote
  if (order == null || order.channel != OrderChannel.QUOTE || quote == null) return "Unknown quote"
  if (!isUnpaidQuote(order)) return "This quote has been paid, so its proofs can no longer be changed."
  if (quoteRevisionAnswered(quote)) return "The customer has answered this revision. Start a new revision to send different proofs."
  if (adding && currentQuoteProofs(quote).size >= QUOTE_MAX_PROOFS) return "A revision holds up to $QUOTE_MAX_PROOFS proofs. Remove one first."
  return null
}

/** What is wrong with a media library file chosen for a proof, before it is sent (`quoteLibraryProofProblem`). */
fun quoteLibraryProofProblem(fileName: String, contentType: String, mediaId: String, mediaScope: String): String? {
  if (mediaId.isEmpty() || mediaScope.isEmpty()) return "That file can’t be used as a proof. Choose another."
  if (contentType.isNotEmpty() && visitorUploadTypeOf(contentType) == null) {
    return "${fileName.ifEmpty { "That file" }} can’t be used as a proof. Choose an image or a PDF."
  }
  return null
}

/** What the Proofs section says the customer sees (the console's QuoteProofsSection). */
fun quoteProofsExplanation(order: HostOrder?): String {
  val quote = order?.quote
  val first = when {
    quoteIsProofOnly(order) -> "The customer sees these on the proof page, with no prices, and can approve them or reject them with changes."
    quote?.requireProofApproval == true -> "The customer sees these on the quote page and approves them before they can pay."
    else -> "The customer sees these on the quote page, and can approve them or reject them with changes. Paying doesn’t wait on it."
  }
  val signIn = if (quote?.requireProofSignIn == true) " A customer with an account on your site signs in to see them; one without uses the private link." else ""
  return "$first To approve, they tick each statement from your Quotes settings and type their name.$signIn"
}

/** What the Proofs section says when the revision has none (the console's QuoteProofsSection). */
fun quoteNoProofsMessage(order: HostOrder?): String =
  if (quoteIsProofOnly(order)) "No proof on this revision yet, so there is nothing to send. Add one for the customer to approve, or add items to the quote."
  else "No proofs on this revision yet. Add an image, a PDF or a design file for the customer to approve."

/** The first line of the customer's answer (the console's QuoteResponseNote). [at] formats a time as the console does. */
fun quoteResponseHeadline(response: QuoteCustomerResponse, at: (Double) -> String): String {
  val name = response.name.orEmpty().trim()
  return if (response.action == QuoteCustomerResponseAction.APPROVE) "Approved by ${name.ifEmpty { "the customer" }} on ${at(response.atMs)}."
  else "Rejected with changes${if (name.isEmpty()) "" else " by $name"} on ${at(response.atMs)}:"
}
