const VERSION_PATTERN = /^v?\d+(\.\d+)*$/;

/** Whether a tag looks like a version, for example v4, v4.2 or 4.2.2. */
export function isVersionTag(tag: string): boolean {
  return VERSION_PATTERN.test(tag);
}

/** Compares two version tags numerically; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const parts = (tag: string) => tag.replace(/^v/, "").split(".").map(Number);
  const [left, right] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
