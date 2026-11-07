// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import SwiftUI

/*
 * Start a quote from somewhere else (AGL-4098), as the console's quote-start.component.tsx has it: two widgets in other
 * plugins' zones, each a button that opens the quote editor already filled in.
 *
 *  - on an open submission in the Inbox (`inboxSubmissionActions`), for a quote request: the editor asks the quote
 *    route for the request's prefill (`start-from-request`), which reads the request for the member asking;
 *  - in a contact's header in the CRM (`crmRecordActions`): the person as the page shows them is the quote's customer.
 *
 * Either way the quote is the editor's ordinary new quote, saved by the ordinary create under "Create and edit quotes".
 * The zones pass what the console's do, as `slotProps`; this plugin never imports the Inbox or the CRM.
 */

let inboxSubmissionActionsZone = "inboxSubmissionActions"
let crmRecordActionsZone = "crmRecordActions"

/// The editor over the store's products and settings, read while it is open.
private struct QuoteStartSheet: View {
  let context: NativePluginContext
  let hostID: String
  let start: QuoteEditorStart
  let onDone: (String) -> Void
  @State private var products = LiveQuery()
  @State private var store = LiveDocument()

  var body: some View {
    QuoteEditorSheet(
      context: context, quoteID: nil, order: nil, productList: quoteProducts(products.state),
      storeData: quoteStoreData(store.state), start: start
    ) { message, _ in onDone(message) }
    .task(id: hostID) {
      products.start(context.firestore, FirestoreQuery(["hosts", hostID, "products"], limit: quoteProductWindow + 1))
      store.start(context.firestore, ["hosts", hostID, "settings", "store"])
    }
    .onDisappear {
      products.stop()
      store.stop()
    }
  }
}

/// "Start a quote" on an open quote request in the Inbox. Only a quote request has a quote to start.
struct QuoteStartFromRequestWidget: View {
  let context: NativePluginContext
  @Environment(\.slotProps) private var props
  @State private var busy = false
  @State private var start: QuoteEditorStart?
  @State private var notice: (text: String, tone: AglynTone)?

  private var hostID: String { props["hostId"] ?? context.hostID ?? "" }

  var body: some View {
    if props["requestKind"] == "quote", !hostID.isEmpty, let submissionID = props["submissionId"] {
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        Button(busy ? "Starting…" : "Start a quote") { Task { await open(submissionID) } }
          .buttonStyle(.bordered)
          .disabled(busy)
          .accessibilityIdentifier("quote-start-from-request")
        if let notice { AglynNotice(notice.text, tone: notice.tone) { self.notice = nil } }
      }
      .sheet(item: $start) { start in
        QuoteStartSheet(context: context, hostID: hostID, start: start) { message in notice = (message, .success) }
      }
    }
  }

  private func open(_ submissionID: String) async {
    busy = true
    defer { busy = false }
    do {
      let answer = try await context.api.request(
        "/api/commerce/quote", method: .post,
        body: .object([
          "action": .string("start-from-request"), "hostId": .string(hostID), "submissionId": .string(submissionID),
        ]))
      start = QuoteEditorStart.request(submissionID: submissionID, answer: answer)
    } catch let error as ConsoleAPIError {
      notice = (error.body?["error"]?.stringValue ?? "The quote could not be started", .error)
    } catch {
      notice = ("The quote could not be started", .error)
    }
  }
}

/// "Start a quote" in a contact's header in the CRM. A quote is a site's: at the organization level with no site, there
/// is none to start.
struct QuoteStartFromContactWidget: View {
  let context: NativePluginContext
  @Environment(\.slotProps) private var props
  @State private var start: QuoteEditorStart?
  @State private var notice: String?

  private var hostID: String { props["hostId"] ?? "" }

  var body: some View {
    if !hostID.isEmpty, let recordID = props["recordId"] {
      VStack(alignment: .leading, spacing: AglynSpace.one) {
        Button("Start a quote") {
          start = .contact(
            kind: props["kind"] ?? "contact", recordID: recordID, name: props["name"] ?? "", email: props["email"] ?? "",
            phone: props["phone"] ?? "", company: props["company"] ?? "")
        }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("quote-start-from-contact")
        if let notice { AglynNotice(notice, tone: .success) { self.notice = nil } }
      }
      .sheet(item: $start) { start in
        QuoteStartSheet(context: context, hostID: hostID, start: start) { message in notice = message }
      }
    }
  }
}
