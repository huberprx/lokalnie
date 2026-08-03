import { describe, expect, it } from "vitest";
import { decryptPhone, encryptPhone, isEncryptedPhone } from "../src/pii.js";

describe("phone PII encryption", () => {
  const env = { PII_ENCRYPTION_KEY: "unit-test-pii-key" };

  it("round-trips a phone number", async () => {
    const sealed = await encryptPhone("+48 501 234 567", env);
    expect(isEncryptedPhone(sealed)).toBe(true);
    expect(sealed).not.toContain("501");
    expect(await decryptPhone(sealed, env)).toBe("+48 501 234 567");
  });

  it("uses a fresh IV so ciphertext differs", async () => {
    const a = await encryptPhone("+48111222333", env);
    const b = await encryptPhone("+48111222333", env);
    expect(a).not.toBe(b);
    expect(await decryptPhone(a, env)).toBe("+48111222333");
    expect(await decryptPhone(b, env)).toBe("+48111222333");
  });

  it("passes through legacy plaintext", async () => {
    expect(await decryptPhone("+48 600 100 200", env)).toBe("+48 600 100 200");
  });

  it("does not double-encrypt", async () => {
    const once = await encryptPhone("+48123456789", env);
    const twice = await encryptPhone(once, env);
    expect(twice).toBe(once);
  });

  it("stores plaintext when key is missing", async () => {
    expect(await encryptPhone("+48111000000", {})).toBe("+48111000000");
  });

  it("returns null for empty values", async () => {
    expect(await encryptPhone("", env)).toBeNull();
    expect(await encryptPhone(null, env)).toBeNull();
    expect(await decryptPhone(null, env)).toBeNull();
  });
});
