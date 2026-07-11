const API_BASE = process.env.NEXT_PUBLIC_API || 'http://localhost:3000/api/v1'
function authHeader(){ if(typeof window==='undefined') return {}; const t = localStorage.getItem('token'); return t ? { Authorization: `Bearer ${t}` } : {} }
export async function apiGet(path: string){
  const r = await fetch(`${API_BASE}${path}`, { headers: { ...authHeader() }, cache: 'no-store' })
  if(!r.ok) throw new Error(await r.text())
  return r.json()
}
export async function apiPost(path: string, body: any){
  const r = await fetch(`${API_BASE}${path}`, { method:'POST', headers: { 'Content-Type':'application/json', ...authHeader() }, body: JSON.stringify(body)})
  if(!r.ok) throw new Error(await r.text())
  return r.json()
}
export const API = API_BASE
