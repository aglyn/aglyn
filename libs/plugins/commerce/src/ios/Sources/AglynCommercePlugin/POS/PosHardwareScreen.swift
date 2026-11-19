// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import AuthenticationServices
import SwiftUI

public let commerceHardwareScreen = "commerce.hardware"

/// The tone Status is drawn in (the console's `POS_HARDWARE_STATUS_COLOR`, on the kit's tones).
func posHardwareStatusTone(_ status: String) -> AglynTone {
  switch status {
  case "delivered", "registered": .success
  case "canceled", "refunded": .neutral
  default: .info
  }
}

/// Hardware (AGL-4038): the console's Hardware card and its Card readers to set up card on one screen. The catalog,
/// the basket and its summary, the terms of sale and business use, Check out on Stripe's own page in the secure
/// browser, Your orders with a return request, and the readers bought in person waiting for their store.
struct PosHardwareScreen: View {
  let context: NativePluginContext
  @Environment(\.webAuthenticationSession) private var webAuthentication
  @State private var catalog: Load<PosHardwareCatalogAnswer> = .loading
  @State private var orders: [PosHardwareOrderRow]?
  @State private var waiting: PosHardwareWaiting = .none
  /// Whether the plan carries the point of sale; nil while it is asked (prompts nobody).
  @State private var posPlan: Bool?
  @State private var quantities: [String: Int] = [:]
  @State private var shippingMethod = ""
  @State private var termsAccepted = false
  @State private var businessUse = false
  @State private var busy = false
  @State private var message: (text: String, tone: AglynTone)?
  @State private var returning: PosHardwareOrderRow?
  @State private var returnReason = ""
  @State private var chosenStore: [String: String] = [:]
  /// One attempt per basket: the same basket reaches the same Checkout Session, a changed one is a new attempt.
  @State private var attempt: (basket: String, key: String) = ("", newAttemptKey("pos-hw"))

  private var hostID: String { context.hostID ?? "" }
  private var shop: PosHardwareAPI { PosHardwareAPI(api: context.api, hostID: hostID) }
  private var mayVisit: Bool { posHardwareVisitKeys.contains { context.can($0) } }
  private var canBuy: Bool { context.can(posHardwareBuyKey) }
  private var text: PosHardwareShopText { posHardwareText }

  var body: some View {
    Group {
      if !mayVisit {
        AglynEmptyState(
          "Point of sale is off for you here", systemImage: "lock", message: context.refusal(posHardwareBuyKey)
        )
      } else {
        form
      }
    }
    .aglynScreenTitle(text.header)
    .task(id: hostID) { await load() }
  }

  private var form: some View {
    Form {
      if let message {
        Section { AglynNotice(message.text, tone: message.tone) { self.message = nil } }
      }
      if !waiting.orders.isEmpty { waitingSection }
      switch catalog {
      case .loading:
        Section { SkeletonRows(count: 4) }
      case .failed(let reason):
        Section { AglynNotice(reason, tone: .error) }
      case .ready(let answer) where answer.available:
        shopSections(answer)
      case .ready:
        EmptyView()
      }
      ordersSection
    }
    .refreshable { await load() }
    .sheet(item: $returning) { order in returnSheet(order) }
    .accessibilityIdentifier("pos-hardware")
  }

  // MARK: The shop

  @ViewBuilder
  private func shopSections(_ answer: PosHardwareCatalogAnswer) -> some View {
    let shipping = answer.shipping.first { $0.method == shippingMethod }
    let basket = posHardwareBasket(
      offers: answer.offers.map { (sku: $0.sku, unitCents: $0.unitCents) }, quantities: quantities, shippingCents: shipping?.cents,
      automaticTax: answer.automaticTax)
    let state = posHardwareCheckoutState(
      canBuy: canBuy, termsAccepted: termsAccepted, businessUse: businessUse, hasLines: !basket.lines.isEmpty,
      hasShipping: shipping != nil)
    Section {
      if posPlan == false && arrived.isEmpty {
        planPrompt(posHardwarePlanPrompt())
      }
      Text(text.intro).font(AglynFont.subheadline).foregroundStyle(.secondary)
    } header: {
      Text(text.subheader)
    }
    Section {
      ForEach(answer.offers) { offer in
        VStack(alignment: .leading, spacing: AglynSpace.half) {
          Text(offer.name).font(AglynFont.headline)
          Text(offer.use).font(AglynFont.subheadline).foregroundStyle(.secondary)
          HStack {
            Text(formatPosHardwareCents(offer.unitCents)).font(AglynFont.body).monospacedDigit()
            Spacer()
            Picker(text.quantity, selection: quantityBinding(offer.sku)) {
              ForEach(0...ContractValues.shared.posHardwareMaxPerLine, id: \.self) { Text("\($0)").tag($0) }
            }
            .pickerStyle(.menu)
            .accessibilityLabel("Quantity of \(offer.name)")
          }
        }
        .padding(.vertical, AglynSpace.half)
        .accessibilityIdentifier("pos-hardware-offer-\(offer.sku)")
      }
    }
    Section {
      Picker(text.shipping, selection: $shippingMethod) {
        ForEach(answer.shipping) { Text("\($0.label) · \(formatPosHardwareCents($0.cents))").tag($0.method) }
      }
      summaryRow(text.items, formatPosHardwareCents(basket.itemsCents))
      summaryRow(text.shipping, shipping.map { formatPosHardwareCents($0.cents) } ?? "—")
      if answer.automaticTax { summaryRow(text.tax, text.taxAtCheckout) }
      summaryRow(basket.totalLabel, formatPosHardwareCents(basket.totalCents), strong: true)
        .accessibilityIdentifier("pos-hardware-total")
    } footer: {
      Text(text.shipsTo)
    }
    Section {
      Toggle(isOn: $termsAccepted) {
        // The terms are the published Terms page, read in the browser.
        Text(posHardwareTermsLine(text))
          .font(AglynFont.subheadline)
      }
      .accessibilityIdentifier("pos-hardware-terms")
      Toggle(isOn: $businessUse) { Text(text.businessUse).font(AglynFont.subheadline) }
        .accessibilityIdentifier("pos-hardware-business-use")
      if let reason = state.blockedReason {
        Text(reason).font(AglynFont.caption).foregroundStyle(.secondary)
      }
      Button {
        Task { await checkout(basket: basket) }
      } label: {
        HStack {
          Text(text.checkout)
          if busy { Spacer(); ProgressView() }
        }
      }
      .buttonStyle(.aglynProminent)
      .disabled(!state.enabled || busy)
      .accessibilityIdentifier("pos-hardware-checkout")
    }
  }

  private func summaryRow(_ label: String, _ value: String, strong: Bool = false) -> some View {
    LabeledContent {
      Text(value).monospacedDigit().fontWeight(strong ? .semibold : nil)
    } label: {
      Text(label).foregroundStyle(strong ? .primary : .secondary)
    }
  }

  private func quantityBinding(_ sku: String) -> Binding<Int> {
    Binding(get: { quantities[sku] ?? 0 }, set: { quantities[sku] = $0 })
  }

  private func planPrompt(_ words: String) -> some View {
    let from = PlanFeatureDefaults.grantedFrom["pos"].map { " Included from \($0)." } ?? ""
    return AglynNotice(words + from, tone: .info)
  }

  private var arrived: [String] {
    posPlan == false ? posHardwareArrivedNumbers((orders ?? []).map { (number: $0.number, status: $0.status, source: Optional($0.source)) }) : []
  }

  // MARK: Your orders

  private var ordersSection: some View {
    Section {
      if !arrived.isEmpty { planPrompt(posHardwarePlanPrompt(arrived: arrived)) }
      if let orders {
        if orders.isEmpty {
          Text(text.noOrders).foregroundStyle(.secondary)
        }
        ForEach(orders) { order in orderRow(order) }
      } else {
        SkeletonRows(count: 2)
      }
    } header: {
      Text(text.ordersTitle)
    }
  }

  private func orderRow(_ order: PosHardwareOrderRow) -> some View {
    VStack(alignment: .leading, spacing: AglynSpace.half) {
      HStack {
        Text(order.number).font(AglynFont.headline)
        Spacer()
        StatusChip(order.statusLabel, tone: posHardwareStatusTone(order.status))
      }
      Text(posHardwareOrderItems(order.lines)).font(AglynFont.subheadline)
      Text("\(text.columnPlaced) \(posHardwarePlacedOn(order.createdAtMs)) · \(formatPosHardwareCents(order.totalCents))")
        .font(AglynFont.caption).foregroundStyle(.secondary)
      if let number = order.trackingNumber {
        if let url = order.trackingURL {
          Link("\(text.columnTracking) \(number)", destination: url).font(AglynFont.caption)
        } else {
          Text("\(text.columnTracking) \(number)").font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
      if let label = order.returnLabel {
        Text(label).font(AglynFont.caption).foregroundStyle(.secondary)
      } else if order.returnOffered {
        Button(text.returnAction) { returning = order }
          .buttonStyle(.borderless)
          .accessibilityIdentifier("pos-hardware-return-\(order.number)")
      }
    }
    .padding(.vertical, AglynSpace.half)
  }

  private func returnSheet(_ order: PosHardwareOrderRow) -> some View {
    NavigationStack {
      Form {
        Section {
          Text(text.returnBody).font(AglynFont.subheadline).foregroundStyle(.secondary)
          TextField(text.returnField, text: $returnReason, axis: .vertical)
            .lineLimit(2...6)
            .accessibilityIdentifier("pos-hardware-return-reason")
        }
      }
      .navigationTitle(posHardwareReturnTitle(order.number))
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(text.returnCancel) { returning = nil } }
        ToolbarItem(placement: .confirmationAction) {
          Button(text.returnSend) { Task { await requestReturn(order) } }
            .disabled(busy || !posHardwareReturnReasonReady(returnReason))
            .accessibilityIdentifier("pos-hardware-return-send")
        }
      }
    }
    .presentationDetents([.medium, .large])
  }

  // MARK: Card readers to set up

  private var waitingSection: some View {
    let words = posHardwareWaitingText
    let planReason = waiting.posPlan ? nil : words.planReason
    let devicesReason = context.can(posHardwareDevicesKey) ? nil : context.refusal(posHardwareDevicesKey)
    return Section {
      if !waiting.posPlan { planPrompt(words.planPrompt) }
      ForEach(waiting.orders) { order in
        VStack(alignment: .leading, spacing: AglynSpace.one) {
          Text(posHardwareWaitingItems(order.lines)).font(AglynFont.headline)
          Text("Order \(order.number) · bought \(boughtOn(order.createdAtMs))")
            .font(AglynFont.caption).foregroundStyle(.secondary)
          if let store = waiting.stores.first(where: { $0.hostID == order.hostID }) {
            Text(posHardwareWaitingNote(storeName: store.name, serialsTaken: order.serialsTaken, hasLocation: store.hasLocation))
              .font(AglynFont.subheadline)
            if let reason = planReason ?? devicesReason {
              Text(reason).font(AglynFont.caption).foregroundStyle(.secondary)
            }
            Button(words.markSetUp) {
              Task {
                await act(words.marked) { try await shop.markSetUp(storeID: order.hostID, orderID: order.id) }
              }
            }
            .buttonStyle(.borderless)
            .disabled(busy || (planReason ?? devicesReason) != nil)
            .accessibilityIdentifier("pos-hardware-mark-set-up")
          } else {
            let pick = chosenStore[order.id] ?? waiting.stores.first?.hostID ?? ""
            Picker(
              words.whichStore,
              selection: Binding(get: { pick }, set: { chosenStore[order.id] = $0 })
            ) {
              ForEach(waiting.stores) { Text($0.name).tag($0.hostID) }
            }
            if let planReason { Text(planReason).font(AglynFont.caption).foregroundStyle(.secondary) }
            Button(words.choose) {
              Task { await act(words.chosen) { try await shop.chooseStore(pick, orderID: order.id) } }
            }
            .buttonStyle(.borderless)
            .disabled(busy || pick.isEmpty || planReason != nil)
            .accessibilityIdentifier("pos-hardware-choose-store")
          }
        }
        .padding(.vertical, AglynSpace.half)
      }
    } header: {
      Text(words.header)
    } footer: {
      Text(words.subheader)
    }
  }

  private func boughtOn(_ ms: Double) -> String {
    Date(timeIntervalSince1970: ms / 1000).formatted(date: .numeric, time: .omitted)
  }

  // MARK: Calls

  private func load() async {
    guard mayVisit, !hostID.isEmpty else { return }
    // A catalog that cannot be read is a closed shop, as the console's card treats it.
    let answer = (try? await shop.catalog()) ?? .closed
    catalog = .ready(answer)
    if answer.available, shippingMethod.isEmpty, let first = answer.shipping.first { shippingMethod = first.method }
    orders = (try? await shop.orders()) ?? []
    waiting = (try? await shop.waiting()) ?? .none
    posPlan = await productCheckInCarried(context.api, hostID: hostID)
  }

  private func checkout(basket: PosHardwareBasket) async {
    guard !busy, termsAccepted, businessUse, !basket.lines.isEmpty, !shippingMethod.isEmpty else { return }
    let key = basket.lines.map { "\($0.sku)=\($0.quantity)" }.joined(separator: ",") + "|" + shippingMethod
    if attempt.basket != key { attempt = (key, newAttemptKey("pos-hw")) }
    busy = true
    defer { busy = false }
    do {
      guard let page = try await shop.checkout(lines: basket.lines, shippingMethod: shippingMethod, attemptKey: attempt.key)
      else {
        message = (text.checkoutFailed, .warning)
        return
      }
      // Stripe's page takes the card and the shipping address; the order shows under Your orders once it is paid.
      await webAuthentication.openHostedPage(page)
      orders = (try? await shop.orders()) ?? orders
    } catch {
      message = (posHardwareRefusal(error, fallback: text.checkoutFailed), .warning)
    }
  }

  private func requestReturn(_ order: PosHardwareOrderRow) async {
    busy = true
    defer { busy = false }
    do {
      try await shop.requestReturn(orderID: order.id, reason: returnReason)
      message = (text.returnSent, .success)
      returning = nil
      returnReason = ""
      orders = (try? await shop.orders()) ?? orders
    } catch {
      message = (posHardwareRefusal(error, fallback: text.returnFailed), .warning)
      returning = nil
    }
  }

  private func act(_ done: String, _ call: () async throws -> Void) async {
    busy = true
    defer { busy = false }
    do {
      try await call()
      message = (done, .success)
      waiting = (try? await shop.waiting()) ?? waiting
      orders = (try? await shop.orders()) ?? orders
    } catch {
      message = (posHardwareRefusal(error, fallback: posHardwareWaitingText.failed), .warning)
    }
  }
}

/// The published Terms the hardware terms of sale are part of (`posHardwareTermsUrl`).
var posHardwareTermsURL: URL {
  URL(string: "\(AglynConfig.defaultLegalOrigin)/legal/terms")!
}

/// "I accept the hardware terms of sale (…)." with the terms as a link to the published Terms.
func posHardwareTermsLine(_ text: PosHardwareShopText) -> AttributedString {
  var link = AttributedString(text.termsLink)
  link.link = posHardwareTermsURL
  return AttributedString(text.termsBefore) + link + AttributedString(text.termsAfter)
}
