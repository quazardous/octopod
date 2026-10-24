import { Kernel } from '@quazardous/qdadm'
import { AppLayout } from '@quazardous/qdadm/components'
import { createLocalStorageRolesProvider } from '@quazardous/qdadm/security'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import '@quazardous/qdadm/styles'
import 'primeicons/primeicons.css'

import App from './App.vue'
import { authAdapter } from './auth'
import { UsersModule } from './users/UsersModule'

const kernel = new Kernel({
  root: App,
  hashMode: true,
  moduleDefs: [UsersModule],
  pages: { layout: AppLayout, login: () => import('./Login.vue') },
  authAdapter,
  entityAuthAdapter: () => authAdapter.getUser(),
  security: {
    // One role: whoever has the admin token administers the users.
    rolesProvider: createLocalStorageRolesProvider({
      key: 'octopod_oidc_admin_roles',
      defaults: { role_hierarchy: {}, role_permissions: { ROLE_ADMIN: ['entity:*:read', 'entity:*:list', 'entity:*:create', 'entity:*:update', 'entity:*:delete'] } },
    }),
  },
  homeRoute: { name: 'home', component: () => import('./Home.vue') },
  primevue: { plugin: PrimeVue, theme: Aura },
  app: { name: 'OIDC users', shortName: 'ID' },
})

// An open admin skips its login: asked before the app starts.
authAdapter.openIfAllowed().finally(() => kernel.createApp().mount('#app'))
