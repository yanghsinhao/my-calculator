// 修改前檢查：任一項失敗就停止（結束碼 1）。
// 本腳本只讀取資訊並執行 git fetch，不會 pull、push、merge 或覆蓋任何檔案。
// 全部通過後，才把基準狀態存到 .git/preflight-state.json 給 verify.js 比對。

const { execFileSync } = require("child_process");
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
  console.error("\n檢查未通過：請先回報，不要繼續修改。");
  process.exit(1);
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

function main() {
  const statePath = path.resolve(root, git("rev-parse", "--git-path", "preflight-state.json"));
  fs.rmSync(statePath, { force: true });   // 舊的基準作廢，避免這次失敗後仍能通過 verify

  // 1. 目前分支
  const branch = git("branch", "--show-current");
  if (branch !== BRANCH) stop(`目前分支是「${branch || "（非分支狀態）"}」，必須是 ${BRANCH}`);
  pass(`目前分支是 ${BRANCH}`);

  // 2. 遠端最新 commit
  try {
    git("fetch", "origin");
  } catch (err) {
    stop("無法連線到遠端（git fetch origin 失敗）", [err.message.split("\n")[0]]);
  }
  const remoteRef = `origin/${BRANCH}`;
  try {
    git("rev-parse", "--verify", remoteRef);
  } catch {
    stop(`遠端沒有 ${BRANCH} 分支`);
  }
  pass(`遠端 ${BRANCH} 最新：${git("log", "-1", "--format=%h  %ci  %s", remoteRef)}`);

  // 3. 本機與遠端是否一致
  const [ahead, behind] = git("rev-list", "--left-right", "--count", `HEAD...${remoteRef}`)
    .split(/\s+/).map(Number);
  const commits = (range) => lines(git("log", "--format=%h  %s", range));
  if (ahead && behind) {
    stop(`本機與遠端已分歧（本機多 ${ahead} 個、遠端多 ${behind} 個 commit）`, [
      "本機多出：", ...commits(`${remoteRef}..HEAD`),
      "遠端多出：", ...commits(`HEAD..${remoteRef}`),
    ]);
  }
  if (behind) stop(`本機落後遠端 ${behind} 個 commit`, commits(`HEAD..${remoteRef}`));
  if (ahead) stop(`本機領先遠端 ${ahead} 個 commit（有未推送的內容）`, commits(`${remoteRef}..HEAD`));
  pass(`本機與遠端一致（${git("rev-parse", "--short", "HEAD")}）`);

  // 4. 工作區
  const dirty = lines(git("status", "--porcelain", "--untracked-files=all"));
  if (dirty.length) stop("工作區有未提交的修改或未追蹤的檔案", dirty);
  pass("工作區沒有未提交的修改");

  // 5. CLAUDE.md
  const claudePath = path.join(root, "CLAUDE.md");
  if (!fs.existsSync(claudePath)) stop(`目前分支沒有 CLAUDE.md`);
  const claudeLines = fs.readFileSync(claudePath, "utf8").split("\n").length;
  const claudeHash = git("rev-parse", "--short", "HEAD:CLAUDE.md");
  pass(`CLAUDE.md 存在：${claudeLines} 行，hash ${claudeHash}（請讀完全文，並在回報中寫出這個 hash）`);

  // 6. 測試工具
  try {
    require.resolve("playwright", { paths: [root] });
  } catch {
    stop("找不到 Playwright", ["請先執行 npm install 和 npx playwright install chromium"]);
  }
  pass("測試工具可用");

  // 7. 記錄基準狀態
  const heads = remoteHeads();
  fs.writeFileSync(statePath, JSON.stringify({
    head: git("rev-parse", "HEAD"),
    remoteHeads: heads,
    localBranches: lines(git("for-each-ref", "--format=%(refname:short)", "refs/heads")).sort(),
    claudeHash,
  }, null, 2));
  pass(`已記錄基準狀態（main：${(heads.main || "無").slice(0, 7)}）`);

  console.log("\n修改前檢查全部通過。");
}

main();
