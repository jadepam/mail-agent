import { describe, it, expect } from 'vitest'
import { encrypt, decrypt, isEncrypted, encryptCredentials, decryptCredentials } from '../src/crypto.js'

/**
 * @mail-agent/cli crypto 模块测试
 * 验证 AES-256-GCM 加密/解密流程
 */

describe('crypto — AES-256-GCM', () => {
  const testPassword = 'test-master-password-123'
  const testPlaintext = 'Hello, World! 你好世界 🌍'

  it('encrypt() 应该返回 salt:iv:authTag:ciphertext 格式', () => {
    const encrypted = encrypt(testPlaintext, testPassword)
    const parts = encrypted.split(':')
    expect(parts).toHaveLength(4)
    // 每段都是合法 base64
    for (const part of parts) {
      expect(() => Buffer.from(part, 'base64')).not.toThrow()
    }
  })

  it('decrypt(encrypt(x)) 应该还原原文', () => {
    const encrypted = encrypt(testPlaintext, testPassword)
    const decrypted = decrypt(encrypted, testPassword)
    expect(decrypted).toBe(testPlaintext)
  })

  it('不同次加密产生不同密文（随机 salt + iv）', () => {
    const encrypted1 = encrypt(testPlaintext, testPassword)
    const encrypted2 = encrypt(testPlaintext, testPassword)
    expect(encrypted1).not.toBe(encrypted2)
  })

  it('错误主密码解密应该抛出错误', () => {
    const encrypted = encrypt(testPlaintext, testPassword)
    expect(() => decrypt(encrypted, 'wrong-password')).toThrow('Decryption failed')
  })

  it('空字符串可以加解密', () => {
    const encrypted = encrypt('', testPassword)
    const decrypted = decrypt(encrypted, testPassword)
    expect(decrypted).toBe('')
  })

  it('长文本可以加解密', () => {
    const longText = 'A'.repeat(100_000)
    const encrypted = encrypt(longText, testPassword)
    const decrypted = decrypt(encrypted, testPassword)
    expect(decrypted).toBe(longText)
  })

  it('格式无效的加密数据应该抛出错误', () => {
    expect(() => decrypt('invalid-format', testPassword)).toThrow('Invalid encrypted data format')
  })
})

describe('crypto — 凭证文件加密', () => {
  const testPassword = 'file-master-password'
  const testYaml = `_comment: '此文件包含敏感凭据'
accounts:
  - id: acc_0
    pass: mypassword123
    oauth2:
      client_id: xxx
      client_secret: yyy
      refresh_token: zzz
`

  it('isEncrypted() 检测 # ENCRYPTED 标记', () => {
    expect(isEncrypted('# ENCRYPTED\nabc123')).toBe(true)
    expect(isEncrypted('  # ENCRYPTED\nabc123')).toBe(true)
    expect(isEncrypted('_comment: test')).toBe(false)
    expect(isEncrypted('accounts: []')).toBe(false)
  })

  it('encryptCredentials() 生成带 # ENCRYPTED 标记的文件', () => {
    const encrypted = encryptCredentials(testYaml, testPassword)
    expect(encrypted.trimStart().startsWith('# ENCRYPTED')).toBe(true)
  })

  it('decryptCredentials(encryptCredentials(x)) 还原原始 YAML', () => {
    const encrypted = encryptCredentials(testYaml, testPassword)
    const decrypted = decryptCredentials(encrypted, testPassword)
    expect(decrypted).toBe(testYaml)
  })
})
