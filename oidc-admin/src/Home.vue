<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

// The admin has one page worth opening: the users.
const router = useRouter()
onMounted(() => router.replace('/users'))
</script>

<template><div /></template>
