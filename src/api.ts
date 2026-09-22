const API = '/api'

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: any
  headers?: Record<string, string>
}

export async function request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const isFormData = options.body instanceof FormData
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {})
  }

  const response = await fetch(`${API}${path}`, {
    ...options,
    headers,
    body: isFormData || options.body === undefined ? options.body : JSON.stringify(options.body)
  })

  if (response.status === 204) return null as T
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || 'Permintaan tidak dapat diproses.')
  return payload as T
}

export async function download(path: string, filename: string): Promise<void> {
  const response = await fetch(`${API}${path}`)
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.message || 'Berkas tidak dapat diunduh.')
  }
  const link = document.createElement('a')
  link.href = URL.createObjectURL(await response.blob())
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
