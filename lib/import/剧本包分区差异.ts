export interface BundleRevisionSnapshotItem {
  key: string;
  label: string;
  content: string;
}

export type BundleRevisionDiffStatus =
  | "added"
  | "removed"
  | "changed"
  | "unchanged";

export interface BundleRevisionDiffItem {
  key: string;
  label: string;
  before: string;
  after: string;
  status: BundleRevisionDiffStatus;
}

function normalizedSnapshot(items: BundleRevisionSnapshotItem[]) {
  return items.map((item) => ({
    key: item.key.trim(),
    label: item.label.trim(),
    content: item.content.replaceAll("\r\n", "\n").trim(),
  }));
}

export function bundleRevisionSnapshotFingerprint(
  items: BundleRevisionSnapshotItem[],
) {
  return JSON.stringify(normalizedSnapshot(items));
}

export function compareBundleRevisionSnapshots(
  beforeItems: BundleRevisionSnapshotItem[],
  afterItems: BundleRevisionSnapshotItem[],
) {
  const before = normalizedSnapshot(beforeItems);
  const after = normalizedSnapshot(afterItems);
  const beforeByKey = new Map(before.map((item) => [item.key, item]));
  const afterByKey = new Map(after.map((item) => [item.key, item]));
  const keys = [
    ...before.map((item) => item.key),
    ...after
      .map((item) => item.key)
      .filter((key) => !beforeByKey.has(key)),
  ];

  return keys.map((key): BundleRevisionDiffItem => {
    const previous = beforeByKey.get(key);
    const next = afterByKey.get(key);
    const status: BundleRevisionDiffStatus = !previous
      ? "added"
      : !next
        ? "removed"
        : previous.content === next.content
          ? "unchanged"
          : "changed";
    return {
      key,
      label: next?.label || previous?.label || key,
      before: previous?.content ?? "",
      after: next?.content ?? "",
      status,
    };
  });
}

