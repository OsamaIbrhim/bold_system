import { api } from './api'
// @ts-ignore
const bold = (window as any).bold
export async function syncLoop(branch_id: string) {
  try {
    // push
    const outbox = await bold.sync_get_outbox()
    if (outbox.length) {
      for (const item of outbox) {
        try {
          await api.sale(JSON.parse(item.payload))
          await bold.sync_mark_sent([item.id])
        } catch(e) {}
      }
    }
    // pull
    const res = await fetch(`${api.base}/sync/pull?branch_id=${branch_id}&since=`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')||''}`}})
    if (res.ok) {
      const data = await res.json()
      await bold.sync_apply_pull(data)
    }
  } catch(e) { console.log('sync offline', e) }
}
export function startSync(branch_id: string) {
  syncLoop(branch_id)
  setInterval(()=>syncLoop(branch_id), 15000)
}
