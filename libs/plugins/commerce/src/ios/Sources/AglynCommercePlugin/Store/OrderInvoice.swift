// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * An order's invoice, as the console's Invoice menu has it: the PDF the console downloads, and the
 * email with that PDF attached. The route decides what can be sent; these are the words and the
 * prefill the console's form uses (`commerce-invoices.ts`, `invoice-send.component.tsx`).
 */

let orderInvoiceSendRoute = "/api/commerce/order-invoice-send"
let invoiceSendPermission = "commerce.quotes.send"
private let invoiceSubjectLimit = 200
private let invoiceMessageLimit = 5000

/// `Invoice #1042`: the order's own number, which a paid quote keeps too.
func formatInvoiceNumber(_ order: HostOrder, orderID: String) -> String {
  "Invoice \(formatOrderNumber(order, docId: orderID))"
}

/// The order is paid (and not refunded or canceled): its invoice is the record.
func invoiceIsPaid(_ order: HostOrder) -> Bool {
  [.paid, .partiallyFulfilled, .fulfilled, .delivered].contains(order.status)
}

/// The last time the order's invoice was emailed.
func lastInvoiceSend(_ order: HostOrder) -> OrderInvoiceSendRecord? { order.invoiceSends?.last }

/// Who the form addresses first: the order's customer, a quote's, or whoever the last send went to.
func invoiceSendPrefill(_ order: HostOrder) -> String {
  let candidates = [order.customerEmail, order.quote?.customer.email, lastInvoiceSend(order)?.to, order.quote?.sends?.last?.to]
  return candidates.lazy.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }.first { !$0.isEmpty } ?? ""
}

/// The email conversation the invoice joins: a quote's, else the order's own.
func invoiceEmailThread(_ order: HostOrder) -> QuoteEmailThread? {
  order.quote != nil ? order.quote?.emailThread : order.emailThread
}

/// The subject the form starts with: the conversation's, so the email joins it, else the invoice and the business.
func invoiceEmailDefaultSubject(_ order: HostOrder, businessName: String, orderID: String) -> String {
  let thread = invoiceEmailThread(order)?.subject.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  if !thread.isEmpty { return thread }
  let name = businessName.trimmingCharacters(in: .whitespacesAndNewlines)
  let number = formatInvoiceNumber(order, orderID: orderID)
  return name.isEmpty ? number : "\(number) from \(name)"
}

/// `Invoice sent Oct 29, 2026, 3:04 PM to jordan@example.com.`, in this device's time. Nil when none was sent.
func invoiceSentLine(_ order: HostOrder, timeZone: String = TimeZone.current.identifier) -> String? {
  guard let last = lastInvoiceSend(order) else { return nil }
  let to = last.to.isEmpty ? "the customer" : last.to
  return "\(last.paid ? "Paid invoice" : "Invoice") sent \(formatReceiptTime(Int64(last.atMs), timeZone: timeZone)) to \(to)."
}

/// A register sale rung offline, said on its order: when it was rung and synced, and what the sync found to check.
/// Nil on any other order (the console's `OrderOfflineNotice`).
func orderOfflineNotice(_ order: HostOrder, timeZone: String = TimeZone.current.identifier) -> (text: String, needsCheck: Bool)? {
  guard let stamp = order.offline else { return nil }
  func at(_ ms: Double) -> String { formatReceiptTime(Int64(ms), timeZone: timeZone) }
  let checks =
    (stamp.stockConflicts ?? []).map { "\(Int64($0.shortUnits)) of \(Int64($0.requested))× \($0.name) not in stock" }
    + stamp.flags.filter { $0 != .stockShort }.map { ContractValues.shared.posOfflineFlagLabels[$0.rawValue] ?? $0.rawValue }
  let lines = ["Rung while the register was offline", "Rung \(at(stamp.soldAtMs)), synced \(at(stamp.syncedAtMs))."] + checks
  return (lines.joined(separator: "\n"), !checks.isEmpty)
}

/// What the form's small print says about the email, and where replies go.
func invoiceSendNote(paid: Bool, contact: String?) -> String {
  let what =
    paid
    ? "The email shows the invoice as paid, with the date it was paid, for your customer’s records. "
    : "The email shows the invoice number, date, total and what is due, with a button to pay it by card on your site. "
      + "The button keeps working until it is paid. "
  return what + "The invoice is attached as a PDF. Replies go to \(contact ?? "your email")."
}

/// The name the business goes by, and the address its customers write to, off the site's document.
func invoiceSiteDetails(_ data: [String: Any]?) -> (businessName: String, contact: String?) {
  func text(_ value: Any?) -> String { ((value as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
  let entity = (data?["seo"] as? [String: Any])?["entity"] as? [String: Any]
  let name = [text(entity?["name"]), text(data?["displayName"])].first { !$0.isEmpty } ?? ""
  let listed =
    [text(entity?["email"]), text((data?["business"] as? [String: Any])?["supportEmail"])].first { !$0.isEmpty } ?? ""
  let isAddress = listed.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
  return (name, isAddress ? listed : nil)
}

/// Emails the invoice. One `attemptKey` per form content, so a press after a lost answer finds the first send.
func sendOrderInvoice(
  api: ConsoleAPIClient, hostID: String, orderID: String, to: String, subject: String, message: String, attemptKey: String
) async throws -> String {
  let answer = try await api.request(
    orderInvoiceSendRoute, method: .post,
    body: .object([
      "hostId": .string(hostID), "orderId": .string(orderID), "to": .string(to), "subject": .string(subject),
      "message": .string(message),
    ]), idempotencyKey: attemptKey)
  return answer?["to"]?.stringValue ?? to
}

/// Brings the invoice's PDF down into a temporary file for the share sheet.
func downloadOrderInvoicePDF(api: ConsoleAPIClient, hostID: String, orderID: String, number: String) async throws -> URL {
  let file = try await api.download(
    "/api/commerce/order-print", method: .get,
    query: [("hostId", hostID), ("orderId", orderID), ("kind", "invoice-pdf")])
  let named = ((file.name ?? "") as NSString).lastPathComponent
  let url = FileManager.default.temporaryDirectory.appendingPathComponent(named.isEmpty ? "\(number).pdf" : named)
  try file.data.write(to: url)
  return url
}

/// A downloaded invoice waiting on the share sheet.
struct DownloadedInvoice: Identifiable {
  let url: URL
  var id: URL { url }
}

/// Hands the downloaded PDF to the share sheet.
struct DownloadedInvoiceSheet: View {
  let file: DownloadedInvoice
  let close: () -> Void

  var body: some View {
    NavigationStack {
      VStack(spacing: AglynSpace.two) {
        Label(file.url.lastPathComponent, systemImage: "doc").font(AglynFont.body)
        ShareLink(item: file.url) { Label("Share…", systemImage: "square.and.arrow.up") }
          .buttonStyle(.aglynProminent)
          .accessibilityIdentifier("order-invoice-share")
      }
      .padding(AglynSpace.two)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done", action: close) } }
    }
    .presentationDetents([.medium])
  }
}

/// The console's Send invoice form: who it goes to, the subject and a message of the member's own.
struct InvoiceSendSheet: View {
  let context: NativePluginContext
  let order: HostOrder
  let orderID: String
  let sent: (String) -> Void
  @State private var to = ""
  @State private var subject = ""
  @State private var message = ""
  @State private var contact: String?
  @State private var attemptKey = UUID().uuidString

  private var number: String { formatInvoiceNumber(order, orderID: orderID) }
  private var trimmedTo: String { to.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    AglynFormSheet(
      "Send invoice: \(number)", confirm: "Send", canConfirm: !trimmedTo.isEmpty,
      save: {
        guard let hostID = context.hostID else { return }
        do {
          let address = try await sendOrderInvoice(
            api: context.api, hostID: hostID, orderID: orderID, to: trimmedTo, subject: subject, message: message,
            attemptKey: attemptKey)
          sent("\(number) sent to \(address)")
        } catch let error as ConsoleAPIError where error.status > 0 && error.status < 500 {
          // A definitive refusal: the next press is a new attempt.
          attemptKey = UUID().uuidString
          throw SheetFailure(message: error.message)
        } catch {
          // Not known whether it went: the same key finds the first send on the next press.
          throw SheetFailure(message: "It is not known whether the invoice went. Trying again is safe; it will not send twice.")
        }
      }
    ) {
      Section {
        TextField("To", text: $to)
          .autocorrectionDisabled()
          .accessibilityIdentifier("order-invoice-to")
          #if os(iOS)
            .textInputAutocapitalization(.never)
            .keyboardType(.emailAddress)
          #endif
      }
      Section {
        TextField("Subject", text: $subject)
          .accessibilityIdentifier("order-invoice-subject")
      } footer: {
        if invoiceEmailThread(order) != nil {
          Text("Keep the subject the same to keep these emails in one conversation in your customer’s inbox.")
        }
      }
      Section {
        TextField("Message", text: $message, axis: .vertical)
          .lineLimit(4...)
          .accessibilityIdentifier("order-invoice-message")
      } footer: {
        Text("Shown at the top of the email, in your words.")
      }
      Section {
      } footer: {
        Text(invoiceSendNote(paid: invoiceIsPaid(order), contact: contact))
      }
    }
    .onChange(of: to) { _, _ in attemptKey = UUID().uuidString }
    .onChange(of: subject) { _, next in
      if next.count > invoiceSubjectLimit { subject = String(next.prefix(invoiceSubjectLimit)) }
      attemptKey = UUID().uuidString
    }
    .onChange(of: message) { _, next in
      if next.count > invoiceMessageLimit { message = String(next.prefix(invoiceMessageLimit)) }
      attemptKey = UUID().uuidString
    }
    .task {
      to = invoiceSendPrefill(order)
      subject = invoiceEmailDefaultSubject(order, businessName: "", orderID: orderID)
      guard let hostID = context.hostID else { return }
      let site = invoiceSiteDetails(await readHostDocument(context, hostID: hostID))
      // Filled once per opening; edits after that are the member's.
      if subject == invoiceEmailDefaultSubject(order, businessName: "", orderID: orderID) {
        subject = invoiceEmailDefaultSubject(order, businessName: site.businessName, orderID: orderID)
      }
      contact = site.contact
    }
  }
}

/// The site's document, once.
@MainActor
private func readHostDocument(_ context: NativePluginContext, hostID: String) async -> [String: Any]? {
  final class Once {
    var listener: FirestoreListening?
    var answered = false
  }
  let once = Once()
  let host: FirestoreDocument? = await withCheckedContinuation { continuation in
    once.listener = context.firestore.listenDocument(["hosts", hostID]) { result in
      guard !once.answered else { return }
      once.answered = true
      once.listener?.remove()
      if case .success(let doc) = result { continuation.resume(returning: doc) } else { continuation.resume(returning: nil) }
    }
    if once.answered { once.listener?.remove() }
  }
  return host?.data
}
