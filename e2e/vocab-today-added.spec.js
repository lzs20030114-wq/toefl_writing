const { test, expect } = require('@playwright/test');

test.use({ channel: 'msedge' });
test.setTimeout(120000);

for (const width of [1440, 390]) {
  test(`今日新增独立板块、组合筛选与最近收藏 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 980 });
    await page.addInitScript(() => {
      if (sessionStorage.getItem('today-added-fixture')) return;
      const now = new Date();
      const today = (hour, minute = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute).toISOString();
      const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59).toISOString();
      const future = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5).toISOString();
      localStorage.clear();
      localStorage.setItem('toefl-user-code', 'TESTAA');
      localStorage.setItem('toefl-user-tier', 'free');
      localStorage.setItem('toefl-bank-update-2026-06-02', '1');
      localStorage.setItem('toefl-feature-spotlight-seen', JSON.stringify({ 'my-bank-2026-07': Date.now() }));
      localStorage.setItem('toefl-vocab-book::user:TESTAA', JSON.stringify({ v: 1, cards: [
        { word: 'learned', def: 'adj. 已学', createdAt: today(0), state: 'review', reps: 2, stability: 8, lastReview: today(0), due: future },
        { word: 'paused', def: 'adj. 暂停', createdAt: today(0, 1), suspended: true },
        { word: 'heard', def: 'adj. 听过', createdAt: today(0, 2), reviewMode: 'listening' },
        { word: 'yesterday', def: 'n. 昨天', createdAt: yesterday, updatedAt: now.toISOString() },
        { word: 'deleted', def: 'adj. 删除', createdAt: today(0, 3), deletedAt: now.toISOString() },
      ] }));
      sessionStorage.setItem('today-added-fixture', 'ready');
    });
    await page.route('**/api/**', (route) => route.fulfill({ json: { ok: true, valid: true, code: 'TESTAA', cards: [], logs: [], tier: 'free', usage: 0 } }));
    await page.goto('/?section=vocab');
    await expect(page.getByRole('heading', { name: '单词本', exact: true })).toBeVisible();
    const panel = page.locator('section[aria-labelledby="vn-added-title"]');
    const library = page.getByRole('region', { name: '词库列表' });
    const chips = page.getByRole('group', { name: '状态筛选' });
    const modes = page.getByRole('group', { name: '词表类型' });
    const search = page.getByRole('textbox', { name: '搜索单词或释义' });
    const shown = () => library.getByRole('button', { name: /更多操作$/ }).evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label').replace(' 更多操作', '')));
    await expect(panel).toContainText('今日新增 3 词');
    await expect(panel).toContainText('阅读 2 · 听力 1');
    await expect(page.getByRole('button', { name: 'deleted 更多操作' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`today-added-overview-${width}.png`), fullPage: true });
    await search.fill('yesterday');
    await modes.getByRole('button', { name: '听力', exact: true }).click();
    await panel.getByRole('button', { name: '查看今日新增' }).click();
    await expect(search).toHaveValue('');
    await expect(page.getByRole('combobox', { name: '排序方式' })).toHaveValue('recent');
    await expect(chips.getByRole('button', { name: /^今日新增/ })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(shown).toEqual(['heard', 'paused', 'learned']);
    await modes.getByRole('button', { name: '阅读', exact: true }).click();
    await expect(chips.getByRole('button', { name: /^今日新增/ })).toContainText('今日新增2');
    await expect.poll(shown).toEqual(['paused', 'learned']);
    await search.fill('暂停');
    await expect.poll(shown).toEqual(['paused']);
    await modes.getByRole('button', { name: '听力', exact: true }).click();
    await expect(library).toContainText('今日新增中没有符合当前类型或搜索条件的单词');
    await search.fill('听过');
    await expect.poll(shown).toEqual(['heard']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`today-added-filtered-${width}.png`), fullPage: true });
  });
}
