#!/bin/zsh

set -euo pipefail
unsetopt BG_NICE 2>/dev/null || true

project_dir="$(cd "$(dirname "$0")" && pwd)"
app_host="127.0.0.1"
app_port="3210"
app_url="http://${app_host}:${app_port}/"

cd "$project_dir"
clear

echo "========================================"
echo "              AI 酒馆"
echo "========================================"
echo

fail_with_message() {
  echo
  echo "启动失败：$1"
  echo
  read "reply?按回车键关闭此窗口。"
  exit 1
}

node_path="$(command -v node 2>/dev/null || true)"

if [[ -z "$node_path" ]]; then
  codex_node_path="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
  if [[ -x "$codex_node_path" ]]; then
    node_path="$codex_node_path"
  fi
fi

if [[ -z "$node_path" ]]; then
  fail_with_message "没有找到 Node.js 22。开发阶段需要先安装 Node.js 22 或从 Codex 中启动项目。"
fi

export PATH="$(dirname "$node_path"):$PATH"
export NEXT_TELEMETRY_DISABLED=1

node_major="$("$node_path" -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 22 )); then
  fail_with_message "当前 Node.js 版本过低，需要 Node.js 22 或更高版本。"
fi

next_cli="$project_dir/node_modules/next/dist/bin/next"

if [[ ! -f "$next_cli" ]]; then
  echo "首次启动正在安装所需组件，请稍候……"

  npm_path="$(command -v npm 2>/dev/null || true)"
  pnpm_path="$(command -v pnpm 2>/dev/null || true)"

  if [[ -n "$npm_path" ]]; then
    "$npm_path" install || fail_with_message "组件安装失败，请检查网络后重试。"
  else
    if [[ -z "$pnpm_path" ]]; then
      codex_pnpm_path="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm"
      if [[ -x "$codex_pnpm_path" ]]; then
        pnpm_path="$codex_pnpm_path"
      fi
    fi

    if [[ -z "$pnpm_path" ]]; then
      fail_with_message "没有找到 npm 或 pnpm，无法完成首次组件安装。"
    fi

    "$pnpm_path" install --lockfile=false || fail_with_message "组件安装失败，请检查网络后重试。"
  fi
fi

if [[ ! -f ".env.local" && -f ".env.example" ]]; then
  cp ".env.example" ".env.local"
  echo "已创建本地配置文件 .env.local。"
fi

existing_page="$(curl --silent --show-error --fail --max-time 1 "$app_url" 2>/dev/null || true)"
if [[ "$existing_page" == *"AI 酒馆"* ]]; then
  echo "AI 酒馆已经在运行，正在打开浏览器……"
  open "$app_url"
  exit 0
fi

if lsof -nP -iTCP:"$app_port" -sTCP:LISTEN >/dev/null 2>&1; then
  fail_with_message "本地端口 ${app_port} 已被其他程序占用。"
fi

echo "正在启动本地开发版本……"
echo "启动完成后会自动打开浏览器。"
echo

"$node_path" "$next_cli" dev --webpack --hostname "$app_host" --port "$app_port" &
server_pid=$!

stop_server() {
  kill "$server_pid" 2>/dev/null || true
}

trap stop_server EXIT INT TERM

for attempt in {1..120}; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    wait "$server_pid" || true
    fail_with_message "本地服务未能正常启动，请查看上方信息。"
  fi

  if curl --silent --show-error --fail --max-time 1 "$app_url" >/dev/null 2>&1; then
    echo
    echo "AI 酒馆已启动：$app_url"
    echo "关闭此窗口或按 Control-C 即可停止。"
    open "$app_url"
    wait "$server_pid"
    exit $?
  fi

  sleep 0.25
done

fail_with_message "等待启动超时，请关闭窗口后重新尝试。"
