# 罗德岛共享书架 (Arknights Bookshelf)

明日方舟风格的共享书架网站，支持邮箱注册登录、分层书架展示、多格式电子书在线阅读。

## 功能

- 邮箱注册与登录（JWT）
- 按系列分层展示书籍
- 支持 EPUB、PDF、TXT、DOCX、MOBI、AZW3 上传
- 在线阅读器，支持调节字号、行距、主题、字体

## 快速开始

```bash
npm install
npm start
```

访问 http://localhost:3000

## 技术栈

- 后端：Express + bcryptjs + jsonwebtoken + multer
- 前端：原生 HTML/CSS/JS（明日方舟工业暗色主题）
- 阅读器：epub.js、PDF.js、mammoth.js
