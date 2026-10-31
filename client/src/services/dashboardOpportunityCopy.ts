// Keep real finding titles; replace only numbered placeholder labels.
export function opportunityTitle(title: string, explanation: string) {
  if (!/^(?:(?:saved|fixture|test|demo|profile)\s+)*(?:opportunity|finding|issue)\s*#?\d+$/i.test(title.trim())) return title
  if (/phone|contact number/i.test(explanation) && /different|inconsisten|mismatch/i.test(explanation)) return 'Contact information may be inconsistent'
  return explanation.trim() || 'Review this finding'
}
