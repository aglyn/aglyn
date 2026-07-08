---
sidebar_position: 3
title: Relations
description: Link records together with reference fields, including many-to-many.
---

# Relations

Real data is connected — posts have authors, products have categories. **Relations** let a
record **reference** other records.

:::info Plan availability
**Pro**.
:::

## Reference fields

Add a **reference** field to a model to point at records in another dataset (or the same
one). For example, a `post` can reference its `author`.

## Many-to-many

Relations support **many-to-many**, so a record can link to several others and vice versa —
a `product` in many `categories`, each `category` holding many `products`.

## Using relations

The [dataset query layer](overview.md#query-layer) resolves related records for both the
editor and screen bindings, so you can render a record together with the things it links to.

## Tips

- Point references at a stable model — renaming fields is safe, but restructuring a related
  model affects everything that references it.

## Related

- [Build a data model](model-builder.md)
- [Import & export](import-export.md)
