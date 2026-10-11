/**
 * Validates only the shape of an effective credential. It never normalizes or
 * serializes the value, because silently changing a credential can mask a
 * configuration problem.
 */
export function inspectCredentialShape(value) {
  const exists = typeof value === 'string';
  const nonempty = exists && value.length > 0;
  const hasSurroundingWhitespace = nonempty && value !== value.trim();
  const hasSurroundingQuotes = nonempty
    && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
  return {
    exists,
    nonempty,
    hasSurroundingWhitespace,
    hasSurroundingQuotes,
    usable: nonempty && !hasSurroundingWhitespace && !hasSurroundingQuotes,
  };
}
