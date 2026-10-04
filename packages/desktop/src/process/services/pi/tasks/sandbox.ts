import { access, mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

/** The OS applies this policy to the process and every subprocess, including build tools. */
export async function taskSandbox(
  workspace: string,
  state: string,
  sessions?: string
): Promise<{ executable: string; prefix: string[]; env: NodeJS.ProcessEnv }> {
  if (process.platform !== 'darwin') throw new Error('task_sandbox_unavailable');
  await access('/usr/bin/sandbox-exec');
  const home = join(state, 'home');
  const temp = join(state, 'tmp');
  await Promise.all([mkdir(home, { recursive: true }), mkdir(temp, { recursive: true })]);
  const writable = await Promise.all([workspace, state, ...(sessions ? [sessions] : [])].map((path) => realpath(path)));
  const policy = [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    ...writable.map((path) => `(allow file-write* (subpath ${JSON.stringify(path)}))`),
    '(allow file-write* (literal "/dev/null") (literal "/dev/tty") (subpath "/dev/fd"))',
  ].join('\n');
  return {
    executable: '/usr/bin/sandbox-exec',
    prefix: ['-p', policy],
    env: {
      HOME: home,
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
      npm_config_cache: join(home, '.npm'),
      XDG_CACHE_HOME: join(home, '.cache'),
      CLANG_MODULE_CACHE_PATH: join(home, '.clang-cache'),
    },
  };
}
