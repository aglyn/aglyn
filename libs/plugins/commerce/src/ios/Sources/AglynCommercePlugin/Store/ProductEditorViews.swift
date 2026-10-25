// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The options a product field offers, as the console's products list names them.
private func productOptions(_ field: String, fallback: [String]) -> [(value: String, label: String)] {
  let options = ContractValues.shared.productListOptions[field]?.map { ($0.value, $0.label) } ?? []
  return options.isEmpty ? fallback.map { ($0, $0.capitalized) } : options
}

/// New product or Edit: name, description, status, type, and each variant's
/// price, compare-at price and codes (a new product's starting stock too).
struct ProductEditorSheet: View {
  let context: NativePluginContext
  @State var model: ProductEditorModel
  var onSaved: (String) -> Void = { _ in }

  var body: some View {
    AglynFormSheet(
      model.draft.create ? "New product" : "Edit product", confirm: model.draft.create ? "Add" : "Save",
      canConfirm: !model.draft.name.trimmingCharacters(in: .whitespaces).isEmpty,
      save: {
        guard let hostID = context.hostID else { return }
        try await model.save(ConsoleProductWriteAPI(api: context.api), hostID: hostID)
        onSaved(model.draft.productID)
      }
    ) {
      Section {
        TextField("Name", text: $model.draft.name).accessibilityIdentifier("product-name")
        TextField("Description", text: $model.draft.description, axis: .vertical).lineLimit(2...6)
        Picker("Status", selection: $model.draft.status) {
          ForEach(productOptions("status", fallback: ["draft", "active", "archived"]), id: \.value) { option in
            if let status = ProductStatus(rawValue: option.value), status != .unknown {
              Text(option.label).tag(status)
            }
          }
        }
        Picker("Type", selection: $model.draft.type) {
          ForEach(productOptions("type", fallback: ["physical", "digital", "service"]), id: \.value) { option in
            if let type = ProductType(rawValue: option.value), type != .unknown {
              Text(option.label).tag(type)
            }
          }
        }
      }
      optionsSection
      checkInSection
      ForEach($model.draft.variants) { $variant in
        Section(model.draft.variants.count > 1 ? variant.label : "Price and codes") {
          amountField("Price", text: $variant.price).accessibilityIdentifier("variant-price-\(variant.id)")
          amountField("Compare-at price", text: $variant.compareAt)
          TextField("SKU", text: $variant.sku).autocorrectionDisabled()
          TextField("Barcode", text: $variant.barcode).autocorrectionDisabled()
          if model.draft.create || variant.fresh {
            TextField("Starting stock (leave empty to not track)", text: $variant.stock)
              #if os(iOS)
                .keyboardType(.numberPad)
              #endif
          }
        }
      }
    }
  }

  /// Up to three options, each a name and its comma-separated values; the variants below are their combinations.
  @ViewBuilder private var optionsSection: some View {
    Section {
      ForEach(Array(model.draft.options.enumerated()), id: \.element.id) { index, option in
        VStack(alignment: .leading, spacing: 8) {
          HStack {
            TextField(
              "Option name (Size)",
              text: Binding(get: { option.name }, set: { model.draft = model.draft.withOptionName(index, $0) })
            )
            .accessibilityIdentifier("option-name-\(index)")
            Button(role: .destructive) {
              model.draft = model.draft.withOptionRemoved(index)
            } label: {
              Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove option \(option.name.isEmpty ? String(index + 1) : option.name)")
            .accessibilityIdentifier("option-remove-\(index)")
          }
          TextField(
            "Values (Small, Medium, Large)",
            text: Binding(get: { option.valuesText }, set: { model.draft = model.draft.withOptionValues(index, $0) })
          )
          .accessibilityIdentifier("option-values-\(index)")
        }
      }
      if model.draft.options.count < commerceMaxOptions {
        Button {
          model.draft = model.draft.withOptionAdded()
        } label: {
          Label(model.draft.options.isEmpty ? "Add options like size or color" : "Add another option", systemImage: "plus")
        }
        .accessibilityIdentifier("option-add")
      }
    } header: {
      Text("Options")
    } footer: {
      if model.draft.variants.count > 1 { Text("\(model.draft.variants.count) variants. Separate values with commas.") }
    }
  }

  /// Check-in at the window (AGL-4063): whether each one sold is somebody to check in on the day it was bought, how many
  /// people one admits, and (with variants) each variant's own choice. The console's `ProductCheckInFields`, in its words.
  @ViewBuilder private var checkInSection: some View {
    Section {
      Toggle("Needs check-in", isOn: $model.draft.needsCheckIn).accessibilityIdentifier("product-needs-check-in")
      if model.draft.needsCheckIn {
        LabeledContent("People per item") {
          TextField("1", text: $model.draft.headcount)
            .multilineTextAlignment(.trailing)
            .monospacedDigit()
            #if os(iOS)
              .keyboardType(.numberPad)
            #endif
            .accessibilityIdentifier("product-check-in-headcount")
        }
      }
      if model.draft.variants.count > 1 {
        ForEach($model.draft.variants) { $variant in
          Picker(variant.label, selection: $variant.checkIn) {
            Text(model.draft.needsCheckIn ? "Same as the product (needs check-in)" : "Same as the product (no check-in)")
              .tag(VariantCheckIn.product)
            Text("Needs check-in").tag(VariantCheckIn.on)
            Text("No check-in").tag(VariantCheckIn.off)
          }
          .accessibilityIdentifier("variant-check-in-\(variant.id)")
          if variant.checkIn == .on {
            LabeledContent("People per item") {
              TextField("1", text: $variant.headcount)
                .multilineTextAlignment(.trailing)
                .monospacedDigit()
                #if os(iOS)
                  .keyboardType(.numberPad)
                #endif
            }
          }
        }
      }
    } header: {
      Text("Check-in")
    } footer: {
      let people = checkInHeadcount(model.draft.headcount)
      Text(
        "Each one sold, online or at the register, is somebody to check in at the window on the day it was bought, with an "
          + "optional wristband number or color."
          + (model.draft.needsCheckIn ? (people > 1 ? " Buying 3 makes \(3 * people) check-ins." : " Buying 3 makes 3 check-ins.") : ""))
    }
  }

  private func amountField(_ title: String, text: Binding<String>) -> some View {
    LabeledContent(title) {
      TextField("0.00", text: text)
        .multilineTextAlignment(.trailing)
        .monospacedDigit()
        #if os(iOS)
          .keyboardType(.decimalPad)
        #endif
    }
  }
}

/// Adjust stock: which variant, by how many units (`+5`, `-2`), and why.
struct StockAdjustSheet: View {
  let context: NativePluginContext
  let row: ProductRow
  @State private var model: StockAdjustModel

  init(context: NativePluginContext, row: ProductRow) {
    self.context = context
    self.row = row
    _model = State(initialValue: StockAdjustModel(productID: row.id, variantID: row.item.variants.first?.id ?? "default"))
  }

  private var current: Int? { row.item.variants.first { $0.id == model.draft.variantID }?.inventory }

  var body: some View {
    AglynFormSheet(
      "Adjust stock", confirm: "Adjust", canConfirm: stockDelta(model.draft.change) != nil,
      save: {
        guard let hostID = context.hostID else { return }
        try await model.apply(ConsoleProductWriteAPI(api: context.api), hostID: hostID)
      }
    ) {
      Section {
        if row.item.variants.count > 1 {
          Picker("Variant", selection: $model.draft.variantID) {
            ForEach(row.item.variants) { variant in Text(variant.label ?? variant.id).tag(variant.id) }
          }
        }
        LabeledContent("On hand", value: current.map(String.init) ?? "Not tracked")
        LabeledContent("Change") {
          TextField("+5 or -2", text: $model.draft.change)
            .multilineTextAlignment(.trailing)
            .monospacedDigit()
            .accessibilityIdentifier("stock-change")
            #if os(iOS)
              .keyboardType(.numbersAndPunctuation)
            #endif
        }
        Picker("Reason", selection: $model.draft.reason) {
          ForEach(stockReasons, id: \.value) { reason in Text(reason.label).tag(reason.value) }
        }
      } footer: {
        if let delta = stockDelta(model.draft.change), let current {
          Text("\(current) → \(current + delta) on hand")
        }
      }
    }
  }
}
