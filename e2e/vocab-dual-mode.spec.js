const { test, expect } = require('@playwright/test');

test.use({ channel: 'msedge', actionTimeout: 30000 });
test.setTimeout(120000);
const transcript = 'The seminar will focus on photosynthesis in arid climates.';

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
async function cards(page, account = 'guest') {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(`toefl-vocab-book::${key}`) || '{"cards":[]}').cards, account);
}
async function selectWord(page) {
  const host = page.getByText(transcript, { exact: true });
  await host.scrollIntoViewIfNeeded();
  // 使用真实原文节点和真实选区触发 WordLookupLayer，不复刻弹窗。
  await host.evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let text;
    while ((text = walker.nextNode())) {
      const start = text.textContent.indexOf('photosynthesis');
      if (start < 0) continue;
      const range = document.createRange(); range.setStart(text, start); range.setEnd(text, start + 14);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      break;
    }
  });
  await expect(page.getByRole('group', { name: '选择复习类型' })).toBeVisible();
  await expect(page.getByRole('button', { name: '阅读词', exact: true })).toBeEnabled();
}

for (const width of [1400, 390]) {
  test(`真实划词双选、刷新、分轨评分和词库去重 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 980 });
    await page.addInitScript(({ transcript }) => {
      if (!sessionStorage.getItem('vocab-dual-guest')) {
        localStorage.clear(); sessionStorage.setItem('vocab-dual-guest', 'ready');
        localStorage.setItem('toefl-hist', JSON.stringify({ sessions: [{
          id: 'dual-session', type: 'listening', mode: 'practice', date: new Date().toISOString(), correct: 1, total: 1,
          details: { subtype: 'lat', topic: '双轨测试', transcript,
            questions: [{ stem: 'What is the seminar about?', options: { A: 'Plants', B: 'Buildings' }, answer: 'A' }],
            results: [{ selected: 'A', correct: 'A', isCorrect: true }] },
        }] }));
      }
      window.__spokenWords = [];
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => [{ name: 'English fixture', lang: 'en-US' }], cancel() {},
        speak(utterance) { window.__spokenWords.push(utterance.text); setTimeout(() => { utterance.onstart?.(); utterance.onend?.(); }, 20); },
      } });
    }, { transcript });
    const pronunciation = [];
    await page.route('**/api/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/vocab/pronunciation') {
        pronunciation.push(url.searchParams.get('word'));
        await route.fulfill({ status: 503, json: { ok: false } });
      } else await route.fulfill({ json: { ok: true, cards: [], logs: [] } });
    });
    await page.goto('/listening/progress');
    await page.getByRole('button', { name: /听讲座.*双轨测试/ }).click();
    await selectWord(page);
    const modes = page.getByRole('group', { name: '选择复习类型' });
    await modes.getByRole('button', { name: '阅读词', exact: true }).click();
    await expect(modes.getByRole('button', { name: '阅读词', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(modes.getByRole('button', { name: '听力词', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '收藏到单词本', exact: true }).click();
    expect(await cards(page)).toHaveLength(1);
    expect((await cards(page))[0]).toMatchObject({ word: 'photosynthesis', reviewMode: 'both' });
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`dual-popup-${width}.png`), fullPage: true });
    await page.reload();
    await page.getByRole('button', { name: /听讲座.*双轨测试/ }).click();
    await selectWord(page);
    await expect(modes.getByRole('button', { name: '阅读词', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(modes.getByRole('button', { name: '听力词', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/?section=vocab');
    await expect(page.getByRole('heading', { name: '单词本', exact: true })).toBeVisible();
    await expect(page.locator('section[aria-labelledby="vn-added-title"]')).toContainText('今日新增 1 词');
    await expect(page.getByText('其中 1 词同时练阅读和听力', { exact: true })).toBeVisible();
    await expect(page.getByText('今日复习 2 项', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'photosynthesis 更多操作' }).click();
    await expect(page.getByRole('combobox', { name: 'photosynthesis复习类型' })).toHaveValue('both');
    await page.getByRole('switch', { name: 'photosynthesis需要会写' }).click();
    await page.getByRole('button', { name: /^阅读复习，今天 1 个词/ }).click();
    await page.getByRole('button', { name: /显示答案/ }).click();
    await page.getByRole('button', { name: /^记得/ }).click();
    await expect.poll(async () => (await cards(page))[0].reps).toBe(1);
    expect((await cards(page))[0].listeningState.reps).toBe(0);
    const reading = (await cards(page))[0];
    await page.getByRole('button', { name: /退出|返回单词本/ }).click();
    await expect(page.getByText('今天的任务完成了', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /^听力复习，今天 1 个词/ }).click();
    await expect(page.getByRole('button', { name: '显示答案', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '显示答案', exact: true }).click();
    await expect(page.getByText(transcript, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '听懂了', exact: true }).click();
    await expect.poll(async () => (await cards(page))[0].listeningState.reps).toBe(1);
    const stored = (await cards(page))[0];
    expect(stored.reps).toBe(reading.reps); expect(stored.due).toBe(reading.due); expect(stored.reviewMode).toBe('both');
    expect(await page.evaluate(() => window.__spokenWords.every((word) => word === 'photosynthesis'))).toBe(true);
    expect(pronunciation.length).toBeGreaterThan(0); expect(pronunciation.every((word) => word === 'photosynthesis')).toBe(true);
    await noOverflow(page);
    await page.getByRole('button', { name: /退出|返回单词本/ }).click();
    await expect(page.getByRole('region', { name: '词库列表' }).getByRole('button', { name: /更多操作$/ })).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath(`dual-notebook-${width}.png`), fullPage: true });
  });

  test(`词根、中文找词和词表导入双轨 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 980 });
    await page.addInitScript(() => {
      if (sessionStorage.getItem('dual-explorer-fixture')) return;
      localStorage.clear(); sessionStorage.setItem('dual-explorer-fixture', 'ready');
      localStorage.setItem('toefl-user-code', 'TESTAA'); localStorage.setItem('toefl-user-tier', 'free');
      localStorage.setItem('toefl-bank-update-2026-06-02', '1');
      localStorage.setItem('toefl-feature-spotlight-seen', JSON.stringify({ 'my-bank-2026-07': Date.now() }));
    });
    await page.route('**/api/**', async (route) => {
      if (new URL(route.request().url()).pathname === '/api/ai') {
        const meaning = route.request().postDataJSON().message.includes('妨碍');
        const payload = meaning ? { summary: '描述进展受到阻碍', memoryTip: '先看是否完全阻止：hinder 拖慢进展，prevent 阻止发生。', words: [
          { word: 'hinder', partOfSpeech: 'v.', meaning: '妨碍', usage: '进展受阻', difference: '拖慢进展', collocations: ['hinder progress'], example: 'Noise can hinder progress.', translation: '噪声会妨碍进展。' },
          { word: 'prevent', partOfSpeech: 'v.', meaning: '阻止', usage: '事件发生前采取行动', difference: '强调阻止发生', collocations: ['prevent errors'], example: 'We prevent errors.', translation: '我们防止错误发生。' },
        ] }
          : { rootMeaning: '组织', words: [{ word: 'organism', partOfSpeech: 'n.', meaning: '生物体', formation: 'organ + ism', difference: '完整生物' }] };
        await route.fulfill({ json: { ok: true, content: JSON.stringify(payload) } });
      } else await route.fulfill({ json: { ok: true, valid: true, code: 'TESTAA', cards: [], logs: [], tier: 'free', usage: 0 } });
    });
    await page.goto('/?section=vocab');
    const root = page.locator('section[aria-labelledby="root-explorer-title"]');
    await root.getByRole('textbox', { name: '输入词根' }).fill('organ');
    await root.getByRole('button', { name: '查词根' }).click();
    const rootModes = root.getByRole('group', { name: 'organism 复习类型' });
    await rootModes.getByRole('button', { name: '听力词' }).click();
    await expect(rootModes.getByRole('button', { name: '阅读词' })).toHaveAttribute('aria-pressed', 'true');
    await root.getByRole('button', { name: '收藏', exact: true }).click();
    const meaning = page.locator('section[aria-labelledby="meaning-explorer-title"]');
    await meaning.getByRole('textbox', { name: '输入中文词或短语' }).fill('妨碍');
    await meaning.getByRole('button', { name: '找英文表达' }).click();
    await meaning.getByRole('button', { name: '听力词', exact: true }).click();
    await expect(meaning.getByRole('button', { name: '一起背阅读词' })).toBeVisible();
    await expect(meaning.getByRole('button', { name: '一起背听力词' })).toBeVisible();
    await meaning.getByRole('button', { name: '整组收藏', exact: true }).click();
    await page.getByRole('button', { name: '导入词表', exact: true }).click();
    await page.getByRole('textbox', { name: '或粘贴词表' }).fill('resilient\t有韧性的');
    await page.getByRole('button', { name: '预览粘贴的词表' }).click();
    await page.getByRole('combobox', { name: '加入哪类复习' }).selectOption('both');
    await noOverflow(page);
    await page.getByRole('button', { name: '确认导入 1 个词' }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('已保存 1 个新词');
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('阅读和听力复习（进度分别记录）');
    await page.getByRole('button', { name: '完成', exact: true }).click();
    const stored = await cards(page, 'user:TESTAA'); expect(stored).toHaveLength(4); expect(stored.every((card) => card.reviewMode === 'both')).toBe(true);
    await expect(page.locator('section[aria-labelledby="vn-added-title"]')).toContainText('今日新增 4 词');
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`dual-explorers-${width}.png`), fullPage: true });
  });
}
