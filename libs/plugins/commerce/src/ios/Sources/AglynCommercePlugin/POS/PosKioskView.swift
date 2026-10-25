// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynHardware
import AglynPluginHost
import AglynSite
import AglynUI
import SwiftUI

/*
 * THE SELF-SERVICE KIOSK (AGL-3623), full screen on the tablet customers order
 * from. The Kotlin app's `PosKiosk.kt`/`PosKioskScreen`. The console's kiosk
 * page, native: pairing by code, a start screen, the menu (categories, product
 * tiles, an item sheet for options and modifiers, the cart), the priced review,
 * the tip, the card in flight, the receipt, and the order number. A staff PIN in
 * the corner opens the card reader choice and leaves kiosk mode.
 */

public let commerceKioskScreen = "commerce.kiosk"

struct PosKioskScreen: View {
  let context: NativePluginContext
  @State private var model: PosKioskModel

  init(context: NativePluginContext) {
    self.context = context
    let api = ConsolePosKioskAPI(api: context.api)
    _model = State(
      initialValue: PosKioskModel(
        device: ConsolePosDeviceAPI(api: context.api), api: api,
        store: PosDeviceTokenStore(defaults: .standard, mode: .kiosk), collector: DeviceCardCollector.make()))
  }

  var body: some View {
    ZStack {
      AglynColor.page.ignoresSafeArea()
      if !model.started {
        ProgressView()
      } else if model.token == nil {
        PosDevicePairingView(
          mode: .kiosk, busy: model.pairing, error: model.pairError,
          onPair: { code in Task { await model.pair(code: code) } }, onLeave: { context.back() })
      } else {
        KioskBody(model: model, origin: context.api.origin, onExit: { model.unpaired() })
          .id(model.turn)
      }
    }
    .task { await model.start() }
    // The idle clock, once a second.
    .task(id: model.token) {
      guard model.token != nil else { return }
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(1))
        model.tick()
        model.tickDone()
      }
    }
    // The menu is re-read ten minutes at a time while idle on the start screen, so an edit reaches it.
    .task(id: model.token) {
      guard model.token != nil else { return }
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(600))
        if model.phase == .start { await model.refresh() }
      }
    }
    #if os(iOS)
      .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
      .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    #endif
    // Any touch is the customer still there.
    .simultaneousGesture(DragGesture(minimumDistance: 0).onChanged { _ in model.touch() })
  }
}

private struct CatalogKey: Equatable {
  let token: String?
  let categoryID: String?
  let turn: Int
}

private struct KioskBody: View {
  let model: PosKioskModel
  /// The console the kiosk was paired with, whose media CDN serves the products' photos.
  let origin: String
  let onExit: () -> Void
  @State private var itemSheet: PosKioskProduct?
  @State private var cartOpen = false

  var body: some View {
    ZStack(alignment: .top) {
      screen
      if model.offline {
        AglynNotice("Reconnecting…", tone: .warning).padding(AglynSpace.one)
      }
    }
    .overlay(alignment: .topLeading) {
      if model.phase == .start || model.phase == .menu {
        KioskStaffControl(model: model, onExit: onExit)
      }
    }
    .task(id: CatalogKey(token: model.token, categoryID: model.categoryID, turn: model.turn)) {
      await model.loadCatalog()
    }
    // The card in flight, asked after until it is paid or fails.
    .task(id: model.phase) {
      guard case .paying(_, let paymentID, _, nil) = model.phase, paymentID != nil else { return }
      while !Task.isCancelled {
        try? await Task.sleep(for: posKioskPaymentPoll)
        if Task.isCancelled { return }
        await model.pollPayment()
        guard case .paying(_, _, _, nil) = model.phase else { return }
      }
    }
    .sheet(item: $itemSheet) { product in
      KioskItemSheet(model: model, product: product) { itemSheet = nil }
    }
    .sheet(isPresented: $cartOpen) { KioskCartSheet(model: model) { cartOpen = false } }
    .alert(
      "Still there?", isPresented: Binding(get: { model.idleWarning != nil }, set: { if !$0 { model.touch() } })
    ) {
      Button("Start over", role: .destructive) { Task { await model.reset() } }
      Button("I’m still here") { model.touch() }
    } message: {
      Text("This order will be cleared in \(model.idleWarning ?? 0) seconds.")
    }
  }

  @ViewBuilder private var screen: some View {
    let branding = model.context.map { PosDeviceBranding.from($0.branding, origin: origin) }
    switch model.phase {
    case .start:
      PosDeviceBrandScreen(branding: branding, title: nil, message: branding?.message ?? "Order here", busy: false) {
        Button("Start order") { model.startOrder() }
          .buttonStyle(DeviceButtonStyle()).frame(maxWidth: 360)
          .accessibilityIdentifier("kiosk-start")
      }
    case .menu:
      KioskMenuView(model: model, origin: origin, onProduct: tap, onCart: { cartOpen = true })
    case .review:
      if let sale = model.sale { KioskReviewView(model: model, sale: sale, branding: branding) }
    case .tip(let method):
      if let sale = model.sale, let context = model.context {
        DeviceScroll(branding: branding, notice: nil) {
          VStack(spacing: AglynSpace.three) {
            DisplayTipView(
              tip: PosDisplayStateTip(
                allowCustom: true, baseCents: Double(sale.dueCents), percentages: context.tipping.percentages),
              currency: model.currency, busy: model.busy, promptID: "kiosk-\(sale.orderId)",
              onAnswer: { answer in
                let chosen: PosKioskTip =
                  answer.tipChoice == .percent ? .percent(answer.tipPercent ?? 0)
                  : answer.tipChoice == .custom ? .custom(answer.tipCents ?? 0) : PosKioskTip.none
                Task { await model.tipChosen(method, chosen) }
              })
            Button("Back") { model.backToReview() }.disabled(model.busy)
          }
        }
      }
    case .paying(let method, let paymentID, let charge, let failure):
      KioskPayingView(model: model, method: method, paymentID: paymentID, chargeCents: charge, failure: failure)
    case .receipt:
      if let sale = model.sale, let context = model.context {
        DeviceScroll(branding: branding, notice: model.notice) {
          DisplayReceiptView(
            receipt: PosDisplayStateReceipt(channels: context.receipts, offerMarketing: context.offerMarketing), busy: model.busy,
            promptID: "kiosk-\(sale.orderId)",
            onAnswer: { answer in
              guard let channel = answer.receiptChannel else { return }
              Task {
                await model.answerReceipt(
                  channel: channel, to: answer.email ?? answer.phone, marketingOptIn: answer.marketingOptIn == true)
              }
            })
        }
      }
    case .done:
      if let sale = model.sale { KioskDoneView(model: model, sale: sale) }
    }
  }

  private func tap(_ product: PosKioskProduct) {
    let item = posItem(from: product)
    if item.needsSheet {
      itemSheet = product
    } else if let variant = item.variants.first {
      model.add(item, variant)
    }
  }
}

extension PosKioskProduct: @retroactive Identifiable {}

extension PosDeviceBranding {
  /// The kiosk's branding as its context carries it, its logos served from the console the kiosk is paired with.
  static func from(_ branding: PosKioskContextBranding, origin: String) -> PosDeviceBranding {
    PosDeviceBranding(
      name: branding.name, logoURL: mediaPreviewURL(branding.logoUrl, origin: origin, hostID: nil, width: 640),
      logoDarkURL: mediaPreviewURL(branding.logoDarkUrl, origin: origin, hostID: nil, width: 640),
      message: branding.message)
  }
}

/// The menu: category chips, the product tiles, and the cart bar.
private struct KioskMenuView: View {
  let model: PosKioskModel
  let origin: String
  let onProduct: (PosKioskProduct) -> Void
  let onCart: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack {
          AglynChoiceChip("All", selected: model.categoryID == nil) { model.categoryID = nil }
          ForEach(model.catalog?.categories ?? [], id: \.id) { category in
            AglynChoiceChip(category.name, selected: model.categoryID == category.id) { model.categoryID = category.id }
          }
        }
        .padding(AglynSpace.two)
        // The faint Staff control sits in the top-leading corner; the chips start on the line below it, as on Android.
        .padding(.top, kioskStaffClearance)
      }
      Divider()
      if let notice = model.notice { AglynNotice(notice, tone: .warning) { model.notice = nil }.padding(AglynSpace.two) }
      ScrollView {
        if model.catalogLoading && model.catalog == nil {
          ProgressView().padding(AglynSpace.four)
        } else if (model.catalog?.products ?? []).isEmpty {
          Text("Nothing here yet. Try another category.").font(AglynFont.title2).foregroundStyle(.secondary).padding(AglynSpace.four)
        } else {
          // The register's tile, so every tile keeps the same picture band (the photo, or the product's initial) and a
          // two-line name: a row with one photo, or one long name, stays even, as on Android (AGL-3925).
          LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 170), spacing: AglynSpace.two, alignment: .top)], spacing: AglynSpace.two
          ) {
            ForEach(model.catalog?.products ?? [], id: \.id) { product in
              let soldOut = kioskProductSoldOut(product)
              AglynItemTile(
                product.name,
                subtitle: soldOut ? "Sold out" : "\(product.variants.count > 1 ? "From " : "")\(model.money(kioskFromCents(product)))",
                // The server sends a `/api/media/cdn/…` path (or a media reference), served from the paired console.
                imageURL: product.imageUrl.flatMap { mediaPreviewURL($0, origin: origin, hostID: nil) }
              ) { onProduct(product) }
              .disabled(soldOut)
              .opacity(soldOut ? 0.5 : 1)
              .accessibilityIdentifier("kiosk-tile-\(product.id)")
            }
          }
          .padding(AglynSpace.two)
        }
      }
      if model.cartCount > 0 {
        HStack(spacing: AglynSpace.two) {
          Button("Cart (\(model.cartCount))", action: onCart).buttonStyle(DeviceButtonStyle(prominent: false)).frame(maxWidth: 220)
          Button(model.busy ? "Getting your total…" : "Checkout · \(model.money(model.cartEstimateCents))") {
            Task { await model.checkout() }
          }
          .buttonStyle(DeviceButtonStyle()).disabled(model.busy)
          .accessibilityIdentifier("kiosk-checkout")
        }
        .padding(AglynSpace.two)
        .background(AglynColor.paper)
      }
    }
  }
}

/// Options and modifiers for one product, picked before it goes in the cart.
private struct KioskItemSheet: View {
  let model: PosKioskModel
  let product: PosKioskProduct
  let close: () -> Void
  @State private var variantID: String
  @State private var picks: [ModifierSelection] = []
  @State private var quantity = 1
  @State private var problem: String?

  init(model: PosKioskModel, product: PosKioskProduct, close: @escaping () -> Void) {
    self.model = model
    self.product = product
    self.close = close
    let first = product.variants.first { !$0.soldOut } ?? product.variants.first
    _variantID = State(initialValue: first?.id ?? "default")
  }

  private var item: PosItem { posItem(from: product) }

  var body: some View {
    let item = item
    NavigationStack {
      Form {
        if item.variants.count > 1 {
          Section("Option") {
            ForEach(item.variants) { variant in
              Button {
                variantID = variant.id
              } label: {
                HStack {
                  Text(variant.label ?? "Default")
                  if variant.soldOut { StatusChip("Sold out", tone: .warning) }
                  Spacer()
                  Text(variant.unitCents.map(model.money) ?? "").foregroundStyle(.secondary).monospacedDigit()
                  if variant.id == variantID { Image(systemName: "checkmark").foregroundStyle(AglynColor.tint) }
                }
              }
              .foregroundStyle(.primary)
              .disabled(variant.soldOut)
            }
          }
        }
        ForEach(item.modifierGroups, id: \.id) { group in
          Section {
            ForEach(group.options, id: \.id) { option in
              let chosen = picks.contains { $0.groupId == group.id && $0.optionId == option.id }
              Button {
                toggle(group, option.id)
              } label: {
                HStack {
                  Text(option.name)
                  Spacer()
                  if option.priceCents > 0 { Text("+\(model.money(Int(option.priceCents)))").foregroundStyle(.secondary).monospacedDigit() }
                  Image(
                    systemName: chosen
                      ? (group.isSingle ? "largecircle.fill.circle" : "checkmark.square.fill") : (group.isSingle ? "circle" : "square")
                  )
                  .foregroundStyle(chosen ? AglynColor.tint : .secondary)
                }
              }
              .foregroundStyle(.primary)
            }
          } header: {
            Text(group.name)
          } footer: {
            Text(group.isRequired ? "Required" : group.isSingle ? "Optional" : "Choose up to \(Int(group.max))")
          }
        }
        Section {
          HStack {
            Text("Quantity")
            Spacer()
            AglynQuantityStepper(value: quantity, range: 1...Int(ContractValues.shared.posKioskMaxQuantity)) { quantity = $0 }
          }
          if let problem { AglynNotice(problem, tone: .error) }
        }
      }
      .formStyle(.grouped)
      .navigationTitle(product.name)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel", action: close) }
        ToolbarItem(placement: .confirmationAction) { Button("Add", action: add).accessibilityIdentifier("kiosk-item-add") }
      }
    }
    .presentationDetents([.medium, .large])
  }

  private func toggle(_ group: ProductModifierGroup, _ optionID: String) {
    let selection = ModifierSelection(groupId: group.id, optionId: optionID)
    if let index = picks.firstIndex(of: selection) {
      picks.remove(at: index)
    } else {
      if group.isSingle { picks.removeAll { $0.groupId == group.id } }
      picks.append(selection)
    }
    problem = nil
  }

  private func add() {
    let item = item
    guard let variant = item.variants.first(where: { $0.id == variantID }) else { return }
    if case .problem(let message) = pick(item, variant, modifiers: picks) {
      problem = message
      return
    }
    model.add(item, variant, picks: picks, quantity: quantity)
    close()
  }
}

/// The cart: every line with its steppers, and the way on to checkout.
private struct KioskCartSheet: View {
  let model: PosKioskModel
  let close: () -> Void

  var body: some View {
    NavigationStack {
      List {
        ForEach(model.cart.lines) { line in
          HStack {
            VStack(alignment: .leading, spacing: 2) {
              Text(line.name).font(AglynFont.headline)
              if let label = line.variantLabel { Text(label).font(AglynFont.subheadline).foregroundStyle(.secondary) }
              Text(model.money(line.estimateCents)).font(AglynFont.subheadline).monospacedDigit()
            }
            Spacer()
            AglynQuantityStepper(
              value: line.quantity, range: 1...Int(ContractValues.shared.posKioskMaxQuantity),
              onChange: { model.setQuantity(line.key, $0) }, onRemove: { model.setQuantity(line.key, 0) })
          }
        }
        if model.cart.isEmpty { Text("Your cart is empty.").foregroundStyle(.secondary) }
        Section { Text("Tax is added at checkout.").font(AglynFont.caption).foregroundStyle(.secondary) }
      }
      .navigationTitle("Your order")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Keep ordering", action: close) }
        ToolbarItem(placement: .confirmationAction) {
          Button("Checkout · \(model.money(model.cartEstimateCents))") {
            close()
            Task { await model.checkout() }
          }
          .disabled(model.busy || model.cart.isEmpty)
        }
      }
    }
  }
}

/// The priced order: every line, the server's subtotal, discount, tax and total, and the ways to pay. Nothing here was computed on the kiosk.
private struct KioskReviewView: View {
  let model: PosKioskModel
  let sale: PosKioskSale
  let branding: PosDeviceBranding?

  var body: some View {
    let none = !model.canPayByReader && !model.canPayByTap && !model.canPayAtCounter
    DeviceScroll(branding: branding, notice: nil) {
      VStack(alignment: .leading, spacing: AglynSpace.two) {
        Text("Review your order").font(AglynFont.largeTitle)
        ForEach(Array(sale.lines.enumerated()), id: \.offset) { _, line in
          HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
              Text("\(line.quantity) × \(line.name)").font(AglynFont.headline)
              if let label = line.variantLabel, !label.isEmpty { Text(label).font(AglynFont.subheadline).foregroundStyle(.secondary) }
            }
            Spacer()
            Text(model.money(line.amountCents)).font(AglynFont.headline).monospacedDigit()
          }
          Divider()
        }
        row("Subtotal", sale.itemsCents)
        if sale.discountCents > 0 { row("Discount", sale.discountCents, negative: true) }
        row("Tax", sale.taxCents)
        row("Total", sale.totalCents, strong: true)
        if let notice = model.notice { AglynNotice(notice, tone: .warning) }
        if none { AglynNotice("Payment is not set up on this kiosk yet. Please order at the counter.", tone: .info) }
        if model.canPayByReader {
          Button("Pay with card") { Task { await model.choosePay(.reader) } }
            .buttonStyle(DeviceButtonStyle()).disabled(model.busy).accessibilityIdentifier("kiosk-pay-card")
        }
        if model.canPayByTap {
          Button("Tap to Pay") { Task { await model.choosePay(.tap) } }
            .buttonStyle(DeviceButtonStyle(prominent: !model.canPayByReader)).disabled(model.busy)
            .accessibilityIdentifier("kiosk-pay-tap")
        }
        if model.canPayAtCounter {
          Button("Pay at counter") { Task { await model.sendToCounter() } }
            .buttonStyle(DeviceButtonStyle(prominent: !model.canPayByReader && !model.canPayByTap)).disabled(model.busy)
            .accessibilityIdentifier("kiosk-pay-counter")
        }
        Button("Back to menu") { Task { await model.backToMenu() } }.disabled(model.busy).frame(maxWidth: .infinity)
      }
    }
  }

  private func row(_ label: String, _ cents: Int, negative: Bool = false, strong: Bool = false) -> some View {
    HStack {
      Text(label).font(strong ? AglynFont.title : AglynFont.body)
      Spacer()
      Text((negative ? "−" : "") + model.money(cents)).font(strong ? AglynFont.title : AglynFont.body).monospacedDigit()
    }
  }
}

/// Waiting on the card: the reader's prompt, or the device's Tap to Pay.
private struct KioskPayingView: View {
  let model: PosKioskModel
  let method: PosKioskMethod
  let paymentID: String?
  let chargeCents: Int
  let failure: String?

  var body: some View {
    VStack(spacing: AglynSpace.four) {
      Text(
        failure != nil
          ? "The card did not go through"
          : method == .reader ? "Tap, insert or swipe your card on the reader" : "Hold your card near the device"
      )
      .font(AglynFont.largeTitle).multilineTextAlignment(.center)
      Text("Total \(model.money(chargeCents))").font(AglynFont.title2).foregroundStyle(.secondary)
      if let failure { AglynNotice(failure, tone: .error).frame(maxWidth: 520) }
      if failure != nil {
        Button("Try again") { Task { await model.retryPayment() } }.buttonStyle(DeviceButtonStyle()).frame(maxWidth: 520).disabled(model.busy)
        if model.canPayAtCounter {
          Button("Pay at counter") { Task { await model.sendToCounter() } }
            .buttonStyle(DeviceButtonStyle(prominent: false)).frame(maxWidth: 520).disabled(model.busy)
        }
      } else if model.context?.testMode == true, method == .reader, paymentID != nil {
        Button("Test mode: tap a test card") { Task { await model.simulate() } }.buttonStyle(.aglynSecondary).disabled(model.busy)
      } else {
        ProgressView().controlSize(.large)
      }
      Button(failure != nil ? "Back to my order" : "Cancel") { Task { await model.cancelPayment() } }.disabled(model.busy)
    }
    .padding(AglynSpace.four)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

/// The order number the customer is called by, paid or to pay at the counter.
private struct KioskDoneView: View {
  let model: PosKioskModel
  let sale: PosKioskSale

  var body: some View {
    let queued = sale.status == .queued
    VStack(spacing: AglynSpace.four) {
      Text("Your order number").font(AglynFont.title2).foregroundStyle(.secondary)
      Text("\(sale.number)").font(.system(size: 120, weight: .bold, design: .rounded)).monospacedDigit()
        .accessibilityLabel("Order number \(sale.number)").accessibilityIdentifier("kiosk-number")
      Text(queued ? "Please pay at the counter" : "Thank you!").font(AglynFont.largeTitle)
      Text(
        queued
          ? "Show this number at the counter. Total \(model.money(sale.totalCents))." : "We’ll call your number when your order is ready."
      )
      .font(AglynFont.title2).foregroundStyle(.secondary).multilineTextAlignment(.center)
      Button("Done") { Task { await model.reset() } }.buttonStyle(DeviceButtonStyle()).frame(maxWidth: 360)
        .accessibilityIdentifier("kiosk-done")
    }
    .padding(AglynSpace.four)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

/// How far below the top the menu's chips start, clear of the Staff control in that corner.
private let kioskStaffClearance: CGFloat = AglynSpace.three

/// Staff unlock: a corner button, then the staff PIN the register uses, checked on the server. No names are listed, the
/// screen faces the public, and a right PIN opens the kiosk's settings for a few minutes: which card reader it sends
/// payments to, and leaving kiosk mode.
private struct KioskStaffControl: View {
  let model: PosKioskModel
  let onExit: () -> Void
  @State private var staff = PosKioskStaffModel()

  var body: some View {
    Button("Staff") { staff.open() }
      .font(AglynFont.caption).buttonStyle(.plain).foregroundStyle(.secondary).opacity(0.5)
      .padding(AglynSpace.one)
      .accessibilityIdentifier("kiosk-staff")
      .sheet(isPresented: Binding(get: { staff.stage != .closed }, set: { if !$0 { staff.close() } })) {
        KioskStaffSheet(model: model, staff: staff, onExit: onExit)
      }
  }
}

private struct KioskStaffSheet: View {
  let model: PosKioskModel
  @Bindable var staff: PosKioskStaffModel
  let onExit: () -> Void

  var body: some View {
    NavigationStack {
      Form {
        if let error = staff.error { Section { AglynNotice(error, tone: .error) } }
        switch staff.stage {
        case .settings:
          if let view = staff.view, !view.readers.isEmpty {
            Section("Card reader") {
              Picker("Card reader", selection: Binding(get: { view.readerID ?? "" }, set: { id in Task { await staff.chooseReader(model, id) } })) {
                Text("None — pay at counter only").tag("")
                ForEach(view.readers) { reader in Text("\(reader.label) (\(reader.status))").tag(reader.id) }
              }
            }
          } else {
            Section { Text("No card reader is assigned to this register.").foregroundStyle(.secondary) }
          }
          Section {
            if staff.confirmExit {
              AglynNotice("This unpairs the kiosk. To use it again, show a new kiosk code on the register.", tone: .warning)
              Button("Exit kiosk mode", role: .destructive) { Task { if await staff.exit(model) { onExit() } } }
                .disabled(staff.busy)
            } else {
              Button("Exit kiosk mode", role: .destructive) { staff.confirmExit = true }.disabled(staff.busy)
            }
          }
        default:
          Section {
            SecureField("Staff PIN", text: $staff.pin)
              #if os(iOS)
                .keyboardType(.numberPad)
              #endif
              .onChange(of: staff.pin) { _, text in staff.pin = String(text.filter(\.isNumber).prefix(6)) }
              .accessibilityIdentifier("kiosk-staff-pin")
          } header: {
            Text("Enter your register PIN.")
          }
          Section {
            Button(staff.busy ? "Checking…" : "Unlock") { Task { if await staff.submit(model) { onExit() } } }
              .disabled(staff.busy || staff.pin.count < 4)
              .accessibilityIdentifier("kiosk-staff-unlock")
          }
        }
      }
      .navigationTitle(staff.stage == .settings ? (staff.view?.label ?? "").nilIfEmptyOr("Kiosk settings") : "Staff unlock")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { staff.close() }.disabled(staff.busy) } }
    }
    // The unlock lapses on its own: the settings close with it.
    .task(id: staff.unlock?.unlock) {
      guard let unlock = staff.unlock else { return }
      let wait = max(0, unlock.expiresAtMs - Double(nowMs()))
      try? await Task.sleep(for: .milliseconds(wait))
      if !Task.isCancelled { staff.close() }
    }
    .aglynSheetMinimumSize(width: 380, height: 360)
  }
}

private extension String {
  func nilIfEmptyOr(_ fallback: String) -> String { isEmpty ? fallback : self }
}

/// The staff unlock's state.
@MainActor
@Observable
final class PosKioskStaffModel {
  enum Stage { case closed, pin, settings }

  private(set) var stage = Stage.closed
  var pin = ""
  private(set) var unlock: PosKioskUnlock?
  private(set) var view: PosKioskSettingsView?
  private(set) var error: String?
  private(set) var busy = false
  var confirmExit = false

  func open() { stage = .pin }

  func close() {
    if busy { return }
    stage = .closed
    pin = ""
    unlock = nil
    view = nil
    error = nil
    confirmExit = false
  }

  /// A right PIN opens the settings. True when the kiosk turned out to be unpaired already (leave).
  func submit(_ model: PosKioskModel) async -> Bool {
    guard !busy, pin.count >= 4, let token = model.token else { return false }
    busy = true
    error = nil
    let entered = pin
    pin = ""
    defer { busy = false }
    do {
      let opened = try await model.staffAPI.unlock(token: token, pin: entered)
      unlock = opened
      view = try? await model.staffAPI.settings(token: token, unlock: opened.unlock)
      stage = .settings
    } catch let failure as ConsoleAPIError {
      if failure.status == 401, failure.message.lowercased().contains("not paired") { return true }
      error = failure.message
    } catch {
      self.error = "That PIN is not right."
    }
    return false
  }

  func chooseReader(_ model: PosKioskModel, _ readerID: String) async {
    guard let unlock, let token = model.token, !busy else { return }
    busy = true
    defer { busy = false }
    do {
      view = try await model.staffAPI.setReader(token: token, unlock: unlock.unlock, readerID: readerID)
    } catch {
      self.error = (error as? ConsoleAPIError)?.message ?? "The card reader could not be changed."
    }
  }

  /// Leaves kiosk mode. True when the kiosk was unpaired.
  func exit(_ model: PosKioskModel) async -> Bool {
    guard let unlock, let token = model.token, !busy else { return false }
    busy = true
    defer { busy = false }
    do {
      try await model.staffAPI.exit(token: token, unlock: unlock.unlock)
      return true
    } catch {
      self.error = (error as? ConsoleAPIError)?.message ?? "Kiosk mode could not be turned off."
      return false
    }
  }
}
