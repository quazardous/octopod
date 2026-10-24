import type { HttpClient } from '@quazardous/qdadm'
import { authAdapter } from './auth'

/** fetch, with the admin token: what qdadm's ApiStorage calls the API with. */
async function call<T>(method: string, url: string, data?: unknown): Promise<{ data: T }> {
  const answer = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${authAdapter.getToken() ?? ''}`, 'content-type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  const body = await answer.json().catch(() => ({}))
  if (!answer.ok) throw new Error((body as { error_description?: string }).error_description ?? answer.statusText)
  return { data: body as T }
}

export const http: HttpClient = {
  get: (url) => call('GET', url),
  post: (url, data) => call('POST', url, data),
  put: (url, data) => call('PUT', url, data),
  patch: (url, data) => call('PUT', url, data),
  delete: (url) => call('DELETE', url),
  request: ({ method, url, data }) => call(method, url, data),
}
