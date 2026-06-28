// @ts-check
import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import starlight from '@astrojs/starlight'
import react from '@astrojs/react'

// 仓库: jadepam/mail-agent
// GitHub Pages URL: https://jadepam.github.io/mail-agent/
export default defineConfig({
  site: 'https://jadepam.github.io',
  base: '/mail-agent',
  integrations: [
    starlight({
      title: 'Mail Agent',
      customCss: ['./src/styles/starlight.css'],
      locales: {
        root: {
          label: '简体中文',
          lang: 'zh-CN',
        },
        en: {
          label: 'English',
          lang: 'en',
        },
      },
      sidebar: [
        { label: '快速开始', translations: { en: 'Getting Started' }, slug: 'getting-started' },
        { label: 'CLI 命令参考', translations: { en: 'CLI Reference' }, slug: 'cli-reference' },
        { label: 'MCP 工具参考', translations: { en: 'MCP Tools' }, slug: 'mcp-tools' },
        { label: '支持的邮箱', translations: { en: 'Supported Providers' }, slug: 'supported-providers' },
        { label: '配置文件参考', translations: { en: 'Config Reference' }, slug: 'config-reference' },
      ],
      components: {
        ThemeProvider: './src/components/ThemeProvider.astro',
        Header: './src/components/Header.astro',
        Hero: './src/components/Hero.astro',
      },
    }),
    mdx(),
    react(),
  ],
  vite: {
    resolve: {
      alias: {
        '~': new URL('./src/', import.meta.url).pathname,
      },
    },
    css: {
      postcss: {
        plugins: [
          // @ts-ignore
          (await import('@tailwindcss/postcss')).default(),
        ],
      },
    },
  },
})
