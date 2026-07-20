export const OPERATIONS_PAGE_SIZE = 25

export function pageWindow(
  page: number,
  total: number,
  pageSize = OPERATIONS_PAGE_SIZE,
) {
  const safeTotal = Math.max(0, Math.floor(Number(total) || 0))
  const safePageSize = Math.max(1, Math.floor(Number(pageSize) || 1))
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize))
  const safePage = Math.min(
    totalPages,
    Math.max(1, Math.floor(Number(page) || 1)),
  )

  if (safeTotal === 0) {
    return {
      page: safePage,
      totalPages,
      from: 0,
      to: 0,
    }
  }

  const from = (safePage - 1) * safePageSize + 1
  const to = Math.min(safePage * safePageSize, safeTotal)

  return {
    page: safePage,
    totalPages,
    from,
    to,
  }
}
