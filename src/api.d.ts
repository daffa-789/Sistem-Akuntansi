// Deklarasi untuk api.js (file JS, dipanggil dari komponen TSX dengan generik).
export interface RequestOptions extends RequestInit {
  body?: any
}

export function request<T = unknown>(path: string, options?: RequestOptions): Promise<T>
export function download(path: string, filename: string): Promise<void>
