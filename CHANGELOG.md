# 更新日志

版本号对应 Git 标签 `v<版本>`。标签推送后 GitHub Actions 会自动构建
`linux/amd64` + `linux/arm64` 镜像并推送到 `ghcr.io/huangccb/bookshelf`，
同时创建带源码包的 Release。

## 0.1.0 · 预览版（2026-10-31）

首个公开预览版：自托管书架 + 在线阅读器 + 后台控制面板，镜像由 CI 自动构建。

### 书架与阅读

- 邮箱注册 / 登录（JWT，7 天有效期），密码 bcrypt 存储
- 一个系列归并为一张卡片，用第 1 卷封面代表整个系列
- 网格 / 列表两种浏览方式，一键切换
- 书籍详情页：封面、作者、出版年、出版社、ISBN、简介与卷册列表
- 支持 EPUB、PDF、TXT、DOCX、MOBI、AZW3 上传
- 阅读器：字号、行距、主题、字体、图片缩放，阅读进度按账号保存
- EPUB 内嵌图片内联显示、PDF 页面自适应屏幕宽度
- 中文编码自动识别（UTF-8 / GBK / Big5），TXT 走服务端解码接口，避免浏览器强解乱码
- 上传时检索豆瓣元数据，自动补全封面、作者、出版年份、ISBN 与简介，也可手动修改

### 账户与后台

- 账户中心：修改用户名 / 邮箱 / 密码、历史阅读、我的上传
- `/admin` 后台：书籍列表与详情、修改、删除、批量删除，账户与权限管理、统计概览
- 权限模型：管理员与普通用户，上传者与管理员可修改自己的书

### 部署

- `Dockerfile`：`node:22-alpine`、非 root 用户运行、运行期数据集中在 `/app/data` 数据卷
- 内置 `HEALTHCHECK` 探测 `GET /api/health`
- `docker-compose.yml` + `docker-start.sh`：up / down / restart / logs / status / backup / restore
- GitHub Actions：多架构 buildx 构建、GHCR 推送、provenance 与 SBOM

### 已知限制（预览版）

- 数据存放在单个 JSON 文件（`data.json`），适合个人或小团队规模，不适合高并发写入
- 接口、数据结构与界面在 1.0 之前仍可能变动，升级前请备份数据卷
- 没有邮箱找回密码流程：忘记密码需要管理员在后台重置
- 仅做了移动端基础适配，未覆盖全部屏幕尺寸与浏览器

## 版本升级指引

```bash
# 备份数据卷
bash docker-start.sh backup
# 拉取新镜像并重建容器（数据卷保留）
IMAGE=ghcr.io/huangccb/bookshelf:<新版本> docker compose pull
IMAGE=ghcr.io/huangccb/bookshelf:<新版本> docker compose up -d
```
