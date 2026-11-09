#!/bin/sh
# Vercel "Ignored Build Step" (wired as `ignoreCommand` in vercel.json).
# Exit 0 skips the build; exit 1 lets it run.
#
# Vercel promotes every finished production build to the live domains, in the
# order the builds finish. When GitHub's push notifications arrive late, an
# older commit on the production branch can therefore be built after a newer
# one and silently replace it. This guard lets a production build through
# only while its commit is still the tip of the branch it was built from.
#
# Previews always build. When the tip cannot be read, the build runs as it
# would without this guard. Rolling back is unaffected: Vercel's Instant
# Rollback reuses an existing build and never reaches this step.

[ "$VERCEL_ENV" = "production" ] || exit 1

repo="https://github.com/${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}.git"
tip=$(git ls-remote "$repo" "refs/heads/${VERCEL_GIT_COMMIT_REF}" 2>/dev/null | cut -f1)

if [ -z "$tip" ]; then
  echo "Could not read the tip of ${VERCEL_GIT_COMMIT_REF}; building."
  exit 1
fi

if [ "$tip" != "$VERCEL_GIT_COMMIT_SHA" ]; then
  echo "Skipping: ${VERCEL_GIT_COMMIT_SHA} is no longer the tip of ${VERCEL_GIT_COMMIT_REF} (now ${tip})."
  exit 0
fi

exit 1
