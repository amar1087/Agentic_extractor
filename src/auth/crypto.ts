import crypto from 'crypto';

// ENCRYPTION_KEY must be a 32-byte key, hex-encoded (64 hex chars).
// Generate one with:  openssl rand -hex 32
const KEY = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'hex');

if (KEY.length !== 32) {
  throw new Error(
    'ENCRYPTION_KEY must be a 32-byte (64 hex char) value. Generate one with: openssl rand -hex 32'
  );
}

const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypts a plaintext string (e.g. an OAuth refresh token).
 * Returns a single string safe to store in the database:
 *   base64(iv) . base64(authTag) . base64(ciphertext)
 */
export async function encrypt(plaintext: string): Promise<string> {
  const iv = crypto.randomBytes(12); // 96-bit IV, standard for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

/**
 * Decrypts a string produced by encrypt() back into the original plaintext.
 */
export async function decrypt(encoded: string): Promise<string> {
  const [ivB64, authTagB64, ciphertextB64] = encoded.split('.');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted value');
  }

  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}