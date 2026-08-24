#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

for command in docker kubectl tmux curl rg; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done

if ! docker info >/dev/null 2>&1; then
  open -a Docker
  echo "Waiting for Docker Desktop..."
  for _ in {1..90}; do
    docker info >/dev/null 2>&1 && break
    sleep 2
  done
fi
docker info >/dev/null 2>&1 || { echo "Docker Desktop did not become ready." >&2; exit 1; }

# ponytail: this restores the existing local demo; rerun deployment if its containers were deleted.
for container in ronin-postgres centaur-control-plane; do
  docker inspect "$container" >/dev/null 2>&1 || { echo "Missing container: $container" >&2; exit 1; }
  [ "$(docker inspect -f '{{.State.Running}}' "$container")" = true ] || docker start "$container" >/dev/null
done

for _ in {1..60}; do
  kubectl --context kind-centaur get nodes >/dev/null 2>&1 && break
  sleep 2
done
kubectl --context kind-centaur wait --for=condition=Ready node/centaur-control-plane --timeout=120s >/dev/null
kubectl --context kind-centaur -n centaur rollout status deployment/centaur-centaur-api-rs --timeout=180s >/dev/null

start_tmux() {
  local name=$1 directory=$2 command=$3
  tmux kill-session -t "$name" 2>/dev/null || true
  tmux new-session -d -s "$name" -c "$directory" "$command"
}

start_tmux centaur-api-forward "$ROOT" \
  "exec kubectl --context kind-centaur -n centaur port-forward service/centaur-centaur-api-rs 18080:8080 2>&1 | tee /tmp/centaur-api-forward.log"
for _ in {1..30}; do
  curl -fsS http://127.0.0.1:18080/healthz >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:18080/healthz >/dev/null

tmux kill-session -t ronin-dashboard 2>/dev/null || true
DATABASE_URL=postgresql://ronin:ronin@127.0.0.1:54329/ronin \
  bun run build:dashboard >/tmp/ronin-dashboard-build.log 2>&1
start_tmux ronin-dashboard "$ROOT" \
  "DATABASE_URL=postgresql://ronin:ronin@127.0.0.1:54329/ronin exec bun run --cwd apps/dashboard start 2>&1 | tee /tmp/ronin-dashboard.log"
for _ in {1..60}; do
  curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:3000/api/health >/dev/null

start_tmux ronin-slack "$ROOT/apps/dashboard" \
  "DATABASE_URL=postgresql://ronin:ronin@127.0.0.1:54329/ronin exec bun run slack:connector 2>&1 | tee /tmp/ronin-slack.log"
for _ in {1..120}; do
  rg -q 'running in Socket Mode' /tmp/ronin-slack.log 2>/dev/null && break
  tmux has-session -t ronin-slack 2>/dev/null || { tail -20 /tmp/ronin-slack.log >&2; exit 1; }
  sleep 1
done
tmux has-session -t ronin-slack

slack_status=connecting
rg -q 'running in Socket Mode' /tmp/ronin-slack.log 2>/dev/null && slack_status=connected
echo "Ronin demo is ready: dashboard=http://127.0.0.1:3000 Slack=$slack_status Centaur=ready"
