import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

// 日志函数
const logger = {
  info: (message: string, data?: unknown) => {
    console.log(`[INFO][UPLOAD] ${message}`, data ? JSON.stringify(data) : '');
  },
  error: (message: string, error: unknown) => {
    console.error(`[ERROR][UPLOAD] ${message}`, error);
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

export async function POST(request: NextRequest) {
  logger.info('Received image upload request');
  logger.info(`Running in environment: ${process.env.VERCEL ? 'Vercel' : 'Development'}`);
  
  try {
    const formData = await request.formData();
    const image = formData.get('image') as File;
    const sessionId = formData.get('sessionId') as string;
    const pageIndex = formData.get('pageIndex') as string;
    
    if (!image || !sessionId || pageIndex === undefined) {
      logger.error('Missing required parameters', new Error("Missing required parameters"));
      return NextResponse.json({ 
        error: 'Missing required parameters', 
        details: 'Image, sessionId, and pageIndex are required' 
      }, { status: 400 });
    }
    
    logger.info(`Processing image upload for session ${sessionId}, page ${pageIndex}`);
    
    // 使用系统临时目录
    const baseDir = getTempDirectory();
    const tempDir = join(baseDir, sessionId);
    
    // 确保临时目录存在
    try {
      if (!existsSync(tempDir)) {
        logger.info(`Creating temp directory: ${tempDir}`);
        await mkdir(tempDir, { recursive: true });
      }
    } catch (dirError) {
      logger.error(`Failed to create temp directory: ${tempDir}`, dirError);
      return NextResponse.json({ 
        error: 'Failed to create temporary directory',
        details: dirError instanceof Error ? dirError.message : 'Unknown error' 
      }, { status: 500 });
    }
    
    // 保存图像
    const imagePath = join(tempDir, `page-${pageIndex}.png`);
    const imageBuffer = Buffer.from(await image.arrayBuffer());
    
    logger.info(`Saving image to: ${imagePath}`);
    await writeFile(imagePath, imageBuffer);
    
    // 返回图像的URL路径
    const imageUrl = process.env.VERCEL 
      ? `/api/serve-image?path=${sessionId}/page-${pageIndex}.png`
      : `/temp/${sessionId}/page-${pageIndex}.png`;
    
    return NextResponse.json({ 
      success: true, 
      imagePath: imageUrl
    });
    
  } catch (error) {
    logger.error('Error processing image upload', error);
    return NextResponse.json({ 
      error: 'Failed to process image', 
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
