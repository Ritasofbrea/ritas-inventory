import type { NextConfig } from "next";

// Patch 30: every build gets an id baked into the client bundle at build
// time, via next.config's `env` key (not a plain NEXT_PUBLIC_* var, since
// VERCEL_GIT_COMMIT_SHA itself isn't NEXT_PUBLIC_-prefixed and wouldn't be
// auto-inlined). Vercel sets VERCEL_GIT_COMMIT_SHA automatically for every
// deployment (Preview and Production); local `next dev` has no such var, so
// it falls back to a fixed string — override it by setting
// VERCEL_GIT_COMMIT_SHA before starting the dev server to simulate a
// different "deploy" (see patch 30 verification).
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? "local-dev",
  },
};

export default nextConfig;
