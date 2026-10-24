<script setup lang="ts">
import { LoginPage } from '@quazardous/qdadm/components'
</script>

<template>
  <LoginPage>
    <template #footer>
      <p class="hint">Any user name; the password is the admin token: <code>octopod secrets &lt;project&gt;</code>, the service's <code>admin-token</code>.</p>
    </template>
  </LoginPage>
</template>

<style scoped>
.hint { margin-top: 1rem; text-align: center; font-size: 0.875rem; color: var(--p-surface-500, rgb(100 116 139)); }
</style>
