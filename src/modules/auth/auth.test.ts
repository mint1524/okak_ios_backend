import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { generateNumericCode, sha256 } from '../../utils/codes.js';

describe('auth utilities', () => {
  it('hashes and verifies password', async () => {
    const hash = await hashPassword('Strong1Password!');
    assert.notEqual(hash, 'Strong1Password!');
    assert.equal(await verifyPassword('Strong1Password!', hash), true);
    assert.equal(await verifyPassword('Wrong', hash), false);
  });

  it('generates numeric 6-digit code', () => {
    const code = generateNumericCode(6);
    assert.match(code, /^\d{6}$/);
  });

  it('sha256 is deterministic and hex', () => {
    const a = sha256('hello');
    const b = sha256('hello');
    assert.equal(a, b);
    assert.match(a, /^[a-f0-9]{64}$/);
  });
});
