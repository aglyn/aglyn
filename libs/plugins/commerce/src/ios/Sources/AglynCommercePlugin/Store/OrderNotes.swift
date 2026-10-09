// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * WHAT A PERSON WRITES ON AN ORDER BY HAND: a note on its timeline, and the
 * answer to a restock question. The order dialog in the console makes both
 * writes from the browser; here they go through its server routes
 * (`/api/commerce/order-note`, `/api/commerce/order-restock-answer`), which
 * run the console's own computation in a transaction on the stored order, so
 * an event another tab wrote is never dropped. The Kotlin app's
 * `orders/Orders.kt`, line for line.
 */

/// The longest note the timeline keeps (`ORDER_NOTE_MAX_LENGTH` in the console's model).
let orderNoteMaxLength = 500

/// Why a note cannot be sent, or nil. The route checks again.
func checkOrderNote(_ text: String) -> String? {
  text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Write a note first" : nil
}

/// The timeline, newest first, as the console's dialog lists it.
func orderTimeline(_ order: HostOrder) -> [OrderTimelineEvent] {
  Array((order.timeline ?? []).reversed())
}

/// One timeline line as the console's dialog prints it: `time — event: detail`.
func timelineLine(_ event: OrderTimelineEvent) -> String {
  "\(formatReceiptTime(Int64(event.atMs))) — \(event.event)" + (event.detail.flatMap { $0.isEmpty ? nil : ": \($0)" } ?? "")
}

/// The restock question still waiting for an answer, if any.
func openRestockCheck(_ order: HostOrder) -> OrderRestockCheck? {
  order.restockCheck.flatMap { $0.resolution == nil ? $0 : nil }
}

/// The two answers a restock question takes. They move no stock.
enum RestockAnswerChoice: String, CaseIterable, Identifiable {
  case restocked, dismissed
  var id: String { rawValue }
  var label: String { self == .restocked ? "Restocked" : "No restock" }
  var recorded: String { self == .restocked ? "Recorded as restocked" : "Recorded — no restock" }
}

/// The words for what the restock route found (`recorded`, `answered`, `changed`).
func restockAnswerMessage(verdict: String, choice: RestockAnswerChoice) -> String {
  switch verdict {
  case "answered": return "This restock question was already answered — nothing changed."
  case "changed":
    return "The restock question changed since this screen loaded — nothing was written. Reload the order to see the current one."
  default: return choice.recorded
  }
}

/// Adds a note to the order's timeline.
func addOrderNote(api: ConsoleAPIClient, hostID: String, orderID: String, note: String) async throws {
  let text = String(note.trimmingCharacters(in: .whitespacesAndNewlines).prefix(orderNoteMaxLength))
  _ = try await api.request(
    "/api/commerce/order-note", method: .post,
    body: .object(["hostId": .string(hostID), "orderId": .string(orderID), "note": .string(text)]))
}

/// Answers the open restock question; the route says whether it landed.
func answerOrderRestock(
  api: ConsoleAPIClient, hostID: String, orderID: String, choice: RestockAnswerChoice, flaggedAtMs: Double
) async throws -> String {
  let answer = try await api.request(
    "/api/commerce/order-restock-answer", method: .post,
    body: .object([
      "hostId": .string(hostID), "orderId": .string(orderID), "resolution": .string(choice.rawValue),
      "flaggedAtMs": .number(flaggedAtMs.rounded()),
    ]))
  return answer?["verdict"]?.stringValue ?? "recorded"
}

/// The order screen's Restock check and Timeline sections.
struct OrderAnnotationSections: View {
  let context: NativePluginContext
  let orderID: String
  let order: HostOrder
  @State private var noting = false
  @State private var note = ""
  @State private var busy = false
  @State private var problem: String?
  @State private var done: String?

  var body: some View {
    if let check = openRestockCheck(order) {
      Section {
        Text(describeRestockCheck(check, order: order)).font(AglynFont.subheadline)
        ForEach(Array(check.lines.enumerated()), id: \.offset) { _, line in
          Text("\(Int(line.quantity))× \(line.name ?? line.productId)" + (line.variantLabel.map { " — \($0)" } ?? ""))
            .font(AglynFont.caption).foregroundStyle(.secondary)
        }
        HStack {
          ForEach(RestockAnswerChoice.allCases) { choice in
            Button(choice.label) { Task { await answer(choice, check) } }
              .buttonStyle(.bordered)
              .disabled(busy)
              .accessibilityIdentifier("order-restock-\(choice.rawValue)")
          }
        }
      } header: {
        Text("Restock check")
      } footer: {
        Text(
          "If goods came back, put them on the shelf with Adjust stock on the product first — these answers move no stock, they only clear this question."
        )
      }
    }

    Section {
      if let problem { AglynNotice(problem, tone: .error) { self.problem = nil } }
      if let done { AglynNotice(done, tone: .success) { self.done = nil } }
      let events = orderTimeline(order)
      if events.isEmpty {
        Text("Nothing has happened on this order yet.").foregroundStyle(.secondary)
      }
      ForEach(Array(events.enumerated()), id: \.offset) { _, event in
        AglynRow(
          event.event.replacingOccurrences(of: "_", with: " ").capitalized,
          subtitle: [event.detail, formatReceiptTime(Int64(event.atMs))].compactMap { $0 }.filter { !$0.isEmpty }
            .joined(separator: " · "),
          systemImage: event.event == "note" ? "note.text" : "clock")
      }
      Button {
        note = ""
        noting = true
      } label: {
        Label("Add a note", systemImage: "square.and.pencil")
      }
      .accessibilityIdentifier("order-add-note")
      .sheet(isPresented: $noting) { noteSheet }
    } header: {
      Text("Timeline")
    }
  }

  private var noteSheet: some View {
    AglynFormSheet(
      "Add a note", confirm: "Add note", canConfirm: checkOrderNote(note) == nil,
      save: {
        guard let hostID = context.hostID else { return }
        do {
          try await addOrderNote(api: context.api, hostID: hostID, orderID: orderID, note: note)
        } catch let error as ConsoleAPIError {
          throw NoteFailure(message: error.message)
        }
        done = "The note is on the timeline."
      }
    ) {
      Section {
        TextField("Note", text: $note, axis: .vertical)
          .lineLimit(3...8)
          .onChange(of: note) { _, text in if text.count > orderNoteMaxLength { note = String(text.prefix(orderNoteMaxLength)) } }
          .accessibilityIdentifier("order-note-text")
      } footer: {
        Text("A note goes on this order's timeline, for your team. The customer does not see it. \(note.count)/\(orderNoteMaxLength)")
      }
    }
  }

  private func answer(_ choice: RestockAnswerChoice, _ check: OrderRestockCheck) async {
    guard let hostID = context.hostID else { return }
    busy = true
    problem = nil
    defer { busy = false }
    do {
      let verdict = try await answerOrderRestock(
        api: context.api, hostID: hostID, orderID: orderID, choice: choice, flaggedAtMs: check.flaggedAtMs)
      done = restockAnswerMessage(verdict: verdict, choice: choice)
    } catch let error as ConsoleAPIError {
      problem = error.message
    } catch {
      problem = "That did not go through. Check the connection and try again."
    }
  }
}

/// A refusal the form sheet shows in place.
private struct NoteFailure: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}
