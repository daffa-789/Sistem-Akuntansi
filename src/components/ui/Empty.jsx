import { FileText } from 'lucide-react'

export function Empty({ children = 'Belum ada data. Mulai tambahkan untuk melihat hasilnya di sini.' }) {
  return (
    <div className="empty">
      <FileText aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}
