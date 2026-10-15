import { useEffect, useState } from 'react'

export function useThemeTokens(names) {
  const key = names.join(',')

  const read = () => {
    const style = getComputedStyle(document.body)
    const out = {}
    for (const n of key.split(',')) out[n] = style.getPropertyValue(n).trim()
    return out
  }

  const [tokens, setTokens] = useState(read)

  useEffect(() => {
    const sync = () => setTokens(read())
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return tokens
}
