import { randomBytes, createHash } from 'node:crypto';

export function generateNumericCode(length = 6): string {
  let result = '';
  const buf = randomBytes(length);
  for (const byte of buf) {
    result += String(byte % 10);
  }
  return result;
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
