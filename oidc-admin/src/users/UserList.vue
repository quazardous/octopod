<script setup lang="ts">
import { useListPage } from '@quazardous/qdadm'
import { ListPage } from '@quazardous/qdadm/components'
import Column from 'primevue/column'

const list = useListPage({ entity: 'users' })

list.setSearch({ placeholder: 'Search users...', fields: ['sub', 'email', 'name'] })
list.addCreateAction('Add a user')
list.addEditAction()
list.addDeleteAction({ labelField: 'sub' })
</script>

<template>
  <ListPage v-bind="list.props.value" v-on="list.events">
    <template #columns>
      <Column field="sub" header="User" sortable />
      <Column field="groups" header="Groups">
        <template #body="{ data }">{{ data.groups.join(', ') || '—' }}</template>
      </Column>
      <Column field="email" header="email" />
      <Column field="has_password" header="Password" style="width: 110px">
        <template #body="{ data }">{{ data.has_password ? 'yes' : 'none' }}</template>
      </Column>
      <Column field="issuers" header="Issuers">
        <template #body="{ data }">{{ data.issuers || 'all' }}</template>
      </Column>
    </template>
  </ListPage>
</template>
