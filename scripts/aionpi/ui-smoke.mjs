import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '../..');
const data = await mkdtemp(join(tmpdir(), 'aionpi-ui-test-'));
const project = join(data, 'project');
await mkdir(project);
await writeFile(join(project, 'hello.txt'), 'TheOne preview verification\n你好');
const output = join(root, 'output/playwright');
await mkdir(output, { recursive: true });
const launch = {
  cwd: root,
  env: { ...process.env, AIONPI_TEST_DATA: join(data, 'data'), ELECTRON_ENABLE_LOGGING: '1' },
  timeout: 30000,
};
const app = await electron.launch(
  process.env.AIONPI_TEST_APP
    ? { ...launch, executablePath: process.env.AIONPI_TEST_APP, args: [] }
    : { ...launch, args: ['.'] }
);
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 250));
  });
  await page.getByTestId('pi-settings').waitFor({ timeout: 30000 });
  assert.equal(await page.title(), 'TheOne');
  assert.equal(await app.evaluate(({ app }) => app.getName()), 'TheOne');
  await page.getByTestId('pi-configure').waitFor();
  await page.screenshot({ path: join(output, 'aionpi-home.png') });
  console.log('HOME', (await page.locator('body').innerText()).slice(0, 800));
  await page.getByTestId('pi-settings').click();
  await page.getByTestId('pi-provider').waitFor();
  await page.getByText('Computer Use（电脑操作）', { exact: true }).waitFor();
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="pi-computer-status"]')?.textContent?.includes('正在加载')
  );
  await page.screenshot({ path: join(output, 'aionpi-settings.png'), animations: 'disabled' });
  await page.getByText('Jev 决策检查', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, 'aionpi-automation-settings.png'), animations: 'disabled' });
  const catalog = await page.evaluate(() => window.aionPi.invoke('catalog', undefined));
  assert(catalog.providers.length > 0);
  assert(!catalog.providers.some((provider) => provider.configured));
  assert(await page.getByTestId('pi-test-connection').isDisabled());
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByTestId('pi-provider').waitFor({ state: 'hidden' });
  const created = await page.evaluate((cwd) => window.aionPi.invoke('create', { cwd }), project);
  const conversations = await page.evaluate(() => window.aionPi.invoke('list', undefined));
  assert(conversations.some((conversation) => conversation.id === created.conversation.id));
  console.log(
    JSON.stringify({
      providers: catalog.providers.length,
      models: catalog.models.length,
      conversationId: created.conversation.id,
      errors,
      consoleErrors,
      data,
    })
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleErrors, []);
} finally {
  await app.close();
}
