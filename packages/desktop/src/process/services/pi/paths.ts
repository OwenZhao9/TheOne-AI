import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type PiPaths = {
  data: string;
  agent: string;
  sessions: string;
  runtime: string;
  node: string;
  cli: string;
  helper: string;
  builtinImageGenScript?: string;
};

export function piPaths(data: string, runtime: string): PiPaths {
  const agent = join(data, 'pi');
  const sessions = join(agent, 'sessions');
  mkdirSync(sessions, { recursive: true, mode: 0o700 });
  return {
    data,
    agent,
    sessions,
    runtime,
    node: join(runtime, 'node', 'bin', 'node'),
    cli: join(runtime, 'pi', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'bundle', 'cli.js'),
    helper: join(runtime, 'auth-helper.mjs'),
  };
}

/** Keep OS essentials and proxies, never inherit a terminal's model credentials. */
export function piEnvironment(paths: PiPaths): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'HOME',
    'USER',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TZ',
    'SHELL',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'no_proxy',
    'SSL_CERT_FILE',
    'NODE_EXTRA_CA_CERTS',
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.PATH = [
    join(paths.runtime, 'node', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].join(':');
  env.PI_CODING_AGENT_DIR = paths.agent;
  env.PI_OFFLINE = '1';
  env.NO_COLOR = '1';
  return env;
}

export function assertRuntime(paths: PiPaths): void {
  if (![paths.node, paths.cli, paths.helper].every(existsSync)) throw new Error('runtime_missing');
}

export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/(Bearer\s+|(?:api[_-]?key|token|authorization)["'\s:=]+)[^\s,"']+/gi, '$1[redacted]')
    .replace(/\b(sk-|ghp_|github_pat_)[A-Za-z0-9_-]+/g, '[redacted]')
    .slice(0, 1800);
}
