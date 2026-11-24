import { fmtDate } from './utils'

test('formats ISO task dates without shifting them to 2001', () => {
  expect(fmtDate('2026-11-24')).toBe('Nov 24, 2026')
})

test('returns a placeholder for invalid dates', () => {
  expect(fmtDate('not-a-date')).toBe('—')
})
