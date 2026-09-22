import { configDefaults, defineConfig } from 'vitest/config';

// Git worktrees of this repository can live inside it (.claude/worktrees): their copies of
// the suites must not run with this one — two real-Docker suites sharing names and ports
// collide.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
});
