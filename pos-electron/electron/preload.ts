import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bold', {
  search: (q: string) => ipcRenderer.invoke('pos:search', q),
  stock: (variant_id: string) => ipcRenderer.invoke('pos:stock', variant_id),
  sale: (sale: any) => ipcRenderer.invoke('pos:sale', sale),
  print: (invoice: any, lang: 'ar' | 'en') =>
    ipcRenderer.invoke('pos:print', invoice, lang),
  local_sales: () => ipcRenderer.invoke('pos:list_local_sales'),
  held_sales: () => ipcRenderer.invoke('pos:list_held_sales'),
  hold_sale: (payload: any) =>
    ipcRenderer.invoke('pos:hold_sale', payload),
  resume_held_sale: (id: string) =>
    ipcRenderer.invoke('pos:resume_held_sale', id),
  delete_held_sale: (id: string) =>
    ipcRenderer.invoke('pos:delete_held_sale', id),
  sync_get_outbox: () => ipcRenderer.invoke('sync:get_outbox'),
  sync_mark_sent: (ids: string[]) => ipcRenderer.invoke('sync:mark_sent', ids),
  sync_apply_pull: (data: any) => ipcRenderer.invoke('sync:apply_pull', data),
  sync_get_status: () => ipcRenderer.invoke('sync:get_status'),
  sync_set_status: (status: any) => ipcRenderer.invoke('sync:set_status', status),
<<<<<<< HEAD
  secure_get: () => ipcRenderer.invoke('secure:get'),
  secure_set_auth: (auth: any) => ipcRenderer.invoke('secure:set_auth', auth),
  secure_set_device: (device: any) => ipcRenderer.invoke('secure:set_device', device),
=======
  api_bootstrap: () => ipcRenderer.invoke('api:bootstrap'),
  api_enroll: (code: string, terminal: any) =>
    ipcRenderer.invoke('api:enroll', code, terminal),
  api_login: (phone: string, password: string) =>
    ipcRenderer.invoke('api:login', phone, password),
  api_logout: () => ipcRenderer.invoke('api:logout'),
  api_request: (request: any) => ipcRenderer.invoke('api:request', request),
  api_clear_session: () => ipcRenderer.invoke('api:clear_session'),
  api_clear_device: () => ipcRenderer.invoke('api:clear_device'),
  api_issue_accounting: (shiftId: string) =>
    ipcRenderer.invoke('api:issue_accounting', shiftId),
  api_clear_accounting: () => ipcRenderer.invoke('api:clear_accounting'),
>>>>>>> 27adfdb (ci: add migration-gate job and concurrency group)
})

declare global {
  interface Window {
    bold: any
  }
}