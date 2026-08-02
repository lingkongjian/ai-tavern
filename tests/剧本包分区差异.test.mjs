import assert from "node:assert/strict";
import test from "node:test";
import {
  bundleRevisionSnapshotFingerprint,
  compareBundleRevisionSnapshots,
} from "../lib/import/剧本包分区差异.ts";

test("分区快照比较识别新增、删除、修改和未变化项目", () => {
  const before = [
    { key: "player", label: "玩家", content: "旧玩家资料" },
    { key: "main", label: "主要角色", content: "相同资料" },
    { key: "removed", label: "旧角色", content: "将被删除" },
  ];
  const after = [
    { key: "player", label: "玩家", content: "新玩家资料" },
    { key: "main", label: "主要角色", content: "相同资料" },
    { key: "added", label: "新角色", content: "新增内容" },
  ];
  const differences = compareBundleRevisionSnapshots(before, after);

  assert.deepEqual(
    Object.fromEntries(differences.map((item) => [item.key, item.status])),
    {
      player: "changed",
      main: "unchanged",
      removed: "removed",
      added: "added",
    },
  );
});

test("快照指纹忽略首尾空白但能发现语义内容变化", () => {
  const baseline = [
    { key: "opening", label: "开篇", content: "  第一幕\r\n继续  " },
  ];
  assert.equal(
    bundleRevisionSnapshotFingerprint(baseline),
    bundleRevisionSnapshotFingerprint([
      { key: "opening", label: "开篇", content: "第一幕\n继续" },
    ]),
  );
  assert.notEqual(
    bundleRevisionSnapshotFingerprint(baseline),
    bundleRevisionSnapshotFingerprint([
      { key: "opening", label: "开篇", content: "第一幕\n已经改变" },
    ]),
  );
});

