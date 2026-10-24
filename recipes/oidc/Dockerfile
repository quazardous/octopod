# syntax=docker/dockerfile:1
# GENERATED from src/oidc by scripts/oidc-dockerfile.mjs: edit those, then run
# `npm run oidc:recipe`. The provider runs as the image's `node` user, renamed after the
# project and moved to the operator's uid/gid; its signing key is kept in /data.
ARG BASE_IMAGE
# The admin app (oidc-admin, a qdadm app), built here; only its dist/ goes on.
FROM ${BASE_IMAGE} AS admin
WORKDIR /admin
COPY <<'OIDC_ADMIN_0' /admin/package.json
{
  "name": "octopod-oidc-admin",
  "private": true,
  "type": "module",
  "description": "The OIDC provider's admin: its users, on its admin API. A qdadm app, built into the oidc recipe's image.",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "@primeuix/themes": "1.2.5",
    "@quazardous/qdadm": "2.37.0",
    "pinia": "2.3.1",
    "primeicons": "7.0.0",
    "primevue": "4.5.4",
    "vue": "3.5.26",
    "vue-router": "4.6.4"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "5.2.4",
    "vite": "6.4.1"
  }
}
OIDC_ADMIN_0
COPY <<'OIDC_ADMIN_1' /admin/package-lock.json
{
  "name": "octopod-oidc-admin",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "octopod-oidc-admin",
      "dependencies": {
        "@primeuix/themes": "1.2.5",
        "@quazardous/qdadm": "2.37.0",
        "pinia": "2.3.1",
        "primeicons": "7.0.0",
        "primevue": "4.5.4",
        "vue": "3.5.26",
        "vue-router": "4.6.4"
      },
      "devDependencies": {
        "@vitejs/plugin-vue": "5.2.4",
        "vite": "6.4.1"
      }
    },
    "node_modules/@babel/helper-string-parser": {
      "version": "7.29.11",
      "resolved": "https://registry.npmjs.org/@babel/helper-string-parser/-/helper-string-parser-7.29.11.tgz",
      "integrity": "sha512-snZbO7MEDOof+hvNa97EjEY7qD7h2kwvQr5AJC3ZhQudKW5dnej6k3kP9NQV88hJwaS8vDqRLFo9rivLEhle2g==",
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/helper-validator-identifier": {
      "version": "7.29.7",
      "resolved": "https://registry.npmjs.org/@babel/helper-validator-identifier/-/helper-validator-identifier-7.29.7.tgz",
      "integrity": "sha512-qehxGkRj55h/ff8EMaJ+cYhyaKlHIxqYDn682wQD7RNp9UujOQsHog2uS0r2vzr4pW+sXf90NeeayjcNaX3fFg==",
      "license": "MIT",
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@babel/parser": {
      "version": "7.29.11",
      "resolved": "https://registry.npmjs.org/@babel/parser/-/parser-7.29.11.tgz",
      "integrity": "sha512-OZ6+oaK7GMyg3IfCpj8JOmn8n+w2rJbDT0LLfVDTLb1ZFeKDh3AiNELgCMUw175IJHSkLl74hG0M0VLsvx+gag==",
      "license": "MIT",
      "dependencies": {
        "@babel/types": "^7.29.11"
      },
      "bin": {
        "parser": "bin/babel-parser.js"
      },
      "engines": {
        "node": ">=6.0.0"
      }
    },
    "node_modules/@babel/types": {
      "version": "7.29.11",
      "resolved": "https://registry.npmjs.org/@babel/types/-/types-7.29.11.tgz",
      "integrity": "sha512-WCsemW40Cpc6gouC1SrY6PBaZ+oLRlEVY9XBvZBI7il/HyUrb2nJ505wE1MHEFyDZNnrWDEuy4jL50WVHfTTSQ==",
      "license": "MIT",
      "dependencies": {
        "@babel/helper-string-parser": "^7.29.11",
        "@babel/helper-validator-identifier": "^7.29.7"
      },
      "engines": {
        "node": ">=6.9.0"
      }
    },
    "node_modules/@esbuild/aix-ppc64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/aix-ppc64/-/aix-ppc64-0.25.12.tgz",
      "integrity": "sha512-Hhmwd6CInZ3dwpuGTF8fJG6yoWmsToE+vYgD4nytZVxcu1ulHpUQRAB1UJ8+N1Am3Mz4+xOByoQoSZf4D+CpkA==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "aix"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-arm": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/android-arm/-/android-arm-0.25.12.tgz",
      "integrity": "sha512-VJ+sKvNA/GE7Ccacc9Cha7bpS8nyzVv0jdVgwNDaR4gDMC/2TTRc33Ip8qrNYUcpkOHUT5OZ0bUcNNVZQ9RLlg==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-arm64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/android-arm64/-/android-arm64-0.25.12.tgz",
      "integrity": "sha512-6AAmLG7zwD1Z159jCKPvAxZd4y/VTO0VkprYy+3N2FtJ8+BQWFXU+OxARIwA46c5tdD9SsKGZ/1ocqBS/gAKHg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/android-x64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/android-x64/-/android-x64-0.25.12.tgz",
      "integrity": "sha512-5jbb+2hhDHx5phYR2By8GTWEzn6I9UqR11Kwf22iKbNpYrsmRB18aX/9ivc5cabcUiAT/wM+YIZ6SG9QO6a8kg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/darwin-arm64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/darwin-arm64/-/darwin-arm64-0.25.12.tgz",
      "integrity": "sha512-N3zl+lxHCifgIlcMUP5016ESkeQjLj/959RxxNYIthIg+CQHInujFuXeWbWMgnTo4cp5XVHqFPmpyu9J65C1Yg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/darwin-x64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/darwin-x64/-/darwin-x64-0.25.12.tgz",
      "integrity": "sha512-HQ9ka4Kx21qHXwtlTUVbKJOAnmG1ipXhdWTmNXiPzPfWKpXqASVcWdnf2bnL73wgjNrFXAa3yYvBSd9pzfEIpA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/freebsd-arm64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/freebsd-arm64/-/freebsd-arm64-0.25.12.tgz",
      "integrity": "sha512-gA0Bx759+7Jve03K1S0vkOu5Lg/85dou3EseOGUes8flVOGxbhDDh/iZaoek11Y8mtyKPGF3vP8XhnkDEAmzeg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/freebsd-x64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/freebsd-x64/-/freebsd-x64-0.25.12.tgz",
      "integrity": "sha512-TGbO26Yw2xsHzxtbVFGEXBFH0FRAP7gtcPE7P5yP7wGy7cXK2oO7RyOhL5NLiqTlBh47XhmIUXuGciXEqYFfBQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-arm": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-arm/-/linux-arm-0.25.12.tgz",
      "integrity": "sha512-lPDGyC1JPDou8kGcywY0YILzWlhhnRjdof3UlcoqYmS9El818LLfJJc3PXXgZHrHCAKs/Z2SeZtDJr5MrkxtOw==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-arm64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-arm64/-/linux-arm64-0.25.12.tgz",
      "integrity": "sha512-8bwX7a8FghIgrupcxb4aUmYDLp8pX06rGh5HqDT7bB+8Rdells6mHvrFHHW2JAOPZUbnjUpKTLg6ECyzvas2AQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-ia32": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-ia32/-/linux-ia32-0.25.12.tgz",
      "integrity": "sha512-0y9KrdVnbMM2/vG8KfU0byhUN+EFCny9+8g202gYqSSVMonbsCfLjUO+rCci7pM0WBEtz+oK/PIwHkzxkyharA==",
      "cpu": [
        "ia32"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-loong64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-loong64/-/linux-loong64-0.25.12.tgz",
      "integrity": "sha512-h///Lr5a9rib/v1GGqXVGzjL4TMvVTv+s1DPoxQdz7l/AYv6LDSxdIwzxkrPW438oUXiDtwM10o9PmwS/6Z0Ng==",
      "cpu": [
        "loong64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-mips64el": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-mips64el/-/linux-mips64el-0.25.12.tgz",
      "integrity": "sha512-iyRrM1Pzy9GFMDLsXn1iHUm18nhKnNMWscjmp4+hpafcZjrr2WbT//d20xaGljXDBYHqRcl8HnxbX6uaA/eGVw==",
      "cpu": [
        "mips64el"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-ppc64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-ppc64/-/linux-ppc64-0.25.12.tgz",
      "integrity": "sha512-9meM/lRXxMi5PSUqEXRCtVjEZBGwB7P/D4yT8UG/mwIdze2aV4Vo6U5gD3+RsoHXKkHCfSxZKzmDssVlRj1QQA==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-riscv64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-riscv64/-/linux-riscv64-0.25.12.tgz",
      "integrity": "sha512-Zr7KR4hgKUpWAwb1f3o5ygT04MzqVrGEGXGLnj15YQDJErYu/BGg+wmFlIDOdJp0PmB0lLvxFIOXZgFRrdjR0w==",
      "cpu": [
        "riscv64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-s390x": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-s390x/-/linux-s390x-0.25.12.tgz",
      "integrity": "sha512-MsKncOcgTNvdtiISc/jZs/Zf8d0cl/t3gYWX8J9ubBnVOwlk65UIEEvgBORTiljloIWnBzLs4qhzPkJcitIzIg==",
      "cpu": [
        "s390x"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/linux-x64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/linux-x64/-/linux-x64-0.25.12.tgz",
      "integrity": "sha512-uqZMTLr/zR/ed4jIGnwSLkaHmPjOjJvnm6TVVitAa08SLS9Z0VM8wIRx7gWbJB5/J54YuIMInDquWyYvQLZkgw==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/netbsd-arm64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/netbsd-arm64/-/netbsd-arm64-0.25.12.tgz",
      "integrity": "sha512-xXwcTq4GhRM7J9A8Gv5boanHhRa/Q9KLVmcyXHCTaM4wKfIpWkdXiMog/KsnxzJ0A1+nD+zoecuzqPmCRyBGjg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "netbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/netbsd-x64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/netbsd-x64/-/netbsd-x64-0.25.12.tgz",
      "integrity": "sha512-Ld5pTlzPy3YwGec4OuHh1aCVCRvOXdH8DgRjfDy/oumVovmuSzWfnSJg+VtakB9Cm0gxNO9BzWkj6mtO1FMXkQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "netbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/openbsd-arm64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/openbsd-arm64/-/openbsd-arm64-0.25.12.tgz",
      "integrity": "sha512-fF96T6KsBo/pkQI950FARU9apGNTSlZGsv1jZBAlcLL1MLjLNIWPBkj5NlSz8aAzYKg+eNqknrUJ24QBybeR5A==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/openbsd-x64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/openbsd-x64/-/openbsd-x64-0.25.12.tgz",
      "integrity": "sha512-MZyXUkZHjQxUvzK7rN8DJ3SRmrVrke8ZyRusHlP+kuwqTcfWLyqMOE3sScPPyeIXN/mDJIfGXvcMqCgYKekoQw==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openbsd"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/openharmony-arm64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/openharmony-arm64/-/openharmony-arm64-0.25.12.tgz",
      "integrity": "sha512-rm0YWsqUSRrjncSXGA7Zv78Nbnw4XL6/dzr20cyrQf7ZmRcsovpcRBdhD43Nuk3y7XIoW2OxMVvwuRvk9XdASg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openharmony"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/sunos-x64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/sunos-x64/-/sunos-x64-0.25.12.tgz",
      "integrity": "sha512-3wGSCDyuTHQUzt0nV7bocDy72r2lI33QL3gkDNGkod22EsYl04sMf0qLb8luNKTOmgF/eDEDP5BFNwoBKH441w==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "sunos"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-arm64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-arm64/-/win32-arm64-0.25.12.tgz",
      "integrity": "sha512-rMmLrur64A7+DKlnSuwqUdRKyd3UE7oPJZmnljqEptesKM8wx9J8gx5u0+9Pq0fQQW8vqeKebwNXdfOyP+8Bsg==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-ia32": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-ia32/-/win32-ia32-0.25.12.tgz",
      "integrity": "sha512-HkqnmmBoCbCwxUKKNPBixiWDGCpQGVsrQfJoVGYLPT41XWF8lHuE5N6WhVia2n4o5QK5M4tYr21827fNhi4byQ==",
      "cpu": [
        "ia32"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@esbuild/win32-x64": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/@esbuild/win32-x64/-/win32-x64-0.25.12.tgz",
      "integrity": "sha512-alJC0uCZpTFrSL0CCDjcgleBXPnCrEAhTBILpeAp7M/OFgoqtAetfBzX0xM00MUsVVPpVjlPuMbREqnZCXaTnA==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ],
      "engines": {
        "node": ">=18"
      }
    },
    "node_modules/@jridgewell/sourcemap-codec": {
      "version": "1.6.0",
      "resolved": "https://registry.npmjs.org/@jridgewell/sourcemap-codec/-/sourcemap-codec-1.6.0.tgz",
      "integrity": "sha512-T7jf+5zgsZHwNJ4lvQ7/aezbyk0nNX+zJVWpmHA7VYsEx7a7qr5Rg5IbtJFqkgze5Y2sruq1RUY8Q837Od7iFw==",
      "license": "MIT"
    },
    "node_modules/@napi-rs/lzma-linux-x64-gnu": {
      "version": "1.5.1",
      "resolved": "https://registry.npmjs.org/@napi-rs/lzma-linux-x64-gnu/-/lzma-linux-x64-gnu-1.5.1.tgz",
      "integrity": "sha512-oTXEIha4SsuXdTA4Iyskj0kpdx2yVXdhd75c2v3xGrHFfVMsbhTPZU/nMPL4sWKo4pBHm3aucLaqGlF696dTyQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ],
      "engines": {
        "node": "^22.20 || ^24.12 || >=25"
      }
    },
    "node_modules/@primeuix/styled": {
      "version": "0.7.4",
      "resolved": "https://registry.npmjs.org/@primeuix/styled/-/styled-0.7.4.tgz",
      "integrity": "sha512-QSO/NpOQg8e9BONWRBx9y8VGMCMYz0J/uKfNJEya/RGEu7ARx0oYW0ugI1N3/KB1AAvyGxzKBzGImbwg0KUiOQ==",
      "license": "MIT",
      "dependencies": {
        "@primeuix/utils": "^0.6.1"
      },
      "engines": {
        "node": ">=12.11.0"
      }
    },
    "node_modules/@primeuix/styles": {
      "version": "2.0.3",
      "resolved": "https://registry.npmjs.org/@primeuix/styles/-/styles-2.0.3.tgz",
      "integrity": "sha512-2ykAB6BaHzR/6TwF8ShpJTsZrid6cVIEBVlookSdvOdmlWuevGu5vWOScgIwqWwlZcvkFYAGR/SUV3OHCTBMdw==",
      "license": "MIT",
      "dependencies": {
        "@primeuix/styled": "^0.7.4"
      }
    },
    "node_modules/@primeuix/themes": {
      "version": "1.2.5",
      "resolved": "https://registry.npmjs.org/@primeuix/themes/-/themes-1.2.5.tgz",
      "integrity": "sha512-n3YkwJrHQaEESc/D/A/iD815sxp8cKnmzscA6a8Tm8YvMtYU32eCahwLLe6h5rywghVwxASWuG36XBgISYOIjQ==",
      "license": "MIT",
      "dependencies": {
        "@primeuix/styled": "^0.7.3"
      }
    },
    "node_modules/@primeuix/utils": {
      "version": "0.6.4",
      "resolved": "https://registry.npmjs.org/@primeuix/utils/-/utils-0.6.4.tgz",
      "integrity": "sha512-pZ5f+vj7wSzRhC7KoEQRU5fvYAe+RP9+m39CTscZ3UywCD1Y2o6Fe1rRgklMPSkzUcty2jzkA0zMYkiJBD1hgg==",
      "license": "MIT",
      "engines": {
        "node": ">=12.11.0"
      }
    },
    "node_modules/@primevue/core": {
      "version": "4.5.4",
      "resolved": "https://registry.npmjs.org/@primevue/core/-/core-4.5.4.tgz",
      "integrity": "sha512-lYJJB3wTrDJ8MkLctzHfrPZAqXVxoatjIsswSJzupatf6ZogJHVYADUKcn1JAkLLk8dtV1FA2AxDek663fHO5Q==",
      "license": "MIT",
      "dependencies": {
        "@primeuix/styled": "^0.7.4",
        "@primeuix/utils": "^0.6.2"
      },
      "engines": {
        "node": ">=12.11.0"
      },
      "peerDependencies": {
        "vue": "^3.5.0"
      }
    },
    "node_modules/@primevue/icons": {
      "version": "4.5.4",
      "resolved": "https://registry.npmjs.org/@primevue/icons/-/icons-4.5.4.tgz",
      "integrity": "sha512-DxgryEc7ZmUqcEhYMcxGBRyFzdtLIoy3jLtlH1zsVSRZaG+iSAcjQ88nvfkZxGUZtZBFL7sRjF6KLq3bJZJwUw==",
      "license": "MIT",
      "dependencies": {
        "@primeuix/utils": "^0.6.2",
        "@primevue/core": "4.5.4"
      },
      "engines": {
        "node": ">=12.11.0"
      }
    },
    "node_modules/@quazardous/qdadm": {
      "version": "2.37.0",
      "resolved": "https://registry.npmjs.org/@quazardous/qdadm/-/qdadm-2.37.0.tgz",
      "integrity": "sha512-VKZexYl96rzrg2nHA0C4pV+uvyFvAMgthWC84YDNj8qdXEKhc0sOgoAFsHXcOI0lJhiOZzh1UMMKoFYv1SsGDA==",
      "license": "MIT",
      "dependencies": {
        "@quazardous/qdcore": "^1.3.0",
        "@quazardous/qddebug": "^1.3.0",
        "@quazardous/quarkernel": "^2.1.0",
        "yaml": "^2.8.4"
      },
      "peerDependencies": {
        "pinia": "^2.0.0 || ^3.0.0 || ^4.0.0",
        "postal-mime": ">=3.0.0",
        "primevue": "^4.0.0",
        "sass-embedded": "^1.0.0",
        "vanilla-jsoneditor": "^3.13.0",
        "vite": "^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0",
        "vue": "^3.3.0",
        "vue-router": "^4.0.0 || ^5.0.0"
      },
      "peerDependenciesMeta": {
        "postal-mime": {
          "optional": true
        },
        "primevue": {
          "optional": true
        },
        "sass-embedded": {
          "optional": true
        },
        "vanilla-jsoneditor": {
          "optional": true
        },
        "vite": {
          "optional": true
        }
      }
    },
    "node_modules/@quazardous/qdcore": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/@quazardous/qdcore/-/qdcore-1.3.0.tgz",
      "integrity": "sha512-DxAkNM3ELFrSedlaJoRMaGZ1SOt8n7bqdpwYxdlD/dUoNnFOn52o5LXUqRMNsa6w09GdRX/fSRBA70VgLpsgiw==",
      "license": "MIT",
      "dependencies": {
        "@quazardous/quarkernel": "^2.1.0"
      }
    },
    "node_modules/@quazardous/qddebug": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/@quazardous/qddebug/-/qddebug-1.3.0.tgz",
      "integrity": "sha512-t02zcN2uNYXG/038DhDkcWrUK9zmscTvYbXqmH5o5pu47MZb4uRGQblkMvjVZ1HoPcpbfwVEwzYCHuRXkopavw==",
      "license": "MIT",
      "dependencies": {
        "@quazardous/qdcore": "^1.0.0",
        "primeicons": "^7.0.0"
      },
      "peerDependencies": {
        "vue": "^3.3.0"
      }
    },
    "node_modules/@quazardous/quarkernel": {
      "version": "2.4.0",
      "resolved": "https://registry.npmjs.org/@quazardous/quarkernel/-/quarkernel-2.4.0.tgz",
      "integrity": "sha512-/Ou+UYtXQ/nR1HMVYnDw5UPCl2PezDlMUvsO82DRPFSPTnDH3aoBW3bnVA+F2xjnf5RWoBOoKg8y5nNFVZnang==",
      "license": "MIT",
      "engines": {
        "node": ">=18.0.0"
      }
    },
    "node_modules/@rollup/rollup-android-arm-eabi": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-android-arm-eabi/-/rollup-android-arm-eabi-4.65.0.tgz",
      "integrity": "sha512-t2AnVba25baFdq7gczzS13JyVcdubLVbFX1X04mxrggDrTQPUXNv3XM0k9H1hr5tqvg7AVvtQ720QHAj0iYqhg==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ]
    },
    "node_modules/@rollup/rollup-android-arm64": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-android-arm64/-/rollup-android-arm64-4.65.0.tgz",
      "integrity": "sha512-dNONUaEwPGhl/nuO2KV8VABWlcjYyU6KtZGN8dQv5OS5JU7JSCxPijVNKXbRJd0iuTzTiJ4TjPt/4bbvDRNiMQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "android"
      ]
    },
    "node_modules/@rollup/rollup-darwin-arm64": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-darwin-arm64/-/rollup-darwin-arm64-4.65.0.tgz",
      "integrity": "sha512-zWQqUH+9zavr2Bxuzfpuv2SIF3X31cr58TvSQC9o1GhpOvkqRwr60GkZdQcudyT/BEgdpdSafjgd2I13MbTL7g==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ]
    },
    "node_modules/@rollup/rollup-darwin-x64": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-darwin-x64/-/rollup-darwin-x64-4.65.0.tgz",
      "integrity": "sha512-RQYreBFWtO4//hIuOaZkYUnF/lPU4lz35dveDimDshWCJvVisVtJ/shmT9bkXK8wFJY+FJF89X6F3Cq1qI3LCw==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ]
    },
    "node_modules/@rollup/rollup-freebsd-arm64": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-freebsd-arm64/-/rollup-freebsd-arm64-4.65.0.tgz",
      "integrity": "sha512-A0NfMj6Cuh/9BE5k3awJKv6HoxFVXIcLAb6SZqAMoxUHPA1ZNNK4RsGuUPD/vL7nEAm9LG+ZzXWWTrnC0XtkpA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ]
    },
    "node_modules/@rollup/rollup-freebsd-x64": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-freebsd-x64/-/rollup-freebsd-x64-4.65.0.tgz",
      "integrity": "sha512-BI6/H7q3aP0I7S7GOrjyxTjgEJlSnovXE38+bdxBpuKN6z+d//uF+T+VQ3Q7ltJL/71p17ufartARX9Ja5gOGQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "freebsd"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm-gnueabihf": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm-gnueabihf/-/rollup-linux-arm-gnueabihf-4.65.0.tgz",
      "integrity": "sha512-W1vUprf09RWaVWnsFP1vlUkEWJzTZlpObOEAYZXt9Fq0UVAOYEkeGr7wBX7McKqqIQskXdBnpiOMgwPujordgA==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm-musleabihf": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm-musleabihf/-/rollup-linux-arm-musleabihf-4.65.0.tgz",
      "integrity": "sha512-s8QTcZWgrl9haFzEGIqyE5BWyo89pFDGLMBFZ752WYxk8DJwNU/O1X6pZgPw829d9/sm6CCHyrMP3aurt76p1Q==",
      "cpu": [
        "arm"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm64-gnu": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm64-gnu/-/rollup-linux-arm64-gnu-4.65.0.tgz",
      "integrity": "sha512-ke1f6dLRzkqveyjjF2fkEwQYZvxHtNNwjegY8nJrwcO0Bdqr8CzFO/pKE0Bns13cx0qz2Ba2Y0Hs3dSwMdnHxA==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-arm64-musl": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-arm64-musl/-/rollup-linux-arm64-musl-4.65.0.tgz",
      "integrity": "sha512-926SMeUcy4y18Rz/w2aJiUKOnyAnm6czg72bXkQEaeemsll+Wr0hnsjb2BGRpHvWgwAMYy5ACJCotbvfLCfj0A==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-loong64-gnu": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-loong64-gnu/-/rollup-linux-loong64-gnu-4.65.0.tgz",
      "integrity": "sha512-6T7JNRP1hc4hqF2dUsEoVLOt9K8tmODoCLldtQRYnrddGGQY8Gqe2pM/qMMUo7EMowpP7oa2N95k0/8sYK/ipw==",
      "cpu": [
        "loong64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-loong64-musl": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-loong64-musl/-/rollup-linux-loong64-musl-4.65.0.tgz",
      "integrity": "sha512-SImGFl1Je5kpyAgOCPONVT7h6ASV8mAUwGRjY7eZvVjPg//PfHOXgI+P241RF/+HqsA4PP3qD527ysWFKNQyhQ==",
      "cpu": [
        "loong64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-ppc64-gnu": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-ppc64-gnu/-/rollup-linux-ppc64-gnu-4.65.0.tgz",
      "integrity": "sha512-XeDTbmPF1Yu5asfXGPrMkWoxTDhgryQbmw5Q1+R582O51VNCk23J6f2pDrsAp5YkneBVBwtExx6ZGOb9D2aQ6A==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-ppc64-musl": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-ppc64-musl/-/rollup-linux-ppc64-musl-4.65.0.tgz",
      "integrity": "sha512-VS55JUI/1nsljmV/jfqNkLZXFw8uMO8nNlfoHmSevNf6fO3neuhyDvx9dv3c/Ytt8r/431SL8Qax1dpYvOMZTg==",
      "cpu": [
        "ppc64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-riscv64-gnu": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-riscv64-gnu/-/rollup-linux-riscv64-gnu-4.65.0.tgz",
      "integrity": "sha512-Vblw84TbX7RS4la1Y4+yQ7aore/oSyaNtFbppuBr5Vs/4LfBeXKq9dIfoExw6zOvRERqd2rRAjnZRaMhH/0x5w==",
      "cpu": [
        "riscv64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-riscv64-musl": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-riscv64-musl/-/rollup-linux-riscv64-musl-4.65.0.tgz",
      "integrity": "sha512-7+gHjtONvKgwR9InTKFaLq53f6YzBJkgeMRBENdWTsQr+spahGqQm8HF5aXpq8i4JaRrOqYyv6Zn1WltDTxaZQ==",
      "cpu": [
        "riscv64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-s390x-gnu": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-s390x-gnu/-/rollup-linux-s390x-gnu-4.65.0.tgz",
      "integrity": "sha512-KvNDC0J6s4vVHhtJ6KrDXU0Er0au/hmRIBq/+1maCV8TseGupeKizq0bWcrbp2HE1T8xoknvN0Q/KZ/YF0qX3w==",
      "cpu": [
        "s390x"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-x64-gnu": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-x64-gnu/-/rollup-linux-x64-gnu-4.65.0.tgz",
      "integrity": "sha512-GExdD15WPvu/x/drELjVam7vX8EsPgvTMOa/iJL/p/4m/oOqzbb7JXZg8fXR4hlXtg/sF2zyTZ3bR0AEtEMlhQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-linux-x64-musl": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-linux-x64-musl/-/rollup-linux-x64-musl-4.65.0.tgz",
      "integrity": "sha512-8sT9PemIZfIMED4Vd4KGoOXVDj5CMSWNcGdbheRUx9TYS03yOWdT2Q0lXPyEyNBB9YTilwewIQKNIBk6Nxi0Kg==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "linux"
      ]
    },
    "node_modules/@rollup/rollup-openbsd-x64": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-openbsd-x64/-/rollup-openbsd-x64-4.65.0.tgz",
      "integrity": "sha512-pO6Ehi0jo5yE0R6PltKhJhv9mlIiyzBJk5N5NUF2OF6xtVKI+1bdXxj/rb0jGXy3hck1ELVT0QPY3tzkAm360w==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openbsd"
      ]
    },
    "node_modules/@rollup/rollup-openharmony-arm64": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-openharmony-arm64/-/rollup-openharmony-arm64-4.65.0.tgz",
      "integrity": "sha512-vo7N3/+cjjPDYr8vtxC+qSNgWa9sDvJ7g8N8R5SWqFY4WiNH1ULcAU70SKVyHeiIZOYYwNP9pTipmhN5sl1NPw==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "openharmony"
      ]
    },
    "node_modules/@rollup/rollup-win32-arm64-msvc": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-arm64-msvc/-/rollup-win32-arm64-msvc-4.65.0.tgz",
      "integrity": "sha512-ArwvgFAbjKcDM7qqotZ4OVYf+UMT9xH2YzkCzK4+AuZSDihMlz1Ekoe4INwBVXzn2mnJzuIYOcSx07iTBijGRQ==",
      "cpu": [
        "arm64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@rollup/rollup-win32-ia32-msvc": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-ia32-msvc/-/rollup-win32-ia32-msvc-4.65.0.tgz",
      "integrity": "sha512-QGMmK4/cxKE/36FoLMSHQBCyymv/eFTnsCvvsBF0rgmOvVbvX78VWZRerL3dHa77f4pM6Xcc2iGDhJ10w/svKQ==",
      "cpu": [
        "ia32"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@rollup/rollup-win32-x64-gnu": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-x64-gnu/-/rollup-win32-x64-gnu-4.65.0.tgz",
      "integrity": "sha512-XfKYFWHIPs4HPODIMsGF1IKlS3H1e3WokUZIgpmn4+uNnZBlnRDDHEylNyazbQXwhMKZre68OjtRYbKqb5+j8w==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@rollup/rollup-win32-x64-msvc": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/@rollup/rollup-win32-x64-msvc/-/rollup-win32-x64-msvc-4.65.0.tgz",
      "integrity": "sha512-wPWi++K4Bs1VR4XihOhfGi4IGX6Cub7FlerTf8X2v+2BtDHddgSqWCXwGD+h2yAe4/niIhNDwAltioOC+wEogQ==",
      "cpu": [
        "x64"
      ],
      "dev": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "win32"
      ]
    },
    "node_modules/@types/estree": {
      "version": "1.0.9",
      "resolved": "https://registry.npmjs.org/@types/estree/-/estree-1.0.9.tgz",
      "integrity": "sha512-GhdPgy1el4/ImP05X05Uw4cw2/M93BCUmnEvWZNStlCzEKME4Fkk+YpoA5OiHNQmoS7Cafb8Xa3Pya8m1Qrzeg==",
      "dev": true,
      "license": "MIT"
    },
    "node_modules/@vitejs/plugin-vue": {
      "version": "5.2.4",
      "resolved": "https://registry.npmjs.org/@vitejs/plugin-vue/-/plugin-vue-5.2.4.tgz",
      "integrity": "sha512-7Yx/SXSOcQq5HiiV3orevHUFn+pmMB4cgbEkDYgnkUWb0WfeQ/wa2yFv6D5ICiCQOVpjA7vYDXrC7AGO8yjDHA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": "^18.0.0 || >=20.0.0"
      },
      "peerDependencies": {
        "vite": "^5.0.0 || ^6.0.0",
        "vue": "^3.2.25"
      }
    },
    "node_modules/@vue/compiler-core": {
      "version": "3.5.26",
      "resolved": "https://registry.npmjs.org/@vue/compiler-core/-/compiler-core-3.5.26.tgz",
      "integrity": "sha512-vXyI5GMfuoBCnv5ucIT7jhHKl55Y477yxP6fc4eUswjP8FG3FFVFd41eNDArR+Uk3QKn2Z85NavjaxLxOC19/w==",
      "license": "MIT",
      "dependencies": {
        "@babel/parser": "^7.28.5",
        "@vue/shared": "3.5.26",
        "entities": "^7.0.0",
        "estree-walker": "^2.0.2",
        "source-map-js": "^1.2.1"
      }
    },
    "node_modules/@vue/compiler-dom": {
      "version": "3.5.26",
      "resolved": "https://registry.npmjs.org/@vue/compiler-dom/-/compiler-dom-3.5.26.tgz",
      "integrity": "sha512-y1Tcd3eXs834QjswshSilCBnKGeQjQXB6PqFn/1nxcQw4pmG42G8lwz+FZPAZAby6gZeHSt/8LMPfZ4Rb+Bd/A==",
      "license": "MIT",
      "dependencies": {
        "@vue/compiler-core": "3.5.26",
        "@vue/shared": "3.5.26"
      }
    },
    "node_modules/@vue/compiler-sfc": {
      "version": "3.5.26",
      "resolved": "https://registry.npmjs.org/@vue/compiler-sfc/-/compiler-sfc-3.5.26.tgz",
      "integrity": "sha512-egp69qDTSEZcf4bGOSsprUr4xI73wfrY5oRs6GSgXFTiHrWj4Y3X5Ydtip9QMqiCMCPVwLglB9GBxXtTadJ3mA==",
      "license": "MIT",
      "dependencies": {
        "@babel/parser": "^7.28.5",
        "@vue/compiler-core": "3.5.26",
        "@vue/compiler-dom": "3.5.26",
        "@vue/compiler-ssr": "3.5.26",
        "@vue/shared": "3.5.26",
        "estree-walker": "^2.0.2",
        "magic-string": "^0.30.21",
        "postcss": "^8.5.6",
        "source-map-js": "^1.2.1"
      }
    },
    "node_modules/@vue/compiler-ssr": {
      "version": "3.5.26",
      "resolved": "https://registry.npmjs.org/@vue/compiler-ssr/-/compiler-ssr-3.5.26.tgz",
      "integrity": "sha512-lZT9/Y0nSIRUPVvapFJEVDbEXruZh2IYHMk2zTtEgJSlP5gVOqeWXH54xDKAaFS4rTnDeDBQUYDtxKyoW9FwDw==",
      "license": "MIT",
      "dependencies": {
        "@vue/compiler-dom": "3.5.26",
        "@vue/shared": "3.5.26"
      }
    },
    "node_modules/@vue/devtools-api": {
      "version": "6.6.4",
      "resolved": "https://registry.npmjs.org/@vue/devtools-api/-/devtools-api-6.6.4.tgz",
      "integrity": "sha512-sGhTPMuXqZ1rVOk32RylztWkfXTRhuS7vgAKv0zjqk8gbsHkJ7xfFf+jbySxt7tWObEJwyKaHMikV/WGDiQm8g==",
      "license": "MIT"
    },
    "node_modules/@vue/reactivity": {
      "version": "3.5.26",
      "resolved": "https://registry.npmjs.org/@vue/reactivity/-/reactivity-3.5.26.tgz",
      "integrity": "sha512-9EnYB1/DIiUYYnzlnUBgwU32NNvLp/nhxLXeWRhHUEeWNTn1ECxX8aGO7RTXeX6PPcxe3LLuNBFoJbV4QZ+CFQ==",
      "license": "MIT",
      "dependencies": {
        "@vue/shared": "3.5.26"
      }
    },
    "node_modules/@vue/runtime-core": {
      "version": "3.5.26",
      "resolved": "https://registry.npmjs.org/@vue/runtime-core/-/runtime-core-3.5.26.tgz",
      "integrity": "sha512-xJWM9KH1kd201w5DvMDOwDHYhrdPTrAatn56oB/LRG4plEQeZRQLw0Bpwih9KYoqmzaxF0OKSn6swzYi84e1/Q==",
      "license": "MIT",
      "dependencies": {
        "@vue/reactivity": "3.5.26",
        "@vue/shared": "3.5.26"
      }
    },
    "node_modules/@vue/runtime-dom": {
      "version": "3.5.26",
      "resolved": "https://registry.npmjs.org/@vue/runtime-dom/-/runtime-dom-3.5.26.tgz",
      "integrity": "sha512-XLLd/+4sPC2ZkN/6+V4O4gjJu6kSDbHAChvsyWgm1oGbdSO3efvGYnm25yCjtFm/K7rrSDvSfPDgN1pHgS4VNQ==",
      "license": "MIT",
      "dependencies": {
        "@vue/reactivity": "3.5.26",
        "@vue/runtime-core": "3.5.26",
        "@vue/shared": "3.5.26",
        "csstype": "^3.2.3"
      }
    },
    "node_modules/@vue/server-renderer": {
      "version": "3.5.26",
      "resolved": "https://registry.npmjs.org/@vue/server-renderer/-/server-renderer-3.5.26.tgz",
      "integrity": "sha512-TYKLXmrwWKSodyVuO1WAubucd+1XlLg4set0YoV+Hu8Lo79mp/YMwWV5mC5FgtsDxX3qo1ONrxFaTP1OQgy1uA==",
      "license": "MIT",
      "dependencies": {
        "@vue/compiler-ssr": "3.5.26",
        "@vue/shared": "3.5.26"
      },
      "peerDependencies": {
        "vue": "3.5.26"
      }
    },
    "node_modules/@vue/shared": {
      "version": "3.5.26",
      "resolved": "https://registry.npmjs.org/@vue/shared/-/shared-3.5.26.tgz",
      "integrity": "sha512-7Z6/y3uFI5PRoKeorTOSXKcDj0MSasfNNltcslbFrPpcw6aXRUALq4IfJlaTRspiWIUOEZbrpM+iQGmCOiWe4A==",
      "license": "MIT"
    },
    "node_modules/csstype": {
      "version": "3.2.3",
      "resolved": "https://registry.npmjs.org/csstype/-/csstype-3.2.3.tgz",
      "integrity": "sha512-z1HGKcYy2xA8AGQfwrn0PAy+PB7X/GSj3UVJW9qKyn43xWa+gl5nXmU4qqLMRzWVLFC8KusUX8T/0kCiOYpAIQ==",
      "license": "MIT"
    },
    "node_modules/entities": {
      "version": "7.0.1",
      "resolved": "https://registry.npmjs.org/entities/-/entities-7.0.1.tgz",
      "integrity": "sha512-TWrgLOFUQTH994YUyl1yT4uyavY5nNB5muff+RtWaqNVCAK408b5ZnnbNAUEWLTCpum9w6arT70i1XdQ4UeOPA==",
      "license": "BSD-2-Clause",
      "engines": {
        "node": ">=0.12"
      },
      "funding": {
        "url": "https://github.com/fb55/entities?sponsor=1"
      }
    },
    "node_modules/esbuild": {
      "version": "0.25.12",
      "resolved": "https://registry.npmjs.org/esbuild/-/esbuild-0.25.12.tgz",
      "integrity": "sha512-bbPBYYrtZbkt6Os6FiTLCTFxvq4tt3JKall1vRwshA3fdVztsLAatFaZobhkBC8/BrPetoa0oksYoKXoG4ryJg==",
      "dev": true,
      "hasInstallScript": true,
      "license": "MIT",
      "bin": {
        "esbuild": "bin/esbuild"
      },
      "engines": {
        "node": ">=18"
      },
      "optionalDependencies": {
        "@esbuild/aix-ppc64": "0.25.12",
        "@esbuild/android-arm": "0.25.12",
        "@esbuild/android-arm64": "0.25.12",
        "@esbuild/android-x64": "0.25.12",
        "@esbuild/darwin-arm64": "0.25.12",
        "@esbuild/darwin-x64": "0.25.12",
        "@esbuild/freebsd-arm64": "0.25.12",
        "@esbuild/freebsd-x64": "0.25.12",
        "@esbuild/linux-arm": "0.25.12",
        "@esbuild/linux-arm64": "0.25.12",
        "@esbuild/linux-ia32": "0.25.12",
        "@esbuild/linux-loong64": "0.25.12",
        "@esbuild/linux-mips64el": "0.25.12",
        "@esbuild/linux-ppc64": "0.25.12",
        "@esbuild/linux-riscv64": "0.25.12",
        "@esbuild/linux-s390x": "0.25.12",
        "@esbuild/linux-x64": "0.25.12",
        "@esbuild/netbsd-arm64": "0.25.12",
        "@esbuild/netbsd-x64": "0.25.12",
        "@esbuild/openbsd-arm64": "0.25.12",
        "@esbuild/openbsd-x64": "0.25.12",
        "@esbuild/openharmony-arm64": "0.25.12",
        "@esbuild/sunos-x64": "0.25.12",
        "@esbuild/win32-arm64": "0.25.12",
        "@esbuild/win32-ia32": "0.25.12",
        "@esbuild/win32-x64": "0.25.12"
      }
    },
    "node_modules/estree-walker": {
      "version": "2.0.2",
      "resolved": "https://registry.npmjs.org/estree-walker/-/estree-walker-2.0.2.tgz",
      "integrity": "sha512-Rfkk/Mp/DL7JVje3u18FxFujQlTNR2q6QfMSMB7AvCBx91NGj/ba3kCfza0f6dVDbw7YlRf/nDrn7pQrCCyQ/w==",
      "license": "MIT"
    },
    "node_modules/fdir": {
      "version": "6.5.0",
      "resolved": "https://registry.npmjs.org/fdir/-/fdir-6.5.0.tgz",
      "integrity": "sha512-tIbYtZbucOs0BRGqPJkshJUYdL+SDH7dVM8gjy+ERp3WAUjLEFJE+02kanyHtwjWOnwrKYBiwAmM0p4kLJAnXg==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12.0.0"
      },
      "peerDependencies": {
        "picomatch": "^3 || ^4"
      },
      "peerDependenciesMeta": {
        "picomatch": {
          "optional": true
        }
      }
    },
    "node_modules/fsevents": {
      "version": "2.3.3",
      "resolved": "https://registry.npmjs.org/fsevents/-/fsevents-2.3.3.tgz",
      "integrity": "sha512-5xoDfX+fL7faATnagmWPpbFtwh/R77WmMMqqHGS65C3vvB0YHrgF+B1YmZ3441tMj5n63k0212XNoJwzlhffQw==",
      "dev": true,
      "hasInstallScript": true,
      "license": "MIT",
      "optional": true,
      "os": [
        "darwin"
      ],
      "engines": {
        "node": "^8.16.0 || ^10.6.0 || >=11.0.0"
      }
    },
    "node_modules/magic-string": {
      "version": "0.30.21",
      "resolved": "https://registry.npmjs.org/magic-string/-/magic-string-0.30.21.tgz",
      "integrity": "sha512-vd2F4YUyEXKGcLHoq+TEyCjxueSeHnFxyyjNp80yg0XV4vUhnDer/lvvlqM/arB5bXQN5K2/3oinyCRyx8T2CQ==",
      "license": "MIT",
      "dependencies": {
        "@jridgewell/sourcemap-codec": "^1.5.5"
      }
    },
    "node_modules/nanoid": {
      "version": "3.3.20",
      "resolved": "https://registry.npmjs.org/nanoid/-/nanoid-3.3.20.tgz",
      "integrity": "sha512-uKdg2G3GNCKQn9byYOpxbGqrT2fGO5KRt5J/8b3pok8rT6qxGWF6hxMyJiEYtAf+FVyYuD9hRaDqX5uPFYJ4ZQ==",
      "funding": [
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "bin": {
        "nanoid": "bin/nanoid.cjs"
      },
      "engines": {
        "node": "^10 || ^12 || ^13.7 || ^14 || >=15.0.1"
      }
    },
    "node_modules/picocolors": {
      "version": "1.1.1",
      "resolved": "https://registry.npmjs.org/picocolors/-/picocolors-1.1.1.tgz",
      "integrity": "sha512-xceH2snhtb5M9liqDsmEw56le376mTZkEX/jEb/RxNFyegNul7eNslCXP9FDj/Lcu0X8KEyMceP2ntpaHrDEVA==",
      "license": "ISC"
    },
    "node_modules/picomatch": {
      "version": "4.0.7",
      "resolved": "https://registry.npmjs.org/picomatch/-/picomatch-4.0.7.tgz",
      "integrity": "sha512-qcJu88Q2IWqJsDD529JKMdwGm/dvInW4HvQnRwiH9JtihJvzGOscDtHE3x1pBKeUOTysQ8kVmLnJ2kJu7yhcGA==",
      "dev": true,
      "license": "MIT",
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/jonschlinkert"
      }
    },
    "node_modules/pinia": {
      "version": "2.3.1",
      "resolved": "https://registry.npmjs.org/pinia/-/pinia-2.3.1.tgz",
      "integrity": "sha512-khUlZSwt9xXCaTbbxFYBKDc/bWAGWJjOgvxETwkTN7KRm66EeT1ZdZj6i2ceh9sP2Pzqsbc704r2yngBrxBVug==",
      "license": "MIT",
      "dependencies": {
        "@vue/devtools-api": "^6.6.3",
        "vue-demi": "^0.14.10"
      },
      "funding": {
        "url": "https://github.com/sponsors/posva"
      },
      "peerDependencies": {
        "typescript": ">=4.4.4",
        "vue": "^2.7.0 || ^3.5.11"
      },
      "peerDependenciesMeta": {
        "typescript": {
          "optional": true
        }
      }
    },
    "node_modules/postcss": {
      "version": "8.5.31",
      "resolved": "https://registry.npmjs.org/postcss/-/postcss-8.5.31.tgz",
      "integrity": "sha512-YUbWYCgErwnMAVkjUnYa+KlMBzGpHwiIt/DE7f0G33AuX2LH9UcTk6KgWxd3zRU+pN3u/C+Xl3EnMLM4Hea7Sg==",
      "funding": [
        {
          "type": "opencollective",
          "url": "https://opencollective.com/postcss/"
        },
        {
          "type": "tidelift",
          "url": "https://tidelift.com/funding/github/npm/postcss"
        },
        {
          "type": "github",
          "url": "https://github.com/sponsors/ai"
        }
      ],
      "license": "MIT",
      "dependencies": {
        "nanoid": "^3.3.20",
        "picocolors": "^1.1.1",
        "source-map-js": "^1.2.2"
      },
      "engines": {
        "node": "^10 || ^12 || >=14"
      }
    },
    "node_modules/primeicons": {
      "version": "7.0.0",
      "resolved": "https://registry.npmjs.org/primeicons/-/primeicons-7.0.0.tgz",
      "integrity": "sha512-jK3Et9UzwzTsd6tzl2RmwrVY/b8raJ3QZLzoDACj+oTJ0oX7L9Hy+XnVwgo4QVKlKpnP/Ur13SXV/pVh4LzaDw==",
      "license": "MIT"
    },
    "node_modules/primevue": {
      "version": "4.5.4",
      "resolved": "https://registry.npmjs.org/primevue/-/primevue-4.5.4.tgz",
      "integrity": "sha512-nTyEohZABFJhVIpeUxgP0EJ8vKcJAhD+Z7DYj95e7ie/MNUCjRNcGjqmE1cXtXi4z54qDfTSI9h2uJ51qz2DIw==",
      "license": "MIT",
      "dependencies": {
        "@primeuix/styled": "^0.7.4",
        "@primeuix/styles": "^2.0.2",
        "@primeuix/utils": "^0.6.2",
        "@primevue/core": "4.5.4",
        "@primevue/icons": "4.5.4"
      },
      "engines": {
        "node": ">=12.11.0"
      }
    },
    "node_modules/rollup": {
      "version": "4.65.0",
      "resolved": "https://registry.npmjs.org/rollup/-/rollup-4.65.0.tgz",
      "integrity": "sha512-QVCvQUTGDN6JRwi3jVGCY3H4aTHvi9rX0LyoBMkGUvdh/Z6O51CzcLz85BWZaTCDGhl6ySGqYZs+xI1jmPqGcw==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "@types/estree": "1.0.9"
      },
      "bin": {
        "rollup": "dist/bin/rollup"
      },
      "engines": {
        "node": ">=18.0.0",
        "npm": ">=8.0.0"
      },
      "optionalDependencies": {
        "@napi-rs/lzma-linux-x64-gnu": "1.5.1",
        "@rollup/rollup-android-arm-eabi": "4.65.0",
        "@rollup/rollup-android-arm64": "4.65.0",
        "@rollup/rollup-darwin-arm64": "4.65.0",
        "@rollup/rollup-darwin-x64": "4.65.0",
        "@rollup/rollup-freebsd-arm64": "4.65.0",
        "@rollup/rollup-freebsd-x64": "4.65.0",
        "@rollup/rollup-linux-arm-gnueabihf": "4.65.0",
        "@rollup/rollup-linux-arm-musleabihf": "4.65.0",
        "@rollup/rollup-linux-arm64-gnu": "4.65.0",
        "@rollup/rollup-linux-arm64-musl": "4.65.0",
        "@rollup/rollup-linux-loong64-gnu": "4.65.0",
        "@rollup/rollup-linux-loong64-musl": "4.65.0",
        "@rollup/rollup-linux-ppc64-gnu": "4.65.0",
        "@rollup/rollup-linux-ppc64-musl": "4.65.0",
        "@rollup/rollup-linux-riscv64-gnu": "4.65.0",
        "@rollup/rollup-linux-riscv64-musl": "4.65.0",
        "@rollup/rollup-linux-s390x-gnu": "4.65.0",
        "@rollup/rollup-linux-x64-gnu": "4.65.0",
        "@rollup/rollup-linux-x64-musl": "4.65.0",
        "@rollup/rollup-openbsd-x64": "4.65.0",
        "@rollup/rollup-openharmony-arm64": "4.65.0",
        "@rollup/rollup-win32-arm64-msvc": "4.65.0",
        "@rollup/rollup-win32-ia32-msvc": "4.65.0",
        "@rollup/rollup-win32-x64-gnu": "4.65.0",
        "@rollup/rollup-win32-x64-msvc": "4.65.0",
        "fsevents": "~2.3.2"
      }
    },
    "node_modules/source-map-js": {
      "version": "1.2.2",
      "resolved": "https://registry.npmjs.org/source-map-js/-/source-map-js-1.2.2.tgz",
      "integrity": "sha512-KGj/8Y43x35aZVDtt+J4mK1hoLGHULMYfSkODJNQjNDC3oW1PqPoxMwo0pLUsWM/UEGzON/NxeHywEfNXNP3Vw==",
      "license": "BSD-3-Clause",
      "engines": {
        "node": ">=0.10.0"
      }
    },
    "node_modules/tinyglobby": {
      "version": "0.2.17",
      "resolved": "https://registry.npmjs.org/tinyglobby/-/tinyglobby-0.2.17.tgz",
      "integrity": "sha512-wXR/dYpcqKmfWpEdZjiKJOwCNFndD0DMnrW/cYjVGttEkBfVgcLFHoNrlj47mjOVic9yyNu65alsgF4NQyTa2g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "fdir": "^6.5.0",
        "picomatch": "^4.0.4"
      },
      "engines": {
        "node": ">=12.0.0"
      },
      "funding": {
        "url": "https://github.com/sponsors/SuperchupuDev"
      }
    },
    "node_modules/vite": {
      "version": "6.4.1",
      "resolved": "https://registry.npmjs.org/vite/-/vite-6.4.1.tgz",
      "integrity": "sha512-+Oxm7q9hDoLMyJOYfUYBuHQo+dkAloi33apOPP56pzj+vsdJDzr+j1NISE5pyaAuKL4A3UD34qd0lx5+kfKp2g==",
      "dev": true,
      "license": "MIT",
      "dependencies": {
        "esbuild": "^0.25.0",
        "fdir": "^6.4.4",
        "picomatch": "^4.0.2",
        "postcss": "^8.5.3",
        "rollup": "^4.34.9",
        "tinyglobby": "^0.2.13"
      },
      "bin": {
        "vite": "bin/vite.js"
      },
      "engines": {
        "node": "^18.0.0 || ^20.0.0 || >=22.0.0"
      },
      "funding": {
        "url": "https://github.com/vitejs/vite?sponsor=1"
      },
      "optionalDependencies": {
        "fsevents": "~2.3.3"
      },
      "peerDependencies": {
        "@types/node": "^18.0.0 || ^20.0.0 || >=22.0.0",
        "jiti": ">=1.21.0",
        "less": "*",
        "lightningcss": "^1.21.0",
        "sass": "*",
        "sass-embedded": "*",
        "stylus": "*",
        "sugarss": "*",
        "terser": "^5.16.0",
        "tsx": "^4.8.1",
        "yaml": "^2.4.2"
      },
      "peerDependenciesMeta": {
        "@types/node": {
          "optional": true
        },
        "jiti": {
          "optional": true
        },
        "less": {
          "optional": true
        },
        "lightningcss": {
          "optional": true
        },
        "sass": {
          "optional": true
        },
        "sass-embedded": {
          "optional": true
        },
        "stylus": {
          "optional": true
        },
        "sugarss": {
          "optional": true
        },
        "terser": {
          "optional": true
        },
        "tsx": {
          "optional": true
        },
        "yaml": {
          "optional": true
        }
      }
    },
    "node_modules/vue": {
      "version": "3.5.26",
      "resolved": "https://registry.npmjs.org/vue/-/vue-3.5.26.tgz",
      "integrity": "sha512-SJ/NTccVyAoNUJmkM9KUqPcYlY+u8OVL1X5EW9RIs3ch5H2uERxyyIUI4MRxVCSOiEcupX9xNGde1tL9ZKpimA==",
      "license": "MIT",
      "dependencies": {
        "@vue/compiler-dom": "3.5.26",
        "@vue/compiler-sfc": "3.5.26",
        "@vue/runtime-dom": "3.5.26",
        "@vue/server-renderer": "3.5.26",
        "@vue/shared": "3.5.26"
      },
      "peerDependencies": {
        "typescript": "*"
      },
      "peerDependenciesMeta": {
        "typescript": {
          "optional": true
        }
      }
    },
    "node_modules/vue-demi": {
      "version": "0.14.10",
      "resolved": "https://registry.npmjs.org/vue-demi/-/vue-demi-0.14.10.tgz",
      "integrity": "sha512-nMZBOwuzabUO0nLgIcc6rycZEebF6eeUfaiQx9+WSk8e29IbLvPU9feI6tqW4kTo3hvoYAJkMh8n8D0fuISphg==",
      "hasInstallScript": true,
      "license": "MIT",
      "bin": {
        "vue-demi-fix": "bin/vue-demi-fix.js",
        "vue-demi-switch": "bin/vue-demi-switch.js"
      },
      "engines": {
        "node": ">=12"
      },
      "funding": {
        "url": "https://github.com/sponsors/antfu"
      },
      "peerDependencies": {
        "@vue/composition-api": "^1.0.0-rc.1",
        "vue": "^3.0.0-0 || ^2.6.0"
      },
      "peerDependenciesMeta": {
        "@vue/composition-api": {
          "optional": true
        }
      }
    },
    "node_modules/vue-router": {
      "version": "4.6.4",
      "resolved": "https://registry.npmjs.org/vue-router/-/vue-router-4.6.4.tgz",
      "integrity": "sha512-Hz9q5sa33Yhduglwz6g9skT8OBPii+4bFn88w6J+J4MfEo4KRRpmiNG/hHHkdbRFlLBOqxN8y8gf2Fb0MTUgVg==",
      "license": "MIT",
      "dependencies": {
        "@vue/devtools-api": "^6.6.4"
      },
      "funding": {
        "url": "https://github.com/sponsors/posva"
      },
      "peerDependencies": {
        "vue": "^3.5.0"
      }
    },
    "node_modules/yaml": {
      "version": "2.9.1",
      "resolved": "https://registry.npmjs.org/yaml/-/yaml-2.9.1.tgz",
      "integrity": "sha512-3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==",
      "license": "ISC",
      "bin": {
        "yaml": "bin.mjs"
      },
      "engines": {
        "node": ">= 14.6"
      },
      "funding": {
        "url": "https://github.com/sponsors/eemeli"
      }
    }
  }
}
OIDC_ADMIN_1
COPY <<'OIDC_ADMIN_2' /admin/index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OIDC users</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
OIDC_ADMIN_2
COPY <<'OIDC_ADMIN_3' /admin/vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { qdadmVitePlugin } from '@quazardous/qdadm/vite'

// Served by the provider at /admin/; in development, its API is a running provider's
// (OIDC_URL, http://127.0.0.1:8080 by default).
export default defineConfig({
  base: '/admin/',
  plugins: [vue(), qdadmVitePlugin()],
  server: { proxy: { '/admin/api': process.env.OIDC_URL ?? 'http://127.0.0.1:8080' } },
})
OIDC_ADMIN_3
COPY <<'OIDC_ADMIN_4' /admin/src/App.vue
<script setup lang="ts">
import { RouterView } from 'vue-router'
import ConfirmDialog from 'primevue/confirmdialog'
</script>

<template>
  <ConfirmDialog />
  <RouterView />
</template>
OIDC_ADMIN_4
COPY <<'OIDC_ADMIN_5' /admin/src/auth.ts
import { LocalStorageSessionAuthAdapter } from '@quazardous/qdadm'

/**
 * The admin signs in with the provider's admin token (`octopod secrets <project>`, the
 * service's `admin-token`), typed as the password: it is checked on the API, and sent as
 * a bearer token from then on.
 */
class AdminTokenAuth extends LocalStorageSessionAuthAdapter {
  constructor() {
    super('octopod_oidc_admin')
  }

  async login({ password }: { username: string; password: string }) {
    const token = password.trim()
    const answer = await fetch('/admin/api/users', { headers: { authorization: `Bearer ${token}` } })
    if (!answer.ok) throw new Error('Wrong admin token')
    const user = { id: 'admin', username: 'admin', role: 'ROLE_ADMIN' }
    this.setSession(token, user)
    this.persist()
    return { user, token }
  }

  /**
   * An admin that asks for nothing (the recipe's default, `admin-login: false`): signed in at
   * once, with no token to send — the API takes none then.
   */
  async openIfAllowed(): Promise<void> {
    const answer = await fetch('/admin/api/session').catch(() => undefined)
    const { open } = answer?.ok ? ((await answer.json()) as { open?: boolean }) : { open: false }
    if (!open || this.isAuthenticated()) return
    this.setSession('open', { id: 'admin', username: 'admin', role: 'ROLE_ADMIN' })
    this.persist()
  }
}

export const authAdapter = new AdminTokenAuth()
OIDC_ADMIN_5
COPY <<'OIDC_ADMIN_6' /admin/src/Home.vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'

// The admin has one page worth opening: the users.
const router = useRouter()
onMounted(() => router.replace('/users'))
</script>

<template><div /></template>
OIDC_ADMIN_6
COPY <<'OIDC_ADMIN_7' /admin/src/http.ts
import type { HttpClient } from '@quazardous/qdadm'
import { authAdapter } from './auth'

/** fetch, with the admin token: what qdadm's ApiStorage calls the API with. */
async function call<T>(method: string, url: string, data?: unknown): Promise<{ data: T }> {
  const answer = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${authAdapter.getToken() ?? ''}`, 'content-type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  const body = await answer.json().catch(() => ({}))
  if (!answer.ok) throw new Error((body as { error_description?: string }).error_description ?? answer.statusText)
  return { data: body as T }
}

export const http: HttpClient = {
  get: (url) => call('GET', url),
  post: (url, data) => call('POST', url, data),
  put: (url, data) => call('PUT', url, data),
  patch: (url, data) => call('PUT', url, data),
  delete: (url) => call('DELETE', url),
  request: ({ method, url, data }) => call(method, url, data),
}
OIDC_ADMIN_7
COPY <<'OIDC_ADMIN_8' /admin/src/Login.vue
<script setup lang="ts">
import { LoginPage } from '@quazardous/qdadm/components'
</script>

<template>
  <LoginPage>
    <template #footer>
      <p class="hint">Any user name; the password is the admin token: <code>octopod secrets &lt;project&gt;</code>, the service's <code>admin-token</code>.</p>
    </template>
  </LoginPage>
</template>

<style scoped>
.hint { margin-top: 1rem; text-align: center; font-size: 0.875rem; color: var(--p-surface-500, rgb(100 116 139)); }
</style>
OIDC_ADMIN_8
COPY <<'OIDC_ADMIN_9' /admin/src/main.ts
import { Kernel } from '@quazardous/qdadm'
import { AppLayout } from '@quazardous/qdadm/components'
import { createLocalStorageRolesProvider } from '@quazardous/qdadm/security'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import '@quazardous/qdadm/styles'
import 'primeicons/primeicons.css'

import App from './App.vue'
import { authAdapter } from './auth'
import { UsersModule } from './users/UsersModule'

const kernel = new Kernel({
  root: App,
  hashMode: true,
  moduleDefs: [UsersModule],
  pages: { layout: AppLayout, login: () => import('./Login.vue') },
  authAdapter,
  entityAuthAdapter: () => authAdapter.getUser(),
  security: {
    // One role: whoever has the admin token administers the users.
    rolesProvider: createLocalStorageRolesProvider({
      key: 'octopod_oidc_admin_roles',
      defaults: { role_hierarchy: {}, role_permissions: { ROLE_ADMIN: ['entity:*:read', 'entity:*:list', 'entity:*:create', 'entity:*:update', 'entity:*:delete'] } },
    }),
  },
  homeRoute: { name: 'home', component: () => import('./Home.vue') },
  primevue: { plugin: PrimeVue, theme: Aura },
  app: { name: 'OIDC users', shortName: 'ID' },
})

// An open admin skips its login: asked before the app starts.
authAdapter.openIfAllowed().finally(() => kernel.createApp().mount('#app'))
OIDC_ADMIN_9
COPY <<'OIDC_ADMIN_10' /admin/src/users/UserForm.vue
<script setup lang="ts">
import { useEntityItemFormPage } from '@quazardous/qdadm'
import { FormPage, FormField, FormInput } from '@quazardous/qdadm/components'

const form = useEntityItemFormPage({ entity: 'users' })
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
OIDC_ADMIN_10
COPY <<'OIDC_ADMIN_11' /admin/src/users/UserList.vue
<script setup lang="ts">
import { useListPage } from '@quazardous/qdadm'
import { ListPage } from '@quazardous/qdadm/components'
import Column from 'primevue/column'

const list = useListPage({ entity: 'users' })

list.setSearch({ placeholder: 'Search users...', fields: ['sub', 'claims'] })
list.addCreateAction('Add a user')
list.addEditAction()
list.addDeleteAction({ labelField: 'sub' })
</script>

<template>
  <ListPage v-bind="list.props.value" v-on="list.events">
    <template #columns>
      <Column field="sub" header="User" sortable />
      <Column field="claims" header="Claims">
        <template #body="{ data }"><code>{{ JSON.stringify(JSON.parse(data.claims)) }}</code></template>
      </Column>
      <Column field="has_password" header="Password" style="width: 110px">
        <template #body="{ data }">{{ data.has_password ? 'yes' : 'none' }}</template>
      </Column>
      <Column field="issuers" header="Issuers">
        <template #body="{ data }">{{ data.issuers || 'all' }}</template>
      </Column>
    </template>
  </ListPage>
</template>
OIDC_ADMIN_11
COPY <<'OIDC_ADMIN_12' /admin/src/users/UsersModule.ts
import { Module, EntityManager, ApiStorage } from '@quazardous/qdadm'
import { http } from '../http'

/** A user as the API gives it. */
interface ApiUser {
  sub: string
  claims: Record<string, unknown>
  password: boolean
  issuers?: string[]
}

/** A user as the forms edit it: the claims as JSON text, the issuers as a list in a line. */
interface FormUser {
  id: string
  sub: string
  claims: string
  has_password: boolean
  password: string
  remove_password: boolean
  issuers: string
}

export class UsersModule extends Module {
  static moduleName = 'users'

  async connect(ctx: any) {
    ctx.entity('users', new EntityManager({
      name: 'users',
      labelField: 'sub',
      fields: {
        sub: { type: 'text', label: 'User', required: true, default: '' },
        claims: { type: 'textarea', label: 'Claims (JSON)', default: '{\n  "email": "",\n  "groups": []\n}' },
        has_password: { type: 'boolean', label: 'Has a password', default: false, readOnly: true },
        password: { type: 'password', label: 'New password (empty: unchanged)', default: '' },
        remove_password: { type: 'boolean', label: 'Remove its password (one-click sign-in)', default: false },
        issuers: { type: 'text', label: 'Issuers (comma-separated; empty: all)', default: '' },
      },
      storage: new ApiStorage({
        endpoint: '/admin/api/users',
        client: http,
        responseItemsKey: 'users',
        normalize: (u: any): any => {
          const user = u as ApiUser
          return {
            id: user.sub,
            sub: user.sub,
            claims: JSON.stringify(user.claims ?? {}, null, 2),
            has_password: user.password,
            password: '',
            remove_password: false,
            issuers: (user.issuers ?? []).join(', '),
          } satisfies FormUser
        },
        denormalize: (f: any): any => {
          const form = f as Partial<FormUser>
          const issuers = (form.issuers ?? '').split(',').map((s) => s.trim()).filter(Boolean)
          return {
            sub: form.sub,
            claims: JSON.parse(form.claims || '{}'),
            issuers: issuers.length > 0 ? issuers : null,
            ...(form.remove_password ? { password: null } : form.password ? { password: form.password } : {}),
          }
        },
      }),
    }))

    ctx.crud('users', {
      list: () => import('./UserList.vue'),
      form: () => import('./UserForm.vue'),
    }, { nav: { section: 'Provider', icon: 'pi pi-users' } })
  }
}
OIDC_ADMIN_12
RUN npm ci --no-audit --no-fund --legacy-peer-deps && npx vite build

FROM ${BASE_IMAGE}
ARG UID=1000
ARG GID=1000
ARG USER_NAME=app
RUN groupmod -o -g "$GID" -n "$USER_NAME" node \
 && usermod -o -u "$UID" -g "$GID" -l "$USER_NAME" -d "/home/$USER_NAME" -m node
COPY <<'OIDC_PACKAGE' /opt/oidc/package.json
{ "type": "module" }
OIDC_PACKAGE
COPY <<'OIDC_USERS' /opt/oidc/users.js
/**
 * The provider's users: who may sign in, with which claims, and with which password (kept
 * as a scrypt hash, never as given). Kept in one JSON file of the provider's data, written
 * whole and atomically: a development provider has a handful of users, not a directory.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
const SUB = /^[A-Za-z0-9._@+-]{1,128}$/;
const ISSUER = /^[a-z0-9][a-z0-9-]{0,62}$/;
export function hashPassword(password) {
    const salt = randomBytes(16);
    return `scrypt$${salt.toString('base64url')}$${scryptSync(password, salt, 32).toString('base64url')}`;
}
export function passwordMatches(hash, password) {
    const [kind, salt, expected] = (hash ?? '').split('$');
    if (kind !== 'scrypt' || !salt || !expected)
        return false;
    const got = scryptSync(password, Buffer.from(salt, 'base64url'), 32);
    const want = Buffer.from(expected, 'base64url');
    return got.length === want.length && timingSafeEqual(got, want);
}
/** A user as the admin API gives it, checked; an error to say otherwise. */
export function userOf(sub, body, previous) {
    if (!SUB.test(sub))
        return { error: 'a user name is 1 to 128 letters, digits and . _ @ + -' };
    const input = (body ?? {});
    if (input.claims !== undefined && (typeof input.claims !== 'object' || input.claims === null || Array.isArray(input.claims)))
        return { error: 'claims must be a JSON object' };
    if (input.password !== undefined && input.password !== null && (typeof input.password !== 'string' || input.password.length < 1 || input.password.length > 200)) {
        return { error: 'password must be a string of 1 to 200 characters, or null to remove it' };
    }
    if (input.issuers !== undefined && input.issuers !== null && (!Array.isArray(input.issuers) || !input.issuers.every((i) => typeof i === 'string' && ISSUER.test(i)))) {
        return { error: 'issuers must be a list of issuer names, or null for all of them' };
    }
    const claims = input.claims ?? previous?.claims ?? {};
    const password = input.password === null ? undefined : typeof input.password === 'string' ? hashPassword(input.password) : previous?.password;
    const issuers = input.issuers === null ? undefined : (input.issuers ?? previous?.issuers);
    return { sub, claims, ...(password ? { password } : {}), ...(issuers ? { issuers } : {}) };
}
export const shown = (u) => ({ sub: u.sub, claims: u.claims, password: Boolean(u.password), ...(u.issuers ? { issuers: u.issuers } : {}) });
export class Users {
    file;
    constructor(file) {
        this.file = file;
    }
    all() {
        try {
            return JSON.parse(readFileSync(this.file, 'utf8')).users ?? [];
        }
        catch {
            return [];
        }
    }
    get(sub) {
        return this.all().find((u) => u.sub === sub);
    }
    /** The users who may sign in to an issuer. */
    of(issuer) {
        return this.all().filter((u) => !u.issuers || u.issuers.includes(issuer));
    }
    put(user) {
        this.write([...this.all().filter((u) => u.sub !== user.sub), user].sort((a, b) => a.sub.localeCompare(b.sub)));
    }
    delete(sub) {
        const all = this.all();
        if (!all.some((u) => u.sub === sub))
            return false;
        this.write(all.filter((u) => u.sub !== sub));
        return true;
    }
    write(users) {
        writeFileSync(`${this.file}.tmp`, JSON.stringify({ users }, null, 2) + '\n', { mode: 0o600 });
        renameSync(`${this.file}.tmp`, this.file);
    }
}
OIDC_USERS
COPY <<'OIDC_ADMIN' /opt/oidc/admin.js
/**
 * The admin page (`/admin`): the users of the store, added, changed and removed through the
 * admin API with its token. One page, no dependency; the token is kept in the tab's session
 * storage, never in a cookie, so another site cannot act with it.
 */
export function adminPage() {
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>OIDC users</title>
<style>
body{font:14px system-ui;max-width:56rem;margin:2rem auto;padding:0 1rem;color:#222}
table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{text-align:left;padding:.4rem;border-bottom:1px solid #ddd;vertical-align:top}
code{font-size:12px;word-break:break-all}input,textarea{font:inherit;padding:.35rem;box-sizing:border-box}textarea{width:100%;height:6rem;font-family:monospace}
label{display:block;margin:.6rem 0 .2rem}button{font:inherit;padding:.35rem .9rem}.error{color:#b00}.muted{color:#666}
</style>
<h1>Users</h1>
<p class="muted">Who may sign in, with which claims. The admin token is in <code>octopod secrets &lt;project&gt;</code> (the service's <code>admin-token</code>).</p>
<form id="auth"><input id="token" type="password" placeholder="admin token" size="40" aria-label="admin token"> <button>Use</button></form>
<p id="error" class="error" hidden></p>
<table><thead><tr><th>User</th><th>Claims</th><th>Password</th><th>Issuers</th><th></th></tr></thead><tbody id="users"></tbody></table>
<h2 id="title">Add a user</h2>
<form id="edit">
<label for="sub">User name</label><input id="sub" required pattern="[A-Za-z0-9._@+-]{1,128}">
<label for="claims">Claims (JSON)</label><textarea id="claims">{"email": "", "groups": []}</textarea>
<label for="password">Password <span class="muted">(empty: unchanged; none at all: one-click sign-in)</span></label><input id="password" type="password" autocomplete="new-password">
<label><input id="nopassword" type="checkbox"> remove its password</label>
<label for="issuers">Issuers <span class="muted">(comma-separated; empty: all)</span></label><input id="issuers" placeholder="admi, google">
<p><button>Save</button> <button type="button" id="reset">New</button></p>
</form>
<script>
const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('oidc-admin') || '';
const fail = (m) => { $('error').textContent = m; $('error').hidden = !m; };
async function api(method, path, payload) {
  const r = await fetch('/admin/api' + path, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error_description || r.statusText);
  return data;
}
function cell(text, code) { const td = document.createElement('td'); const n = document.createElement(code ? 'code' : 'span'); n.textContent = text; td.append(n); return td; }
async function load() {
  if (!token) return;
  try {
    const { users } = await api('GET', '/users');
    fail('');
    $('users').replaceChildren(...users.map((u) => {
      const tr = document.createElement('tr');
      const actions = document.createElement('td');
      const edit = document.createElement('button'); edit.textContent = 'Edit'; edit.onclick = () => fill(u);
      const del = document.createElement('button'); del.textContent = 'Delete';
      del.onclick = async () => { if (del.textContent !== 'Sure?') { del.textContent = 'Sure?'; return; } await api('DELETE', '/users/' + encodeURIComponent(u.sub)).catch((e) => fail(e.message)); load(); };
      actions.append(edit, ' ', del);
      tr.append(cell(u.sub), cell(JSON.stringify(u.claims), true), cell(u.password ? 'yes' : 'none'), cell((u.issuers || ['all']).join(', ')), actions);
      return tr;
    }));
  } catch (e) { fail(e.message); }
}
function fill(u) {
  $('title').textContent = u ? 'Edit ' + u.sub : 'Add a user';
  $('sub').value = u ? u.sub : ''; $('sub').readOnly = Boolean(u);
  $('claims').value = u ? JSON.stringify(u.claims, null, 2) : '{"email": "", "groups": []}';
  $('password').value = ''; $('nopassword').checked = false;
  $('issuers').value = u && u.issuers ? u.issuers.join(', ') : '';
}
$('auth').onsubmit = (e) => { e.preventDefault(); token = $('token').value.trim(); sessionStorage.setItem('oidc-admin', token); load(); };
$('reset').onclick = () => fill(null);
$('edit').onsubmit = async (e) => {
  e.preventDefault();
  let claims;
  try { claims = JSON.parse($('claims').value || '{}'); } catch { return fail('The claims must be JSON.'); }
  const issuers = $('issuers').value.split(',').map((s) => s.trim()).filter(Boolean);
  const payload = { claims, issuers: issuers.length ? issuers : null };
  if ($('nopassword').checked) payload.password = null; else if ($('password').value) payload.password = $('password').value;
  try { await api('PUT', '/users/' + encodeURIComponent($('sub').value), payload); fill(null); fail(''); load(); } catch (err) { fail(err.message); }
};
load();
</script>`;
}
OIDC_ADMIN
COPY <<'OIDC_PROVIDER' /opt/oidc/provider.js
/**
 * A small OpenID Connect provider: discovery, keys, the authorization code flow with PKCE,
 * tokens and userinfo. No dependency but Node's crypto. HTTP is the server's business
 * (server.ts); this is the protocol, testable without a socket.
 *
 * An issuer is a URL: `http://id.demo.localhost/admi`. The provider serves any number of
 * them with one key; who logs in is decided by the caller of `issueCode` — today a login
 * page that takes a user name and its claims, for development.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { passwordMatches } from './users.js';
/** How long a code waits to be exchanged, and how long a token lasts. */
export const CODE_MS = 60_000;
export const TOKEN_S = 3600;
/** Claims the provider sets itself: a login's claims never replace them. */
const RESERVED = ['iss', 'aud', 'exp', 'iat', 'nbf', 'auth_time', 'nonce', 'azp', 'client_id', 'scope'];
const b64url = (data) => Buffer.from(data).toString('base64url');
/** A new signing key, as PEM: kept by the server, so tokens outlive a restart. */
export function newKeyPem() {
    return generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}
function failure(status, error, description) {
    return { status, body: { error, error_description: description } };
}
export class Provider {
    options;
    key;
    publicKey;
    kid;
    codes = new Map();
    now;
    constructor(keyPem, options = {}) {
        this.options = options;
        this.now = options.now ?? Date.now;
        this.key = createPrivateKey(keyPem);
        this.publicKey = createPublicKey(this.key);
        const { n, e } = this.publicKey.export({ format: 'jwk' });
        // RFC 7638 thumbprint: a kid that changes with the key, and only with it.
        this.kid = b64url(createHash('sha256').update(JSON.stringify({ e, kty: 'RSA', n })).digest());
    }
    discovery(issuer) {
        return {
            issuer,
            authorization_endpoint: `${issuer}/authorize`,
            token_endpoint: `${issuer}/token`,
            userinfo_endpoint: `${issuer}/userinfo`,
            jwks_uri: `${issuer}/jwks`,
            end_session_endpoint: `${issuer}/logout`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'client_credentials', ...(this.options.passwordGrant ? ['password'] : [])],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            scopes_supported: ['openid', 'profile', 'email', 'groups'],
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
            code_challenge_methods_supported: ['S256', 'plain'],
            claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'name', 'preferred_username', 'email', 'groups'],
        };
    }
    jwks() {
        return { keys: [{ ...this.publicKey.export({ format: 'jwk' }), kid: this.kid, use: 'sig', alg: 'RS256' }] };
    }
    /** The authorization request a client sent, checked; an error a client is told otherwise. */
    authorizeRequest(issuer, q) {
        if (q.response_type !== 'code')
            return { error: 'response_type must be code' };
        if (!q.client_id)
            return { error: 'client_id is missing' };
        if (!q.redirect_uri || !/^https?:\/\//.test(q.redirect_uri))
            return { error: 'redirect_uri must be an http(s) URL' };
        if (!(q.scope ?? '').split(' ').includes('openid'))
            return { error: 'scope must include openid' };
        const method = q.code_challenge ? (q.code_challenge_method ?? 'plain') : undefined;
        if (method && method !== 'S256' && method !== 'plain')
            return { error: 'code_challenge_method must be S256 or plain' };
        return {
            issuer,
            clientId: q.client_id,
            redirectUri: q.redirect_uri,
            scope: q.scope,
            ...(q.state ? { state: q.state } : {}),
            ...(q.nonce ? { nonce: q.nonce } : {}),
            ...(q.code_challenge ? { codeChallenge: q.code_challenge, codeChallengeMethod: method } : {}),
        };
    }
    /** A code for a login, once: where the browser goes back to, with it. */
    issueCode(request, login) {
        const code = randomBytes(24).toString('base64url');
        const now = this.now();
        for (const [c, v] of this.codes)
            if (v.expires <= now)
                this.codes.delete(c);
        this.codes.set(code, { request, login, expires: now + CODE_MS, authTime: Math.floor(now / 1000) });
        const back = new URL(request.redirectUri);
        back.searchParams.set('code', code);
        if (request.state)
            back.searchParams.set('state', request.state);
        return back.toString();
    }
    /**
     * The token endpoint, for the authorization code grant. Any client secret is taken: a
     * client is the redirect URI and the code it holds, as a development provider needs.
     */
    token(issuer, form, basicClientId) {
        const clientId = basicClientId ?? form.client_id;
        if (form.grant_type === 'client_credentials') {
            // A service for itself: an access token whose subject is the client.
            if (!clientId)
                return failure(400, 'invalid_client', 'client_id is missing');
            const iat = Math.floor(this.now() / 1000);
            const scope = form.scope ?? '';
            return { status: 200, body: { access_token: this.sign({ iss: issuer, sub: clientId, aud: clientId, client_id: clientId, scope, iat, exp: iat + TOKEN_S }), token_type: 'Bearer', expires_in: TOKEN_S, scope } };
        }
        if (form.grant_type === 'password') {
            if (!this.options.passwordGrant)
                return failure(400, 'unsupported_grant_type', 'the password grant is off (OIDC_PASSWORD_GRANT=1 turns it on)');
            if (!clientId)
                return failure(400, 'invalid_client', 'client_id is missing');
            const issuerName = new URL(issuer).pathname.slice(1);
            const user = this.options.users?.of(issuerName).find((u) => u.sub === form.username);
            // A user without a password signs in on the page only: the grant needs one.
            if (!user?.password || !passwordMatches(user.password, form.password ?? ''))
                return failure(400, 'invalid_grant', 'wrong user name or password');
            const scope = form.scope ?? 'openid';
            return { status: 200, body: this.tokens(issuer, clientId, { sub: user.sub, claims: user.claims }, scope, Math.floor(this.now() / 1000)) };
        }
        if (form.grant_type !== 'authorization_code')
            return failure(400, 'unsupported_grant_type', 'authorization_code, client_credentials, or password when it is on');
        const entry = form.code ? this.codes.get(form.code) : undefined;
        if (form.code)
            this.codes.delete(form.code);
        if (!entry || entry.expires <= this.now() || entry.request.issuer !== issuer)
            return failure(400, 'invalid_grant', 'unknown, used or expired code');
        const { request, login } = entry;
        if (clientId !== request.clientId)
            return failure(400, 'invalid_grant', 'the code was issued to another client');
        if (form.redirect_uri !== request.redirectUri)
            return failure(400, 'invalid_grant', 'redirect_uri differs from the authorization request');
        if (request.codeChallenge) {
            const verifier = form.code_verifier ?? '';
            const derived = request.codeChallengeMethod === 'S256' ? b64url(createHash('sha256').update(verifier).digest()) : verifier;
            if (!verifier || derived !== request.codeChallenge)
                return failure(400, 'invalid_grant', 'code_verifier does not match the code_challenge');
        }
        return { status: 200, body: this.tokens(issuer, request.clientId, login, request.scope, entry.authTime, request.nonce) };
    }
    /** An ID token and an access token for a login: the claims it carries, never over the provider's own. */
    tokens(issuer, clientId, login, scope, authTime, nonce) {
        const iat = Math.floor(this.now() / 1000);
        const claims = Object.fromEntries(Object.entries(login.claims).filter(([k]) => !RESERVED.includes(k) && k !== 'sub'));
        const common = { iss: issuer, sub: login.sub, iat, exp: iat + TOKEN_S };
        const idToken = this.sign({ preferred_username: login.sub, name: login.sub, ...claims, ...common, aud: clientId, auth_time: authTime, ...(nonce ? { nonce } : {}) });
        const accessToken = this.sign({ ...claims, ...common, aud: clientId, client_id: clientId, scope });
        return { access_token: accessToken, token_type: 'Bearer', expires_in: TOKEN_S, id_token: idToken, scope };
    }
    /** The claims of the access token a request carries. */
    userinfo(issuer, authorization) {
        const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
        const payload = token ? this.verify(token) : undefined;
        if (!payload || payload.iss !== issuer)
            return failure(401, 'invalid_token', 'no valid access token');
        const { iss: _iss, aud: _aud, exp: _exp, iat: _iat, client_id: _client, scope: _scope, ...claims } = payload;
        return { status: 200, body: { preferred_username: payload.sub, name: payload.sub, ...claims } };
    }
    /** A JWT signed with the provider's key (RS256). */
    sign(payload) {
        const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: this.kid }));
        const body = b64url(JSON.stringify(payload));
        return `${head}.${body}.${b64url(sign('sha256', Buffer.from(`${head}.${body}`), this.key))}`;
    }
    /** The payload of a JWT this provider signed and that has not expired; undefined otherwise. */
    verify(token) {
        const [head, body, signature] = token.split('.');
        if (!head || !body || !signature)
            return undefined;
        if (!verify('sha256', Buffer.from(`${head}.${body}`), this.publicKey, Buffer.from(signature, 'base64url')))
            return undefined;
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        return typeof payload.exp === 'number' && payload.exp * 1000 > this.now() ? payload : undefined;
    }
}
OIDC_PROVIDER
COPY <<'OIDC_SERVER' /opt/oidc/server.js
/**
 * The provider over HTTP. Every first path segment is an issuer: `/admi/...` and
 * `/google/...` are two, with nothing to declare. The issuer's URL is the address the
 * request came to (its Host, behind the edge), so it is the same for a browser on the host
 * and for a container of the project that reaches the same host.
 *
 *   PORT                 where it listens (8080)
 *   OIDC_DATA            where the signing key and the users are kept (/data); made on first start
 *   OIDC_ADMIN_TOKEN     the bearer token of the admin API and page (/admin); none: no admin
 *   OIDC_ADMIN_LOGIN     0 for an admin that asks for nothing (a development provider behind the
 *                        edge, which answers the machine alone); the token is asked for otherwise
 *   OIDC_ADMIN_DIR       a built admin app served at /admin/ (the qdadm one); the built-in page otherwise
 *   OIDC_OPEN_LOGIN      0 to sign in only as a user of the store; any user, any claims otherwise
 *   OIDC_PASSWORD_GRANT  1 to trade a user's name and password for tokens, with no browser
 */
import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { newKeyPem, Provider } from './provider.js';
import { adminPage } from './admin.js';
import { passwordMatches, shown, userOf, Users } from './users.js';
const ISSUER = /^\/([a-z0-9][a-z0-9-]{0,62})(\/.*)?$/;
/** First segments that are the provider's own, not issuers. */
const RESERVED = ['admin', 'health'];
/** What the login page passes back, beside the user name and claims. */
const REQUEST_FIELDS = ['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'nonce', 'code_challenge', 'code_challenge_method'];
const escape = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
function send(res, status, body, headers = {}) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const type = typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json';
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers }).end(text);
}
async function body(req) {
    let raw = '';
    for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 64_000)
            throw new Error('request too large');
    }
    return raw;
}
async function form(req) {
    return Object.fromEntries(new URLSearchParams(await body(req)));
}
/** The client id of a `client_secret_basic` Authorization header; the secret is not checked. */
function basicClientId(header) {
    const value = /^Basic\s+(\S+)$/i.exec(header ?? '')?.[1];
    if (!value)
        return undefined;
    return decodeURIComponent(Buffer.from(value, 'base64').toString().split(':')[0] ?? '');
}
function loginPage(issuer, query, users, open, error = '') {
    const hidden = REQUEST_FIELDS.filter((f) => query[f]).map((f) => `<input type="hidden" name="${f}" value="${escape(query[f])}">`).join('');
    // The store's users: one click for a user without a password, its password otherwise.
    const known = users.length
        ? `<h2>Users</h2>${users
            .map((u) => u.password
            ? `<form method="post" class="user">${hidden}<input type="hidden" name="as" value="${escape(u.sub)}"><b>${escape(u.sub)}</b> <input type="password" name="password" placeholder="password" aria-label="${escape(u.sub)}'s password" required> <button>Sign in</button></form>`
            : `<form method="post" class="user">${hidden}<input type="hidden" name="as" value="${escape(u.sub)}"><button>Sign in as ${escape(u.sub)}</button> <small>${escape(JSON.stringify(u.claims))}</small></form>`)
            .join('')}`
        : '';
    if (!open) {
        return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign in</title>
<style>body{font:15px system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem}.user{margin:.6rem 0}.error{color:#b00}small{color:#666}</style>
<h1>Sign in</h1><p><small>${escape(issuer)}</small></p>${error ? `<p class="error">${escape(error)}</p>` : ''}${known || '<p>No user may sign in here yet: add one in the admin.</p>'}`;
    }
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Sign in</title>
<style>body{font:15px system-ui;max-width:28rem;margin:3rem auto;padding:0 1rem}label{display:block;margin:1rem 0 .3rem}input,textarea{width:100%;box-sizing:border-box;font:inherit;padding:.4rem}textarea{font-family:monospace;height:7rem}button{margin-top:1rem;padding:.5rem 1.2rem;font:inherit}.error{color:#b00}small{color:#666}.user input{width:auto}.user button{margin-top:0}</style>
<h1>Sign in</h1>
<p><small>${escape(issuer)} — a development provider: any user, the claims you write.</small></p>
${error ? `<p class="error">${escape(error)}</p>` : ''}
<form method="post">${hidden}
<label for="username">User</label><input id="username" name="username" value="${escape(query.username ?? 'dev')}" required>
<label for="claims">Claims (JSON)</label><textarea id="claims" name="claims">${escape(query.claims ?? '{\n  "email": "dev@example.test",\n  "groups": []\n}')}</textarea>
<button type="submit">Sign in</button></form>${known}`;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
/** A file of the built admin app; its index.html for /admin/ itself. Nothing outside its folder. */
function asset(res, dir, path) {
    if (path === '/admin') {
        res.writeHead(301, { location: '/admin/' }).end();
        return;
    }
    const root = resolve(dir);
    const file = resolve(root, `.${decodeURIComponent(path.slice('/admin'.length)) || '/'}`);
    const target = file === root || file === `${root}${sep}` ? join(root, 'index.html') : file;
    if (!target.startsWith(`${root}${sep}`) || !statSync(target, { throwIfNoEntry: false })?.isFile()) {
        send(res, 404, { error: 'not_found', error_description: path });
        return;
    }
    res
        .writeHead(200, {
        'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
        'cache-control': target.endsWith('index.html') ? 'no-store' : 'max-age=86400',
        'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:",
    })
        .end(readFileSync(target));
}
/** Whether a request carries the admin's token: compared in constant time. */
function admitted(header, token) {
    const given = Buffer.from(/^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1] ?? '');
    const want = Buffer.from(token);
    return given.length === want.length && timingSafeEqual(given, want);
}
/** The admin API: the users, read and written with the admin's token. */
async function admin(req, res, path, options) {
    if (!options.adminToken)
        return send(res, 404, { error: 'not_found', error_description: 'no admin: OIDC_ADMIN_TOKEN is not set' });
    if (!path.startsWith('/admin/api/') && req.method === 'GET') {
        if (options.adminDir)
            return asset(res, options.adminDir, path);
        if (path === '/admin' || path === '/admin/')
            return send(res, 200, adminPage(), { 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'" });
    }
    // What the admin app asks before it shows its login: whether there is one.
    if (path === '/admin/api/session' && req.method === 'GET')
        return send(res, 200, { open: Boolean(options.adminOpen) });
    if (!options.adminOpen && !admitted(req.headers.authorization, options.adminToken))
        return send(res, 401, { error: 'unauthorized', error_description: 'the admin token is needed (Authorization: Bearer …)' }, { 'www-authenticate': 'Bearer' });
    if (path === '/admin/api/users' && req.method === 'GET') {
        const users = options.users.all().map(shown);
        return send(res, 200, { users, total: users.length });
    }
    if (path === '/admin/api/users' && req.method === 'POST') {
        // Made by name, as a PUT to its own path: what a list's "create" sends.
        let input;
        try {
            input = JSON.parse((await body(req)) || '{}');
        }
        catch {
            return send(res, 400, { error: 'invalid_request', error_description: 'the body must be JSON' });
        }
        const sub = typeof input.sub === 'string' ? input.sub : '';
        if (options.users.get(sub))
            return send(res, 409, { error: 'conflict', error_description: `user ${sub} exists` });
        const next = userOf(sub, input);
        if ('error' in next)
            return send(res, 400, { error: 'invalid_request', error_description: next.error });
        options.users.put(next);
        return send(res, 201, shown(next));
    }
    const one = /^\/admin\/api\/users\/([^/]+)$/.exec(path);
    if (!one)
        return send(res, 404, { error: 'not_found', error_description: `no ${req.method} ${path}` });
    const sub = decodeURIComponent(one[1]);
    const user = options.users.get(sub);
    if (req.method === 'GET')
        return user ? send(res, 200, shown(user)) : send(res, 404, { error: 'not_found', error_description: `no user ${sub}` });
    if (req.method === 'DELETE')
        return options.users.delete(sub) ? send(res, 200, { deleted: sub }) : send(res, 404, { error: 'not_found', error_description: `no user ${sub}` });
    if (req.method === 'PUT') {
        let input;
        try {
            input = JSON.parse((await body(req)) || '{}');
        }
        catch {
            return send(res, 400, { error: 'invalid_request', error_description: 'the body must be JSON' });
        }
        const next = userOf(sub, input, user);
        if ('error' in next)
            return send(res, 400, { error: 'invalid_request', error_description: next.error });
        options.users.put(next);
        return send(res, user ? 200 : 201, shown(next));
    }
    return send(res, 405, { error: 'method_not_allowed', error_description: `${req.method} on a user: GET, PUT or DELETE` });
}
export function handler(provider, options) {
    return async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://local');
        if (url.pathname === '/health')
            return send(res, 200, { ok: true });
        if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
            return admin(req, res, url.pathname, options).catch((e) => send(res, 400, { error: 'invalid_request', error_description: e.message }));
        }
        const match = ISSUER.exec(url.pathname);
        if (!match || RESERVED.includes(match[1]))
            return send(res, 404, { error: 'not_found', error_description: 'an issuer is a path: /<name>/.well-known/openid-configuration' });
        const proto = String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0];
        const issuer = `${proto}://${req.headers.host}/${match[1]}`;
        const path = match[2] ?? '';
        const query = Object.fromEntries(url.searchParams);
        try {
            if (path === '/.well-known/openid-configuration' && req.method === 'GET')
                return send(res, 200, provider.discovery(issuer));
            if (path === '/jwks' && req.method === 'GET')
                return send(res, 200, provider.jwks());
            if (path === '/authorize' && req.method === 'GET') {
                const request = provider.authorizeRequest(issuer, query);
                if ('error' in request)
                    return send(res, 400, { error: 'invalid_request', error_description: request.error });
                return send(res, 200, loginPage(issuer, query, options.users.of(match[1]), options.openLogin));
            }
            if (path === '/authorize' && req.method === 'POST') {
                const fields = await form(req);
                const request = provider.authorizeRequest(issuer, fields);
                if ('error' in request)
                    return send(res, 400, { error: 'invalid_request', error_description: request.error });
                const users = options.users.of(match[1]);
                const page = (error) => send(res, 400, loginPage(issuer, fields, users, options.openLogin, error));
                if (fields.as !== undefined) {
                    // A user of the store: its claims, and its password when it has one.
                    const user = users.find((u) => u.sub === fields.as);
                    if (!user || (user.password && !passwordMatches(user.password, fields.password ?? '')))
                        return page('Wrong user or password.');
                    return send(res, 302, '', { location: provider.issueCode(request, { sub: user.sub, claims: user.claims }) });
                }
                if (!options.openLogin)
                    return page('Sign in as one of the users.');
                let claims;
                try {
                    claims = JSON.parse(fields.claims || '{}');
                }
                catch {
                    claims = undefined;
                }
                if (!claims || typeof claims !== 'object' || Array.isArray(claims))
                    return page('The claims must be a JSON object.');
                const sub = (fields.username ?? '').trim();
                if (!sub)
                    return page('A user name is needed.');
                return send(res, 302, '', { location: provider.issueCode(request, { sub, claims: claims }) });
            }
            if (path === '/token' && req.method === 'POST') {
                const answer = provider.token(issuer, await form(req), basicClientId(req.headers.authorization));
                return send(res, answer.status, answer.body);
            }
            if (path === '/userinfo' && (req.method === 'GET' || req.method === 'POST')) {
                const answer = provider.userinfo(issuer, req.headers.authorization);
                return send(res, answer.status, answer.body, answer.status === 401 ? { 'www-authenticate': 'Bearer error="invalid_token"' } : {});
            }
            if (path === '/logout' && req.method === 'GET') {
                const back = query.post_logout_redirect_uri;
                if (back && /^https?:\/\//.test(back))
                    return send(res, 302, '', { location: back });
                return send(res, 200, '<!doctype html><meta charset="utf-8"><title>Signed out</title><p>Signed out.</p>');
            }
            return send(res, 404, { error: 'not_found', error_description: `no ${req.method} ${path || '/'} on an issuer` });
        }
        catch (e) {
            return send(res, 400, { error: 'invalid_request', error_description: e.message });
        }
    };
}
/** The provider's key, from the data folder; made there, readable by its owner alone, the first time. */
export function loadKey(dir) {
    const file = join(dir, 'signing-key.pem');
    try {
        return readFileSync(file, 'utf8');
    }
    catch {
        mkdirSync(dir, { recursive: true });
        const pem = newKeyPem();
        writeFileSync(file, pem, { mode: 0o600 });
        return pem;
    }
}
export function start(port = Number(process.env.PORT ?? 8080), dir = process.env.OIDC_DATA ?? '/data') {
    const users = new Users(join(dir, 'users.json'));
    const provider = new Provider(loadKey(dir), { users, passwordGrant: ['1', 'true'].includes(process.env.OIDC_PASSWORD_GRANT ?? '') });
    const adminToken = process.env.OIDC_ADMIN_TOKEN || undefined;
    const adminDir = process.env.OIDC_ADMIN_DIR && statSync(join(process.env.OIDC_ADMIN_DIR, 'index.html'), { throwIfNoEntry: false }) ? process.env.OIDC_ADMIN_DIR : undefined;
    const adminOpen = ['0', 'false'].includes(process.env.OIDC_ADMIN_LOGIN ?? '');
    const server = createServer(handler(provider, { users, ...(adminToken ? { adminToken } : {}), ...(adminOpen ? { adminOpen } : {}), ...(adminDir ? { adminDir } : {}), openLogin: !['0', 'false'].includes(process.env.OIDC_OPEN_LOGIN ?? '') }));
    server.listen(port, () => console.log(`oidc: listening on ${port}; issuers at /<name>`));
    return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const server = start();
    for (const signal of ['SIGTERM', 'SIGINT'])
        process.on(signal, () => server.close(() => process.exit(0)));
}
OIDC_SERVER
COPY --from=admin /admin/dist /opt/oidc/admin
ENV OIDC_DATA=/data PORT=8080 OIDC_ADMIN_DIR=/opt/oidc/admin
USER ${USER_NAME}
CMD ["node", "/opt/oidc/server.js"]
