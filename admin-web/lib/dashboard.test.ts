import { describe, expect, it, vi } from 'vitest'
import { loadDashboardData } from './dashboard'

describe('dashboard data loading', () => {
  it('loads report and product totals without replacing valid data with defaults', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({
        total_sales: 1250.5,
        profit: 310.25,
        count: 8,
      })
      .mockResolvedValueOnce({ total: 42 })

    await expect(loadDashboardData(get, '2026-07-24')).resolves.toEqual({
      stats: {
        total_sales: 1250.5,
        profit: 310.25,
        count: 8,
      },
      productCount: 42,
    })
    expect(get).toHaveBeenNthCalledWith(
      1,
      '/reports/sales?from=2026-07-24&to=2026-07-24',
    )
    expect(get).toHaveBeenNthCalledWith(
      2,
      '/products?page=1&page_size=1',
    )
  })

  it('propagates an authorization failure instead of presenting false zero metrics', async () => {
    const forbidden = new Error('غير مصرح بعرض التقرير')
    const get = vi.fn()
      .mockRejectedValueOnce(forbidden)
      .mockResolvedValueOnce({ total: 42 })

    await expect(
      loadDashboardData(get, '2026-07-24'),
    ).rejects.toBe(forbidden)
  })
})
