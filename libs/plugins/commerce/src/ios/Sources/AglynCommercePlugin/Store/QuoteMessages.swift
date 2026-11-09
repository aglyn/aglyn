// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import SwiftUI

/*
 * The quote's conversation with its customer (AGL-4207), as the console's QuoteMessagesSection has it: every reply
 * sent from here and everything the customer wrote on the quote page, oldest first, and a reply box. A reply goes by
 * email in the quote's own conversation in the customer's mailbox (`POST /api/commerce/quote` messages, reply); their
 * email answer reaches the site's contact email, not this list.
 */

/// A message as the console lists it (`QuoteConsoleMessage`): who and when, and what was said.
struct QuoteConsoleMessage: Identifiable, Equatable {
  let id: String
  let incoming: Bool
  let body: String
  let atMs: Double
  let label: String
}

/// The Messages section, for a quote screen's list.
struct QuoteMessagesSection: View {
  let context: NativePluginContext
  let order: HostOrder
  let quoteID: String
  let onNotice: (String, AglynTone) -> Void

  @State private var messages: [QuoteConsoleMessage] = []
  @State private var loadError: String?
  @State private var message = ""
  @State private var busy = false
  @State private var attemptKey: String?

  private var canSend: Bool { context.can(quoteSendPermission) }

  var body: some View {
    Section {
      Text(
        "Write to your customer about this quote. They can answer by email or on the quote page; what they write on the page shows here, and you’re notified of it."
      )
      .foregroundStyle(.secondary)
      if let loadError { AglynNotice(loadError, tone: .warning) }
      if !messages.isEmpty {
        Text("CONVERSATION").font(AglynFont.caption).foregroundStyle(.secondary)
        ForEach(messages) { entry in
          VStack(alignment: .leading, spacing: AglynSpace.half) {
            Text("\(formatReceiptTime(Int64(entry.atMs), timeZone: TimeZone.current.identifier)) · \(entry.label)")
              .font(AglynFont.caption).foregroundStyle(.secondary)
            Text(entry.body).font(AglynFont.subheadline)
          }
          .padding(.leading, AglynSpace.one)
          .overlay(alignment: .leading) {
            Rectangle().fill(entry.incoming ? AglynColor.primary : AglynColor.secondary.opacity(0.3)).frame(width: 3)
          }
        }
      }
      if let refused = quoteReplyRefusal(order) {
        AglynNotice(refused, tone: .info)
      } else {
        Text("To \(quoteReplyRecipient(order))").foregroundStyle(.secondary)
        TextField(
          "Message", text: Binding(get: { message }, set: { message = String($0.prefix(quoteMessageMax)) }),
          prompt: Text("Write your reply."), axis: .vertical
        )
        .lineLimit(4...10)
        .disabled(!canSend)
        .accessibilityIdentifier("quote-reply-message")
        Text(
          canSend
            ? "Sent from your site in the same email conversation as the quote. When your customer replies by email, it goes to your site’s contact email (or yours, if the site has none), not here."
            : context.refusal(quoteSendPermission)
        )
        .font(AglynFont.caption).foregroundStyle(.secondary)
        Button(busy ? "Sending…" : "Send reply") { Task { await send() } }
          .disabled(!canSend || busy || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          .accessibilityIdentifier("quote-reply-send")
      }
    } header: {
      Text("Messages")
    }
    .task(id: quoteID) { await load() }
    .onChange(of: message) { _, _ in attemptKey = nil }
  }

  private func load() async {
    do {
      let answer = try await context.api.request(
        "/api/commerce/quote", method: .post,
        body: .object([
          "action": .string("messages"), "hostId": .string(context.hostID ?? ""), "quoteId": .string(quoteID),
        ]))
      loadError = nil
      messages = (answer?["messages"]?.arrayValue ?? []).compactMap { entry in
        guard let id = entry["id"]?.stringValue, let body = entry["body"]?.stringValue else { return nil }
        return QuoteConsoleMessage(
          id: id, incoming: entry["direction"]?.stringValue == "in", body: body, atMs: entry["atMs"]?.numberValue ?? 0,
          label: entry["label"]?.stringValue ?? "")
      }
    } catch let error as ConsoleAPIError {
      loadError = error.body?["error"]?.stringValue ?? "The messages could not be loaded."
    } catch {
      loadError = "The messages could not be loaded."
    }
  }

  private func send() async {
    let text = message.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !busy, !text.isEmpty else { return }
    busy = true
    defer { busy = false }
    // One key per reply: a retry of the same press is answered from the first.
    let key = attemptKey ?? UUID().uuidString
    attemptKey = key
    do {
      let answer = try await context.api.request(
        "/api/commerce/quote", method: .post,
        body: .object([
          "action": .string("reply"), "hostId": .string(context.hostID ?? ""), "quoteId": .string(quoteID),
          "message": .string(text),
        ]), idempotencyKey: key)
      attemptKey = nil
      message = ""
      onNotice("Reply sent to \(answer?["to"]?.stringValue ?? quoteReplyRecipient(order))", .success)
      await load()
    } catch let error as ConsoleAPIError {
      attemptKey = nil
      onNotice(error.body?["error"]?.stringValue ?? "The reply was not sent", .warning)
    } catch {
      attemptKey = nil
      onNotice("The reply was not sent", .warning)
    }
  }
}
