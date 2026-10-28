import { describe, expect, it } from 'vitest'
import { achievementPercent, formatPeriodLabel, isValidPeriod, performanceStatus, shiftPeriod } from './performance'

describe('KPI calculations', () => {
  it('scores higher-is-better metrics against target', () => {
    expect(achievementPercent(100, 110, 'higher')).toBe(110)
    expect(achievementPercent(100, 80, 'higher')).toBe(80)
  })

  it('scores lower-is-better metrics without rewarding target overruns', () => {
    expect(achievementPercent(100, 90, 'lower')).toBe(100)
    expect(achievementPercent(100, 125, 'lower')).toBe(80)
  })

  it('classifies the scorecard bands', () => {
    expect(performanceStatus(100)).toBe('on-track')
    expect(performanceStatus(95)).toBe('watch')
    expect(performanceStatus(89.9)).toBe('behind')
  })

  it('validates and shifts calendar months across years', () => {
    expect(isValidPeriod('2026-02')).toBe(true)
    expect(isValidPeriod('2026-13')).toBe(false)
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12')
    expect(formatPeriodLabel('2026-01')).toBe('Jan 26')
  })
})
