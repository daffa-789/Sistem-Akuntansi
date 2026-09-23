import { useEffect, useState } from 'react'

// Pustaka grafik (recharts) meminta warna sebagai string literal, sedangkan
// sisa aplikasi membaca warna dari token CSS. Hook ini membaca nilai token
// terhitung pada <body> dan menyegarkannya setiap kali kelas body berubah
// (mode gelap/terang), sehingga warna grafik tidak pernah menyimpang.
export function useThemeTokens(names: string[]): Record<string, string> {
  const key = names.join(',')

  const read = (): Record<string, string> => {
    const style = getComputedStyle(document.body)
    const out: Record<string, string> = {}
    for (const n of key.split(',')) out[n] = style.getPropertyValue(n).trim()
    return out
  }

  const [tokens, setTokens] = useState<Record<string, string>>(read)

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
