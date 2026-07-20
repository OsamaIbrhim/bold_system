import { describe, expect, it } from 'vitest'
import {
  OPERATIONS_PAGE_SIZE,
  pageWindow,
} from './operations'

describe('operations pagination', () => {
  it('returns an empty range when no records exist', () => {
    expect(pageWindow(1, 0)).toEqual({
      page: 1,
      totalPages: 1,
      from: 0,
      to: 0,
    })
  })

  it('calculates the visible range for later pages', () => {
    expect(pageWindow(2, 61)).toEqual({
      page: 2,
      totalPages: 3,
      from: OPERATIONS_PAGE_SIZE + 1,
      to: OPERATIONS_PAGE_SIZE * 2,
    })
  })

  it('clamps a requested page to the final available page', () => {
    expect(pageWindow(99, 61)).toEqual({
      page: 3,
      totalPages: 3,
      from: 51,
      to: 61,
    })
  })
})
