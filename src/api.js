const API = '/api'

export async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
    ...options,
    body: options.body instanceof FormData || options.body === undefined ? options.body : JSON.stringify(options.body)
  })
  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || 'Permintaan tidak dapat diproses.')
  return payload
}

export async function download(path, filename) {
  const response = await fetch(`${API}${path}`, { credentials: 'include' })
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
