#!/usr/bin/env bash
# Run on scully.egr.msu.edu to update the live prototype (doc 15 Part A, "Every update").
# Copy to ~/bin on scully. The EGR group name is still open (Q-05), so it is passed in:
#   HFDS_EGR_GROUP=<groupname> update-egr.sh
# Live URL afterwards: https://www.egr.msu.edu/cse435/<groupname>/prototype/
set -euo pipefail

GROUP="${HFDS_EGR_GROUP:?set HFDS_EGR_GROUP to the team's EGR group name (Q-05)}"
cd "/egr/courses/unix/CSE/435/web/${GROUP}/prototype"

git pull --ff-only
find . -path ./.git -prune -o -type d -exec chmod 755 {} +
find . -path ./.git -prune -o -type f -exec chmod 644 {} +
chmod -R o-rwx .git   # web server cannot read repo metadata

echo "Updated to $(git rev-parse --short HEAD). Check that /prototype/.git/HEAD returns 403 or 404."
