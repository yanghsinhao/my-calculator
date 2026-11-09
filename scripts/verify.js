// 修改後驗證：任一項失敗就停止（結束碼 1）。
// 用法：npm run verify -- <允許修改的檔案> [其他檔案...]
// 例如：npm run verify -- calculator.html
// 本腳本只讀取資訊並執行測試，不會變更分支或推送任何內容。

const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BRANCH = "develop";
const root = path.join(__dirname, "..");

function git(...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function pass(message) {
  console.log(`通過  ${message}`);
}

function stop(message, details = []) {
  console.error(`\n停止  ${message}`);
  for (const line of details) console.error(`      ${line}`);
  console.error("\n驗證未通過：請先回報，不要自行修好再繼續。");
  process.exit(1);
}

// git 用 -z 輸出時以 NUL 分隔，檔名含中文也不會被跳脫
function nulList(text) {
  return text.split("\0").filter(Boolean);
}

function lines(text) {
  return text ? text.split("\n") : [];
}

function remoteHeads() {
  const heads = {};
  for (const line of lines(git("ls-remote", "--heads", "origin"))) {
    const [sha, ref] = line.split(/\s+/);
    heads[ref.replace("refs/heads/", "")] = sha;
  }
  return heads;
}

function diffHeads(before, after) {
  const out = [];
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[name] !== after[name]) {
      out.push(`${name}：${(before[name] || "不存在").slice(0, 7)} → ${(after[name] || "不存在").slice(0, 7)}`);
    }
  }
  return out;
}

function main() {
  const allowed = new Set(
    process.argv.slice(2).map((f) => f.replace(/\\/g, "/").replace(/^\.\//, ""))
  );
  if (!allowed.size) stop("請指定這次允許修改的檔案", ["用法：npm run verify -- calculator.html"]);

  const statePath = path.resolve(root, git("rev-parse", "--git-path", "preflight-state.json"));
  if (!fs.existsSync(statePath)) stop("找不到基準狀態，請先在修改前執行 npm run preflight");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));

  // 1. 分支
  const branch = git("branch", "--show-current");
  if (branch !== BRANCH) stop(`目前分支是「${branch || "（非分支狀態）"}」，必須是 ${BRANCH}`);
  pass(`目前仍在 ${BRANCH}`);

  // 2. 歷史沒有被改寫，也沒有合併
  try {
    git("merge-base", "--is-ancestor", state.head, "HEAD");
  } catch {
    stop("目前的歷史不包含修改前的 commit，可能被改寫過");
  }
  const merges = lines(git("rev-list", "--merges", `${state.head}..HEAD`));
  if (merges.length) stop("修改期間出現合併 commit", merges);
  pass("歷史沒有被改寫，也沒有合併");

  // 3. 修改檔案範圍（包含已 commit、未 commit 和新增的檔案）
  const changed = [...new Set([
    ...nulList(git("diff", "--name-only", "--no-renames", "-z", state.head)),
    ...nulList(git("ls-files", "--others", "--exclude-standard", "-z")),
  ])].sort();
  const outside = changed.filter((f) => !allowed.has(f));
  if (outside.length) stop("修改了允許清單以外的檔案", outside);
  pass(`修改範圍符合：${changed.length ? changed.join("、") : "（沒有修改）"}`);

  // 4. 遠端分支和本機分支
  const remoteChanges = diffHeads(state.remoteHeads, remoteHeads());
  if (remoteChanges.length) stop("遠端分支和修改前不同", remoteChanges);
  pass(`遠端分支沒有變動（main：${(state.remoteHeads.main || "無").slice(0, 7)}）`);

  const localNow = lines(git("for-each-ref", "--format=%(refname:short)", "refs/heads")).sort();
  if (JSON.stringify(localNow) !== JSON.stringify(state.localBranches)) {
    stop("本機分支有新增或刪除", [`修改前：${state.localBranches.join("、")}`, `目前：${localNow.join("、")}`]);
  }
  pass("本機沒有新增或刪除分支");

  // 5. 完整測試
  console.log("\n執行完整測試：\n");
  const run = spawnSync(process.execPath, [path.join("tests", "calculator.test.js")], {
    cwd: root,
    stdio: "inherit",
  });
  if (run.status !== 0) stop(`測試未通過（結束碼 ${run.status}）`);

  console.log("\n修改後驗證全部通過。");
}

main();
