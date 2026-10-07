// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynHardware
import AglynPluginHost
import AglynUI
import SwiftUI

/// The register: the item grid beside the basket on iPad and Mac, the grid
/// with a basket bar on iPhone; checkout opens over it.
struct RegisterScreen: View {
  @State private var model: RegisterModel
  @State private var query = ""
  @State private var showBasket = false
  @State private var showDiscount = false
  @State private var scanCode = ""
  let context: NativePluginContext

  init(context: NativePluginContext) {
    self.context = context
    _model = State(
      initialValue: RegisterModel(
        hostID: context.hostID ?? "", reader: context.firestore, api: context.api,
        collector: DeviceCardCollector.make()))
  }

  var body: some View {
    WideLayoutReader { wide in
      Group {
        if wide {
          HStack(spacing: 0) {
            catalog
            Divider()
            BasketPanel(model: model, onCharge: charge, onDiscount: { showDiscount = true })
              .frame(width: 360)
              .background(AglynColor.paper)
          }
        } else {
          catalog
            .safeAreaInset(edge: .bottom) {
              if !model.cart.isEmpty { basketBar }
            }
        }
      }
      .sheet(isPresented: $showBasket) {
        NavigationStack {
          BasketPanel(model: model, onCharge: { showBasket = false; charge() }, onDiscount: { showDiscount = true })
            .navigationTitle("Basket")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showBasket = false } } }
        }
        .presentationDetents([.medium, .large])
      }
    }
    .background(AglynColor.page)
    .navigationTitle(model.storeName)
    .toolbar { toolbar }
    .searchable(text: $query, prompt: "Search products")
    .onSubmit(of: .search) { model.search(query) }
    .onChange(of: query) { _, text in if text.isEmpty { model.search("") } }
    .sheet(item: $model.sheet) { _ in ItemSheetView(model: model) }
    .sheet(isPresented: Binding(get: { model.checkout != nil }, set: { if !$0 { closeCheckout() } })) {
      if let checkout = model.checkout {
        CheckoutView(model: model, checkout: checkout)
          .interactiveDismissDisabled()
      }
    }
    .alert("Discount", isPresented: $showDiscount) {
      DiscountField(model: model)
    } message: {
      Text("A percentage off the whole sale. The store's limit applies when the sale opens.")
    }
    .overlay(alignment: .top) {
      if let toast = model.toast {
        AglynNotice(toast.message, tone: toast.tone) { model.toast = nil }
          .padding(AglynSpace.two)
          .frame(maxWidth: 520)
          .transition(.move(edge: .top).combined(with: .opacity))
          .task(id: toast.message) {
            try? await Task.sleep(for: .seconds(5))
            withAnimation { model.toast = nil }
          }
      }
    }
    .animation(.default, value: model.toast)
    .task {
      model.start()
    }
    .onDisappear { model.stop() }
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .primaryAction) {
      Menu {
        if let registers = model.registers.value, registers.count > 1 {
          Picker("Register", selection: Binding(get: { model.register }, set: { if let next = $0 { model.selectRegister(next) } })) {
            ForEach(registers) { Text($0.name).tag(Optional($0)) }
          }
        }
        Button("Card readers", systemImage: "creditcard") { context.navigate(commerceCardReadersScreen) }
        Button("Clear basket", systemImage: "xmark.bin", role: .destructive) { model.clearCart() }
          .disabled(model.cart.isEmpty)
      } label: {
        Label(model.register?.name ?? "Register", systemImage: "cashregister")
      }
      .accessibilityIdentifier("register-menu")
    }
  }

  private var basketBar: some View {
    Button { showBasket = true } label: {
      HStack {
        Label("\(model.cart.count) item\(model.cart.count == 1 ? "" : "s")", systemImage: "basket")
        Spacer()
        Text(model.money(model.cart.subtotalCents - model.cart.discountCents)).monospacedDigit()
      }
      .font(AglynFont.headline)
      .padding(AglynSpace.two)
      .frame(maxWidth: .infinity)
      .foregroundStyle(AglynColor.primaryContrast)
      .background(AglynColor.primary, in: RoundedRectangle(cornerRadius: AglynRadius.card, style: .continuous))
      .padding(.horizontal, AglynSpace.two)
      .padding(.bottom, AglynSpace.one)
    }
    .buttonStyle(.plain)
    .accessibilityIdentifier("basket-bar")
  }

  private var catalog: some View {
    VStack(spacing: 0) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: AglynSpace.one) {
          AglynChoiceChip("All", selected: model.args == PosGridArgs()) { model.showAll() }
          AglynChoiceChip("Quick keys", systemImage: "star", selected: model.args.quickKeys) { model.showQuickKeys() }
          ForEach(categoryLevel(model.categories, parentID: nil)) { category in
            AglynChoiceChip(category.name, selected: model.args.categoryID == category.id) {
              model.showCategory(category.id)
            }
          }
        }
        .padding(.horizontal, AglynSpace.two)
        .padding(.vertical, AglynSpace.oneAndHalf)
      }
      ScrollView {
        switch model.grid {
        case .loading:
          tiles(Array(repeating: nil, count: 8))
            .redacted(reason: .placeholder)
        case .failed(let message):
          AglynEmptyState("Products did not load", systemImage: "exclamationmark.triangle", message: message) {
            Button("Try again") { model.loadGrid() }
          }
        case .ready(let items) where items.isEmpty:
          AglynEmptyState(
            model.args.search.isEmpty ? "Nothing to sell here yet" : "No matches", systemImage: "shippingbox",
            message: model.args.search.isEmpty
              ? "Active products in this view show up here." : "No active product matches “\(model.args.search)”.")
        case .ready(let items):
          tiles(items.map(Optional.some))
        }
      }
    }
  }

  private func tiles(_ items: [PosItem?]) -> some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: AglynSpace.oneAndHalf)], spacing: AglynSpace.oneAndHalf) {
      ForEach(Array(items.enumerated()), id: \.offset) { _, item in
        if let item {
          AglynItemTile(
            item.name, subtitle: priceLine(item), imageURL: item.imageURL.flatMap(URL.init(string:)),
            badge: item.variants.allSatisfy(\.soldOut) ? ("Sold out", .warning) : nil
          ) { model.tap(item) }
          .accessibilityIdentifier("tile-\(item.id)")
        } else {
          AglynItemTile("Loading product", subtitle: "$00.00") {}
        }
      }
    }
    .padding(.horizontal, AglynSpace.two)
    .padding(.bottom, AglynSpace.two)
  }

  private func priceLine(_ item: PosItem) -> String {
    guard let from = item.fromCents else { return "No price" }
    if let to = item.toCents, to != from { return "\(model.money(from)) – \(model.money(to))" }
    return model.money(from)
  }

  private func charge() {
    Task { await model.charge() }
  }

  private func closeCheckout() {
    // The sheet closes only through the checkout's own buttons.
  }
}

/// The basket: its lines with steppers, the discount, the preview totals, and Charge.
struct BasketPanel: View {
  let model: RegisterModel
  let onCharge: () -> Void
  let onDiscount: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      if model.cart.isEmpty {
        AglynEmptyState("The basket is empty", systemImage: "basket", message: "Tap a product, or scan one, to ring it up.")
          .frame(maxHeight: .infinity)
      } else {
        List {
          ForEach(model.cart.lines) { line in
            HStack(alignment: .center, spacing: AglynSpace.oneAndHalf) {
              VStack(alignment: .leading, spacing: 2) {
                Text(line.name).font(AglynFont.body.weight(.medium))
                if let label = line.variantLabel {
                  Text(label).font(AglynFont.subheadline).foregroundStyle(.secondary)
                }
                Text(model.money(line.unitCents * line.quantity)).font(AglynFont.subheadline.monospacedDigit())
              }
              Spacer()
              AglynQuantityStepper(
                value: line.quantity, range: 1...posLineMaxQuantity, onChange: { model.setQuantity(line.key, $0) },
                onRemove: { model.setQuantity(line.key, 0) })
            }
            .swipeActions { Button("Remove", role: .destructive) { model.setQuantity(line.key, 0) } }
          }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
      }
      VStack(spacing: AglynSpace.one) {
        Divider()
        AglynAmountRow("Subtotal", amount: model.money(model.cart.subtotalCents))
        Button(action: onDiscount) {
          AglynAmountRow(
            model.cart.discountPct > 0 ? "Discount (\(model.cart.discountPct)%)" : "Add a discount",
            amount: model.cart.discountPct > 0 ? "−\(model.money(model.cart.discountCents))" : "")
        }
        .buttonStyle(.plain)
        .foregroundStyle(AglynColor.tint)
        .disabled(model.cart.isEmpty)
        Text("Tax is added when the sale opens.").font(AglynFont.caption).foregroundStyle(.secondary)
          .frame(maxWidth: .infinity, alignment: .leading)
        Button(action: onCharge) {
          Group {
            if model.charging {
              ProgressView()
            } else {
              Text("Charge \(model.money(model.cart.subtotalCents - model.cart.discountCents))").monospacedDigit()
            }
          }
          .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .disabled(model.cart.isEmpty || model.charging || model.register == nil)
        .keyboardShortcut(.return, modifiers: .command)
        .accessibilityIdentifier("charge")
        if model.register == nil, case .ready = model.registers {
          Text("Add a register in the console to take sales here.").font(AglynFont.caption).foregroundStyle(AglynColor.warning)
        }
      }
      .padding(AglynSpace.two)
    }
  }
}

private struct DiscountField: View {
  let model: RegisterModel
  @State private var text = ""

  var body: some View {
    TextField("Percent", text: $text)
      #if os(iOS)
        .keyboardType(.numberPad)
      #endif
      .onAppear { text = model.cart.discountPct > 0 ? "\(model.cart.discountPct)" : "" }
    Button("Apply") { model.setDiscount(Double(text) ?? 0) }
    Button("Remove discount", role: .destructive) { model.setDiscount(0) }
    Button("Cancel", role: .cancel) {}
  }
}

/// A product's options and modifiers, picked before it goes in the basket.
struct ItemSheetView: View {
  @Bindable var model: RegisterModel
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    if let sheet = model.sheet {
      NavigationStack {
        Form {
          if sheet.item.variants.count > 1 {
            Section("Option") {
              ForEach(sheet.item.variants) { variant in
                Button {
                  model.sheet?.variant = variant
                } label: {
                  HStack {
                    Text(variant.label ?? "Default")
                    if variant.soldOut { StatusChip("Sold out", tone: .warning) }
                    Spacer()
                    Text(variant.unitCents.map(model.money) ?? "No price").foregroundStyle(.secondary).monospacedDigit()
                    if variant.id == sheet.variant.id { Image(systemName: "checkmark").foregroundStyle(AglynColor.tint) }
                  }
                }
                .foregroundStyle(.primary)
              }
            }
          }
          ForEach(sheet.item.modifierGroups, id: \.id) { group in
            Section {
              ForEach(group.options, id: \.id) { option in
                let chosen = sheet.picks.contains { $0.groupId == group.id && $0.optionId == option.id }
                Button {
                  toggle(group, option.id)
                } label: {
                  HStack {
                    Text(option.name)
                    Spacer()
                    if option.priceCents > 0 {
                      Text("+\(model.money(Int(option.priceCents)))").foregroundStyle(.secondary).monospacedDigit()
                    }
                    Image(systemName: chosen ? (group.isSingle ? "largecircle.fill.circle" : "checkmark.square.fill") : (group.isSingle ? "circle" : "square"))
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
              AglynQuantityStepper(value: sheet.quantity, range: 1...posLineMaxQuantity) { model.sheet?.quantity = $0 }
            }
            if let problem = sheet.problem { AglynNotice(problem, tone: .error) }
          }
        }
        .formStyle(.grouped)
        .navigationTitle(sheet.item.name)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { model.sheet = nil } }
          ToolbarItem(placement: .confirmationAction) {
            Button("Add") { model.addFromSheet() }.accessibilityIdentifier("item-sheet-add")
          }
        }
      }
      .presentationDetents([.medium, .large])
    }
  }

  private func toggle(_ group: ProductModifierGroup, _ optionID: String) {
    guard var sheet = model.sheet else { return }
    let selection = ModifierSelection(groupId: group.id, optionId: optionID)
    if let index = sheet.picks.firstIndex(of: selection) {
      sheet.picks.remove(at: index)
    } else {
      if group.isSingle { sheet.picks.removeAll { $0.groupId == group.id } }
      sheet.picks.append(selection)
    }
    sheet.problem = nil
    model.sheet = sheet
  }
}
