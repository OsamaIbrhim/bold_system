import React, { ReactNode, useEffect } from 'react'

export function ScreenLoader({ message }: { message: string }) {
  return <main className="auth-shell"><section className="auth-card compact"><div className="brand-mark">B</div><h1>Bold POS</h1><div className="spinner"/><p className="muted">{message}</p></section></main>
}

export function FieldError({ children }: { children?: ReactNode }) {
  return children ? <div className="field-error" role="alert">{children}</div> : null
}

export function Modal({ open, title, children, onClose, width = '720px' }: { open: boolean, title: string, children: ReactNode, onClose: () => void, width?: string }) {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])
  if (!open) return null
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="modal-card" style={{maxWidth: width}} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event)=>event.stopPropagation()}>
      <header className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="إغلاق">×</button></header>
      <div className="modal-body">{children}</div>
    </section>
  </div>
}

export function ConfirmDialog({ open, title, message, confirmLabel='تأكيد', danger=false, onConfirm, onClose }: { open:boolean, title:string, message:string, confirmLabel?:string, danger?:boolean, onConfirm:()=>void, onClose:()=>void }) {
  return <Modal open={open} title={title} onClose={onClose} width="460px">
    <p className="dialog-message">{message}</p>
    <div className="dialog-actions"><button className="button secondary" onClick={onClose}>إلغاء</button><button className={`button ${danger?'danger':'primary'}`} onClick={onConfirm}>{confirmLabel}</button></div>
  </Modal>
}

export type ToastValue = { id:string, message:string, tone?:'success'|'error'|'info' }
export function Toasts({ values, dismiss }: { values:ToastValue[], dismiss:(id:string)=>void }) {
  return <div className="toast-stack">{values.map((toast)=><button key={toast.id} className={`toast ${toast.tone||'info'}`} onClick={()=>dismiss(toast.id)}>{toast.message}</button>)}</div>
}

export function NumericKeypad({ value, onChange }: { value:string, onChange:(value:string)=>void }) {
  const press = (key:string) => {
    if (key==='⌫') return onChange(value.slice(0,-1))
    if (key==='C') return onChange('')
    if (key==='.' && value.includes('.')) return
    const next = `${value}${key}`
    if (/^\d*(?:\.\d{0,2})?$/.test(next)) onChange(next)
  }
  return <div className="keypad">{['7','8','9','4','5','6','1','2','3','C','0','.','⌫'].map((key)=><button type="button" key={key} onClick={()=>press(key)}>{key}</button>)}</div>
}

export class ErrorBoundary extends React.Component<{children:ReactNode},{error:string}> {
  state = { error:'' }
  static getDerivedStateFromError(error:Error) { return { error:error.message || 'Unexpected UI error' } }
  componentDidCatch(error:Error) { console.error('[POS UI]', error) }
  render() {
    if (this.state.error) return <main className="auth-shell"><section className="auth-card"><div className="brand-mark error">!</div><h1>تعذر تشغيل الواجهة</h1><p className="field-error">{this.state.error}</p><button className="button primary" onClick={()=>location.reload()}>إعادة تشغيل التطبيق</button></section></main>
    return this.props.children
  }
}
