const API = '/api'

function apiPath(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return normalized === API || normalized.startsWith(`${API}/`) ? normalized : `${API}${normalized}`
}

export async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {})
  }

  let response
  try {
    response = await fetch(apiPath(path), {
      ...options,
      headers,
      body: isFormData || options.body === undefined ? options.body : JSON.stringify(options.body)
    })
  } catch {
    throw new Error('Server Finova belum terhubung. Jalankan `bun run dev` terlebih dahulu.')
  }

  if (response.status === 204) return null
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload.message || 'Permintaan tidak dapat diproses oleh server Finova.')
  }
  return payload
}
