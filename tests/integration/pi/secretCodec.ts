import type { SecretCodec } from '@/process/extensions/automation';

/** Tests use isolated temporary folders; production uses Electron safeStorage. */
export const testSecretCodec: SecretCodec = {
  seal: (value) => Buffer.from(value, 'utf8').toString('base64'),
  open: (value) => Buffer.from(value, 'base64').toString('utf8'),
};
