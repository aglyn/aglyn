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
  @State private var quota = ProductQuotaModel()

  var body: some View {
    WideLayoutReader { wide in
      if wide {
        AglynListDetailColumns(listWidth: 380) {
          list(selectable: true)
        } detail: {
          if let selection {
            ProductDetailView(context: context, productID: selection, titled: false).id(selection)
          } else {
            AglynSelectionPlaceholder("No product selected", systemImage: "shippingbox")
          }
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
        .buttonStyle(.borderedProminent)
        .disabled(!quota.hasRoom)
        .accessibilityIdentifier("new-product")
        .help(quota.hasRoom ? "Add a product to this site" : "Your plan includes \(Int(quota.limit ?? 0)) products — upgrade for more")
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
    .task(id: context.hostID) {
      model.start(context.firestore, hostID: context.hostID)
      await quota.load(context)
    }
    .onChange(of: model.rows.count) { Task { await quota.recount(context) } }
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
        ListSortMenu(sorts: ContractValues.shared.productListQuery.sorts, selected: model.sort) { model.sort = $0 }
      }
      .padding(.horizontal, AglynSpace.two)
      .padding(.vertical, AglynSpace.one)
    }
  }

  /// Any filter the console's grid takes: name, status, type, slug, SKU, barcode.
  private var filters: some View {
    ClauseFilterBar(
      fields: ContractValues.shared.productListQuery.fields, headers: ContractValues.shared.productListHeaders,
      choices: filterChoices(ContractValues.shared.productListOptions), clauses: model.clauses,
      refused: model.plan.map { filterRefusals($0, clauses: model.clauses) } ?? [], notices: model.plan?.notices ?? []
    ) { model.clauses = $0 }
    .padding(.horizontal, AglynSpace.two)
  }

  private func list(selectable: Bool) -> some View {
    VStack(spacing: 0) {
      chips
      filters
      ProductsZone(context: context, slot: commerceProductsCreateSlot)
      ProductsZone(context: context, slot: commerceProductsHubSlot)
      if created != nil {
        AglynNotice("Product added.", tone: .success) { created = nil }
          .padding(.horizontal, AglynSpace.two)
      }
      // Products listed before they have a price (AGL-3676): the one step left before the store sells them.
      if let notice = comingSoonNotice(model.rows.filter { $0.status == "active" && $0.priceMissing }.map(\.name)) {
        AglynNotice(notice, tone: .info).padding(.horizontal, AglynSpace.two)
      }
      content(selectable: selectable)
      // The cap, standing rather than only on refusal (AGL-2113).
      AglynQuotaReadout(ready: quota.ready, used: quota.used, limit: quota.limit, noun: "product")
        .padding(.horizontal, AglynSpace.two)
        .padding(.vertical, AglynSpace.one)
        .frame(maxWidth: .infinity, alignment: .leading)
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
      ScrollViewReader { proxy in
        List { rows(selectable: true) }
          .onChange(of: model.rows, initial: true) { _, rows in
            // A product just added keeps the pick while its row is on its way from the listener.
            if let created, selection == created {
              if rows.contains(where: { $0.id == created }) { withAnimation { proxy.scrollTo(created, anchor: .center) } }
              return
            }
            if selection == nil || !rows.contains(where: { $0.id == selection }) { selection = rows.first?.id }
          }
          .sensoryFeedback(.selection, trigger: selection)
          .aglynSelectableListStyle().aglynSelectionKeys(model.rows.map(\.id), selection: $selection)
          .accessibilityIdentifier("products-list")
      }
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
          ProductListRow(row: row).aglynSelectableRow(row.id, selection: $selection)
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
  @State private var keys = false
  @State private var deleting = false
  @State private var working = false
  @State private var notice: (text: String, tone: AglynTone)?
  @Environment(\.dismiss) private var dismiss

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
    #if os(iOS)
      // The header below already shows the name large.
      .navigationBarTitleDisplayMode(.inline)
    #endif
    .toolbar {
      if let doc = model.doc, let row = model.row {
        // HIG toolbars: the two actions used most stay visible, every other one is in one labeled More menu.
        ToolbarItemGroup(placement: .secondaryAction) {
          Button {
            editing = .editing(doc)
          } label: {
            Label("Edit", systemImage: "pencil")
          }
          .help("Edit this product's name, price and stock")
          .accessibilityIdentifier("edit-product")
          Button {
            // The pictures, and a digital product's downloads and members videos.
            context.navigate(commerceProductMediaScreen, ["productId": productID])
          } label: {
            Label("Images and files", systemImage: "photo.on.rectangle")
          }
          .help("This product's pictures and files")
          .accessibilityIdentifier("product-media")
        }
        ToolbarItem(placement: .secondaryAction) {
          AglynMoreMenu {
            // The address, supplier, tags, categories, tax, billing and search listing: a spec screen on the shared renderer.
            Button {
              context.navigate("commerce.productDetails", ["productId": productID])
            } label: {
              Label("Details", systemImage: "slider.horizontal.3")
            }
            .accessibilityIdentifier("product-details")
            Button {
              adjusting = true
            } label: {
              Label("Adjust stock", systemImage: "plusminus")
            }
            .disabled(row.item.variants.isEmpty)
            .accessibilityIdentifier("adjust-stock")
            if row.type == "physical" {
              // Shelf labels with a barcode the register scans back (the console's Labels).
              Button {
                labels = productLabelRows(JSONValue.from(doc.data))
              } label: {
                Label("Labels", systemImage: "barcode")
              }
              .accessibilityIdentifier("product-labels")
            }
            if row.type == "digital" {
              Button {
                keys = true
              } label: {
                Label("Keys", systemImage: "key")
              }
              .accessibilityIdentifier("product-keys")
            }
            Divider()
            Button {
              Task { await duplicate() }
            } label: {
              Label("Duplicate", systemImage: "plus.square.on.square")
            }
            .disabled(working)
            .accessibilityIdentifier("product-duplicate")
            Button {
              Task { await setStatus(doc, row, row.status == "archived" ? "active" : "archived") }
            } label: {
              Label(row.status == "archived" ? "Activate" : "Archive", systemImage: row.status == "archived" ? "tray.and.arrow.up" : "archivebox")
            }
            .disabled(working)
            .accessibilityIdentifier("product-archive")
            Divider()
            Button(role: .destructive) {
              deleting = true
            } label: {
              Label("Delete", systemImage: "trash")
            }
            .disabled(working)
            .accessibilityIdentifier("product-delete")
          }
        }
      }
    }
    .sheet(item: $editing) { editor in ProductEditorSheet(context: context, model: editor) }
    .sheet(isPresented: Binding(get: { labels != nil }, set: { if !$0 { labels = nil } })) {
      ProductLabelsSheet(productName: model.row?.name ?? "Product", rows: labels ?? [])
    }
    .sheet(isPresented: $keys) {
      ProductKeysSheet(context: context, productID: productID, productName: model.row?.name ?? "Product")
    }
    .confirmationDialog("Delete this product?", isPresented: $deleting, titleVisibility: .visible) {
      Button("Delete", role: .destructive) { Task { await delete() } }
    } message: {
      Text("\"\(model.row?.name ?? "This product")\" stops being purchasable; blocks referencing it show a checkout error until repointed.")
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
      if let notice { AglynNotice(notice.text, tone: notice.tone) { self.notice = nil } }
      Section {
        AglynDetailHeader(
          row.name, subtitle: row.price, imageURL: row.item.imageURL.flatMap(URL.init(string:)), systemImage: "shippingbox",
          status: (row.statusLabel, row.status == "active" ? .success : .neutral))
      }
      Section("Pricing and stock") {
        LabeledContent("Price", value: row.price)
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

extension ProductDetailView {
  fileprivate func duplicate() async {
    guard let hostID = context.hostID else { return }
    working = true
    defer { working = false }
    do {
      let id = try await duplicateProduct(api: context.api, hostID: hostID, productID: productID, newProductID: createResourceUID(length: 20))
      notice = ("Product duplicated as draft", .success)
      context.navigate(commerceProductScreen, ["productId": id])
    } catch {
      notice = (productWriteProblem(error).errorDescription ?? "Could not duplicate product", .warning)
    }
  }

  fileprivate func setStatus(_ doc: FirestoreDocument, _ row: ProductRow, _ status: String) async {
    guard let hostID = context.hostID else { return }
    working = true
    defer { working = false }
    do {
      try await ConsoleProductWriteAPI(api: context.api).save(
        hostID: hostID, productID: productID, create: false, product: productStatusSaveJSON(doc.data, status: status),
        attemptKey: UUID().uuidString)
      // A product with a variant nobody has priced may go live (AGL-3676): the owner is told, not stopped.
      notice = status == "active" && row.priceMissing ? (activatingUnpricedNotice(row.name), .info) : nil
    } catch {
      notice = (productWriteProblem(error).errorDescription ?? "The product could not be saved", .error)
    }
  }

  fileprivate func delete() async {
    guard let hostID = context.hostID else { return }
    working = true
    defer { working = false }
    do {
      try await deleteProduct(api: context.api, hostID: hostID, productID: productID)
      // Pushed on a phone, the product is gone, so its screen goes too and the list (which drops the row) is back;
      // beside the list, the list picks the next product.
      if titled { dismiss() } else { notice = ("Product deleted", .success) }
    } catch {
      notice = (productWriteProblem(error).errorDescription ?? "Could not delete product", .error)
    }
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
