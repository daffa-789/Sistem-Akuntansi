export interface RequestOptions extends RequestInit {
  body?: any
}

export function request<T = unknown>(path: string, options?: RequestOptions): Promise<T>
