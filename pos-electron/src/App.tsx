import React, { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api'
import {
  AppView,
  DeviceCredential,
  OfflineAccountingContext,
  Session,
  Shift,
  SyncState,
} from './types'
import { startSync, syncLoop } from './sync'
import { EnrollmentScreen } from './screens/EnrollmentScreen'
import { LoginScreen } from './screens/LoginScreen'
import { CloseShiftScreen, OpenShiftScreen } from './screens/ShiftScreens'
import { RegisterScreen } from './screens/RegisterScreen'
import { SalesScreen } from './screens/SalesScreen'
import { ScreenLoader, Toasts, ToastValue } from './components/ui'

const emptySync: SyncState = {
  device_id: '',
  terminal_name: '',
  app_version: '',
  sync_status: 'never',
  last_sync_at: null,
  last_error: null,
  pending_count: 0,
  terminal_sale_sequence: '0',
}

export default function App() {
  const [booting, setBooting] = useState(true)
  const [device, setDevice] = useState<DeviceCredential | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [shift, setShift] = useState<Shift | null>(null)
  const [accountingContext, setAccountingContext] =
    useState<OfflineAccountingContext | null>(null)
  const [checkingShift, setCheckingShift] = useState(false)
  const [closingShift, setClosingShift] = useState(false)
  const [view, setView] = useState<AppView>('register')
  const [syncState, setSyncState] = useState<SyncState>(emptySync)
  const [toasts, setToasts] = useState<ToastValue[]>([])

  const notify = useCallback(
    (message: string, tone: 'success' | 'error' | 'info' = 'info') => {
      const id = crypto.randomUUID()
      setToasts((current) => [...current, { id, message, tone }])
      window.setTimeout(
        () => setToasts((current) => current.filter((toast) => toast.id !== id)),
        4500,
      )
    },
    [],
  )

  const installAccountingContext = useCallback(
    async (currentShift: Shift) => {
      try {
        const context = await api.ensureOfflineAccountingContext(currentShift)
        setAccountingContext(context)
        return context
      } catch (error) {
        const cached = api.offlineContextFor(currentShift)
        setAccountingContext(cached)
        if (!cached) {
          notify(
            error instanceof ApiError && error.code === 'NETWORK_ERROR'
              ? 'لا يوجد تفويض محاسبي صالح للبيع دون اتصال. شغّل الإنترنت قبل تحصيل أي دفعة.'
              : (error as Error).message,
            'error',
          )
        }
        return cached
      }
    },
    [notify],
  )

  const clearShiftState = useCallback(async () => {
    localStorage.removeItem('bold_current_shift')
    setShift(null)
    setAccountingContext(null)
    await api.clearOfflineAccountingContext()
  }, [])

  const resolveShift = useCallback(
    async (branchId: string) => {
      setCheckingShift(true)
      try {
        const current = await api.currentShift(branchId)
        if (current) {
          localStorage.setItem('bold_current_shift', JSON.stringify(current))
          setShift(current)
          await installAccountingContext(current)
        } else {
          await clearShiftState()
        }
      } catch (error) {
        const cachedRaw = localStorage.getItem('bold_current_shift')
        if (
          error instanceof ApiError &&
          error.code === 'NETWORK_ERROR' &&
          cachedRaw
        ) {
          try {
            const cached = JSON.parse(cachedRaw) as Shift
            if (cached.branch_id !== branchId || cached.status !== 'open') {
              throw new Error('Cached shift does not match the current branch')
            }
            setShift(cached)
            const context = api.offlineContextFor(cached)
            setAccountingContext(context)
            notify(
              context
                ? 'تم فتح الوردية المحفوظة بتفويض محاسبي صالح في وضع عدم الاتصال.'
                : 'تم فتح الوردية المحفوظة للعرض فقط. يلزم الاتصال بالخادم قبل تحصيل الدفع.',
              'info',
            )
          } catch {
            await clearShiftState()
          }
        } else {
          await clearShiftState()
          notify((error as Error).message, 'error')
        }
      } finally {
        setCheckingShift(false)
      }
    },
    [clearShiftState, installAccountingContext, notify],
  )

  useEffect(() => {
    api
      .bootstrap()
      .then((result) => {
        setDevice(result.device)
        setSession(result.session)
        setAccountingContext(result.accountingContext)
        if (result.session?.user?.branch_id) {
          return resolveShift(result.session.user.branch_id)
        }
      })
      .catch((error) =>
        notify(`تعذر بدء التطبيق: ${(error as Error).message}`, 'error'),
      )
      .finally(() => setBooting(false))
  }, [notify, resolveShift])

  useEffect(() => {
    const expired = () => {
      setSession(null)
      setShift(null)
      setAccountingContext(null)
      setView('register')
    }
    const invalid = () => {
      setSession(null)
      setShift(null)
      setAccountingContext(null)
      setDevice(null)
      setView('register')
    }
    window.addEventListener('bold-auth-expired', expired)
    window.addEventListener('bold-terminal-invalid', invalid)
    return () => {
      window.removeEventListener('bold-auth-expired', expired)
      window.removeEventListener('bold-terminal-invalid', invalid)
    }
  }, [])

  useEffect(() => {
    if (!session || !shift || !device) return
    return startSync(device.branch_id, setSyncState)
  }, [session, shift, device])

  useEffect(() => {
    if (!session || !shift || !device) return
    const refresh = () => {
      api
        .ensureOfflineAccountingContext(shift)
        .then(setAccountingContext)
        .catch(() => {
          setAccountingContext(api.offlineContextFor(shift))
        })
    }
    const timer = window.setInterval(refresh, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [session, shift, device])

  const syncNow = useCallback(() => {
    if (!device) return
    syncLoop(device.branch_id, setSyncState).then((state) => {
      if (state.sync_status === 'success') notify('اكتملت المزامنة', 'success')
      else if (state.last_error) notify(state.last_error, 'error')
    })
  }, [device, notify])

  const openShiftCompleted = useCallback(
    async (value: Shift) => {
      localStorage.setItem('bold_current_shift', JSON.stringify(value))
      setShift(value)
      setView('register')
      const context = await installAccountingContext(value)
      notify(
        context
          ? 'تم فتح الوردية وتجهيز البيع المتصل ودون اتصال.'
          : 'تم فتح الوردية، لكن الدفع متوقف حتى يتم إصدار التفويض المحاسبي.',
        context ? 'success' : 'error',
      )
    },
    [installAccountingContext, notify],
  )

  const requestShiftClose = useCallback(() => {
    if (syncState.pending_count > 0) {
      notify(
        `لا يمكن إغلاق الوردية: توجد ${syncState.pending_count} عملية محلية غير محسومة. نفّذ المزامنة أو راجع العملية الفاشلة أولًا.`,
        'error',
      )
      return
    }
    if (syncState.sync_status !== 'success') {
      notify(
        'لا يمكن إغلاق الوردية قبل اتصال ناجح بالخادم وتأكيد عدم وجود عمليات معلقة.',
        'error',
      )
      return
    }
    setClosingShift(true)
  }, [notify, syncState.pending_count, syncState.sync_status])

  if (booting) {
    return <ScreenLoader message="جارٍ فحص الجهاز والجلسة الآمنة…" />
  }
  if (!device) {
    return (
      <EnrollmentScreen
        onEnrolled={(value) => {
          setDevice(value)
          setSession(null)
          setShift(null)
          setAccountingContext(null)
        }}
      />
    )
  }
  if (!session) {
    return (
      <LoginScreen
        device={device}
        onLogin={(value) => {
          setSession(value)
          setAccountingContext(null)
          resolveShift(value.user.branch_id)
        }}
      />
    )
  }
  if (checkingShift) {
    return <ScreenLoader message="جارٍ التحقق من الوردية الحالية…" />
  }
  if (!shift) {
    return (
      <OpenShiftScreen
        session={session}
        device={device}
        onOpened={openShiftCompleted}
      />
    )
  }
  if (closingShift) {
    return (
      <CloseShiftScreen
        shift={shift}
        onCancel={() => setClosingShift(false)}
        onClosed={async (value) => {
          setClosingShift(false)
          await clearShiftState()
          notify(
            `أُغلقت الوردية. الفرق: ${Number(value.difference || 0).toFixed(2)} ج`,
            'success',
          )
          await api.logout()
          setSession(null)
        }}
      />
    )
  }

  return (
    <>
      {view === 'register' ? (
        <RegisterScreen
          session={session}
          device={device}
          shift={shift}
          accountingContext={accountingContext}
          syncState={syncState}
          onSync={syncNow}
          onSales={() => setView('sales')}
          onCloseShift={requestShiftClose}
          notify={notify}
        />
      ) : (
        <SalesScreen
          session={session}
          device={device}
          shift={shift}
          syncState={syncState}
          onRegister={() => setView('register')}
          onSync={syncNow}
          onCloseShift={requestShiftClose}
          notify={notify}
        />
      )}
      <Toasts
        values={toasts}
        dismiss={(id) =>
          setToasts((current) => current.filter((toast) => toast.id !== id))
        }
      />
    </>
  )
}
