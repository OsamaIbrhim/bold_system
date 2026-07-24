export type DashboardStats = {
  total_sales: number
  profit: number
  count: number
}

export type DashboardData = {
  stats: DashboardStats
  productCount: number
}

type GetRequest = (path: string) => Promise<any>

export async function loadDashboardData(
  get: GetRequest,
  today: string,
): Promise<DashboardData> {
  const [stats, products] = await Promise.all([
    get(`/reports/sales?from=${today}&to=${today}`),
    get('/products?page=1&page_size=1'),
  ])

  return {
    stats: {
      total_sales: Number(stats.total_sales) || 0,
      profit: Number(stats.profit) || 0,
      count: Number(stats.count) || 0,
    },
    productCount: Number(products.total) || 0,
  }
}
