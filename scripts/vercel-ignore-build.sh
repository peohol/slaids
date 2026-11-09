#!/bin/sh
# Vercel "Ignored Build Step", wired as `ignoreCommand` in vercel.json.
# Exit 0 skips the build; exit 1 lets it run.
#
# Vercel promotes each finished production build in the order the builds
# finish. When GitHub's push notifications reach Vercel late, an older commit
# on the production branch can be built after a newer one and silently
# replace it on the live domains. So a production build runs only when its
# commit is not older than the branch's last successful deployment,
# VERCEL_GIT_PREVIOUS_SHA (Vercel exposes it only to this step).
#
# The repository is private and the build has no Git credentials. The check
# therefore works on Vercel's own shallow clone, which holds the last few
# commits up to the one being built:
#   - previous deployment in that history (an ancestor) -> newer, build
#   - this commit is an ancestor of the previous one   -> older, skip
#   - previous deployment not in the history            -> it is newer than
#     this commit, or older than the clone reaches. Main is deployed on every
#     merge, so the first is the case; skip.
#
# Previews always build, and so does a branch's first deployment. Rolling
# back is unaffected: Vercel's Instant Rollback reuses an existing build and
# never runs this step. If production ever falls further behind than the
# clone reaches, set SLAIDS_ALLOW_OLDER_BUILD=1 in the project for one
# deployment, then remove it.

[ "$VERCEL_ENV" = "production" ] || exit 1
[ "$SLAIDS_ALLOW_OLDER_BUILD" = "1" ] && exit 1

head=$VERCEL_GIT_COMMIT_SHA
previous=$VERCEL_GIT_PREVIOUS_SHA

[ -n "$previous" ] || exit 1
[ "$previous" = "$head" ] && exit 1

if git cat-file -e "${previous}^{commit}" 2>/dev/null; then
  git merge-base --is-ancestor "$previous" "$head" && exit 1
  if git merge-base --is-ancestor "$head" "$previous"; then
    echo "Skipping: ${head} is older than the last production deployment (${previous})."
    exit 0
  fi
  # Unrelated histories, such as after a rewrite of the branch: build what was pushed.
  exit 1
fi

echo "Skipping: the last production deployment (${previous}) is not in this commit's history, so it is newer than ${head}."
exit 0
