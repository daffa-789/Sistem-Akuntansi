import { useCallback, useEffect, useState, DependencyList } from 'react'

export interface LoadState<T> {
  loading: boolean
  data: T | null
  error: string
  reload: () => Promise<void>
}

export function useLoad<T = any>(loader: () => Promise<T>, deps: DependencyList = []): LoadState<T> {
  const [state, setState] = useState<{ loading: boolean; data: T | null; error: string }>({
    loading: true,
    data: null,
    error: ''
  })

  const reload = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }))
    try {
      const data = await loader()
      setState({ loading: false, data, error: '' })
    } catch (e: any) {
      setState({ loading: false, data: null, error: e.message || 'Gagal memuat data.' })
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reload()
  }, [reload])

  return { ...state, reload }
}
