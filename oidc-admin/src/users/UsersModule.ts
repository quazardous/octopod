import { Module, EntityManager, ApiStorage } from '@quazardous/qdadm'
import { http } from '../http'

/** A user as the API gives it. */
interface ApiUser {
  sub: string
  claims: Record<string, unknown>
  groups: string[]
  password: boolean
  issuers?: string[]
}

/** The OIDC attributes an app reads most: a field each. */
export const STANDARD = ['email', 'name', 'given_name', 'family_name', 'preferred_username'] as const

/** An attribute of no field of its own: a name and its value (JSON when it parses: 3, true, ["a"]). */
export interface Attribute {
  name: string
  value: string
}

/** A user as the forms edit it: its groups a list, its attributes fields and rows, no JSON. */
interface FormUser {
  id: string
  sub: string
  groups: string[]
  email: string
  email_verified: boolean
  name: string
  given_name: string
  family_name: string
  preferred_username: string
  attributes: Attribute[]
  has_password: boolean
  password: string
  remove_password: boolean
  issuers: string
}

const shownValue = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v))
const parsedValue = (v: string): unknown => {
  try {
    return JSON.parse(v)
  } catch {
    return v
  }
}

export class UsersModule extends Module {
  static moduleName = 'users'

  async connect(ctx: any) {
    ctx.entity('users', new EntityManager({
      name: 'users',
      labelField: 'sub',
      fields: {
        sub: { type: 'text', label: 'User', required: true, default: '' },
        groups: { type: 'text', label: 'Groups', default: [] },
        email: { type: 'email', label: 'email', default: '' },
        email_verified: { type: 'boolean', label: 'email_verified', default: false },
        name: { type: 'text', label: 'name', default: '' },
        given_name: { type: 'text', label: 'given_name', default: '' },
        family_name: { type: 'text', label: 'family_name', default: '' },
        preferred_username: { type: 'text', label: 'preferred_username', default: '' },
        attributes: { type: 'text', label: 'Other attributes', default: [] },
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
          const claims = user.claims ?? {}
          const own = (k: string) => (typeof claims[k] === 'string' ? (claims[k] as string) : '')
          return {
            id: user.sub,
            sub: user.sub,
            groups: user.groups ?? [],
            email: own('email'),
            email_verified: claims.email_verified === true,
            name: own('name'),
            given_name: own('given_name'),
            family_name: own('family_name'),
            preferred_username: own('preferred_username'),
            attributes: Object.entries(claims)
              .filter(([k, v]) => !(STANDARD as readonly string[]).includes(k) || typeof v !== 'string')
              .filter(([k]) => k !== 'email_verified')
              .map(([name, value]) => ({ name, value: shownValue(value) })),
            has_password: user.password,
            password: '',
            remove_password: false,
            issuers: (user.issuers ?? []).join(', '),
          } satisfies FormUser
        },
        denormalize: (f: any): any => {
          const form = f as Partial<FormUser>
          const issuers = (form.issuers ?? '').split(',').map((s) => s.trim()).filter(Boolean)
          const claims: Record<string, unknown> = {}
          for (const k of STANDARD) if (form[k]) claims[k] = form[k]
          if (form.email_verified) claims.email_verified = true
          for (const a of form.attributes ?? []) if (a.name.trim()) claims[a.name.trim()] = parsedValue(a.value)
          return {
            sub: form.sub,
            claims,
            groups: form.groups ?? [],
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
