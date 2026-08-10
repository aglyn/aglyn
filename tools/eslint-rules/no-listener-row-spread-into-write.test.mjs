/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Standalone RuleTester harness (run: `node tools/eslint-rules/*.test.mjs`).
// Wired into CI via the `test:eslint-rules` npm script.
//
// The four invalid cases are the four writes AGL-1374 found, reduced to the
// shape that made each one an instance and checked against the pre-fix
// revision (`git show 86270af4a^:<path>`). The valid cases are the categories
// that sweep cleared, and they are the point: it looked at 149 write sites, 35
// of them spread-bearing, and only these four were real. A rule that fired on
// the other 31 would be switched off within a week.

import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import rule from './no-listener-row-spread-into-write.mjs'

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
})

const err = [{ messageId: 'listenerRowSpread' }]

/** The listener every card in these fixtures is seeded from. */
const LISTENER = `
  const { data: rows } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'discounts')),
    [firestore, hostId],
    { idField: '$id' },
  )
`

ruleTester.run('no-listener-row-spread-into-write', rule, {
  valid: [
    // ---- The near-miss. `suppliers-card` spreads `...data` into a write with
    // no options argument at all and never strips `$id` — it looks exactly
    // like `discounts-card` at the write. It is NOT an instance, because the
    // draft is assembled key by key, so there is no `$id` in it to write. The
    // rule separates them on the seed, which is the only place they differ.
    `
    function SuppliersCard({ hostId }: { hostId: string }) {
      const firestore = useFirestore()
      ${LISTENER}
      const [draft, setDraft] = useState<any>(null)
      const save = async () => {
        const { id, ...data } = draft
        await setDoc(doc(firestore, 'hosts', hostId, 'suppliers', id), { ...data })
      }
      return rows.map((supplier: any) => (
        <button
          key={supplier.$id}
          onClick={() =>
            setDraft({
              id: supplier.$id,
              name: supplier.name ?? '',
              webhookSecret: supplier.webhookSecret ?? '',
            })
          }
        />
      ))
    }
    `,

    // ---- The strip. What `host-overlays-card` and `host-experiments-card`
    // already did, and what the other three instances were fixed to.
    `
    function OverlaysCard({ hostId }: { hostId: string }) {
      const firestore = useFirestore()
      ${LISTENER}
      const [editor, setEditor] = useState<any>(null)
      const save = async () => {
        const id = editor.$id ?? createResourceUid()
        const { $id: _ignored, ...payload } = editor
        await setDoc(doc(firestore, 'hosts', hostId, 'overlays', id), { ...payload })
      }
      return rows.map((overlay: any) => (
        <button key={overlay.$id} onClick={() => setEditor({ ...overlay })} />
      ))
    }
    `,
    // The strip survives a JSON round-trip, which is how `host-overlays-card`
    // drops the undefined values Firestore rejects.
    `
    function Card({ hostId }: { hostId: string }) {
      const firestore = useFirestore()
      ${LISTENER}
      const save = async (overlay: any) => {
        const { $id: _ignored, ...payload } = overlay
        const cleaned = JSON.parse(JSON.stringify({ ...payload, updatedAt: 1 }))
        await setDoc(doc(firestore, 'hosts', hostId, 'overlays', overlay.$id), cleaned)
      }
      return save
    }
    `,
    // An explicit strip helper says the same thing in one expression.
    `
    function Card({ hostId }: { hostId: string }) {
      const firestore = useFirestore()
      ${LISTENER}
      const save = async (row: any) => {
        await setDoc(doc(firestore, 'hosts', hostId, 'x', row.$id), { ...omit(row, '$id') })
      }
      return save
    }
    `,

    // ---- An explicit payload. `bookings`, `host-variables` and `redirects`
    // name every field, and the narrow merge the catalog reparent was fixed to
    // is the same shape.
    `
    function Card({ hostId }: { hostId: string }) {
      const firestore = useFirestore()
      ${LISTENER}
      const reparent = async (child: any) => {
        await setDoc(
          doc(firestore, 'hosts', hostId, 'productCategories', child.$id),
          { parentId: null },
          { merge: true },
        )
      }
      return reparent
    }
    `,
    // `updateDoc(ref, 'field', value)` is not an object payload at all.
    "updateDoc(ref, 'displayName', name)",

    // ---- Conditional spreads. About fifteen sites, all of them fine: an
    // object literal cannot carry a key nobody named.
    `
    function Card({ hostId }: { hostId: string }) {
      const firestore = useFirestore()
      ${LISTENER}
      const save = async (code: string, enabled: boolean) => {
        await setDoc(
          doc(firestore, 'hosts', hostId, 'discounts', 'x'),
          { code, ...(enabled ? { enabled: true } : {}), ...(code ? { code } : { code: null }) },
          { merge: true },
        )
      }
      return save
    }
    `,

    // ---- A listener with no `idField` stamps nothing, so its rows carry no
    // synthetic key and spreading one is not this bug.
    `
    function Card({ hostId }: { hostId: string }) {
      const firestore = useFirestore()
      const { data: rows } = useFirestoreCollection<any>(
        () => query(collection(firestore, 'hosts', hostId, 'plain')),
        [firestore, hostId],
      )
      const save = async () => {
        await setDoc(doc(firestore, 'hosts', hostId, 'plain', 'x'), { ...rows[0] })
      }
      return save
    }
    `,

    // ---- `besigner-versions` spreads `...parentPath` FIVE times, and every
    // one is a path segment list in `doc(firestore, …)` — an argument list,
    // not a payload. A rule keying off `...` alone reports all five.
    `
    function Versions({ hostId, parentCollection, parent }: any) {
      const firestore = useFirestore()
      const parentPath = ['hosts', hostId, parentCollection, parent.id] as const
      const publish = async (versionId: string) => {
        await updateDoc(doc(firestore, ...parentPath), { versionId })
        await deleteDoc(doc(firestore, ...parentPath, 'versions', versionId))
      }
      return publish
    }
    `,

    // ---- A payload that names `$id` itself is the author controlling the
    // key. Besigner canvas nodes really do store theirs.
    `
    function Card({ hostId }: { hostId: string }) {
      const firestore = useFirestore()
      ${LISTENER}
      const save = async (row: any) => {
        await setDoc(doc(firestore, 'hosts', hostId, 'nodes', row.$id), { ...row, $id: row.$id })
      }
      return save
    }
    `,

    // ---- `row.$id` read as the document path is what the option is FOR.
    `
    function Card({ hostId }: { hostId: string }) {
      const firestore = useFirestore()
      ${LISTENER}
      const rename = async (row: any, name: string) => {
        await updateDoc(doc(firestore, 'hosts', hostId, 'discounts', row.$id), { name })
      }
      return rename
    }
    `,
  ],

  invalid: [
    // ---- `catalog-organization-card` (pre-fix `:339`): the delete's reparent.
    // The least visible of the four — no editor is open, so nothing on screen
    // looks wrong, and it fires once per child on every delete.
    {
      code: `
      function CatalogCard({ hostId }: { hostId: string }) {
        const firestore = useFirestore()
        const { data: categoryDocs } = useFirestoreCollection<any>(
          () => query(collection(firestore, 'hosts', hostId, 'productCategories')),
          [firestore, hostId],
          { idField: '$id' },
        )
        const remove = async (category: any) => {
          const children = (categoryDocs ?? []).filter(
            (row: any) => row.parentId === category.$id,
          )
          for (const child of children) {
            await setDoc(
              doc(firestore, 'hosts', hostId, 'productCategories', child.$id),
              { ...child, parentId: null },
            )
          }
        }
        return remove
      }
      `,
      errors: err,
    },

    // ---- `discounts-card` (pre-fix `:98`) and `reservations-card` (`:151`)
    // are the same shape: the editor is seeded `{ id: row.$id, ...row }`, and
    // the save destructures only `id`, so `$id` stays in `data`. Compare with
    // the `suppliers-card` valid case above — identical at the write.
    {
      code: `
      function DiscountsCard({ hostId }: { hostId: string }) {
        const firestore = useFirestore()
        ${LISTENER}
        const [draft, setDraft] = useState<any>(null)
        const save = async () => {
          const { id, ...data } = draft
          await setDoc(
            doc(firestore, 'hosts', hostId, 'discounts', id ?? createResourceUid()),
            { ...data, enabled: data.enabled !== false },
            { merge: true },
          )
        }
        return rows.map((discount: any) => (
          <button
            key={discount.$id}
            onClick={() => setDraft({ id: discount.$id, ...discount })}
          />
        ))
      }
      `,
      errors: err,
    },

    // ---- `product-editor-dialog` (pre-fix `:235`), the one that crossed a
    // file. The hub stamps `{...liftLegacyProduct(p), $id: p.$id}` onto the
    // prop, and only the PROP TYPE says so here; the write is `merge: false`,
    // so the key was stored on every product save.
    {
      code: `
      export interface ProductEditorDialogProps {
        hostId: string
        product: (CommerceModel.HostProduct & { $id: string }) | null
      }
      export function ProductEditorDialog(props: ProductEditorDialogProps) {
        const { hostId, product } = props
        const firestore = useFirestore()
        const lifted = useMemo(
          () => (product ? CommerceModel.liftLegacyProduct(product) : null),
          [product],
        )
        const [draft, setDraft] = useState<CommerceModel.HostProduct | null>(null)
        const current: CommerceModel.HostProduct = draft ?? lifted ?? { name: '' }
        const update = (patch: any) => setDraft({ ...current, ...patch })
        const save = async () => {
          const base = { ...current, name: current.name.trim() }
          await setDoc(
            doc(firestore, 'hosts', hostId, 'products', product!.$id),
            { ...base, updatedAt: Timestamp.now() },
            { merge: false },
          )
        }
        return [update, save]
      }
      `,
      errors: err,
    },

    // ---- `useSwitcherCollection` defaults `idField` to '$id', so it stamps
    // whether or not the call says so. No instance has shipped through it;
    // the rule covers it because the affordance is identical.
    {
      code: `
      function SwitcherCard({ hostId }: { hostId: string }) {
        const firestore = useFirestore()
        const { data: sites } = useSwitcherCollection<any>(
          () => query(collection(firestore, 'orgs', hostId, 'hosts')),
          [firestore, hostId],
        )
        const save = async () => {
          await addDoc(collection(firestore, 'orgs', hostId, 'hosts'), { ...sites[0] })
        }
        return save
      }
      `,
      errors: err,
    },
  ],
})

console.log('no-listener-row-spread-into-write: all RuleTester cases passed')
