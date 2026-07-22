import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bold', {
  search: (q: string) => ipcRenderer.invoke('pos:search', q),
  stock: (variant_id: string) => ipcRenderer.invoke('pos:stock', variant_id),
  sale: (sale: any) => ipcRenderer.invoke('pos:sale', sale),
  print: (invoice: any, lang: 'ar' | 'en') =>
    ipcRenderer.invoke('pos:print', invoice, lang),
  local_sales: () => ipcRenderer.invoke('pos:list_local_sales'),
  sync_get_outbox: () => ipcRenderer.invoke('sync:get_outbox'),
  sync_mark_sending: (id: string) =>
    ipcRenderer.invoke('sync:mark_sending', id),
  sync_mark_sent: (result: any) =>
    ipcRenderer.invoke('sync:mark_sent', result),
  sync_mark_failed: (result: any) =>
    ipcRenderer.invoke('sync:mark_failed', result),
  sync_apply_pull: (data: any) => ipcRenderer.invoke('sync:apply_pull', data),
  sync_get_status: () => ipcRenderer.invoke('sync:get_status'),
  sync_set_status: (status: any) => ipcRenderer.invoke('sync:set_status', status),
  secure_get: () => ipcRenderer.invoke('secure:get'),
  secure_set_auth: (auth: any) => ipcRenderer.invoke('secure:set_auth', auth),
  secure_set_device: (device: any) => ipcRenderer.invoke('secure:set_device', device),
  secure_set_accounting: (context: any) =>
    ipcRenderer.invoke('secure:set_accounting', context),
})

declare global {
  interface Window {
    bold: any
  }
}
