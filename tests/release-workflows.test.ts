import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import YAML from "yaml";

const load = (name: string) => YAML.parse(readFileSync(`.github/workflows/${name}.yml`, "utf8"));
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("release automation", () => {
  const prepare = load("prepare-release");
  const tag = load("tag-release");
  const release = load("release");
  const detection = tag.jobs.tag.steps.find((step: { id?: string }) => step.id === "version").run as string;
  const script = detection.split("<<'NODE'\n")[1].split("\nNODE")[0];

  it.each([
    ["1.0.0", "1.0.0", "1.0.0", true, "changed=false"],
    ["1.0.0", "1.0.1", "1.0.1", true, "tag=v1.0.1"],
    ["1.9.9", "2.0.0", "2.0.0", true, "tag=v2.0.0"],
    ["2.0.0", "1.0.0", "1.0.0", false, ""],
    ["1.0.0", "1.1.0-rc.1", "1.1.0-rc.1", false, ""],
    ["1.0.0", "1.1.0", "1.0.0", false, ""],
  ])("validates %s -> %s with lock version %s", (previous, current, lock, success, expected) => {
    const directory = mkdtempSync(join(tmpdir(), "inspector-release-test-"));
    directories.push(directory);
    writeFileSync(join(directory, "previous-package.json"), JSON.stringify({ version: previous }));
    writeFileSync(join(directory, "package.json"), JSON.stringify({ version: current }));
    writeFileSync(join(directory, "package-lock.json"), JSON.stringify({
      version: lock, packages: { "": { version: lock } },
    }));
    const output = join(directory, "outputs");
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: directory, encoding: "utf8",
      env: { ...process.env, RUNNER_TEMP: directory, GITHUB_OUTPUT: output },
    });
    expect(result.status === 0, result.stderr).toBe(success);
    if (success) expect(readFileSync(output, "utf8")).toContain(expected);
  });

  it("limits automation to main and checks before creating the tag", () => {
    expect(prepare.jobs.prepare.environment).toBe("release");
    expect(tag.jobs.tag.environment).toBe("release");
    expect(release.jobs.release.environment).toBe("release");
    expect(prepare.jobs.prepare.if).toBe("github.ref == 'refs/heads/main'");
    expect(tag.on.push.branches).toEqual(["main"]);
    expect(tag.on.push.paths).toEqual(["package.json", "package-lock.json"]);
    const steps = tag.jobs.tag.steps;
    expect(steps.findIndex((step: { name: string }) => step.name === "Verify release commit"))
      .toBeLessThan(steps.findIndex((step: { id?: string }) => step.id === "app"));
    expect(steps.at(-1).run).toContain('-f "sha=$GITHUB_SHA"');
    expect(steps.at(-1).run).not.toContain("PATCH");
  });

  it("uses restricted App tokens and never automatically merges release PRs", () => {
    for (const workflow of [prepare, tag]) {
      expect(workflow.permissions).toEqual({ contents: "read" });
      const job = Object.values(workflow.jobs)[0] as { steps: { id?: string; with?: Record<string, unknown> }[] };
      const inputs = job.steps.find((step) => step.id === "app")!.with!;
      expect(inputs["permission-contents"]).toBe("write");
      expect(inputs["skip-token-revoke"]).toBeUndefined();
    }
    const creation = prepare.jobs.prepare.steps.at(-1).run;
    expect(creation).toContain("gh pr create");
    expect(creation).toContain(".github/PULL_REQUEST_TEMPLATE.md");
    expect(creation).not.toContain("gh pr merge");
  });

  it("fills the repository PR template without dropping its checklist or sections", () => {
    const creation = prepare.jobs.prepare.steps.at(-1).run as string;
    const bodyScript = creation.split("<<'NODE'\n")[1].split("\nNODE")[0];
    const directory = mkdtempSync(join(tmpdir(), "inspector-release-test-"));
    directories.push(directory);
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", bodyScript], {
      encoding: "utf8",
      env: { ...process.env, RUNNER_TEMP: directory, TAG: "v2.0.0" },
    });

    expect(result.status, result.stderr).toBe(0);
    const body = readFileSync(join(directory, "release-pr.md"), "utf8");
    const template = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");
    for (const line of template.split(/\r?\n/).filter((line) =>
      line.startsWith("##") || line.startsWith("<!--") || line.startsWith("- ["))) {
      expect(body).toContain(line);
    }
    expect(body).toContain("Bump package.json and package-lock.json to v2.0.0");
    expect(body).toContain("not run by preparation");
  });

  it("attributes release commits to the verified release App bot", () => {
    const creation = prepare.jobs.prepare.steps.at(-1).run as string;
    expect(creation).toContain('git config user.name "luan-release-bot[bot]"');
    expect(creation).toContain('git config user.email "349538955+luan-release-bot[bot]@users.noreply.github.com"');
    expect(creation).not.toContain("release-automation@users.noreply.github.com");
  });

  it("builds before publishing a draft and verifies main ancestry", () => {
    expect(release.jobs.release.needs).toBe("build");
    expect(release.jobs.verify.steps.some((step: { run?: string }) =>
      step.run === "git merge-base --is-ancestor HEAD origin/main")).toBe(true);
    const steps = release.jobs.release.steps;
    expect(steps.at(-2).run).toContain("--draft --verify-tag");
    expect(steps.at(-1).run).toBe('gh release edit "$TAG" --draft=false');
    expect(steps.at(-1).if).toBeUndefined();
    expect(release.jobs.build.strategy.matrix.include).toHaveLength(6);
  });
});
