#!/bin/sh
# Keeps an older production build from replacing a newer one on the live
# domains. Wired twice in vercel.json:
#
#   ignoreCommand  `sh scripts/vercel-ignore-build.sh`
#                  Vercel's "Ignored Build Step": exit 0 skips the build,
#                  exit 1 lets it run.
#   buildCommand   `… && sh scripts/vercel-ignore-build.sh --after-build`
#                  Exit 1 fails the build, so a failed build is never promoted.
#
# Vercel promotes each finished production build in the order the builds
# finish. When GitHub's push notifications arrive late, or a newer commit is
# pushed while a build is running, an older commit on the production branch
# can finish last and replace the newer one. So a production build runs, and
# is kept, only while its commit is still the tip of its branch. The check
# before the build skips late notifications. The check after the build
# closes the window of the build itself.
#
# Previews always build. When the tip cannot be read, both checks let the
# build through, as before this guard. Rolling back is unaffected: Vercel's
# Instant Rollback reuses an existing build and never runs these steps.

after_build=false
[ "$1" = "--after-build" ] && after_build=true

# Exit code that lets the build go ahead / that stops it, for this mode.
if $after_build; then proceed=0; stop=1; else proceed=1; stop=0; fi

[ "$VERCEL_ENV" = "production" ] || exit $proceed

repo="https://github.com/${VERCEL_GIT_REPO_OWNER}/${VERCEL_GIT_REPO_SLUG}.git"
tip=$(git ls-remote "$repo" "refs/heads/${VERCEL_GIT_COMMIT_REF}" 2>/dev/null | cut -f1)

if [ -z "$tip" ]; then
  echo "Could not read the tip of ${VERCEL_GIT_COMMIT_REF}; building."
  exit $proceed
fi

if [ "$tip" != "$VERCEL_GIT_COMMIT_SHA" ]; then
  echo "Stopping: ${VERCEL_GIT_COMMIT_SHA} is no longer the tip of ${VERCEL_GIT_COMMIT_REF} (now ${tip})."
  exit $stop
fi

exit $proceed
