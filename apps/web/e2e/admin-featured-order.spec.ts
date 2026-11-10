/**
 * E2E — admin "Featured order" page.
 *
 * The e2e seed stars three ACTIVE listings (positions 1..3). The spec moves
 * the first row down with the Down button, saves, reloads and sees the same
 * order, checks the public catalog (what the homepage reads) returns that
 * order, then moves the row back and saves so the seed is left as found.
 * Dragging is not exercised here (dnd-kit's own behaviour; the Up/Down path
 * drives the same state).
 */
import { test, expect, type Page } from '@playwright/test';

const ADMIN_STATE = 'e2e/.auth/admin.json';
const API = process.env.E2E_API_URL || 'http://localhost:4000/api';

const rows = (page: Page) => page.locator('li[data-testid^="featured-row-"]');
async function titles(page: Page): Promise<string[]> {
  const all = rows(page);
  const n = await all.count();
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push((await all.nth(i).locator('p').first().textContent())?.trim() ?? '');
  return out;
}
async function ids(page: Page): Promise<string[]> {
  const all = rows(page);
  const n = await all.count();
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(((await all.nth(i).getAttribute('data-testid')) ?? '').replace('featured-row-', ''));
  return out;
}
async function waitForList(page: Page) {
  const loaded = page.waitForResponse((r) => r.request().method() === 'GET' && r.url().includes('/admin/activities/featured'));
  await page.goto('/admin/activities/featured');
  await loaded;
  await expect(page.getByRole('heading', { name: 'Featured order' }).first()).toBeVisible();
  // Rows render after the response lands; without this a count taken too early reads 0.
  await rows(page).first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => { /* empty list: the test skips below */ });
}
async function save(page: Page) {
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/admin/activities/featured/order'));
  await page.getByRole('button', { name: 'Save order' }).click();
  const res = await saved;
  expect(res.status()).toBe(200);
  await expect(page.getByText('Order saved. The homepage shows the new order within a few minutes.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save order' })).toBeDisabled();
}

test.describe('Admin featured order', () => {
  test.use({ storageState: ADMIN_STATE });

  test('happy: move with Down, save, reload and see the same order; the catalog follows; then put it back', async ({ page }) => {
    await waitForList(page);
    const before = await titles(page);
    test.skip(before.length < 2, 'fewer than two featured listings in the seed');
    await expect(page.getByRole('button', { name: 'Save order' })).toBeDisabled();

    // Move #1 down → #2.
    await page.getByRole('button', { name: `Move "${before[0]}" down` }).click();
    await expect(page.getByRole('button', { name: 'Save order' })).toBeEnabled();
    expect(await titles(page)).toEqual([before[1], before[0], ...before.slice(2)]);
    await save(page);

    // Reload: the saved order comes back from the server.
    await waitForList(page);
    const afterReload = await titles(page);
    expect(afterReload).toEqual([before[1], before[0], ...before.slice(2)]);
    const orderedIds = await ids(page);

    // The public catalog (what the homepage row reads) returns the same order,
    // for the listings it shows (ACTIVE, active vendor).
    const res = await page.request.get(`${API}/catalog/activities?featured=true&limit=20`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    const catalogIds = body.data.map((a) => a.id).filter((id) => orderedIds.includes(id));
    expect(catalogIds).toEqual(orderedIds.filter((id) => catalogIds.includes(id)));

    // Put it back so other specs and later runs see the seed order.
    await page.getByRole('button', { name: `Move "${before[0]}" up` }).click();
    expect(await titles(page)).toEqual(before);
    await save(page);
    await waitForList(page);
    expect(await titles(page)).toEqual(before);
  });

  test('happy: the Activities page links to the Featured order page, and the sidebar lists it', async ({ page }) => {
    await page.goto('/admin/activities');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: 'Arrange featured' }).click();
    await expect(page).toHaveURL(/\/admin\/activities\/featured$/);
    await expect(page.getByRole('heading', { name: 'Featured order' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Featured order' }).first()).toBeVisible();
  });

  test('error: nothing is saved when the page is only visited', async ({ page }) => {
    let puts = 0;
    page.on('request', (r) => { if (r.method() === 'PUT' && r.url().includes('/featured/order')) puts++; });
    await waitForList(page);
    await expect(page.getByRole('button', { name: 'Save order' })).toBeDisabled();
    expect(puts).toBe(0);
  });
});
