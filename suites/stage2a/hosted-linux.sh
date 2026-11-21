#!/usr/bin/env bash
# Run only in the existing disposable GitHub-hosted Ubuntu conformance job.
set -euo pipefail
[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_OS:-} == Linux && ${RUNNER_ENVIRONMENT:-} == github-hosted && $EUID != 0 ]]

hq=f07a9fb57cc0548a5293bff967ed7e0f0c3224e3
contracts=b96239cc47571237f7064ddbcbd0edec8e365c6b
archive_sha=987f9e1039f44c0bc8799ff6494818aef6f4ec2d74fabf7dc91c05abe04bc4ec
work=$(mktemp -d "${RUNNER_TEMP:?}/stage2a-linux.XXXXXXXX")
fetch_public() {
  local repo=$1 sha=$2 dir=$3
  git init --quiet "$dir"
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 \
    git -C "$dir" -c credential.helper= fetch --quiet --no-tags --depth=1 "https://github.com/true-line/$repo.git" "$sha"
  git -C "$dir" checkout --quiet --detach FETCH_HEAD
  [[ $(git -C "$dir" rev-parse HEAD) == "$sha" ]]
}
fetch_public agent-bot-hq "$hq" "$work/hq"
fetch_public soul-contracts "$contracts" "$work/contracts-source"
mkdir "$work/contracts"
git -C "$work/contracts-source" archive HEAD errors fixtures schemas | tar -x -C "$work/contracts"
# The product's native Linux release builder verifies its contracts manifest.
(cd "$work/hq" && node scripts/build-interim-release.mjs "$hq" "$work/contracts" "$work/hq.tar")
printf '%s  %s\n' "$archive_sha" "$work/hq.tar" | sha256sum --check --status

for role in agent-bot-hq s2harness-a s2harness-b; do
  sudo -n useradd --system --user-group --create-home --shell /usr/sbin/nologin "$role"
  sudo -n chmod 0700 "/home/$role"
done
# Provision the reviewed permissions as the disposable runner administrator.
# No sudoers changes. The collector and each participant remain unprivileged.
endpoints=$(sudo -n mktemp -d /run/soul-conformance.XXXXXXXX)
sudo -n chmod 0755 "$endpoints"
sudo -n install -d -o "$(id -u)" -g "$(id -g)" -m 0700 "$endpoints/claim"
for account in s2harness-a s2harness-b; do
  sudo -n install -d -o agent-bot-hq -g "$account" -m 2750 "$endpoints/$account"
done
report=reports/stage2a-linux.json
rc=0
node suites/stage2a/run.mjs --archive "$work/hq.tar" --sha256 "$archive_sha" \
  --commit "$hq" --accounts s2harness-a,s2harness-b --linux-fixture-dir "$endpoints" --offline-platform --out "$report" || rc=$?
[[ $rc == 1 ]]
jq -e --arg digest "$archive_sha" --arg hq "$hq" '
  .outcome == "incomplete" and .host.os == "linux" and .host.environment == "isolated-linux-endpoints"
  and .suite_revision.clean and .enforcement_profile.in_force == "managed-cooperative"
  and .dependency_versions.hq == {commit:$hq, archive_sha256:$digest}
  and .dependency_versions.broker.source == "archived HQ reference broker"
  and (.checks | map(select(.id == "T01-positive")) | map([.result, .observed]))
    == [["pass", [
      {pass:1,distinct_harness_uids:2,own_account_binds:2,directive_reads:2,persisted_cooperative_receipts:2},
      {pass:2,distinct_harness_uids:2,own_account_binds:2,directive_reads:2,persisted_cooperative_receipts:4}
    ]]]
  and ([.checks[] | select(.result == "not-qualified") | .id] == ["T01","T02","T03","T21"])
' "$report" >/dev/null
