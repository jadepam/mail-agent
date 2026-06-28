import { defineCollection, z } from 'astro:content'
import { glob } from 'astro/loaders'
import { docsSchema } from '@astrojs/starlight/schema'
import { docsLoader } from '@astrojs/starlight/loaders'

const docs = defineCollection({
  loader: docsLoader(),
  schema: docsSchema(),
})

const changelog = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/changelog' }),
  schema: z.object({
    title: z.string(),
    version: z.string(),
    date: z.date(),
    source: z.enum(['git', 'manual']),
  }),
})

const faq = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/faq' }),
  schema: z.object({
    title: z.string(),
    source: z.enum(['issues', 'manual']),
  }),
})

export const collections = { docs, changelog, faq }
