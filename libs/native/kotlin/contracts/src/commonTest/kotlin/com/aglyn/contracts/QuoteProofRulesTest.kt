package com.aglyn.contracts

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The console's visitor-upload and commerce-quote-proofs spec cases, as the apps read them. */
class QuoteProofRulesTest {
  private fun quote(revision: Int = 1, proofs: Int = 0, answered: Boolean = false) = OrderQuote(
    createdAtMs = 0.0, createdBy = "u", customer = QuoteCustomer(), revision = revision.toDouble(), stage = QuoteStage.SENT,
    tax = QuoteTaxBasis(kind = QuoteTaxKind.NONE), updatedAtMs = 0.0, updatedBy = "u",
    proofs = List(proofs) { QuoteProof(addedAtMs = 0.0, addedBy = "u", contentType = "image/png", id = "p$it", name = "p.png", path = "x", revision = revision.toDouble(), size = 1.0) },
    responses = if (answered) listOf(QuoteCustomerResponse(action = QuoteCustomerResponseAction.APPROVE, atMs = 1.0, revision = revision.toDouble(), name = "Robin")) else null,
  )

  private fun order(quote: OrderQuote, status: OrderStatus = OrderStatus.PENDING) = HostOrder(channel = OrderChannel.QUOTE, status = status, quote = quote, lineItems = emptyList())

  @Test
  fun drawsOnlyRasterImages() {
    assertTrue(listOf("image/png", "image/jpeg", "image/webp", "image/gif").all(::visitorUploadIsInline))
    listOf("image/svg+xml", "application/pdf", "application/illustrator", "image/tiff", "text/html").forEach { assertFalse(visitorUploadIsInline(it)) }
  }

  @Test
  fun refusesOneByteOverAnEmptyFileAndATypeItDoesNotTake() {
    assertEquals("big.pdf is 25 MB. Files can be up to 25 MB.", checkVisitorUploadRequest("big.pdf", "application/pdf", VISITOR_UPLOAD_MAX_BYTES + 1L))
    assertEquals("empty.pdf is empty.", checkVisitorUploadRequest("empty.pdf", "application/pdf", 0))
    assertEquals("run.exe can't be sent. Send a PNG, JPEG, WebP, GIF, PDF, SVG, AI, EPS, PSD or TIFF file.", checkVisitorUploadRequest("run.exe", "", 10))
    assertNull(checkVisitorUploadRequest("Logo.PNG", "image/png", VISITOR_UPLOAD_MAX_BYTES.toLong()))
  }

  @Test
  fun checksASelectionForTheCountAsWellAsEachFile() {
    val file = PickedUpload("a.png", "image/png", 10)
    assertNull(checkVisitorUploadSelection(listOf(file, file), 8))
    assertEquals("Send up to 10 files at a time.", checkVisitorUploadSelection(listOf(file, file, file), 8))
    assertTrue(checkVisitorUploadSelection(listOf(PickedUpload("a.txt", "text/plain", 1)), 0)!!.contains("can't be sent"))
  }

  @Test
  fun sizesReadAsTheConsoleWritesThem() {
    assertEquals("0 KB", formatVisitorUploadBytes(0))
    assertEquals("1 KB", formatVisitorUploadBytes(300))
    assertEquals("340 KB", formatVisitorUploadBytes(340L * 1024))
    assertEquals("2.5 MB", formatVisitorUploadBytes(2_621_440))
    assertEquals("3 MB", formatVisitorUploadBytes(3L * 1024 * 1024))
    assertEquals("25 MB", formatVisitorUploadBytes(25L * 1024 * 1024))
  }

  @Test
  fun proofsChangeOnlyOnAnUnpaidUnansweredRevisionWithRoom() {
    assertNull(quoteProofChangeRefusal(order(quote()), adding = true))
    assertEquals("A revision holds up to 10 proofs. Remove one first.", quoteProofChangeRefusal(order(quote(proofs = 10)), adding = true))
    assertNull(quoteProofChangeRefusal(order(quote(proofs = 10)), adding = false))
    assertEquals("The customer has answered this revision. Start a new revision to send different proofs.", quoteProofChangeRefusal(order(quote(answered = true)), adding = false))
    assertEquals("This quote has been paid, so its proofs can no longer be changed.", quoteProofChangeRefusal(order(quote(), OrderStatus.PAID), adding = true))
  }

  @Test
  fun aLibraryFileMustBeAKindAProofCanBe() {
    assertNull(quoteLibraryProofProblem("Banner.png", "image/png", "m1", "hosts/site1"))
    assertEquals("That file can’t be used as a proof. Choose another.", quoteLibraryProofProblem("Banner.png", "image/png", "", "hosts/site1"))
    assertEquals("Clip.mp4 can’t be used as a proof. Choose an image or a PDF.", quoteLibraryProofProblem("Clip.mp4", "video/mp4", "m1", "hosts/site1"))
  }

  @Test
  fun theCustomersAnswerReadsAsTheConsoleSaysIt() {
    val at = { ms: Double -> "at ${ms.toLong()}" }
    assertEquals("Approved by Robin on at 1.", quoteResponseHeadline(QuoteCustomerResponse(action = QuoteCustomerResponseAction.APPROVE, atMs = 1.0, revision = 1.0, name = "Robin"), at))
    assertEquals("Rejected with changes on at 2:", quoteResponseHeadline(QuoteCustomerResponse(action = QuoteCustomerResponseAction.CHANGES, atMs = 2.0, revision = 1.0), at))
  }
}
