const { test, expect } = require('@playwright/test');

test.use({ channel: 'msedge' });
test.setTimeout(120000);

const result = {
  summary: '妨碍可指阻碍进展、堵住通道或干扰活动，按场景选择表达。',
  memoryTip: '进展受阻用 hinder，物理堵塞用 obstruct，打断活动用 interfere with。',
  words: [
    { word: 'hinder', partOfSpeech: 'v.', meaning: '阻碍', usage: '用于进展受到困难影响的场景', difference: '侧重拖慢进展，未必完全阻止', collocations: ['hinder progress'], example: 'Heavy rain can hinder progress.', translation: '大雨会妨碍进展。' },
    { word: 'obstruct', partOfSpeech: 'v.', meaning: '阻塞', usage: '用于道路或通道被堵住的场景', difference: '比 hinder 更突出具体阻挡', collocations: ['obstruct a road'], example: 'Do not obstruct the road.', translation: '不要堵住道路。' },
    { word: 'interfere with', partOfSpeech: 'phr.', meaning: '干扰', usage: '用于外力影响正常活动的场景', difference: '侧重干扰活动的正常运行', collocations: ['interfere with work'], example: 'Noise may interfere with work.', translation: '噪声可能干扰工作。' },
    { word: 'impede', partOfSpeech: 'v.', meaning: '妨碍', usage: '正式描述妨碍行动或发展', difference: '较正式，强调形成阻力', collocations: ['impede development'], example: 'These rules can impede development.', translation: '这些规定可能妨碍发展。' },
  ],
};

for (const width of [1440, 390]) {
  test(`中文查询、收藏、整组复习与刷新恢复 ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 980 });
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('meaning-fixture')) {
        localStorage.clear(); localStorage.setItem('toefl-user-code', 'TESTAA'); localStorage.setItem('toefl-user-tier', 'free'); localStorage.setItem('toefl-bank-update-2026-06-02', '1'); localStorage.setItem('toefl-feature-spotlight-seen', JSON.stringify({ 'my-bank-2026-07': Date.now() })); sessionStorage.setItem('meaning-fixture', 'ready');
      }
    });
    let calls = 0;
    await page.route('**/api/**', async (route) => {
      if (new URL(route.request().url()).pathname === '/api/ai') {
        calls++;
        expect(route.request().postDataJSON().userCode).toBe('TESTAA');
        expect(route.request().postDataJSON().message).toContain('妨碍');
        await route.fulfill({ json: { ok: true, content: JSON.stringify(result) } });
      } else await route.fulfill({ json: { ok: true, valid: true, code: 'TESTAA', cards: [], logs: [], tier: 'free', usage: 0 } });
    });
    await page.goto('/?section=vocab');
    await expect(page.getByRole('heading', { name: '单词本', exact: true })).toBeVisible();
    const panel = page.locator('section[aria-labelledby="meaning-explorer-title"]');
    await panel.getByRole('textbox', { name: '输入中文词或短语' }).fill('妨碍');
    await panel.getByRole('button', { name: '找英文表达' }).click();
    await expect(panel.getByRole('article', { name: 'hinder', exact: true })).toBeVisible();
    await expect(panel.getByText('侧重拖慢进展，未必完全阻止')).toBeVisible();
    await expect(panel.getByText('Heavy rain can hinder progress.', { exact: true })).toBeVisible();
    await expect(panel.getByText('大雨会妨碍进展。', { exact: true })).toBeVisible();
    await panel.getByRole('article', { name: 'hinder', exact: true }).getByRole('button', { name: '☆ 收藏', exact: true }).click();
    await expect(panel.getByRole('article', { name: 'hinder', exact: true }).getByRole('button', { name: '✓ 已收藏', exact: true })).toBeDisabled();
    await panel.getByRole('button', { name: '整组收藏', exact: true }).click();
    const cards = await page.evaluate(() => JSON.parse(localStorage.getItem('toefl-vocab-book::user:TESTAA')).cards);
    expect(cards.map((card) => card.word).sort()).toEqual(result.words.map((item) => item.word).sort());
    expect(cards.find((card) => card.word === 'interfere with').sentence).toBe('Noise may interfere with work.');
    expect(cards.every((card) => card.source === 'meaning-explorer')).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`meaning-results-${width}.png`), fullPage: true });
    await panel.screenshot({ path: testInfo.outputPath(`meaning-panel-${width}.png`) });
    await panel.getByRole('button', { name: '一起背', exact: true }).click();
    await expect(page.getByRole('button', { name: /显示答案/ })).toBeVisible();
    await page.getByRole('button', { name: /显示答案/ }).click();
    await page.getByRole('button', { name: /^记得/ }).click();
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem('toefl-vocab-book::user:TESTAA')).cards.reduce((n, card) => n + card.reps, 0))).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`meaning-review-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: /退出/ }).click();
    await expect(panel.getByRole('article', { name: 'hinder', exact: true })).toBeVisible();
    await page.reload();
    await expect(panel.getByRole('article', { name: 'interfere with', exact: true })).toBeVisible();
    await expect(panel.getByText('已保存的查询')).toBeVisible();
    expect(calls).toBe(1);
    expect(await page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('toefl-vocab-review-save')))).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}
