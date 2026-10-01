const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

test.use({ channel: 'msedge' });
test.setTimeout(120000);

async function guestNotebook(page) {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('vocab-transfer-fixture')) {
      localStorage.clear(); sessionStorage.setItem('vocab-transfer-fixture', 'ready');
    }
  });
  // 所有状态来自隔离的访客浏览器，后台埋点不接触真实账号。
  await page.route('**/api/analytics/**', (route) => route.fulfill({ contentType: 'application/json', body: '{"ok":true}' }));
  await page.goto('/?section=vocab');
  await expect(page.getByRole('heading', { name: '单词本', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入词表', exact: true })).toBeEnabled();
}
async function pastePreview(page, text) {
  await page.getByRole('button', { name: '导入词表', exact: true }).click();
  await page.getByRole('textbox', { name: '或粘贴词表' }).fill(text);
  await page.getByRole('button', { name: '预览粘贴的词表' }).click();
}
async function assertNoOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const dialog = page.getByRole('dialog');
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
}

test('编辑重复候选后可保留任一释义且只保存一次', async ({ page }, testInfo) => {
  await guestNotebook(page);
  await pastePreview(page, 'apple\t错误释义\nbanana\t香蕉');
  await page.getByRole('textbox', { name: '第 1 行单词' }).fill('banana');
  const choices = page.getByRole('checkbox', { name: '导入 banana', exact: true });
  await expect(choices.nth(0)).toBeChecked(); await expect(choices.nth(1)).toBeDisabled();
  await choices.nth(0).uncheck();
  await expect(choices.nth(0)).toBeEnabled(); await expect(choices.nth(1)).toBeEnabled();
  await expect(page.getByRole('button', { name: '确认导入 0 个词' })).toBeDisabled();
  await choices.nth(1).check();
  await page.getByRole('button', { name: '全选可导入词' }).click();
  await expect(choices.nth(0)).not.toBeChecked(); await expect(choices.nth(1)).toBeChecked();
  await expect(page.getByRole('button', { name: '确认导入 1 个词' })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath('vocab-duplicate-reselection.png'), fullPage: true });
  await page.getByRole('button', { name: '确认导入 1 个词' }).click();
  await expect(page.getByText('已保存 1 个新词')).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('toefl-vocab-book::guest')).cards);
  expect(stored).toHaveLength(1); expect(stored[0]).toMatchObject({ word: 'banana', def: '香蕉' });
});

test('真实PDF生成等字体期间锁定选项并完整回读跨页词条', async ({ page }, testInfo) => {
  const definition = `${'definition continuation '.repeat(120)}DEFINITION_END`;
  const sentence = 'TAIL_SENTENCE The apple sentence remains attached after all continuation pages.';
  await guestNotebook(page);
  await pastePreview(page, `word\tdefinition\tphonetic\texample\napple\t${definition}\t\t${sentence}`);
  await page.getByRole('button', { name: '确认导入 1 个词' }).click();
  await expect(page.getByText('已保存 1 个新词')).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: /导出 PDF · 选择单词/ }).click();
  await page.getByRole('button', { name: '全选当前筛选（1 词）' }).click();
  await page.getByRole('button', { name: '预览并导出 1 词' }).click();
  await page.getByRole('textbox', { name: '标题', exact: true }).fill('跨页回读与生成锁定');
  let releaseFont, fontStarted;
  const gate = new Promise((resolve) => { releaseFont = resolve; });
  const started = new Promise((resolve) => { fontStarted = resolve; });
  await page.route('**/fonts/pdf/NotoSansSC-Regular.ttf', async (route) => { fontStarted(); await gate; await route.continue(); });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
  try {
    await started;
    await expect(page.getByRole('textbox', { name: '标题', exact: true })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: '包含已保存的原句' })).toBeDisabled();
    await expect(page.getByRole('button', { name: '正在生成…', exact: true })).toBeDisabled();
    await expect(page.getByRole('heading', { name: '跨页回读与生成锁定', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('vocab-export-busy-controls.png'), fullPage: true });
  } finally { releaseFont(); }
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^跨页回读与生成锁定-/);
  const pdfPath = testInfo.outputPath('cross-page-vocabulary.pdf'); await download.saveAs(pdfPath);
  const { PDFDocument } = require('pdf-lib');
  expect((await PDFDocument.load(fs.readFileSync(pdfPath))).getPageCount()).toBeGreaterThan(1);
  await expect(page.getByRole('textbox', { name: '标题', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.getByRole('button', { name: '导入词表', exact: true }).click();
  await page.getByLabel('选择词表文件').setInputFiles(pdfPath);
  await expect(page.getByRole('textbox', { name: '第 1 行单词' })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('textbox', { name: /^第 \d+ 行单词$/ })).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: '第 1 行单词' })).toHaveValue('apple');
  await expect(page.getByRole('textbox', { name: '第 1 行释义' })).toHaveValue(definition);
  await expect(page.getByRole('textbox', { name: '第 1 行原句' })).toHaveValue(sentence);
  await expect(page.getByRole('checkbox', { name: '导入 apple', exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('vocab-cross-page-import.png'), fullPage: true });
});

test('访客词表确认、复习、选词下载及文字PDF回读', async ({ page }, testInfo) => {
  const aiRequests = [];
  page.on('request', (request) => { if (/\/api\/(?:vocab\/extract-image|user-bank\/extract-image|ai)(?:\/|$)/.test(new URL(request.url()).pathname)) aiRequests.push(request.url()); });
  await page.setViewportSize({ width: 1440, height: 980 });
  await guestNotebook(page);
  await expect(page.getByText('单词本还是空的')).toBeVisible();
  await pastePreview(page, 'apple\t苹果\nresilient\t有韧性的');
  await page.getByRole('textbox', { name: '第 2 行释义' }).fill('坚韧的；能迅速恢复的');
  expect(await page.evaluate(() => localStorage.getItem('toefl-vocab-book::guest'))).toBeNull();
  await page.getByRole('button', { name: '确认导入 2 个词' }).click();
  await expect(page.getByText('已保存 2 个新词')).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await pastePreview(page, 'apple\t别覆盖原释义\ncuriosity\t好奇心');
  await expect(page.getByRole('checkbox', { name: '导入 apple', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '确认导入 1 个词' }).click();
  await expect(page.getByText('已保存 1 个新词')).toBeVisible();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.reload();
  await expect(page.getByText(/坚韧的[；、]能迅速恢复的/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('toefl-vocab-book::guest')).cards);
  expect(saved).toHaveLength(3); expect(saved.find((card) => card.word === 'apple').def).toBe('苹果');
  expect(saved.find((card) => card.word === 'resilient').def).toBe('坚韧的；能迅速恢复的');
  await page.getByRole('button', { name: /^阅读复习，今天/ }).click();
  await expect(page.getByRole('button', { name: '← 退出' })).toBeVisible();
  // 完成首轮三张新卡，实际走过词典加载与评分，再验证自有释义。
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /显示答案/ }).click();
    const nextWord = page.getByRole('button', { name: /(?:记得|忘了)，下一词/ });
    if (await nextWord.count()) await nextWord.click();
    else await page.getByRole('button', { name: /^记得/ }).click();
  }
  await expect(page.getByText('这一轮复习完成', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回单词本', exact: true }).click();
  const afterReview = await page.evaluate(() => JSON.parse(localStorage.getItem('toefl-vocab-book::guest')).cards);
  expect(afterReview.find((card) => card.word === 'apple').def).toBe('苹果');
  expect(afterReview.find((card) => card.word === 'resilient').def).toBe('坚韧的；能迅速恢复的');
  await page.getByRole('button', { name: /导出 PDF · 选择单词/ }).click();
  await page.getByRole('checkbox', { name: '选择 apple', exact: true }).check();
  await page.getByRole('checkbox', { name: '选择 resilient', exact: true }).check();
  await page.getByRole('button', { name: '预览并导出 2 词' }).click();
  await expect(page.getByRole('dialog', { name: '导出单词 PDF' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('vocab-export-desktop.png'), fullPage: true });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 PDF', exact: true }).click();
  const download = await downloadPromise;
  const pdfPath = testInfo.outputPath('selected-vocabulary.pdf'); await download.saveAs(pdfPath);
  expect(fs.readFileSync(pdfPath).subarray(0, 5).toString()).toBe('%PDF-');
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.getByRole('button', { name: '导入词表', exact: true }).click();
  await page.getByLabel('选择词表文件').setInputFiles(pdfPath);
  await expect(page.getByRole('textbox', { name: '第 1 行单词' })).toBeVisible({ timeout: 60000 });
  const words = await page.getByRole('textbox', { name: /^第 \d+ 行单词$/ }).evaluateAll((nodes) => nodes.map((node) => node.value.toLowerCase()));
  expect(words.sort()).toEqual(['apple', 'resilient']);
  await expect(page.getByRole('checkbox', { name: '导入 apple', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '导入 resilient', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '确认导入 0 个词' })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('vocab-pdf-import-desktop.png'), fullPage: true });
  expect(aiRequests).toEqual([]);
});

for (const width of [320, 390]) {
  test(`手机${width}px导入与导出窗口无横向溢出`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 }); await guestNotebook(page);
    await pastePreview(page, 'resilient\t有韧性的；能迅速恢复的\ncuriosity\t好奇心');
    await assertNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`vocab-import-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: '确认导入 2 个词' }).click();
    await expect(page.getByText('已保存 2 个新词')).toBeVisible();
    await page.getByRole('button', { name: '完成', exact: true }).click();
    await page.getByRole('button', { name: /导出 PDF · 选择单词/ }).click();
    await page.getByRole('button', { name: '全选当前筛选（2 词）' }).click();
    await page.getByRole('button', { name: '预览并导出 2 词' }).click();
    await assertNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`vocab-export-${width}.png`), fullPage: true });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '预览并导出 2 词' })).toBeFocused();
  });
}


for (const sample of [
  { file: 'vocab-two-sheets.xlsx', words: ['apple', 'banana'], meanings: ['苹果', '香蕉'] },
  { file: 'vocab-two-tables.docx', words: ['apple', 'banana', 'café'], meanings: ['苹果', '香蕉', '咖啡馆'] },
]) {
  test(`${sample.file}实际上传读取所有表格并保存`, async ({ page }, testInfo) => {
    await guestNotebook(page);
    await page.getByRole('button', { name: '导入词表', exact: true }).click();
    await page.getByLabel('选择词表文件').setInputFiles(path.resolve(__dirname, '../__tests__/fixtures', sample.file));
    await expect(page.getByRole('textbox', { name: '第 1 行单词' })).toBeVisible();
    const words = await page.getByRole('textbox', { name: /^第 \d+ 行单词$/ }).evaluateAll((nodes) => nodes.map((node) => node.value.toLowerCase()));
    expect(words).toEqual(sample.words);
    const meanings = await page.getByRole('textbox', { name: /^第 \d+ 行释义$/ }).evaluateAll((nodes) => nodes.map((node) => node.value));
    expect(meanings).toEqual(sample.meanings);
    await page.getByRole('button', { name: `确认导入 ${sample.words.length} 个词` }).click();
    await expect(page.getByText(`已保存 ${sample.words.length} 个新词`)).toBeVisible();
    await page.getByRole('button', { name: '完成', exact: true }).click();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('toefl-vocab-book::guest')).cards);
    expect(stored.map((card) => card.word).sort()).toEqual([...sample.words].sort());
    await page.screenshot({ path: testInfo.outputPath(`${sample.file}-uploaded.png`), fullPage: true });
  });
}

test('扫描PDF有文字页眉仍要求显式图片识别并可取消', async ({ page }, testInfo) => {
  const aiRequests = [];
  page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/vocab/extract-image') aiRequests.push(request.url()); });
  await guestNotebook(page);
  await page.getByRole('button', { name: '导入词表', exact: true }).click();
  const { PDFDocument, StandardFonts } = require('pdf-lib');
  const pdf = await PDFDocument.create(); const sheet = pdf.addPage([600, 800]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  sheet.drawText('TOEFL VOCABULARY NOTES', { x: 40, y: 760, size: 12, font });
  // 一张覆盖主体的光栅图：即使页眉有可选文字，也不能把它当完整词表。
  const image = await pdf.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDa0AAAAASUVORK5CYII=', 'base64'));
  sheet.drawImage(image, { x: 40, y: 80, width: 520, height: 640 });
  await page.getByLabel('选择词表文件').setInputFiles({ name: 'scan-with-header.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.getByRole('button', { name: '用 AI 识别图片', exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('textbox', { name: /^第 \d+ 行单词$/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '确认导入 0 个词' })).toBeDisabled();
  expect(aiRequests).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('vocab-scan-with-header-uploaded.png'), fullPage: true });
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('toefl-vocab-book::guest'))).toBeNull();
  expect(aiRequests).toEqual([]);
});
