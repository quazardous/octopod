import { Module, EntityManager, ApiStorage } from '@quazardous/qdadm'
import { http } from '../http'

/** A user as the API gives it. */
interface ApiUser {
  sub: string
  claims: Record<string, unknown>
  password: boolean
  issuers?: string[]
}

/** A user as the forms edit it: the claims as JSON text, the issuers as a list in a line. */
interface FormUser {
  id: string
  sub: string
  claims: string
  has_password: boolean
  password: string
  remove_password: boolean
  issuers: string
}

export class UsersModule extends Module {
  static name = 'users'

  async connect(ctx: any) {
    ctx.entity('users', new EntityManager({
      name: 'users',
      labelField: 'sub',
      fields: {
        sub: { type: 'text', label: 'User', required: true, default: '' },
        claims: { type: 'textarea', label: 'Claims (JSON)', default: '{\n  "email": "",\n  "groups": []\n}' },
        has_password: { type: 'boolean', label: 'Has a password', default: false, readOnly: true },
        password: { type: 'password', label: 'New password (empty: unchanged)', default: '' },
        remove_password: { type: 'boolean', label: 'Remove its password (one-click sign-in)', default: false },
        issuers: { type: 'text', label: 'Issuers (comma-separated; empty: all)', default: '' },
      },
      storage: new ApiStorage({
        endpoint: '/admin/api/users',
        client: http,
        responseItemsKey: 'users',
        normalize: (u: any): any => {
          const user = u as ApiUser
          return {
            id: user.sub,
            sub: user.sub,
            claims: JSON.stringify(user.claims ?? {}, null, 2),
            has_password: user.password,
            password: '',
            remove_password: false,
            issuers: (user.issuers ?? []).join(', '),
          } satisfies FormUser
        },
        denormalize: (f: any): any => {
          const form = f as Partial<FormUser>
          const issuers = (form.issuers ?? '').split(',').map((s) => s.trim()).filter(Boolean)
          return {
            sub: form.sub,
            claims: JSON.parse(form.claims || '{}'),
            issuers: issuers.length > 0 ? issuers : null,
            ...(form.remove_password ? { password: null } : form.password ? { password: form.password } : {}),
          }
        },
      }),
    }))

    ctx.crud('users', {
      list: () => import('./UserList.vue'),
      form: () => import('./UserForm.vue'),
    }, { nav: { section: 'Provider', icon: 'pi pi-users' } })
  }
}
