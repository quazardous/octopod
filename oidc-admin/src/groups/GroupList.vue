<script setup lang="ts">
import { useListPage } from '@quazardous/qdadm'
import { ListPage } from '@quazardous/qdadm/components'
import Column from 'primevue/column'

const list = useListPage({ entity: 'groups' })

list.setSearch({ placeholder: 'Search groups...', fields: ['name', 'description', 'members'] })
list.addCreateAction('Add a group')
list.addEditAction()
list.addDeleteAction({ labelField: 'name' })
</script>

<template>
  <ListPage v-bind="list.props.value" v-on="list.events">
    <template #columns>
      <Column field="name" header="Group" sortable />
      <Column field="description" header="What it is for" />
      <Column field="members" header="Members">
        <template #body="{ data }">{{ data.members || 'nobody' }}</template>
      </Column>
      <Column field="claims" header="Claims">
        <template #body="{ data }"><code>{{ JSON.stringify(JSON.parse(data.claims)) }}</code></template>
      </Column>
    </template>
  </ListPage>
</template>
