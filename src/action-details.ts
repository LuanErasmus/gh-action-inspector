import { parse as parseYaml } from "yaml";
import {
  createGitHubApiClient,
  GitHubApiError,
  type GitHubApiOptions,
} from "./github-api.js";
import type { ParsedActionReference } from "./parse-reference.js";

export interface ActionInputDetails {
  description?: string;
  required: boolean;
  default?: string;
  deprecationMessage?: string;
}

export interface ActionOutputDetails {
  description?: string;
}

export interface ActionDetails {
  path: string;
  sha: string;
  name?: string;
  description?: string;
  runtime: string;
  inputs: Record<string, ActionInputDetails>;
  outputs: Record<string, ActionOutputDetails>;
}

export interface ChangedActionDefault {
  input: string;
  before?: string;
  after?: string;
}

export interface DeprecatedActionInput {
  input: string;
  deprecationMessage: string;
}

export interface ActionDetailsComparison {
  runtimeChanged: boolean;
  runtimeBefore: string;
  runtimeAfter: string;
  addedRequiredInputsWithoutDefaults: string[];
  newlyRequiredInputsWithoutDefaults: string[];
  removedInputs: string[];
  removedOutputs: string[];
  changedDefaults: ChangedActionDefault[];
  deprecatedInputs: DeprecatedActionInput[];
  notice: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(
  value: Record<string, unknown>,
  key: string,
  context: string,
): string | undefined {
  if (!(key in value)) {
    return undefined;
  }
  if (typeof value[key] !== "string") {
    throw new Error(`Action metadata field "${context}.${key}" must be a string.`);
  }
  return value[key];
}

function decodeContent(value: unknown, filePath: string): string {
  if (
    !isRecord(value) ||
    value.type !== "file" ||
    value.encoding !== "base64" ||
    typeof value.content !== "string"
  ) {
    throw new Error(
      `GitHub API returned invalid contents for "${filePath}"; expected a base64-encoded file.`,
    );
  }

  const encoded = value.content.replace(/\s/g, "");
  if (
    encoded.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
  ) {
    throw new Error(`GitHub API returned invalid base64 content for "${filePath}".`);
  }
  return Buffer.from(encoded, "base64").toString("utf8");
}

function readMetadata(source: string, filePath: string): Omit<ActionDetails, "path" | "sha"> {
  let parsed: unknown;
  try {
    parsed = parseYaml(source);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(`Could not parse action metadata "${filePath}".${detail}`);
  }

  if (!isRecord(parsed)) {
    throw new Error(`Action metadata "${filePath}" must contain a YAML mapping.`);
  }

  const name = readOptionalString(parsed, "name", "action");
  const description = readOptionalString(parsed, "description", "action");
  if (!("runs" in parsed) || !isRecord(parsed.runs)) {
    throw new Error(`Action metadata "${filePath}" must define a runs mapping.`);
  }
  if (typeof parsed.runs.using !== "string" || parsed.runs.using.trim() === "") {
    throw new Error(`Action metadata "${filePath}" must define runs.using as a non-empty string.`);
  }

  const inputs = new Map<string, ActionInputDetails>();
  if ("inputs" in parsed) {
    if (!isRecord(parsed.inputs)) {
      throw new Error(`Action metadata field "inputs" in "${filePath}" must be a mapping.`);
    }
    for (const [inputName, definition] of Object.entries(parsed.inputs)) {
      if (!isRecord(definition)) {
        throw new Error(`Action input "${inputName}" in "${filePath}" must be a mapping.`);
      }
      const context = `inputs.${inputName}`;
      const inputDescription = readOptionalString(definition, "description", context);
      let defaultValue: string | undefined;
      if ("default" in definition) {
        const value = definition.default;
        if (value !== null && typeof value !== "string" && typeof value !== "boolean" &&
            !(typeof value === "number" && Number.isFinite(value))) {
          throw new Error(`Action metadata field "${context}.default" must be a scalar string, boolean, or number.`);
        }
        defaultValue = value === null ? "" : String(value);
      }
      const deprecationMessage = readOptionalString(
        definition,
        "deprecationMessage",
        context,
      );
      if ("required" in definition && typeof definition.required !== "boolean") {
        throw new Error(`Action metadata field "${context}.required" must be a boolean.`);
      }
      inputs.set(inputName, {
        ...(inputDescription === undefined ? {} : { description: inputDescription }),
        required: definition.required === true,
        ...(defaultValue === undefined ? {} : { default: defaultValue }),
        ...(deprecationMessage === undefined ? {} : { deprecationMessage }),
      });
    }
  }

  const outputs = new Map<string, ActionOutputDetails>();
  if ("outputs" in parsed) {
    if (!isRecord(parsed.outputs)) {
      throw new Error(`Action metadata field "outputs" in "${filePath}" must be a mapping.`);
    }
    for (const [outputName, definition] of Object.entries(parsed.outputs)) {
      if (!isRecord(definition)) {
        throw new Error(`Action output "${outputName}" in "${filePath}" must be a mapping.`);
      }
      const outputDescription = readOptionalString(
        definition,
        "description",
        `outputs.${outputName}`,
      );
      outputs.set(outputName, outputDescription === undefined
        ? {}
        : { description: outputDescription });
    }
  }

  return {
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    runtime: parsed.runs.using,
    inputs: Object.fromEntries(inputs),
    outputs: Object.fromEntries(outputs),
  };
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export async function inspectReusableWorkflow(
  reference: ParsedActionReference,
  sha: string,
  options: GitHubApiOptions = {},
): Promise<void> {
  if (!reference.path || !/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(reference.path) ||
      !/^[a-f0-9]{40}$/i.test(sha)) {
    throw new Error("Reusable workflow inspection requires a workflow path and resolved full SHA.");
  }
  const response = await createGitHubApiClient(options).getRepositoryJson(
    reference.owner, reference.repository,
    `/contents/${encodePath(reference.path)}?ref=${encodeURIComponent(sha)}`,
  );
  const parsed: unknown = parseYaml(decodeContent(response, reference.path));
  if (!isRecord(parsed) || !isRecord(parsed.jobs)) {
    throw new Error(`Reusable workflow "${reference.path}" must define a jobs mapping.`);
  }
  const triggers = parsed.on;
  const callable = triggers === "workflow_call" ||
    (Array.isArray(triggers) && triggers.includes("workflow_call")) ||
    (isRecord(triggers) && Object.hasOwn(triggers, "workflow_call"));
  if (!callable) throw new Error(`Workflow "${reference.path}" does not declare on.workflow_call.`);
}

export async function inspectAction(
  reference: ParsedActionReference,
  sha: string,
  options: GitHubApiOptions = {},
): Promise<ActionDetails> {
  if (!/^[a-f0-9]{40}$/i.test(sha)) {
    throw new Error("Action metadata inspection requires a resolved full 40-character commit SHA.");
  }
  const nestedPath = reference.path ?? "";
  if (nestedPath && (nestedPath.startsWith("/") || nestedPath.includes("\\") ||
      nestedPath.split("/").some((part) => part === "." || part === ".." || part === ""))) {
    throw new Error("Action metadata path must stay within the repository.");
  }
  if (
    /^\.github\/workflows\/[^/]+\.(?:yml|yaml)$/i.test(nestedPath)
  ) {
    throw new Error(
      `Reference path "${nestedPath}" is a reusable workflow, not action metadata.`,
    );
  }

  const { getRepositoryJson } = createGitHubApiClient(options);
  async function fetchMetadata(fileName: "action.yml" | "action.yaml") {
    const filePath = nestedPath ? `${nestedPath}/${fileName}` : fileName;
    const path = `/contents/${encodePath(filePath)}?ref=${encodeURIComponent(sha)}`;
    const response = await getRepositoryJson(
      reference.owner,
      reference.repository,
      path,
    );
    return { filePath, source: decodeContent(response, filePath) };
  }

  let file: Awaited<ReturnType<typeof fetchMetadata>>;
  try {
    file = await fetchMetadata("action.yml");
  } catch (error) {
    if (!(error instanceof GitHubApiError) || error.status !== 404) {
      throw error;
    }
    try {
      file = await fetchMetadata("action.yaml");
    } catch (fallbackError) {
      if (fallbackError instanceof GitHubApiError && fallbackError.status === 404) {
        throw new Error(
          `No action.yml or action.yaml found at "${nestedPath || "."}" in ${reference.owner}/${reference.repository} at ${sha}.`,
        );
      }
      throw fallbackError;
    }
  }

  return {
    path: file.filePath,
    sha,
    ...readMetadata(file.source, file.filePath),
  };
}

export function compareActionDetails(
  before: ActionDetails,
  after: ActionDetails,
): ActionDetailsComparison {
  const beforeInputNames = new Set(Object.keys(before.inputs));
  const afterInputNames = new Set(Object.keys(after.inputs));

  const changedDefaults: ChangedActionDefault[] = [];
  for (const input of Object.keys(before.inputs)) {
    if (
      afterInputNames.has(input) &&
      before.inputs[input].default !== after.inputs[input].default
    ) {
      changedDefaults.push({
        input,
        ...(before.inputs[input].default === undefined
          ? {}
          : { before: before.inputs[input].default }),
        ...(after.inputs[input].default === undefined
          ? {}
          : { after: after.inputs[input].default }),
      });
    }
  }

  return {
    runtimeChanged: before.runtime !== after.runtime,
    runtimeBefore: before.runtime,
    runtimeAfter: after.runtime,
    addedRequiredInputsWithoutDefaults: Object.keys(after.inputs).filter(
      (input) =>
        !beforeInputNames.has(input) &&
        after.inputs[input].required &&
        after.inputs[input].default === undefined,
    ),
    newlyRequiredInputsWithoutDefaults: Object.keys(after.inputs).filter(
      (input) => Object.hasOwn(before.inputs, input) &&
        !before.inputs[input].required && after.inputs[input].required &&
        after.inputs[input].default === undefined,
    ),
    removedInputs: Object.keys(before.inputs).filter((input) => !afterInputNames.has(input)),
    removedOutputs: Object.keys(before.outputs).filter(
      (output) => !Object.hasOwn(after.outputs, output),
    ),
    changedDefaults,
    deprecatedInputs: Object.entries(after.inputs).flatMap(([input, definition]) =>
      definition.deprecationMessage === undefined
        ? []
        : [{ input, deprecationMessage: definition.deprecationMessage }],
    ),
    notice:
      "Runtime and metadata comparison cannot guarantee compatibility; review the action's release notes manually.",
  };
}
