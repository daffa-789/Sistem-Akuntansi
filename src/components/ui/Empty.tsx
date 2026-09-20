import React, { ReactNode } from 'react'
import { FileText } from 'lucide-react'

export interface EmptyProps {
  children?: ReactNode
}

export function Empty({ children = 'Belum ada data. Mulai tambahkan untuk melihat hasilnya di sini.' }: EmptyProps): React.JSX.Element {
  return (
    <div className="empty">
      <FileText aria-hidden="true" />
      <div>{children}</div>
    </div>
  )
}
