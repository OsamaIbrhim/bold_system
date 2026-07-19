import './globals.css'
import Sidebar from '@/components/ui/Sidebar'
import { Toaster } from 'sonner'
import AuthGate from '@/components/AuthGate'
export const metadata = { title: 'Bold Admin', description: 'Bold POS Admin' }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="rtl bg-[#f6f6f7] text-gray-900">
        <AuthGate>
          <div className="flex">
            <Sidebar />
            <main className="flex-1 p-6 max-w-7xl">{children}</main>
          </div>
        </AuthGate>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  )
}
