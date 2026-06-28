/**
 * Credentials encryption module — AES-256-GCM + PBKDF2
 *
 * credentials.yaml encryption scheme:
 * - User master password derives a 256-bit key via PBKDF2
 * - Credential content is encrypted with AES-256-GCM
 * - Encrypted format: first line `# ENCRYPTED\n`, followed by base64(salt:iv:authTag:ciphertext)
 */

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from 'crypto'

const PBKDF2_ITERATIONS = 100_000
const KEY_LENGTH = 32 // 256 bits
const SALT_LENGTH = 32
const IV_LENGTH = 12 // GCM recommended 12 bytes
const AUTH_TAG_LENGTH = 16
const ENCRYPTED_MARKER = '# ENCRYPTED'

/**
 * Derive AES-256 key from master password via PBKDF2
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256')
}

/**
 * AES-256-GCM encryption
 *
 * Returns format: `base64(salt):base64(iv):base64(authTag):base64(ciphertext)`
 */
export function encrypt(plaintext: string, password: string): string {
  const salt = randomBytes(SALT_LENGTH)
  const key = deriveKey(password, salt)
  const iv = randomBytes(IV_LENGTH)

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    salt.toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':')
}

/**
 * AES-256-GCM decryption
 *
 * Input format: `base64(salt):base64(iv):base64(authTag):base64(ciphertext)`
 */
export function decrypt(encrypted: string, password: string): string {
  const parts = encrypted.split(':')
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format (expected salt:iv:authTag:ciphertext in four parts)')
  }

  const salt = Buffer.from(parts[0], 'base64')
  const iv = Buffer.from(parts[1], 'base64')
  const authTag = Buffer.from(parts[2], 'base64')
  const ciphertext = Buffer.from(parts[3], 'base64')

  const key = deriveKey(password, salt)

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString('utf8')
  } catch {
    throw new Error('Decryption failed: incorrect master password or data has been tampered with')
  }
}

/**
 * Check whether credentials.yaml content is already encrypted
 */
export function isEncrypted(content: string): boolean {
  return content.trimStart().startsWith(ENCRYPTED_MARKER)
}

/**
 * Encrypt credential file content
 *
 * Returns: first line `# ENCRYPTED`, followed by the encrypted base64 string
 */
export function encryptCredentials(yamlContent: string, password: string): string {
  const encrypted = encrypt(yamlContent, password)
  return `${ENCRYPTED_MARKER}\n${encrypted}\n`
}

/**
 * Decrypt credential file content
 *
 * Input: first line `# ENCRYPTED`, followed by encrypted string
 * Returns: original YAML content
 */
export function decryptCredentials(fileContent: string, password: string): string {
  const lines = fileContent.trimStart().split('\n')
  // Skip ENCRYPTED marker line
  const encryptedData = lines.slice(1).join('\n').trim()
  return decrypt(encryptedData, password)
}
