import { createId, deleteProperty, isNumber, removeFromArray, reorderArray } from './helpers'
import { AuthResult, Component, ElementModel, KeyValue, Variable, VariableType } from './types'


/**
 * Create empty data structure object for key value pairs
 * @returns {KeyValue}
 */
export function createKeyValueObject<T>(): KeyValue<T> {
  return {
    keys: [],
    byKey: {},
  }
}

/**
 * Removes an item from an existing key value data structure object
 * @param {string} key
 * @param {KeyValue<T>} data
 * @returns {KeyValue<T>}
 */
export function deleteItemFromKeyValueData<T>(key: string, data: KeyValue<T>): KeyValue<T> {
  data.keys = removeFromArray(key, data.keys)
  deleteProperty(data.byKey, key)
  return data
}

/**
 * Sets an item in an existing key value data structure object.
 * @param {[key: string, value: T]} item
 * @param {KeyValue<T>} data
 * @param {number} index
 * @returns {KeyValue<T>}
 */
export function setItemInKeyValueData<T>(
  item: [key: string, value: any],
  data: KeyValue<T>,
  index?: number,
): KeyValue<T> {
  const [key, value] = item
  const currentIndex = data.keys.indexOf(key)
  const isUpdate = currentIndex !== -1

  data.byKey[key] = value

  if (!isUpdate) {
    data.keys.push(key)
  } else if (isNumber(index) && currentIndex !== index) {
    reorderArray(data.keys, currentIndex, index)
  }

  return data
}

/**
 * Create a COMPONENT object
 * @param {Partial<Component>} fields
 * @returns {Component}
 */
export function createComponent(fields?: Partial<Component>): Component {
  return Object.assign({
    id: createId(),
  }, fields)
}

/**
 * Create a ELEMENT object
 * @param {Partial<ElementModel>} fields
 * @returns {ElementModel}
 */
export function createElement(fields?: Partial<ElementModel>): ElementModel {
  return Object.assign({
    id: createId(),
  }, fields)
}

/**
 * Create a VARIABLE object
 * @param {Partial<Variable>} fields
 * @returns {Variable}
 */
export function createVariable(fields?: Partial<Variable>): Variable {
  return Object.assign({
    id: createId(),
    type: VariableType.string,
  }, fields)
}

/**
 * Check if the relationship of the Elem comp is allowed within the parent Elem
 * @param {Component} comp The Elem Comp object
 * @param {Component} parentComp the Elem parent Comp object
 * @returns {boolean}
 */
export function isComponentRelationAllowed(comp: Component, parentComp: Component): boolean {
  const {id: childId, constrainParentComps} = comp
  const {id: parentId, constrainChildrenComps} = parentComp

  function checkConstraint(checkId, constraint) {
    let [type, uuids] = constraint

    // Elem does not allow any
    if (!uuids) {
      return false
    }

    // Check if the uuid is equal to or is listed in an array of Ids
    let isIdListed = Array.isArray(uuids)
      ? uuids.some(id => id === checkId)
      : checkId === uuids

    // Elem is not allowed
    if (type === AuthResult.Allow && !isIdListed) {
      return false
    }

    // Elem is denying
    else if (type === AuthResult.Deny && isIdListed) {
      return false
    }

    return true
  }

  // Will Elem reject parent?
  if (constrainParentComps && !checkConstraint(parentId, constrainParentComps)) {
    return false
  }

  // Will parent reject Elem?
  else if (constrainChildrenComps && !checkConstraint(childId, constrainParentComps)) {
    return false
  }

  return true
}

// /**
//  * Create a INSTANCE object
//  * @param {Partial<InstanceModel>} fields
//  * @returns {InstanceModel}
//  */
// export function createInstance(fields?: Partial<InstanceModel>): InstanceModel {
//   return Object.assign({
//     id: createId(),
//     metadata: createKeyValueData(),
//     elements: createKeyValueData(),
//     components: createKeyValueData(),
//     variables: createKeyValueData(),
//   }, fields)
// }
