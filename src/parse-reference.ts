export interface ParsedActionReference {
  owner: string;
  repository: string;
  path?: string;
  ref: string;
}

export function parseActionReference(
  reference: string,
): ParsedActionReference {
  if (typeof reference !== "string" || reference.trim() === "") {
    throw new Error("Action reference must be a non-empty string.");
  }

  const input = reference.trim();
  const separator = input.indexOf("@");

  if (separator === -1) {
    throw new Error(
      "Action reference must include a ref after '@' (for example, actions/checkout@v4).",
    );
  }

  if (input.indexOf("@", separator + 1) !== -1) {
    throw new Error("Action reference must contain exactly one '@' separator.");
  }

  const name = input.slice(0, separator);
  const ref = input.slice(separator + 1);
  const segments = name.split("/");

  if (/\s|\\/.test(input)) {
    throw new Error("Action reference must not contain whitespace or backslashes.");
  }

  if (segments.length < 2) {
    throw new Error(
      "Action reference must include an owner and repository in owner/repository@ref format.",
    );
  }

  if (segments.some((segment) => segment === "")) {
    throw new Error("Action reference must not contain empty path segments.");
  }

  if (!ref || ref.startsWith("/") || ref.endsWith("/")) {
    throw new Error("Action reference must include a valid, non-empty ref after '@'.");
  }

  return {
    owner: segments[0],
    repository: segments[1],
    ...(segments.length > 2 ? { path: segments.slice(2).join("/") } : {}),
    ref,
  };
}
