// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import SwiftUI

/*
 * Emailing a quote to the customer and its pay link (AGL-4097, AGL-4094), as the console's QuoteSendSection and
 * QuotePayLinkSection have them: when it was last sent and to whom, Send quote / Send again / Send revision N with a
 * short form (To, Subject, Message), Send invoice beside it, and the pay link the business copies or replaces. The
 * server writes and sends the email and signs the link (`POST /api/commerce/quote` send, pay-link, replace-link).
 */

let quoteSendPermission = "commerce.quotes.send"

/// The pay link as the server made it, with the link version it was made at.
struct SignedQuoteLink: Equatable {
  let url: String
  let version: Int
}

/// Asks the server for the quote's pay link, or for a new one (`pay-link`, `replace-link`).
func requestQuoteLink(
  api: ConsoleAPIClient, hostID: String, quoteID: String, replace: Bool, fallbackVersion: Int
) async throws -> SignedQuoteLink {
  let answer = try await api.request(
    "/api/commerce/quote", method: .post,
    body: .object([
      "action": .string(replace ? "replace-link" : "pay-link"), "hostId": .string(hostID), "quoteId": .string(quoteID),
    ]))
  guard let url = answer?["url"]?.stringValue, !url.isEmpty else {
    throw ConsoleAPIError(status: 500, message: answer?["error"]?.stringValue ?? "")
  }
  let made = answer?["linkVersion"]?.numberValue.map { Int($0.rounded(.down)) } ?? fallbackVersion
  return SignedQuoteLink(url: url, version: made >= 1 ? made : fallbackVersion)
}

/// The send form: To, Subject and Message, what the customer's Pay waits on, and what the email shows.
struct QuoteSendSheet<Notice: View>: View {
  let context: NativePluginContext
  let order: HostOrder
  let quoteID: String
  let businessName: String
  let contact: String?
  @ViewBuilder let readiness: () -> Notice
  /// "Quote #3 sent to jane@example.com", and what became of the earlier link.
  let sent: (String) -> Void

  @State private var to: String
  @State private var subject: String
  @State private var message = ""
  @State private var attemptKey = UUID().uuidString

  init(
    context: NativePluginContext, order: HostOrder, quoteID: String, businessName: String, contact: String?,
    @ViewBuilder readiness: @escaping () -> Notice, sent: @escaping (String) -> Void
  ) {
    self.context = context
    self.order = order
    self.quoteID = quoteID
    self.businessName = businessName
    self.contact = contact
    self.readiness = readiness
    self.sent = sent
    _to = State(initialValue: quoteSendPrefill(order))
    _subject = State(initialValue: quoteEmailDefaultSubject(order, businessName: businessName, quoteId: quoteID))
  }

  private var label: String { quoteSendLabel(order.quote, proofOnly: quoteIsProofOnly(order)) }
  private var number: String { formatQuoteNumber(order, docId: quoteID) }

  var body: some View {
    AglynFormSheet(
      "\(label): \(number)", confirm: "Send", working: "Sending…", canConfirm: !to.trimmingCharacters(in: .whitespaces).isEmpty, save: send
    ) {
      readiness()
      Section {
        QuoteLabeledField(label: "To", text: $to)
          .autocorrectionDisabled()
          #if os(iOS)
            .keyboardType(.emailAddress).textInputAutocapitalization(.never)
          #endif
          .accessibilityIdentifier("quote-send-to")
        QuoteLabeledField(
          label: "Subject", text: Binding(get: { subject }, set: { subject = String($0.prefix(quoteMaxSendSubject)) }))
      } footer: {
        if order.quote?.emailThread != nil {
          Text("Keep the subject the same to keep these emails in one conversation in your customer’s inbox.")
        }
      }
      Section {
        TextField(
          "Message", text: Binding(get: { message }, set: { message = String($0.prefix(quoteMaxSendMessage)) }),
          axis: .vertical
        )
        .lineLimit(4...10)
      } footer: {
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          Text("Shown at the top of the email, in your words.")
          Text(quoteSendNote(order, contact: contact))
          if quoteSendReplacesLink(order.quote) {
            Text("This sends a new pay link. The link in your earlier email will say the quote was updated.")
          }
        }
      }
    }
    .onChange(of: [to, subject, message]) { _, _ in attemptKey = UUID().uuidString }
  }

  private func send() async throws {
    let answer: JSONValue?
    do {
      answer = try await context.api.request(
        "/api/commerce/quote", method: .post,
        body: .object([
          "action": .string("send"), "hostId": .string(context.hostID ?? ""), "quoteId": .string(quoteID),
          "to": .string(to), "subject": .string(subject), "message": .string(message),
        ]), idempotencyKey: attemptKey)
    } catch let error as ConsoleAPIError {
      throw ConsoleAPIError(status: error.status, message: error.body?["error"]?.stringValue ?? "The quote could not be sent")
    }
    let address = answer?["to"]?.stringValue ?? to
    let replaced = answer?["linkReplaced"]?.boolValue == true
    sent("\(number) sent to \(address)" + (replaced ? ". The link in your earlier email no longer opens the quote." : ""))
  }
}
