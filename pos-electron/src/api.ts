const API = (typeof localStorage !== 'undefined' && localStorage.getItem('bold_api')) || 'http://localhost:3000/api/v1'

function authHeaders(): Record<string, string> {
  const t = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null
  const headers: Record<string, string> = {}
  if (t) headers.Authorization = `Bearer ${t}`
  return headers
}

async function getJson(path: string) {
  const r = await fetch(`${API}${path}`, { headers: { ...authHeaders() }})
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}
async function postJson(path: string, body: any) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders()}, body: JSON.stringify(body)})
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export const api = {
  base: API,
  search: (q: string, branch_id?: string) => 
    fetch(`${API}/products/search?q=${encodeURIComponent(q)}${branch_id?`&branch_id=${branch_id}`:''}`, { headers: { ...authHeaders() }})
      .then(r => r.ok ? r.json() : [] ).catch(()=>[]),
  sale: (payload: any) => postJson('/pos/sale', payload),
  pricing: async (variant_id: string) => {
    try { return await postJson('/pricing/calculate', { variant_id }) } catch { return null }
  },
  customerLookup: async (phone: string) => {
    try { return await getJson(`/customers/lookup?phone=${encodeURIComponent(phone)}`) } catch { return null }
  },
  customerLoyalty: async (phone: string) => {
    try { return await getJson(`/customers/loyalty?phone=${encodeURIComponent(phone)}`) } catch { return { eligible: false } }
  }
}

// Local compound pricing fallback – matches Bold Pricing Engine
// Price = cost * (1+overhead) * (1+profit) * (1+tax)
// Defaults: overhead 20%, profit 35%, tax 14%
export function calcPriceLocal(cost: number, overhead = 20, profit = 35, tax = 14) {
  const p1 = cost * (1 + overhead/100)
  const p2 = p1 * (1 + profit/100)
  const p3 = p2 * (1 + tax/100)
  return Math.round(p3)
}
