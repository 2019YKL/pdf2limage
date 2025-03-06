import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// 日志函数
const logger = {
  info: (message: string, data?: any) => {
    console.log(`[INFO][UPLOAD] ${message}`, data ? JSON.stringify(data) : '');
  },
  error: (message: string, error: any) => {
    console.error(`[ERROR][UPLOAD] ${message}`, error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  }
};

export async function POST(request: NextRequest) {
  logger.info('Received image upload request');
  
  try {
    const formData = await request.formData();
    const image = formData.get('image') as File;
    const sessionId = formData.get('sessionId') as string;
    const pageIndex = formData.get('pageIndex') as string;
    
    if (!image || !sessionId || pageIndex === undefined) {
      logger.error('Missing required parameters', { 
        hasImage: !!image, 
        hasSessionId: !!sessionId, 
        pageIndex 
      });
      return NextResponse.json({ 
        error: 'Missing required parameters', 
        details: 'Image, sessionId, and pageIndex are required' 
      }, { status: 400 });
    }
    
    logger.info(`Processing image upload for session ${sessionId}, page ${pageIndex}`);
    
    // 确保临时目录存在
    const tempDir = join(process.cwd(), 'public', 'temp', sessionId);
    if (!existsSync(tempDir)) {
      logger.info(`Creating temp directory: ${tempDir}`);
      await mkdir(tempDir, { recursive: true });
    }
    
    // 保存图像
    const imagePath = join(tempDir, `page-${pageIndex}.png`);
    const imageBuffer = Buffer.from(await image.arrayBuffer());
    
    logger.info(`Saving image to: ${imagePath}`);
    await writeFile(imagePath, imageBuffer);
    
    const publicPath = `/temp/${sessionId}/page-${pageIndex}.png`;
    logger.info(`Image saved successfully. Public path: ${publicPath}`);
    
    return NextResponse.json({ 
      success: true, 
      imagePath: publicPath 
    });
  } catch (error) {
    logger.error('Image upload error', error);
    return NextResponse.json({ 
      error: 'Failed to upload image', 
      details: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    }, { status: 500 });
  }
}
