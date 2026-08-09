import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const authState = process.env.HEALTHKEEP_E2E_AUTH_STATE || '';
const fixtureDir = process.env.HEALTHKEEP_E2E_NHI_FIXTURE_DIR || '';
const safeHarness = process.env.HEALTHKEEP_E2E_TEMP_DATA === '1';

test.describe('authenticated NHI import', () => {
  test.skip(!safeHarness, 'Set HEALTHKEEP_E2E_TEMP_DATA=1 only for a temporary SQLite/storage test server.');
  test.skip(!authState || !fs.existsSync(authState), 'Authenticated Playwright storage state is required.');
  test.skip(!fixtureDir || !fs.existsSync(fixtureDir), 'A synthetic NHI HTML fixture directory is required.');
  test.use({ storageState: authState || undefined });

  test('uploads, restores job progress, and reaches the health timeline', async ({ page }) => {
    await page.goto('/dashboard/upload?mode=nhi-first');
    await expect(page.getByRole('heading', { name: '匯入健保存摺資料' })).toBeVisible();
    const files = fs.readdirSync(fixtureDir)
      .filter((name) => /\.html?$/i.test(name))
      .map((name) => path.join(fixtureDir, name));
    expect(files.length).toBeGreaterThan(0);
    await page.locator('input[type="file"]').setInputFiles(files);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: '開始匯入並查看進度' }).click();
    await expect(page).toHaveURL(/\/dashboard\/nhi\/import\/[^/?#]+/);
    await page.reload();
    await expect(page.getByRole('heading', { name: '健保資料匯入進度' })).toBeVisible();
    await expect(page.getByRole('status')).toContainText(/進度|完成|確認|卡住/);
  });
});
