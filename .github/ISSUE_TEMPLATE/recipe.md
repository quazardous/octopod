---
name: Recipe
about: Propose a built-in recipe, or a change to one
labels: recipe
---

**The service**

What it runs (image and version), and how a project reaches it (port, exported values).

**Why built in**

Why it belongs in octopod rather than in a recipe folder of your own (`OCTOPOD_RECIPES`,
or `recipes:` in `octopod.yaml`), which needs no change here.

**Parameters and data**

The typed parameters it takes, the secrets it generates, the volumes it keeps in the
project's `.octopod/data/`.

**Checklist**

- [ ] The image tag is pinned (or `unpinned: true`, with a reason).
- [ ] Nothing in the project ends up owned by root.
- [ ] No dependency is installed in the image.
- [ ] A test in `src/recipes/recipes.test.ts` covers what it renders.
