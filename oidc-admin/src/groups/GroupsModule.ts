import { Module, EntityManager, ApiStorage } from '@quazardous/qdadm'
import { http } from '../http'

/** A group as the API gives it. */
interface ApiGroup {
  name: string
  description?: string
  claims?: Record<string, unknown>
  members: string[]
}

/** A group as the forms edit it: its claims as JSON text, its members in a line. */
interface FormGroup {
  id: string
  name: string
  description: string
  claims: string
  members: string
}

export class GroupsModule extends Module {
  static moduleName = 'groups'

  async connect(ctx: any) {
    ctx.entity('groups', new EntityManager({
      name: 'groups',
      labelField: 'name',
      fields: {
        name: { type: 'text', label: 'Group', required: true, default: '' },
        description: { type: 'text', label: 'What it is for', default: '' },
        claims: { type: 'textarea', label: 'Claims it gives its members (JSON, e.g. {"roles": ["admin"]})', default: '{}' },
        members: { type: 'text', label: 'Members (comma-separated user names)', default: '' },
      },
      storage: new ApiStorage({
        endpoint: '/admin/api/groups',
        client: http,
        responseItemsKey: 'groups',
        normalize: (g: any): any => {
          const group = g as ApiGroup
          return {
            id: group.name,
            name: group.name,
            description: group.description ?? '',
            claims: JSON.stringify(group.claims ?? {}, null, 2),
            members: group.members.join(', '),
          } satisfies FormGroup
        },
        denormalize: (f: any): any => {
          const form = f as Partial<FormGroup>
          return {
            name: form.name,
            description: form.description || null,
            claims: JSON.parse(form.claims || '{}'),
            members: (form.members ?? '').split(',').map((s) => s.trim()).filter(Boolean),
          }
        },
      }),
    }))

    ctx.crud('groups', {
      list: () => import('./GroupList.vue'),
      form: () => import('./GroupForm.vue'),
    }, { nav: { section: 'Provider', icon: 'pi pi-sitemap' } })
  }
}
