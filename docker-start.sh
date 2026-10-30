#!/bin/bash
# 资源书架 · Docker 部署脚本
# 用法:
#   bash docker-start.sh up        构建并启动（首次自动创建数据卷与管理员账户）
#   bash docker-start.sh down      停止并移除容器（数据卷保留）
#   bash docker-start.sh restart   重启
#   bash docker-start.sh logs      查看日志
#   bash docker-start.sh status    查看状态
#   bash docker-start.sh backup    备份数据卷到 backup/
#   bash docker-start.sh restore <file.tar.gz>  从备份恢复

cd "$(dirname "$0")"
# Compose 项目名默认取目录名，中文目录会被清洗，这里固定下来，保证数据卷名可预测
COMPOSE_PROJECT=bookshelf
export COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT
SERVICE=bookshelf
VOLUME=${COMPOSE_PROJECT}_bookshelf-data
CONTAINER=bookshelf

# 优先用 docker compose，旧版插件退回 docker-compose
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  COMPOSE=""
fi

need_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "未找到 docker 命令。请先安装 Docker：https://docs.docker.com/engine/install/"
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker 服务没有运行，或无权限访问 /var/run/docker.sock。"
    echo "Linux 下可执行：sudo systemctl start docker；当前用户需加入 docker 组。"
    exit 1
  fi
  if [ -z "$COMPOSE" ]; then
    echo "未找到 docker compose 或 docker-compose，请安装 Compose 插件。"
    exit 1
  fi
}

case "$1" in
  up)
    need_docker
    # 生成 .env（不存在时），便于首次修改管理员密码
    if [ ! -f .env ]; then
      cat > .env <<ENVEOF
# 资源书架环境变量。修改后执行 bash docker-start.sh restart 生效
PORT=3000
ADMIN_EMAIL=admin@admin.com
ADMIN_PASSWORD=admin123
# 生产环境请改成随机长字符串
JWT_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '\n=+/' | cut -c1-40)
TZ=Asia/Shanghai
ENVEOF
      echo "已生成 .env，可在其中修改管理员账户与端口。"
    fi
    $COMPOSE up -d --build
    port=$(grep -E '^PORT=' .env | cut -d= -f2)
    port=${port:-3000}
    echo "服务已启动，访问 http://localhost:${port}"
    echo "后台控制面板: http://localhost:${port}/admin"
    ;;
  down)
    need_docker
    $COMPOSE down
    echo "容器已停止，数据卷 ${VOLUME} 保留"
    ;;
  restart)
    need_docker
    $COMPOSE restart
    ;;
  logs)
    need_docker
    $COMPOSE logs -f --tail=100
    ;;
  status)
    need_docker
    $COMPOSE ps
    ;;
  backup)
    need_docker
    mkdir -p backup
    name="bookshelf-$(date +%Y%m%d-%H%M%S).tar.gz"
    docker run --rm -v "$VOLUME":/data -v "$PWD/backup":/backup alpine \
      tar czf "/backup/$name" -C /data .
    echo "已备份到 backup/$name"
    ;;
  restore)
    need_docker
    [ -n "$2" ] || { echo "用法: bash docker-start.sh restore backup/bookshelf-xxx.tar.gz"; exit 1; }
    [ -f "$2" ] || { echo "备份文件不存在: $2"; exit 1; }
    $COMPOSE stop
    docker run --rm -v "$VOLUME":/data -v "$PWD/backup":/backup alpine \
      sh -c "rm -rf /data/* && tar xzf /backup/$(basename "$2") -C /data"
    $COMPOSE start
    echo "已从 $2 恢复"
    ;;
  *)
    echo "用法: bash $0 {up|down|restart|logs|status|backup|restore <file>}"
    exit 1
    ;;
esac
