import crypto from 'crypto';

// Encryption key should be stored in environment variable
// If not set, generate a warning but allow fallback (for development)
const ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypts an API key using AES-256-GCM
 * Returns a base64-encoded string containing IV + authTag + encryptedData
 */
export function encryptApiKey(apiKey: string): string {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('API key cannot be empty');
  }

  // Ensure encryption key is 32 bytes (256 bits)
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(apiKey, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  const authTag = cipher.getAuthTag();

  // Combine IV + authTag + encrypted data
  const combined = Buffer.concat([iv, authTag, encrypted]);
  
  return combined.toString('base64');
}

/**
 * Decrypts an encrypted API key
 * Expects base64-encoded string containing IV + authTag + encryptedData
 */
export function decryptApiKey(encryptedApiKey: string): string {
  if (!encryptedApiKey || encryptedApiKey.trim().length === 0) {
    throw new Error('Encrypted API key cannot be empty');
  }

  // Ensure encryption key is 32 bytes (256 bits)
  const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
  
  const combined = Buffer.from(encryptedApiKey, 'base64');
  
  // Extract IV, authTag, and encrypted data
  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return decrypted.toString('utf8');
}
