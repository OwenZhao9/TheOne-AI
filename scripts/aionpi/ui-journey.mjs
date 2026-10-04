// Exercises the real desktop and Pi with a local transport fixture, never real-model acceptance.
import { _electron as electron, expect } from 'playwright/test';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fixtureServer } from '../../tests/integration/pi/fixtureServer.ts';

const root = resolve(import.meta.dirname, '../..');
const data = await mkdtemp(join(tmpdir(), 'aionpi-ui-journey-'));
const project = join(data, 'project');
await mkdir(project);
await writeFile(join(project, 'hello.txt'), 'before tools');
execFileSync('/usr/bin/git', ['init', '-q'], { cwd: data });
execFileSync('/usr/bin/git', ['add', 'project/hello.txt'], { cwd: data });
const output = join(root, 'output/playwright');
await mkdir(output, { recursive: true });
const server = await fixtureServer();
const launch = {
  cwd: process.env.AIONPI_TEST_APP ? data : root,
  env: { ...process.env, AIONPI_TEST_DATA: join(data, 'data') },
  timeout: 30000,
};
const options = process.env.AIONPI_TEST_APP
  ? { ...launch, executablePath: process.env.AIONPI_TEST_APP, args: [] }
  : { ...launch, args: ['.'] };
let app;
const errors = [];
async function window() {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.getByTestId('pi-settings').waitFor({ timeout: 30000 });
  return page;
}
async function send(page, text) {
  await page.getByTestId('pi-composer').fill(text);
  await page.getByTestId('pi-send').click();
}
try {
  app = await electron.launch(options);
  let page = await window();
  const created = await page.evaluate((cwd) => window.aionPi.invoke('create', { cwd }), project);
  await page
    .getByRole('button', { name: /新对话/ })
    .last()
    .click();
  await send(page, 'Hello');
  await expect(page.getByTestId('pi-error')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('pi-composer')).toHaveValue('Hello');
  await page.getByTestId('pi-settings').click();
  console.log('settings opened');
  const provider = page.getByTestId('pi-provider').locator('input');
  await provider.fill('aionpi-fixture');
  await provider.press('Enter');
  console.log('provider selected');
  await page.getByTestId('pi-api-key').fill('local-fixture');
  await page.getByTestId('pi-service-url').fill(server.url);
  await page.getByTestId('pi-custom-model').fill('fixture');
  await page.getByTestId('pi-save-connection').click();
  await expect(page.getByTestId('pi-test-connection')).toBeEnabled({ timeout: 30000 });
  await page.getByTestId('pi-test-connection').click();
  await expect(page.getByTestId('pi-test-reply')).toContainText('Fixture reply: Hello', { timeout: 30000 });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem('pi.selected')), created.conversation.id);
  await send(page, 'Hello');
  await expect(page.getByTestId('pi-messages')).toContainText('Fixture reply: Hello', { timeout: 30000 });
  await expect(page.getByTestId('pi-fork').last()).toBeVisible();
  await page.getByRole('button', { name: 'hello.txt', exact: true }).click();
  await expect(page.getByTestId('pi-preview')).toContainText('before tools');
  await send(page, 'TOOLS 中文文件测试');
  await expect(page.getByTestId('pi-message-toolResult')).toHaveCount(3, { timeout: 30000 });
  await expect(page.getByTestId('pi-preview')).toContainText('edited version', { timeout: 30000 });
  await expect(page.getByTestId('pi-fork').last()).toBeVisible();
  assert.equal(await readFile(join(project, 'hello.txt'), 'utf8'), 'edited version');
  await page.getByRole('tab', { name: '改动', exact: true }).click();
  await page.getByRole('button', { name: /hello.txt/ }).click();
  await expect(page.getByTestId('pi-preview')).toContainText('+edited version');
  await page.getByRole('tab', { name: '文件', exact: true }).click();
  await page.getByRole('button', { name: 'hello.txt', exact: true }).click();
  await expect(page.getByTestId('pi-preview')).toHaveText('edited version');
  await page.screenshot({ path: join(output, 'aionpi-tool-journey.png') });
  const count = await page.getByTestId('pi-message-assistant').count();
  await page.reload();
  await expect(page.getByTestId('pi-message-assistant')).toHaveCount(count);
  await page.getByTestId('pi-fork').last().click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('pi.selected'))).not.toBe(created.conversation.id);
  const forkId = await page.evaluate(() => localStorage.getItem('pi.selected'));
  await send(page, 'HTTP_FAIL 中文保留输入');
  await expect(page.getByTestId('pi-error')).toContainText('Fixture credential rejected', { timeout: 30000 });
  await expect(page.getByTestId('pi-composer')).toHaveValue('HTTP_FAIL 中文保留输入');
  await send(page, 'WAIT');
  await expect(page.getByTestId('pi-stop')).toBeVisible({ timeout: 30000 });
  await send(page, '追加指令');
  await expect(page.getByText('待处理消息', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '撤回到输入框', exact: true }).click();
  await expect(page.getByTestId('pi-composer')).toHaveValue('追加指令');
  await page.getByTestId('pi-stop').click();
  await expect(page.getByTestId('pi-stop')).toBeHidden({ timeout: 30000 });
  await page.getByTestId('pi-composer').fill('重启后保留的草稿');
  await app.close();
  app = await electron.launch(options);
  page = await window();
  await expect(page.getByTestId('pi-composer')).toHaveValue('重启后保留的草稿');
  assert.equal(await page.evaluate(() => localStorage.getItem('pi.selected')), forkId);
  assert.equal((await page.evaluate(() => window.aionPi.invoke('list', undefined))).length, 2);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      result: 'passed',
      transport: 'local fixture only',
      data,
      checks: [
        'retry same draft after initial configuration',
        'settings form',
        'connection test',
        'real Pi tools',
        'preview refresh',
        'renderer reload',
        'fork',
        'rejected credentials preserve input',
        'steer',
        'queue return',
        'stop',
        'app restart',
        'draft persistence',
      ],
    })
  );
} finally {
  if (app) await app.close();
  await server.close();
}
