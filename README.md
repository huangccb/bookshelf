# 共享书架

一个自托管的共享书架网站：邮箱注册登录、按作品归并展示、多格式电子书在线阅读，支持从豆瓣检索补全书籍元数据与封面，并带一个独立的 `/admin` 后台控制面板。

## 功能

- 邮箱注册与登录（JWT，7 天有效期）
- 一个系列归并为一张卡片，用第 1 卷的封面代表整个系列
- 网格 / 列表两种浏览方式，一键切换
- 书籍详情页：封面、作者、出版年、出版社、ISBN、简介与卷册列表
- 上传时按书名检索元数据，自动补全封面、作者、出版年份与简介，也可手动填写修改
- 支持 EPUB、PDF、TXT、DOCX、MOBI、AZW3 上传
- 在线阅读器：调节字号、行距、主题、字体，以及图片缩放
- EPUB 内嵌图片、PDF 页面自动适配屏幕宽度
- 自动识别正文编码，UTF-8 / GBK / Big5 的中文 TXT 与 EPUB 都不会乱码
- 后台控制面板：书籍列表、修改、删除、详情、批量删除，账户与权限管理
- Docker 一键部署，数据卷持久化
- GitHub Actions 自动构建多架构镜像并推送到 GHCR

## 快速开始

### 方式一：本机直接运行

```bash
npm install
node server.js
```

访问 http://localhost:3000

### 网址结构

| 网址 | 页面 |
|---|---|
| `/` | 书籍页面（主目录），未登录自动跳转到登录页 |
| `/login` | 登录页，独立页面 |
| `/register` | 注册页，独立页面 |
| `/admin` | 后台控制面板，仅管理员 |

### 方式二： Docker

```bash
bash docker-start.sh up
```

首次启动会构建镜像、创建数据卷并生成 `.env`，随后可以访问：

- 前台：http://localhost:3000
- 后台：http://localhost:3000/admin

`.env` 里的关键变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 宿主机端口 |
| `ADMIN_EMAIL` | `admin@admin.com` | 首次启动创建的管理员邮箱 |
| `ADMIN_PASSWORD` | `admin123` | 首次启动创建的管理员密码 |
| `JWT_SECRET` | 自动生成 | 令牌签名密钥，生产环境务必替换 |
| `TZ` | `Asia/Shanghai` | 容器时区 |

数据全部保存在 `bookshelf_bookshelf-data` 数据卷里（`<项目名>_bookshelf-data`），
容器重建不会丢书。用 `bash docker-start.sh backup` 备份、`restore <文件>` 恢复。

也可以直接用 compose：

```bash
docker compose up -d --build
docker compose logs -f
```

### 方式三：用 CI 构建好的镜像（免本地构建）

仓库自带 GitHub Actions 工作流 `.github/workflows/docker.yml`：推送到 `master`、
打 `v*` 标签或手动触发时，会构建 `linux/amd64` + `linux/arm64` 双架构镜像并推送到
GitHub Container Registry。直接拉取即可：

```bash
docker pull ghcr.io/huangccb/bookshelf:latest
docker run -d --name bookshelf \
  -p 3000:3000 \
  -v bookshelf-data:/app/data \
  -e ADMIN_EMAIL=admin@admin.com \
  -e ADMIN_PASSWORD=admin123 \
  -e JWT_SECRET=请换成随机长字符串 \
  -e TZ=Asia/Shanghai \
  ghcr.io/huangccb/bookshelf:latest
```

也可以用 compose 跑同一个镜像：

```bash
IMAGE=ghcr.io/huangccb/bookshelf:latest docker compose pull
IMAGE=ghcr.io/huangccb/bookshelf:latest docker compose up -d
```

镜像标签规则：

| 触发 | 标签 |
|---|---|
| 推送 `master` | `latest`、`<分支名>`、`sha-<短哈希>` |
| 打 `v0.1.0` 这类标签 | `0.1.0`、`0.1`、`sha-<短哈希>`，并自动创建 Release |
| PR | 只构建不推送（`pr-<编号>`） |

工作流用内置的 `secrets.GITHUB_TOKEN` 登录 GHCR，不需要额外配置 Secret；
若首次推送后镜像不可拉取，到仓库的 **Settings → Actions → General → Workflow permissions**
确认已允许读写，并在包设置里把可见性改成 public（或登录后再拉私有包）：

```bash
echo "$GITHUB_TOKEN" | docker login ghcr.io -u <你的用户名> --password-stdin
```

### 手动构建镜像

不用脚本时，直接构建并运行：

```bash
docker build -t bookshelf:latest .
docker run -d --name bookshelf \
  -p 3000:3000 \
  -v bookshelf-data:/app/data \
  -e ADMIN_EMAIL=admin@admin.com \
  -e ADMIN_PASSWORD=admin123 \
  -e JWT_SECRET=请换成随机长字符串 \
  -e TZ=Asia/Shanghai \
  bookshelf:latest
```

镜像要点：

- 基础镜像 `node:22-alpine`，依赖层基于 `package.json` + `package-lock.json` 单独缓存
- 以非 root 用户 `node` 运行，容器内监听 `3000`
- **全部运行期数据只在 `/app/data` 一个目录**：数据库 `data.json`、`uploads/`、`covers/`
- 内置 `HEALTHCHECK`，探测 `GET /api/health`，可用 `docker inspect --format '{{.State.Health.Status}}' bookshelf` 查看
- 仓库里的 `data.json`、`uploads/`、`covers/` 被 `.dockerignore` 排除，**不会打进镜像**

> 首次启动时会在数据目录里新建一个空库并创建管理员账户；若要延续本地已有的书，
> 在启动前把本地的 `data.json`、`uploads/`、`covers/` 拷进数据卷，或在容器启动后逐本重新上传。

### 服务管理（本机运行）

```bash
bash serve.sh start     # 启动
bash serve.sh stop      # 停止
bash serve.sh restart   # 重启
bash serve.sh status    # 查看状态
bash serve.sh log       # 查看日志
```

## 版本与发布

版本号写在 `package.json` 的 `version` 里，变更记录见 [CHANGELOG.md](CHANGELOG.md)。
发一版新版本只需要打标签并推送：

```bash
# 1. 改 package.json 的 version、补 CHANGELOG.md 条目并提交
git commit -am "发布 0.1.0"
# 2. 打标签并推送，CI 会自动完成剩下的
git tag -a v0.1.0 -m "v0.1.0 预览版"
git push origin master --follow-tags
```

标签推送后 [docker.yml](.github/workflows/docker.yml) 会：

1. 构建 `linux/amd64` + `linux/arm64` 镜像并推送到 `ghcr.io/huangccb/bookshelf`
   （标签 `0.1.0`、`0.1`、`sha-xxxxxxx`）；
2. 等镜像就绪后创建 GitHub Release，正文取自 `CHANGELOG.md` 对应版本的段落，
   源码 zip / tar.gz 由 GitHub 自动附加；
3. `0.x` 或带预发布后缀的版本自动标记为 **Prerelease（预览版）**，不会被当成 latest。

当前版本：**0.1.0 · 预览版**。

## 默认管理员

首次启动会自动创建管理员账户：

- 邮箱 `admin@admin.com`
- 密码 `admin123`

可通过环境变量 `ADMIN_EMAIL`、`ADMIN_PASSWORD` 覆盖。
旧版本的默认管理员（`admin@rhodes.island`）会在升级启动时自动改名为新邮箱，
角色与上传的书籍归属一并保留；如果新邮箱已经存在，则跳过这次改名。

> 部署到公网前请登录后台重置密码，并更换 `JWT_SECRET`。

## 后台控制面板

后台固定地址：`/admin`。前台任何页面都不提供进入后台的按钮或链接，只能手动输入网址访问。
后台使用独立的登录状态（存在浏览器 `localStorage.adminToken`），不会因为已登录前台就自动进入。

### 书籍管理

后台首页以表格列出全部书籍（不分系列归并，一本一行），每行显示封面、书名、作者、
系列与卷册、格式、大小、上传者与上传时间，可按列排序、按关键词筛选。

每行右侧有「详情」「修改」「删除」三个按钮，批量选择放在「批量修改」弹窗里完成：

- **详情**：弹窗展示完整元数据、简介、文件大小与上传者
- **修改**：直接编辑书名、作者、系列、卷号、出版年、出版社、ISBN、简介与封面
- **删除**：二次确认后删除记录，并清理书籍文件与封面

列表上方有「批量修改」按钮：弹窗内列出当前筛选结果，可勾选任意多本（支持全选），
点「批量删除」二次确认后一次性删除。列表本身不带勾选框，保持一行一本书的清爽布局。

### 账户与权限

| 权限 | 管理员 | 普通用户 |
|---|:---:|:---:|
| 阅读全部书籍 | 有 | 有 |
| 下载书籍文件 | 有 | 有 |
| 上传书籍 | 有 | 有 |
| 修改自己上传的书籍 | 有 | 有 |
| 修改他人上传的书籍 | 有 | 无 |
| 删除书籍 | 有 | 无 |
| 管理账户、调整角色、重置密码 | 有 | 无 |
| 进入后台 | 有 | 无 |

在「账户与权限」页可以新建账户、下拉切换角色、重置密码、删除账户。
不能取消自己的管理员身份，也不能删除自己的账户。

权限在服务端校验：普通用户调用删除接口、批量删除接口或后台接口一律返回 `403`；
改角色或删账户后，旧令牌立即失效，无需等待过期。

## 目录结构

```
server.js            Express 服务与接口
db.js                JSON 文件数据库，数据目录可配置
metadata.js          豆瓣图书元数据检索与封面下载
epub_extract.js      EPUB 服务端解析
text_decode.js       中文编码探测
public/              前台页面、样式与脚本
public/login.html    登录页（由 /login 提供）
public/register.html 注册页（由 /register 提供）
public/admin.html    后台页面（由 /admin 提供）
public/js/admin.js   后台控制面板逻辑
public/css/admin.css 后台样式，沿用前台配色
uploads/             上传的书籍文件（运行期生成）
covers/              抓取到的封面图片（运行期生成）
data.json            数据库文件
Dockerfile           运行镜像
docker-compose.yml   Compose 编排
docker-start.sh      Docker 部署与备份脚本
.dockerignore        镜像构建排除项
CHANGELOG.md         版本更新日志
.github/workflows/   GitHub Actions 构建镜像的工作流
serve.sh             本机服务管理脚本
```

> 目录里的 `data.json`、`uploads/`、`covers/` 是本机开发时的运行期数据，
> 已被 `.gitignore` 与 `.dockerignore` 排除：既不进仓库，也不进镜像。Docker 部署下它们位于数据卷的 `/app/data`。

运行期数据目录可用 `DATA_DIR` 指定（Docker 下为 `/app/data`），
`UPLOADS_DIR`、`COVERS_DIR`、`DB_PATH` 可单独覆盖。

## 元数据检索

检索入口在上传页：输入书名后点击「搜索元数据」，从结果中挑选匹配的版本，
作者、出版年、出版社、ISBN、简介与封面会自动填入表单，可在上传前任意修改。
封面会随书籍一并保存到本地 `covers/` 目录。

数据来源为豆瓣图书，服务端代理请求并校验来源域名。检索不到时可直接手动填写。

## 修改书籍

前台书籍详情页底部，对**管理员**和**该书的上传者**会显示「修改」按钮；
后台则在书籍列表每行直接提供「修改」。

书籍列表与详情接口都会返回 `can_edit`、`can_delete` 字段，前端据此决定是否显示入口。

## 账户中心

登录仍然只用邮箱和密码。顶栏右上角的用户按钮显示用户名，点击进入账户中心 `/account`。

- **用户名**：仅用于显示，不参与登录、不做唯一性校验。注册时选填，留空自动取邮箱前缀；老账户在启动时自动补齐邮箱前缀，顶栏始终有名字可显示。
- **资料**：可修改用户名与邮箱，邮箱修改后请用新邮箱登录。
- **密码**：需输入当前密码，新密码填写两次并保持一致，前端实时比对、后端再次校验。
- 邮箱或密码变更后会重新签发登录令牌，旧密码立即失效。

账户中心下方直接展示两块内容，均为网格布局：

- **历史阅读**：按最近阅读时间倒序，打开阅读器即记录一次，同一本书只保留最新时间。
- **我的上传**：按上传时间倒序，角标标注「我上传」。

一级只展示 5 本，超过 5 本时用「查看全部」打开弹窗浏览全部书籍，不跳转新页面。

相关接口：

| 方法与路径 | 说明 |
|---|---|
| `PUT /api/account` | 修改自己的用户名、邮箱、密码 |
| `GET /api/history` | 阅读历史，`limit` / `offset` 分页 |
| `GET /api/my-books` | 自己上传的书籍，`limit` / `offset` 分页 |
| `POST /api/books/:id/progress` | 记录进度，同时刷新最近阅读时间 |

## 界面风格

账户中心的卡片沿用 Cloud Design：线性云朵图标与云形装饰，配色从现有蓝白色板派生，移动端自动折叠为单列网格与全屏弹窗。

## 文本编码

中文 TXT 与 EPUB 常见 GBK / Big5 编码，直接按 UTF-8 读取会整篇乱码。
`text_decode.js` 按以下顺序处理：

1. 识别 UTF-8 / UTF-16 的 BOM
2. 严格模式试解 UTF-8，通过则直接采用
3. 否则在 GB18030、Big5、Shift_JIS、EUC-KR 中逐一试解，按高频汉字命中率打分取最优
4. 全部失败时退回宽松 UTF-8

TXT 正文与 EPUB 章节都走这条路径，因此编码不一致的书籍也能正常显示。

## 阅读器

界面沿用主流阅读应用的版式：暖纸底色、章节标题加粗放大、正文首行缩进两字、
两端对齐、宽松行距。顶栏只保留返回与书名，控件收进底部的图标栏。

底部三个入口：

- **目录**：EPUB 按章节标题生成，点击平滑跳转；没有分章信息的格式自动置灰
- **主题**：白、纸黄、豆绿、夜间四套配色，切换后整页立刻生效
- **字体**：字号滑杆（14–30）、边距（小/中/大）、行距（紧/中/松）、字体与图片缩放

主题通过 `.reader-page[data-theme]` 上的一组 CSS 变量驱动，正文、顶栏、面板
与控件共用同一套颜色，切换时不残留旧配色。阅读偏好保存在浏览器本地。

图片默认按阅读区宽度自适应：EPUB 章节内的图片会连同内联的 `width` / `height`
属性一起被约束，PDF 页面则按容器宽度重新渲染。放大超过 100% 时阅读区可横向滚动。

EPUB 章节里的相对资源地址（`images/pic.png`、`../images/pic.png`）会在服务端
解析为 ZIP 内路径，并通过 `/api/books/:id/resource` 提供，因此内嵌图片可以正常显示。

## 移动端适配

- 字号与间距使用 `clamp()` 流式缩放，随屏幕宽度连续变化
- 768px 以下：顶栏换行、书架网格收窄、列表行由多列网格改为两栏卡片式
- 860px 以下：后台侧栏折叠为顶部横向导航，书籍表格折叠为卡片，每张卡片自带操作按钮
- 420px 以下：面板与网格进一步收紧，元数据列表改为单列

## 接口一览（后台相关）

| 方法与路径 | 权限 | 说明 |
|---|---|---|
| `GET /admin` | 公开（页面内自行登录） | 后台页面，带 `noindex` 头 |
| `GET /api/admin/books` | 管理员 | 全部书籍，带上传者邮箱 |
| `POST /api/books/batch` | 管理员 | 批量删除，`{ action: "delete", ids: [] }` |
| `DELETE /api/books/:id` | 管理员 | 删除单本及其文件、封面 |
| `GET /api/admin/users` | 管理员 | 账户列表与角色 |
| `POST /api/admin/users` | 管理员 | 新建账户 |
| `PUT /api/admin/users/:id` | 管理员 | 改角色、改邮箱、重置密码 |
| `DELETE /api/admin/users/:id` | 管理员 | 删除账户 |
| `GET /api/admin/stats` | 管理员 | 书籍数、账户数、文件总量 |
| `GET /api/health` | 公开 | 健康检查 |

## 技术栈

- 后端：Express、bcryptjs、jsonwebtoken、multer、jszip
- 前端：原生 HTML/CSS/JS，前台使用 hash 路由，后台为独立页面
- 阅读器：服务端 EPUB 解析、PDF.js、mammoth.js
- 部署：Node 22 Alpine 镜像，Compose 编排，数据卷持久化

## 说明

MOBI 与 AZW3 仅支持上传和下载，暂不支持在线阅读。
