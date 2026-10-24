<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { LoginPage } from '@quazardous/qdadm/components'

// An admin that asks for nothing gives its token: the form comes filled in.
const ready = ref(false)
const token = ref('')
onMounted(async () => {
  const session = await fetch('/admin/api/session').then((r) => r.json() as Promise<{ token?: string }>, () => ({}) as { token?: string })
  token.value = session.token ?? ''
  ready.value = true
})
</script>

<template>
  <LoginPage v-if="ready" default-username="admin" :default-password="token">
    <template #footer>
      <p v-if="token" class="hint">Filled in: <code>admin</code>, and the admin token. Sign in.</p>
      <p v-else class="hint">Any user name; the password is the admin token: <code>octopod secrets &lt;project&gt;</code>, the service's <code>admin-token</code>.</p>
    </template>
  </LoginPage>
</template>

<style scoped>
.hint { margin-top: 1rem; text-align: center; font-size: 0.875rem; color: var(--p-surface-500, rgb(100 116 139)); }
</style>
