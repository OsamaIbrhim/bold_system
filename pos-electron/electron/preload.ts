import { contextBridge, ipcRenderer } from 'electron'
contextBridge.exposeInMainWorld('bold', {
  search: (q: string) => ipcRenderer.invoke('pos:search', q),
  stock: (variant_id: string) => ipcRenderer.invoke('pos:stock', variant_id),
  sale: (sale: any) => ipcRenderer.invoke('pos:sale', sale),
  print: (invoice: any, lang: 'ar'|'en') => ipcRenderer.invoke('pos:print', invoice, lang),
  sync_get_outbox: () => ipcRenderer.invoke('sync:get_outbox'),
  sync_mark_sent: (ids: string[]) => ipcRenderer.invoke('sync:mark_sent', ids),
  sync_apply_pull: (data: any) => ipcRenderer.invoke('sync:apply_pull', data),
  sync_get_status: () => ipcRenderer.invoke('sync:get_status'),
  sync_set_status: (status: any) => ipcRenderer.invoke('sync:set_status', status),
  secure_get: () => ipcRenderer.invoke('secure:get'),
  secure_set_auth: (auth: any) => ipcRenderer.invoke('secure:set_auth', auth),
  secure_set_device: (device: any) => ipcRenderer.invoke('secure:set_device', device),
})
declare global { interface Window { bold: any } }
