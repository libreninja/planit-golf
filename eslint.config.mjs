import nextVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = [
  // Ignore generated build output and nested git-worktree clones so repo-wide
  // `pnpm lint` lints only this checkout's source. Without this, the flat
  // config lints `.next/**` build artifacts and `.worktrees/**` sibling
  // worktrees (which are gitignored), producing hundreds of false errors that
  // mask real source issues. No source directories are ignored here.
  {
    ignores: ['.next/**', '.worktrees/**'],
  },
  ...nextVitals,
]

export default eslintConfig
