import { expect, type Page, test } from '@playwright/test'

const login = async (page: Page) => {
  await page.goto('/admin')
  // On a cold `next dev` the form can render before it hydrates; wait so the submit is handled.
  await page.waitForLoadState('networkidle')
  await page.fill('#field-email', 'dev@payloadcms.com')
  await page.fill('#field-password', 'test')
  await page.click('.form-submit button')
  await expect(page).toHaveTitle(/Dashboard/, { timeout: 30_000 })
}

// this is an example Playwright e2e test
test('should render admin panel logo', async ({ page }) => {
  await login(page)
  await expect(page.locator('.graphic-icon')).toBeVisible()
})

test('renders the webhook endpoint form with conditional auth fields', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await login(page)

  await page.goto('/admin/collections/webhook-endpoints/create')
  await expect(page.locator('#field-url')).toBeVisible()
  await expect(page.locator('#field-name')).toBeVisible()
  await expect(page.locator('#field-authentication__token')).toHaveCount(0)

  await page.locator('#field-authentication__type').click()
  await page.getByText('Bearer token', { exact: true }).click()
  await expect(page.locator('#field-authentication__token')).toBeVisible()

  await page.screenshot({ fullPage: true, path: 'test-results/webhook-endpoint-form.png' })
  expect(errors).toEqual([])
})
