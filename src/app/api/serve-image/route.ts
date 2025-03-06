import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

// 获取系统临时目录的函数
function getTempDirectory() {
  // 在Vercel环境中使用/tmp目录
  if (process.env.VERCEL) {
    return '/tmp';
  }
  // 在开发环境中使用public/temp
  return join(process.cwd(), 'public', 'temp');
}

// 获取输出目录函数
function getOutputDirectory() {
  if (process.env.VERCEL) {
    return join('/tmp', 'output');
  }
  return join(process.cwd(), 'public', 'output');
}

export async function GET(request: NextRequest) {
  try {
    // 获取请求的图片路径
    const { searchParams } = new URL(request.url);
    const imagePath = searchParams.get('path');
    
    if (!imagePath) {
      return new NextResponse('Image path is required', { status: 400 });
    }
    
    // 构建图片的绝对路径 - 首先尝试temp目录
    let absolutePath = join(getTempDirectory(), imagePath);
    let isOutput = false;
    
    // 如果在temp目录中找不到，尝试output目录
    if (!existsSync(absolutePath)) {
      absolutePath = join(getOutputDirectory(), imagePath);
      isOutput = true;
      
      // 如果还是找不到，返回404
      if (!existsSync(absolutePath)) {
        console.log(`[ERROR][SERVE-IMAGE] Image not found: ${absolutePath}`);
        return new NextResponse('Image not found', { status: 404 });
      }
    }
    
    console.log(`[INFO][SERVE-IMAGE] Serving image from: ${absolutePath}`);
    
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
    console.error('[ERROR][SERVE-IMAGE] Error serving image:', error);
    return new NextResponse('Error serving image', { status: 500 });
  }
}
