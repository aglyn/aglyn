import { DK, lbl, Sig } from './constants'
import { AppControllerConfig } from './controllers/AppController'
import { CollectionRefController } from './controllers/CollectionRefController'
import { DocumentRefController } from './controllers/DocumentRefController'
import { FieldRefController } from './controllers/FieldRefController'
import { Ref } from './interfaces/dod'
import { Normalized } from './models/Normalized'
import { createUid } from './tools/uid'
import { copyJson, s } from './tools/utils'

/**
 * Blueprint field model document
 */
export const fieldModelId = [s(Sig.Field), s(Sig.Model)].join('_')
export const blueprintModelId = [s(Sig.Blueprint), s(Sig.Model)].join('_')
export const fieldModel: DocumentRefController = new DocumentRefController(
  fieldModelId,
  Normalized.from(
    new FieldRefController(Sig.Name, DK.TEXT).init(),
    new FieldRefController(Sig.Kind, DK.TEXT).init(),
    new FieldRefController(Sig.Created, DK.DATETIME).init(),
    new FieldRefController(Sig.Updated, DK.DATETIME).init(),
    new FieldRefController(Sig.Deleted, DK.DATETIME).init(),
  )
).init()

/**
 * Blueprint model document
 */
export const blueprintModel: DocumentRefController = new DocumentRefController(
  blueprintModelId,
  Normalized.from(
    new FieldRefController(Sig.Name, DK.TEXT).init(),
    new FieldRefController(Sig.Kind, DK.TEXT, DK.BLUEPRINT).init(),
    new FieldRefController(
      fieldModelId,
      DK.DOCUMENT,
      fieldModel
    ).init(),
    new FieldRefController(Sig.Created, DK.DATETIME).init(),
    new FieldRefController(Sig.Updated, DK.DATETIME).init(),
    new FieldRefController(Sig.Deleted, DK.DATETIME).init(),
  ),
  Normalized.from(
    new CollectionRefController(s(Sig.Fields)).init(),
    new CollectionRefController(s(Sig.Entries)).init()
  )
).init()

export const createNewBlueprintDocument = (
  name: string,
  kind: string,
): DocumentRefController => {
  const copy = copyJson(blueprintModel)
  const blueprint = new DocumentRefController(
    createUid(),
    copy.fields,
    copy.subcollections
  ).init()
  console.log('blueprint document', blueprint, blueprint.getField(Sig.Name))
  blueprint.getField(Sig.Name).setValue(name)
  blueprint.getField(Sig.Kind).setValue(kind)
  blueprint.getField(Sig.Created).setValue(Date.now())
  return blueprint
}

export const createNewBlueprintFieldDocument = (blueprint: DocumentRefController) => {
  const modelField = blueprint.getField(fieldModelId)
  const copied = copyJson(modelField.getValue() as Ref.Document)
  const modelFieldVal = DocumentRefController.from(copied).init()

  return new DocumentRefController(
    createUid(),
    modelFieldVal.fields,
    modelFieldVal.subcollections
  ).init()
}

export const createNewBlueprintEntryDocument = (blueprint: DocumentRefController) => {
  console.log('before fieldsCollection', blueprint)
  const fieldsCollection = CollectionRefController.from(
    copyJson(
      <Ref.Collection>blueprint.getSubcollection(Sig.Fields)
    )
  ).init()
  console.log('after fieldsCollection', fieldsCollection)
  const entryFields = new Normalized()

  fieldsCollection.getAllDocuments().forEach(document => {
    const _document = DocumentRefController.from(document).init()
    entryFields.set(
      _document.id,
      new FieldRefController(
        _document.id,
        _document.getField(Sig.Kind).getValue() as string,
        _document.getField(Sig.Value).getValue(),
      )
    )
  })

  return new DocumentRefController(
    createUid(),
    entryFields
  ).init()
}

// const sampleBlueprint = createNewBlueprintEntryDocument(blueprintModel)
// sampleBlueprint.setField(Sig.Name, 'Blueprint (sample)')
// sampleBlueprint.setField(Sig.Kind, DK.BLUEPRINT)
const sampleBlueprint = createNewBlueprintDocument(
  'Blueprint (sample)', DK.BLUEPRINT
)

const sampleEntry = createNewBlueprintEntryDocument(sampleBlueprint)
sampleEntry.setField(s(Sig.Name), 'Blueprint entry (sample)')
sampleEntry.setField(s(Sig.Kind), DK.ENTRY)
sampleBlueprint
  .getSubcollection(Sig.Entries)
  .setDocument(sampleEntry.id, sampleEntry)

/**
 * Blueprints collection document
 */
const blueprints = new DocumentRefController(
  'blueprints',
  Normalized.from(
    new FieldRefController('name', DK.TEXT, lbl[Sig.Blueprint]).init(),
    new FieldRefController('kind', DK.TEXT, DK.COLLECTION).init(),
    new FieldRefController(blueprintModelId, DK.DOCUMENT, blueprintModel).init(),
  ),
  Normalized.from(
    new CollectionRefController('blueprints').init()
  ),
).init()

blueprints
  .getSubcollection('blueprints')
  .setDocument(sampleBlueprint.id, sampleBlueprint)


// /**
//  * App config data structure
//  */
// const structure = new Document(
//   'structure_collection',
//   Normalized.from(...[
//     new Field(Sig.Name, DK.TEXT, 'Data Structure'),
//     new Field(Sig.Kind, DK.TEXT, DK.COLLECTION)
//   ]),
//   Normalized.from(...[
//     new Collection(
//       Sig.Documents,
//       Normalized.from(blueprints)
//     ).init()
//   ])
// ).init()

/**
 * The default application configuration object, can be
 * merged with a custom config to set overrides
 */
export const defaultAppConfig: AppControllerConfig = {

  blueprints,
  collections: {}

}