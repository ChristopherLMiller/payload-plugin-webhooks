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

test('webhook endpoint form guides setup, previews, tests and logs requests', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await login(page)
  await page.goto('/admin/collections/webhook-endpoints/create')

  // Setup guide is open on a new endpoint, with per-site instructions.
  const guide = page.locator('details', { hasText: 'How to set up a webhook' })
  await expect(guide).toHaveAttribute('open', '')
  await expect(guide.getByRole('cell', { name: 'Home Assistant' })).toBeVisible()

  // Test button explains it needs a saved endpoint.
  await expect(page.getByRole('button', { name: 'Send test request' })).toBeDisabled()
  await expect(page.getByText('Save the endpoint first')).toBeVisible()

  // Conditional auth fields.
  await expect(page.locator('#field-authentication__token')).toHaveCount(0)
  await page.locator('#field-authentication__type').click()
  await page.getByText('Bearer token (Authorization: Bearer …)', { exact: true }).click()
  await expect(page.locator('#field-authentication__token')).toBeVisible()

  // Fill in the endpoint; the preview follows the form.
  await page.fill('#field-name', 'Missing page')
  await page.fill('#field-url', 'http://localhost:3000/api/does-not-exist')
  await page.fill('#field-authentication__token', 'abc')
  await page.locator('#field-events__collections').click()
  await page.locator('#field-events__collections .rs__option', { hasText: /^Posts$/ }).click()

  const preview = page.locator('pre', { hasText: 'X-Webhook-Event' })
  await expect(preview).toContainText('POST http://localhost:3000/api/does-not-exist')
  await expect(preview).toContainText('Authorization: Bearer <token>')
  await expect(preview).toContainText('"event": "posts.update"')

  await page.screenshot({ fullPage: true, path: 'test-results/webhook-endpoint-form.png' })

  // Save, then test: the 404 is reported with what to check.
  await page.click('#action-save')
  await expect(page).toHaveURL(/webhook-endpoints\/(?!create)[^/]+$/)
  const testButton = page.getByRole('button', { name: 'Send test request' })
  await expect(testButton).toBeEnabled()
  await testButton.click()
  const result = page.getByRole('status', { name: 'Test request result' })
  await expect(result).toContainText('Failed — HTTP 404')
  await expect(result).toContainText('Nothing exists at this URL')

  await page.screenshot({ fullPage: true, path: 'test-results/webhook-endpoint-tested.png' })

  // The request shows up in the endpoint's delivery log.
  await page.getByRole('button', { name: 'Delivery log' }).click()
  await expect(page.getByRole('cell', { name: 'webhook.test', exact: true })).toBeVisible()
  await page.screenshot({ fullPage: true, path: 'test-results/webhook-endpoint-log.png' })

  expect(errors).toEqual([])
})
