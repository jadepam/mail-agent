import { describe, it, expect } from 'vitest'
import { shouldConfirm } from './shared.js'

/**
 * shouldConfirm() 优先级链单元测试
 *
 * 优先级：--json > --yes > config.mode > 默认 human
 */

describe('shouldConfirm', () => {
  it('默认（无 flag/config）应返回 true（human mode）', () => {
    expect(shouldConfirm({}, {})).toBe(true)
  })

  it('--yes 标志应返回 false', () => {
    expect(shouldConfirm({ yes: true }, {})).toBe(false)
  })

  it('--json 输出应返回 false', () => {
    expect(shouldConfirm({ json: true }, {})).toBe(false)
  })

  it('--json 优先于 --yes 未设置', () => {
    expect(shouldConfirm({ json: true }, { mode: 'human' })).toBe(false)
  })

  it('config.mode=ai 应返回 false', () => {
    expect(shouldConfirm({}, { mode: 'ai' })).toBe(false)
  })

  it('config.mode=human 应返回 true', () => {
    expect(shouldConfirm({}, { mode: 'human' })).toBe(true)
  })

  it('优先级：--yes 覆盖 config.mode=human', () => {
    expect(shouldConfirm({ yes: true }, { mode: 'human' })).toBe(false)
  })

  it('优先级：--yes 覆盖 config 缺失', () => {
    expect(shouldConfirm({ yes: true }, {})).toBe(false)
  })

  it('优先级：--json 覆盖 config.mode=human', () => {
    expect(shouldConfirm({ json: true }, { mode: 'human' })).toBe(false)
  })

  it('config.mode 缺失时默认 human', () => {
    expect(shouldConfirm({}, {})).toBe(true)
  })

  it('--yes + --json 同时存在应返回 false', () => {
    expect(shouldConfirm({ yes: true, json: true }, {})).toBe(false)
  })
})
