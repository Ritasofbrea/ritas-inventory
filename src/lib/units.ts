// Patch 43: plain-English singular/plural for hand-typed unit strings.
// Units are free text (Manage Items/Count's Add Item modal), so this is a
// dictionary of every plural form actually seen in the real catalog
// (checked live 2026-11-08: bags, bottles, boxes, cans, cases, containers,
// gallons, half gallons, lbs, lots, packs, rolls, sleeves) rather than a
// general depluralizing algorithm — a generic "strip trailing s/es" rule
// mangles words like "cases" -> "cas". Anything not recognized is left
// exactly as typed, in both directions, per the "never guess" rule.
const PLURAL_TO_SINGULAR: Record<string, string> = {
  bags: 'bag',
  bottles: 'bottle',
  boxes: 'box',
  cans: 'can',
  cases: 'case',
  containers: 'container',
  gallons: 'gallon',
  'half gallons': 'half gallon',
  lbs: 'lb',
  lots: 'lot',
  packs: 'pack',
  rolls: 'roll',
  sleeves: 'sleeve',
}

// Catalog units occasionally get typed already-singular (e.g. "Bottle"),
// so the reverse map doubles as the "is this word already singular" check
// used when pluralizing for a count other than 1.
const SINGULAR_WORDS = new Set(Object.values(PLURAL_TO_SINGULAR))

// Reuses the plural word's own casing style on the singular (or vice
// versa) instead of the literal replacement's casing, so "Gallons" ->
// "Gallon" and "boxes" -> "box" both read naturally.
function matchCase(template: string, word: string): string {
  if (!template) return word
  const isTitleCase = template[0] === template[0].toUpperCase() && template.slice(1) === template.slice(1).toLowerCase()
  if (isTitleCase) return word[0].toUpperCase() + word.slice(1)
  return word
}

// The one shared place that decides singular vs. plural for a typed unit
// string given a quantity -- used everywhere a count and its unit are
// shown together (Current Stock, Count, Order List, Dashboard, History,
// Par Settings, Manage Items, Correct Count). Never touches stored data,
// display only.
export function unitLabel(unit: string | null | undefined, count: number): string {
  const trimmed = (unit ?? '').trim()
  if (!trimmed) return trimmed
  const lower = trimmed.toLowerCase()

  if (count === 1) {
    const singular = PLURAL_TO_SINGULAR[lower]
    return singular ? matchCase(trimmed, singular) : trimmed
  }

  if (PLURAL_TO_SINGULAR[lower]) return trimmed // already stored plural
  if (SINGULAR_WORDS.has(lower)) return matchCase(trimmed, `${trimmed.toLowerCase()}s`)
  return trimmed // unrecognized -- never guess
}

// Plain-words version of "Units per {sub-unit}" for the sub-unit count
// setup field (Count's Add Item modal, Manage Items' edit form): "how many
// sub-units make up one main unit" (see getMainUnitTotal in types.ts),
// phrased as "{Sub-units} in one {main unit}" using the exact names typed,
// e.g. mainUnit="boxes", secondaryUnit="bottle" -> "Bottles in one box".
export function subUnitSetupLabel(mainUnit: string, secondaryUnit: string): string {
  const main = (mainUnit ?? '').trim()
  const sub = (secondaryUnit ?? '').trim()
  const hasLetters = (s: string) => /[a-zA-Z]/.test(s)

  if (!sub || !hasLetters(sub)) {
    return `How many in one ${main && hasLetters(main) ? unitLabel(main, 1) : 'main unit'}?`
  }
  const mainSingular = main && hasLetters(main) ? unitLabel(main, 1) : 'main unit'
  const subPlural = unitLabel(sub, 2)
  const subCapitalized = subPlural[0].toUpperCase() + subPlural.slice(1)
  return `${subCapitalized} in one ${mainSingular}`
}

// Live preview line under the sub-unit setup field, e.g. "1 box = 2
// bottles". null when there's nothing sensible to preview yet (no sub-unit
// name, or no valid positive count typed).
export function subUnitPreview(mainUnit: string, secondaryUnit: string, perMainUnit: number | null): string | null {
  const main = (mainUnit ?? '').trim()
  const sub = (secondaryUnit ?? '').trim()
  if (!sub || !/[a-zA-Z]/.test(sub) || !perMainUnit || !Number.isFinite(perMainUnit) || perMainUnit <= 0) return null
  const mainSingular = main ? unitLabel(main, 1) : 'main unit'
  return `1 ${mainSingular} = ${perMainUnit} ${unitLabel(sub, perMainUnit)}`
}
