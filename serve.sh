#!/bin/bash
# 资源书架服务管理脚本
# 用法: bash serve.sh start|stop|restart|status|log

cd "$(dirname "$0")"
APP="server.js"
LOG="server.log"
PORT=3000

# 通过端口探测服务是否存活
is_up() {
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/" 2>/dev/null)
  [ "$code" = "200" ]
}

# 找到占用端口的 node 进程 PID
find_pid() {
  for p in /proc/[0-9]*; do
    pid=${p#/proc/}
    if [ -r "$p/cmdline" ]; then
      cmd=$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null)
      case "$cmd" in
        *"node"*"server.js"*) echo "$pid"; return 0 ;;
      esac
    fi
  done
  return 1
}

case "$1" in
  start)
    if is_up; then
      echo "服务已在运行 (端口 ${PORT})"
      exit 0
    fi
    nohup node "$APP" > "$LOG" 2>&1 &
    # 轮询等待端口就绪：首次启动要建管理员账户，耗时可能超过 10 秒
    ready=0
    for _ in $(seq 1 40); do
      sleep 0.5
      if is_up; then ready=1; break; fi
    done
    if [ "$ready" = "1" ]; then
      echo "服务已启动 (PID $(find_pid))"
      echo "访问地址: http://localhost:${PORT}"
    else
      echo "启动失败，最后 20 行日志："
      tail -20 "$LOG"
      exit 1
    fi
    ;;
  stop)
    pid=$(find_pid)
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null
      sleep 1
      echo "服务已停止 (PID $pid)"
    else
      echo "服务未在运行"
    fi
    ;;
  restart)
    bash "$0" stop
    sleep 1
    bash "$0" start
    ;;
  status)
    if is_up; then
      pid=$(find_pid)
      echo "运行中 (PID ${pid:-未知})"
      curl -s -o /dev/null -w "HTTP 状态: %{http_code}\n" "http://localhost:${PORT}/"
    else
      echo "未运行"
    fi
    ;;
  log)
    tail -50 "$LOG" 2>/dev/null || echo "暂无日志"
    ;;
  *)
    echo "用法: bash $0 {start|stop|restart|status|log}"
    exit 1
    ;;
esac
