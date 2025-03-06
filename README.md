# PDF to Long Image Converter

这是一个基于 Next.js 开发的 PDF 转 PNG 拼长图应用，使用 Tailwind CSS 进行界面设计，可以部署到 Vercel 平台上。

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2F%7Busername%7D%2Fpdf2limage&project-name=pdf2limage&repository-name=pdf2limage)

一个简单高效的工具，用于将PDF文件转换为单个长图像。

## 功能特点

- 将 PDF 文件转换为多张 PNG 图片
- 自动将转换后的 PNG 图片拼接成一张长图
- 支持拖放文件上传
- 实时显示处理进度
- 简洁美观的用户界面
- 支持下载生成的长图

## 技术栈

- [Next.js](https://nextjs.org) - React 框架
- [Tailwind CSS](https://tailwindcss.com) - 样式框架
- [pdf-lib](https://pdf-lib.js.org/) - PDF 处理库
- [Sharp](https://sharp.pixelplumbing.com/) - 图像处理库
- [React Dropzone](https://react-dropzone.js.org/) - 文件拖放上传

## 开始使用

首先，安装依赖：

```bash
npm install
# 或
yarn install
# 或
pnpm install
```

然后，运行开发服务器：

```bash
npm run dev
# 或
yarn dev
# 或
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000) 在浏览器中查看结果。

## 使用方法

1. 打开应用后，将 PDF 文件拖放到指定区域或点击选择文件
2. 点击 "Convert & Stitch" 按钮开始处理
3. 等待处理完成，可以查看进度条
4. 处理完成后，可以预览并下载生成的长图

## 部署到 Vercel

此应用程序已针对 Vercel 平台进行了优化，可以很容易地部署：

1. 创建 [Vercel 账户](https://vercel.com/signup)
2. 在项目目录运行 `vercel` 或通过 Vercel 仪表盘导入 GitHub 仓库
3. 按照提示完成部署

或者使用 [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) 一键部署。

## 文件结构

- `/src/app/page.tsx` - 主页面组件
- `/src/app/api/convert-pdf/route.ts` - PDF 转 PNG API 端点
- `/src/app/api/stitch-images/route.ts` - 图片拼接 API 端点

## 注意事项

- 大型 PDF 文件处理可能需要较长时间
- 确保服务器有足够的内存处理大文件
- 部署到 Vercel 时，建议设置 `maximumDuration` 参数增加处理超时限制

## 自定义水印图片

您可以通过替换项目中的水印图片来添加自己的品牌标识或二维码：

1. 准备一张尺寸为1280×720像素的PNG图片
2. 将其命名为`lastpic.png`
3. 替换项目中的`/public/lastpic.png`文件

这样，您的自定义图片将自动添加到每个转换的PDF文件末尾。

## 由qizhi发明
