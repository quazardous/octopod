<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useEntityItemFormPage } from '@quazardous/qdadm'
import { FormPage, FormField, FormInput } from '@quazardous/qdadm/components'
import AutoComplete from 'primevue/autocomplete'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import { http } from '../http'
import type { Attribute } from './UsersModule'

const form = useEntityItemFormPage({ entity: 'users' })
form.generateFields()

form.addSaveAction({ andClose: true })
form.addDeleteAction()

// The groups that exist, to pick from; a name typed and entered makes a new one.
const known = ref<string[]>([])
const suggestions = ref<string[]>([])
onMounted(async () => {
  known.value = ((await http.get<{ groups: { name: string }[] }>('/admin/api/groups')).data.groups ?? []).map((g) => g.name)
})
const suggest = (e: { query: string }) => {
  const q = e.query.trim().toLowerCase()
  suggestions.value = [...known.value.filter((g) => g.toLowerCase().includes(q)), ...(q && !known.value.some((g) => g.toLowerCase() === q) ? [e.query.trim()] : [])]
}

const rows = () => form.data.value.attributes as Attribute[]
const addRow = () => (form.data.value.attributes = [...rows(), { name: '', value: '' }])
const removeRow = (i: number) => (form.data.value.attributes = rows().filter((_, j) => j !== i))
</script>

<template>
  <FormPage v-bind="form.props.value" v-on="form.events">
    <template #fields>
      <FormField v-for="field in form.fields.value" :key="field.name" :name="field.name" :label="field.label">
        <AutoComplete
          v-if="field.name === 'groups'"
          v-model="form.data.value.groups"
          multiple
          dropdown
          :suggestions="suggestions"
          placeholder="Pick a group, or type a new one and press Enter"
          fluid
          @complete="suggest"
        />
        <div v-else-if="field.name === 'attributes'" class="attributes">
          <div v-for="(row, i) in rows()" :key="i" class="attribute">
            <InputText v-model="row.name" placeholder="name (department)" />
            <InputText v-model="row.value" placeholder="value (text, or JSON: 3, true, [&quot;a&quot;])" />
            <Button icon="pi pi-times" text severity="secondary" aria-label="Remove" @click="removeRow(i)" />
          </div>
          <Button label="Add an attribute" icon="pi pi-plus" text @click="addRow" />
        </div>
        <FormInput v-else :field="field" v-model="form.data.value[field.name]" />
      </FormField>
    </template>
  </FormPage>
</template>

<style scoped>
.attributes { display: flex; flex-direction: column; gap: 0.5rem; }
.attribute { display: grid; grid-template-columns: 1fr 2fr auto; gap: 0.5rem; }
</style>
