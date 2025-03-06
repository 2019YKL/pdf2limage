import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';

// 日志函数
const logger = {
  info: (message: string, data?: unknown) => {
    console.log(`[INFO][SERVE-IMAGE] ${message}`, data ? JSON.stringify(data) : '');
  },
  error: (message: string, error: unknown) => {
    console.error(`[ERROR][SERVE-IMAGE] ${message}`, error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  }
};

// 获取系统临时目录的函数
function getTempDirectory() {
  // 始终使用系统临时目录，避免使用程序根目录下的public文件夹
  const tempDir = process.env.VERCEL ? '/tmp' : join(os.tmpdir(), 'pdf2limage');
  
  // 确保目录存在
  try {
    if (!existsSync(tempDir)) {
      // 使用同步方法创建目录，确保目录在后续操作前存在
      const fs = require('fs');
      fs.mkdirSync(tempDir, { recursive: true });
    }
  } catch (error) {
    logger.error(`Failed to create temp directory: ${tempDir}`, error);
  }
  
  return tempDir;
}

// 获取输出目录函数
function getOutputDirectory() {
  // 同样使用系统临时目录下的output子目录
  const baseDir = getTempDirectory();
  const outputDir = join(baseDir, 'output');
  
  // 确保目录存在
  try {
    if (!existsSync(outputDir)) {
      const fs = require('fs');
      fs.mkdirSync(outputDir, { recursive: true });
    }
  } catch (error) {
    logger.error(`Failed to create output directory: ${outputDir}`, error);
  }
  
  return outputDir;
}

export async function GET(request: NextRequest) {
  try {
    // 获取请求的图片路径
    const { searchParams } = new URL(request.url);
    const imagePath = searchParams.get('path');
    
    logger.info(`Serving image request for path: ${imagePath}`);
    logger.info(`Running in environment: ${process.env.VERCEL ? 'Vercel' : 'Development'}`);
    
    if (!imagePath) {
      return new NextResponse('Image path is required', { status: 400 });
    }
    
    // 构建图片的绝对路径 - 首先尝试temp目录
    let absolutePath = join(getTempDirectory(), imagePath);
    let isOutput = false;
    
    logger.info(`Looking for image at: ${absolutePath}`);
    
    // 如果在temp目录中找不到，尝试output目录
    if (!existsSync(absolutePath)) {
      absolutePath = join(getOutputDirectory(), imagePath);
      isOutput = true;
      logger.info(`Image not found in temp, trying output: ${absolutePath}`);
      
      // 如果还是找不到，返回404
      if (!existsSync(absolutePath)) {
        logger.error(`Image not found at either location: ${absolutePath}`);
        return new NextResponse('Image not found', { status: 404 });
      }
    }
    
    logger.info(`Serving image from: ${absolutePath}`);
    
    // 读取图片文件
    const imageBuffer = await readFile(absolutePath);
    
    // 确定内容类型
    let contentType = 'image/png'; // 默认使用PNG
    if (absolutePath.endsWith('.jpg') || absolutePath.endsWith('.jpeg')) {
      contentType = 'image/jpeg';
    } else if (absolutePath.endsWith('.webp')) {
      contentType = 'image/webp';
    }
    
    // 返回图片
    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Content-Disposition': isOutput ? 'attachment; filename="stitched-image.png"' : 'inline'
      }
    });
    
  } catch (error) {
    logger.error('Error serving image:', error);
    return new NextResponse('Error serving image', { status: 500 });
  }
}
