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
      addOnsSection
    }
  }

  /// Add-ons (AGL-4100), as the console's editor has them: groups of choices added to the item that need no stock of
  /// their own, each free or adding to the price, priced by size where the product has sizes, and shown on the
  /// website or kept to the register.
  @ViewBuilder private var addOnsSection: some View {
    Section {
      Text(
        "Add-ons are choices added to the item that don’t need their own stock, such as walls or printing on a canopy, "
          + "or a milk in a latte. Each can be free or add to the price, and can cost more on a larger size. Show a group "
          + "on the website to offer it on the product’s page; the register offers every group."
      )
      .font(.footnote)
      .foregroundStyle(.secondary)
    } header: {
      Text("Add-ons")
    }
    // Each group and choice is reached by id and written whole, one write to the draft at a time: nested binding
    // projections into the draft (`$model.draft.addOns` → `$group.choices`) crashed with an access conflict when a
    // choice's prices by size opened.
    ForEach(model.draft.addOns) { group in
      let binding = addOnGroupBinding(group.id)
      Section {
        TextField("Group name (Walls)", text: binding.name).accessibilityIdentifier("addon-group-name-\(group.id)")
        Stepper(value: binding.min, in: 0...Swift.max(0, group.choices.count)) {
          LabeledContent("At least", value: "\(group.min) · \(group.required ? "Required" : "Optional")")
        }
        Stepper(value: binding.max, in: 1...Swift.max(1, group.choices.count)) {
          LabeledContent("At most", value: "\(group.max)")
        }
        Toggle(isOn: Binding(get: { group.online == true }, set: { binding.wrappedValue.online = $0 })) {
          VStack(alignment: .leading, spacing: 2) {
            Text("Show on the website")
            Text(group.online == true ? "Offered on the product’s page and at the register." : "Offered at the register only.")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
        .accessibilityIdentifier("addon-group-online-\(group.id)")
        ForEach(group.choices) { choice in
          addOnChoiceRow(groupID: group.id, choice: choice)
        }
        Button {
          binding.wrappedValue = group.withChoiceAdded()
        } label: {
          Label("Add choice", systemImage: "plus")
        }
        .disabled(group.choices.count >= posMaxModifierOptions)
        .accessibilityIdentifier("addon-choice-add-\(group.id)")
        Button(role: .destructive) {
          model.draft.addOns.removeAll { $0.id == group.id }
        } label: {
          Label("Remove group", systemImage: "trash")
        }
      } header: {
        Text(group.name.trimmingCharacters(in: .whitespaces).isEmpty ? "Add-on group" : group.name)
      }
    }
    Section {
      Button {
        model.draft.addOns.append(newAddOnGroup())
      } label: {
        Label("New add-on group", systemImage: "plus")
      }
      .disabled(model.draft.addOns.count >= posMaxModifierGroups)
      .accessibilityIdentifier("addon-group-add")
    } footer: {
      if !model.draft.addOns.isEmpty, let problem = checkAddOns(model.draft.addOns) {
        Text(problem).foregroundStyle(.orange)
      }
    }
  }

  /// A group of the draft by id: read from the draft, and written back whole.
  private func addOnGroupBinding(_ id: String) -> Binding<AddOnGroupDraft> {
    Binding(
      get: { model.draft.addOns.first { $0.id == id } ?? AddOnGroupDraft(id: id) },
      set: { next in
        guard let index = model.draft.addOns.firstIndex(where: { $0.id == id }) else { return }
        model.draft.addOns[index] = next
      })
  }

  /// A choice of a group by id: read from the draft, and written back as its whole group.
  private func addOnChoiceBinding(groupID: String, choiceID: String) -> Binding<AddOnChoiceDraft> {
    Binding(
      get: {
        model.draft.addOns.first { $0.id == groupID }?.choices.first { $0.id == choiceID } ?? AddOnChoiceDraft(id: choiceID)
      },
      set: { next in
        guard let groupIndex = model.draft.addOns.firstIndex(where: { $0.id == groupID }) else { return }
        var group = model.draft.addOns[groupIndex]
        guard let index = group.choices.firstIndex(where: { $0.id == choiceID }) else { return }
        group.choices[index] = next
        model.draft.addOns[groupIndex] = group
      })
  }

  /// One choice: its name and what it adds, its prices by size where the product has sizes, and remove.
  private func addOnChoiceRow(groupID: String, choice current: AddOnChoiceDraft) -> some View {
    let choice = addOnChoiceBinding(groupID: groupID, choiceID: current.id)
    let variants = model.draft.variants
    let byLabel = priceByLabel(model.draft.options)
    // Two rows, not one: a Form row with several buttons fires them all on one tap, so opening the prices by size
    // removed the choice.
    return Group {
      HStack {
        TextField("Choice", text: choice.name).accessibilityIdentifier("addon-choice-name-\(current.id)")
        TextField("Adds ($)", text: choice.price)
          .multilineTextAlignment(.trailing)
          .monospacedDigit()
          .frame(maxWidth: 110)
          #if os(iOS)
            .keyboardType(.decimalPad)
          #endif
          .accessibilityIdentifier("addon-choice-price-\(current.id)")
        Button(role: .destructive) {
          let group = addOnGroupBinding(groupID)
          if let index = group.wrappedValue.choices.firstIndex(where: { $0.id == current.id }) {
            group.wrappedValue = group.wrappedValue.withChoiceRemoved(index)
          }
        } label: {
          Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("Remove \(current.name.isEmpty ? "choice" : current.name)")
      }
      if variants.count > 1 {
        DisclosureGroup(byLabel) {
          Text("What “\(current.name.isEmpty ? "this choice" : current.name)” adds on each. Leave one blank to use the price above.")
            .font(.caption)
            .foregroundStyle(.secondary)
          ForEach(variants) { variant in
            LabeledContent(variant.label) {
              TextField(
                current.price.isEmpty ? "0.00" : current.price,
                text: Binding(
                  get: { current.byVariant[variant.id] ?? "" },
                  set: { choice.wrappedValue = choice.wrappedValue.withVariantPrice(variant.id, $0) })
              )
              .multilineTextAlignment(.trailing)
              .monospacedDigit()
              #if os(iOS)
                .keyboardType(.decimalPad)
              #endif
            }
          }
        }
        .accessibilityIdentifier("addon-choice-by-variant-\(current.id)")
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
      // More combinations than a product holds is said with the count, beside the options (AGL-4100).
      if let problem = variantMatrixProblem(model.draft.options) {
        Text(problem).foregroundStyle(.orange)
      } else if model.draft.variants.count > 1 {
        Text("\(model.draft.variants.count) variants. Separate values with commas.")
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
