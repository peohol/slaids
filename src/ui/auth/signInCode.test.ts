import { describe, expect, it } from 'vitest'
import { SIGN_IN_CODE_LENGTH, codeDigits, isCompleteCode } from './signInCode'

describe('innloggingskoden', () => {
  it('tar bare sifrene fra det som limes inn', () => {
    expect(codeDigits('123 456')).toBe('123456')
    expect(codeDigits(' 12-34-56\n')).toBe('123456')
    expect(codeDigits('abc')).toBe('')
  })

  it('kutter etter en hel kode', () => {
    expect(codeDigits('1234567890')).toHaveLength(SIGN_IN_CODE_LENGTH)
  })

  it('er komplett bare med nøyaktig riktig antall sifre', () => {
    expect(isCompleteCode('1'.repeat(SIGN_IN_CODE_LENGTH))).toBe(true)
    expect(isCompleteCode('1'.repeat(SIGN_IN_CODE_LENGTH - 1))).toBe(false)
    expect(isCompleteCode('12345a')).toBe(false)
  })
})
