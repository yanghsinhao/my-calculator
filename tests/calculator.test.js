// calculator.html 的完整測試：用 Playwright（Chromium）實際點按畫面。
// 用法：npm test
// 測試其他版本：node tests/calculator.test.js <html 檔案路徑>
// 結束碼：0 = 全部通過，1 = 有測試失敗，2 = 測試環境無法啟動。

const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");

const htmlPath = path.resolve(process.argv[2] || path.join(__dirname, "..", "calculator.html"));
const tests = [];

function test(group, name, fn) {
  tests.push({ group, name, fn });
}

// ===== 比對工具：失敗時同時列出預期值和實際值 =====
class CheckFailed extends Error {}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new CheckFailed(`${label}：預期 ${e}，實際 ${a}`);
}

function ok(condition, message) {
  if (!condition) throw new CheckFailed(message);
}

// ===== 操作畫面的工具 =====
function helpers(page) {
  const h = {
    // 點按計算機按鈕，例如 h.click("2+3=")；「C」是清除
    async click(keys) {
      for (const k of keys) {
        const selector =
          k === "=" ? '#calcPage [data-action="equal"]' :
          k === "C" ? '#calcPage [data-action="clear"]' :
          `#calcPage .buttons [data-value="${k}"]`;
        await page.locator(selector).click();
      }
    },
    // 依序按下鍵盤按鍵
    async keys(...list) {
      for (const k of list) await page.keyboard.press(k);
    },
    // 逐字輸入算式，例如 h.type("2+3")
    async type(text) {
      for (const ch of text) await page.keyboard.press(ch);
    },
    expr: () => page.locator("#expression").textContent(),
    result: () => page.locator("#result").textContent(),
    async history() {
      const items = page.locator("#historyList .history-item");
      const out = [];
      for (let i = 0; i < await items.count(); i++) {
        const expr = await items.nth(i).locator(".history-expr").textContent();
        const result = await items.nth(i).locator(".history-result").textContent();
        out.push(`${expr} ${result}`);
      }
      return out;
    },
    tab: (name) => page.locator(`.tab[data-page="${name}"]`).click(),
    // 只用 Tab 鍵把焦點移到指定的按鈕
    async tabTo(selector) {
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        if (await page.evaluate((s) => document.activeElement.matches(s), selector)) return;
      }
      throw new CheckFailed(`無法用 Tab 移到 ${selector}`);
    },
    async state(expr, result, history) {
      eq(await h.expr(), expr, "算式");
      eq(await h.result(), result, "結果");
      if (history) eq(await h.history(), history, "歷史紀錄");
    },
  };
  return h;
}

const EQUAL = '#calcPage [data-action="equal"]';
const value = (v) => `#calcPage .buttons [data-value="${v}"]`;
const EMPTY = "還沒有計算紀錄";

// ===== 計算機（5） =====
test("計算機", "先乘除後加減", async (h) => {
  await h.click("2+3×4=");
  await h.state("2+3×4 =", "14");
});
test("計算機", "負數開頭與負數結果", async (h) => {
  await h.click("−5+3=");
  await h.state("−5+3 =", "−2");
});
test("計算機", "除以 0 顯示錯誤與原因", async (h) => {
  await h.click("8÷0=");
  await h.state("8÷0 =（不能除以 0）", "錯誤");
});
test("計算機", "空白時按等號不動作", async (h) => {
  await h.click("=");
  await h.state("", "0", []);
});
test("計算機", "用上次結果接續計算", async (h) => {
  await h.click("2+3=+4=");
  await h.state("5+4 =", "9");
});

// ===== 小數點（4） =====
test("小數點", "按鈕輸入小數", async (h) => {
  await h.click("1.5+2.5=");
  await h.state("1.5+2.5 =", "4");
});
test("小數點", "開頭按小數點自動補 0", async (h) => {
  await h.click(".5");
  eq(await h.expr(), "0.5", "算式");
});
test("小數點", "同一個數字不能有兩個小數點", async (h) => {
  await h.click("1..2");
  eq(await h.expr(), "1.2", "算式");
});
test("小數點", "修正小數誤差", async (h) => {
  await h.click("0.1+0.2=");
  eq(await h.result(), "0.3", "結果");
});

// ===== 歷史紀錄（8） =====
test("歷史紀錄", "沒有紀錄時顯示提示文字", async (h, page) => {
  eq(await page.locator("#historyList .history-empty").textContent(), EMPTY, "提示文字");
});
test("歷史紀錄", "標題為「計算紀錄」", async (h, page) => {
  eq(await page.locator(".history-title").textContent(), "計算紀錄", "標題");
});
test("歷史紀錄", "清除按鈕文字為「清除紀錄」", async (h, page) => {
  eq(await page.locator(".history-clear").textContent(), "清除紀錄", "按鈕文字");
});
test("歷史紀錄", "每筆分成算式與結果", async (h) => {
  await h.click("2+3=");
  eq(await h.history(), ["2+3 = 5"], "歷史紀錄");
});
test("歷史紀錄", "最多保留 10 筆", async (h) => {
  for (let i = 0; i < 12; i++) await h.click(`${i % 10}+1=`);
  eq((await h.history()).length, 10, "筆數");
});
test("歷史紀錄", "最新的在最上面", async (h) => {
  await h.click("1+1=");
  await h.click("2+2=");
  eq(await h.history(), ["2+2 = 4", "1+1 = 2"], "歷史紀錄");
});
test("歷史紀錄", "清除按鈕會清空紀錄", async (h, page) => {
  await h.click("1+1=");
  await page.locator(".history-clear").click();
  eq(await h.history(), [], "歷史紀錄");
  eq(await page.locator("#historyList .history-empty").textContent(), EMPTY, "提示文字");
});
test("歷史紀錄", "除以 0 不記錄", async (h) => {
  await h.click("8÷0=");
  eq(await h.history(), [], "歷史紀錄");
});

// ===== 鍵盤操作（5） =====
test("鍵盤操作", "數字、小數點與四則運算", async (h) => {
  await h.type("1.5+2-3*4/2");
  eq(await h.expr(), "1.5+2−3×4÷2", "算式");
});
test("鍵盤操作", "Enter 算出答案", async (h) => {
  await h.type("6*7");
  await h.keys("Enter");
  await h.state("6×7 =", "42");
});
test("鍵盤操作", "= 鍵算出答案", async (h) => {
  await h.type("9-4");
  await h.keys("=");
  await h.state("9−4 =", "5");
});
test("鍵盤操作", "Esc 和 Backspace 都會清除", async (h) => {
  await h.type("12");
  await h.keys("Escape");
  await h.state("", "0");
  await h.type("34");
  await h.keys("Backspace");
  await h.state("", "0");
});
test("鍵盤操作", "鍵盤計算會寫入紀錄", async (h) => {
  await h.type("3+4");
  await h.keys("Enter");
  eq(await h.history(), ["3+4 = 7"], "歷史紀錄");
});

// ===== Enter 修正（9） =====
test("Enter 修正", "點 7 後按 Enter，算式不會變回 7", async (h) => {
  await h.click("7");
  await h.keys("Enter");
  await h.state("7 =", "7", ["7 = 7"]);
});
test("Enter 修正", "點 2+3 後按 Enter，只算出答案", async (h) => {
  await h.click("2+3");
  await h.keys("Enter");
  await h.state("2+3 =", "5", ["2+3 = 5"]);
});
test("Enter 修正", "點運算符號後按 Enter，不會再輸入符號", async (h) => {
  await h.click("5+");
  await h.keys("Enter");
  await h.state("5 =", "5", ["5 = 5"]);
});
test("Enter 修正", "點清除 C 後按 Enter，不會再清除", async (h) => {
  await h.click("C");
  await h.type("2+3");
  await h.keys("Enter");
  await h.state("2+3 =", "5", ["2+3 = 5"]);
});
test("Enter 修正", "點過清除紀錄後按 Enter，不會清掉新紀錄", async (h, page) => {
  await page.locator(".history-clear").click();
  await h.type("2+3");
  await h.keys("Enter");
  eq(await h.history(), ["2+3 = 5"], "歷史紀錄");
});
test("Enter 修正", "Tab 到數字鍵按 Enter，只按下該鍵", async (h) => {
  await h.type("2+");
  await h.tabTo(value("7"));
  await h.keys("Enter");
  await h.state("2+7", "0", []);
});
test("Enter 修正", "Tab 到等號按 Enter，計算一次", async (h) => {
  await h.type("2+3");
  await h.tabTo(EQUAL);
  await h.keys("Enter");
  await h.state("2+3 =", "5", ["2+3 = 5"]);
});
test("Enter 修正", "Tab 到清除紀錄按 Enter，會清除紀錄", async (h) => {
  await h.type("2+3");
  await h.keys("Enter");
  await h.tabTo(".history-clear");
  await h.keys("Enter");
  eq(await h.history(), [], "歷史紀錄");
});
test("Enter 修正", "Tab 到數字鍵按空白鍵，只輸入一次", async (h) => {
  await h.tabTo(value("5"));
  await h.keys("Space");
  eq(await h.expr(), "5", "算式");
});

// ===== 單位換算（5） =====
test("單位換算", "重量：1 台斤 = 600 公克", async (h, page) => {
  await h.tab("convertPage");
  eq(await page.locator("#convertBefore").textContent(), "1.00 台斤", "換算前");
  eq(await page.locator("#convertAfter").textContent(), "= 600.00 公克", "換算後");
});
test("單位換算", "面積：1 坪 = 3.31 平方公尺", async (h, page) => {
  await h.tab("convertPage");
  await page.locator('.category[data-category="area"]').click();
  eq(await page.locator("#convertAfter").textContent(), "= 3.31 平方公尺", "換算後");
});
test("單位換算", "匯率：1 美元 = 32 新台幣", async (h, page) => {
  await h.tab("convertPage");
  await page.locator('.category[data-category="currency"]').click();
  eq(await page.locator("#convertAfter").textContent(), "= 32.00 新台幣 TWD", "換算後");
});
test("單位換算", "對調單位後重新換算", async (h, page) => {
  await h.tab("convertPage");
  await page.locator("#amount").fill("600");
  await page.locator("#swapBtn").click();
  eq(await page.locator("#convertBefore").textContent(), "600.00 公克", "換算前");
  eq(await page.locator("#convertAfter").textContent(), "= 1.00 台斤", "換算後");
});
test("單位換算", "在換算頁按 Enter 不影響計算機", async (h, page) => {
  await h.type("2+3");
  await h.tab("convertPage");
  await page.locator("#amount").focus();
  await h.keys("Enter");
  await h.tab("calcPage");
  await h.state("2+3", "0", []);
});

// ===== 聚餐分帳（4） =====
async function split(page, bill, people, fee) {
  await page.locator('.tab[data-page="splitPage"]').click();
  await page.locator("#billTotal").fill(bill);
  await page.locator("#peopleCount").fill(people);
  if (fee) await page.locator("#serviceFee").check();
  await page.locator("#splitBtn").click();
}
test("聚餐分帳", "每人金額無條件進位", async (h, page) => {
  await split(page, "1000", "3", false);
  eq(await page.locator("#perPerson").textContent(), "$334 元", "每人");
  eq(await page.locator("#feeText").textContent(), "不加", "服務費");
});
test("聚餐分帳", "加一成服務費", async (h, page) => {
  await split(page, "3580", "4", true);
  eq(await page.locator("#feeText").textContent(), "$358", "服務費");
  eq(await page.locator("#grandText").textContent(), "$3,938", "應付總額");
  eq(await page.locator("#perPerson").textContent(), "$985 元", "每人");
});
test("聚餐分帳", "人數空白時提示", async (h, page) => {
  await split(page, "100", "", false);
  eq(await page.locator("#perPerson").textContent(), "人數要是正整數", "提示");
});
test("聚餐分帳", "金額空白時提示", async (h, page) => {
  await split(page, "", "4", false);
  eq(await page.locator("#perPerson").textContent(), "請輸入總金額", "提示");
});

// ===== 整體（4） =====
test("整體", "預設顯示計算機分頁", async (h, page) => {
  ok(await page.locator("#calcPage").isVisible(), "計算機分頁沒有顯示");
  ok(!(await page.locator("#convertPage").isVisible()), "單位換算不應顯示");
  ok(!(await page.locator("#splitPage").isVisible()), "聚餐分帳不應顯示");
});
test("整體", "切換到單位換算", async (h, page) => {
  await h.tab("convertPage");
  ok(await page.locator("#convertPage").isVisible(), "單位換算沒有顯示");
  ok(!(await page.locator("#calcPage").isVisible()), "計算機不應顯示");
});
test("整體", "切換到聚餐分帳", async (h, page) => {
  await h.tab("splitPage");
  ok(await page.locator("#splitPage").isVisible(), "聚餐分帳沒有顯示");
});
test("整體", "走過三個分頁後 Console 沒有錯誤", async (h, page) => {
  await h.click("1+1=");
  await h.tab("convertPage");
  await page.locator("#convertBtn").click();
  await h.tab("splitPage");
  await page.locator("#splitBtn").click();
  await h.tab("calcPage");
  ok(await page.locator("#calcPage").isVisible(), "無法切回計算機");
  // Console 錯誤由測試執行器在每一項結束時統一檢查
});

// ===== 連按等於（10）：連續按 Enter 或 = 不得重複產生歷史紀錄 =====
test("連按等於", "連按 Enter 兩次", async (h) => {
  await h.type("4+4");
  await h.keys("Enter", "Enter");
  await h.state("4+4 =", "8", ["4+4 = 8"]);
});
test("連按等於", "連按 Enter 五次", async (h) => {
  await h.type("4+4");
  await h.keys("Enter", "Enter", "Enter", "Enter", "Enter");
  await h.state("4+4 =", "8", ["4+4 = 8"]);
});
test("連按等於", "連按 = 鍵三次", async (h) => {
  await h.type("4+4");
  await h.keys("=", "=", "=");
  await h.state("4+4 =", "8", ["4+4 = 8"]);
});
test("連按等於", "Enter 與 = 交錯", async (h) => {
  await h.type("4+4");
  await h.keys("Enter", "=", "Enter", "=");
  await h.state("4+4 =", "8", ["4+4 = 8"]);
});
test("連按等於", "連點等號按鈕", async (h) => {
  await h.click("4+4===");
  await h.state("4+4 =", "8", ["4+4 = 8"]);
});
test("連按等於", "點過按鈕後連按 Enter", async (h) => {
  await h.click("4+4");
  await h.keys("Enter", "Enter", "Enter");
  await h.state("4+4 =", "8", ["4+4 = 8"]);
});
test("連按等於", "Tab 到等號後連按 Enter", async (h) => {
  await h.type("4+4");
  await h.tabTo(EQUAL);
  await h.keys("Enter", "Enter", "Enter");
  await h.state("4+4 =", "8", ["4+4 = 8"]);
});
test("連按等於", "Tab 到等號後連按空白鍵", async (h) => {
  await h.type("4+4");
  await h.tabTo(EQUAL);
  await h.keys("Space", "Space", "Space");
  await h.state("4+4 =", "8", ["4+4 = 8"]);
});
test("連按等於", "紀錄中不會出現「= =」", async (h) => {
  await h.type("8");
  await h.keys("Enter", "Enter", "=", "Enter");
  const history = await h.history();
  ok(history.every((line) => !/=\s*=/.test(line)), `出現格式錯誤的紀錄：${JSON.stringify(history)}`);
});
test("連按等於", "算式結尾是運算符號時連按", async (h) => {
  await h.click("5+");
  await h.keys("=", "=", "Enter");
  await h.state("5 =", "5", ["5 = 5"]);
});

// ===== 除以 0 連按（5） =====
test("除以 0 連按", "連按不記錄", async (h) => {
  await h.type("8/0");
  await h.keys("Enter", "Enter", "=");
  eq(await h.history(), [], "歷史紀錄");
});
test("除以 0 連按", "連按時算式不疊加", async (h) => {
  await h.type("8/0");
  await h.keys("Enter", "Enter", "=", "Enter");
  await h.state("8÷0 =（不能除以 0）", "錯誤");
});
test("除以 0 連按", "連按後可清除並重新計算", async (h) => {
  await h.type("8/0");
  await h.keys("Enter", "Enter", "Escape");
  await h.type("6/2");
  await h.keys("Enter");
  await h.state("6÷2 =", "3", ["6÷2 = 3"]);
});
test("除以 0 連按", "連按後按數字開始新算式", async (h) => {
  await h.type("8/0");
  await h.keys("Enter", "Enter");
  await h.type("7");
  eq(await h.expr(), "7", "算式");
});
test("除以 0 連按", "連按後按運算符號從 0 開始", async (h) => {
  await h.type("8/0");
  await h.keys("Enter", "Enter");
  await h.type("+");
  eq(await h.expr(), "0+", "算式");
});

// ===== 接續計算（8）：修正連按後，正常的連續計算不受影響 =====
test("接續計算", "用上次結果接續並各記一筆", async (h) => {
  await h.click("2+3=+4=");
  await h.state("5+4 =", "9", ["5+4 = 9", "2+3 = 5"]);
});
test("接續計算", "算完按數字開始新算式", async (h) => {
  await h.click("2+3=7");
  eq(await h.expr(), "7", "算式");
});
test("接續計算", "相同算式重新輸入會再記一筆", async (h) => {
  await h.click("2+3=");
  await h.click("2+3=");
  eq(await h.history(), ["2+3 = 5", "2+3 = 5"], "歷史紀錄");
});
test("接續計算", "連續三題都有紀錄", async (h) => {
  await h.type("1+1");
  await h.keys("Enter");
  await h.type("2+2");
  await h.keys("Enter");
  await h.type("3+3");
  await h.keys("Enter");
  eq(await h.history(), ["3+3 = 6", "2+2 = 4", "1+1 = 2"], "歷史紀錄");
});
test("接續計算", "連按後仍能接續計算", async (h) => {
  await h.type("2+3");
  await h.keys("Enter", "Enter");
  await h.type("+1");
  await h.keys("Enter");
  await h.state("5+1 =", "6", ["5+1 = 6", "2+3 = 5"]);
});
test("接續計算", "負數結果可以接續計算", async (h) => {
  await h.click("1−3=+5=");
  await h.state("−2+5 =", "3");
});
test("接續計算", "Esc 清除後按 Enter 不記錄", async (h) => {
  await h.type("2+3");
  await h.keys("Escape", "Enter");
  await h.state("", "0", []);
});
test("接續計算", "算完 Backspace 後按等號不再記錄", async (h) => {
  await h.type("2+3");
  await h.keys("Enter", "Backspace", "=");
  await h.state("", "0", ["2+3 = 5"]);
});

// ===== 執行 =====
async function main() {
  if (!fs.existsSync(htmlPath)) {
    console.error(`找不到測試目標：${htmlPath}`);
    process.exit(2);
  }

  let browser;
  try {
    const { chromium } = require("playwright");
    browser = await chromium.launch();
  } catch (err) {
    console.error("無法啟動測試環境。請先執行 npm install 和 npx playwright install chromium。");
    console.error(err.message);
    process.exit(2);
  }

  console.log(`測試目標：${htmlPath}\n`);
  const url = pathToFileURL(htmlPath).href;
  const failures = [];
  const groups = new Map();

  for (const t of tests) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
    page.on("pageerror", (e) => consoleErrors.push(e.message));

    let error = null;
    try {
      await page.goto(url);
      await t.fn(helpers(page), page);
      if (consoleErrors.length) throw new CheckFailed(`Console 有錯誤：${consoleErrors.join("；")}`);
    } catch (err) {
      error = err.message.split("\n")[0];
    }
    await context.close();

    const stats = groups.get(t.group) || { pass: 0, fail: 0 };
    if (error) {
      stats.fail++;
      failures.push({ ...t, error });
      console.log(`FAIL  [${t.group}] ${t.name}\n      ${error}`);
    } else {
      stats.pass++;
      console.log(`PASS  [${t.group}] ${t.name}`);
    }
    groups.set(t.group, stats);
  }
  await browser.close();

  console.log("\n各功能結果：");
  for (const [group, s] of groups) console.log(`  ${group}：${s.pass}／${s.pass + s.fail}`);
  console.log(`\n通過 ${tests.length - failures.length}／失敗 ${failures.length}（共 ${tests.length} 項）`);
  process.exit(failures.length ? 1 : 0);
}

main();
