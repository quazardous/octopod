import { LocalStorageSessionAuthAdapter } from '@quazardous/qdadm'

/**
 * The admin signs in with the provider's admin token (`octopod secrets <project>`, the
 * service's `admin-token`), typed as the password: it is checked on the API, and sent as
 * a bearer token from then on.
 */
class AdminTokenAuth extends LocalStorageSessionAuthAdapter {
  constructor() {
    super('octopod_oidc_admin')
  }

  async login({ password }: { username: string; password: string }) {
    const token = password.trim()
    const answer = await fetch('/admin/api/users', { headers: { authorization: `Bearer ${token}` } })
    if (!answer.ok) throw new Error('Wrong admin token')
    const user = { id: 'admin', username: 'admin', role: 'ROLE_ADMIN' }
    this.setSession(token, user)
    this.persist()
    return { user, token }
  }
}

export const authAdapter = new AdminTokenAuth()
