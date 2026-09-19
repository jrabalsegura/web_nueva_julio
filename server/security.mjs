import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('hex');

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64, options);
  return `scrypt:${salt}:${hash.toString('hex')}`;
}

export function validPasswordHash(hash) {
  return /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash || '');
}

export async function verifyPassword(password, encoded) {
  if (!validPasswordHash(encoded)) return false;
  const [, salt, expected] = encoded.split(':');
  const hash = await scrypt(password, salt, 64, options);
  return timingSafeEqual(hash, Buffer.from(expected, 'hex'));
}

export function equalSecret(a, b) {
  return typeof a === 'string' && typeof b === 'string' && timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
}
