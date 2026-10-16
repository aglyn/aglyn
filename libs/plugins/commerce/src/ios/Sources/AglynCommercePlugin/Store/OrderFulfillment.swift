// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * THE ORDER DIALOG'S FULFILLMENT (AGL-3841): Fulfill items (a count per line,
 * the carrier, the tracking number and link, what the shipment cost, whether
 * to tell the customer), and each recorded shipment's Edit tracking and Cancel
 * shipment. Every act goes through the console's `fulfill-order` route, which
 * checks the counts and the transition under the write; the screens collect
 * what the merchant means and the console's own rules (OrderDialogRules)
 * decide the starting counts, the carrier choice and the cost.
 */

/// What Fulfill items asks the route to record (`FulfillItemsSubmission`).
struct FulfillItemsSubmission: Equatable {
  /// Nil when the picked units are everything still to ship.
  var lineItems: [(lineItemID: Int, quantity: Int)]?
  var carrier = ""
  var trackingNumber = ""
  var trackingUrl = ""
  var shippingCostCents: Int?
  var notify = true

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.lineItems?.map(\.lineItemID) == rhs.lineItems?.map(\.lineItemID) && lhs.lineItems?.map(\.quantity) == rhs.lineItems?.map(\.quantity)
      && lhs.carrier == rhs.carrier && lhs.trackingNumber == rhs.trackingNumber && lhs.trackingUrl == rhs.trackingUrl
      && lhs.shippingCostCents == rhs.shippingCostCents && lhs.notify == rhs.notify
  }

  /// The route's body beyond the site and order, as the console's dialog sends it.
  var body: [String: JSONValue] {
    var body: [String: JSONValue] = ["to": "fulfilled"]
    if let lineItems {
      body["lineItems"] = .array(
        lineItems.map { .object(["lineItemId": .number(Double($0.lineItemID)), "quantity": .number(Double($0.quantity))]) })
    }
    let carrier = carrier.trimmingCharacters(in: .whitespacesAndNewlines)
    let number = trackingNumber.trimmingCharacters(in: .whitespacesAndNewlines)
    let link = trackingUrl.trimmingCharacters(in: .whitespacesAndNewlines)
    if !carrier.isEmpty { body["carrier"] = .string(carrier) }
    if !number.isEmpty { body["trackingNumber"] = .string(number) }
    if !link.isEmpty { body["trackingUrl"] = .string(link) }
    if let shippingCostCents { body["shippingCostCents"] = .number(Double(shippingCostCents)) }
    if !notify { body["notify"] = .bool(false) }
    return body
  }
}

/// What the route answered a shipment with, in the console's words.
func fulfillmentMessage(_ answer: JSONValue?) -> String {
  if answer?["already"] == .bool(true) { return "Order was already fulfilled" }
  if answer?["status"]?.stringValue == "partially_fulfilled" { return "Items fulfilled — the rest are still to ship" }
  return "Order fulfilled"
}

/// Records a shipment. The attempt key dedupes a retry after a lost answer, as the console's does.
func fulfillOrderItems(api: ConsoleAPIClient, hostID: String, orderID: String, submission: FulfillItemsSubmission, attemptKey: String)
  async throws -> String
{
  var body = submission.body
  body["hostId"] = .string(hostID)
  body["orderId"] = .string(orderID)
  let answer = try await api.request(
    "/api/commerce/fulfill-order", method: .post, body: .object(body), idempotencyKey: attemptKey)
  return fulfillmentMessage(answer)
}

/// Changes a shipment's carrier, number and link.
func updateShipmentTracking(
  api: ConsoleAPIClient, hostID: String, orderID: String, fulfillmentID: String, carrier: String, trackingNumber: String, trackingUrl: String
) async throws -> String {
  var body: [String: JSONValue] = [
    "hostId": .string(hostID), "orderId": .string(orderID), "action": "update-tracking", "fulfillmentId": .string(fulfillmentID),
    "carrier": .string(carrier.trimmingCharacters(in: .whitespacesAndNewlines)),
    "trackingNumber": .string(trackingNumber.trimmingCharacters(in: .whitespacesAndNewlines)),
  ]
  let link = trackingUrl.trimmingCharacters(in: .whitespacesAndNewlines)
  if !link.isEmpty { body["trackingUrl"] = .string(link) }
  let answer = try await api.request("/api/commerce/fulfill-order", method: .post, body: .object(body))
  return answer?["already"] == .bool(true) ? "Tracking was already up to date" : "Tracking updated"
}

/// Cancels a shipment: its items go back to unfulfilled; the buyer is not told.
func cancelShipment(api: ConsoleAPIClient, hostID: String, orderID: String, fulfillmentID: String) async throws -> String {
  let answer = try await api.request(
    "/api/commerce/fulfill-order", method: .post,
    body: .object([
      "hostId": .string(hostID), "orderId": .string(orderID), "action": "cancel-fulfillment", "fulfillmentId": .string(fulfillmentID),
    ]))
  return answer?["already"] == .bool(true) ? "Shipment was already canceled" : "Shipment canceled"
}

/// Refunds the named lines (the console's Refund line): the route works out the amount from the lines.
func refundOrderLines(api: ConsoleAPIClient, hostID: String, orderID: String, lineItemIDs: [Int], attemptKey: String) async throws {
  _ = try await api.request(
    "/api/commerce/refund", method: .post,
    body: .object([
      "hostId": .string(hostID), "orderId": .string(orderID), "lineItemIds": .array(lineItemIDs.map { .number(Double($0)) }),
    ]), idempotencyKey: attemptKey)
}

/// The store's currency (its store settings), which a typed shipping cost is in.
@MainActor
func storeCurrency(_ reader: FirestoreReader, hostID: String) async -> String {
  final class Once {
    var listener: FirestoreListening?
    var answered = false
  }
  let once = Once()
  return await withCheckedContinuation { continuation in
    once.listener = reader.listenDocument(["hosts", hostID, "settings", "store"]) { result in
      guard !once.answered else { return }
      once.answered = true
      var currency = "USD"
      if case .success(let doc?) = result, let stored = doc.string("currency"), !stored.isEmpty { currency = stored.uppercased() }
      once.listener?.remove()
      continuation.resume(returning: currency)
    }
    // An answer from the cache can arrive before the listener is handed back.
    if once.answered { once.listener?.remove() }
  }
}

// MARK: - Carrier fields

/// Carrier, tracking number and, for a carrier without a known tracker, the link (the console's `CarrierFields`).
struct CarrierFields: View {
  @Binding var carrier: String
  @Binding var trackingNumber: String
  @Binding var trackingUrl: String
  @State private var other = false

  private var choice: String { other ? ContractValues.shared.fulfillmentOtherCarrier : fulfillmentCarrierChoice(carrier) }

  var body: some View {
    Picker(
      "Carrier",
      selection: Binding(
        get: { choice },
        set: { value in
          other = value == ContractValues.shared.fulfillmentOtherCarrier
          carrier = other ? "" : value
        })
    ) {
      Text("None").tag("")
      ForEach(ContractValues.shared.fulfillmentCarrierChoices, id: \.self) { Text($0).tag($0) }
      Text("Other").tag(ContractValues.shared.fulfillmentOtherCarrier)
    }
    .accessibilityIdentifier("fulfill-carrier")
    if other {
      TextField("Carrier name", text: $carrier).accessibilityIdentifier("fulfill-carrier-name")
    }
    TextField("Tracking number", text: $trackingNumber)
      .autocorrectionDisabled()
      .accessibilityIdentifier("fulfill-tracking")
    if !trackingNumber.isEmpty, trackingUrlFor(carrier, trackingNumber) == nil {
      VStack(alignment: .leading, spacing: 2) {
        TextField("Tracking link", text: $trackingUrl, prompt: Text("https://"))
          .autocorrectionDisabled()
          .accessibilityIdentifier("fulfill-tracking-link")
          #if os(iOS)
            .textInputAutocapitalization(.never)
            .keyboardType(.URL)
          #endif
        Text("Optional. USPS, UPS, FedEx, DHL, Canada Post, Royal Mail and Australia Post get a link on their own.")
          .font(AglynFont.caption).foregroundStyle(.secondary)
      }
    }
  }

  init(carrier: Binding<String>, trackingNumber: Binding<String>, trackingUrl: Binding<String>) {
    _carrier = carrier
    _trackingNumber = trackingNumber
    _trackingUrl = trackingUrl
    _other = State(initialValue: fulfillmentCarrierChoice(carrier.wrappedValue) == ContractValues.shared.fulfillmentOtherCarrier)
  }
}

// MARK: - Fulfill items

/// Fulfill items: one count per line, starting at what is left of each shippable line, so shipping everything is one tap.
struct FulfillItemsSheet: View {
  let context: NativePluginContext
  let order: HostOrder
  let orderID: String
  let done: (String) -> Void
  @State private var quantities: [Int]
  @State private var carrier = ""
  @State private var trackingNumber = ""
  @State private var trackingUrl = ""
  @State private var cost = ""
  @State private var notify = true
  @State private var currency = "USD"
  @State private var attemptKey = UUID().uuidString

  init(context: NativePluginContext, order: HostOrder, orderID: String, done: @escaping (String) -> Void) {
    self.context = context
    self.order = order
    self.orderID = orderID
    self.done = done
    _quantities = State(initialValue: fulfillItemsStartQuantities(order))
  }

  private var states: [OrderLineFulfillmentState] { orderLineFulfillmentStates(order) }
  private var selection: [(lineItemID: Int, quantity: Int)] { fulfillItemsSelection(quantities.map(Double.init)) }
  private var parsedCost: ShippingCostInput { parseShippingCostInput(cost, currency: currency) }
  private var costError: String? {
    if case .error(let message) = parsedCost { return message }
    return nil
  }

  var body: some View {
    AglynFormSheet(
      "Fulfill items", confirm: "Fulfill", canConfirm: !selection.isEmpty && costError == nil,
      save: { try await save() }
    ) {
      Section("Items") {
        ForEach(states.filter { $0.remainingQuantity > 0 }, id: \.lineItemID) { state in
          let line = (order.lineItems ?? [])[state.lineItemID]
          Stepper(
            value: Binding(
              get: { quantities.indices.contains(state.lineItemID) ? quantities[state.lineItemID] : 0 },
              set: { value in if quantities.indices.contains(state.lineItemID) { quantities[state.lineItemID] = value } }),
            in: 0...state.remainingQuantity
          ) {
            VStack(alignment: .leading, spacing: 2) {
              Text(line.name + (line.variantLabel.map { " — \($0)" } ?? ""))
              Text(
                "\(quantities.indices.contains(state.lineItemID) ? quantities[state.lineItemID] : 0) of \(state.remainingQuantity)"
                  + (state.requiresShipping ? "" : " · no shipping needed")
              )
              .font(AglynFont.caption).foregroundStyle(.secondary).monospacedDigit()
            }
          }
          .accessibilityIdentifier("fulfill-line-\(state.lineItemID)")
        }
      }
      Section("Tracking") {
        CarrierFields(carrier: $carrier, trackingNumber: $trackingNumber, trackingUrl: $trackingUrl)
      }
      Section {
        LabeledContent("Shipping cost") {
          TextField(currency, text: $cost)
            .multilineTextAlignment(.trailing)
            .monospacedDigit()
            .accessibilityIdentifier("fulfill-cost")
            #if os(iOS)
              .keyboardType(.decimalPad)
            #endif
        }
        Toggle("Notify customer", isOn: $notify).accessibilityIdentifier("fulfill-notify")
      } footer: {
        Text(costError ?? "Optional. What sending this shipment cost you, in \(currency).")
          .foregroundStyle(costError == nil ? AnyShapeStyle(.secondary) : AnyShapeStyle(.red))
      }
    }
    .task {
      guard let hostID = context.hostID else { return }
      currency = await storeCurrency(context.firestore, hostID: hostID)
    }
  }

  private func save() async throws {
    guard let hostID = context.hostID else { return }
    var submission = FulfillItemsSubmission(
      carrier: carrier, trackingNumber: trackingNumber, trackingUrl: trackingUrl, notify: notify)
    if !fulfillItemsIsEverything(order, selection) { submission.lineItems = selection }
    if case .cents(let cents) = parsedCost { submission.shippingCostCents = cents }
    do {
      let message = try await fulfillOrderItems(api: context.api, hostID: hostID, orderID: orderID, submission: submission, attemptKey: attemptKey)
      done(message)
    } catch let error as ConsoleAPIError where error.status > 0 && error.status < 500 {
      // A refusal wrote nothing: the next press is a new attempt.
      attemptKey = UUID().uuidString
      throw SheetFailure(message: error.message.isEmpty ? "This order can no longer be fulfilled." : error.message)
    } catch {
      // Not known whether it landed: the same key makes the next press safe.
      throw SheetFailure(
        message: "The request did not complete, so it is not known whether the order was fulfilled. Retrying is safe; the server writes it once.")
    }
  }
}

/// Edit tracking on a recorded shipment.
struct EditTrackingSheet: View {
  let context: NativePluginContext
  let orderID: String
  let fulfillment: OrderFulfillment
  let done: (String) -> Void
  @State private var carrier: String
  @State private var trackingNumber: String
  @State private var trackingUrl: String

  init(context: NativePluginContext, orderID: String, fulfillment: OrderFulfillment, done: @escaping (String) -> Void) {
    self.context = context
    self.orderID = orderID
    self.fulfillment = fulfillment
    self.done = done
    _carrier = State(initialValue: fulfillment.carrier ?? "")
    _trackingNumber = State(initialValue: fulfillment.trackingNumber ?? "")
    _trackingUrl = State(initialValue: fulfillment.trackingUrl ?? "")
  }

  var body: some View {
    AglynFormSheet("Edit tracking", confirm: "Save tracking", save: { try await save() }) {
      Section { CarrierFields(carrier: $carrier, trackingNumber: $trackingNumber, trackingUrl: $trackingUrl) }
    }
  }

  private func save() async throws {
    guard let hostID = context.hostID else { return }
    do {
      done(
        try await updateShipmentTracking(
          api: context.api, hostID: hostID, orderID: orderID, fulfillmentID: fulfillment.id, carrier: carrier,
          trackingNumber: trackingNumber, trackingUrl: trackingUrl))
    } catch let error as ConsoleAPIError where error.status > 0 && error.status < 500 {
      throw SheetFailure(message: error.message)
    } catch {
      throw SheetFailure(message: "It is not known whether the tracking was updated. Retrying is safe; the server writes it once.")
    }
  }
}
