// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The site's products: status chips, a name search, in name order; in a
/// wide window the list sits beside the selected product.
struct ProductsScreen: View {
  let context: NativePluginContext
  /// Opens New product at once (the New product quick action).
  var startNew = false
  @State private var model = ProductsModel()
  @State private var creating: ProductEditorModel?
  @State private var created: String?
  @State private var selection: ProductRow.ID?
  @State private var searchText = ""

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        HStack(spacing: 0) {
          list(selectable: true).frame(minWidth: 320, idealWidth: 380, maxWidth: 440)
          Divider()
          Group {
            if let selection {
              ProductDetailView(context: context, productID: selection, titled: false).id(selection)
            } else {
              AglynEmptyState("Pick a product", systemImage: "shippingbox")
            }
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
      } else {
        list(selectable: false)
      }
    }
    .navigationTitle("Products")
    .searchable(text: $searchText, prompt: "Product name")
    .onSubmit(of: .search) { model.search = searchText }
    .onChange(of: searchText) { _, text in if text.isEmpty { model.search = "" } }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button {
          creating = .creating()
        } label: {
          Label("New product", systemImage: "plus")
        }
        .accessibilityIdentifier("new-product")
        .help("Add a product to this site")
      }
      ToolbarItem(placement: .primaryAction) {
        Button {
          context.navigate(commerceScanScreen)
        } label: {
          Label("Scan", systemImage: "barcode.viewfinder")
        }
        .help("Find a product by its barcode or SKU")
      }
      if canImportProducts(context) {
        ToolbarItem(placement: .secondaryAction) {
          // The console's Import beside Add product: the data transfer hub's import, for this site's products.
          Button {
            context.navigate(coreDataImportScreen, productsImportParams(hostID: context.hostID))
          } label: {
            Label("Import", systemImage: "square.and.arrow.down")
          }
          .accessibilityIdentifier("import-products")
          .help("Import products from a CSV or spreadsheet file")
        }
      }
    }
    .task(id: context.hostID) { model.start(context.firestore, hostID: context.hostID) }
    .onAppear { if startNew, creating == nil, created == nil { creating = .creating() } }
    .onDisappear { model.stop() }
    .sheet(item: $creating) { editor in
      ProductEditorSheet(context: context, model: editor) { id in
        created = id
        selection = id
      }
    }
  }

  private var chips: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: AglynSpace.one) {
        AglynChoiceChip("All", selected: model.status == nil) { model.status = nil }
        ForEach(ContractValues.shared.productListOptions["status"] ?? [], id: \.value) { option in
          AglynChoiceChip(option.label, selected: model.status == option.value) { model.status = option.value }
        }
      }
      .padding(.horizontal, AglynSpace.two)
      .padding(.vertical, AglynSpace.one)
    }
  }

  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      chips
      if created != nil {
        AglynNotice("Product added.", tone: .success) { created = nil }
          .padding(.horizontal, AglynSpace.two)
      }
      content(selectable: selectable)
    }
    .background(AglynColor.page)
  }

  @ViewBuilder
  private func content(selectable: Bool) -> some View {
    if !model.ready {
      List { SkeletonRows(count: 6) }.aglynListBackground()
    } else if model.failed {
      AglynEmptyState("Could not load products", systemImage: "exclamationmark.triangle") {
        Button("Try again") { model.start(context.firestore, hostID: context.hostID) }
      }
    } else if model.rows.isEmpty {
      AglynEmptyState(
        model.status == nil && model.search.isEmpty ? "No products yet" : "No matching products",
        systemImage: "shippingbox",
        message: model.status == nil && model.search.isEmpty
          ? "Products you sell on this site show up here." : "Try another status or search.")
    } else if selectable {
      List(selection: $selection) { rows(selectable: true) }
        .onChange(of: model.rows, initial: true) { _, rows in
          if selection == nil || !rows.contains(where: { $0.id == selection }) { selection = rows.first?.id }
        }
        .sensoryFeedback(.selection, trigger: selection)
        .aglynListBackground()
        .accessibilityIdentifier("products-list")
    } else {
      List { rows(selectable: false) }
        .aglynListBackground()
        .accessibilityIdentifier("products-list")
    }
  }

  @ViewBuilder
  private func rows(selectable: Bool) -> some View {
    ForEach(model.rows) { row in
      Group {
        if selectable {
          ProductListRow(row: row).tag(row.id)
        } else {
          NavigationLink {
            ProductDetailView(context: context, productID: row.id, titled: true)
          } label: {
            ProductListRow(row: row)
          }
        }
      }
      .aglynListRow()
      .accessibilityIdentifier("product-\(row.id)")
    }
    if model.hasMore {
      Button("Show more products") { model.loadMore() }.frame(maxWidth: .infinity)
    }
  }
}

func productStockText(_ stock: Int?) -> String? {
  guard let stock else { return nil }
  return stock <= 0 ? "Sold out" : "\(stock) in stock"
}

struct ProductListRow: View {
  let row: ProductRow

  var body: some View {
    AglynRow(
      row.name,
      subtitle: [row.price, productStockText(row.stock)].compactMap { $0 }.joined(separator: " · "),
      systemImage: "shippingbox"
    ) {
      if row.status != "active" { StatusChip(row.statusLabel) }
      if let stock = row.stock, stock <= 0 { StatusChip("Sold out", tone: .warning) }
    }
  }
}

/// The product screen on its own (a link, a scan, a phone's stack).
struct ProductScreen: View {
  let context: NativePluginContext
  let productID: String

  var body: some View { ProductDetailView(context: context, productID: productID, titled: true) }
}

struct ProductDetailView: View {
  let context: NativePluginContext
  let productID: String
  var titled = true
  @State private var model = ProductModel()
  @State private var editing: ProductEditorModel?
  @State private var adjusting = false
  @State private var labels: [ProductLabelRow]?

  var body: some View {
    Group {
      if !model.ready {
        List { SkeletonRows(count: 4) }.aglynListBackground()
      } else if model.failed {
        AglynEmptyState("Could not load this product", systemImage: "exclamationmark.triangle")
      } else if let row = model.row {
        form(row)
      } else {
        AglynEmptyState("This product is not here", systemImage: "shippingbox", message: "It may have been deleted.")
      }
    }
    .navigationTitle(titled ? (model.row?.name ?? "Product") : "Products")
    .toolbar {
      if let doc = model.doc, let row = model.row {
        ToolbarItem(placement: .secondaryAction) {
          Button {
            editing = .editing(doc)
          } label: {
            Label("Edit", systemImage: "pencil")
          }
          .accessibilityIdentifier("edit-product")
        }
        ToolbarItem(placement: .secondaryAction) {
          // The address, supplier, tags, categories, tax, billing and search listing: a spec screen on the shared renderer.
          Button {
            context.navigate("commerce.productDetails", ["productId": productID])
          } label: {
            Label("Details", systemImage: "slider.horizontal.3")
          }
          .accessibilityIdentifier("product-details")
        }
        ToolbarItem(placement: .secondaryAction) {
          // The pictures, and a digital product's downloads and members videos.
          Button {
            context.navigate(commerceProductMediaScreen, ["productId": productID])
          } label: {
            Label("Images and files", systemImage: "photo.on.rectangle")
          }
          .accessibilityIdentifier("product-media")
        }
        ToolbarItem(placement: .secondaryAction) {
          Button {
            adjusting = true
          } label: {
            Label("Adjust stock", systemImage: "plusminus")
          }
          .disabled(row.item.variants.isEmpty)
          .accessibilityIdentifier("adjust-stock")
        }
        if row.type == "physical" {
          ToolbarItem(placement: .secondaryAction) {
            // Shelf labels with a barcode the register scans back (the console's Labels).
            Button {
              labels = productLabelRows(JSONValue.from(doc.data))
            } label: {
              Label("Labels", systemImage: "barcode")
            }
            .accessibilityIdentifier("product-labels")
          }
        }
      }
    }
    .sheet(item: $editing) { editor in ProductEditorSheet(context: context, model: editor) }
    .sheet(isPresented: Binding(get: { labels != nil }, set: { if !$0 { labels = nil } })) {
      ProductLabelsSheet(productName: model.row?.name ?? "Product", rows: labels ?? [])
    }
    .sheet(isPresented: $adjusting) {
      if let row = model.row { StockAdjustSheet(context: context, row: row) }
    }
    .task(id: "\(context.hostID ?? ""):\(productID)") {
      model.start(context.firestore, hostID: context.hostID, productID: productID)
    }
    .onDisappear { model.stop() }
  }

  private func form(_ row: ProductRow) -> some View {
    Form {
      Section {
        if let image = row.item.imageURL.flatMap(URL.init(string:)) {
          AsyncImage(url: image) { phase in
            if let picture = phase.image {
              picture.resizable().scaledToFill()
            } else {
              AglynColor.paper
            }
          }
          .frame(maxWidth: .infinity, minHeight: 180, maxHeight: 240)
          .clipShape(RoundedRectangle(cornerRadius: CGFloat(AglynTokens.radius), style: .continuous))
          .listRowInsets(EdgeInsets())
          .accessibilityHidden(true)
        }
        LabeledContent("Price", value: row.price)
        LabeledContent("Status") { StatusChip(row.statusLabel, tone: row.status == "active" ? .success : .neutral) }
        if let type = row.typeLabel { LabeledContent("Type", value: type) }
        if let stock = productStockText(row.stock) { LabeledContent("Stock", value: stock) }
      }
      if let description = row.description {
        Section("Description") { Text(description).font(AglynFont.body) }
      }
      if row.item.variants.count > 1 || row.item.variants.first?.sku != nil {
        Section("Variants") {
          ForEach(row.item.variants) { variant in
            AglynRow(
              variant.label ?? row.name,
              subtitle: [variant.sku.map { "SKU \($0)" }, variant.barcode, productStockText(variant.inventory)]
                .compactMap { $0 }.joined(separator: " · ")
            ) {
              Text(variant.unitCents.map { formatOrderMoney($0) } ?? "No price").monospacedDigit()
            }
          }
        }
      }
      if !row.item.modifierGroups.isEmpty {
        Section("Options") {
          ForEach(row.item.modifierGroups, id: \.id) { group in
            LabeledContent(group.name, value: group.options.map(\.name).joined(separator: ", "))
          }
        }
      }
    }
    .formStyle(.grouped)
    .aglynListBackground()
  }
}

/// The data transfer hub's import screen (core), which the products list's Import opens.
let coreDataImportScreen = "core.settings.data.import"

/// The import screen's parameters for this site's products, as the console's Import names its target.
func productsImportParams(hostID: String?) -> NativeParams {
  var params: NativeParams = ["resource": "commerce.products", "title": "Import products"]
  if let hostID { params["hostId"] = hostID }
  return params
}

/// Who may import: the import screen's own gate (a workspace owner or admin, or staff), as the console offers Import
/// only to whom the transfer route takes it from.
func canImportProducts(_ context: NativePluginContext) -> Bool {
  context.hostID != nil && (context.orgRole == "owner" || context.orgRole == "admin" || context.staff != nil)
}
