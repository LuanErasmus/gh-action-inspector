import type { ParsedActionReference } from "./parse-reference.js";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function generateShaPinnedReference(
  reference: ParsedActionReference,
  resolvedSha: string,
): string {
  if (!SHA_PATTERN.test(resolvedSha)) {
    throw new Error("Resolved commit SHA must be a full 40-character hexadecimal SHA.");
  }

  const action = [
    reference.owner,
    reference.repository,
    ...(reference.path ? [reference.path] : []),
  ].join("/");

  if (SHA_PATTERN.test(reference.ref)) {
    if (reference.ref.toLowerCase() !== resolvedSha.toLowerCase()) {
      throw new Error("Resolved SHA does not match the SHA already pinned in the reference.");
    }
    return `${action}@${reference.ref}`;
  }

  return `${action}@${resolvedSha} # ${reference.ref}`;
}
