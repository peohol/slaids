/**
 * The signed-in user's autoerstatt rules, as the editors read them while typing.
 *
 * One copy in memory, loaded from the repository when a workspace opens and
 * written back whole when the dialog saves. Every field that substitutes —
 * the Tiptap fields through `TypographyExtension`, the plain inputs through
 * `useTypedSubstitution` — asks `currentAutocorrectRules()` at the keystroke,
 * so a saved change takes effect in fields that are already open.
 *
 * Until the stored list has arrived nothing is substituted. Guessing with the
 * defaults would rewrite text for a user who removed exactly those rules.
 */

import { create } from 'zustand'
import {
  normalizeAutocorrectRules,
  sameAutocorrectRules,
  type AutocorrectRule,
} from '../domain/autocorrect'
import { repository } from '../persistence/activeRepository'

interface AutocorrectStore {
  rules: AutocorrectRule[]
  loaded: boolean
}

export const useAutocorrect = create<AutocorrectStore>(() => ({ rules: [], loaded: false }))

/** Which load is the latest, so an answer for a user who has left is dropped. */
let generation = 0

export function currentAutocorrectRules(): readonly AutocorrectRule[] {
  return useAutocorrect.getState().rules
}

/** Read the stored list. A failure leaves nothing substituted rather than a guess. */
export async function loadAutocorrect(): Promise<void> {
  const mine = ++generation
  try {
    const rules = await repository.loadAutocorrectRules()
    if (mine === generation) useAutocorrect.setState({ rules, loaded: true })
  } catch {
    // Typing still works without substitutions; the next workspace tries again.
  }
}

/**
 * Store a new list. Answers whether anything changed; throws when the store
 * refused it, leaving the list in memory as it was.
 */
export async function saveAutocorrect(raw: readonly AutocorrectRule[]): Promise<boolean> {
  // The list is written whole, so one edited from anything but the stored
  // list would silently replace rules the user never saw.
  if (!useAutocorrect.getState().loaded) {
    throw new Error('Autoerstatt-reglene er ikke hentet ennå. Prøv igjen om et øyeblikk.')
  }
  const rules = normalizeAutocorrectRules(raw)
  if (sameAutocorrectRules(rules, currentAutocorrectRules())) return false
  await repository.saveAutocorrectRules(rules)
  generation += 1
  useAutocorrect.setState({ rules, loaded: true })
  return true
}

/** Forget the list, when the user it belonged to leaves. */
export function resetAutocorrect(): void {
  generation += 1
  useAutocorrect.setState({ rules: [], loaded: false })
}
