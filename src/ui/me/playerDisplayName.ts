/** Source annotations are provenance, not a person's name. Display-only;
 * React still escapes the result. Do not alter the saved identity or birthday.
 */
export function playerDisplayName(value: string | null | undefined): string | null {
  const name = value?.replace(/<!--[\s\S]*?(?:-->|$)/g, '').trim()
  return name || null
}
