import { useCallback, useEffect, useState } from 'react'

export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: '' })

  const reload = useCallback(async () => {
    setState((c) => ({ ...c, loading: true, error: '' }))
    try {
      const data = await loader()
      setState({ loading: false, data, error: '' })
    } catch (e) {
      setState({ loading: false, data: null, error: e.message })
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    reload()
  }, [reload])

  return { ...state, reload }
}
