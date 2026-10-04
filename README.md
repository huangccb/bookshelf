# 共享书架

一个自托管的共享书架网站：邮箱注册登录、按作品归并展示、多格式电子书在线阅读，并支持从豆瓣检索补全书籍元数据与封面。

## 功能

- 邮箱注册与登录（JWT，7 天有效期）
- 一个系列归并为一张卡片，用第 1 卷的封面代表整个系列
- 网格 / 列表两种浏览方式，一键切换
- 书籍详情页：封面、作者、出版年、出版社、ISBN、简介与卷册列表
- 按书名检索元数据，自动补全封面、作者、出版年份与简介，也可手动填写修改
- 支持 EPUB、PDF、TXT、DOCX、MOBI、AZW3 上传
- 在线阅读器，支持调节字号、行距、主题、字体

## 快速开始

```bash
npm install
node server.js
```

访问 http://localhost:3000

首次启动会自动创建管理员账户，默认 `admin@rhodes.island` / `admin123`，
可通过环境变量 `ADMIN_EMAIL`、`ADMIN_PASSWORD` 覆盖。

### 服务管理

```bash
bash serve.sh start     # 启动
bash serve.sh stop      # 停止
bash serve.sh restart   # 重启
bash serve.sh status    # 查看状态
bash serve.sh log       # 查看日志
```

## 目录结构

```
server.js         Express 服务与接口
db.js             JSON 文件数据库
metadata.js       豆瓣图书元数据检索与封面下载
epub_extract.js   EPUB 服务端解析
public/           前端页面、样式与脚本
uploads/          上传的书籍文件
covers/           抓取到的封面图片
data.json         数据库文件
```

## 元数据检索

检索入口在上传页：输入书名后点击「搜索元数据」，从结果中挑选匹配的版本，
作者、出版年、出版社、ISBN、简介与封面会自动填入表单，可在上传前任意修改。
封面会随书籍一并保存到本地 `covers/` 目录。

上传完成后，书籍详情页的「元数据」面板仍可手动修改各项文字字段，或删除封面。

数据来源为豆瓣图书，服务端代理请求并校验来源域名。检索不到时可直接手动填写。

## 移动端适配

- 字号与间距使用 `clamp()` 流式缩放，随屏幕宽度连续变化
- 768px 以下：顶栏换行、书架网格收窄、列表行由多列网格改为两栏卡片式
- 420px 以下：面板与网格进一步收紧，元数据列表改为单列
- 阅读器工具栏在窄屏下纵向堆叠，控件自动换行

## 技术栈

- 后端：Express、bcryptjs、jsonwebtoken、multer、jszip
- 前端：原生 HTML/CSS/JS 单页应用，hash 路由
- 阅读器：服务端 EPUB 解析、PDF.js、mammoth.js

## 说明

MOBI 与 AZW3 仅支持上传和下载，暂不支持在线阅读。
