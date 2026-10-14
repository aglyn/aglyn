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
      ForEach($model.draft.variants) { $variant in
        Section(model.draft.variants.count > 1 ? variant.label : "Price and codes") {
          amountField("Price", text: $variant.price).accessibilityIdentifier("variant-price-\(variant.id)")
          amountField("Compare-at price", text: $variant.compareAt)
          TextField("SKU", text: $variant.sku).autocorrectionDisabled()
          TextField("Barcode", text: $variant.barcode).autocorrectionDisabled()
          if model.draft.create {
            TextField("Starting stock (leave empty to not track)", text: $variant.stock)
              #if os(iOS)
                .keyboardType(.numberPad)
              #endif
          }
        }
      }
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
