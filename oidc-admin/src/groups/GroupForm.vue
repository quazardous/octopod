<script setup lang="ts">
import { useEntityItemFormPage } from '@quazardous/qdadm'
import { FormPage, FormField, FormInput } from '@quazardous/qdadm/components'

const form = useEntityItemFormPage({ entity: 'groups' })
form.generateFields()

form.addSaveAction({ andClose: true })
form.addDeleteAction()
</script>

<template>
  <FormPage v-bind="form.props.value" v-on="form.events">
    <template #fields>
      <FormField v-for="field in form.fields.value" :key="field.name" :name="field.name" :label="field.label">
        <FormInput :field="field" v-model="form.data.value[field.name]" />
      </FormField>
    </template>
  </FormPage>
</template>
