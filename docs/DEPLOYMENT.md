# Deploying to the EGR site (doc 15 Part A, doc 17 M6)

The prototype is a static site. CI builds it and publishes `dist/` to the `deploy` branch of `radgenst14/HFDS`. The EGR web server serves a Git checkout of that branch. Deployment is done by one teammate on `scully.egr.msu.edu`. No credentials of any kind live in this repository.

Replace `<netid>` with your MSU NetID and `<groupname>` with the team's EGR group name. The group name is still open question **Q-05** in `docs/16_open_issues_and_assumptions.md`.

## Before the first deploy (open questions Q-05, Q-07)

- [ ] Confirm the EGR group name (Q-05).
- [ ] On scully, `git --version` works and `ssh -T git@github.com` can reach GitHub.
- [ ] Decide who owns the checkout. If teammates share a Unix group, any of them can run updates: use 775/664 permissions and `git config core.sharedRepository group`.
- [ ] Decide whether the prototype is public or sits behind the team's password-protected folder.
- [ ] Confirm the course has no required Git host other than GitHub.

## One-time setup on scully

1. On scully, create a read-only deploy key:

   ```bash
   ssh <netid>@scully.egr.msu.edu
   ```

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/prototype_deploy
   ```

2. On GitHub, open **radgenst14/HFDS → Settings → Deploy keys → Add deploy key**. Paste `~/.ssh/prototype_deploy.pub` and leave **Allow write access** unchecked.

3. Clone the `deploy` branch into the team's web folder:

   ```bash
   cd /egr/courses/unix/CSE/435/web/<groupname> && GIT_SSH_COMMAND='ssh -i ~/.ssh/prototype_deploy' git clone --branch deploy --single-branch git@github.com:radgenst14/HFDS.git prototype
   ```

   ```bash
   cd prototype && git config core.sshCommand 'ssh -i ~/.ssh/prototype_deploy'
   ```

4. Copy `scripts/update-egr.sh` from this repository to `~/bin/update-egr.sh` on scully, then make it executable:

   ```bash
   chmod 755 ~/bin/update-egr.sh
   ```

## Every update

1. Merge to `main`. Wait for the **deploy** workflow (the `verify` and `build` jobs) to pass; it updates the `deploy` branch.
2. On scully:

   ```bash
   HFDS_EGR_GROUP=<groupname> ~/bin/update-egr.sh
   ```

The script pulls with `--ff-only`, sets 755 on directories and 644 on files, and removes world access to `.git`.

## Verify after each deploy

- [ ] `https://www.egr.msu.edu/cse435/<groupname>/prototype/` loads, and the scenario picker lists every preset.
- [ ] `https://www.egr.msu.edu/cse435/<groupname>/prototype/.git/HEAD` returns **403 or 404**. Both the permissions and `public/.htaccess` (`RedirectMatch 404 /\.git`) guard it. If it returns 200, run the update script again and check that EGR Apache honours `.htaccess` (Q-07).
- [ ] `#scenario=s01-activation-success` plays S01 to "Solid green — hands-free", and the event log fills.
- [ ] A time link works: `#scenario=s09-inattention-ignored&t=40` opens paused at 40.00 s.
- [ ] The team's existing pages and `protected/` folder next to `prototype/` are untouched.

## Rolling back

On scully, check out the previous published commit:

```bash
cd /egr/courses/unix/CSE/435/web/<groupname>/prototype && git log --oneline -5
```

```bash
git checkout <commit> && HFDS_EGR_GROUP=<groupname> ~/bin/update-egr.sh
```

The update script's `git pull --ff-only` refuses to run from a detached checkout. To return to the latest version, run `git checkout deploy` first, then run the script again.
